// Story Lab: generate ≥3 different concepts, edit/compare/regenerate, and approve exactly the ones that may proceed to Script Studio.
import { h, chip, icon, toast, modal, confirmDialog } from '../ui.js';
import { state, act, setProduct } from '../state.js';
import { api } from '../api.js';
import { pageHead, asyncBlock, confirmPaid } from './common.js';

const FIELDS = [['hook', '오프닝 훅'], ['situation', '상황 / 갈등'], ['productRole', '제품의 자연스러운 역할'], ['characterUsage', 'Jack / Diane 사용 방식'], ['payoff', '결말 / 페이오프'], ['viewerAppeal', '시청자 공감 포인트'], ['ctaDirection', 'CTA 방향']];
const view = { filter: 'active', compare: new Set(), count: 3, extra: '' };

export function storylab() {
  const s = state.summary;
  const pid = state.productId;
  const wrap = h('div', { class: 'stack', style: 'gap:20px' });
  const items = s.products || [];
  const picker = items.length > 1 ? h('select', { 'aria-label': '제품 선택', style: 'width:auto;padding:7px 12px;border-radius:999px', onchange: (e) => { setProduct(e.target.value); location.hash = '#/storylab/' + e.target.value; } }, items.map((p) => h('option', { value: p.id, selected: p.id === pid }, p.id + ' · ' + (p.name || '').slice(0, 24)))) : null;
  wrap.append(pageHead('Story Lab', '스토리 랩', '제품 정보와 승인된 참조 이미지로 서로 다른 스토리 후보를 만들고, 하나를 승인해야 대본 단계로 넘어갑니다.', picker));
  if (!pid) { wrap.append(h('div', { class: 'empty' }, h('h2', null, '제품을 먼저 만드세요'), h('button', { class: 'btn', onclick: () => { location.hash = '#/products'; } }, '제품으로 이동'))); return wrap; }
  wrap.append(asyncBlock(() => Promise.all([api.get('/api/storylab/' + pid), api.get('/api/products/' + pid)]), ([lab, prod]) => body(lab, prod)));
  return wrap;
}

function routeInfo() {
  const r = (state.summary.ai.routing || []).find((x) => x.task === 'storyConcepts') || { provider: 'mock', model: '' };
  return r;
}

