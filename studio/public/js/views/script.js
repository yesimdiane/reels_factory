import { h, chip, icon, toast, confirmDialog, fmtSec } from '../ui.js';
import { state, act, requireEpisode } from '../state.js';
import { api } from '../api.js';
import { pageHead, pipelineBar, noEpisode, episodePicker, issueList, charAvatar, confirmPaid, sceneNav } from './common.js';
import { presetPanel } from './script-prompt.js';
import { formulaLayout } from './script-formula.js';
import { timingCard } from './script-timing.js';
import { errorIndex, attach, summary as errorSummary } from './script-validate.js';
import { projectPanel, sceneFooter, sceneTools, statusChip } from './script-project.js';

// Mirror of the server's estimate (display only; the server validates).
function speechSec(text) {
  const t = String(text || '');
  const words = t.trim().split(/\s+/).filter(Boolean).length;
  const stretch = (t.match(/(.)\1{2,}/g) || []).reduce((n, m) => n + (m.length - 2) * 0.045, 0);
  const bangs = Math.min(3, (t.match(/[!?]/g) || []).length) * 0.06;
  return Math.round((words / 2.7 + 0.25 + stretch + bangs) * 100) / 100;
}

function draftOf(ep) {
  if (!state.draft.script || state.draft.script.forEpisode !== ep.id) {
    state.draft.script = {
      forEpisode: ep.id, dirty: false,
      title: ep.title, titleEn: ep.titleEn || '',
      beats: ep.beats.slice(),
      scenes: ep.scenes.map((s) => ({ id: s.id, part: s.part, beatKey: s.beatKey, title: s.title, title_ko: s.titleKoMissing ? '' : s.title_ko, legacyTitle: s.title, durationSec: s.durationSec, characters: s.characters.slice(), showsProduct: s.showsProduct, visual: s.visual, beat: s.beat, action: s.action || '', narration: s.narration || '', placement: s.placement || '' })),
      lines: ep.lines.map((l) => ({ ...l })),
      comedy_story: ep.formula.structured ? Object.fromEntries(ep.formula.partA.map((b) => [b.key, { title_ko: b.title_ko, story_en: b.story_en, visual: b.visual }])) : null,
      product_ending: ep.formula.structured ? Object.fromEntries(ep.formula.partB.map((b) => [b.key, { title_ko: b.title_ko, story_en: b.story_en, visual: b.visual }])) : null,
      endingVars: ep.formula.structured ? Object.assign({}, ep.formula.ending.vars) : null,
      cta: { lines: ep.cta.lines.slice(), keyword: ep.cta.keyword, durationSec: ep.cta.durationSec },
    };
  }
  return state.draft.script;
}

