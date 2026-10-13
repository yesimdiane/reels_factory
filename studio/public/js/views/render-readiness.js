// Rendering Readiness card: the specific reasons a video cannot be generated / rendered yet (free, read-only).
import { h, chip } from '../ui.js';

export function readinessCard(ep) {
  const r = ep.derived && ep.derived.renderReadiness;
  if (!r) return h('div');
  const blocks = r.items.filter((i) => i.severity === 'block');
  const warns = r.items.filter((i) => i.severity === 'warn');
  const info = r.items.filter((i) => i.severity === 'info');
  return h('section', { class: 'card stack', style: 'gap:10px', 'data-render-readiness': '' },
    h('div', { class: 'card-head' }, h('h2', null, '렌더링 준비 상태'),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, chip(r.canGenerateVideo ? '영상 생성 준비됨' : '영상 생성 막힘', r.canGenerateVideo ? 'done' : 'err'), chip(r.canRender ? '최종 렌더 준비됨' : '최종 렌더 막힘', r.canRender ? 'done' : 'attention'))),
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, r.categories.map((c) => h('span', { class: 'asset-chip ' + (c.blocking ? 'need' : 'ok'), 'data-ready-cat': c.key }, h('b', null, c.label + ': '), c.blocking ? `${c.blocking}개 문제` : '확인됨'))),
    blocks.length ? h('div', { class: 'stack', style: 'gap:6px' }, blocks.slice(0, 40).map((i) => h('div', { class: 'issue err', 'data-ready-block': i.code }, h('b', null, i.message), i.recovery ? h('div', { class: 'small' }, '→ ' + i.recovery) : null, i.stage === 'render' ? h('div', { class: 'small muted' }, '최종 렌더 단계') : null))) : h('div', { class: 'small', style: 'color:var(--sage-deep)' }, '막는 항목이 없습니다.'),
    warns.length ? h('div', { class: 'stack', style: 'gap:4px' }, warns.slice(0, 20).map((i) => h('div', { class: 'issue warn' }, i.message))) : null,
    info.length ? h('div', { class: 'small muted' }, info.map((i) => i.message).join(' ')) : null);
}
