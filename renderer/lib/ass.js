// ASS overlay for the lifestyle template: subtitles (white bold, thin black outline, lower-middle
// safe area, ≤2 lines). The Coupang Partners disclosure is drawn only if the template enables it
// (default: caption only). No headlines, no slides, no animations.
'use strict';
const { wrapLines, subtitleGeometry } = require('./layout');

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

function buildAss(timeline, template, { font, disclosureText, preview = false }) {
  const W = template.canvas.width;
  const H = template.canvas.height;
  const geo = subtitleGeometry(template);
  const st = template.subtitle;
  const d = template.disclosure;
  const style = (name, size, bold, outline, align, mL, mR, mV) =>
    `Style: ${name},${font},${size},${st.color},&H000000FF,${st.outlineColor},&H00000000,${bold ? -1 : 0},0,0,0,100,100,0,0,1,${outline},${st.shadow},${align},${mL},${mR},${mV},1`;
  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    style('Sub', st.size, st.bold, st.outline, 2, geo.safe.left, W - geo.safe.right, geo.marginV),
    style('Disclosure', d.size, true, 2, 8, geo.safe.left, W - geo.safe.right, geo.safe.top),
    style('Tag', d.persistentTag ? d.persistentTag.size : 30, true, 2, 7, geo.safe.left, 0, geo.safe.top),
    style('Preview', 26, true, 2, 9, 0, geo.safe.left, geo.safe.top),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const ev = (layer, a, b, s, text) => lines.push(`Dialogue: ${layer},${ts(a)},${ts(b)},${s},,0,0,0,,${text}`);

  timeline.beats.forEach((b) => ev(2, b.subtitle.start, b.subtitle.end, 'Sub', b.subtitle.lines.map(esc).join('\\N')));

  const dLines = wrapLines(disclosureText, d.size, geo.maxWidth).map(esc).join('\\N');
  timeline.disclosure.full.forEach((iv) => ev(3, iv.start, iv.end, 'Disclosure', dLines));
  timeline.disclosure.tag.forEach((iv) => ev(3, iv.start, iv.end, 'Tag', esc(d.persistentTag.text)));
  if (preview) ev(4, 0, timeline.total, 'Preview', esc('미리보기 음성'));
  return lines.join('\n') + '\n';
}

module.exports = { buildAss, ts, esc };
