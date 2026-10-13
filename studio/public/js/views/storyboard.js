// Storyboard Studio: image and animation asset development, ONE scene at a time.
// Default view: scene title, main image, asset status and the primary actions (save / approve image / regenerate / next / + cut).
// Product appearance (ON/OFF + placement), prompts, the 0.5-second movement plan, cuts and B-roll live in collapsed panels.
// Nothing here starts a paid generation without its own cost review.
import { h, chip, icon, copyText, confirmDialog, toast, modal } from '../ui.js';
import { state, act, requireEpisode } from '../state.js';
import { api } from '../api.js';
import { imageDevCard } from './image-dev.js';
import { translateControl } from './translate-box.js';
import { openCutEditor } from './cut-editor.js';
import { charRefsPanelBody, charRefsBadge } from './scene-charrefs.js';
import { openBrollAi, previewBroll } from './broll-ai.js';
import { pageHead, noEpisode, lockedNotice, productRefStrip, makeStartImages } from './common.js';

const PLACE = { position: [['', '—'], ['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽'], ['foreground', '앞쪽'], ['background', '뒤쪽']], scale: [['', '—'], ['small', '작게'], ['medium', '보통'], ['large', '크게']], orientation: [['', '—'], ['front', '정면'], ['side', '옆면'], ['angled', '비스듬히'], ['top', '위에서'], ['back', '뒷면']], visibility: [['', '—'], ['partial', '일부만'], ['full', '전체'], ['hero', '주인공처럼']] };
const PLACE_LABEL = { position: '위치', scale: '크기', orientation: '방향', visibility: '노출' };
const BROLL_KIND = [['close_up', '클로즈업'], ['reaction', '리액션 컷'], ['insert', '인서트'], ['broll', 'B-roll']];
const BROLL_STATE = { proposed: ['검토 대기', 'attention'], approved: ['승인됨', 'done'], rejected: ['거절', 'err'] };

const uiState = () => { state.ui = state.ui || { open: {} }; return state.ui; };
const curIndex = (ep) => { const u = uiState(); const k = u.sbScene && u.sbScene[ep.id]; const i = ep.scenes.findIndex((s) => s.id === k); return i >= 0 ? i : 0; };
const setIndex = (ep, i) => { const u = uiState(); u.sbScene = u.sbScene || {}; u.sbScene[ep.id] = ep.scenes[Math.max(0, Math.min(ep.scenes.length - 1, i))].id; };
const refresh = () => act(async () => null);

export function storyboard() {
  const ep = requireEpisode();
  if (!ep) return noEpisode();
  const sbOk = ep.derived.storyboardApproved;
  const wrap = h('div', { class: 'stack', style: 'gap:16px' });
  wrap.append(pageHead('Storyboard', '스토리보드', '승인된 대본의 장면을 이미지와 애니메이션 에셋으로 개발합니다. 승인 전에는 어떤 유료 생성도 시작되지 않습니다.'));
  if (!ep.derived.scriptApproved) wrap.append(lockedNotice('대본이 승인되어야 스토리보드를 승인할 수 있습니다.', 'script', '대본으로 이동'));
  if (ep.derived.storyboardChangedSinceApproval) wrap.append(h('div', { class: 'banner warn' }, h('div', null, h('b', null, '승인 후 스토리보드가 수정되었습니다'), '다시 확인하고 승인하세요.')));
  autoBuild(ep);
  if (!ep.scenes.length) { wrap.append(h('div', { class: 'empty' }, '장면이 없습니다. 대본 스튜디오에서 장면을 만드세요.')); return wrap; }
  const i = curIndex(ep);
  const sc = ep.scenes[i];
  const go = (k) => { setIndex(ep, k); import('../state.js').then(({ hooks }) => hooks.rerender()); };
  wrap.append(h('div', { class: 'scene-tabs', role: 'tablist', 'aria-label': '장면 목록' }, ep.scenes.map((s, k) => {
    const img = s.startImageInfo;
    const ok = img && !img.error && img.approved;
    return h('button', { class: 'btn sm ghost scene-tab' + (k === i ? ' current' : ''), type: 'button', role: 'tab', 'aria-selected': k === i ? 'true' : 'false', 'data-sb-tab': s.id, onclick: () => go(k) }, s.id, ok ? h('span', { class: 'tab-badge ok' }, '✓') : null);
  })));
  const card = sceneCard(ep, sc, i, state.summary.characters, go);
  wrap.append(card.el);
  wrap.append(card.bar);
  wrap.append(projectPanel(ep, sbOk));
  return wrap;
}

