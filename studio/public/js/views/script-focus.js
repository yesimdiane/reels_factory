// Script Studio, mobile-first: ONE scene at a time.
//   visible by default: scene title, preview, short description, approval status, primary actions
//   expandable: 대사·자막 / 시각 연출·액션 / 이미지·애니메이션 프롬프트 / 고급 설정
//   씬 추가 (header) · 씬 저장 (draft, never approves) · 씬 승인 (validates; on failure opens + scrolls to + highlights the invalid field)
//   On mobile 씬 저장 / 씬 승인 live in a sticky bottom bar (safe areas + keyboard aware, see app.css / main.js).
import { h, chip, icon, toast, confirmDialog, fmtSec } from '../ui.js';
import { state, act, refresh, hooks } from '../state.js';
import { api } from '../api.js';
import { charAvatar } from './common.js';
import { attach, jumpTo } from './script-validate.js';
import { withTranslate } from './translate-box.js';
import { openCutEditor } from './cut-editor.js';
import { sceneTools, statusChip } from './script-project.js';
import { guardLeave } from './leave-guard.js';

const SECTION_OF = { en: 'dialogue', ko: 'dialogue', speaker: 'dialogue', narration: 'dialogue', visual: 'visual', action: 'visual', placement: 'visual', showsProduct: 'visual', characters: 'visual', durationSec: 'advanced', timing: 'advanced', startSec: 'advanced', beatKey: 'advanced', id: 'advanced' };

// Mirror of the server's estimate (display only; the server validates).
function speechSec(text) {
  const t = String(text || '');
  const words = t.trim().split(/\s+/).filter(Boolean).length;
  const stretch = (t.match(/(.)\1{2,}/g) || []).reduce((n, m) => n + (m.length - 2) * 0.045, 0);
  const bangs = Math.min(3, (t.match(/[!?]/g) || []).length) * 0.06;
  return Math.round((words / 2.7 + 0.25 + stretch + bangs) * 100) / 100;
}
const short = (t, n = 110) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

export const currentSceneId = (ep) => { const id = (state.sceneFocus || {})[ep.id]; return ep.scenes.some((s) => s.id === id) ? id : (ep.scenes[0] || {}).id; };
export function setFocus(ep, sid) { state.sceneFocus = Object.assign(state.sceneFocus || {}, { [ep.id]: sid }); }
const isDirty = (d) => !!(d && (d.dirty || d.epDirty));

/** The payload of 씬 저장: this scene's own fields and dialogue only. */
export function scenePayload(d, sid) {
  const sc = d.scenes.find((x) => x.id === sid);
  return { scene: { title_ko: sc.title_ko, durationSec: sc.durationSec, characters: sc.characters, showsProduct: sc.showsProduct, visual: sc.visual, action: sc.action, narration: sc.narration, placement: sc.placement }, lines: d.lines.filter((l) => l.sceneId === sid).map((l) => ({ id: l.id, speaker: l.speaker, en: l.en, ko: l.ko })) };
}

/** Saves the current scene as a DRAFT (never approves). Returns true when saved. */
export async function saveCurrentScene(ep, d, sid, { toastOk = true } = {}) {
  try {
    const r = await api.put(`/api/episodes/${ep.id}/scenes/${sid}`, scenePayload(d, sid));
    state.draft.script = null;
    state.episode = r;
    if (toastOk) toast('씬을 임시 저장했습니다 (승인되지 않았습니다)');
    return true;
  } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); return false; }
}

