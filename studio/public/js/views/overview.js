import { h, chip, fmtUsd, icon } from '../ui.js';
import { state, go, selectEpisode, setProduct } from '../state.js';
import { pageHead, pipelineBar, modeBanner, nextStep, nextLabel, VIEW_FOR_STEP, noEpisode, makeStartImages } from './common.js';
import { act } from '../state.js';

export function overview() {
  const s = state.summary;
  const ep = state.episode;
  const wrap = h('div', { class: 'stack', style: 'gap:22px' });
  wrap.append(pageHead('Overview', '오늘의 제작 현황', '진행 중인 에피소드, 승인 대기 항목, 예상 비용을 한눈에 봅니다.'));
  wrap.append(modeBanner(s));
  wrap.append(labCard(s));
  if (!ep) { wrap.append(noEpisode()); return wrap; }
  const step = nextStep(ep);
  const thumb = s.episodes.find((e) => e.id === ep.id).thumb;
  wrap.append(h('section', { class: 'hero' },
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
    wrap.append(h('div', { class: 'card row between', style: 'gap:12px;flex-wrap:wrap' },
      h('div', { class: 'stack', style: 'gap:4px' }, h('h2', { style: 'margin:0' }, '장면별 시작 이미지'),
        h('div', { class: 'small muted' }, `${scenes.length}개 장면 · 승인된 프레임 ${approved}개 · 승인 대기 AI 프레임 ${pending}개`),
        ep.derived.scriptApproved ? null : h('div', { class: 'small', style: 'color:var(--clay)' }, '대본을 승인하면 만들 수 있습니다 (유료 생성은 대본 승인 후에만).')),
      h('div', { class: 'row' },
        h('button', { class: 'btn clay', disabled: !ep.derived.scriptApproved, onclick: () => makeStartImages(ep, [], { after: () => act(async () => null) }) }, icon('plus'), '시작 이미지 만들기'),
        h('button', { class: 'btn ghost', onclick: () => go('storyboard') }, '스토리보드에서 확인·승인'))));
  }
  wrap.append(h('div', null, pipelineBar(ep)));
  const t = s.totals;
  wrap.append(h('div', { class: 'stat-row' },
    stat(t.inProduction, '제작 중인 에피소드'),
    stat(s.queue.length, '승인 대기 항목'),
    stat(fmtUsd(t.spentUsd), '실제 지출 (목업은 $0)', ep.derived.limitUsd != null ? `릴스당 한도 ${fmtUsd(ep.derived.limitUsd)}` : ''),
    stat(t.completed, '최종 승인 완료')));
  wrap.append(h('div', { class: 'grid side' },
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, '승인 대기'), chip(String(s.queue.length), s.queue.length ? 'attention' : 'done')),
      s.queue.length ? h('div', { class: 'list' }, s.queue.map((q) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't' }, q.label), h('div', { class: 'small muted' }, q.episodeId + ' · ' + q.title)), h('button', { class: 'btn sm sage', onclick: () => { state.episodeId = q.episodeId; go(q.view, q.episodeId); } }, '검토')))) : h('div', { class: 'muted' }, '승인을 기다리는 항목이 없습니다.')),
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, '에피소드')),
      h('div', { class: 'list' }, s.episodes.filter((e) => !e.archived).map((e) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't' }, e.id + ' · ' + e.title), h('div', { class: 'small muted' }, e.productName + ' · ' + e.scenes + '장면 · 약 ' + Math.round(e.totalPlannedSec) + '초'), h('div', { class: 'mini-dots', style: 'margin-top:6px' }, e.steps.map((st) => h('i', { class: st.state, title: st.label })))), h('button', { class: 'btn sm ghost', onclick: () => selectEpisode(e.id) }, '열기')))))));
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
