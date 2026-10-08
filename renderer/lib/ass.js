// Builds the Advanced SubStation (ASS) overlay: disclosure band (whole video), scene headlines,
// voice-synced subtitles, CTA end card, and the preview watermark. Rendered by FFmpeg's libass.
'use strict';

function ts(sec) {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(c).padStart(2, '0');
}

/** Escapes user text for an ASS Dialogue line (no override tags can be injected). */
function esc(text) {
  return String(text || '')
    .replace(/\\/g, '＼')
    .replace(/[{}]/g, (c) => (c === '{' ? '｛' : '｝'))
    .replace(/\r?\n/g, '\\N');
}

// Instagram Reels covers ~220px at the top and ~420px at the bottom with UI; text stays inside.
function buildAss(plan, { font, preview = false }) {
  const W = plan.width;
  const H = plan.height;
  const s = W / 1080; // all sizes are designed for 1080x1920
  const px = (n) => Math.round(n * s);
  const style = (name, size, primary, bold, outline, borderStyle, back, align, marginV) =>
    `Style: ${name},${font},${px(size)},${primary},&H000000FF,&H00000000,${back},${bold ? -1 : 0},0,0,0,100,100,0,0,${borderStyle},${px(outline)},0,${align},${px(70)},${px(70)},${px(marginV)},1`;
  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    style('Disclosure', 38, '&H00FFFFFF', true, 14, 3, '&H40000000', 8, 240),
    style('Headline', 74, '&H00FFFFFF', true, 6, 1, '&H00000000', 8, 430),
    style('Sub', 58, '&H00FFFFFF', true, 6, 1, '&H00000000', 2, 520),
    style('Cta', 64, '&H00FFFFFF', true, 5, 1, '&H00000000', 5, 0),
    style('Keyword', 112, '&H0000D4FF', true, 7, 1, '&H00000000', 5, 0),
    style('Placeholder', 40, '&H00F0F0F0', false, 3, 1, '&H00000000', 5, 0),
    style('Watermark', 30, '&H0000D4FF', true, 3, 1, '&H00000000', 1, 120),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const ev = (layer, a, b, st, text) => lines.push(`Dialogue: ${layer},${ts(a)},${ts(b)},${st},,0,0,0,,${text}`);

  // Conspicuous affiliate disclosure for the whole video.
  ev(5, plan.disclosure.start, plan.disclosure.end, 'Disclosure', '{\\c&H0000D4FF&}[광고]{\\c&H00FFFFFF&} ' + esc(plan.disclosure.text));

  plan.scenes.forEach((sc) => {
    if (sc.onScreenText) ev(3, sc.start, sc.end, 'Headline', esc(sc.onScreenText));
    if (preview) {
      ev(1, sc.start, sc.end, 'Placeholder', `{\\pos(${px(540)},${px(900)})}` + esc('미리보기 화면 · 장면 ' + sc.sceneNo) + '\\N\\N' + esc(sc.visual));
    }
  });
  plan.subtitles.forEach((c) => ev(4, c.start, c.end, 'Sub', esc(c.text)));

  const e = plan.endCard;
  ev(4, e.start, e.end, 'Cta', `{\\pos(${px(540)},${px(820)})\\fad(200,0)}` + esc(e.cta));
  ev(4, e.start, e.end, 'Keyword', `{\\pos(${px(540)},${px(1060)})\\fad(200,0)}` + esc(e.keyword));

  if (preview) ev(6, 0, plan.total, 'Watermark', esc('미리보기 — 실제 Flow 클립·최종 음성 아님. 게시 금지'));
  return lines.join('\n') + '\n';
}

module.exports = { buildAss, ts, esc };
