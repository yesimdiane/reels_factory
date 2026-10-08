// Render orchestration, ordered so that nothing billable happens unless the render can succeed:
//   1 approval gate → 2 storyboard → 3 pre-flight QC → 4 footage (ASSETS_REQUIRED) → 5 FFmpeg check
//   → 6 reuse → 7 TTS (budget-checked, cached) → 8 timeline/overlay/audio/video → 9 post-render QC.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyJob } = require('./job');
const { buildStoryboard } = require('./storyboard');
const { buildTimeline } = require('./plan');
const { buildAss } = require('./ass');
const { loadAssetManifest, validateAssets, writeAssetsRequired, AssetsRequiredError } = require('./assets');
const qc = require('./qc');
const ffm = require('./ffmpeg');

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * opts: { jobFile, secret, template, tts, ttsInfo, storage, clipsDir, preview, dryRun, force,
 *         ffmpeg: { ffmpeg, ffprobe }, font, fontsDir, crf, preset, now, log, analyze }
 */
async function render(opts) {
  const log = opts.log || (() => {});
  const template = opts.template;

  // 1. Approval gate.
  const job = verifyJob(opts.jobFile, { secret: opts.secret, now: opts.now });
  log(`✓ 승인 확인: ${job.reelId} 대본 v${job.scriptVersion} (지문 ${job.approvedHash})`);

  // 2–3. Storyboard and pre-flight QC (text, structure, keyword, layout).
  const storyboard = buildStoryboard(job, template);
  const pre = qc.preflight(storyboard, template, job);
  const estimate = opts.tts.estimate(storyboard.beats.map((b) => b.ttsText));

  // 4. Footage. Missing or invalid → ASSETS_REQUIRED with a shot list. Never substitute slides.
  const assets = await validateAssets(loadAssetManifest(opts.clipsDir, job.reelId), storyboard, template, opts.ffmpeg, opts.analyze);
  if (opts.dryRun) return { dryRun: true, job, storyboard, preflight: pre, assets, estimate };
  if (!pre.ok) throw new qc.QcError(pre, '사전 점검');
  if (!assets.ok) {
    const files = writeAssetsRequired(opts.clipsDir, job, storyboard, template, assets);
    throw new AssetsRequiredError({
      reelId: job.reelId,
      summary: `${assets.reqs.length}컷 필요 — 목록: ${files.shotlist}`,
      problems: assets.problems,
      shotlist: files.shotlist,
      assetsTemplate: files.template,
      required: assets.reqs.map((r) => ({ id: r.id, beat: r.beat, file: r.file, minClipSec: r.minClipSec, realProduct: r.realProduct, line: r.line })),
    });
  }

  // 5. FFmpeg capabilities.
  const ff = await ffm.checkFfmpeg(opts.ffmpeg);

  // 6. Reuse: same approved script + same footage + same variant → nothing to pay or render.
  const footageKey = crypto.createHash('sha256').update(JSON.stringify(Object.entries(assets.shots).map(([id, a]) => [id, a.in, sha256File(a.file)]))).digest('hex').slice(0, 8);
  const variant = opts.preview ? 'preview' : 'final';
  // Any template change (caption style, CTA option, pacing) must produce a new render, not reuse.
  const templateKey = crypto.createHash('sha256').update(JSON.stringify(template)).digest('hex').slice(0, 6);
  const key = `${job.reelId}/v${job.scriptVersion}-${job.approvedHash.slice(3, 11)}-${footageKey}-${template.name}.${templateKey}-${variant}`;
  const prev = !opts.force && opts.storage.exists(key + '/manifest.json') ? JSON.parse(opts.storage.read(key + '/manifest.json')) : null;
  if (prev && prev.qc && prev.qc.postRender && prev.qc.postRender.ok) {
    log('= 이미 렌더된 결과를 재사용합니다 (비용 0): ' + prev.output.path);
    return Object.assign(prev, { reused: true });
  }

  // 7. TTS, one line per beat (budget-checked inside; cached lines cost nothing).
  log(`… 음성: ${estimate.provider} ${estimate.voice} — 과금 글자 ${estimate.billableChars}, 예상 $${estimate.estimatedUsd.toFixed(4)}`);
  const narration = await opts.tts.synthesizeAll(storyboard.beats.map((b) => b.ttsText));

  // 8. Timeline → overlay → audio → video.
  const timeline = buildTimeline(storyboard, narration, template);
  for (const sh of timeline.shots) {
    const a = assets.shots[sh.id];
    if (a.analysis.duration - a.in < sh.duration - 0.02) {
      throw new AssetsRequiredError({
        reelId: job.reelId,
        summary: `${sh.id} 클립이 음성 길이에 비해 짧습니다 (필요 ${sh.duration.toFixed(1)}초, 사용 가능 ${(a.analysis.duration - a.in).toFixed(1)}초). 더 긴 클립으로 교체 후 다시 실행하세요 — 음성은 캐시되어 추가 비용이 없습니다.`,
        problems: [],
        required: [],
      });
    }
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-render-'));
  fs.writeFileSync(path.join(work, 'subs.ass'), buildAss(timeline, template, { font: opts.font, disclosureText: job.script['광고 표기'], keyword: storyboard.keyword, preview: !!opts.preview }));
  await ffm.buildNarrationTrack(opts.ffmpeg, timeline, path.join(work, 'narration.wav'), work);
  const tmpOut = path.join(work, 'reel.mp4');
  const inputs = await ffm.composeVideo(opts.ffmpeg, timeline, assets.shots, {
    assFile: 'subs.ass', fontsDir: opts.fontsDir, narrationFile: 'narration.wav', outFile: tmpOut, cwd: work, crf: opts.crf, preset: opts.preset,
  });

  // 9. Post-render QC.
  const probed = await ffm.probe(opts.ffmpeg.ffprobe, tmpOut);
  const post = qc.postRender(probed, timeline, template, inputs, assets.shots);
  const fileName = `${job.reelId}_script-v${job.scriptVersion}${opts.preview ? '_PREVIEW' : ''}${post.ok ? '' : '_QC_FAILED'}.mp4`;
  const stored = await opts.storage.publish(tmpOut, key + '/' + fileName);
  const manifest = {
    reelId: job.reelId,
    productId: job.productId,
    scriptVersion: job.scriptVersion,
    approvedHash: job.approvedHash,
    nextVideoVersion: job.nextVideoVersion,
    template: template.name,
    variant,
    previewWarning: opts.preview ? '미리보기 음성(무료 로컬 음성)입니다. 게시하거나 영상으로 등록하지 마세요.' : '',
    renderedAt: new Date().toISOString(),
    output: { path: stored.path, uri: stored.uri, sha256: sha256File(stored.path), duration: probed.duration, streams: probed.streams },
    qc: { preflight: pre, postRender: post },
    tts: Object.assign({}, estimate, opts.ttsInfo || {}, { lines: narration.map((n) => ({ text: n.text, duration: +n.duration.toFixed(3), cached: n.cached })) }),
    footage: Object.fromEntries(Object.entries(assets.shots).map(([id, a]) => [id, { file: path.basename(a.file), in: a.in, source: a.source, showsProduct: a.showsProduct, rights: a.rights }])),
    timeline: {
      total: +timeline.total.toFixed(3),
      beats: timeline.beats.map((b) => ({ scene: b.sceneNo, beat: b.beat, start: +b.start.toFixed(2), end: +b.end.toFixed(2), subtitle: b.subtitle.captions.map((c) => c.text), shots: b.shots.map((s) => s.id) })),
      disclosure: timeline.disclosure,
    },
    ffmpeg: ff.version,
  };
  const manifestTmp = path.join(work, 'manifest.json');
  fs.writeFileSync(manifestTmp, JSON.stringify(manifest, null, 2));
  await opts.storage.publish(manifestTmp, key + '/manifest.json');
  fs.rmSync(work, { recursive: true, force: true });
  if (!post.ok) throw new qc.QcError(post, '렌더 결과');
  log('✓ 완료: ' + stored.path);
  return manifest;
}

module.exports = { render };
