import { h, chip, icon, copyText, confirmDialog, toast } from '../ui.js';
import { state, act, requireEpisode } from '../state.js';
import { api } from '../api.js';
import { pageHead, pipelineBar, noEpisode, episodePicker, lockedNotice, charAvatar } from './common.js';

export function storyboard() {
  const ep = requireEpisode();
  if (!ep) return noEpisode();
  const chars = state.summary.characters;
  const sbOk = ep.derived.storyboardApproved;
  const wrap = h('div', { class: 'stack', style: 'gap:20px' });
  wrap.append(pageHead('Storyboard', '스토리보드', '장면별 시각 설명·캐릭터·시작 이미지·영상 프롬프트를 정리하고 승인합니다. 승인 전에는 어떤 유료 생성도 시작되지 않습니다.', episodePicker(),
    h('button', { class: 'btn ghost', onclick: () => act(() => api.post(`/api/episodes/${ep.id}/storyboard/prompts`, { force: false }), { ok: '비어 있는 장면의 프롬프트를 만들었습니다 (수정한 프롬프트는 그대로 둠)' }) }, icon('refresh'), '템플릿으로 만들기 (무료)'),
    h('button', { class: 'btn', disabled: !ep.derived.scriptApproved, title: ep.derived.scriptApproved ? '' : '대본 승인 후 사용할 수 있습니다', onclick: () => aiPrompts(ep, null) }, icon('play'), 'AI로 프롬프트 만들기')));
  wrap.append(pipelineBar(ep));
  autoBuild(ep);
  if (!ep.derived.scriptApproved) wrap.append(lockedNotice('대본이 승인되어야 스토리보드를 승인할 수 있습니다.', 'script', '대본으로 이동'));
  if (ep.derived.storyboardChangedSinceApproval) wrap.append(h('div', { class: 'banner warn' }, h('div', null, h('b', null, '승인 후 스토리보드가 수정되었습니다'), '다시 확인하고 승인하세요. 이전 승인으로는 유료 생성을 시작할 수 없습니다.')));

  const list = h('div', { class: 'stack', style: 'gap:18px' });
  ep.scenes.forEach((sc, i) => list.append(sceneCard(ep, sc, i, chars)));
  wrap.append(list);

  const ready = ep.scenes.filter((s) => s.prompt && s.prompt.video).length;
  wrap.append(h('div', { class: 'sticky-bar' },
    h('div', null, h('b', null, sbOk ? '스토리보드 승인됨' : '스토리보드 승인'), h('div', { class: 'small', style: 'color:#cdbca3' }, `프롬프트 ${ready}/${ep.scenes.length}개 준비됨 · 장면 구성은 자유롭게 수정할 수 있습니다`)),
    h('div', { class: 'row' }, sbOk ? chip('승인됨', 'done') : null, h('button', { class: 'btn sage', disabled: sbOk || !ep.derived.scriptApproved || ready < ep.scenes.length, onclick: async () => {
      if (await confirmDialog({ title: '스토리보드와 프롬프트를 승인할까요?', body: '승인한 프롬프트와 시작 이미지로만 클립을 생성할 수 있습니다. 이후 수정하면 승인이 무효가 됩니다.' })) act(() => api.post(`/api/episodes/${ep.id}/storyboard/approve`), { ok: '스토리보드를 승인했습니다' });
    } }, '승인'))));
  return wrap;
}

