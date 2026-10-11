import { h, chip, modal, fmtUsd, toast } from '../ui.js';
import { state, go, selectEpisode, act } from '../state.js';
import { api } from '../api.js';
import { pageHead, modeBanner } from './common.js';

export function episodes() {
  const s = state.summary;
  const wrap = h('div', { class: 'stack', style: 'gap:22px' });
  wrap.append(pageHead('Episodes', '에피소드', '제품과 연결된 에피소드 라이브러리 — 초안, 제작 중, 게시 완료를 한곳에서 관리합니다.', h('button', { class: 'btn', onclick: newEpisode }, '+ 새 에피소드 (승인된 컨셉에서)')));
  wrap.append(h('div', { class: 'grid three' }, s.episodes.map((e) => {
    const done = e.steps.filter((x) => x.state === 'done').length;
    const status = e.published ? ['게시 완료', 'done'] : e.finalApproved ? ['최종 승인', 'done'] : done > 2 ? ['제작 중', 'attention'] : ['초안', ''];
    return h('article', { class: 'card', style: 'padding:0;overflow:hidden;display:grid;grid-template-columns:120px 1fr' },
      h('div', { class: 'thumb', style: 'border-radius:0;border:0;border-right:1px solid var(--line)' }, e.thumb ? h('video', { src: e.thumb, muted: true, playsinline: true, preload: 'metadata' }) : h('div', { style: 'height:100%;display:grid;place-items:center;color:var(--muted);font-size:12px;text-align:center;padding:8px' }, '미리보기 없음')),
      h('div', { class: 'stack', style: 'padding:16px;gap:8px' },
        h('div', { class: 'row between' }, h('span', { class: 'eyebrow' }, e.id), chip(status[0], status[1])),
        h('h3', { style: 'font-size:17px' }, e.title),
        h('div', { class: 'small muted' }, e.productName),
        e.concept && e.concept.linked ? h('div', { class: 'small' }, chip(e.concept.ok ? '컨셉 ' + e.concept.conceptId + ' r' + e.concept.revision : e.concept.state === 'script_stale' ? '컨셉 변경 · 대본 재생성 필요' : '컨셉 승인 필요', e.concept.ok ? 'done' : 'attention')) : e.concept && e.concept.legacy ? h('div', { class: 'small' }, chip('스토리 랩 이전', 'mock')) : null,
        h('div', { class: 'mini-dots' }, e.steps.map((st) => h('i', { class: st.state, title: st.label }))),
        h('div', { class: 'small muted' }, `${e.scenes}장면 · 약 ${Math.round(e.totalPlannedSec)}초 · 지출 ${fmtUsd(e.spentUsd)}`),
        h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: async () => { await selectEpisode(e.id); go('overview'); } }, '열기'), h('button', { class: 'btn sm ghost', onclick: async () => { await selectEpisode(e.id); go('script'); } }, '대본'))));
  })));
  return wrap;
}

/** Episodes start from an APPROVED story concept (Product → Story Lab → Episode). */
async function newEpisode() {
  const prods = (state.summary.storylab || []).filter((x) => x.approved > 0);
  let loaded = [];
  try { loaded = await Promise.all(prods.map(async (x) => ({ p: x, lab: await api.get('/api/storylab/' + x.productId) }))); } catch (e) { return toast(e.message, { error: true }); }
  const choices = loaded.flatMap(({ p, lab }) => lab.concepts.filter((c) => c.approved).map((c) => ({ productId: p.productId, name: p.name, c })));
  let pick = choices[0] || null;
  modal((close) => h('div', { class: 'stack' },
    h('h2', null, '새 에피소드'),
    choices.length ? h('p', { class: 'muted small', style: 'margin:0' }, '승인된 스토리 컨셉을 선택하세요. 제품의 확인된 사실이 에피소드로 복사되고, 컨셉과의 연결이 기록됩니다.')
      : h('div', { class: 'banner warn' }, h('div', null, h('b', null, '승인된 스토리 컨셉이 없습니다'), '제품 → 스토리 랩에서 컨셉을 생성하고 승인한 뒤 에피소드를 만들 수 있습니다. ', h('a', { href: '#/storylab', onclick: close }, 'Story Lab으로'))),
    choices.map((x, i) => h('label', { class: 'card tight row', style: 'gap:10px;cursor:pointer;flex-wrap:nowrap' }, h('input', { type: 'radio', name: 'concept', checked: i === 0, onchange: () => (pick = x) }), h('div', null, h('b', null, x.c.title), h('div', { class: 'small muted' }, `${x.productId} · ${x.name} · ${x.c.id} r${x.c.revision}${x.c.sample ? ' · 샘플' : ''}`)))),
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: close }, '취소'), h('button', { class: 'btn', disabled: !choices.length, onclick: async () => {
      const r = await act(() => api.post('/api/episodes', { productId: pick.productId, conceptId: pick.c.id }), { ok: '에피소드를 만들었습니다' });
      if (r) { close(); await selectEpisode(r.id); go('script'); }
    } }, '이 컨셉으로 만들기'))));
}

function field(label, type, ph, on) {
  return h('div', { class: 'field' }, h('label', null, label), h('input', { type, placeholder: ph, oninput: (e) => on(e.target.value) }));
}
