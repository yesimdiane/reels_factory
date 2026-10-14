// Storyboard assets that are NOT the scene's script: the 0.5-second movement plan (acting timeline) and the B-roll library.
//   * motion  : ep.motion[sceneId] = { rev, beats[], source, history[] }  — beats on a 0.5 s grid inside the scene length.
//               Free template draft + manual editing; revisions are kept. The timeline text is appended to the video prompt at generation time.
//   * B-roll  : ep.broll[] — optional shots developed as separate STILL-image assets (reference or upload); they are layered during
//               video editing and never become extra paid video clips on their own. Edits send an approved item back to review.
// Nothing here calls an AI or video provider.
'use strict';
const path = require('node:path');
const { StudioError, nowIso, sha256, safeName } = require('./util');
const animdraft = require('./animdraft');

const STEP = 0.1; // permit precise audio-end cuts; normal motion remains 0.5s
const KINDS = ['close_up', 'reaction', 'insert', 'broll'];
const KIND_LABEL = { close_up: '클로즈업', reaction: '리액션 컷', insert: '인서트', broll: 'B-roll' };
const FIELDS = ['character', 'emotion', 'body', 'gaze', 'expression', 'camera'];
const r1 = (n) => Math.round(n * 1000) / 1000;
const onGrid = (n) => Math.abs(n / STEP - Math.round(n / STEP)) < 1e-6;
const fmt = (n) => n.toFixed(1);

