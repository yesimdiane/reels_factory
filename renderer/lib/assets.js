// Scene assets: the footage manifest (clips/<릴스ID>/assets.json), provenance rules, clip analysis
// (rejects solid-colour and still-image "video"), and the ASSETS_REQUIRED shot list.
// Runs entirely before any paid API call.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./ffmpeg');

const SOURCE_LABELS = {
  'own-footage': '직접 촬영',
  licensed: '사용 허가받은 영상 (판매처·제조사 서면 허가 등)',
  'flow-generated': 'Google Flow 생성 (승인 후)',
};

class AssetsRequiredError extends Error {
  constructor(report) {
    super('ASSETS_REQUIRED: 승인된 영상 소스가 부족합니다. ' + report.summary);
    this.name = 'AssetsRequiredError';
    this.code = 'ASSETS_REQUIRED';
    this.report = report;
  }
}

function needsRealProduct(beat, template) {
  return template.assets.realProductBeats.includes(beat);
}

/** Every shot the storyboard needs, with what it must show. */
function shotRequirements(storyboard, template) {
  const head = template.shots.clipHeadroomSec;
  return storyboard.beats.flatMap((b) =>
    b.shots.map((sh, k) => ({
      id: sh.id,
      file: sh.id + '.mp4',
      beat: b.beat,
      line: b.subtitle,
      visual: b.visual,
      framing: sh.framing || (b.shots.length > 1 ? `컷 ${k + 1}/${b.shots.length}` : ''),
      minClipSec: +(sh.scriptedSec + head).toFixed(1),
      realProduct: needsRealProduct(b.beat, template),
      allowedSources: needsRealProduct(b.beat, template) ? template.assets.realProductSources : template.assets.allowedSources,
      flowPrompt: b.flowPrompt,
    }))
  );
}