/** Moves to another scene; unsaved edits are never discarded silently. */
export async function switchScene(ep, d, sid, ctx) {
  if (sid === currentSceneId(ep)) return;
  const go = await guardLeave({ dirty: isDirty(d), what: '이 씬', save: async () => saveAllDirty(ep, d, ctx) });
  if (!go) return;
  setFocus(ep, sid);
  state.draft.script = null;
  await refresh();
  hooks.rerender();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
export async function saveAllDirty(ep, d, ctx) {
  const sid = currentSceneId(ep);
  if (d.dirty && !(await saveCurrentScene(ep, d, sid, { toastOk: false }))) return false;
  if (d.epDirty && ctx && ctx.saveEpisode && !(await ctx.saveEpisode())) return false;
  return true;
}

export async function addScene(ep, d, ctx, beatKey) {
  const go = await guardLeave({ dirty: isDirty(d), what: '새 씬을 만들기 전에', save: async () => saveAllDirty(ep, d, ctx) });
  if (!go) return;
  try {
    const r = await api.post(`/api/episodes/${ep.id}/scenes`, { afterSceneId: currentSceneId(ep), beatKey });
    setFocus(ep, r.newSceneId);
    state.draft.script = null;
    state.episode = r;
    toast(`${r.newSceneId} 씬을 추가했습니다 (기존 씬은 그대로입니다)`);
    await refresh();
    hooks.rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); }
}

/** 씬 승인: save the current edits as a draft, then validate and approve ONLY this scene. On failure: open + scroll to + highlight the invalid field. */
export async function approveCurrentScene(ep, d, sid) {
  try {
    if (d.dirty && !(await saveCurrentScene(ep, d, sid, { toastOk: false }))) return;
    const r = await api.post(`/api/episodes/${ep.id}/scenes/${sid}/approve`);
    state.draft.script = null;
    state.episode = r;
    toast(`${sid} 씬을 승인했습니다`);
    await refresh();
    hooks.rerender();
  } catch (e) {
    state.draft.script = null;
    try { await refresh(); } catch (_) { /* ignore */ }
    hooks.rerender();
    const first = (e.details || []).find((x) => x && (x.field || x.lineId || x.sceneId)) || null;
    toast(e.message, { error: true, recovery: e.recovery });
    if (first) setTimeout(() => jumpTo(Object.assign({ sceneId: sid }, first)), 120);
  }
}

/** Collapsible section; open state survives re-renders. */
function section(ep, sid, key, title, { badge = null, errors = 0 } = {}, ...content) {
  state.ui = state.ui || { open: {} };
  const k = `${ep.id}:${sid}:${key}`;
  const det = h('details', { class: 'scene-section', 'data-section': key, open: !!state.ui.open[k] },
    h('summary', null, h('span', { class: 'section-title' }, title), badge ? h('span', { class: 'small muted' }, badge) : null, errors ? h('span', { class: 'tab-badge err', title: `고쳐야 할 항목 ${errors}개` }, String(errors)) : null),
    h('div', { class: 'section-body stack', style: 'gap:10px' }, ...content));
  det.addEventListener('toggle', () => { state.ui.open[k] = det.open; });
  return det;
}

function previewFor(ep, sc) {
  const ci = sc.cutInfo || {};
  const url = ci.source && ci.source.kind === 'clip' ? `/media/cutframe/${ep.id}/${sc.id}?t=0.5` : (sc.startImageInfo && !sc.startImageInfo.error && sc.startImageInfo.url && !sc.startImageInfo.placeholder ? sc.startImageInfo.url : '');
  return url ? h('img', { class: 'scene-preview', src: url, alt: `${sc.id} 미리보기`, loading: 'lazy' }) : h('div', { class: 'scene-preview empty' }, h('span', null, '미리보기 없음'), h('small', null, '이미지 디벨롭에서 만듭니다'));
}

/**
 * The focused scene. ctx = { index, chars, saveEpisode, addScene(beatKey), onChange }.
 * Returns { el, bar } — `bar` is the (mobile sticky) action bar.
 */
