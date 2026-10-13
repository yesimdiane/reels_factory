// Character reference images for scenes: ONE place that decides which approved Character Library image stands for each character
// of a scene, validates it before any visual generation, and builds the real multimodal inputs for the image provider.
//   * the Character Library owns the files; nothing is copied or regenerated here
//   * default reference = the character's first approved, non-placeholder image; the operator may choose another one per scene
//     (ep.sceneRefs[sceneId][characterId] = refId). Overrides are keyed by scene + character id, so they survive reordering and edits
//   * ep.cast.refAssets snapshots the references that were attached when the project was created (asset ids)
//   * text-only models never "see" images: they only get the written appearance (see textNote)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { StudioError, nowIso } = require('./util');

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
/** (An unconfigured/mock route is left to the router, which refuses image calls with its own message.)
 * Image providers that accept reference images as multimodal input (the router's image route is Gemini-only today). */
const REF_CAPABLE = new Set(['gemini']);

const assetId = (cid, rid) => `${cid}:${rid}`;
const missingMessage = (name) => `Character reference missing: ${name}. Please upload or select a reference image.`;
const usable = (r) => !!r && r.approved && !r.placeholder;

function createCharRefs({ store, lib, router }) {
  const L = () => lib();
  const charOf = (cid) => L().characters.find((x) => x.id === cid);

  function fileOf(cid, ref) {
    try { const f = store.characters.refPath(cid, ref); return fs.existsSync(f) ? f : ''; } catch (_) { return ''; }
  }

  /** What stands for one character in one scene. Pure/free. */
  function forCharacter(ep, sceneId, cid) {
    const c = charOf(cid);
    const name = c ? c.name : cid;
    const base = { characterId: cid, name, nameKo: c ? c.nameKo || '' : '', look: c ? c.look || '' : '', consistency: c ? (c.promptBlock || '') : '', refId: '', assetId: '', status: 'missing', message: missingMessage(name), url: '', override: false, options: [] };
    if (!c) return base;
    const refs = c.references || [];
    base.options = refs.filter(usable).map((r) => ({ refId: r.id, assetId: assetId(cid, r.id), label: r.label || r.id, url: `/media/ref/${cid}/${r.id}`, primary: false }));
    if (base.options[0]) base.options[0].primary = true;
    const wanted = ((ep.sceneRefs || {})[sceneId] || {})[cid];
    const chosen = wanted ? refs.find((r) => r.id === wanted) : null;
    const ref = chosen || refs.find(usable);
    if (wanted && !chosen) base.staleOverride = true; // the chosen image was deleted from the library; fall back to the default
    if (!ref) return Object.assign(base, refs.length ? { status: refs.some((r) => r.placeholder) && !refs.some((r) => !r.placeholder) ? 'placeholder' : 'unapproved', message: refs.some((r) => !r.placeholder) ? `${name}: 참조 이미지가 아직 승인되지 않았습니다. 캐릭터 라이브러리에서 승인하세요.` : missingMessage(name) } : {});
    Object.assign(base, { refId: ref.id, assetId: assetId(cid, ref.id), label: ref.label || ref.id, sha256: ref.sha256, override: !!chosen && chosen.id !== (refs.find(usable) || {}).id });
    if (ref.placeholder) return Object.assign(base, { status: 'placeholder', message: `${name}: 데모용 임시 이미지입니다. 실제 참조 이미지를 올리고 승인하세요.` });
    if (!ref.approved) return Object.assign(base, { status: 'unapproved', url: `/media/ref/${cid}/${ref.id}`, message: `${name}: 선택한 참조 이미지가 승인되지 않았습니다.` });
    if (!fileOf(cid, ref)) return Object.assign(base, { status: 'file_missing', message: `${name}: 참조 이미지 파일을 서버에서 찾을 수 없습니다. 다시 올려 주세요.` });
    return Object.assign(base, { status: 'approved', message: '', url: `/media/ref/${cid}/${ref.id}` });
  }

  /** The references of the characters that are IN this scene (no others). */
  function forScene(ep, scene) {
    return [...new Set(scene.characters || [])].filter(Boolean).map((cid) => forCharacter(ep, scene.id, cid));
  }

  /** Free pre-flight for visual generation. */
  function validate(ep, scenes) {
    const problems = [];
    (scenes || ep.scenes || []).forEach((s) => forScene(ep, s).forEach((r) => { if (r.status !== 'approved') problems.push({ sceneId: s.id, characterId: r.characterId, code: r.status === 'missing' ? 'CHARACTER_REF_MISSING' : 'CHARACTER_REF_' + r.status.toUpperCase(), message: `${s.id}: ${r.status === 'missing' ? missingMessage(r.name) : r.message}` }); }));
    return { ok: !problems.length, problems };
  }

  const supports = (provider) => REF_CAPABLE.has(String(provider || ''));
  function assertProvider() {
    const r = router.routeFor('imageGeneration');
    if (r.provider && r.provider !== 'mock' && !supports(r.provider)) throw new StudioError('REF_UNSUPPORTED', `선택한 이미지 제공자(${r.provider})는 참조 이미지 입력을 지원하지 않습니다. 참조 없이 생성하면 캐릭터가 달라질 수 있어 중단합니다.`, { status: 409, recovery: 'Settings → AI 연동에서 이미지 모델을 참조 이미지를 지원하는 Gemini 이미지 모델로 바꾸세요.' });
    return r;
  }

  /** Real multimodal inputs: the actual approved image bytes + per-character instructions. Throws before any paid call if anything is missing. */
  function inputsFor(ep, scene) {
    const v = validate(ep, [scene]);
    if (!v.ok) { const p = v.problems[0]; throw new StudioError(p.code === 'CHARACTER_REF_MISSING' ? 'NO_CHARACTER_REF' : p.code, p.message, { recovery: '캐릭터 라이브러리에서 실제 참조 이미지를 올리고 승인하거나, 장면의 "캐릭터 참조 이미지"에서 다른 이미지를 고르세요.', status: 409, details: v.problems }); }
    assertProvider();
    const images = []; const used = []; const lines = [];
    forScene(ep, scene).forEach((r) => {
      const c = charOf(r.characterId);
      const ref = c.references.find((x) => x.id === r.refId);
      const f = fileOf(r.characterId, ref);
      images.push({ label: `Character reference for ${r.name} (id ${r.characterId}, asset ${r.assetId}) — ONE person, identity only, never a scene layout:`, mimeType: MIME[path.extname(ref.file).toLowerCase()] || 'image/png', data: fs.readFileSync(f).toString('base64') });
      used.push({ characterId: r.characterId, refId: r.refId, assetId: r.assetId, sha256: ref.sha256 });
      lines.push(`Use the attached ${r.name} character image (${r.assetId}) as the authoritative visual reference. Preserve the face, hairstyle, distinguishing features, body proportions and overall character design exactly. Change only the expression, pose, clothing condition, camera angle and environment as this scene requires.` + (r.look ? ` Approved appearance: ${r.look}` : ''));
    });
    return { images, used, lines };
  }

  /** Persist the reference assets attached to a project at creation (reopening a project keeps them). */
  async function snapshot(epId) {
    const ep = store.episodes.get(epId);
    const ids = [...new Set((ep.scenes || []).flatMap((s) => s.characters || []).concat(ep.characters || []))];
    const refAssets = {};
    ids.forEach((cid) => { const r = forCharacter(ep, '', cid); if (r.refId) refAssets[cid] = { refId: r.refId, assetId: r.assetId, sha256: r.sha256 || '', status: r.status }; });
    await store.episodes.update(epId, (e) => { e.cast = Object.assign({}, e.cast, { refAssets, refAssetsAt: nowIso() }); });
    return refAssets;
  }

  async function setSceneRef(epId, sceneId, cid, refId, by = 'operator') {
    const ep = store.episodes.get(epId);
    const sc = (ep.scenes || []).find((x) => x.id === sceneId);
    if (!sc) throw new StudioError('NOT_FOUND', '장면을 찾을 수 없습니다: ' + sceneId, { status: 404 });
    if (!(sc.characters || []).includes(cid)) throw new StudioError('NOT_IN_SCENE', '이 장면에 등장하지 않는 캐릭터입니다.', { status: 409 });
    const c = charOf(cid);
    const ref = c && c.references.find((r) => r.id === refId);
    if (!ref) throw new StudioError('NOT_FOUND', '참조 이미지를 찾을 수 없습니다.', { status: 404 });
    if (!usable(ref)) throw new StudioError('REF_NOT_APPROVED', '승인된 실제 참조 이미지만 고를 수 있습니다.', { status: 409, recovery: '캐릭터 라이브러리에서 이미지를 승인하세요.' });
    await store.episodes.update(epId, (e) => { e.sceneRefs = Object.assign({}, e.sceneRefs); e.sceneRefs[sceneId] = Object.assign({}, e.sceneRefs[sceneId], { [cid]: refId }); });
    store.episodes.audit(epId, 'scene.charref.set', { sceneId, characterId: cid, refId, by });
    return forScene(store.episodes.get(epId), sc);
  }
  async function clearSceneRef(epId, sceneId, cid, by = 'operator') {
    await store.episodes.update(epId, (e) => { const m = Object.assign({}, e.sceneRefs); if (m[sceneId]) { m[sceneId] = Object.assign({}, m[sceneId]); delete m[sceneId][cid]; } e.sceneRefs = m; });
    store.episodes.audit(epId, 'scene.charref.reset', { sceneId, characterId: cid, by });
    const ep = store.episodes.get(epId);
    return forScene(ep, ep.scenes.find((x) => x.id === sceneId));
  }

  /** For text-only models: written appearance only, and an honest statement that no image was seen. */
  function textNote(ep, characterIds) {
    const rows = [...new Set(characterIds || [])].map((cid) => { const c = charOf(cid); return c ? `- ${c.name} (${cid}): ${c.look || 'no written appearance yet'}` : null; }).filter(Boolean);
    return rows.length ? 'CHARACTER_APPEARANCE (written descriptions only — this text model has NOT been shown the reference images):\n' + rows.join('\n') : '';
  }

  /** True when the stored start frame was generated from other references than the scene currently resolves to. */
  function frameStale(ep, scene) {
    const si = scene.startImage;
    if (!si || !si.generated || !Array.isArray(si.characterRefs)) return false;
    const now = forScene(ep, scene).map((r) => r.assetId).sort().join(',');
    return si.characterRefs.map((r) => r.assetId || assetId(r.characterId, r.refId)).sort().join(',') !== now;
  }

  return { forCharacter, forScene, validate, inputsFor, snapshot, setSceneRef, clearSceneRef, textNote, frameStale, supports, assertProvider, missingMessage };
}

module.exports = { createCharRefs, missingMessage, REF_CAPABLE };