function sceneCard(ep, sc, i, chars) {
  const key = 'sb:' + sc.id;
  const d = (state.draft[key] = state.draft[key] || { visual: sc.visual, characters: sc.characters.slice(), showsProduct: sc.showsProduct, video: sc.prompt ? sc.prompt.video : '', negative: sc.prompt ? sc.prompt.negative : '', baseVideo: sc.prompt ? sc.prompt.video : '', baseNegative: sc.prompt ? sc.prompt.negative : '' });
  // The draft only holds the operator's UNSAVED typing. If the server's prompt changed (built, regenerated, restored)
  // and the operator has not typed anything, show the server's version — never a stale empty draft.
  const serverVideo = sc.prompt ? sc.prompt.video : '';
  const serverNeg = sc.prompt ? sc.prompt.negative : '';
  if (d.video === d.baseVideo && d.baseVideo !== serverVideo) { d.video = serverVideo; d.baseVideo = serverVideo; }
  if (d.negative === d.baseNegative && d.baseNegative !== serverNeg) { d.negative = serverNeg; d.baseNegative = serverNeg; }
  const img = sc.startImageInfo;
  const refs = [];
  sc.characters.forEach((cid) => { const c = chars.find((x) => x.id === cid); if (c) c.references.forEach((r) => refs.push({ c, r })); });
  const thumb = h('div', { class: 'thumb' }, img && !img.error ? h('img', { src: img.url, alt: '시작 이미지' }) : h('div', { style: 'height:100%;display:grid;place-items:center;text-align:center;padding:10px;font-size:12px;color:var(--muted)' }, '시작 이미지 없음'),
    h('span', { class: 'tag' }, img && !img.error ? (img.placeholder ? chip('데모 임시', 'mock') : img.approved ? chip('승인된 이미지', 'done') : chip('미승인', 'attention')) : chip('필요', 'err')));
  const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', style: 'display:none', onchange: async (e) => { const f = e.target.files[0]; if (f) await act(() => api.upload(`/api/episodes/${ep.id}/scenes/${sc.id}/start-frame`, f), { ok: '시작 프레임을 올렸습니다 — 승인해야 사용할 수 있습니다' }); } });
  const promptEl = h('textarea', { rows: 9, 'aria-label': '영상 프롬프트', oninput: (e) => (d.video = e.target.value) }, d.video);
  const negEl = h('textarea', { rows: 2, 'aria-label': '네거티브 프롬프트', oninput: (e) => (d.negative = e.target.value) }, d.negative);
  const cLines = ep.lines.filter((l) => l.sceneId === sc.id);
  return h('section', { class: 'scene' + (sc.clips.approvedVersion ? ' done' : '') },
    h('div', { class: 'thumb-col stack', style: 'gap:10px' }, thumb,
      img && !img.error && img.url.includes('/startframe/') && !img.approved ? h('button', { class: 'btn sm sage', onclick: () => act(() => api.post(`/api/episodes/${ep.id}/scenes/${sc.id}/start-frame/approve`, { approved: true })) }, '이 프레임 승인') : null,
      h('div', { class: 'row', style: 'gap:6px' }, h('button', { class: 'btn sm ghost', onclick: () => fileIn.click() }, icon('upload'), '프레임 올리기'), fileIn),
      refs.length ? h('select', { 'aria-label': '캐릭터 참조 이미지 선택', onchange: (e) => { if (!e.target.value) return; const [cid, rid] = e.target.value.split('|'); act(() => api.put(`/api/episodes/${ep.id}/scenes/${sc.id}/start-image`, { characterId: cid, refId: rid })); } }, h('option', { value: '' }, '참조 이미지 선택…'), refs.map(({ c, r }) => h('option', { value: c.id + '|' + r.id }, c.name + ' · ' + r.label + (r.approved ? '' : ' (미승인)')))) : h('div', { class: 'small muted' }, '설정 → 캐릭터에서 참조 이미지를 올리세요.')),
    h('div', { class: 'stack', style: 'gap:12px;min-width:0' },
      h('div', { class: 'row between' }, h('div', null, h('div', { class: 'no' }, sc.id + ' · 비트 ' + sc.beat), h('h2', null, sc.title)), h('div', { class: 'row' }, chip(sc.durationSec + '초 → 클립 ' + sc.clipSec + '초'), sc.showsProduct ? chip('제품 등장', 'attention') : null, sc.prompt && sc.prompt.edited ? chip('프롬프트 수정됨') : null)),
      h('div', { class: 'row' }, h('span', { class: 'label' }, '등장 캐릭터'), chars.map((c) => h('label', { class: 'chip', style: 'cursor:pointer' }, h('input', { type: 'checkbox', checked: d.characters.includes(c.id), onchange: (e) => { d.characters = e.target.checked ? [...new Set([...d.characters, c.id])] : d.characters.filter((x) => x !== c.id); } }), c.name)), h('label', { class: 'chip', style: 'cursor:pointer' }, h('input', { type: 'checkbox', checked: d.showsProduct, onchange: (e) => (d.showsProduct = e.target.checked) }), '제품이 보임')),
      h('div', { class: 'field' }, h('label', null, '시각 설명'), h('textarea', { rows: 3, oninput: (e) => (d.visual = e.target.value) }, d.visual)),
      cLines.length ? h('div', { class: 'small' }, h('span', { class: 'label' }, '연결된 대사 '), cLines.map((l) => h('span', { class: 'chip', style: 'margin:2px 4px 2px 0' }, (chars.find((c) => c.id === l.speaker) || {}).name + ': ' + l.en.slice(0, 30)))) : h('div', { class: 'small muted' }, '이 장면에는 대사가 없습니다 (액션 장면).'),
      h('div', { class: 'row' }, h('button', { class: 'btn sm ghost', onclick: async () => {
        const scenes = ep.scenes.map((s) => (s.id === sc.id ? { id: s.id, visual: d.visual, characters: d.characters, showsProduct: d.showsProduct } : { id: s.id }));
        await act(() => api.put(`/api/episodes/${ep.id}/script`, { scenes, note: sc.id + ' 시각 설정' }), { ok: '장면을 저장했습니다' });
      } }, '장면 저장'), h('button', { class: 'btn sm ghost', title: '위로', onclick: () => reorder(ep, i, -1) }, icon('up')), h('button', { class: 'btn sm ghost', title: '아래로', onclick: () => reorder(ep, i, 1) }, icon('down'))),
      h('hr', { class: 'divider', style: 'margin:4px 0' }),
      h('div', { class: 'field' }, h('div', { class: 'row between' }, h('label', null, 'Google Flow / Muapi 영상 프롬프트'), h('div', { class: 'row', style: 'gap:6px' },
        h('button', { class: 'btn sm ghost', onclick: () => copyText(promptEl.value, sc.id + ' 프롬프트를 복사했습니다') }, icon('copy'), 'Copy Prompt'),
        h('button', { class: 'btn sm ghost', disabled: !ep.derived.scriptApproved, onclick: () => aiPrompts(ep, sc) }, icon('play'), 'AI로 다시 만들기'),
        h('button', { class: 'btn sm ghost', onclick: async () => { if (!sc.prompt || !sc.prompt.edited || await confirmDialog({ title: '수정한 프롬프트를 덮어쓸까요?', body: '이 장면의 프롬프트를 템플릿으로 다시 만듭니다. 직접 수정한 내용은 사라집니다(버전 기록에는 남지 않습니다).', tone: 'clay', confirm: '다시 만들기' })) { delete state.draft[key]; await act(() => api.post(`/api/episodes/${ep.id}/storyboard/prompts`, { sceneIds: [sc.id], force: true }), { ok: '프롬프트를 다시 만들었습니다' }); } } }, icon('refresh'), '다시 만들기'),
        h('button', { class: 'btn sm', onclick: async () => { const r = await act(() => api.put(`/api/episodes/${ep.id}/scenes/${sc.id}/prompt`, { video: promptEl.value, negative: negEl.value }), { ok: '프롬프트를 저장했습니다' }); if (r) delete state.draft[key]; } }, '프롬프트 저장'))),
        sc.prompt ? h('div', { class: 'row', style: 'gap:6px;margin:2px 0' }, chip(sc.prompt.source === 'gemini' ? 'Gemini 생성' : '템플릿', sc.prompt.source === 'gemini' ? 'done' : 'mock'), sc.prompt.edited ? chip('직접 수정함', 'attention') : null, sc.prompt.stale ? chip('등장인물이 바뀜 — 프롬프트 다시 만들기 필요', 'err') : null, sc.usesSheet ? chip('캐릭터 시트 규칙 포함', 'done') : null, sc.characters.length ? chip('등장 ' + sc.characters.length + '명 고정', '') : chip('캐릭터 없음', '')) : null,
        sc.prompt ? promptEl : h('div', { class: 'empty' }, '아직 프롬프트가 없습니다. 위의 "템플릿으로 만들기"를 누르세요.'),
        sc.prompt && sc.prompt.sections ? sectionsView(sc.prompt.sections) : null,
        sc.castWarnings && sc.castWarnings.length ? h('div', { class: 'issue err' }, sc.castWarnings.map((w) => w.message).join(' ')) : null,
        sc.promptWarnings.length ? h('div', { class: 'issue err' }, '확인되지 않은 제품 주장: ' + sc.promptWarnings.join(', ')) : null),
      sc.prompt ? h('div', { class: 'field' }, h('label', null, 'Negative prompt'), negEl) : null));
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
