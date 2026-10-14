// Animation Studio steps before the paid generation: 2 voice → 3 sound effects → 4 readiness checklist (lip-sync choice included).
// Nothing here spends money. The generate button in the workspace stays blocked until the checklist is complete (the server enforces the same gate).
import { h, chip, confirmDialog } from '../ui.js';
import { act } from '../state.js';
import { api } from '../api.js';
import { audioPanelBody, flowOf } from './scene-flow.js';
import { sfxEditor } from './sfx-editor.js';

const SFX_LABEL = { undecided: '결정 필요', approved: '효과음 계획 승인됨', none: '효과음 필요 없음 (확인됨)', stale: '효과음이 바뀜 · 다시 결정' };
const SFX_KIND = { undecided: 'attention', approved: 'done', none: 'done', stale: 'err' };

function step(n, title, status, body, attrs) {
  return h('details', Object.assign({ class: 'scene-section', open: true }, attrs || {}), h('summary', null, h('span', { class: 'section-title' }, `${n}. ${title}`), status),
    h('div', { class: 'section-body stack', style: 'gap:8px' }, body));
}

export function gatesPanel(ep, sc) {
  const f = flowOf(ep, sc.id);
  if (!f || !f.gate) return null;
  const g = f.gate;
  const base = `/api/episodes/${ep.id}/scenes/${sc.id}`;
  const sf = g.sfx;
  const hasSfx = (ep.sfx || []).some((x) => x.sceneId === sc.id);

  const audioStep = step(2, '대사 음성', chip(g.items.find((i) => i.key === 'audio').ok ? '완료' : '승인 필요', g.items.find((i) => i.key === 'audio').ok ? 'done' : 'attention'), audioPanelBody(ep, sc), { 'data-gate-step': 'audio' });

  const sfxButtons = h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
    h('button', { class: 'btn sm sage', type: 'button', 'data-sfx-approve-plan': sc.id, disabled: !hasSfx || sf.state === 'approved', title: hasSfx ? '' : '효과음을 추가한 뒤 승인할 수 있습니다', onclick: () => act(() => api.post(base + '/sfx-plan', { mode: 'plan' }), { ok: '효과음 계획을 승인했습니다' }) }, '효과음 계획 승인'),
    h('button', { class: 'btn sm ghost', type: 'button', 'data-sfx-none': sc.id, disabled: hasSfx || sf.state === 'none', title: hasSfx ? '지정된 효과음이 있습니다 — 지우거나 계획을 승인하세요' : '', onclick: async () => { if (await confirmDialog({ title: '이 장면에 효과음이 필요 없나요?', body: '효과음 없이 영상을 만듭니다. 나중에 효과음을 추가하면 이 결정은 무효가 됩니다.' })) act(() => api.post(base + '/sfx-plan', { mode: 'none' }), { ok: '효과음 필요 없음으로 확인했습니다' }); } }, '효과음 필요 없음'),
    ['approved', 'none', 'stale'].includes(sf.state) ? h('button', { class: 'btn sm ghost', type: 'button', 'data-sfx-revoke': sc.id, onclick: () => act(() => api.del(base + '/sfx-plan'), { ok: '결정을 취소했습니다' }) }, '결정 취소') : null);
  const sfxStep = step(3, '효과음', chip(SFX_LABEL[sf.state], SFX_KIND[sf.state]), h('div', { class: 'stack', style: 'gap:8px' }, sfxEditor(ep, sc), sfxButtons,
    sf.state === 'stale' ? h('div', { class: 'issue err' }, '효과음 목록이 승인/결정 이후 바뀌었습니다. 다시 결정하세요.') : null,
    h('div', { class: 'small muted' }, '효과음은 검색·업로드·내장음에서 고릅니다(AI 생성 아님). 소리를 선택해 시작 시각·볼륨을 정하고 미리 들은 뒤 계획을 승인하세요.')), { 'data-gate-step': 'sfx' });

  const lp = g.lipSync;
  const lipBody = lp.state === 'na' ? h('div', { class: 'small muted' }, lp.note)
    : h('div', { class: 'stack', style: 'gap:6px' }, h('div', { class: 'small' }, lp.note),
      lp.state === 'undecided' ? h('button', { class: 'btn sm', type: 'button', 'data-lipsync-ack': sc.id, onclick: async () => { if (await confirmDialog({ title: '오디오를 나중에 합성할까요?', body: '선택한 영상 모델은 오디오에 맞춰 입을 움직이지 않습니다. 승인된 최종 오디오를 영상에 입혀 합성하며, 입 모양 동기화는 되지 않습니다. 검증된 립싱크 제공자가 등록되면 별도 단계로 추가됩니다.' })) act(() => api.post(base + '/lipsync'), { ok: '확인했습니다' }); } }, '립싱크 없이 오디오를 나중에 합성함 (확인)')
        : lp.state === 'mix-only' ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => act(() => api.del(base + '/lipsync'), { ok: '확인을 취소했습니다' }) }, '확인 취소') : null);
  const lipStep = step('3b', '립싱크', chip({ na: '해당 없음', model: '모델이 처리', 'mix-only': '나중에 합성(확인됨)', undecided: '확인 필요' }[lp.state], lp.state === 'undecided' ? 'attention' : 'done'), lipBody, { 'data-gate-step': 'lipsync' });

  const list = h('ul', { class: 'stack', style: 'gap:4px;margin:0;padding-left:18px', 'data-gate-checklist': sc.id }, g.items.map((i) => h('li', { 'data-gate-item': i.key, 'data-gate-ok': i.ok ? '1' : '0', style: i.ok ? '' : 'color:var(--clay)' }, (i.ok ? '✓ ' : '✗ ') + i.label, i.detail && i.key !== 'audio' && i.key !== 'sfx' ? h('span', { class: 'small muted' }, ' — ' + i.detail) : null)));
  const checkStep = step(4, '생성 준비 점검', chip(g.ready ? '모두 준비됨' : `${g.items.filter((i) => !i.ok).length}개 남음`, g.ready ? 'done' : 'attention'), h('div', { class: 'stack', style: 'gap:6px' }, list,
    h('div', { class: 'small muted' }, g.ready ? '아래에서 "비용 확인(무료)" 후 명시적으로 승인해야 유료 생성이 시작됩니다.' : '남은 항목을 끝내기 전에는 생성을 시작할 수 없습니다.')), { 'data-gate-step': 'checklist', open: true });

  return h('section', { class: 'card stack', style: 'gap:10px', 'data-anim-gates': sc.id, 'data-gates-ready': g.ready ? '1' : '0' }, h('h3', { style: 'margin:0' }, '생성 전 단계'), audioStep, sfxStep, lipStep, checkStep);
}