export function sceneFocus(ep, d, ctx) {
  const sid = currentSceneId(ep);
  const sc = d.scenes.find((x) => x.id === sid);
  const srv = ep.scenes.find((x) => x.id === sid);
  const { index, chars } = ctx;
  const ap = srv.approval;
  const idxOf = ep.scenes.findIndex((x) => x.id === sid);
  const lockedB = ep.formula.structured && sc.part === 'B' && ep.formula.ending.structureLocked;
  const errCount = (fields) => (index.errors || []).filter((e) => (e.sceneId === sid || (e.lineId && d.lines.some((l) => l.id === e.lineId && l.sceneId === sid))) && fields.includes(SECTION_OF[e.field] || '')).length;

  // ---- action bar (씬 저장 / 씬 승인): the sticky bar and the inline (desktop) buttons share their handlers and state ----
  const note = h('span', { class: 'bar-note' });
  const saves = [];
  const approves = [];
  const onSave = async () => { const ok = await saveCurrentScene(ep, d, sid); if (ok) { await refresh(); hooks.rerender(); } };
  const onApprove = () => approveCurrentScene(ep, d, sid);
  const mkSave = () => { const b = h('button', { class: 'btn', type: 'button', 'data-scene-save': sid, onclick: onSave }, '씬 저장'); saves.push(b); return b; };
  const mkApprove = () => { const b = h('button', { class: 'btn sage', type: 'button', 'data-scene-approve': sid, onclick: onApprove }, '씬 승인'); approves.push(b); return b; };
  const refreshBar = () => {
    saves.forEach((b) => { b.disabled = !d.dirty; b.textContent = d.dirty ? '씬 저장' : '저장됨'; });
    approves.forEach((b) => { b.disabled = !!(ap && ap.approved && !d.dirty); b.textContent = ap && ap.approved && !d.dirty ? `승인됨 · r${ap.revision}` : '씬 승인'; });
    note.textContent = d.dirty ? '저장하지 않은 변경이 있습니다' : ap && ap.approved ? '승인된 씬입니다 — 수정하면 새 초안이 됩니다' : ap && ap.editedAfterApproval ? `승인 후 수정됨 — r${ap.lastApprovedRev} 승인본은 보관됨` : '저장해도 승인되지 않습니다';
  };
  const dirty = () => { d.dirty = true; refreshBar(); };
  const bar = h('div', { class: 'scene-actions-bar', role: 'toolbar', 'aria-label': '씬 작업' }, note, h('div', { class: 'bar-buttons' }, mkSave(), mkApprove()));

  // ---- dialogue ----
  const meter = h('span', { class: 'chip', 'data-rf': `S:${sid}:timing` });
  const lineWrap = h('div', { class: 'stack', style: 'gap:10px' });
  const refreshMeter = () => {
    const own = d.lines.filter((l) => l.sceneId === sid);
    const need = own.reduce((n, l) => n + speechSec(l.en), 0) + 0.18 * Math.max(0, own.length - 1) + (own.length ? 0.6 : 0);
    const act0 = !d.dirty && ((ep.derived.timing.scenes.find((x) => x.sceneId === sid) || {}).actual || {});
    meter.textContent = own.length ? `추정 대사 ${need.toFixed(1)}초 / 장면 ${sc.durationSec}초` + (act0 && act0.complete ? ` · 실측 ${act0.needSec.toFixed(1)}초` : '') : `장면 ${sc.durationSec}초 · 대사 없음`;
    meter.className = 'chip ' + (need > sc.durationSec + 0.05 ? 'attention' : '');
  };
  const drawLines = () => { lineWrap.replaceChildren(...d.lines.map((l, li) => ({ l, li })).filter((x) => x.l.sceneId === sid).map(({ l, li }) => lineRow(l, li))); refreshMeter(); };
  // Narration is optional: its box appears only while the 🎙 나레이션 checkbox (next to 대사 추가) is checked.
  state.ui = state.ui || { open: {} };
  state.ui.narr = state.ui.narr || {};
  const nk = `${ep.id}:${sid}`;
  let narrOn = !!(sc.narration && sc.narration.trim()) || !!state.ui.narr[nk] || !!(index.byKey[`S:${sid}:narration`] || []).length;
  const narrWrap = h('div');
  const drawNarr = () => narrWrap.replaceChildren(...(narrOn ? [narrationRow()] : []));
  const narrChk = h('input', { type: 'checkbox', 'data-narration-toggle': sid, checked: narrOn, onchange: async (e) => {
    if (e.target.checked) { narrOn = true; state.ui.narr[nk] = true; drawNarr(); return; }
    if (sc.narration && sc.narration.trim() && !(await confirmDialog({ title: '나레이션을 지울까요?', body: '체크를 해제하면 입력한 나레이션이 삭제됩니다 (씬 저장 전에는 서버에 남아 있습니다).', tone: 'clay', confirm: '지우기' }))) { e.target.checked = true; return; }
    narrOn = false; state.ui.narr[nk] = false; if (sc.narration) { sc.narration = ''; dirty(); } drawNarr();
  } });
  const narrationRow = () => {
    const nf = withTranslate(h('div', { class: 'field' }, h('label', null, '🎙 나레이션 (선택, 한국어)'), h('textarea', { rows: 2, lang: 'ko', placeholder: '필요할 때만 입력하세요', oninput: (e) => { sc.narration = e.target.value; dirty(); } }, sc.narration || '')), ep, () => sc.narration);
    nf.querySelector('textarea').setAttribute('data-rf', `S:${sid}:narration`);
    return h('div', { class: 'line narration-row' }, nf);
  };
  const lineRow = (l, li) => {
    const est = h('div', { class: 'small muted' });
    const upd = () => (est.textContent = '말하는 시간 약 ' + fmtSec(speechSec(l.en)));
    upd();
    const own = d.lines.map((x, i) => ({ x, i })).filter((o) => o.x.sceneId === sid);
    const pos = own.findIndex((o) => o.i === li);
    const swap = (dir) => { const t = own[pos + dir]; if (!t) return; [d.lines[li], d.lines[t.i]] = [d.lines[t.i], d.lines[li]]; dirty(); drawLines(); };
    return h('div', { class: 'line' + (index.errors.some((e) => e.lineId === l.id) ? ' has-error' : '') },
      h('div', { class: 'speaker' }, charAvatar(chars.find((c) => c.id === l.speaker) || { id: '', name: '?', references: [] }), h('select', { 'aria-label': '화자', 'data-rf': `L:${l.id}:speaker`, onchange: (e) => { l.speaker = e.target.value; dirty(); drawLines(); } }, chars.map((c) => h('option', { value: c.id, selected: c.id === l.speaker }, c.name)))),
      attach(index, h('div', { class: 'field' }, h('label', null, 'English dialogue (음성)'), h('textarea', { rows: 2, spellcheck: 'true', lang: 'en', oninput: (e) => { l.en = e.target.value; upd(); refreshMeter(); dirty(); } }, l.en), est), `L:${l.id}:en`),
      attach(index, h('div', { class: 'field' }, h('label', null, '한국어 자막'), h('textarea', { rows: 2, lang: 'ko', oninput: (e) => { l.ko = e.target.value; dirty(); } }, l.ko)), `L:${l.id}:ko`),
      h('div', { class: 'line-tools' },
        h('button', { class: 'btn icon ghost', type: 'button', title: '위로', disabled: pos === 0, onclick: () => swap(-1) }, icon('up')),
        h('button', { class: 'btn icon ghost', type: 'button', title: '아래로', disabled: pos === own.length - 1, onclick: () => swap(1) }, icon('down')),
        h('button', { class: 'btn icon danger', type: 'button', title: '삭제', onclick: () => { d.lines.splice(li, 1); dirty(); drawLines(); } }, icon('trash'))));
  };
  drawLines();
  drawNarr();
  const dialogue = section(ep, sid, 'dialogue', '대사 · 자막', { badge: `${d.lines.filter((l) => l.sceneId === sid).length}개`, errors: errCount(['dialogue']) },
    meter, lineWrap, narrWrap,
    h('div', { class: 'row' }, h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { d.lines.push({ id: '', sceneId: sid, speaker: chars[0].id, en: '', ko: '' }); dirty(); drawLines(); } }, icon('plus'), '대사 추가'),
      h('label', { class: 'chk-btn', title: '체크하면 이 씬의 나레이션(한국어, 선택) 입력칸이 나타납니다' }, narrChk, '🎙 나레이션'),
      (ep.suggestions || []).map((sg, i) => sg.sceneId === sid && h('button', { class: 'btn sm ghost', type: 'button', onclick: () => act(() => api.post(`/api/episodes/${ep.id}/suggestions/${i}/add`), { ok: '제안 대사를 추가했습니다' }) }, '제안: “' + sg.en.slice(0, 24) + '…”'))));

  // ---- visual direction ----
  const field = (label, key, rows) => withTranslate(attach(index, h('div', { class: 'field' }, h('label', null, label), h('textarea', { rows, oninput: (e) => { sc[key] = e.target.value; dirty(); refreshDesc(); } }, sc[key] || '')), `S:${sid}:${key}`), ep, () => sc[key]);
  const visual = section(ep, sid, 'visual', '시각 연출 · 액션', { errors: errCount(['visual']) },
    field('시각 연출 · 애니메이션 (필수, English)', 'visual', 5), field('캐릭터 행동 (선택, English)', 'action', 3), field('제품 배치 (선택)', 'placement', 2),
    h('label', { class: 'row small', style: 'gap:6px' }, h('input', { type: 'checkbox', 'data-rf': `S:${sid}:showsProduct`, checked: !!sc.showsProduct, onchange: (e) => { sc.showsProduct = e.target.checked; dirty(); } }), '이 장면에 제품이 보임'));

  // ---- prompts (read-only here; edited and approved in the Storyboard) ----
  const p = srv.prompt;
  const prompts = section(ep, sid, 'prompts', '이미지 · 애니메이션 프롬프트', { badge: p && p.video ? '있음' : '아직 없음' },
    h('div', { class: 'small muted' }, '프롬프트는 스토리보드(이미지 디벨롭)에서 만들고 승인합니다. 여기서는 읽기 전용입니다.'),
    p && p.video ? h('div', { class: 'stack', style: 'gap:6px' }, h('div', { class: 'eyebrow' }, '애니메이션(영상) 프롬프트'), h('pre', { class: 'prompt-view' }, p.video), p.negative ? h('div', { class: 'small muted' }, '제외: ' + short(p.negative, 160)) : null) : h('div', { class: 'muted small' }, '대본을 승인하면 스토리보드에서 무료 템플릿 프롬프트가 만들어집니다.'),
    srv.startImageInfo && !srv.startImageInfo.error ? h('div', { class: 'small' }, `시작 이미지: ${srv.startImageInfo.label || ''}${srv.startImageInfo.approved ? ' · 승인됨' : ' · 승인 대기'}`) : h('div', { class: 'small muted' }, '시작 이미지: 아직 없음'),
    h('a', { class: 'btn sm ghost', href: '#/storyboard/' + ep.id, onclick: (e) => { if (isDirty(d)) { e.preventDefault(); toast('저장하지 않은 변경이 있습니다. 먼저 씬을 저장하세요.', { error: true }); } } }, '스토리보드에서 열기'));

  // ---- advanced ----
  const cutInfo = srv.cutInfo || { inserts: [] };
  const advanced = section(ep, sid, 'advanced', '고급 설정', { errors: errCount(['advanced']) },
    h('div', { class: 'row', style: 'gap:12px;flex-wrap:wrap' },
      h('label', { class: 'row small muted', style: 'gap:6px' }, '장면 길이', attach(index, h('input', { type: 'number', min: 1, max: 15, step: 0.5, style: 'width:84px', value: sc.durationSec, oninput: (e) => { sc.durationSec = Number(e.target.value); refreshMeter(); dirty(); } }), `S:${sid}:durationSec`), '초'),
      chip(sc.part ? `PART ${sc.part} · ${sc.beatKey}` : `비트 ${sc.beat || ''}`, ''), lockedB ? chip('🔒 고정 엔딩', 'done') : null),
    h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
      h('button', { class: 'btn sm ghost', type: 'button', 'data-add-cut': sid, title: '이 장면의 영상을 잘라 클로즈업·리액션 컷을 넣습니다 (요금 없음)', onclick: () => { if (isDirty(d)) return toast('저장하지 않은 변경이 있습니다. 먼저 씬을 저장한 뒤 컷을 편집하세요.', { error: true }); openCutEditor(ep, sid); } }, icon('plus'), '컷 추가'),
      cutInfo.inserts.map((i) => h('button', { class: 'chip ' + (i.resolution && i.resolution.level === 'blur' ? 'err' : ''), type: 'button', onclick: () => { if (isDirty(d)) return toast('먼저 씬을 저장하세요.', { error: true }); openCutEditor(ep, sid); } }, `✂ ${i.id} ${i.label} ${i.startSec}–${Math.round((i.startSec + i.durationSec) * 10) / 10}초`))),
    sceneTools(ep, sc),
    ap && ap.history.length ? h('div', { class: 'stack', style: 'gap:6px' }, h('div', { class: 'eyebrow' }, `승인 기록 (${ap.history.length}개 버전)`), ap.history.slice().reverse().map((v) => h('div', { class: 'scene-version small' }, h('b', null, `r${v.rev}`), ` · ${new Date(v.at).toLocaleString('ko-KR')} · ${v.by}${v.revokedAt ? ' · 취소됨' : v.supersededAt ? ' · 새 버전으로 대체됨' : v.current ? ' · 현재 승인본' : ''}`))) : null,
    lockedB ? null : h('button', { class: 'btn sm danger', type: 'button', onclick: async () => { if (isDirty(d)) return toast('저장하지 않은 변경이 있습니다. 먼저 저장하세요.', { error: true }); if (await confirmDialog({ title: `${sid} 씬을 삭제할까요?`, body: '이 씬의 대사도 함께 삭제됩니다. 만든 클립·이미지 파일과 승인 기록은 지워지지 않습니다.', tone: 'clay', confirm: '삭제' })) { try { const r = await api.del(`/api/episodes/${ep.id}/scenes/${sid}`); setFocus(ep, (r.scenes[Math.max(0, idxOf - 1)] || r.scenes[0] || {}).id); state.draft.script = null; state.episode = r; await refresh(); hooks.rerender(); toast('씬을 삭제했습니다'); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); } } } }, icon('trash'), '이 씬 삭제'));

  // ---- header + summary ----
  const desc = h('div', { class: 'scene-desc' });
  const refreshDesc = () => { desc.textContent = short(sc.visual) || '아직 설명이 없습니다. "시각 연출 · 액션"에 적어 주세요.'; };
  refreshDesc();
  const missing = ap && !ap.approved && ap.errors.length ? ap.errors : [];
  const el = h('div', { class: 'card scene-card', id: 'script-scene-' + sid, 'data-rf': `S:${sid}:block`, 'data-scene-card': sid },
    h('div', { class: 'scene-head' },
      h('div', { class: 'row', style: 'gap:8px;flex-wrap:nowrap;min-width:0' }, h('span', { class: 'scene-no eyebrow' }, sid), statusChip(ap)),
      h('button', { class: 'btn sm clay', type: 'button', 'data-add-scene': sid, title: '현재 씬 바로 뒤에 새 씬을 만듭니다 (기존 씬은 바뀌지 않습니다)', onclick: () => ctx.addScene() }, icon('plus'), '씬 추가')),
    attach(index, h('div', { class: 'field', style: 'margin:0' }, h('input', { type: 'text', class: 'scene-title', value: sc.title_ko, placeholder: sc.legacyTitle ? '한국어 제목 입력 (현재: ' + sc.legacyTitle + ')' : '한국어 장면 제목 (예: 영국인의 자신감)', maxLength: 24, 'aria-label': '장면 제목 (한국어)', oninput: (e) => { sc.title_ko = e.target.value; dirty(); } })), `S:${sid}:title_ko`),
    h('div', { class: 'scene-summary' }, previewFor(ep, srv), h('div', { class: 'scene-summary-text' }, desc,
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, chip(`${sc.durationSec}초`, ''), ...(sc.characters || []).map((c) => chip((chars.find((x) => x.id === c) || { name: c }).name, '')), sc.showsProduct ? chip('제품 노출', 'attention') : null,
        ap && ap.approved ? chip(`승인됨 r${ap.revision}`, 'done') : ap && ap.editedAfterApproval ? chip('승인 후 수정됨', 'attention') : null))),
    missing.length ? h('div', { class: 'stack', style: 'gap:6px' }, h('div', { class: 'small', style: 'color:var(--rose);font-weight:600' }, `승인하려면 ${missing.length}개를 고쳐야 합니다`), missing.slice(0, 4).map((e) => h('button', { class: 'issue err issue-link', type: 'button', onclick: () => jumpTo(Object.assign({ sceneId: sid }, e, { key: undefined })) }, h('span', null, e.message)))) : null,
    dialogue, visual, prompts, advanced);
  refreshBar();
  return { el, bar, dirty };
}