export function script() {
  const ep = requireEpisode();
  if (!ep) return noEpisode();
  const d = draftOf(ep);
  const chars = state.summary.characters;
  const dirty = () => { d.dirty = true; saveBtn.disabled = false; saveBtn.textContent = '저장'; approveBtn.disabled = true; };
  const v = ep.derived.validation;
  const index = errorIndex(ep);
  const saveBtn = h('button', { class: 'btn', disabled: !d.dirty, onclick: save }, d.dirty ? '저장' : '저장됨');
  const approveBtn = h('button', { class: 'btn sage', disabled: d.dirty || !v.ok || ep.derived.scriptApproved || !ep.derived.sceneApproval.canApproveProject, title: ep.derived.sceneApproval.canApproveProject ? '' : '모든 씬을 먼저 승인하세요 (' + ep.derived.sceneApproval.progress + ')', onclick: approve }, ep.derived.scriptApproved ? '대본 승인됨' : '대본 승인');

  async function save() {
    const r = await act(() => api.put(`/api/episodes/${ep.id}/script`, { title: d.title, titleEn: d.titleEn, beats: d.beats, scenes: d.scenes, lines: d.lines, cta: d.cta, ...(d.comedy_story ? { comedy_story: d.comedy_story, product_ending: d.product_ending, ending: { vars: d.endingVars } } : {}) }), { ok: '저장했습니다 (새 버전)' });
    if (r) state.draft.script = null;
    if (r) { const { hooks } = await import('../state.js'); hooks.rerender(); }
  }
  async function approve() {
    const ok = await confirmDialog({ title: '대본을 승인할까요?', body: h('div', { class: 'stack small' }, h('div', null, `${ep.lines.length}개 대사 · 약 ${Math.round(v.totalSec)}초`), h('div', { class: 'muted' }, '승인 이후 대본을 고치면 승인이 자동으로 무효화되고, 유료 생성·음성·렌더가 다시 잠깁니다.')), confirm: '승인' });
    if (ok) await act(() => api.post(`/api/episodes/${ep.id}/script/approve`), { ok: '대본을 승인했습니다' });
  }

  const wrap = h('div', { class: 'stack', style: 'gap:20px' });
  wrap.append(pageHead('Script Studio', '대본 스튜디오', '영어 대사와 한국어 자막은 따로 저장됩니다. 영어만 음성으로 만들고, 한국어는 자막으로만 쓰입니다.', episodePicker(), saveBtn, approveBtn));
  wrap.append(pipelineBar(ep));
  wrap.append(projectPanel(ep, d, errorSummary(ep, index), { approveScript: approve }));
  wrap.append(conceptPanel(ep, d));
  if (ep.derived.concept.linked) wrap.append(presetPanel(ep));
  wrap.append(timingCard(ep, { d, dirty, redrawAll: () => import('../state.js').then(({ hooks }) => hooks.rerender()) }));
  wrap.append(sceneNav(ep, 'script-scene-', { badges: true }));
  if (ep.derived.scriptChangedSinceApproval) wrap.append(h('div', { class: 'banner warn' }, h('div', null, h('b', null, '승인 후 대본이 수정되었습니다'), '유료 생성·음성·렌더가 잠겼습니다. 다시 확인하고 승인하세요.')));

  const main = h('div', { class: 'stack', style: 'gap:18px' });
  main.append(h('div', { class: 'card' },
    h('div', { class: 'grid two' },
      h('div', { class: 'field' }, h('label', null, '제목 (한국어)'), h('input', { type: 'text', value: d.title, oninput: (e) => { d.title = e.target.value; dirty(); } })),
      h('div', { class: 'field' }, h('label', null, 'Title (English)'), h('input', { type: 'text', value: d.titleEn, oninput: (e) => { d.titleEn = e.target.value; dirty(); } }))),
    h('div', { class: 'field', style: 'margin-top:12px' }, h('label', null, '스토리 비트 (한 줄에 하나)'), h('textarea', { rows: 5, oninput: (e) => { d.beats = e.target.value.split('\n').filter((x) => x.trim()); dirty(); } }, d.beats.join('\n')))));

  const blocks = [];
  const lockedB = (sc) => ep.formula.structured && sc.part === 'B' && ep.formula.ending.structureLocked;
  d.scenes.forEach((sc, si) => {
    const block = h('div', { class: 'card scene-block', style: 'border-left-width:3px' });
    block.id = 'script-scene-' + sc.id;
    block.setAttribute('data-rf', `S:${sc.id}:block`);
    const meter = h('span', { class: 'chip' });
    const sceneErr = (ep.scenes.find((x) => x.id === sc.id) || {}).approval;
    const st = sceneErr ? statusChip(sceneErr) : null;
    const lineWrap = h('div', { class: 'stack', style: 'gap:10px' });
    const refreshMeter = () => {
      const own = d.lines.filter((l) => l.sceneId === sc.id);
      const need = own.reduce((n, l) => n + speechSec(l.en), 0) + 0.18 * Math.max(0, own.length - 1) + (own.length ? 0.6 : 0);
      const act0 = !d.dirty && ((ep.derived.timing.scenes.find((x) => x.sceneId === sc.id) || {}).actual || {});
      meter.textContent = own.length ? `추정 대사 ${need.toFixed(1)}초 / 장면 ${sc.durationSec}초` + (act0 && act0.complete ? ` · 실측 ${act0.needSec.toFixed(1)}초` : '') : `장면 ${sc.durationSec}초 · 대사 없음`;
      meter.title = '추정 = 단어 수로 계산한 값. 실측 = 음성을 만든 뒤 실제 오디오 길이.';
      meter.setAttribute('data-rf', `S:${sc.id}:timing`);
      meter.className = 'chip ' + (need > sc.durationSec + 0.05 ? 'attention' : '');
    };
    const drawLines = () => {
      lineWrap.replaceChildren(...d.lines.map((l, li) => ({ l, li })).filter((x) => x.l.sceneId === sc.id).map(({ l, li }) => lineRow(l, li)));
      refreshMeter();
    };
    const lineRow = (l, li) => {
      const err = index.errors.filter((e) => e.lineId === l.id);
      const est = h('div', { class: 'small muted' });
      const upd = () => (est.textContent = '말하는 시간 약 ' + fmtSec(speechSec(l.en)));
      upd();
      return h('div', { class: 'line' + (err.length ? ' has-error' : '') },
        h('div', { class: 'stack', style: 'gap:6px' }, h('div', { class: 'speaker' }, charAvatar(chars.find((c) => c.id === l.speaker) || { id: '', name: '?', references: [] }), h('select', { 'aria-label': '화자', 'data-rf': `L:${l.id}:speaker`, onchange: (e) => { l.speaker = e.target.value; dirty(); drawLines(); } }, chars.map((c) => h('option', { value: c.id, selected: c.id === l.speaker }, c.name))))),
        attach(index, h('div', { class: 'field' }, h('label', null, 'English dialogue (음성)'), h('textarea', { rows: 2, spellcheck: 'true', lang: 'en', oninput: (e) => { l.en = e.target.value; upd(); refreshMeter(); dirty(); } }, l.en), est), `L:${l.id}:en`),
        attach(index, h('div', { class: 'field' }, h('label', null, '한국어 자막'), h('textarea', { rows: 2, lang: 'ko', oninput: (e) => { l.ko = e.target.value; dirty(); } }, l.ko)), `L:${l.id}:ko`),
        h('div', { class: 'row', style: 'flex-direction:column;gap:4px' },
          h('button', { class: 'btn icon ghost', title: '위로', onclick: () => move(li, -1) }, icon('up')),
          h('button', { class: 'btn icon ghost', title: '아래로', onclick: () => move(li, 1) }, icon('down')),
          h('button', { class: 'btn icon danger', title: '삭제', onclick: () => { d.lines.splice(li, 1); dirty(); drawLines(); } }, icon('trash'))));
    };
    const move = (li, dir) => {
      const j = li + dir;
      if (j < 0 || j >= d.lines.length) return;
      [d.lines[li], d.lines[j]] = [d.lines[j], d.lines[li]];
      dirty();
      redrawAll();
    };
    drawLines();
    block.append(
      h('div', { class: 'row between' },
        h('div', { class: 'row' }, h('span', { class: 'scene-no eyebrow' }, sc.id), st, attach(index, h('div', { class: 'field', style: 'margin:0' }, h('input', { type: 'text', style: 'width:min(340px,60vw);font-weight:600', value: sc.title_ko, placeholder: sc.legacyTitle ? '한국어 제목 입력 (현재: ' + sc.legacyTitle + ')' : '한국어 장면 제목 (예: 영국인의 자신감)', maxLength: 24, 'aria-label': '장면 제목 (한국어)', oninput: (e) => { sc.title_ko = e.target.value; dirty(); } })), `S:${sc.id}:title_ko`)),
        h('div', { class: 'row' }, meter, h('label', { class: 'row small muted', style: 'gap:6px' }, '길이', attach(index, h('input', { type: 'number', min: 1, max: 15, step: 0.5, style: 'width:76px', value: sc.durationSec, oninput: (e) => { sc.durationSec = Number(e.target.value); refreshMeter(); dirty(); } }), `S:${sc.id}:durationSec`), '초'),
          lockedB(sc) ? null : h('button', { class: 'btn icon ghost', title: '장면 위로', onclick: () => { if (si && (!ep.formula.structured || d.scenes[si - 1].beatKey === sc.beatKey)) { [d.scenes[si - 1], d.scenes[si]] = [d.scenes[si], d.scenes[si - 1]]; dirty(); redrawAll(); } } }, icon('up')),
          lockedB(sc) ? h('span', { class: 'chip done', title: '엔딩 구조는 잠겨 있습니다' }, '🔒') : h('button', { class: 'btn icon danger', title: '장면 삭제', onclick: async () => { if (await confirmDialog({ title: `${sc.id} 장면을 삭제할까요?`, body: '이 장면의 대사도 함께 삭제됩니다. 이미 만든 클립 파일은 지워지지 않습니다.', tone: 'clay', confirm: '삭제' })) { d.scenes.splice(si, 1); d.lines = d.lines.filter((l) => l.sceneId !== sc.id); dirty(); redrawAll(); } } }, icon('trash')))),
      h('details', { open: ['visual', 'action', 'narration', 'placement', 'showsProduct'].some((f) => (index.byKey[`S:${sc.id}:${f}`] || []).length) }, h('summary', { class: 'small muted', style: 'cursor:pointer' }, '장면 연출 · 캐릭터 행동 · 내레이션 · 제품 배치 (필수: 시각 연출)'),
        h('div', { class: 'grid two', style: 'margin-top:8px' },
          sceneField('시각 연출 (필수)', sc, 'visual', dirty, index), sceneField('캐릭터 행동 (선택)', sc, 'action', dirty, index), sceneField('내레이션 (선택, 한국어)', sc, 'narration', dirty, index), sceneField('제품 배치 (선택)', sc, 'placement', dirty, index)),
        h('label', { class: 'row small', style: 'gap:6px;margin-top:6px' }, h('input', { type: 'checkbox', checked: !!sc.showsProduct, onchange: (e) => { sc.showsProduct = e.target.checked; dirty(); } }), '이 장면에 제품이 보임')),
      lineWrap,
      h('div', { class: 'row' }, h('button', { class: 'btn sm ghost', onclick: () => { d.lines.push({ id: '', sceneId: sc.id, speaker: chars[0].id, en: '', ko: '' }); dirty(); drawLines(); } }, icon('plus'), '대사 추가'), (ep.suggestions || []).map((sg, i) => sg.sceneId === sc.id && h('button', { class: 'btn sm ghost', title: 'PR #19 초안에서 가져온 제안 대사', onclick: () => act(() => api.post(`/api/episodes/${ep.id}/suggestions/${i}/add`), { ok: '제안 대사를 추가했습니다' }) }, 'PR #19 제안: “' + sg.en.slice(0, 28) + (sg.en.length > 28 ? '…' : '') + '”'))),
      sceneTools(ep, sc),
      sceneFooter(ep, sc, d));
    blocks.push({ sc, block });
  });
  const redrawAll = () => { import('../state.js').then(({ hooks }) => hooks.rerender()); };
  if (ep.formula.structured) main.append(formulaLayout({ ep, d, blocks, dirty, redrawAll, v, index })); else blocks.forEach((b) => main.append(b.block));
  if (!ep.formula.structured) main.append(h('button', { class: 'btn ghost', onclick: () => { const n = d.scenes.length + 1; d.scenes.push({ id: 'S' + n, title: '새 장면', durationSec: 4, characters: [], showsProduct: false, visual: '', beat: n }); dirty(); redrawAll(); } }, icon('plus'), '장면 추가'));
  main.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, '엔드 카드 · CTA'), chip('한국어', '')),
    attach(index, h('div', { class: 'field' }, h('label', null, 'CTA 문구 (한 줄에 하나 — 영상 마지막에 표시)'), h('textarea', { rows: 4, lang: 'ko', oninput: (e) => { d.cta.lines = e.target.value.split('\n').filter((x) => x.trim()); dirty(); } }, d.cta.lines.join('\n'))), 'cta:lines'),
    h('div', { class: 'grid two', style: 'margin-top:12px' }, attach(index, h('div', { class: 'field' }, h('label', null, 'ManyChat 댓글 키워드 (공개)'), h('input', { type: 'text', value: d.cta.keyword, oninput: (e) => { d.cta.keyword = e.target.value; dirty(); } })), 'cta:keyword'), attach(index, h('div', { class: 'field' }, h('label', null, '엔드 카드 길이 (초)'), h('input', { type: 'number', min: 0, max: 8, step: 0.5, value: d.cta.durationSec, oninput: (e) => { d.cta.durationSec = Number(e.target.value); dirty(); } })), 'cta:durationSec')),
    h('p', { class: 'small muted', style: 'margin:10px 0 0' }, '이모지(☂️ 등)는 캡션에는 남지만 영상 자막으로는 그려지지 않습니다(자막 렌더러가 이모지를 지원하지 않음). 내부 상품 ID는 공개 키워드로 쓸 수 없습니다.')));

  const side = h('div', { class: 'stack', style: 'gap:16px' });
  side.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, '승인 상태'), ep.derived.scriptApproved ? chip('승인됨 v' + ep.approvals.script.version, 'done') : chip(ep.derived.scriptChangedSinceApproval ? '재승인 필요' : '승인 대기', 'attention')),
    h('div', { class: 'stack', style: 'gap:10px' },
      h('div', { class: 'small' }, `총 길이 약 ${Math.round(v.totalSec)}초 · 대사 ${ep.lines.length}개 · 장면 ${ep.scenes.length}개`),
      v.errors.length ? h('div', { class: 'small', style: 'color:var(--rose)' }, `고쳐야 할 항목 ${index.errors.length}개 — 위 "승인 진행" 패널에서 항목을 누르면 해당 입력칸으로 이동합니다.`) : h('div', { class: 'banner ok' }, '막는 오류가 없습니다.'),
      issueList(v.warnings, 'warn'),
      d.dirty ? h('div', { class: 'small', style: 'color:var(--clay)' }, '저장하지 않은 변경이 있습니다. 저장한 뒤 승인할 수 있습니다.') : null,
      ep.derived.scriptApproved ? h('button', { class: 'btn ghost', onclick: async () => { if (await confirmDialog({ title: '승인을 취소할까요?', body: '스토리보드 승인도 함께 취소됩니다.', tone: 'clay' })) act(() => api.post(`/api/episodes/${ep.id}/script/revoke`)); } }, '승인 취소') : null)));
  side.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, '캐릭터 규칙')),
    h('div', { class: 'stack', style: 'gap:10px' }, chars.map((c) => h('div', { class: 'row', style: 'align-items:flex-start;flex-wrap:nowrap' }, charAvatar(c), h('div', null, h('b', null, c.name + ' · ' + c.role), h('div', { class: 'small muted' }, c.personality.slice(0, 3).join(', ')), c.catchphrase && h('div', { class: 'small' }, '외치는 말: ' + c.catchphrase), c.forbiddenNote && h('div', { class: 'small', style: 'color:var(--rose)' }, c.forbiddenNote)))))));
  side.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, '버전 기록')),
    ep.derived.versions.length ? h('div', { class: 'list' }, ep.derived.versions.slice().reverse().slice(0, 8).map((vv) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't' }, 'v' + vv.version + (ep.approvals.script && ep.approvals.script.version === vv.version ? ' · 승인됨' : '')), h('div', { class: 'small muted' }, new Date(vv.at).toLocaleString('ko-KR') + (vv.note ? ' · ' + vv.note : ''))), vv.version === ep.version ? chip('현재', 'done') : h('button', { class: 'btn sm ghost', onclick: async () => { if (await confirmDialog({ title: `v${vv.version}로 되돌릴까요?`, body: '현재 내용은 새 버전으로 남습니다. 대본 승인은 무효가 될 수 있습니다.', tone: 'clay' })) act(() => api.post(`/api/episodes/${ep.id}/versions/${vv.version}/restore`), { ok: `v${vv.version}을 복원했습니다` }); } }, '복원')))) : h('div', { class: 'muted small' }, '저장하면 버전이 쌓입니다.')));
  wrap.append(h('div', { class: 'grid side' }, main, side));
  return wrap;
}