function body(lab, prod) {
  const box = h('div', { class: 'stack', style: 'gap:18px' });
  const pid = prod.id;
  const route = routeInfo();
  const ready = prod.readiness;
  const redraw = () => import('../state.js').then(({ hooks }) => hooks.rerender());

  // ---- gate / provider ----
  box.append(h('div', { class: 'card stack', style: 'gap:12px' },
    h('div', { class: 'card-head' }, h('div', null, h('div', { class: 'eyebrow' }, prod.id), h('h2', null, prod.name)), ready.ok ? chip('제품 준비 완료', 'done') : chip('제품 준비 필요', 'attention')),
    ready.ok ? null : h('div', { class: 'banner warn' }, icon('lock'), h('div', null, h('b', null, '스토리를 만들기 전에 필요한 것: ' + ready.missing.join(', ')), h('a', { href: '#/products/' + pid }, 'Products에서 채우기'))),
    prod.verifiedFacts.length ? h('div', { class: 'small' }, h('b', null, '사용되는 확인된 사실: '), prod.verifiedFacts.join(' · ')) : null,
    route.provider === 'mock'
      ? h('div', { class: 'banner mock' }, chip('샘플', 'mock'), h('div', null, h('b', null, '스토리 AI가 연결되지 않아 샘플 응답을 씁니다'), '아래 컨셉은 실제 AI가 만든 것이 아니라 흐름 확인용 샘플입니다("[샘플]" 표시). 실제 생성은 Settings → AI 연동에서 Gemini/GPT/Claude 키·모델을 지정하세요. ', h('a', { href: '#/settings' }, '설정으로')))
      : h('div', { class: 'banner' }, chip(route.provider, 'done'), h('div', null, h('b', null, `${route.provider} · ${route.model || '(모델 미선택)'}`), '이 호출은 유료일 수 있습니다. 실행 전에 예상 비용(추정)을 보여드리고 확인을 받습니다.')),
    h('div', { class: 'row' },
      h('label', { class: 'row small', style: 'gap:6px' }, '컨셉 수', h('select', { style: 'width:auto', onchange: (e) => (view.count = Number(e.target.value)) }, [3, 4, 5].map((n) => h('option', { value: n, selected: n === view.count }, n)))),
      h('div', { class: 'field', style: 'flex:1;min-width:240px' }, h('input', { type: 'text', placeholder: '추가 지시 (선택) — 예: 비 오는 날 상황 위주로', value: view.extra, oninput: (e) => (view.extra = e.target.value) })),
      h('button', { class: 'btn', disabled: !ready.ok, onclick: generate }, icon('plus'), '스토리 컨셉 생성'))));

  async function generate() {
    let est;
    try { est = await api.post(`/api/storylab/${pid}/estimate`, { count: view.count, extra: view.extra }); } catch (e) { return toast(e.message, { error: true, recovery: e.recovery }); }
    const c = await confirmPaid({ title: `스토리 컨셉 ${view.count}개 생성`, est, confirmLabel: '생성', body: h('p', { class: 'small muted', style: 'margin:0' }, '확인된 제품 사실, 승인된 참조 이미지, Jack·Diane 참조, 채널 브랜딩과 Prompt Manager의 스토리 프롬프트가 입력으로 쓰입니다.') });
    if (c === null) return;
    await act(async () => { await api.post(`/api/storylab/${pid}/generate`, { count: view.count, extra: view.extra, confirm: c }); return null; }, { ok: '스토리 컨셉을 만들었습니다' });
  }

  // ---- filter ----
  const all = lab.concepts;
  const counts = { active: all.filter((c) => ['candidate', 'approved'].includes(c.status)).length, rejected: all.filter((c) => c.status === 'rejected').length, superseded: all.filter((c) => c.status === 'superseded').length };
  const shown = all.filter((c) => (view.filter === 'active' ? ['candidate', 'approved'].includes(c.status) : c.status === view.filter)).slice().sort((x, y) => (y.batchId || '').localeCompare(x.batchId || '') || x.id.localeCompare(y.id));
  box.append(h('div', { class: 'row between' },
    h('div', { class: 'seg', role: 'tablist' }, [['active', `후보·승인 ${counts.active}`], ['rejected', `거절(보관) ${counts.rejected}`], ['superseded', `교체됨 ${counts.superseded}`]].map(([k, l]) => h('button', { role: 'tab', 'aria-pressed': view.filter === k ? 'true' : 'false', onclick: () => { view.filter = k; redraw(); } }, l))),
    h('button', { class: 'btn sm ghost', disabled: view.compare.size < 2, onclick: () => compareModal(all.filter((c) => view.compare.has(c.id))) }, `비교 (${view.compare.size})`)));
  if (!shown.length) box.append(h('div', { class: 'empty' }, view.filter === 'active' ? '아직 스토리 컨셉이 없습니다. 위에서 생성하세요.' : '비어 있습니다.'));
  box.append(h('div', { class: 'grid two' }, shown.map((c) => conceptCard(c, pid, redraw))));
  return box;
}

