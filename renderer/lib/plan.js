// Timeline: beats keep their scripted length unless the narration needs more; each beat is split
// into its shots (hard cuts); subtitles follow the voice; disclosure at start and end.
'use strict';
const { wrapLines, subtitleGeometry } = require('./layout');

/**
 * storyboard: from buildStoryboard; narration: [{ file, duration }] one per beat (same order).
 * Returns the timeline in seconds.
 */
function buildTimeline(storyboard, narration, template) {
  const n = template.narration;
  const geo = subtitleGeometry(template);
  let t = 0;
  const beats = storyboard.beats.map((b, i) => {
    const voice = narration[i];
    const dur = Math.max(b.scriptedSec, n.leadInSec + voice.duration + n.tailSec);
    const start = t;
    t += dur;
    const vStart = start + n.leadInSec;
    const per = dur / b.shots.length;
    return {
      sceneNo: b.sceneNo,
      beat: b.beat,
      start,
      end: start + dur,
      duration: dur,
      voice: { file: voice.file, start: vStart, end: vStart + voice.duration, duration: voice.duration },
      subtitle: {
        text: b.subtitle,
        lines: wrapLines(b.subtitle, template.subtitle.size, geo.maxWidth),
        start: vStart,
        end: Math.min(vStart + voice.duration + template.subtitle.holdSec, start + dur),
      },
      shots: b.shots.map((sh, k) => ({ id: sh.id, start: start + k * per, end: start + (k + 1) * per, duration: per })),
    };
  });
  const total = t;
  const d = template.disclosure;
  const last = beats[beats.length - 1];
  const full = [{ start: 0, end: Math.min(d.startSec, total) }];
  if (d.onLastScene && last.start > d.startSec) full.push({ start: last.start, end: total });
  const tag = d.persistentTag && d.persistentTag.enabled && last.start > d.startSec ? [{ start: d.startSec, end: last.start }] : [];
  return {
    width: template.canvas.width,
    height: template.canvas.height,
    fps: template.canvas.fps,
    total,
    beats,
    shots: beats.flatMap((b) => b.shots),
    voice: beats.map((b) => b.voice), // for the narration track builder
    disclosure: { full, tag },
  };
}

module.exports = { buildTimeline };