function sceneField(label, sc, key, dirty, index) {
  return attach(index, h('div', { class: 'field' }, h('label', null, label), h('textarea', { rows: 2, oninput: (e) => { sc[key] = e.target.value; dirty(); } }, sc[key] || '')), `S:${sc.id}:${key}`);
}

/** Concept → script traceability + AI script generation (only from an approved concept). */
function conceptPanel(ep, d) {
  const c = ep.derived.concept;
  if (!c.linked) return h('div', { class: 'banner mock' }, chip('레거시', 'mock'), h('div', null, h('b', null, '스토리 랩 이전에 만든 에피소드입니다'), c.note + '. 이 에피소드의 대본은 기존 방식대로 편집·승인할 수 있습니다. 새 에피소드는 Story Lab에서 컨셉을 승인한 뒤 시작합니다.'));
  const src = ep.scriptSource;
  const route = (state.summary.ai.routing || []).find((r) => r.task === 'scriptWriting') || { provider: 'mock' };
  const generate = async (overwrite) => {
    let est;
    try { est = await api.post(`/api/episodes/${ep.id}/script/estimate`, {}); } catch (e) { return toast(e.message, { error: true, recovery: e.recovery }); }
    const confirm = await confirmPaid({ title: overwrite ? 'AI로 대본 다시 만들기' : 'AI로 대본 만들기', est, confirmLabel: '대본 생성', body: h('p', { class: 'small muted', style: 'margin:0' }, '승인된 컨셉 "' + c.title + '" (r' + c.revision + ')와 확인된 제품 사실, 캐릭터 규칙, Prompt Manager의 대본 프롬프트로 장면별 대사·행동·내레이션·타이밍·제품 배치·CTA를 만듭니다. ' + (overwrite ? '현재 대본은 버전 기록에 남고, 새 대본은 다시 승인해야 합니다.' : '결과는 초안이며 승인 전에는 아무것도 진행되지 않습니다.')) });
    if (confirm === null) return;
    state.draft.script = null;
    await act(() => api.post(`/api/episodes/${ep.id}/script/generate`, { confirm, overwrite }), { ok: '대본 초안을 만들었습니다 (검토 후 승인하세요)' });
  };
  return h('div', { class: 'card stack', style: 'gap:10px' },
    h('div', { class: 'card-head' }, h('div', null, h('div', { class: 'eyebrow' }, '스토리 컨셉 → 대본'), h('h3', null, c.title || ep.concept.title)), c.ok ? chip(`${c.conceptId} r${c.revision} 승인됨`, 'done') : chip(c.state === 'script_stale' ? '컨셉이 바뀜 · 대본 재생성 필요' : '컨셉 승인 필요', 'attention')),
    !c.ok ? h('div', { class: 'banner warn' }, h('div', null, c.note, ' ', h('a', { href: '#/storylab/' + ep.productId }, 'Story Lab에서 확인'))) : null,
    src ? h('div', { class: 'small muted' }, `생성: ${src.mock ? '샘플 응답' : src.provider + ' / ' + src.model} · ${src.presetId ? '프리셋 ' + src.presetName + ' v' + src.presetVersion + ' · 강도 ' + src.comedyLevel : '대본 프롬프트 v' + src.promptVersion} · 컨셉 r${src.conceptRevision} · ${new Date(src.generatedAt).toLocaleString('ko-KR')}`) : h('div', { class: 'small muted' }, '아직 AI 대본이 없습니다. 직접 작성하거나 아래 버튼으로 초안을 만드세요.'),
    route.provider === 'mock' ? h('div', { class: 'small', style: 'color:var(--clay)' }, '대본 AI가 연결되지 않아 샘플 대본이 만들어집니다 (Settings → AI 연동).') : null,
    h('div', { class: 'row' }, h('button', { class: 'btn', disabled: !c.approved, onclick: () => generate(ep.formula.structured ? ep.scenes.some((x) => x.part === 'A') : ep.lines.length > 0) }, ep.formula.structured ? (ep.scenes.some((x) => x.part === 'A') ? 'AI로 코미디 스토리 다시 만들기 (PART A)' : 'AI로 코미디 스토리 만들기 (PART A)') : (ep.lines.length ? 'AI로 대본 다시 만들기' : 'AI로 대본 만들기')), d.dirty ? h('span', { class: 'small', style: 'color:var(--clay)' }, '저장하지 않은 변경은 다시 만들면 사라집니다') : null));
}