function conceptCard(c, pid, redraw) {
  const used = (state.summary.episodes || []).filter((e) => e.concept && e.concept.conceptId === c.id);
  const src = c.source || {};
  const stateChip = c.approved ? chip('승인됨 r' + c.revision, 'done') : c.needsReapproval ? chip('수정됨 · 재승인 필요', 'attention') : c.status === 'rejected' ? chip('거절됨', 'err') : c.status === 'superseded' ? chip('교체됨', 'mock') : chip('후보', '');
  const run = (fn, ok) => act(async () => { await fn(); return null; }, { ok });
  return h('article', { class: 'card stack', style: 'gap:10px;' + (c.approved ? 'border-color:var(--sage-deep);box-shadow:0 0 0 2px var(--sage-wash)' : '') },
    h('div', { class: 'row between' }, h('span', { class: 'eyebrow' }, c.id + (c.edited ? ' · 수정됨' : '')), h('div', { class: 'row', style: 'gap:6px' }, c.sample ? chip('샘플', 'mock') : null, stateChip)),
    h('h3', { style: 'font-size:18px' }, c.title),
    h('dl', { style: 'margin:0;display:grid;gap:8px' }, FIELDS.map(([k, l]) => h('div', null, h('dt', { class: 'small muted', style: 'font-weight:600' }, l), h('dd', { style: 'margin:0' }, c[k])))),
    h('div', { class: 'small muted' }, `예상 길이 약 ${c.estimatedDurationSec}초 · ${src.mock ? '샘플 응답' : (src.provider || '?') + '/' + (src.model || '?')} · 스토리 프롬프트 v${src.promptVersion || '?'}`),
    c.status === 'rejected' && c.rejection ? h('div', { class: 'small', style: 'color:var(--rose)' }, '거절 사유: ' + (c.rejection.reason || '(없음)')) : null,
    c.approval ? h('details', { class: 'small' }, h('summary', null, '승인 기록 (추적용)'), h('div', { class: 'mono', style: 'white-space:pre-wrap;margin-top:6px' }, [`제품: ${c.approval.productId}`, `컨셉: ${c.approval.conceptId} (r${c.approval.revision})`, `제공자/모델: ${c.approval.mock ? '샘플' : c.approval.provider + ' / ' + c.approval.model}`, `스토리 프롬프트 버전: v${c.approval.storyPromptVersion}`, `참조 세트: ${c.approval.referenceSetId}`, `참조 이미지: ${(c.approval.referenceImageIds || []).join(', ') || '(없음)'}`, `상태: ${c.approval.status} · ${c.approval.by} · ${new Date(c.approval.at).toLocaleString('ko-KR')}`].join('\n'))) : null,
    used.length ? h('div', { class: 'small' }, '이 컨셉으로 만든 에피소드: ' + used.map((e) => e.id).join(', ')) : null,
    c.status === 'superseded' || c.status === 'rejected' ? h('div', { class: 'row' }, c.status === 'rejected' ? h('button', { class: 'btn sm ghost', onclick: () => run(() => api.post(`/api/storylab/${pid}/concepts/${c.id}/reopen`), '후보로 되살렸습니다') }, '후보로 되살리기') : null)
      : h('div', { class: 'row' },
        c.approved
          ? [h('button', { class: 'btn sm sage', onclick: () => run(async () => { const r = await api.post(`/api/storylab/${pid}/concepts/${c.id}/episode`); state.episodeId = r.id; location.hash = '#/script/' + r.id; }, '에피소드를 만들었습니다') }, '이 컨셉으로 에피소드 만들기'),
            h('button', { class: 'btn sm ghost', onclick: async () => { if (await confirmDialog({ title: '승인을 취소할까요?', body: '이 컨셉으로 만든 대본은 컨셉이 다시 승인될 때까지 승인할 수 없습니다.', tone: 'clay' })) run(() => api.post(`/api/storylab/${pid}/concepts/${c.id}/revoke`), '승인을 취소했습니다'); } }, '승인 취소')]
          : h('button', { class: 'btn sm sage', onclick: async () => { if (await confirmDialog({ title: '이 스토리 컨셉을 승인할까요?', body: h('div', { class: 'small stack' }, h('div', null, c.title), h('div', { class: 'muted' }, '승인된 컨셉만 대본 스튜디오로 넘어갑니다. 승인 시 제품, 컨셉 버전, 제공자/모델, 프롬프트 버전, 참조 이미지가 기록됩니다.'), c.sample ? h('div', { style: 'color:var(--clay)' }, '이 컨셉은 샘플 응답입니다 (실제 AI가 만든 것이 아님).') : null), confirm: '승인' })) run(() => api.post(`/api/storylab/${pid}/concepts/${c.id}/approve`), '승인했습니다'); } }, icon('check'), c.needsReapproval ? '수정본 재승인' : '승인'),
        h('button', { class: 'btn sm ghost', onclick: () => editModal(c, pid) }, '편집'),
        c.approved ? null : h('button', { class: 'btn sm ghost', onclick: () => regen(c, pid) }, '다시 생성'),
        c.approved ? null : h('button', { class: 'btn sm danger', onclick: () => { const reason = prompt('거절 사유 (보관됩니다)') ; if (reason !== null) run(() => api.post(`/api/storylab/${pid}/concepts/${c.id}/reject`, { reason }), '거절하고 보관했습니다'); } }, '거절'),
        h('label', { class: 'row small', style: 'gap:6px;margin-left:auto' }, h('input', { type: 'checkbox', checked: view.compare.has(c.id), onchange: (e) => { if (e.target.checked) { if (view.compare.size >= 3) { e.target.checked = false; return toast('비교는 최대 3개입니다'); } view.compare.add(c.id); } else view.compare.delete(c.id); redraw(); } }), '비교')));
}

