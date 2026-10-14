'use strict';
// Test helpers for the per-scene production flow (mock voice, mock video; nothing here is billable).
/** generate mock audio and approve it for every scene that has dialogue */
async function approveAllAudio(s, epId) {
  const est = s.voice.estimate(epId);
  await s.voice.synthesize(epId, { confirmChars: est.billableChars });
  const ep = s.store.episodes.get(epId);
  for (const sc of ep.scenes) if (s.sceneFlow.audioState(ep, sc.id).state === 'unapproved') await s.sceneFlow.approveAudio(epId, sc.id);
  await decideAllGates(s, epId);
}
/** the operator's pre-generation decisions: SFX plan (or "none") and the lip-sync acknowledgement, for every scene */
async function decideAllGates(s, epId) {
  for (const sc of s.store.episodes.get(epId).scenes) {
    const ep = s.store.episodes.get(epId);
    if (!s.animGate.sfxOk(ep, sc.id)) await s.animGate.decideSfx(epId, sc.id, (ep.sfx || []).some((x) => x.sceneId === sc.id) ? 'plan' : 'none');
    if ((ep.lines || []).some((l) => l.sceneId === sc.id)) await s.animGate.acknowledgeMixOnly(epId, sc.id);
  }
}
/** compose + approve every scene (clips and audio must already be approved) */
async function approveAllScenes(s, epId) {
  for (const sc of s.store.episodes.get(epId).scenes) {
    await s.sceneFlow.buildComposite(epId, sc.id);
    await s.sceneFlow.approveScene(epId, sc.id);
  }
}
module.exports = { approveAllAudio, approveAllScenes, decideAllGates };