function sceneCard(ep, sc, i, chars, go) {
  const key = 'sb:' + sc.id;
  const d = (state.draft[key] = state.draft[key] || { visual: sc.visual, video: sc.prompt ? sc.prompt.video : '', negative: sc.prompt ? sc.prompt.negative : '', baseVideo: sc.prompt ? sc.prompt.video : '', baseNegative: sc.prompt ? sc.prompt.negative : '' });
  const serverVideo = sc.prompt ? sc.prompt.video : '';
  const serverNeg = sc.prompt ? sc.prompt.negative : '';
  if (d.video === d.baseVideo && d.baseVideo !== serverVideo) { d.video = serverVideo; d.baseVideo = serverVideo; }
  if (d.negative === d.baseNegative && d.baseNegative !== serverNeg) { d.negative = serverNeg; d.baseNegative = serverNeg; }
  const img = sc.startImageInfo;
  const hasImg = img && !img.error;
  const isFrame = hasImg && img.url && img.url.includes('/startframe/');
  const imgState = !hasImg ? ['이미지 필요', 'err'] : img.placeholder ? ['데모 임시', 'mock'] : img.approved ? ['이미지 승인됨', 'done'] : ['이미지 미승인', 'attention'];
  const mot = sc.motion;
  const cuts = (sc.inserts || []).length;
  const bro = (sc.broll || []).length;
  const nextScene = ep.scenes[i + 1];

  // ---- primary actions ----
  const saveBtn = h('button', { class: 'btn', type: 'button', 'data-sb-save': sc.id, onclick: () => saveAll() }, '저장');
  const approveBtn = h('button', { class: 'btn sage', type: 'button', 'data-sb-approve-image': sc.id, disabled: !isFrame || img.approved, title: !isFrame ? '업로드하거나 만든 이미지가 있어야 승인할 수 있습니다' : '', onclick: () => act(() => api.post(`/api/episodes/${ep.id}/scenes/${sc.id}/start-frame/approve`, { approved: true }), { ok: '이미지를 승인했습니다' }) }, icon('check'), '이미지 승인');
  const regenBtn = h('button', { class: 'btn ghost', type: 'button', 'data-sb-regenerate': sc.id, disabled: !ep.derived.scriptApproved, title: '비용 확인 후에만 생성됩니다', onclick: () => makeStartImages(ep, [sc.id], { force: true, after: refresh }) }, '다시 만들기');
  const nextBtn = h('button', { class: 'btn ghost', type: 'button', 'data-sb-next': sc.id, disabled: !nextScene, onclick: () => go(i + 1) }, '다음 장면 →');
  const addCutBtn = h('button', { class: 'btn sm clay', type: 'button', 'data-sb-add-cut': sc.id, onclick: () => addCutChooser(ep, sc) }, '+ 컷 추가');

  async function saveAll() {
    const place = readPlace();
    const scene = { id: sc.id, visual: d.visual, showsProduct: !!d.showsProduct };
    if (d.showsProduct) scene.productPlacement = place;
    const ops = [];
    if (scene.visual !== sc.visual || scene.showsProduct !== !!sc.showsProduct || d.showsProduct) ops.push(api.put(`/api/episodes/${ep.id}/scenes/${sc.id}`, { scene }));
    await act(async () => { for (const o of ops) await o; if (sc.prompt && (d.video !== serverVideo || d.negative !== serverNeg)) await api.put(`/api/episodes/${ep.id}/scenes/${sc.id}/prompt`, { video: d.video, negative: d.negative }); return null; }, { ok: '장면을 저장했습니다' });
  }

  // ---- main image ----
  const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', style: 'display:none', onchange: async (e) => { const f = e.target.files[0]; if (f) await act(() => api.upload(`/api/episodes/${ep.id}/scenes/${sc.id}/start-frame`, f), { ok: '프레임을 올렸습니다 (승인 전)' }); } });
  const main = hasImg ? h('img', { class: 'sb-main-img', src: img.url, alt: sc.id + ' 이미지' }) : h('div', { class: 'sb-main-img empty' }, h('span', null, '이미지가 아직 없습니다'), h('small', null, '프레임을 올리거나 비용 확인 후 만드세요'));

  // ---- product appearance ----
  d.showsProduct = d.showsProduct === undefined ? !!sc.showsProduct : d.showsProduct;
  d.place = d.place || Object.assign({ position: '', scale: '', orientation: '', visibility: '', interaction: '', refImageId: '' }, sc.productPlacement || {});
  const placeBox = h('div', { class: 'stack', style: 'gap:8px', 'data-placement': '' });
  const readPlace = () => Object.assign({}, d.place);
  const drawPlace = () => {
    placeBox.replaceChildren();
    if (!d.showsProduct) { placeBox.append(h('div', { class: 'small muted' }, '제품 등장이 꺼져 있으면 이 장면에 제품을 억지로 넣지 않습니다.')); return; }
    const images = ep.productStudioImages || sc.productImages || ep.productRefImages || [];
    placeBox.append(h('div', { class: 'grid two', style: 'gap:8px' }, Object.keys(PLACE).map((k) => h('label', { class: 'field' }, h('span', { class: 'small' }, PLACE_LABEL[k]), h('select', { 'data-place': k, onchange: (e) => { d.place[k] = e.target.value; } }, PLACE[k].map(([v, l]) => h('option', { value: v, selected: d.place[k] === v }, l)))))));
    placeBox.append(h('label', { class: 'field' }, h('span', { class: 'small' }, '캐릭터와의 상호작용 (짧게)'), h('input', { type: 'text', value: d.place.interaction || '', placeholder: '예: Diane이 제품을 들어 보인다', oninput: (e) => (d.place.interaction = e.target.value) })));
    placeBox.append(h('div', { class: 'small', style: 'font-weight:600' }, '제품 참조 이미지 선택'));
    placeBox.append(images.length ? h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, images.map((im) => h('button', { type: 'button', class: 'ref-pick' + (d.place.refImageId === im.id ? ' on' : ''), 'data-ref': im.id, title: im.label || '', onclick: () => { d.place.refImageId = d.place.refImageId === im.id ? '' : im.id; drawPlace(); } }, h('img', { src: im.url, alt: im.label || '제품 참조', loading: 'lazy' })))) : h('div', { class: 'small muted' }, '제품 스튜디오에 이미지를 올리고 승인하면 여기서 고를 수 있습니다.'));
  };
  drawPlace();
  const toggle = h('label', { class: 'chk-btn', 'data-product-toggle': sc.id }, h('input', { type: 'checkbox', checked: d.showsProduct, onchange: (e) => { d.showsProduct = e.target.checked; drawPlace(); } }), '제품 등장');

  // ---- prompts ----
  const promptEl = h('textarea', { rows: 9, 'aria-label': '영상 프롬프트', oninput: (e) => (d.video = e.target.value) }, d.video);
  const tr = translateControl(ep, () => promptEl.value);
  const negEl = h('textarea', { rows: 2, 'aria-label': '네거티브 프롬프트', oninput: (e) => (d.negative = e.target.value) }, d.negative);

  // ---- panels ----
  { const u = uiState(); const k = `sb:${ep.id}:${sc.id}:charrefs`; if (u.open[k] === undefined) u.open[k] = true; } // visible by default
  const panels = [
    panel(ep, sc, 'charrefs', '캐릭터 참조 이미지', charRefsBadge(sc), charRefsPanelBody(ep, sc)),
    panel(ep, sc, 'product', '제품 등장', d.showsProduct ? 'ON' : 'OFF', h('div', { class: 'stack', style: 'gap:10px' }, toggle, placeBox)),
    panel(ep, sc, 'prompt', '이미지 · 영상 프롬프트', sc.prompt ? `r${sc.prompt.rev || 1}${sc.prompt.edited ? ' · 수정됨' : ''}` : '아직 없음', h('div', { class: 'stack', style: 'gap:8px' },
      sc.prompt ? h('div', { class: 'row', style: 'gap:6px' }, chip(sc.prompt.source === 'gemini' ? 'Gemini 생성' : '템플릿', sc.prompt.source === 'gemini' ? 'done' : 'mock'), sc.prompt.edited ? chip('직접 수정함', 'attention') : null, (sc.prompt.history || []).length ? chip(`이전 버전 ${(sc.prompt.history || []).length}개`, '') : null) : null,
      sc.prompt ? [promptEl, tr.panel] : h('div', { class: 'empty' }, '아직 프롬프트가 없습니다. "템플릿으로 만들기"(무료)를 누르세요.'),
      sc.prompt && sc.prompt.sections ? sectionsView(sc.prompt.sections) : null,
      sc.castWarnings && sc.castWarnings.length ? h('div', { class: 'issue err' }, sc.castWarnings.map((w) => w.message).join(' ')) : null,
      sc.promptWarnings.length ? h('div', { class: 'issue err' }, '확인되지 않은 제품 주장: ' + sc.promptWarnings.join(', ')) : null,
      sc.prompt ? h('div', { class: 'field' }, h('label', null, 'Negative prompt'), negEl) : null,
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, tr.btn,
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => copyText(promptEl.value, sc.id + ' 프롬프트를 복사했습니다') }, icon('copy'), 'Copy Prompt'),
        h('button', { class: 'btn sm ghost', type: 'button', disabled: !ep.derived.scriptApproved, onclick: () => aiPrompts(ep, sc) }, icon('play'), 'AI로 다시 만들기'),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => { if (!sc.prompt || !sc.prompt.edited || await confirmDialog({ title: '수정한 프롬프트를 덮어쓸까요?', body: '이 장면의 프롬프트를 템플릿으로 다시 만듭니다. 이전 버전은 기록에 남습니다.', tone: 'clay' })) { delete state.draft[key]; act(() => api.post(`/api/episodes/${ep.id}/storyboard/prompts`, { sceneIds: [sc.id], force: true }), { ok: '프롬프트를 다시 만들었습니다' }); } } }, '템플릿으로 만들기 (무료)')))),
    panel(ep, sc, 'motion', '애니메이션 (0.5초 단위)', mot ? `${mot.beats.length}비트 · r${mot.rev}` : '아직 없음', motionPanel(ep, sc)),
    panel(ep, sc, 'cuts', '컷 · B-roll', `컷 ${cuts} · B-roll ${bro}`, cutsPanel(ep, sc)),
    panel(ep, sc, 'advanced', '고급 설정', '', h('div', { class: 'stack', style: 'gap:10px' },
      h('div', { class: 'field' }, h('label', null, '시각 설명'), h('textarea', { rows: 3, oninput: (e) => (d.visual = e.target.value) }, d.visual)),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, h('button', { class: 'btn sm ghost', type: 'button', onclick: () => fileIn.click() }, icon('upload'), '프레임 올리기'), fileIn,
        h('button', { class: 'btn sm ghost', type: 'button', title: '위로', onclick: () => reorder(ep, i, -1) }, icon('up')), h('button', { class: 'btn sm ghost', type: 'button', title: '아래로', onclick: () => reorder(ep, i, 1) }, icon('down'))),
      refPicker(ep, sc, chars))),
  ];

  const el = h('section', { class: 'card sb-scene', id: 'sb-scene-' + sc.id, 'data-sb-scene': sc.id },
    h('div', { class: 'row between' }, h('div', null, h('div', { class: 'eyebrow' }, `${sc.id} · ${sc.durationSec}초${sc.part ? ' · PART ' + sc.part + (sc.part === 'B' ? ' · 고정 엔딩' : '') : ''}`), h('h2', { style: 'margin:2px 0 0' }, sc.title_ko || sc.title)), addCutBtn),
    main,
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap', 'data-sb-status': '' }, chip(imgState[0], imgState[1]), chip(sc.prompt ? '프롬프트 있음' : '프롬프트 없음', sc.prompt ? 'done' : 'attention'), chip(mot ? `모션 ${mot.beats.length}비트` : '모션 없음', mot ? 'done' : ''), chip(`컷 ${cuts}`, ''), chip(`B-roll ${bro}`, ''), d.showsProduct ? chip('제품 ON', 'attention') : null),
    h('div', { class: 'scene-actions-bar inline sb-actions' }, h('div', { class: 'bar-buttons' }, saveBtn, approveBtn, regenBtn, nextBtn)),
    ...panels);
  // mobile: the same actions as a sticky bar (the inline copy is hidden by CSS on phones)
  const bar = h('div', { class: 'scene-actions-bar sb-bar' }, h('div', { class: 'bar-buttons' }, saveBtn.cloneNode(true), approveBtn.cloneNode(true), nextBtn.cloneNode(true)));
  bar.querySelector('[data-sb-save]').addEventListener('click', () => saveAll());
  bar.querySelector('[data-sb-approve-image]').addEventListener('click', () => approveBtn.click());
  bar.querySelector('[data-sb-next]').addEventListener('click', () => nextBtn.click());
  return { el, bar };
}

