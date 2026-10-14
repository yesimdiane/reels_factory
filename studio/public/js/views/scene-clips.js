// Storyboard → "영상 클립 생성 · 승인": the per-scene video step, using the SAME generation / review / upload APIs as the Video Studio page.
//   estimate (free) → explicit confirmation (existing dialog: cost, limit, one-time 30-minute authorization) → run → preview → approve / reject / regenerate.
// Nothing here starts a paid job by itself, never approves a clip, never overwrites a clip (a new generation is a new version), never retries on failure.
import { h, chip, fmtUsd } from '../ui.js';
import { state, act } from '../state.js';
import { api } from '../api.js';
import { startGeneration, clipCard } from './animation.js';
import { issueList } from './common.js';

const JOB_LABEL = { preparing: '준비 중', submitting: '제출 중', processing: '생성 중', completed: '완료', failed: '실패', uncertain: '확인 필요', polling_interrupted: '확인 중단', download_failed: '다운로드 실패' };

export function clipsBadge(sc) {
  const c = sc.clips || { versions: [] };
  if (c.approvedVersion) return '클립 승인됨';
  if (c.versions.length) return `검토 대기 ${c.versions.filter((v) => v.status === 'pending_review').length}`;
  return '영상 클립 생성 대기';
}

export function clipsPanelBody(ep, sc) {
  const model = (state.summary.models || []).find((m) => m.id === state.summary.settings.defaultModelId) || {};
  const jobs = (ep.generation.jobs || []).filter((j) => j.sceneId === sc.id);
  const running = jobs.find((j) => ['preparing', 'submitting', 'processing'].includes(j.status));
  const last = jobs[jobs.length - 1];
  const costBox = h('div', { class: 'small muted', 'data-clip-cost': sc.id }, '예상 비용은 "비용 확인"을 누르면 무료로 계산합니다 (생성은 시작되지 않습니다).');
  const showEstimate = async () => {
    costBox.textContent = '비용을 계산하는 중…';
    try {
      const est = await api.post(`/api/episodes/${ep.id}/generation/estimate`, { sceneIds: [sc.id], modelId: model.id });
      const it = (est.items || []).find((x) => x.sceneId === sc.id) || {};
      costBox.replaceChildren(
        h('div', null, h('b', null, est.mode === 'mock' ? '목업: 요금 없음' : it.cached ? '캐시 재사용: $0' : it.usd == null ? '예상 비용: 추정치 없음 (설정에서 가격 입력)' : '예상 비용: ' + fmtUsd(it.usd)), h('span', { class: 'muted' }, ` · 모델 ${est.model ? est.model.label : model.label || ''} · 클립 ${sc.clipSec}초`)),
        est.blockers && est.blockers.length ? issueList(est.blockers, 'err') : h('div', { class: 'small', style: 'color:var(--sage-deep)' }, '이 장면은 지금 생성할 수 있습니다.'));
    } catch (e) { costBox.replaceChildren(h('div', { class: 'issue err' }, e.message + (e.recovery ? ' — ' + e.recovery : ''))); }
  };
  const g = {};
  return h('div', { class: 'stack', style: 'gap:10px', 'data-clips-panel': sc.id },
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' },
      h('span', { class: 'small' }, h('b', null, '영상 모델: '), `${model.label || model.id || '(미선택)'}`, state.summary.providers && state.summary.providers.video ? h('span', { class: 'muted' }, ` · ${state.summary.providers.video.mode === 'live' ? 'LIVE (유료)' : 'MOCK (요금 없음)'}`) : null)),
    costBox,
    running ? h('div', { class: 'banner', 'data-clip-running': sc.id }, h('div', null, h('b', null, '영상 생성 중… '), `${JOB_LABEL[running.status] || running.status} (자동으로 새로고침됩니다)`)) : null,
    last && ['failed', 'uncertain', 'download_failed', 'polling_interrupted'].includes(last.status) ? h('div', { class: 'issue err', 'data-clip-error': sc.id }, h('b', null, `${JOB_LABEL[last.status]}: `), (last.error && last.error.message) || '', last.error && last.error.recovery ? h('div', { class: 'small' }, '→ ' + last.error.recovery) : null, h('div', { class: 'small muted' }, '실패해도 자동으로 다시 생성하지 않습니다. 확인 후 직접 "영상 생성"을 누르세요.')) : null,
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
      h('button', { class: 'btn sm ghost', type: 'button', 'data-clip-estimate': sc.id, onclick: showEstimate }, '비용 확인 (무료)'),
      h('button', { class: 'btn sm clay', type: 'button', 'data-clip-generate': sc.id, disabled: !!running || !ep.derived.storyboardApproved && !(ep.derived.storyboardApproval && ep.derived.storyboardApproval.scenes[sc.id] && ep.derived.storyboardApproval.scenes[sc.id].approved), title: running ? '이미 생성 중입니다' : '비용을 확인한 뒤에만 시작됩니다', onclick: () => startGeneration(ep, [sc.id]) }, sc.clips.versions.length ? '영상 다시 생성' : '영상 생성')),
    h('div', { class: 'small muted' }, '생성된 클립은 새 버전으로 저장되며 기존 클립은 지워지지 않습니다. 클립은 자동으로 승인되지 않습니다 — 미리보고 직접 승인하세요.'),
    clipCard(ep, sc, g, { onRegenerate: () => startGeneration(ep, [sc.id]) }));
}
