// Automated quality control. Pre-flight checks run before any paid call; post-render checks
// verify the delivered file. A failed error-level check stops the job.
'use strict';
const { wrapLines, textWidth, subtitleGeometry } = require('./layout');

class QcError extends Error {
  constructor(report, stage) {
    super('QC 실패 (' + stage + '): ' + report.checks.filter((c) => !c.ok && c.level === 'error').map((c) => c.id + ' — ' + c.detail).join(' / '));
    this.name = 'QcError';
    this.code = 'QC_FAILED';
    this.report = report;
  }
}

function report(checks) {
  return { ok: checks.every((c) => c.ok || c.level !== 'error'), checks };
}
const check = (id, ok, detail, level = 'error') => ({ id, ok: !!ok, level, detail });

/** Before TTS: story structure, keyword mapping, shot lengths, subtitle layout, disclosure. */
function preflight(storyboard, template, job) {
  const geo = subtitleGeometry(template);
  const st = template.subtitle;
  const beats = storyboard.beats;
  const checks = [];
  checks.push(check('story.structure', beats[0].beat === 'HOOK' && beats[beats.length - 1].beat === 'CTA' && beats.some((b) => b.beat === 'DEMO') && beats.some((b) => b.beat === 'BENEFIT'),
    beats.map((b) => b.beat).join(' → ')));
  const cta = beats[beats.length - 1];
  checks.push(check('cta.keyword', storyboard.keyword && cta.subtitle.includes(storyboard.keyword),
    `CTA 자막 "${cta.subtitle}"에 이 릴스의 ManyChat 키워드 "${storyboard.keyword}" 포함`));
  const shots = beats.flatMap((b) => b.shots);
  const badShots = shots.filter((s) => s.scriptedSec < template.shots.minSec - 1e-9 || s.scriptedSec > template.shots.maxSec + 1e-9);
  checks.push(check('shots.length', badShots.length === 0, badShots.length ? '2~4초 밖의 컷: ' + badShots.map((s) => `${s.id} ${s.scriptedSec.toFixed(1)}s`).join(', ') : `${shots.length}컷, 모두 ${template.shots.minSec}~${template.shots.maxSec}초`));
  const tr = template.durationSec;
  checks.push(check('duration.scripted', storyboard.scriptedTotal >= tr.min && storyboard.scriptedTotal <= tr.max, `${storyboard.scriptedTotal}초 (허용 ${tr.min}~${tr.max}초)`));
  for (const b of beats) {
    const lines = wrapLines(b.subtitle, st.size, geo.maxWidth);
    const widest = Math.max(...lines.map((l) => textWidth(l, st.size)));
    checks.push(check(`subtitle.S${b.sceneNo}.lines`, lines.length <= st.maxLines, `"${b.subtitle}" → ${lines.length}줄 (최대 ${st.maxLines})`));
    checks.push(check(`subtitle.S${b.sceneNo}.safeArea`, widest <= geo.maxWidth + 0.5 && geo.blockTop(lines.length) >= geo.safe.top,
      `폭 ${Math.round(widest)}/${geo.maxWidth}px, 위치 y ${Math.round(geo.blockTop(lines.length))}~${geo.safe.bottom} (안전영역 ${geo.safe.top}~${geo.safe.bottom})`));
  }
  const d = String(job.script['광고 표기'] || '');
  checks.push(check('disclosure.text', d.includes('쿠팡 파트너스') && d.includes('수수료'), d || '(없음)'));
  if (storyboard.removedSymbols.length) {
    checks.push(check('subtitle.symbols', false, '자막·음성에서 제외한 이모지: ' + storyboard.removedSymbols.join(' ') + ' (글꼴·TTS 미지원). 인스타그램 캡션에는 그대로 쓸 수 있습니다.', 'warn'));
  }
  return report(checks);
}

/** After rendering: format, duration, and that every shot came from a validated asset. */
function postRender(probe, timeline, template, inputs, shotAssets) {
  const v = probe.streams.find((s) => s.codec_type === 'video') || {};
  const a = probe.streams.find((s) => s.codec_type === 'audio');
  const { width, height, fps } = template.canvas;
  const tol = template.shots.maxSec + template.shots.stretchToleranceSec;
  const long = timeline.shots.filter((s) => s.duration > tol);
  const tr = template.durationSec;
  return report([
    check('output.resolution', v.width === width && v.height === height, `${v.width}x${v.height}`),
    check('output.video', v.codec_name === 'h264' && v.pix_fmt === 'yuv420p', `${v.codec_name} ${v.pix_fmt}`),
    check('output.fps', v.r_frame_rate === `${fps}/1`, String(v.r_frame_rate)),
    check('output.audio', a && a.codec_name === 'aac', a ? a.codec_name : '오디오 없음'),
    check('output.duration', Math.abs(probe.duration - timeline.total) < 0.15, `${probe.duration.toFixed(2)}s / 계획 ${timeline.total.toFixed(2)}s`),
    check('output.durationRange', timeline.total >= tr.min && timeline.total <= tr.max, `${timeline.total.toFixed(1)}초 (허용 ${tr.min}~${tr.max}초)`),
    check('visuals.everyShotHasAsset', inputs.length === timeline.shots.length && timeline.shots.every((s) => shotAssets[s.id] && inputs.some((i) => i.shot === s.id)), `${inputs.length}/${timeline.shots.length}컷`),
    check('visuals.noPlaceholders', inputs.every((i) => i.type === 'asset'), inputs.map((i) => i.type).join(',')),
    check('visuals.noFlatOrStill', Object.values(shotAssets).every((s) => s.analysis.flatRatio <= template.assets.maxFlatRatio && s.analysis.motion >= template.assets.minMotion), '모든 소스 클립 단색·정지 아님'),
    check('shots.finalLength', long.length === 0, long.length ? '음성 때문에 길어진 컷: ' + long.map((s) => `${s.id} ${s.duration.toFixed(1)}s`).join(', ') : '모든 컷 ' + tol + '초 이하', 'warn'),
  ]);
}

module.exports = { preflight, postRender, QcError };
