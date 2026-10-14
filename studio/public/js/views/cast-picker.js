// Story Lab → "캐릭터 & 유니버스 선택": universe cards, character cards (multi-select), guest / narrator.
// The selection is saved per product on the server and sent with every story request. Nothing here makes a paid call.
import { h, chip, toast } from '../ui.js';
import { state, act } from '../state.js';
import { api } from '../api.js';
import { profileModal } from './character-profile.js';

const avatar = (c) => (c.thumb ? h('img', { class: 'cast-thumb', src: c.thumb.url, alt: c.name, loading: 'lazy' }) : h('span', { class: 'cast-thumb cast-init', 'aria-hidden': 'true' }, (c.name || '?')[0]));

export function castSection(pid, castState, onChange) {
  const U = (state.summary.universes || {}).universes || [];
  const sel = castState.cast;
  const universe = U.find((u) => u.id === sel.universeId) || U[0];
  const rerender = () => act(async () => null);
  const save = async (next) => {
    try { await api.put(`/api/storylab/${pid}/cast`, next); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); }
    await rerender(); if (onChange) onChange();
  };
  const chooseUniverse = (u) => save({ universeId: u.id, characterIds: u.characters.map((c) => c.id), guest: null, narrator: false });
  const toggle = (id) => {
    const on = sel.characterIds.includes(id);
    const ids = on ? sel.characterIds.filter((x) => x !== id) : sel.characterIds.concat([id]);
    if (!ids.length && !sel.guest && !sel.narrator) return toast('출연 캐릭터를 한 명 이상 선택하세요', { error: true });
    return save({ universeId: sel.universeId, characterIds: ids, guest: sel.guest, narrator: sel.narrator });
  };
  const guest = { name: (sel.guest && sel.guest.name) || '', description: (sel.guest && sel.guest.description) || '' };
  const warn = castState.warnings || [];

  return h('section', { class: 'cast-picker stack', style: 'gap:12px', 'data-cast-picker': '', 'aria-label': '캐릭터 & 유니버스 선택' },
    h('div', { class: 'row between' }, h('b', null, '캐릭터 & 유니버스 선택'), h('a', { class: 'small', href: '#/settings/characters' }, '캐릭터 라이브러리 열기')),
    h('div', { class: 'cast-universes', role: 'radiogroup', 'aria-label': '유니버스' }, U.filter((u) => u.active !== false || u.id === sel.universeId).map((u) => h('button', { type: 'button', class: 'cast-universe' + (u.id === sel.universeId ? ' on' : ''), role: 'radio', 'aria-checked': u.id === sel.universeId ? 'true' : 'false', 'data-universe': u.id, onclick: () => chooseUniverse(u) },
      h('span', { class: 'cast-thumbs' }, u.characters.slice(0, 3).map(avatar)),
      h('span', { class: 'cast-uname' }, u.name),
      h('span', { class: 'small muted' }, u.description),
      h('span', { class: 'small muted' }, `캐릭터 ${u.characters.length}명 · ${u.language === 'ko' ? '한국어' : '영어'} 대사`)))),
    universe ? h('div', { class: 'cast-chars', 'data-cast-chars': '' }, universe.characters.map((c) => {
      const on = sel.characterIds.includes(c.id);
      return h('div', { class: 'cast-char' + (on ? ' on' : '') },
        h('button', { type: 'button', class: 'cast-pick', 'aria-pressed': on ? 'true' : 'false', 'data-character': c.id, onclick: () => toggle(c.id) },
          avatar(c), h('span', { class: 'cast-cname' }, c.name), h('span', { class: 'small muted' }, c.role || '역할 미입력'),
          !c.hasApprovedReference ? h('span', { class: 'small', style: 'color:var(--clay)' }, '참조 이미지 없음') : null),
        h('button', { type: 'button', class: 'btn sm ghost', 'aria-label': c.name + ' 프로필 편집', onclick: () => profileModal({ character: state.summary.characters.find((x) => x.id === c.id), universes: U, characters: state.summary.characters, onDone: rerender }) }, '편집'));
    }).concat([h('button', { type: 'button', class: 'cast-add', 'data-cast-add': '', onclick: () => profileModal({ universeId: universe.id, universes: U, characters: state.summary.characters, onDone: rerender }) }, '＋ 캐릭터 추가')])) : null,
    h('details', { class: 'small', 'data-guest': '' }, h('summary', { style: 'cursor:pointer;min-height:36px;display:flex;align-items:center' }, '게스트 · 내레이터' + (sel.guest || sel.narrator ? ' (사용 중)' : '')),
      h('div', { class: 'stack', style: 'gap:8px;margin-top:6px' },
        h('label', { class: 'row small', style: 'gap:6px' }, h('input', { type: 'checkbox', checked: !!sel.narrator, 'data-narrator': '', onchange: (e) => save({ universeId: sel.universeId, characterIds: sel.characterIds, guest: sel.guest, narrator: e.target.checked }) }), '내레이터(보이스오버) 허용'),
        h('div', { class: 'grid two' },
          h('input', { type: 'text', placeholder: '게스트 이름 (1회성)', value: guest.name, 'aria-label': '게스트 이름', 'data-guest-name': '', oninput: (e) => (guest.name = e.target.value) }),
          h('input', { type: 'text', placeholder: '게스트 설명', value: guest.description, 'aria-label': '게스트 설명', oninput: (e) => (guest.description = e.target.value) })),
        h('div', { class: 'row', style: 'gap:8px' }, h('button', { type: 'button', class: 'btn sm ghost', 'data-guest-save': '', onclick: () => save({ universeId: sel.universeId, characterIds: sel.characterIds, guest: guest.name.trim() ? guest : null, narrator: sel.narrator }) }, '게스트 적용')),
        h('div', { class: 'small muted' }, '게스트는 저장된 정체성·목소리가 없어 대사 없이 1회성으로만 등장합니다. 선택하지 않은 캐릭터는 새로 등장하지 않습니다.'))),
    castState.errors && castState.errors.length ? h('div', { class: 'banner err' }, h('div', null, castState.errors.map((e) => h('div', null, e.message)))) : null,
    warn.length ? h('div', { class: 'small', style: 'color:var(--clay)', 'data-cast-warnings': '' }, warn.map((w) => h('div', null, '• ' + w.message))) : null,
    h('div', { class: 'small muted', 'data-cast-summary': '' }, `선택: ${universe ? universe.name : '?'} · ${sel.characterIds.length}명${sel.guest ? ' + 게스트 ' + sel.guest.name : ''}${sel.narrator ? ' + 내레이터' : ''}${castState.saved ? '' : ' (기본값 — 선택하면 저장됩니다)'}`));
}