function panel(ep, sc, key, title, badge, ...content) {
  const u = uiState();
  const k = `sb:${ep.id}:${sc.id}:${key}`;
  const det = h('details', { class: 'scene-section', 'data-panel': key, open: !!u.open[k] }, h('summary', null, h('span', { class: 'section-title' }, title), badge ? h('span', { class: 'small muted' }, badge) : null), h('div', { class: 'section-body stack', style: 'gap:10px' }, ...content));
  det.addEventListener('toggle', () => { u.open[k] = det.open; });
  return det;
}

function refPicker(ep, sc, chars) {
  const refs = [];
  sc.characters.forEach((cid) => { const c = chars.find((x) => x.id === cid); if (c) c.references.forEach((r) => refs.push({ c, r })); });
  if (!refs.length) return null;
  return h('select', { 'aria-label': '캐릭터 참조 이미지 선택', onchange: (e) => { if (!e.target.value) return; const [cid, rid] = e.target.value.split('|'); act(() => api.put(`/api/episodes/${ep.id}/scenes/${sc.id}/start-image`, { type: 'reference', characterId: cid, refId: rid }), { ok: '참조 이미지를 시작 프레임으로 지정했습니다 (승인 전)' }); } },
    h('option', { value: '' }, '캐릭터 참조 이미지로 지정…'), refs.map(({ c, r }) => h('option', { value: c.id + '|' + r.id }, c.name + ' · ' + (r.label || r.id) + (r.approved ? ' (승인됨)' : ''))));
}

