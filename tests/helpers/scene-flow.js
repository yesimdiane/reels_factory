'use strict';
// Test helpers for the per-scene production flow (mock voice, mock video; nothing here is billable).
/** generate mock audio and approve it for every scene that has dialogue */
async function approveAllAudio(s, epId) {
  const est = s.voice.estimate(epId);
  await s.voice.synthesize(epId, { confirmChars: est.billableChars });
  const ep = s.store.episodes.get(epId);
  for (const sc of ep.scenes) if (s.sceneFlow.audioState(ep, sc.id).state === 'unapproved') await s.sceneFlow.approveAudio(epId, sc.id);
}
/** retired: sound effects and lip sync are no longer decided before animation (kept so old call sites still work) */
async function decideAllGates() {}
/** mock lip sync for every dialogue scene that has an approved silent animation + approved audio, then approve it (free, local FFmpeg) */
async function approveAllLipsync(s, epId) {
  for (const sc of s.store.episodes.get(epId).scenes) {
    const ep = s.store.episodes.get(epId);
    if (!(ep.lines || []).some((l) => l.sceneId === sc.id)) continue;
    if (s.lipsync.approvedVersion(ep, sc.id)) continue;
    const v = s.lipsync.sceneView(ep, sc.id);
    if (v.state === 'blocked') continue;
    if (!v.versions.length) {
      const est = s.lipsync.estimate(epId, { sceneIds: [sc.id] });
      const a = await s.lipsync.authorize(epId, { sceneIds: [sc.id], confirmUsd: est.totalUsd, confirmUnknown: est.totalUsd == null });
      await s.lipsync.runScene(epId, a.id, sc.id);
    }
    const last = s.lipsync.state(s.store.episodes.get(epId), sc.id).versions.slice(-1)[0];
    await s.lipsync.review(epId, sc.id, last.v, 'approve');
  }
}
/** compose + approve every scene (clips and audio must already be approved) */
async function approveAllScenes(s, epId) {
  await approveAllLipsync(s, epId);
  for (const sc of s.store.episodes.get(epId).scenes) {
    await s.sceneFlow.buildComposite(epId, sc.id);
    await s.sceneFlow.approveScene(epId, sc.id);
  }
}
module.exports = { approveAllAudio, approveAllScenes, approveAllLipsync, decideAllGates };
