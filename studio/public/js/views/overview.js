import { h, chip, fmtUsd, icon, toast, confirmDialog } from '../ui.js';
import { api } from '../api.js';
import { state, go, selectEpisode, setProduct } from '../state.js';
import { pageHead, asyncBlock, pipelineBar, modeBanner, nextStep, nextLabel, VIEW_FOR_STEP, noEpisode, makeStartImages } from './common.js';
import { act } from '../state.js';

export function overview() {
  const s = state.summary;
  const ep = state.episode;
  const wrap = h('div', { class: 'stack', style: 'gap:22px' });
  wrap.append(pageHead('Overview', '오늘의 제작 현황', '진행 중인 에피소드, 승인 대기 항목, 예상 비용을 한눈에 봅니다.'));
  wrap.append(modeBanner(s));
  wrap.append(workflowBoard(s, ep));
  wrap.append(currentPanel(s, ep));
  const more = h('details', { class: 'card', 'data-more-status': '' }, h('summary', { style: 'cursor:pointer;min-height:40px;display:flex;align-items:center;gap:8px' }, h('b', null, '전체 현황 보기'), h('span', { class: 'small muted' }, '제작 현황 · 승인 대기 · 지출 · 에피소드 목록')));
  const inner = h('div', { class: 'stack', style: 'gap:22px;margin-top:14px' });
  more.append(inner);
  inner.append(labCard(s));
  if (!ep) { inner.append(noEpisode()); wrap.append(more); return wrap; }
  const step = nextStep(ep);
  const thumb = s.episodes.find((e) => e.id === ep.id).thumb;
  inner.append(h('section', { class: 'hero' },
    h('div', { class: 'stack', style: 'gap:12px' },
      h('div', { class: 'eyebrow' }, ep.series + ' · ' + ep.id + ' · ' + ep.product.name),
      h('h1', { style: 'font-size:32px' }, ep.title),
      h('p', { style: 'margin:0' }, ep.titleEn),
      h('div', { class: 'row' },
        step ? h('button', { class: 'btn lg', style: 'background:#f6f1e7;color:#3a2b22;border-color:#f6f1e7', onclick: () => { if (['product', 'concept'].includes(step.key) && ep.productId) setProduct(ep.productId); go(VIEW_FOR_STEP[step.key]); } }, '다음: ' + nextLabel(step), icon('play')) : chip('모든 단계 완료', 'done'),
        h('span', { class: 'small', style: 'color:#d9ccb8' }, ep.derived.steps.filter((x) => x.state === 'done').length + ' / ' + ep.derived.steps.length + ' 단계 완료'))),
    h('div', { class: 'poster' }, thumb ? h('video', { src: thumb, muted: true, playsinline: true, loop: true, autoplay: true }) : h('div', { class: 'ph', style: 'display:grid;place-items:center;height:100%;color:#b9a995;font-size:13px;padding:12px;text-align:center' }, '클립이 생성되면 여기에 미리보기가 표시됩니다'))));
  { // dashboard action: AI start image for every scene of the current episode
    const scenes = ep.scenes || [];
    const frames = scenes.map((sc) => sc.startImageInfo || {});
    const approved = frames.filter((f) => f.approved && !f.error && f.url && f.url.includes('/startframe/')).length;
    const pending = frames.filter((f) => f.generated && !f.approved).length;
    inner.append(h('div', { class: 'card row between', style: 'gap:12px;flex-wrap:wrap' },
      h('div', { class: 'stack', style: 'gap:4px' }, h('h2', { style: 'margin:0' }, '장면별 시작 이미지'),
        h('div', { class: 'small muted' }, `${scenes.length}개 장면 · 승인된 프레임 ${approved}개 · 승인 대기 AI 프레임 ${pending}개`),
        ep.derived.scriptApproved ? null : h('div', { class: 'small', style: 'color:var(--clay)' }, '대본을 승인하면 만들 수 있습니다 (유료 생성은 대본 승인 후에만).')),
      h('div', { class: 'row' },
        h('button', { class: 'btn clay', disabled: !ep.derived.scriptApproved, onclick: () => makeStartImages(ep, [], { after: () => act(async () => null) }) }, icon('plus'), '시작 이미지 만들기'),
        h('button', { class: 'btn ghost', onclick: () => go('storyboard') }, '스토리보드에서 확인·승인'))));
  }
  inner.append(h('div', null, pipelineBar(ep)));
  const t = s.totals;
  inner.append(h('div', { class: 'stat-row' },
    stat(t.inProduction, '제작 중인 에피소드'),
    stat(s.queue.length, '승인 대기 항목'),
    stat(fmtUsd(t.spentUsd), '실제 지출 (목업은 $0)', ep.derived.limitUsd != null ? `릴스당 한도 ${fmtUsd(ep.derived.limitUsd)}` : ''),
    stat(t.completed, '최종 승인 완료')));
  inner.append(h('div', { class: 'grid side' },
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, '승인 대기'), chip(String(s.queue.length), s.queue.length ? 'attention' : 'done')),
      s.queue.length ? h('div', { class: 'list' }, s.queue.map((q) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't' }, q.label), h('div', { class: 'small muted' }, q.episodeId + ' · ' + q.title)), h('button', { class: 'btn sm sage', onclick: () => { state.episodeId = q.episodeId; go(q.view, q.episodeId); } }, '검토')))) : h('div', { class: 'muted' }, '승인을 기다리는 항목이 없습니다.')),
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, '에피소드')),
      h('div', { class: 'list' }, s.episodes.filter((e) => !e.archived).map((e) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't' }, e.id + ' · ' + e.title), h('div', { class: 'small muted' }, e.productName + ' · ' + e.scenes + '장면 · 약 ' + Math.round(e.totalPlannedSec) + '초'), h('div', { class: 'mini-dots', style: 'margin-top:6px' }, e.steps.map((st) => h('i', { class: st.state, title: st.label })))), h('button', { class: 'btn sm ghost', onclick: () => selectEpisode(e.id) }, '열기')))))));
  wrap.append(more);
  return wrap;
}