function loadAssetManifest(clipsDir, reelId) {
  const file = path.join(clipsDir, reelId, 'assets.json');
  if (!fs.existsSync(file)) return null;
  try {
    return { file, dir: path.dirname(file), data: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (e) {
    return { file, dir: path.dirname(file), error: 'assets.json을 읽을 수 없습니다: ' + e.message };
  }
}

/** Frame statistics over the part of the clip that will be used. */
async function analyzeClip(ffmpegCfg, file, inSec, durSec) {
  const { stdout } = await run(ffmpegCfg.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file]);
  const j = JSON.parse(stdout);
  const st = (j.streams || [])[0];
  if (!st) return { error: '영상 스트림이 없습니다' };
  const { stderr } = await run(ffmpegCfg.ffmpeg, [
    '-hide_banner', '-v', 'info', '-ss', String(inSec), '-t', String(durSec), '-i', file,
    '-vf', 'fps=5,scale=96:-2,signalstats,metadata=mode=print', '-an', '-f', 'null', '-',
  ]);
  const vals = (key) => [...stderr.matchAll(new RegExp('lavfi\\.signalstats\\.' + key + '=([0-9.]+)', 'g'))].map((m) => Number(m[1]));
  const ymin = vals('YMIN');
  const ymax = vals('YMAX');
  const ydif = vals('YDIF');
  const frames = Math.min(ymin.length, ymax.length);
  const flat = ymin.slice(0, frames).filter((v, i) => ymax[i] - v < 16).length;
  const motion = ydif.length > 1 ? ydif.slice(1).reduce((a, b) => a + b, 0) / (ydif.length - 1) : 0;
  return { width: st.width, height: st.height, duration: Number(j.format.duration), frames, flatRatio: frames ? flat / frames : 1, motion };
}

/**
 * Validates the manifest against the storyboard. Returns { ok, shots: { id: { file, in, … } }, problems: [] }.
 * Problems are actionable Korean messages; any problem means ASSETS_REQUIRED.
 */
async function validateAssets(manifest, storyboard, template, ffmpegCfg, analyze = analyzeClip) {
  const reqs = shotRequirements(storyboard, template);
  const problems = [];
  const shots = {};
  if (!manifest) return { ok: false, missingManifest: true, reqs, shots, problems: ['assets.json이 없습니다.'] };
  if (manifest.error) return { ok: false, reqs, shots, problems: [manifest.error] };
  const d = manifest.data;
  if (d.reelId !== storyboard.reelId) problems.push(`assets.json의 reelId(${d.reelId})가 작업(${storyboard.reelId})과 다릅니다.`);
  const entries = d.shots || {};
  for (const r of reqs) {
    const a = entries[r.id];
    const p = `${r.id} [${r.beat}] `;
    if (!a) { problems.push(p + '영상이 지정되지 않았습니다.'); continue; }
    const file = path.resolve(manifest.dir, a.file || '');
    if (!a.file || !fs.existsSync(file)) { problems.push(p + `파일이 없습니다: ${a.file || '(file 없음)'}`); continue; }
    if (!r.allowedSources.includes(a.source)) {
      problems.push(p + `source "${a.source || '없음'}"는 이 장면에 쓸 수 없습니다. 허용: ${r.allowedSources.join(', ')}` +
        (r.realProduct ? ' (실제 제품 시연 장면은 실제 제품 영상만 허용)' : ''));
    }
    if (a.source === 'licensed' && !String(a.rights || '').trim()) problems.push(p + 'licensed 영상은 rights(허가 근거)를 적어야 합니다.');
    if (r.realProduct && a.showsProduct !== true) problems.push(p + '이 장면은 실제 제품이 보여야 합니다 (showsProduct: true).');
    const inSec = Number(a.in || 0);
    let info;
    try {
      info = await analyze(ffmpegCfg, file, inSec, r.minClipSec);
    } catch (e) {
      problems.push(p + '영상을 읽을 수 없습니다: ' + e.message.split('\n')[0]);
      continue;
    }
    if (info.error) { problems.push(p + info.error); continue; }
    if (Math.min(info.width, info.height) < template.assets.minShortSide) problems.push(p + `해상도가 낮습니다 (${info.width}x${info.height}, 짧은 변 ${template.assets.minShortSide}px 이상).`);
    if (info.duration - inSec < r.minClipSec - 0.05) problems.push(p + `길이가 부족합니다 (사용 가능 ${(info.duration - inSec).toFixed(1)}초, 필요 ${r.minClipSec}초).`);
    if (info.flatRatio > template.assets.maxFlatRatio) problems.push(p + '단색(솔리드 컬러) 화면입니다. 실제 촬영·생성 영상이 필요합니다.');
    else if (info.motion < template.assets.minMotion) problems.push(p + '움직임이 없는 정지 이미지입니다. 실제 영상 클립이 필요합니다.');
    shots[r.id] = { file, in: inSec, source: a.source, showsProduct: !!a.showsProduct, rights: a.rights || '', analysis: info };
  }
  return { ok: problems.length === 0, reqs, shots, problems };
}

/** Writes SHOTLIST.md + assets.template.json so the operator knows exactly what to film or generate. */
function writeAssetsRequired(clipsDir, job, storyboard, template, validation) {
  const dir = path.join(clipsDir, job.reelId);
  fs.mkdirSync(dir, { recursive: true });
  const reqs = validation.reqs;
  const tmpl = {
    reelId: job.reelId,
    shots: Object.fromEntries(reqs.map((r) => [r.id, { file: r.file, source: r.realProduct ? 'own-footage' : 'own-footage', showsProduct: r.realProduct, rights: '', in: 0 }])),
  };
  fs.writeFileSync(path.join(dir, 'assets.template.json'), JSON.stringify(tmpl, null, 2));
  const md = [
    `# ${job.reelId} 촬영·생성 목록 (ASSETS_REQUIRED)`,
    '',
    `상품: ${job.productName} · 대본 v${job.scriptVersion} (승인됨) · 템플릿 ${template.name}`,
    '',
    `- 레퍼런스 릴스 스타일: 자연광 실제 생활 공간, 핸드헬드, 사람·손·발(POV)이 제품을 실제로 쓰는 모습, 질감 클로즈업, 공간 와이드. 그래픽·슬라이드 없음. 컷 길이 약 ${template.shots.targetSec}초 (편집은 렌더러가 함).`,
    '- 세로 9:16, 1080×1920 이상, 30fps 권장. 각 클립은 아래 "최소 길이" 이상. 장면 전환은 편집 효과 대신 카메라를 휙 돌리는 정도로 충분합니다.',
    '- 한 번 길게 찍은 영상 하나로 여러 컷을 채워도 됩니다: assets.json에서 같은 file에 서로 다른 in(시작 초)을 지정하세요.',
    '- 화면에 글자·로고 없이. 자막·음성은 렌더러가 넣습니다 (클립 소리는 사용하지 않음).',
    '- **실제 제품** 표시 장면은 실제 제품을 직접 촬영(own-footage)하거나 허가받은 영상(licensed)만 사용합니다. 마켓(쿠팡 등) 상세페이지 영상은 사용 금지.',
    '- 파일을 이 폴더에 아래 이름으로 저장하고, `assets.template.json`을 `assets.json`으로 복사해 source/rights를 채우세요.',
    '',
    '| 컷 | 파일 | 장면 | 자막(내레이션) | 촬영 내용 | 구도 | 최소 길이 | 허용 소스 |',
    '|---|---|---|---|---|---|---|---|',
    ...reqs.map((r) => `| ${r.id} | ${r.file} | ${r.beat}${r.realProduct ? ' · 실제 제품' : ''} | ${r.line} | ${r.visual} | ${r.framing} | ${r.minClipSec}초 | ${r.allowedSources.map((s) => SOURCE_LABELS[s] || s).join(' / ')} |`),
    '',
    '## Google Flow 프롬프트 (실제 제품이 아닌 장면에만 사용 가능)',
    '',
    ...reqs.filter((r) => !r.realProduct).map((r) => `- **${r.id}**: ${r.flowPrompt}`),
    '',
    validation.problems.length && !validation.missingManifest ? '## 현재 문제\n\n' + validation.problems.map((p) => '- ' + p).join('\n') : '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'SHOTLIST.md'), md);
  return { dir, shotlist: path.join(dir, 'SHOTLIST.md'), template: path.join(dir, 'assets.template.json') };
}

module.exports = { shotRequirements, loadAssetManifest, analyzeClip, validateAssets, writeAssetsRequired, AssetsRequiredError, SOURCE_LABELS };
