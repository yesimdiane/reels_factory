// Pure render planning: timings for scenes, narration, subtitles, disclosure and CTA end card.
// Narration length drives the video: scenes are stretched proportionally so the voice always fits.
'use strict';

const DEFAULTS = { width: 1080, height: 1920, fps: 30, leadIn: 0.3, gap: 0.25, tail: 0.5, endCard: 2.8, lineChars: 15, linesPerCue: 2 };

/** Greedy line filling of words up to `lineChars` characters. */
function fillLines(words, lineChars) {
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if ([...next].length > lineChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Splits a sentence into subtitle cues of up to `linesPerCue` lines of ~`lineChars` characters.
 * Clauses (split after commas) never share a cue, so a cue never ends mid-phrase.
 */
function chunkSubtitle(text, lineChars = DEFAULTS.lineChars, linesPerCue = DEFAULTS.linesPerCue) {
  const cues = [];
  text
    .split(/(?<=[,，])\s+/)
    .filter(Boolean)
    .forEach((clause) => {
      const lines = fillLines(clause.split(' ').filter(Boolean), lineChars);
      for (let i = 0; i < lines.length; i += linesPerCue) cues.push(lines.slice(i, i + linesPerCue).join('\n'));
    });
  return cues;
}

/**
 * job: verified render job; narration: [{ text, duration }] in order.
 * Returns a fully timed plan (seconds).
 */
function buildPlan(job, narration, options = {}) {
  const o = Object.assign({}, DEFAULTS, options);
  const scenes = JSON.parse(job.script['장면(JSON)']);
  if (!Array.isArray(scenes) || !scenes.length) throw new Error('장면(JSON)이 비어 있습니다.');

  // Narration placement.
  let t = o.leadIn;
  const voice = narration.map((seg, i) => {
    const start = t;
    t += seg.duration + (i < narration.length - 1 ? o.gap : 0);
    return { text: seg.text, file: seg.file, start, end: start + seg.duration, duration: seg.duration };
  });
  const voiceEnd = voice.length ? voice[voice.length - 1].end : 0;

  // Scene timing: keep the script's proportions, stretch to fit the voice.
  const scripted = scenes.reduce((n, s) => n + Number(s.duration_sec), 0);
  const body = Math.max(scripted, voiceEnd + o.tail);
  const k = body / scripted;
  let st = 0;
  const timedScenes = scenes.map((s) => {
    const dur = Number(s.duration_sec) * k;
    const scene = { sceneNo: s.scene_no, start: st, end: st + dur, duration: dur, visual: s.visual, onScreenText: s.on_screen_text || '' };
    st += dur;
    return scene;
  });

  // Subtitles follow the voice; each sentence's cues share its time by character count.
  const subtitles = [];
  voice.forEach((v) => {
    const cues = chunkSubtitle(v.text, o.lineChars, o.linesPerCue);
    const total = cues.reduce((n, c) => n + [...c.replace(/\n/g, '')].length, 0);
    let ct = v.start;
    cues.forEach((c) => {
      const d = (v.duration * [...c.replace(/\n/g, '')].length) / total;
      subtitles.push({ text: c, start: ct, end: ct + d });
      ct += d;
    });
  });

  const endCard = { start: body, end: body + o.endCard, cta: job.script['CTA'], keyword: job.script['ManyChat 키워드'] };
  return {
    width: o.width,
    height: o.height,
    fps: o.fps,
    total: endCard.end,
    body,
    stretch: k,
    scenes: timedScenes,
    voice,
    subtitles,
    endCard,
    disclosure: { text: job.script['광고 표기'], start: 0, end: endCard.end },
  };
}

module.exports = { buildPlan, chunkSubtitle, DEFAULTS };
