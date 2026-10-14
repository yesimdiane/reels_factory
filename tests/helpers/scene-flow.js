'use strict';
// Test helpers for the per-scene production flow (mock voice, mock video; nothing here is billable).
/** generate mock audio and approve it for every scene that has dialogue */
async function approveAllAudio(s, epId) {
  const est = s.voice.estimate(epId);
  await s.voice.synthesize(epId, { confirmChars: est.billableChars });
  const ep = s.store.episodes.get(epId);
  for (const sc of ep.scenes) if (s.sceneFlow.audioState(ep, sc.id).state === 'unapproved') await s.sceneFlow.approveAudio(epId, sc.id);
}
/** compose + approve every scene (clips and audio must already be approved) */
async function approveAllScenes(s, epId) {
  for (const sc of s.store.episodes.get(epId).scenes) {
    await s.sceneFlow.buildComposite(epId, sc.id);
    await s.sceneFlow.approveScene(epId, sc.id);
  }
}
module.exports = { approveAllAudio, approveAllScenes };