// ---------------- 0.5-second movement plan ----------------
function motionPanel(ep, sc) {
  const key = `motion:${ep.id}:${sc.id}`;
  const base = (sc.motion && sc.motion.beats) || [];
  const draft = (state.draft[key] = state.draft[key] || { beats: base.map((b) => Object.assign({}, b)), rev: sc.motion ? sc.motion.rev : 0 });
  if (draft.rev !== (sc.motion ? sc.motion.rev : 0)) { draft.beats = base.map((b) => Object.assign({}, b)); draft.rev = sc.motion ? sc.motion.rev : 0; }
  const charNames = (sc.characters || []).map((id) => ((state.summary.characters.find((c) => c.id === id) || {}).name) || id);
  const list = h('div', { class: 'stack', style: 'gap:8px', 'data-motion-beats': sc.id });
  const err = h('div', { class: 'issue err', style: 'display:none' });
  const draw = () => {
    list.replaceChildren(...draft.beats.map((b, k) => h('div', { class: 'beat-row card flat', 'data-beat': k },
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' },
        h('label', { class: 'small' }, '시작', h('input', { type: 'number', step: 0.5, min: 0, max: sc.durationSec, value: b.t0, style: 'width:70px', 'data-beat-t0': '', oninput: (e) => (b.t0 = Number(e.target.value)) })),
        h('label', { class: 'small' }, '끝', h('input', { type: 'number', step: 0.5, min: 0.5, max: sc.durationSec, value: b.t1, style: 'width:70px', 'data-beat-t1': '', oninput: (e) => (b.t1 = Number(e.target.value)) })), 's',
        h('select', { 'aria-label': '캐릭터', onchange: (e) => (b.character = e.target.value) }, charNames.concat(b.character && !charNames.includes(b.character) ? [b.character] : []).map((n) => h('option', { value: n, selected: b.character === n }, n))),
        h('button', { class: 'btn icon danger', type: 'button', 'aria-label': '비트 삭제', onclick: () => { draft.beats.splice(k, 1); draw(); } }, icon('trash'))),
      h('div', { class: 'grid two', style: 'gap:6px' }, [['emotion', '감정 (필수)'], ['body', '몸 동작'], ['gaze', '시선'], ['expression', '표정 (눈썹·눈꺼풀·입)'], ['camera', '카메라 (필요할 때만)']].map(([f, l]) => h('label', { class: 'field' }, h('span', { class: 'small' }, l), h('input', { type: 'text', value: b[f] || '', 'data-beat-field': f, oninput: (e) => (b[f] = e.target.value) })))))));
    if (!draft.beats.length) list.append(h('div', { class: 'small muted' }, '아직 비트가 없습니다. "템플릿 초안"(무료)으로 시작하거나 비트를 추가하세요. 모든 부위를 채울 필요는 없습니다.'));
  };
  draw();
  return h('div', { class: 'stack', style: 'gap:10px' },
    h('div', { class: 'small muted' }, `장면 길이 ${sc.durationSec}초 · 0.5초 단위. 자연스러운 정지·유지 구간을 남겨 두세요. 저장하면 영상 프롬프트 끝에 타임라인이 붙습니다.`),
    list, err,
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
      h('button', { class: 'btn sm ghost', type: 'button', 'data-motion-add': sc.id, onclick: () => { const last = draft.beats[draft.beats.length - 1]; const t0 = last ? Math.min(last.t1, sc.durationSec - 0.5) : 0; draft.beats.push({ t0, t1: Math.min(sc.durationSec, t0 + 0.5), character: charNames[0] || '', emotion: '', body: '', gaze: '', expression: '', camera: '' }); draw(); } }, icon('plus'), '비트 추가'),
      h('button', { class: 'btn sm ghost', type: 'button', 'data-motion-draft': sc.id, onclick: async () => { if (draft.beats.length && !(await confirmDialog({ title: '템플릿 초안으로 바꿀까요?', body: '현재 비트는 이전 버전으로 기록에 남습니다. 초안은 무료이며 AI를 호출하지 않습니다.', tone: 'clay' }))) return; delete state.draft[key]; act(() => api.post(`/api/episodes/${ep.id}/scenes/${sc.id}/motion/draft`), { ok: '템플릿 초안을 저장했습니다' }); } }, '템플릿 초안 (무료)'),
      h('button', { class: 'btn sm', type: 'button', 'data-motion-save': sc.id, onclick: async () => { err.style.display = 'none'; try { await api.put(`/api/episodes/${ep.id}/scenes/${sc.id}/motion`, { beats: draft.beats }); delete state.draft[key]; toast('움직임 계획을 저장했습니다'); await refresh(); } catch (e) { err.textContent = e.message; err.style.display = ''; toast(e.message, { error: true }); } } }, '움직임 저장')),
    (sc.motion && (sc.motion.history || []).length) ? h('div', { class: 'small muted' }, `이전 버전 ${(sc.motion.history || []).length}개가 기록에 있습니다.`) : null);
}

