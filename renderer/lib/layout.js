// Subtitle layout: width estimation, line wrapping and Instagram safe-area geometry.
// Shared by the ASS builder and QC so what is checked is exactly what is drawn.
'use strict';

// Approximate advance widths (em) for a Korean UI sans font in bold. Deliberately conservative.
function charEm(ch) {
  const c = ch.codePointAt(0);
  if (ch === ' ') return 0.3;
  if (c >= 0xac00 && c <= 0xd7a3) return 1.0; // Hangul syllables
  if ((c >= 0x3000 && c <= 0x9fff) || (c >= 0xff00 && c <= 0xffef)) return 1.0; // CJK / fullwidth
  if (/[0-9]/.test(ch)) return 0.62;
  if (/[A-Za-z]/.test(ch)) return 0.66;
  if (/[.,'"!?:;()\-·]/.test(ch)) return 0.38;
  return 1.0;
}

function textWidth(text, size) {
  return [...text].reduce((w, ch) => w + charEm(ch) * size, 0) * 1.03;
}

/** Wraps at spaces (preferring breaks after commas) so each line fits maxWidth. */
function wrapLines(text, size, maxWidth) {
  const words = text.split(' ').filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (cur && (textWidth(next, size) > maxWidth || /[,，]$/.test(cur) && textWidth(next, size) > maxWidth * 0.6)) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Safe-area rectangle and the subtitle block geometry for a template. */
function subtitleGeometry(template) {
  const { width: W, height: H } = template.canvas;
  const sa = template.safeArea;
  const st = template.subtitle;
  const safe = { left: Math.round(W * sa.side), right: Math.round(W * (1 - sa.side)), top: Math.round(H * sa.top), bottom: Math.round(H * (1 - sa.bottom)) };
  const lineH = st.size * st.lineHeight;
  return {
    safe,
    maxWidth: safe.right - safe.left - 2 * st.outline,
    marginV: H - safe.bottom, // ASS bottom margin: text block ends on the safe-area bottom edge
    lineH,
    blockTop: (lines) => safe.bottom - lines * lineH - st.outline,
  };
}

module.exports = { textWidth, wrapLines, subtitleGeometry, charEm };