function stat(n, l, sub) {
  return h('div', { class: 'stat' }, h('div', { class: 'n' }, String(n)), h('div', { class: 'l' }, l), sub && h('div', { class: 'small muted' }, sub));
}

function labCard(s) {
  const prods = s.products || [];
  const lab = Object.fromEntries((s.storylab || []).map((x) => [x.productId, x]));
  const u = (s.ai && s.ai.usage) || null;
  return h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, '제품 · 스토리 랩'), u ? h('span', { class: 'small muted' }, `AI 사용(추정) 오늘 ${fmtUsd(u.today.usd)} · 이번 달 ${fmtUsd(u.month.usd)}`) : null),
    prods.length ? h('div', { class: 'list' }, prods.map((p) => { const l = lab[p.id] || { concepts: 0, approved: 0, candidates: 0, needsReapproval: 0 }; return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't' }, p.id + ' · ' + p.name), h('div', { class: 'small muted' }, `컨셉 ${l.concepts}개 · 승인 ${l.approved} · 후보 ${l.candidates}` + (l.needsReapproval ? ` · 재승인 필요 ${l.needsReapproval}` : ''))), p.readiness.ok ? chip('준비됨', 'done') : chip('준비 필요', 'attention'), h('a', { class: 'btn sm ghost', href: '#/storylab/' + p.id }, '스토리 랩')); })) : h('div', { class: 'muted' }, '제품이 없습니다. 제품 메뉴에서 시작하세요.'));
}


// ---- workflow board: Product → Story Lab → Episode → Script → Storyboard → Video (one glance, one current step) ----
const STAGES = [['products', '제품 스튜디오', 'products'], ['storylab', '스토리랩', 'storylab'], ['episodes', '에피소드', 'episodes'], ['script', '대본 스튜디오', 'script'], ['storyboard', '스토리보드', 'storyboard'], ['animation', '비디오 스튜디오', 'video']];
function stageDone(s, ep) {
  const step = (k) => ep && ep.derived.steps.find((x) => x.key === k);
  return [
    (s.products || []).some((p) => p.readiness && p.readiness.ok),
    (s.storylab || []).some((x) => x.approved > 0),
    !!ep,
    !!(ep && ep.derived.scriptApproved),
    !!(step('storyboard') && step('storyboard').state === 'done'),
    !!(step('review') && step('review').state === 'done'),
  ];
}
function workflowBoard(s, ep) {
  const done = stageDone(s, ep);
  const cur = done.indexOf(false);
  return h('section', { class: 'wf-board', 'data-workflow': '' },
    h('div', { class: 'row between' }, h('div', null, h('div', { class: 'eyebrow' }, 'Reels Factory · 스튜디오 아웃라인'), h('h2', { style: 'margin:2px 0 0' }, '제작 워크플로')), ep ? chip(ep.displayId || ep.id, 'mono') : null),
    h('div', { class: 'wf-grid' }, STAGES.map(([key, label, ic], i) => h('a', { class: 'wf-card' + (i === cur ? ' current' : '') + (done[i] ? ' done' : ''), href: '#/' + key + (['products', 'storylab'].includes(key) ? (state.productId ? '/' + state.productId : '') : ['episodes'].includes(key) ? '' : (ep ? '/' + ep.id : '')), 'aria-current': i === cur ? 'step' : null, 'data-stage': key },
      h('div', { class: 'wf-top' }, icon(ic), h('span', { class: 'wf-name' }, label)),
      h('div', { class: 'wf-bottom' }, h('span', { class: 'wf-num' }, `${i + 1} / 6`), done[i] ? h('span', { class: 'wf-check', 'aria-label': '완료' }, icon('check')) : null)))));
}