// ---------------- cuts + B-roll ----------------
function cutsPanel(ep, sc) {
  const ins = sc.inserts || [];
  const bro = sc.broll || [];
  return h('div', { class: 'stack', style: 'gap:10px' },
    h('div', { class: 'small muted' }, '컷은 이 장면의 영상을 크롭하는 편집이며 요금이 없습니다. B-roll은 별도의 정지 이미지로 먼저 만든 뒤 영상 편집에서 위에 얹습니다 (자동으로 유료 영상이 생성되지 않습니다).'),
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, h('button', { class: 'btn sm clay', type: 'button', onclick: () => addCutChooser(ep, sc) }, '+ 컷 추가'), h('button', { class: 'btn sm ghost', type: 'button', 'data-broll-suggest': '', onclick: () => act(() => api.post(`/api/episodes/${ep.id}/broll/suggest`), { ok: '제안을 만들었습니다 (무료, 승인 전)' }) }, 'B-roll 제안 (무료)')),
    ins.length ? h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, ins.map((x) => h('button', { type: 'button', class: 'chip', onclick: () => openCutEditor(ep, sc.id) }, `${x.preset || '컷'} ${x.startSec != null ? x.startSec + 's' : ''}`))) : h('div', { class: 'small muted' }, '영상 크롭 컷이 없습니다.'),
    h('div', { class: 'stack', style: 'gap:8px', 'data-broll-list': sc.id }, bro.length ? bro.map((b) => brollRow(ep, b)) : [h('div', { class: 'small muted' }, 'B-roll이 없습니다.')]));
}
function brollRow(ep, b) {
  const [stLabel, stKind] = BROLL_STATE[b.status] || [b.status, ''];
  const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', style: 'display:none', onchange: async (e) => { const f = e.target.files[0]; if (f) await act(() => api.upload(`/api/episodes/${ep.id}/broll/${b.id}/image`, f), { ok: '이미지를 올렸습니다 (검토 대기)' }); } });
  return h('div', { class: 'beat-row card flat', 'data-broll': b.id },
    h('div', { class: 'row between' }, h('b', null, `${b.id} · ${b.kindLabel || b.kind}`), h('div', { class: 'row', style: 'gap:6px' }, chip(stLabel, stKind), chip(b.asset === 'ready' ? '이미지 있음' : '이미지 필요', b.asset === 'ready' ? 'done' : 'attention'))),
    h('div', { class: 'small muted' }, `${b.insertAtSec}s 에 ${b.durationSec}초 · ${b.effect || '효과 미지정'}${b.note ? ' · ' + b.note : ''} · r${b.rev}`),
    b.imageUrl ? h('img', { src: b.imageUrl, alt: b.id, class: 'broll-thumb', loading: 'lazy', style: 'cursor:zoom-in', title: '크게 보기', 'data-broll-thumb': b.id, onclick: () => previewBroll(b) }) : null,
    b.assetId ? h('div', { class: 'small mono muted', 'data-broll-asset': b.id }, `${b.status === 'approved' ? '승인된 에셋' : '에셋'}: ${b.assetId}${b.imageGenerated ? ' · AI 생성' : ' · 업로드'}`) : null,
    b.imageError ? h('div', { class: 'issue err', 'data-broll-error': b.id }, b.imageError.message) : null,
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => brollEditor(ep, ep.scenes.find((s) => s.id === b.sceneId), b) }, '수정'),
      h('button', { class: 'btn sm clay', type: 'button', 'data-broll-generate': b.id, onclick: () => openBrollAi(ep, b) }, 'AI 이미지 생성'),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => fileIn.click() }, icon('upload'), '이미지 올리기'), fileIn,
      b.status === 'approved' ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => act(() => api.post(`/api/episodes/${ep.id}/broll/${b.id}/status`, { status: 'proposed' })) }, '승인 취소') : h('button', { class: 'btn sm sage', type: 'button', disabled: b.asset !== 'ready', title: b.asset !== 'ready' ? '이미지가 있어야 승인할 수 있습니다' : '', onclick: () => act(() => api.post(`/api/episodes/${ep.id}/broll/${b.id}/status`, { status: 'approved' }), { ok: 'B-roll을 승인했습니다' }) }, '승인'),
      b.status !== 'rejected' && b.status !== 'approved' ? h('button', { class: 'btn sm ghost', type: 'button', 'data-broll-reject': b.id, disabled: b.asset !== 'ready', onclick: () => act(() => api.post(`/api/episodes/${ep.id}/broll/${b.id}/status`, { status: 'rejected' }), { ok: '거절했습니다' }) }, '거절') : null,
      h('button', { class: 'btn sm danger', type: 'button', onclick: async () => { if (await confirmDialog({ title: `${b.id}를 삭제할까요?`, body: '라이브러리에서만 사라지고 기록은 보관됩니다.', tone: 'clay' })) act(() => api.del(`/api/episodes/${ep.id}/broll/${b.id}`), { ok: '삭제했습니다' }); } }, '삭제')));
}
function addCutChooser(ep, sc) {
  modal((close) => h('div', { class: 'stack' }, h('h2', null, '컷 추가'),
    h('p', { class: 'small muted', style: 'margin:0' }, `${sc.id} · ${sc.title_ko || sc.title} — 어떤 컷을 넣을까요?`),
    h('button', { class: 'btn', type: 'button', 'data-cut-kind': 'crop', onclick: () => { close(); openCutEditor(ep, sc.id); } }, '영상 크롭 컷 (클로즈업·리액션, 요금 없음)'),
    h('button', { class: 'btn ghost', type: 'button', 'data-cut-kind': 'broll', onclick: () => { close(); brollEditor(ep, sc, null); } }, 'B-roll (별도 정지 이미지, 영상 편집에서 얹음)'),
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', type: 'button', onclick: close }, '취소'))));
}
function brollEditor(ep, sc, b) {
  const f = { id: b && b.id, sceneId: sc.id, kind: b ? b.kind : 'broll', insertAtSec: b ? b.insertAtSec : 0, durationSec: b ? b.durationSec : 1, effect: b ? b.effect : '', note: b ? b.note : '' };
  modal((close) => h('div', { class: 'stack' }, h('h2', null, b ? 'B-roll 수정' : 'B-roll 추가'),
    b && b.status === 'approved' ? h('div', { class: 'banner warn' }, '승인된 B-roll을 수정하면 다시 검토해야 합니다.') : null,
    h('div', { class: 'small muted' }, `장면 ${sc.id} 길이 ${sc.durationSec}초 — 위치+길이가 장면 길이를 넘을 수 없고, 장면은 자동으로 늘어나지 않습니다.`),
    h('label', { class: 'field' }, h('span', { class: 'small' }, '종류'), h('select', { onchange: (e) => (f.kind = e.target.value) }, BROLL_KIND.map(([v, l]) => h('option', { value: v, selected: f.kind === v }, l)))),
    h('div', { class: 'row' }, h('label', { class: 'small' }, '위치(초)', h('input', { type: 'number', step: 0.5, min: 0, value: f.insertAtSec, style: 'width:84px', 'data-broll-at': '', oninput: (e) => (f.insertAtSec = Number(e.target.value)) })), h('label', { class: 'small' }, '길이(초)', h('input', { type: 'number', step: 0.5, min: 0.5, value: f.durationSec, style: 'width:84px', 'data-broll-dur': '', oninput: (e) => (f.durationSec = Number(e.target.value)) }))),
    h('label', { class: 'field' }, h('span', { class: 'small' }, '의도한 시각 효과'), h('input', { type: 'text', value: f.effect, oninput: (e) => (f.effect = e.target.value) })),
    h('label', { class: 'field' }, h('span', { class: 'small' }, '메모'), h('input', { type: 'text', value: f.note, oninput: (e) => (f.note = e.target.value) })),
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', type: 'button', onclick: close }, '취소'), h('button', { class: 'btn', type: 'button', 'data-broll-save': '', onclick: async () => { try { await api.post(`/api/episodes/${ep.id}/broll`, f); close(); toast('저장했습니다'); await refresh(); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); } } }, '저장'))));
}

// ---------------- whole-storyboard tools (collapsed) ----------------
function projectPanel(ep, sbOk) {
  const ready = ep.scenes.filter((s) => s.prompt && s.prompt.video).length;
  const approvedImgs = ep.scenes.filter((s) => s.startImageInfo && !s.startImageInfo.error && s.startImageInfo.approved).length;
  return h('details', { class: 'card', 'data-sb-project': '' }, h('summary', { style: 'cursor:pointer;min-height:40px;display:flex;align-items:center;gap:8px' }, h('b', null, '스토리보드 전체'), h('span', { class: 'small muted' }, `프롬프트 ${ready}/${ep.scenes.length} · 승인된 이미지 ${approvedImgs}/${ep.scenes.length}${sbOk ? ' · 승인됨' : ''}`)),
    h('div', { class: 'stack', style: 'gap:12px;margin-top:12px' },
      h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
        h('button', { class: 'btn ghost', type: 'button', onclick: () => act(() => api.post(`/api/episodes/${ep.id}/storyboard/prompts`, { force: false }), { ok: '비어 있는 장면의 프롬프트를 만들었습니다 (수정한 프롬프트는 그대로 둠)' }) }, '템플릿으로 만들기 (무료)'),
        h('button', { class: 'btn', type: 'button', disabled: !ep.derived.scriptApproved, onclick: () => aiPrompts(ep, null) }, icon('play'), 'AI로 프롬프트 만들기'),
        h('button', { class: 'btn clay', type: 'button', disabled: !ep.derived.scriptApproved, title: '비용 확인 후에만 생성됩니다', onclick: () => makeStartImages(ep, [], { after: refresh }) }, icon('plus'), '모든 장면 시작 이미지 만들기'),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => { try { const r = await api.get('/api/prompts/videoMaster'); await copyText(r.text, '영상 마스터 프롬프트를 복사했습니다'); } catch (e) { toast(e.message, { error: true }); } } }, icon('copy'), '영상 마스터 프롬프트 복사')),
      (() => { const strip = productRefStrip(ep); return strip || null; })(),
      imageDevCard(ep),
      h('div', { class: 'row between', style: 'gap:8px;flex-wrap:wrap' }, h('div', { class: 'small muted' }, '승인한 프롬프트와 시작 이미지로만 클립을 생성할 수 있습니다. 이후 수정하면 승인이 무효가 됩니다.'),
        h('div', { class: 'row' }, sbOk ? chip('승인됨', 'done') : null, h('button', { class: 'btn sage', type: 'button', disabled: sbOk || !ep.derived.scriptApproved || ready < ep.scenes.length, onclick: async () => {
          if (await confirmDialog({ title: '스토리보드와 프롬프트를 승인할까요?', body: '승인한 프롬프트와 시작 이미지로만 클립을 생성할 수 있습니다. 이후 수정하면 승인이 무효가 됩니다.' })) act(() => api.post(`/api/episodes/${ep.id}/storyboard/approve`), { ok: '스토리보드를 승인했습니다' });
        } }, '스토리보드 승인')))));
}

async function reorder(ep, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= ep.scenes.length) return toast('더 이상 이동할 수 없습니다');
  const order = ep.scenes.map((s) => ({ id: s.id }));
  [order[i], order[j]] = [order[j], order[i]];
  await act(() => api.put(`/api/episodes/${ep.id}/script`, { scenes: order, note: '장면 순서 변경' }), { ok: '순서를 바꿨습니다 (대본 승인이 필요할 수 있습니다)' });
}