function createStoryboardAssets({ store, dialogueTiming, lib, products }) {
  const sceneOf = (ep, sid) => {
    const s = (ep.scenes || []).find((x) => x.id === sid);
    if (!s) throw new StudioError('NOT_FOUND', '장면을 찾을 수 없습니다: ' + sid, { status: 404 });
    return s;
  };

  // ---------------- movement beats (0.5 s grid) ----------------
  const castNames = (scene) => (scene.characters || []).map((id) => ({ id, name: ((lib().characters || []).find((c) => c.id === id) || { name: id }).name }));
  function cleanBeats(list, scene) {
    if (!Array.isArray(list)) throw new StudioError('BAD_BEATS', '비트 목록이 필요합니다.', { status: 422 });
    const dur = Number(scene.durationSec) || 0;
    const cast = castNames(scene);
    const out = [];
    const problems = [];
    list.forEach((b, i) => {
      const t0 = Number(b && b.t0); const t1 = Number(b && b.t1);
      const n = i + 1;
      if (!Number.isFinite(t0) || !Number.isFinite(t1)) return problems.push({ index: i, field: 't0', message: `비트 ${n}: 시작/끝 시간이 필요합니다.` });
      if (!onGrid(t0) || !onGrid(t1)) problems.push({ index: i, field: 't0', message: `비트 ${n}: 시간은 0.1초 단위여야 합니다 (${t0}–${t1}).` });
      if (!(t1 > t0)) problems.push({ index: i, field: 't1', message: `비트 ${n}: 끝 시간은 시작보다 커야 합니다.` });
      if (t0 < 0 || t1 > dur + 1e-6) problems.push({ index: i, field: 't1', message: `비트 ${n}: 장면 길이(${dur}초)를 벗어납니다 (${t0}–${t1}). 장면은 자동으로 늘어나지 않습니다.` });
      // character: by id (preferred) or by name; it must be in this scene's cast
      const raw = String((b && (b.characterId || b.character)) || '').trim();
      const hit = cast.find((c) => c.id === (b && b.characterId)) || cast.find((c) => c.id === raw.toLowerCase() || c.name.toLowerCase() === raw.toLowerCase());
      if (!raw) problems.push({ index: i, field: 'character', message: `비트 ${n}: 캐릭터가 필요합니다.` });
      else if (!hit) problems.push({ index: i, field: 'character', message: `비트 ${n}: 이 장면에 등장하지 않는 캐릭터입니다 (${raw}). 장면 캐릭터: ${cast.map((c) => c.name).join(', ') || '없음'}.` });
      const beat = { sceneId: scene.id, characterId: hit ? hit.id : '', character: hit ? hit.name : raw, t0: r1(t0), t1: r1(t1) };
      FIELDS.filter((k) => k !== 'character').forEach((k) => { beat[k] = String((b && b[k]) || '').trim().slice(0, 300); });
      if (!beat.emotion) problems.push({ index: i, field: 'emotion', message: `비트 ${n}: 감정을 적어 주세요.` });
      if (!beat.body && !beat.gaze && !beat.expression) problems.push({ index: i, field: 'body', message: `비트 ${n}: 몸 동작, 시선, 표정 중 하나는 필요합니다 (모든 부위를 채울 필요는 없습니다).` });
      out.push(beat);
    });
    const sorted = out.slice().sort((a, b) => a.t0 - b.t0);
    const lastEnd = {};
    sorted.forEach((x, i) => { const k = x.characterId || x.character; if (lastEnd[k] !== undefined && x.t0 < lastEnd[k].t1 - 1e-6) problems.push({ index: i, field: 't0', message: `같은 캐릭터(${x.character})의 비트가 겹칩니다 (${fmt(lastEnd[k].t0)}–${fmt(lastEnd[k].t1)} / ${fmt(x.t0)}–${fmt(x.t1)}). 서로 다른 캐릭터의 비트는 겹쳐도 됩니다.` }); if (!lastEnd[k] || x.t1 > lastEnd[k].t1) lastEnd[k] = x; });
    return { beats: sorted, problems };
  }

  /** Free, deterministic, scene-specific draft (dialogue, visual direction, action, camera cues). See animdraft.js. */
  function draftBeats(ep, sc) { return animdraft.draftBeats(ep, sc, lib().characters || []); }
  const estimateSpan = (line) => Math.max(1, String(line.en || '').trim().split(/\s+/).length / 2.7);

  /** Text appended to the video prompt: one line per beat, in time order. */
  function timelineText(beats) {
    if (!beats || !beats.length) return '';
    const lines = beats.map((b) => `${fmt(b.t0)}–${fmt(b.t1)}s: ${[b.character, b.body, b.gaze && 'eyes: ' + b.gaze, b.expression && 'face: ' + b.expression].filter(Boolean).join('; ')}; emotion: ${b.emotion}${b.camera ? '; camera: ' + b.camera : ''}.`);
    return 'ANIMATION TIMELINE (0.5-second steps; keep natural motion, pauses and holds; the approved 2D anime/webtoon character look stays unchanged):\n' + lines.join('\n');
  }
  const motionOf = (ep, sid) => (ep.motion && ep.motion[sid]) || null;
  /** What goes to the video model: the approved prompt + the movement plan (changing the plan changes this text, so spend must be re-approved). */
  function composePrompt(ep, sid, videoText) {
    const m = motionOf(ep, sid);
    const tl = m ? timelineText(m.beats) : '';
    return tl ? `${String(videoText || '').trim()}\n\n${tl}` : String(videoText || '');
  }

  async function saveMotion(id, sceneId, { beats, source = 'manual' } = {}, by = 'operator') {
    const ep0 = store.episodes.get(id);
    const sc = sceneOf(ep0, sceneId);
    const { beats: clean, problems } = cleanBeats(beats, sc);
    if (problems.length) throw new StudioError('INVALID_MOTION', problems[0].message, { status: 422, details: problems });
    await store.episodes.update(id, (ep) => {
      ep.motion = ep.motion || {};
      const prev = ep.motion[sceneId];
      const history = prev ? (prev.history || []).concat([{ rev: prev.rev, beats: prev.beats, source: prev.source, at: prev.at, by: prev.by }]).slice(-20) : [];
      ep.motion[sceneId] = { rev: (prev ? prev.rev : 0) + 1, beats: clean, source, at: nowIso(), by, history };
    });
    store.episodes.audit(id, 'motion.saved', { sceneId, by, source });
    return store.episodes.get(id).motion[sceneId];
  }
  async function draftMotion(id, sceneId, by = 'operator') {
    const ep = store.episodes.get(id);
    const sc = sceneOf(ep, sceneId);
    return saveMotion(id, sceneId, { beats: draftBeats(ep, sc), source: 'template' }, by);
  }

  // ---------------- B-roll library ----------------
  const brollOf = (ep) => (ep.broll || []);
  function cleanBroll(raw, ep, prev) {
    const sc = sceneOf(ep, String(raw.sceneId || (prev && prev.sceneId) || ''));
    const kind = KINDS.includes(raw.kind) ? raw.kind : (prev && prev.kind) || 'broll';
    const at = raw.insertAtSec != null ? Number(raw.insertAtSec) : prev ? prev.insertAtSec : 0;
    const dur = raw.durationSec != null ? Number(raw.durationSec) : prev ? prev.durationSec : 1;
    const problems = [];
    if (!Number.isFinite(at) || at < 0) problems.push('삽입 위치는 0초 이상이어야 합니다.');
    if (!(dur >= 0.5)) problems.push('길이는 0.5초 이상이어야 합니다.');
    if (Number.isFinite(at) && Number.isFinite(dur) && at + dur > Number(sc.durationSec) + 1e-6) problems.push(`위치+길이(${r1(at + dur)}초)가 장면 길이(${sc.durationSec}초)를 넘습니다. 장면은 자동으로 늘어나지 않습니다.`);
    const others = brollOf(ep).filter((b) => b.status !== 'removed' && b.sceneId === sc.id && (!prev || b.id !== prev.id));
    if (others.some((b) => at < b.insertAtSec + b.durationSec - 1e-6 && b.insertAtSec < at + dur - 1e-6)) problems.push('같은 장면의 다른 B-roll과 시간이 겹칩니다.');
    if (problems.length) throw new StudioError('INVALID_BROLL', problems[0], { status: 422, details: problems });
    return { sceneId: sc.id, kind, insertAtSec: r1(at), durationSec: r1(dur), effect: String(raw.effect != null ? raw.effect : (prev && prev.effect) || '').slice(0, 200), note: String(raw.note != null ? raw.note : (prev && prev.note) || '').slice(0, 300), imageRef: raw.imageRef !== undefined ? cleanRef(raw.imageRef, ep) : (prev && prev.imageRef) || null };
  }
  function cleanRef(ref, ep) {
    if (!ref) return null;
    if (ref.type === 'product') return { type: 'product', imageId: String(ref.imageId || '').slice(0, 80) };
    if (ref.type === 'scene_start') { sceneOf(ep, String(ref.sceneId)); return { type: 'scene_start', sceneId: String(ref.sceneId) }; }
    if (ref.type === 'upload') return { type: 'upload', file: String(ref.file || ''), sha256: String(ref.sha256 || '') };
    throw new StudioError('BAD_REF', '알 수 없는 이미지 참조입니다.', { status: 422 });
  }
  const nextBrollId = (ep) => 'BR' + (brollOf(ep).reduce((m, b) => Math.max(m, Number((/^BR(\d+)/.exec(b.id) || [0, 0])[1])), 0) + 1);
  /** Stable id of the image that was approved: B-roll id + content hash (or the product/frame it points at). */
  const assetIdOf = (b) => { const r = b.imageRef || {}; return r.type === 'upload' ? `${b.id}:${String(r.sha256 || '').slice(0, 12)}` : r.type === 'product' ? `product:${r.imageId}` : r.type === 'scene_start' ? `startframe:${r.sceneId}` : ''; };
  const assetStatus = (b) => (b.imageRef ? 'ready' : 'needed');

  async function saveBroll(id, raw, by = 'operator') {
    let out;
    await store.episodes.update(id, (ep) => {
      ep.broll = ep.broll || [];
      const prev = raw.id ? ep.broll.find((b) => b.id === raw.id) : null;
      if (raw.id && !prev) throw new StudioError('NOT_FOUND', 'B-roll을 찾을 수 없습니다: ' + raw.id, { status: 404 });
      const c = cleanBroll(raw, ep, prev);
      if (prev) {
        prev.history = (prev.history || []).concat([{ rev: prev.rev, insertAtSec: prev.insertAtSec, durationSec: prev.durationSec, imageRef: prev.imageRef, status: prev.status, at: prev.updatedAt }]).slice(-20);
        Object.assign(prev, c, { rev: prev.rev + 1, updatedAt: nowIso() });
        if (prev.status === 'approved' || prev.status === 'removed') prev.status = prev.status === 'removed' ? 'removed' : 'proposed'; // an edit sends approved work back to review
        prev.asset = assetStatus(prev);
        out = prev;
      } else {
        out = Object.assign({ id: nextBrollId(ep), rev: 1, status: 'proposed', origin: raw.origin || 'manual', history: [], createdAt: nowIso(), updatedAt: nowIso(), by }, c);
        out.asset = assetStatus(out);
        ep.broll.push(out);
      }
    });
    store.episodes.audit(id, 'broll.saved', { by, id: out.id });
    return out;
  }
  async function setBrollStatus(id, bid, status, by = 'operator') {
    if (!['approved', 'proposed', 'rejected'].includes(status)) throw new StudioError('BAD_STATUS', '알 수 없는 상태입니다.', { status: 422 });
    let out;
    await store.episodes.update(id, (ep) => {
      const b = brollOf(ep).find((x) => x.id === bid);
      if (!b || b.status === 'removed') throw new StudioError('NOT_FOUND', 'B-roll을 찾을 수 없습니다: ' + bid, { status: 404 });
      if (status === 'approved' && !b.imageRef) throw new StudioError('IMAGE_NEEDED', '승인하려면 먼저 이미지가 필요합니다 (참조 선택 또는 업로드).', { status: 409 });
      b.status = status; b.statusBy = by; b.statusAt = nowIso();
      if (status === 'approved') b.approvedAssetId = assetIdOf(b); else delete b.approvedAssetId;
      out = b;
    });
    store.episodes.audit(id, 'broll.' + status, { by, id: bid });
    return out;
  }
  /** Soft removal: the entry stays (history, uploaded image) but leaves the library and the render. */
  async function removeBroll(id, bid, by = 'operator') {
    await store.episodes.update(id, (ep) => {
      const b = brollOf(ep).find((x) => x.id === bid);
      if (!b) throw new StudioError('NOT_FOUND', 'B-roll을 찾을 수 없습니다: ' + bid, { status: 404 });
      b.status = 'removed'; b.removedAt = nowIso(); b.removedBy = by;
    });
    store.episodes.audit(id, 'broll.removed', { by, id: bid });
    return { id: bid, removed: true };
  }
  async function uploadBrollImage(id, bid, buffer, filename, by = 'operator') {
    const ext = path.extname(filename || '').toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) throw new StudioError('BAD_TYPE', 'PNG, JPG, WEBP 이미지만 올릴 수 있습니다.');
    if (buffer.length > 10 * 1024 * 1024) throw new StudioError('TOO_LARGE', '10 MB 이하 이미지만 가능합니다.');
    const hash = sha256(buffer);
    const file = hash.slice(0, 12) + ext;
    store.episodes.saveFile(id, path.join('broll', file), buffer);
    return saveBroll(id, { id: bid, imageRef: { type: 'upload', file, sha256: hash } }, by);
  }
  /** Free, deterministic proposals (close-up on the first line, a reaction after the last one, an insert for product scenes). Never duplicates; never calls an AI. */
  async function suggestBroll(id, by = 'operator') {
    const ep0 = store.episodes.get(id);
    const made = [];
    for (const sc of ep0.scenes || []) {
      const have = (kind) => brollOf(store.episodes.get(id)).some((b) => b.sceneId === sc.id && b.kind === kind && b.status !== 'removed');
      const dur = Number(sc.durationSec) || 0;
      const lines = (ep0.lines || []).filter((l) => l.sceneId === sc.id);
      const add = async (kind, at, d, effect, note) => { if (have(kind) || at + d > dur + 1e-6 || d < STEP) return; try { made.push(await saveBroll(id, { sceneId: sc.id, kind, insertAtSec: at, durationSec: d, effect, note, origin: 'suggested' }, by)); } catch (_) { /* overlapping suggestion: skipped */ } };
      if (lines.length && dur >= 3) await add('reaction', r1(Math.max(0, dur - 1.5)), 1, 'quick cut to the listener\'s face', '말이 끝난 뒤 상대 반응');
      if (sc.showsProduct && dur >= 3) await add('insert', 0.5, 1, 'product close-up', '제품 클로즈업');
      if (lines.length > 1 && dur >= 5) await add('close_up', 1, 1, 'punch-in on the speaker\'s face', '핵심 대사 클로즈업');
    }
    return made;
  }
  /** Approved B-roll that a render should layer (ordered by scene then time). The renderer decides how; this only reports what is approved and complete. */
  function approvedBroll(ep) {
    return brollOf(ep).filter((b) => b.status === 'approved' && b.imageRef).sort((a, b) => String(a.sceneId).localeCompare(String(b.sceneId)) || a.insertAtSec - b.insertAtSec);
  }
  function imageUrl(ep, b) {
    const r = b.imageRef;
    if (!r) return '';
    if (r.type === 'product') return `/media/product/${ep.productId}/${r.imageId}`;
    if (r.type === 'upload') return `/media/broll/${ep.id}/${b.id}`;
    if (r.type === 'scene_start') { const sc = (ep.scenes || []).find((x) => x.id === r.sceneId); return sc && sc.startImage && sc.startImage.type === 'upload' ? `/media/startframe/${ep.id}/${sc.id}` : ''; }
    return '';
  }
  /** Absolute path of a B-roll still image, or '' when it cannot be used as an overlay (e.g. a character reference sheet). */
  function brollFile(ep, b) {
    const r = b.imageRef;
    if (!r) return '';
    try {
      if (r.type === 'upload') return store.episodes.file(ep.id, path.join('broll', r.file));
      if (r.type === 'product') return products ? products.mediaFile(ep.productId, r.imageId) : '';
      if (r.type === 'scene_start') { const sc = (ep.scenes || []).find((x) => x.id === r.sceneId); return sc && sc.startImage && sc.startImage.type === 'upload' ? store.episodes.file(ep.id, path.join('startframes', sc.startImage.file)) : ''; }
    } catch (_) { return ''; }
    return '';
  }
  const brollView = (ep) => brollOf(ep).filter((b) => b.status !== 'removed').map((b) => Object.assign({}, b, { asset: assetStatus(b), kindLabel: KIND_LABEL[b.kind], imageUrl: imageUrl(ep, b), assetId: assetIdOf(b), imageGenerated: !!b.generated, imageError: (b.imageGen && b.imageGen.lastError) || null, promptEdited: !!(b.imageGen && b.imageGen.prompt) }));

  return { STEP, KINDS, cleanBeats, draftBeats, timelineText, composePrompt, motionOf, saveMotion, draftMotion, saveBroll, setBrollStatus, removeBroll, uploadBrollImage, suggestBroll, approvedBroll, brollView, brollFile };
}

module.exports = { createStoryboardAssets, STEP, KINDS };