// ---- current step panel: the latest story waiting for approval (or the next action) ----
function currentPanel(s, ep) {
  const pid = state.productId || (ep && ep.productId) || '';
  const waiting = (s.storylab || []).some((x) => x.candidates > 0 && x.productId === pid);
  if (!pid || !waiting) {
    const next = ep ? nextStep(ep) : null;
    return h('section', { class: 'card stack', 'data-current': 'next', style: 'gap:10px' }, h('div', { class: 'row between' }, h('h2', { style: 'margin:0' }, ep ? '다음 할 일' : '시작하기'), chip(ep ? '진행 중' : '대기', ep ? 'attention' : '')),
      ep && next ? h('div', null, h('button', { class: 'btn lg', onclick: () => { if (['product', 'concept'].includes(next.key) && ep.productId) setProduct(ep.productId); go(VIEW_FOR_STEP[next.key]); } }, '다음: ' + nextLabel(next))) : h('div', { class: 'muted' }, ep ? '모든 단계를 마쳤습니다.' : '제품 스튜디오에서 제품을 만들고 스토리랩에서 이야기를 만드세요.'));
  }
  return asyncBlock(() => api.get('/api/storylab/' + pid), (lab) => {
    const c = lab.concepts.filter((x) => x.status === 'candidate').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    if (!c) return h('div', null);
    const catName = ((lab.categories || []).find((o) => o.key === c.category) || {}).ko || '';
    let ko = false;
    const body = h('div', { class: 'wf-story', 'data-story-text': '' });
    const draw = () => body.replaceChildren(h('div', { class: ko ? 'ko-text' : '' }, ko ? (c.ko && c.ko.storyline) || '번역이 아직 없습니다 (이전에 만든 스토리)' : (c.storyline || '')));
    draw();
    const tbtn = h('button', { class: 'btn sm ghost', type: 'button', 'data-ko-toggle': '', onclick: () => { ko = !ko; tbtn.firstChild.nodeValue = ko ? 'English' : '한국어 번역'; draw(); } }, icon('refresh'), '한국어 번역');
    return h('section', { class: 'card stack', 'data-current': 'story', style: 'gap:12px' },
      h('div', { class: 'row between' }, h('h2', { style: 'margin:0' }, '스토리 디벨롭'), chip('승인 대기', 'attention')),
      h('div', { class: 'small muted' }, [c.productId, catName, c.maxDurationSec ? '최대 ' + c.maxDurationSec + '초' : null].filter(Boolean).join(' · ')),
      h('h3', { style: 'font-size:19px;margin:0' }, ko && c.ko && c.ko.title ? c.ko.title : c.title),
      body,
      h('div', { class: 'row between' }, tbtn, h('span', { class: 'small muted' }, 'Story v' + (c.revision || 1))),
      h('div', { class: 'wf-actions' },
        h('button', { class: 'btn ghost', type: 'button', onclick: () => go('storylab') }, '수정'),
        h('button', { class: 'btn sage', type: 'button', 'data-approve-story': c.id, onclick: async () => {
          if (!(await confirmDialog({ title: '이 스토리를 승인할까요?', body: h('div', { class: 'small' }, c.title), confirm: '스토리 승인', tone: 'sage' }))) return;
          try { await api.post(`/api/storylab/${pid}/concepts/${c.id}/approve`); toast('승인했습니다'); await act(async () => null); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); }
        } }, '스토리 승인 →')));
  });
}
