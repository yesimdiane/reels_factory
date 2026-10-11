// Router, shell and shared state. Hash routes: #/<view>/<id>   (id = episode, or product for products / storylab)
import { h, icon, toast } from './ui.js';
import { api } from './api.js';
import { state, hooks, refresh, setProduct } from './state.js';
import { overview } from './views/overview.js';
import { products } from './views/products.js';
import { storylab } from './views/storylab.js';
import { episodes } from './views/episodes.js';
import { script } from './views/script.js';
import { storyboard } from './views/storyboard.js';
import { animation } from './views/animation.js';
import { voice } from './views/voice.js';
import { render } from './views/render.js';
import { review } from './views/review.js';
import { publishing } from './views/publishing.js';
import { settings } from './views/settings.js';

// [key, ko, en, view, inRail]   Dashboard → Products → Story Lab → Script → Storyboard → Video Studio → Review → Publishing → Settings
export const NAV = [
  ['overview', '대시보드', 'Dashboard', overview, true],
  ['products', '제품 스튜디오', 'Product Studio', products, true],
  ['storylab', '스토리 랩', 'Story Lab', storylab, true],
  ['episodes', '에피소드', 'Episodes', episodes, true],
  ['script', '대본 스튜디오', 'Script Studio', script, true],
  ['storyboard', '스토리보드', 'Storyboard', storyboard, true],
  ['animation', '비디오 스튜디오', 'Video Studio', animation, true],
  ['voice', '보이스', 'Voice', voice, false],
  ['render', '렌더', 'Render', render, false],
  ['review', '최종 검토', 'Review', review, true],
  ['publishing', '게시', 'Publishing', publishing, true],
  ['settings', '설정', 'Settings', settings, true],
];
const ICON = { animation: 'video' };
const VIDEO_GROUP = ['animation', 'voice', 'render'];
const TAB_VIEWS = ['overview', 'products', 'storylab', 'script', 'animation', 'settings'];
const PRODUCT_VIEWS = ['products', 'storylab'];
const NO_ID_VIEWS = ['overview', 'episodes', 'settings'];

let poll = null;

function parseHash() {
  const [, view = 'overview', id = ''] = location.hash.split('/');
  return { view: NAV.some((n) => n[0] === view) ? view : 'overview', id };
}
const active = (key) => state.view === key || (key === 'animation' && VIDEO_GROUP.includes(state.view));
const hrefFor = (key) => '#/' + key + (PRODUCT_VIEWS.includes(key) ? (state.productId ? '/' + state.productId : '') : state.episodeId && !NO_ID_VIEWS.includes(key) ? '/' + state.episodeId : '');

function drawShell() {
  const rail = document.getElementById('rail');
  rail.replaceChildren(
    h('div', { class: 'brand' }, h('div', { class: 'brand-mark', html: '<svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z"/></svg>' }), h('div', null, h('b', null, 'Reels Factory'), h('span', null, 'Studio · Jack & Diane'))),
    ...NAV.filter((n) => n[4]).flatMap(([key, ko, en]) => [key === 'script' || key === 'settings' ? h('div', { class: 'nav-sep' }) : null, h('a', { class: 'nav-item', href: hrefFor(key), 'aria-current': active(key) ? 'page' : null }, icon(ICON[key] || key), h('span', null, h('span', { class: 'ko' }, ko), h('span', { class: 'en' }, en)))]).filter(Boolean),
    h('div', { class: 'rail-foot' }, state.summary ? modePill() : '', authFoot())
  );
  const tabs = document.getElementById('tabbar');
  tabs.replaceChildren(...TAB_VIEWS.map((k) => { const n = NAV.find((x) => x[0] === k); return h('button', { 'aria-current': active(k) ? 'page' : null, onclick: () => { location.hash = hrefFor(k); } }, icon(ICON[k] || k), n[1].replace(' 스튜디오', '').replace('비디오', '비디오')); }));
}

function authFoot() {
  if (!state.auth || !state.auth.authRequired) return '';
  return h('button', { class: 'btn sm ghost', style: 'margin-top:8px;color:#d9ccb8;border-color:rgba(246,241,231,.3)', onclick: async () => { await api.post('/api/logout'); location.reload(); } }, '로그아웃');
}