/** Previous / Next navigation + compact scene tabs. */
export function sceneNavigator(ep, d, ctx) {
  const sid = currentSceneId(ep);
  const i = ep.scenes.findIndex((x) => x.id === sid);
  const go = (k) => { const t = ep.scenes[k]; if (t) switchScene(ep, d, t.id, ctx); };
  const tabs = h('div', { class: 'scene-tabs', role: 'tablist', 'aria-label': '씬 목록' }, ep.scenes.map((s) => {
    const a = s.approval || {};
    const badge = a.approved ? h('span', { class: 'tab-badge ok' }, '✓') : a.errorCount ? h('span', { class: 'tab-badge err' }, String(a.errorCount)) : a.editedAfterApproval ? h('span', { class: 'tab-badge stale' }, '↻') : a.status === 'ready' ? h('span', { class: 'tab-badge ready' }, '○') : h('span', { class: 'tab-badge draft' }, '·');
    return h('button', { class: 'btn sm ghost scene-tab' + (s.id === sid ? ' current' : ''), type: 'button', role: 'tab', 'aria-selected': s.id === sid ? 'true' : 'false', 'data-scene-tab': s.id, title: `${s.id} · ${s.title_ko || ''}`, onclick: () => switchScene(ep, d, s.id, ctx) }, s.id, badge);
  }));
  const nav = h('div', { class: 'scene-nav' },
    h('button', { class: 'btn', type: 'button', 'data-prev-scene': '1', disabled: i <= 0, onclick: () => go(i - 1) }, '← 이전 씬'),
    h('div', { class: 'scene-nav-title' }, h('b', null, `${i + 1} / ${ep.scenes.length}`), h('span', { class: 'small muted' }, ' ' + short((ep.scenes[i] || {}).title_ko, 14))),
    h('button', { class: 'btn', type: 'button', 'data-next-scene': '1', disabled: i >= ep.scenes.length - 1, onclick: () => go(i + 1) }, '다음 씬 →'));
  // keep the current tab in view inside the scroller (never scrolls the page sideways)
  setTimeout(() => { const cur = tabs.querySelector('.current'); if (cur && tabs.scrollTo) tabs.scrollTo({ left: Math.max(0, cur.offsetLeft - 60), behavior: 'auto' }); }, 0);
  return h('div', { class: 'stack', style: 'gap:8px' }, nav, tabs);
}
