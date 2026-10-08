// Render orchestration. Order matters for cost: gate → plan inputs → ffmpeg check → budget → TTS → FFmpeg.
// Nothing billable happens until the job is verified, the clips are present and FFmpeg is usable.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyJob } = require('./job');
const { splitNarration } = require('./tts');
const { buildPlan } = require('./plan');
const { buildAss } = require('./ass');
const ffm = require('./ffmpeg');

const CLIP_EXTS = ['.mp4', '.mov', '.m4v'];

/** Finds clips/<reelId>/S<n>.mp4 (or S<n>.mov …). Returns [{ clip } | { missing: true }]. */
function findClips(clipsDir, job, sceneCount) {
  const dir = path.join(clipsDir, job.reelId);
  const out = [];
  for (let n = 1; n <= sceneCount; n++) {
    const hit = CLIP_EXTS.map((e) => path.join(dir, 'S' + n + e)).find((f) => fs.existsSync(f));
    out.push(hit ? { clip: hit } : { missing: true, expected: path.join(dir, 'S' + n + '.mp4') });
  }
  return out;
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * opts: { jobFile, secret, tts (service from createTtsService), ttsInfo, storage, clipsDir,
 *         preview, dryRun, force, ffmpeg: { ffmpeg, ffprobe }, font, fontsDir, size, now, log }
 */
async function render(opts) {
  const log = opts.log || (() => {});

  // 1. Approval gate (signature, status, approved fingerprint, permission, expiry).
  const job = verifyJob(opts.jobFile, { secret: opts.secret, now: opts.now });
  log(`✓ 승인 확인: ${job.reelId} 대본 v${job.scriptVersion} (지문 ${job.approvedHash})`);

  const scenes = JSON.parse(job.script['장면(JSON)']);
  const segments = splitNarration(job.script['내레이션']);
  const visuals = findClips(opts.clipsDir, job, scenes.length);
  const missing = visuals.filter((v) => v.missing);
  const estimate = opts.tts.estimate(segments);
  const variant = opts.preview ? 'preview' : 'final';
  const key = `${job.reelId}/v${job.scriptVersion}-${job.approvedHash.slice(3, 11)}-${variant}`;

  if (opts.dryRun) {
    return { dryRun: true, job, estimate, segments, clips: visuals, outputKey: key };
  }

  // 2. Everything that could make the render fail is checked before paying for TTS.
  if (missing.length && !opts.preview) {
    throw new Error('Flow 클립이 없습니다 (최종 렌더에는 모든 장면 클립이 필요):\n' + missing.map((m) => '  - ' + m.expected).join('\n') +
      '\n미리보기만 원하면 --preview (무료 로컬 음성 + 임시 화면)');
  }
  const ff = await ffm.checkFfmpeg(opts.ffmpeg);

  // 3. Idempotency: same approved script + same variant → reuse the existing render.
  if (!opts.force && opts.storage.exists(key + '/manifest.json')) {
    const prev = JSON.parse(opts.storage.read(key + '/manifest.json'));
    log('= 이미 렌더된 결과를 재사용합니다 (비용 0): ' + prev.output.path);
    return Object.assign(prev, { reused: true });
  }

  // 4. TTS (budget-checked inside; cached sentences cost nothing).
  log(`… 음성 합성: ${estimate.provider} ${estimate.voice} — 과금 글자 ${estimate.billableChars}, 예상 $${estimate.estimatedUsd.toFixed(4)}`);
  const narration = await opts.tts.synthesizeAll(segments);

  // 5. Plan, overlay, audio, video.
  const size = opts.size || { width: 1080, height: 1920 };
  const plan = buildPlan(job, narration, size);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-render-'));
  fs.writeFileSync(path.join(work, 'subs.ass'), buildAss(plan, { font: opts.font, preview: !!opts.preview }));
  await ffm.buildNarrationTrack(opts.ffmpeg, plan, path.join(work, 'narration.wav'), work);
  const vis = visuals.map((v) => (v.clip ? { clip: v.clip } : { placeholder: true }));
  const tmpOut = path.join(work, 'reel.mp4');
  await ffm.composeVideo(opts.ffmpeg, plan, vis, {
    assFile: 'subs.ass',
    fontsDir: opts.fontsDir,
    narrationFile: 'narration.wav',
    outFile: tmpOut,
    cwd: work,
    crf: opts.crf,
    preset: opts.preset,
  });

  const probed = await ffm.probe(opts.ffmpeg.ffprobe, tmpOut);
  const fileName = `${job.reelId}_script-v${job.scriptVersion}${opts.preview ? '_PREVIEW' : ''}.mp4`;
  const stored = await opts.storage.publish(tmpOut, key + '/' + fileName);
  const manifest = {
    reelId: job.reelId,
    productId: job.productId,
    scriptVersion: job.scriptVersion,
    approvedHash: job.approvedHash,
    nextVideoVersion: job.nextVideoVersion,
    variant,
    previewWarning: opts.preview ? '미리보기용: 임시 화면/로컬 음성 포함 가능. 게시하거나 영상으로 등록하지 마세요.' : '',
    renderedAt: new Date().toISOString(),
    output: { path: stored.path, uri: stored.uri, sha256: sha256File(stored.path), duration: probed.duration, streams: probed.streams },
    tts: Object.assign({}, estimate, opts.ttsInfo || {}, {
      segments: narration.map((n) => ({ text: n.text, duration: Number(n.duration.toFixed(3)), cached: n.cached })),
    }),
    visuals: visuals.map((v, i) => ({ scene: i + 1, source: v.clip ? path.basename(v.clip) : 'placeholder' })),
    timeline: {
      total: Number(plan.total.toFixed(3)),
      scenes: plan.scenes.map((s) => ({ scene: s.sceneNo, start: +s.start.toFixed(2), end: +s.end.toFixed(2) })),
      subtitles: plan.subtitles.length,
      endCard: { start: +plan.endCard.start.toFixed(2), keyword: plan.endCard.keyword },
    },
    ffmpeg: ff.version,
  };
  const manifestTmp = path.join(work, 'manifest.json');
  fs.writeFileSync(manifestTmp, JSON.stringify(manifest, null, 2));
  await opts.storage.publish(manifestTmp, key + '/manifest.json');
  fs.rmSync(work, { recursive: true, force: true });
  log('✓ 완료: ' + stored.path);
  return manifest;
}

module.exports = { render, findClips };