function modePill() {
  const p = state.summary.providers;
  const v = p.video;
  const ai = (state.summary.ai && state.summary.ai.routing) || [];
  const sample = ai.some((r) => ['storyConcepts', 'scriptWriting'].includes(r.task) && r.provider === 'mock');
  return h('div', null,
    h('div', { class: 'small', style: 'margin-bottom:4px;color:#d9ccb8' }, v.mode === 'mock' ? '영상 목업 · 요금 없음' : '영상 실제 모드 · 유료 호출 가능'),
    sample ? h('div', { class: 'small', style: 'color:#d9ccb8' }, '스토리/대본 AI: 샘플 응답') : null,
    h('div', null, state.episodeId ? '작업 중: ' + state.episodeId : ''));
}

export function rerender() {
  drawShell();
  const stage = document.getElementById('stage');
  const nav = NAV.find((n) => n[0] === state.view);
  stage.replaceChildren();
  try {
    stage.append(nav[3](state));
  } catch (e) {
    console.error(e);
    stage.append(h('div', { class: 'banner err' }, h('div', null, h('b', null, '화면을 그리지 못했습니다'), e.message)));
  }
  schedulePoll();
}

function schedulePoll() {
  clearTimeout(poll);
  const ep = state.episode;
  const busy = ep && (ep.derived.jobsRunning || (ep.derived.render.job && ep.derived.render.job.status === 'running'));
  if (busy && ['animation', 'voice', 'render', 'review', 'overview'].includes(state.view)) {
    poll = setTimeout(async () => {
      try {
        const activeEl = document.activeElement;
        await refresh();
        if (!(activeEl && /INPUT|TEXTAREA|SELECT/.test(activeEl.tagName))) rerender();
        else schedulePoll();
      } catch (e) { schedulePoll(); }
    }, 1500);
  }
}

function loginScreen() {
  const stage = document.getElementById('stage');
  document.getElementById('rail').replaceChildren();
  document.getElementById('tabbar').replaceChildren();
  const pw = h('input', { type: 'password', autocomplete: 'current-password', placeholder: '관리자 비밀번호', 'aria-label': '관리자 비밀번호' });
  const err = h('div', { class: 'small', style: 'color:var(--rose);min-height:1.4em' });
  const submit = async () => {
    try { await api.post('/api/login', { password: pw.value }); location.reload(); } catch (e) { err.textContent = e.message; }
  };
  pw.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  stage.replaceChildren(h('div', { class: 'card stack', style: 'max-width:380px;margin:12vh auto 0' }, h('h1', null, 'Reels Factory Studio'), h('p', { class: 'muted', style: 'margin:0' }, '이 스튜디오는 비밀번호로 보호됩니다.'), pw, err, h('button', { class: 'btn', onclick: submit }, '로그인')));
  pw.focus();
}

async function route() {
  if (state.auth === undefined) {
    try { state.auth = await api.get('/api/session'); } catch (e) { state.auth = { authRequired: false, authenticated: true }; }
  }
  if (state.auth.authRequired && !state.auth.authenticated) return loginScreen();
  const { view, id } = parseHash();
  state.view = view;
  if (PRODUCT_VIEWS.includes(view)) {
    if (id) setProduct(id);
    try { await refresh(); } catch (e) { if (!state.summary) throw e; toast(e.message, { error: true }); }
    if (!state.productId && state.summary.products && state.summary.products[0]) setProduct(state.summary.products[0].id);
  } else if (id && id !== state.episodeId) {
    state.episodeId = id;
    state.draft = {};
    try { await refresh(); } catch (e) { toast(e.message, { error: true }); }
  } else {
    // Always re-read the server state on navigation (another tab/device or a long-running job may have changed it).
    try { await refresh(); } catch (e) { if (!state.summary) throw e; toast(e.message, { error: true }); }
  }
  rerender();
  document.getElementById('stage').focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

hooks.rerender = rerender;
window.addEventListener('hashchange', route);
window.addEventListener('rf-login-required', () => { state.auth = { authRequired: true, authenticated: false }; loginScreen(); });
route().catch((e) => {
  document.getElementById('stage').replaceChildren(h('div', { class: 'banner err' }, h('div', null, h('b', null, '서버에 연결하지 못했습니다'), e.message, h('div', { class: 'small' }, '서버가 실행 중인지 확인하세요 (로컬: node studio/server.js · 클라우드: 배포 상태와 /healthz).'))));
});
