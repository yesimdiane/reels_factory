// Storyboard "캐릭터 참조 이미지": the approved Character Library images that stand for the characters in this scene.
// Shows the real saved thumbnails (never a placeholder or substitute), the asset id and status, a full-size viewer and a per-scene change.
// Free: choosing a reference calls no provider. A generated start frame made from other references is flagged as out of date.
import { h, chip, modal, toast } from '../ui.js';
import { act } from '../state.js';
import { api } from '../api.js';

const STATUS = { approved: ['승인됨', 'done'], unapproved: ['승인 필요', 'attention'], placeholder: ['임시 이미지 — 실제 참조 필요', 'err'], missing: ['참조 없음', 'err'], file_missing: ['파일 없음', 'err'] };

function viewFull(r) {
  modal((close) => h('div', { class: 'stack', style: 'gap:10px;align-items:center' },
    h('h2', { style: 'margin:0' }, `${r.name} · ${r.assetId}`),
    h('img', { src: r.url, alt: r.name + ' 참조 이미지 원본', style: 'max-width:100%;max-height:70vh;border-radius:12px' }),
    h('button', { class: 'btn ghost', type: 'button', onclick: close }, '닫기')), { wide: true });
}

function changer(ep, sc, r) {
  modal((close) => h('div', { class: 'stack', style: 'gap:12px' },
    h('h2', { style: 'margin:0' }, `${r.name} 참조 이미지 변경`),
    h('div', { class: 'small muted' }, '캐릭터 라이브러리의 승인된 이미지 중에서 이 장면에서만 쓸 이미지를 고릅니다. 라이브러리의 원본은 바뀌지 않습니다.'),
    r.options.length ? h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap' }, r.options.map((o) => h('button', { type: 'button', class: 'ref-pick' + (o.refId === r.refId ? ' on' : ''), 'data-ref-option': o.assetId, title: o.label, onclick: async () => { close(); await act(async () => { await api.put(`/api/episodes/${ep.id}/scenes/${sc.id}/character-refs/${r.characterId}`, { refId: o.refId }); return null; }, { ok: `${r.name}: ${o.label} 로 바꿨습니다 (시작 프레임은 다시 만들어야 반영됩니다)` }); } },
      h('img', { src: o.url, alt: o.label, style: 'width:96px;height:96px;object-fit:cover;border-radius:10px;display:block' }), h('div', { class: 'small' }, o.label + (o.primary ? ' · 기본' : ''))))) : h('div', { class: 'issue err' }, `Character reference missing: ${r.name}. Please upload or select a reference image.`),
    h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
      r.override ? h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => { close(); await act(async () => { await api.del(`/api/episodes/${ep.id}/scenes/${sc.id}/character-refs/${r.characterId}`); return null; }, { ok: '기본 참조로 되돌렸습니다' }); } }, '기본 참조로 되돌리기') : null,
      h('a', { class: 'btn sm ghost', href: '#/characters', onclick: close }, '캐릭터 라이브러리에서 올리기 · 승인'),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: close }, '닫기'))));
}

export function charRefsPanelBody(ep, sc) {
  const refs = sc.charRefs || [];
  if (!refs.length) return h('div', { class: 'small muted' }, '이 장면에 등장하는 캐릭터가 없습니다.');
  return h('div', { class: 'stack', style: 'gap:10px', 'data-char-refs': sc.id },
    sc.charRefsStale ? h('div', { class: 'issue warn' }, '시작 프레임이 지금 선택된 참조와 다른 이미지로 만들어졌습니다. 필요하면 "다시 생성"으로 새 참조를 반영하세요 (비용 확인 후 생성).') : null,
    h('div', { class: 'row', style: 'gap:12px;flex-wrap:wrap;align-items:stretch' }, refs.map((r) => {
      const [label, kind] = STATUS[r.status] || ['확인 필요', 'attention'];
      return h('div', { class: 'card flat stack', style: 'gap:6px;width:190px', 'data-char-ref': r.characterId, 'data-ref-status': r.status },
        r.url && r.status !== 'placeholder' ? h('img', { src: r.url, alt: r.name + ' 참조 이미지', loading: 'lazy', style: 'width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px' }) : h('div', { class: 'sb-main-img empty', style: 'aspect-ratio:1' }, h('small', null, '이미지 없음')),
        h('div', null, h('b', null, r.name), r.override ? h('span', { class: 'small muted' }, ' · 이 장면 전용') : null),
        h('div', { class: 'small mono muted', 'data-ref-asset': '' }, r.assetId || '—'),
        chip(label, kind),
        r.status !== 'approved' ? h('div', { class: 'small', style: 'color:#8a4e2c' }, r.status === 'missing' ? `Character reference missing: ${r.name}. Please upload or select a reference image.` : r.message) : null,
        h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
          r.url && r.status !== 'placeholder' ? h('button', { class: 'btn sm ghost', type: 'button', 'data-ref-view': r.characterId, onclick: () => viewFull(r) }, '원본 보기') : null,
          h('button', { class: 'btn sm ghost', type: 'button', 'data-ref-change': r.characterId, onclick: () => changer(ep, sc, r) }, '참조 변경')));
    })));
}

export function charRefsBadge(sc) {
  const refs = sc.charRefs || [];
  const bad = refs.filter((r) => r.status !== 'approved').length;
  return refs.length ? (bad ? `${bad}명 참조 필요` : `${refs.length}명 · 모두 승인됨`) : '';
}
