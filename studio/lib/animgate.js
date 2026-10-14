// Animation Studio gates that sit between "audio approved" and "paid generation":
//   * SFX decision  : approve the scene's sound-effect plan, or explicitly state "no SFX needed" (silence is a choice, not a default)
//   * lip sync      : the clip model is not given the audio. Unless a model declares audio-driven lip sync, the operator must
//                     acknowledge that the approved audio is mixed in afterwards (mouth movement is not synced). No lip-sync provider
//                     is registered here; none is invented.
//   * readiness     : one checklist per scene (start image, audio, SFX, prompt, model, endpoint, cost) used by the UI and the paid gate.
// Decisions are bound to a hash of what was decided; changing the SFX list makes the decision stale (never silently approved).
'use strict';
const { StudioError, sha256, canonical, nowIso } = require('./util');

const h = (v) => sha256(canonical(v));

function createAnimGate({ store, sceneFlow }) {
  const sceneOf = (ep, id) => { const s = (ep.scenes || []).find((x) => x.id === id); if (!s) throw new StudioError('NOT_FOUND', '장면을 찾을 수 없습니다: ' + id, { status: 404 }); return s; };
  const sfxList = (ep, sid) => (ep.sfx || []).filter((x) => x.sceneId === sid);
  const sfxHash = (ep, sid) => h(sfxList(ep, sid).map((x) => [x.id, x.sha256, x.offsetSec, x.gainDb]));

  /** undecided · approved (plan) · none (explicit "no SFX") · stale (decision no longer matches the list) */
  function sfxState(ep, sid) {
    const list = sfxList(ep, sid);
    const rec = (ep.sfxPlan || {})[sid];
    const hash = sfxHash(ep, sid);
    let state = 'undecided';
    if (rec) state = rec.hash === hash && ((rec.mode === 'plan' && list.length) || (rec.mode === 'none' && !list.length)) ? (rec.mode === 'none' ? 'none' : 'approved') : 'stale';
    return { state, count: list.length, hash, decision: rec || null };
  }
  const sfxOk = (ep, sid) => ['approved', 'none'].includes(sfxState(ep, sid).state);

  async function decideSfx(epId, sid, mode, by = 'operator') {
    if (!['plan', 'none'].includes(mode)) throw new StudioError('BAD_REQUEST', 'mode는 plan 또는 none 입니다.', { status: 422 });
    await store.episodes.update(epId, (ep) => {
      sceneOf(ep, sid);
      const n = sfxList(ep, sid).length;
      if (mode === 'plan' && !n) throw new StudioError('NO_SFX', `${sid}: 효과음이 없습니다. 효과음을 추가하거나 "효과음 필요 없음"을 선택하세요.`, { status: 409 });
      if (mode === 'none' && n) throw new StudioError('SFX_PRESENT', `${sid}: 효과음 ${n}개가 지정되어 있습니다. 먼저 지우거나 "효과음 계획 승인"을 누르세요.`, { status: 409 });
      ep.sfxPlan = ep.sfxPlan || {};
      ep.sfxPlan[sid] = { mode, hash: sfxHash(ep, sid), by, at: nowIso() };
    });
    store.episodes.audit(epId, 'sfx.decided', { sceneId: sid, mode, by });
  }
  async function revokeSfx(epId, sid, by = 'operator') {
    await store.episodes.update(epId, (ep) => { sceneOf(ep, sid); if (ep.sfxPlan) delete ep.sfxPlan[sid]; });
    store.episodes.audit(epId, 'sfx.revoked', { sceneId: sid, by });
  }

  // ---- lip sync
  const hasDialogue = (ep, sid) => (ep.lines || []).some((l) => l.sceneId === sid);
  function lipState(ep, sid, model) {
    if (!hasDialogue(ep, sid)) return { state: 'na', note: '대사가 없습니다.' };
    if (model && model.lipSync && model.audioField) return { state: 'model', note: '이 모델은 승인된 오디오로 립싱크합니다.' };
    const rec = (ep.lipSync || {})[sid];
    if (rec && rec.mode === 'mix-only') return { state: 'mix-only', decision: rec, note: '립싱크 없이 승인된 오디오를 나중에 합성합니다.' };
    return { state: 'undecided', note: '선택한 모델은 오디오 기반 립싱크를 지원하지 않습니다. 검증된 립싱크 제공자가 등록되어 있지 않으므로, 오디오를 나중에 합성하는 방식을 확인해야 합니다.' };
  }
  async function acknowledgeMixOnly(epId, sid, by = 'operator') {
    await store.episodes.update(epId, (ep) => {
      sceneOf(ep, sid);
      if (!hasDialogue(ep, sid)) throw new StudioError('NO_DIALOGUE', '대사가 없는 장면입니다.', { status: 409 });
      ep.lipSync = ep.lipSync || {};
      ep.lipSync[sid] = { mode: 'mix-only', by, at: nowIso() };
    });
    store.episodes.audit(epId, 'lipsync.ack', { sceneId: sid, by });
  }
  async function clearLipSync(epId, sid) {
    await store.episodes.update(epId, (ep) => { sceneOf(ep, sid); if (ep.lipSync) delete ep.lipSync[sid]; });
  }

  /** The blockers the paid gate adds (same shape as generation.js blockers). */
  function blockers(ep, scenes, model) {
    const out = [];
    scenes.forEach((s) => {
      const sf = sfxState(ep, s.id);
      if (!['approved', 'none'].includes(sf.state)) out.push({ code: 'SFX_NOT_DECIDED', message: `${s.id}: ${sf.state === 'stale' ? '효과음이 바뀌어 승인이 무효입니다' : '효과음 계획이 승인되지 않았습니다'}.`, recovery: 'Animation Studio의 효과음 단계에서 "효과음 계획 승인" 또는 "효과음 필요 없음"을 선택하세요.' });
      const lp = lipState(ep, s.id, model);
      if (lp.state === 'undecided') out.push({ code: 'LIPSYNC_NOT_CHOSEN', message: `${s.id}: 립싱크 방식이 확인되지 않았습니다.`, recovery: '립싱크 단계에서 "오디오를 나중에 합성" 방식을 확인하세요.' });
    });
    return out;
  }

  /** Step 4 checklist for one scene. `est` is gen.estimate() for that scene (free). */
  function checklist(ep, sid, { model, est } = {}) {
    const sc = sceneOf(ep, sid);
    const si = sc.startImageInfo || null;
    const au = sceneFlow.audioState(ep, sid);
    const sf = sfxState(ep, sid);
    const lp = lipState(ep, sid, model);
    const prompt = ep.prompts && ep.prompts[sid];
    const blockerCodes = new Set(((est && est.blockers) || []).map((b) => b.code));
    const items = [
      { key: 'image', label: '시작 이미지 승인', ok: !blockerCodes.has('START_IMAGE_NOT_APPROVED') && !blockerCodes.has('NO_START_IMAGE') && !blockerCodes.has('STORYBOARD_SCENE_CHANGED'), action: 'image' },
      { key: 'audio', label: au.state === 'silent' ? '대사 없음 (오디오 불필요)' : '대사 오디오 승인', ok: ['silent', 'approved'].includes(au.state), detail: au.state, action: 'audio' },
      { key: 'sfx', label: sf.state === 'none' ? '효과음 필요 없음 (확인됨)' : '효과음 계획 승인', ok: ['approved', 'none'].includes(sf.state), detail: sf.state, action: 'sfx' },
      { key: 'lipsync', label: '립싱크 방식 확인', ok: lp.state !== 'undecided', detail: lp.note, action: 'lipsync' },
      { key: 'prompt', label: '애니메이션 프롬프트 준비', ok: !!(prompt && String(prompt.video || '').trim()), action: 'prompt' },
      { key: 'model', label: '영상 모델 선택', ok: !!model, detail: model ? model.label || model.id : '', action: 'model' },
      { key: 'endpoint', label: '모델 엔드포인트 유효', ok: !!(model && model.endpoint) && !blockerCodes.has('MODEL_UNVERIFIED'), detail: model ? model.verification : '', action: 'model' },
      { key: 'cost', label: '비용·예산 확인', ok: !!est && !blockerCodes.has('ESTIMATE_UNKNOWN') && !blockerCodes.has('OVER_LIMIT'), detail: est && est.totalUsd != null ? '$' + est.totalUsd : '', action: 'cost' },
    ];
    return { sceneId: sid, ready: items.every((i) => i.ok), items, sfx: sf, lipSync: lp };
  }

  return { sfxState, sfxOk, decideSfx, revokeSfx, lipState, acknowledgeMixOnly, clearLipSync, blockers, checklist };
}

module.exports = { createAnimGate };