function editModal(c, pid) {
  const f = Object.fromEntries([['title', c.title], ...FIELDS.map(([k]) => [k, c[k]]), ['estimatedDurationSec', c.estimatedDurationSec]]);
  modal((close) => h('div', { class: 'stack' }, h('h2', null, '컨셉 편집'),
    c.approved ? h('div', { class: 'banner warn' }, '승인된 컨셉을 수정하면 승인이 풀리고(재승인 필요), 이 컨셉으로 만든 대본은 "다시 생성 필요"로 표시됩니다.') : null,
    h('div', { class: 'field' }, h('label', null, '제목'), h('input', { type: 'text', value: f.title, oninput: (e) => (f.title = e.target.value) })),
    FIELDS.map(([k, l]) => h('div', { class: 'field' }, h('label', null, l), h('textarea', { rows: 2, oninput: (e) => (f[k] = e.target.value) }, f[k]))),
    h('div', { class: 'field' }, h('label', null, '예상 길이(초)'), h('input', { type: 'number', min: 10, max: 90, value: f.estimatedDurationSec, oninput: (e) => (f.estimatedDurationSec = e.target.value) })),
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: close }, '취소'), h('button', { class: 'btn', onclick: async () => { try { await api.put(`/api/storylab/${pid}/concepts/${c.id}`, f); close(); await act(async () => null, { ok: '저장했습니다 (변경이 있으면 새 리비전)' }); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); } } }, '저장'))), { wide: true });
}

async function regen(c, pid) {
  const feedback = prompt('어떻게 바꾸고 싶나요? (선택, 예: 더 코믹하게 / 부부 대화 위주로)', '');
  if (feedback === null) return;
  let est;
  try { est = await api.post(`/api/storylab/${pid}/estimate`, { count: 3 }); } catch (e) { return toast(e.message, { error: true, recovery: e.recovery }); }
  const confirm = await confirmPaid({ title: '컨셉 1개 다시 생성', est, confirmLabel: '다시 생성', body: h('p', { class: 'small muted', style: 'margin:0' }, '기존 컨셉은 "교체됨"으로 보관되고 삭제되지 않습니다.') });
  if (confirm === null) return;
  await act(async () => { await api.post(`/api/storylab/${pid}/concepts/${c.id}/regenerate`, { feedback, confirm }); return null; }, { ok: '새 컨셉을 만들었습니다' });
}

function compareModal(list) {
  const rows = [['title', '제목'], ...FIELDS, ['estimatedDurationSec', '예상 길이(초)']];
  modal((close) => h('div', { class: 'stack' }, h('h2', null, '컨셉 비교'),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, ''), list.map((c) => h('th', null, c.id)))),
      h('tbody', null, rows.map(([k, l]) => h('tr', null, h('td', { class: 'small muted', style: 'white-space:nowrap' }, l), list.map((c) => h('td', { style: 'min-width:220px;vertical-align:top' }, String(c[k])))))))),
    h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: close }, '닫기'))), { wide: true });
}