const SECTION_LABEL = { camera: '카메라', actions: '캐릭터 동작', environment: '환경', lighting: '조명·스타일', continuity: '연속성', duration: '길이', aspect: '화면비', cast: '등장 인원', identity: '캐릭터 외형' };
function sectionsView(sections) {
  return h('details', { class: 'small', style: 'margin-top:6px' }, h('summary', { style: 'cursor:pointer;color:var(--muted)' }, '프롬프트 구성 요소 보기'),
    h('div', { class: 'stack', style: 'gap:4px;margin-top:6px' }, Object.keys(SECTION_LABEL).filter((k) => sections[k]).map((k) => h('div', null, h('b', null, SECTION_LABEL[k] + ': '), sections[k]))));
}

let autoTried = '';
function autoBuild(ep) {
  // Free + deterministic. Runs once per episode view when an approved script has scenes without any prompt.
  const missing = ep.scenes.filter((s) => !s.prompt).map((s) => s.id);
  const key = ep.id + ':' + missing.join();
  if (!ep.derived.scriptApproved || !missing.length || autoTried === key) return;
  autoTried = key;
  act(() => api.post(`/api/episodes/${ep.id}/storyboard/prompts`, { sceneIds: missing, force: false }));
}

async function aiPrompts(ep, sc) {
  const g = state.summary.providers.gemini;
  const scenes = sc ? [sc] : ep.scenes;
  if (!g.configured) {
    toast('Gemini API 키가 서버에 설정되어 있지 않습니다.', { error: true, recovery: 'renderer/.env 에 GEMINI_API_KEY 를 넣고 Studio를 다시 시작하세요. 키 없이는 "템플릿으로 만들기"(무료)를 쓸 수 있습니다.' });
    return;
  }
  const missingRef = scenes.filter((s) => s.characters.some((cid) => !(state.summary.characters.find((c) => c.id === cid) || { references: [] }).references.some((r) => r.approved)));
  const edited = scenes.filter((s) => s.prompt && s.prompt.edited);
  let overwrite = false;
  const ok = await confirmDialog({
    title: sc ? sc.id + ' 프롬프트를 AI로 만들까요?' : '모든 장면의 프롬프트를 AI로 만들까요?',
    body: h('div', { class: 'stack small' },
      h('div', null, `Gemini(${g.model})에 승인된 대본·장면 설명과 선택된 캐릭터의 승인된 참조 이미지(이미지 내용 자체)를 보냅니다. Gemini 호출은 요금이 청구될 수 있으며 Studio는 가격을 알지 못합니다.`),
      missingRef.length ? h('div', { class: 'issue err' }, '승인된 참조 이미지가 없는 장면: ' + missingRef.map((s) => s.id).join(', ') + ' — 먼저 설정에서 참조를 승인하세요.') : null,
      edited.length ? h('label', { style: 'display:flex;gap:8px;align-items:center' }, h('input', { type: 'checkbox', onchange: (e) => (overwrite = e.target.checked) }), `직접 수정한 프롬프트(${edited.map((s) => s.id).join(', ')})도 덮어쓰기`) : null,
      h('div', { class: 'muted' }, '결과가 캐릭터 수·제품 주장·시트 재현 금지 규칙을 어기면 저장하지 않고 기존 프롬프트를 그대로 둡니다.')),
    confirm: 'AI로 만들기', tone: 'clay',
  });
  if (!ok) return;
  if (sc) delete state.draft['sb:' + sc.id]; else ep.scenes.forEach((s) => delete state.draft['sb:' + s.id]);
  const r = await act(() => api.post(`/api/episodes/${ep.id}/storyboard/prompts`, { sceneIds: sc ? [sc.id] : undefined, mode: 'gemini', confirmAi: true, force: overwrite }), { ok: 'AI 프롬프트를 만들었습니다' });
  return r;
}

