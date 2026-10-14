// Video Studio tabs: scene review → timeline → subtitles → sound → final render (the last tab lives in render.js).
// Edits here change only the presentation (captions, mix, effect timing). Approved dialogue audio keeps its timing; nothing here is paid.
import { h, chip, confirmDialog, fmtSec, toast } from '../ui.js';
import { state, act } from '../state.js';
import { api } from '../api.js';
import { flowOf } from './scene-flow.js';
import { goToScenePanel } from './scene-nav.js';

export const STEP = 0.3; // UI grid: 0.3 s
const snap = (n) => Math.round(Math.round(Number(n) / STEP) * STEP * 100) / 100;
const r2 = (n) => Math.round(n * 100) / 100;
const PX = 36; // px per second on the timeline
const ui = () => (state.ui = state.ui || {});

export const VIDEO_TABS = [['review', '장면 검토'], ['timeline', '타임라인'], ['subtitles', '자막'], ['sound', '사운드'], ['final', '최종 렌더']];
export const videoTab = (ep) => (ui().videoTab && ui().videoTab[ep.id]) || 'review';
export function setVideoTab(ep, k, rerender) { ui().videoTab = Object.assign({}, ui().videoTab, { [ep.id]: k }); rerender(); }

// ------------------------------------------------------------ 1. scene review
const FINAL = { incomplete: ['앞 단계 대기', 'attention'], ready: ['합본 만들기 대기', 'attention'], built: ['합본 확인·승인 대기', 'attention'], approved: ['최종 승인됨', 'done'], stale: ['승인 후 바뀜', 'err'] };
export function reviewTab(ep) {
  return h('div', { class: 'grid two', 'data-vs-review': '' }, ep.scenes.map((sc) => {
    const f = flowOf(ep, sc.id);
    const fin = f ? f.final : { state: 'incomplete', missing: [] };
    const [lab, kind] = FINAL[fin.state] || [fin.state, ''];
    const clip = sc.clips && sc.clips.versions.find((v) => v.v === sc.clips.approvedVersion);
    const src = fin.composite ? fin.composite.url : clip ? clip.url : '';
    return h('article', { class: 'card stack', style: 'gap:8px', 'data-vs-scene': sc.id, 'data-vs-state': fin.state },
      h('div', { class: 'row between' }, h('b', null, `${sc.id} · ${sc.title_ko || sc.title || ''}`), chip(lab, kind)),
      src ? h('video', { src, controls: true, preload: 'metadata', playsinline: true, style: 'max-width:200px;border-radius:8px;align-self:center' }) : h('div', { class: 'empty small' }, '승인된 클립이 아직 없습니다.'),
      h('div', { class: 'small muted' }, fin.composite ? '씬 합본 (클립 + 오디오 + 컷 + 효과음)' : clip ? '승인된 클립 (합본 전)' : ''),
      fin.missing && fin.missing.length ? h('div', { class: 'small', style: 'color:var(--clay)' }, '필요: ' + fin.missing.join(', ')) : null,
      fin.state === 'stale' ? h('div', { class: 'issue err' }, `승인 후 바뀐 부분: ${(fin.changed || []).join(', ') || '내용'}`) : null,
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { state.ui = state.ui || {}; goToScenePanel(ep, sc.id, 'clips'); } }, '애니메이션 스튜디오에서 열기'),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => goToScenePanel(ep, sc.id, 'compose') }, '합본·승인 열기')));
  }));
}

// ------------------------------------------------------------ 2. timeline
function track(name, total, items, onPick, sel) {
  const lane = h('div', { class: 'vs-lane', style: `position:relative;height:30px;width:${Math.ceil(total * PX)}px;background:var(--paper);border:1px solid var(--line);border-radius:6px` },
    items.map((it) => h('button', { type: 'button', class: 'vs-item' + (sel === it.key ? ' sel' : ''), 'data-vs-item': it.key, title: it.title || it.label, onclick: () => onPick(it),
      style: `position:absolute;left:${it.start * PX}px;width:${Math.max(6, (it.end - it.start) * PX)}px;top:2px;height:24px;overflow:hidden;font-size:10px;padding:0 3px;border-radius:5px;border:1px solid #bfae8f;background:${it.color || '#e7ddc9'};white-space:nowrap` }, it.label)));
  return h('div', { class: 'row', style: 'gap:8px;align-items:center;flex-wrap:nowrap' }, h('div', { class: 'small', style: 'width:64px;flex:none', 'data-vs-track': name }, name), lane);
}

export function timelineTab(ep, rerender) {
  const plan = ep.derived.render.plan;
  const tl = plan.timeline;
  if (!tl.lines.length && !tl.scenes.length) return h('p', { class: 'muted' }, '음성을 만들면 타임라인이 표시됩니다.');
  const total = tl.total || 1;
  const sel = ui().vsSel || '';
  const pick = (it) => { ui().vsSel = it.key; rerender(); };
  const sceneStart = (id) => (tl.scenes.find((s) => s.id === id) || { start: 0 }).start;
  const scenes = tl.scenes.map((s) => ({ key: 'scene:' + s.id, start: s.start, end: s.end, label: s.id + (s.extended ? ' ↔' : ''), color: s.extended ? '#ead4bf' : '#e7ddc9', title: `${s.id} ${s.start}–${s.end}s` }));
  const voice = tl.lines.map((l) => ({ key: 'line:' + l.id, start: l.start, end: l.end, label: l.speaker, color: l.speaker === 'diane' ? '#e6c3a6' : '#cfdcc2', title: `${l.id} ${l.start}–${l.end}s` }));
  const sfx = (ep.sfx || []).filter((x) => x.sceneId).map((x) => ({ key: 'sfx:' + x.id, start: sceneStart(x.sceneId) + Number(x.offsetSec || 0), end: sceneStart(x.sceneId) + Number(x.offsetSec || 0) + Math.max(0.3, Number(x.durationSec || 0.4)), label: x.label, color: '#c9d6e4', title: `${x.label} @${x.offsetSec}s` }));
  const broll = (ep.broll || []).filter((b) => b.status === 'approved' && b.sceneId).map((b) => ({ key: 'broll:' + b.id, start: sceneStart(b.sceneId) + Number(b.insertAtSec || 0), end: sceneStart(b.sceneId) + Number(b.insertAtSec || 0) + Number(b.durationSec || 1), label: b.id, color: '#dccfe6' }));
  const subs = (plan.cues || []).map((c) => ({ key: 'cue:' + c.lineId, start: c.start, end: c.end, label: c.hidden ? '(숨김)' : String(c.ko || '').slice(0, 14), color: c.hidden ? '#eee' : '#f3e7c4', title: c.ko }));
  const ruler = h('div', { class: 'row', style: 'gap:8px;align-items:center' }, h('div', { style: 'width:64px;flex:none' }), h('div', { style: `position:relative;height:16px;width:${Math.ceil(total * PX)}px;font-size:10px;color:var(--muted)` }, Array.from({ length: Math.floor(total / 3) + 1 }, (_, i) => h('span', { style: `position:absolute;left:${i * 3 * PX}px` }, fmtSec(i * 3)))));
  const lanes = h('div', { class: 'stack', style: 'gap:6px;min-width:max-content', 'data-vs-timeline': '' }, ruler,
    track('장면', total, scenes, pick, sel), track('음성', total, voice, pick, sel), track('효과음', total, sfx, pick, sel), track('B-roll', total, broll, pick, sel), track('자막', total, subs, pick, sel),
    h('div', { class: 'row', style: 'gap:8px;align-items:center' }, h('div', { class: 'small', style: 'width:64px;flex:none' }, '음악'), h('div', { class: 'small muted', 'data-vs-music': '' }, '배경음악 트랙 없음 — 이 버전은 음악 파일을 만들거나 가져오지 않습니다.')));
  return h('div', { class: 'stack', style: 'gap:12px' },
    h('div', { class: 'small muted' }, `총 ${fmtSec(total)} · 편집 단위 ${STEP}초. 승인된 대사 오디오의 타이밍은 여기서 바꾸지 않습니다 (대사를 고치려면 대본·음성 단계로).`),
    h('div', { style: 'overflow-x:auto;padding-bottom:6px' }, lanes),
    selectedEditor(ep, tl, sel, rerender));
}

function numField(label, value, attrs, onchange) {
  return h('label', { class: 'field', style: 'min-width:110px' }, h('span', { class: 'small' }, label), h('input', Object.assign({ type: 'number', value, onchange: (e) => onchange(Number(e.target.value)) }, attrs)));
}

function selectedEditor(ep, tl, sel, rerender) {
  if (!sel) return h('div', { class: 'small muted' }, '타임라인의 항목을 눌러 편집하세요.');
  const [kind, id] = sel.split(':');
  const body = (...c) => h('div', { class: 'card stack', style: 'gap:8px', 'data-vs-editor': kind }, ...c);
  if (kind === 'sfx') {
    const x = (ep.sfx || []).find((s) => s.id === id);
    if (!x) return null;
    const fl = flowOf(ep, x.sceneId);
    const upd = (patch) => act(() => api.post(`/api/episodes/${ep.id}/sfx/${id}/update`, patch), { ok: '효과음을 바꿨습니다' });
    return body(h('b', null, `효과음 · ${x.label} (${x.sceneId})`),
      fl && fl.final.state === 'approved' ? h('div', { class: 'issue warn' }, '이 씬은 최종 승인된 상태입니다. 효과음을 바꾸면 씬 승인이 무효가 되어 다시 합쳐 승인해야 합니다.') : null,
      h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
        numField('씬 시작 후 (초)', x.offsetSec, { step: STEP, min: 0, 'data-vs-sfx-offset': id }, (v) => upd({ offsetSec: snap(v) })),
        numField('볼륨 (dB)', x.gainDb, { step: 1, min: -30, max: 6, 'data-vs-sfx-gain': id }, (v) => upd({ gainDb: v })),
        numField('페이드 인 (초)', x.fadeInSec || 0, { step: 0.1, min: 0, max: 2, 'data-vs-sfx-fadein': id }, (v) => upd({ fadeInSec: v })),
        numField('페이드 아웃 (초)', x.fadeOutSec || 0, { step: 0.1, min: 0, max: 2, 'data-vs-sfx-fadeout': id }, (v) => upd({ fadeOutSec: v }))),
      h('audio', { controls: true, preload: 'none', src: `/media/sfx/${ep.id}/${id}`, style: 'height:32px' }));
  }
  if (kind === 'line') {
    const l = tl.lines.find((s) => s.id === id);
    if (!l) return null;
    return body(h('b', null, `대사 오디오 · ${l.speaker} (${l.id})`), h('div', null, l.en), h('div', { class: 'small muted' }, l.ko),
      h('div', { class: 'small' }, `${l.start}–${l.end}초 (${r2(l.duration)}초) · 승인된 오디오 — 이 화면에서 타이밍이 바뀌지 않습니다.`),
      h('audio', { controls: true, preload: 'none', src: `/media/audio/${ep.id}/${l.id}`, style: 'height:32px' }));
  }
  if (kind === 'cue') return subtitleRow(ep, (ep.derived.render.plan.cues || []).find((c) => c.lineId === id), rerender, true);
  if (kind === 'scene') {
    const s = tl.scenes.find((x) => x.id === id);
    return s ? body(h('b', null, `${s.id} · ${s.title || ''}`), h('div', { class: 'small' }, `${s.start}–${s.end}초 (${s.duration}초)${s.extended ? ` · 대사가 길어 계획 ${s.plannedSec}초에서 늘어남` : ''}`)) : null;
  }
  return body(h('b', null, 'B-roll ' + id), h('div', { class: 'small muted' }, 'B-roll 위치는 이미지 스튜디오·대본 스튜디오에서 편집합니다 (승인 상태 보호).'));
}

// ------------------------------------------------------------ 3. subtitles
function subtitleRow(ep, c, rerender, standalone) {
  if (!c) return null;
  const base = `/api/episodes/${ep.id}/video-edit/subtitles/${c.lineId}`;
  const put = (patch) => act(() => api.put(base, patch), { ok: '자막을 저장했습니다' });
  const ko = h('textarea', { rows: 2, 'data-vs-cue-ko': c.lineId, 'aria-label': '한국어 자막' }, c.ko);
  const en = h('textarea', { rows: 2, 'data-vs-cue-en': c.lineId, 'aria-label': 'English subtitle' }, c.en);
  return h('div', { class: 'card flat stack', style: 'gap:6px', 'data-vs-cue': c.lineId, 'data-vs-cue-hidden': c.hidden ? '1' : '0' },
    h('div', { class: 'row between', style: 'flex-wrap:wrap;gap:6px' }, h('b', { class: 'small' }, `${c.lineId} · ${c.speaker} · ${r2(c.start)}–${r2(c.end)}초`),
      c.edited ? chip('수정됨', 'mock') : null),
    h('div', { class: 'grid two', style: 'gap:6px' }, h('label', { class: 'field' }, h('span', { class: 'small' }, '한국어'), ko), h('label', { class: 'field' }, h('span', { class: 'small' }, 'English'), en)),
    h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;align-items:flex-end' },
      numField('시작 이동 (초)', r2(c.start - c.audioStart), { step: STEP, 'data-vs-cue-start': c.lineId }, (v) => put({ startShift: snap(v) })),
      numField('끝 이동 (초)', r2(c.end - (c.audioEnd + 0.15)), { step: STEP, 'data-vs-cue-end': c.lineId }, (v) => put({ endShift: snap(v) })),
      h('label', { class: 'row small', style: 'gap:6px' }, h('input', { type: 'checkbox', checked: c.hidden, 'data-vs-cue-hide': c.lineId, onchange: (e) => put({ hidden: e.target.checked }) }), '숨기기'),
      h('button', { class: 'btn sm', type: 'button', 'data-vs-cue-save': c.lineId, onclick: () => put({ ko: ko.value, en: en.value }) }, '텍스트 저장'),
      c.edited ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => act(() => api.del(base), { ok: '원래 자막으로 되돌렸습니다' }) }, '원래대로') : null));
}

export function subtitlesTab(ep, rerender) {
  const plan = ep.derived.render.plan;
  const st = ep.videoEdit.style;
  const cues = plan.cues || [];
  const putStyle = (patch) => act(() => api.put(`/api/episodes/${ep.id}/video-edit/style`, patch), { ok: '자막 스타일을 저장했습니다' });
  const pv = ui().vsPreviewCue || (cues[0] && cues[0].lineId);
  const cur = cues.find((c) => c.lineId === pv) || cues[0];
  const txt = cur ? (st.lang === 'en' ? cur.en : st.lang === 'both' ? `${cur.ko}\n${cur.en}` : cur.ko) : '';
  const phone = h('div', { class: 'phone', 'data-vs-phone': '', style: 'position:relative;width:200px;aspect-ratio:9/16;background:#3a2f26;border-radius:14px;overflow:hidden' },
    cur ? h('div', { 'data-vs-caption': '', style: `position:absolute;left:6%;right:6%;top:${st.yFrac * 100}%;transform:translateY(-50%);text-align:center;color:#fff;font-size:${Math.round(((st.fontSize || 60) / 1080) * 200)}px;line-height:1.25;white-space:pre-line;text-shadow:0 1px 3px #000` }, txt) : null);
  return h('div', { class: 'split', 'data-vs-subtitles': '' },
    h('div', { class: 'stack', style: 'gap:10px' },
      plan.subtitleChecks.length ? h('div', { class: 'stack', style: 'gap:4px', 'data-vs-sub-checks': '' }, plan.subtitleChecks.map((c) => h('div', { class: 'issue ' + (/HIDDEN/.test(c.code) ? 'warn' : 'err'), 'data-sub-check': c.code }, c.message))) : null,
      cues.length ? cues.map((c) => subtitleRow(ep, c, rerender)) : h('p', { class: 'muted' }, '음성을 만들면 자막 편집이 가능합니다.')),
    h('div', { class: 'stack', style: 'gap:10px;align-items:center;position:sticky;top:12px' },
      phone,
      cues.length ? h('select', { 'data-vs-preview-cue': '', 'aria-label': '미리보기 자막', onchange: (e) => { ui().vsPreviewCue = e.target.value; rerender(); } }, cues.map((c) => h('option', { value: c.lineId, selected: c.lineId === (cur && cur.lineId) }, c.lineId))) : null,
      h('div', { class: 'card stack', style: 'gap:8px;width:100%' }, h('b', { class: 'small' }, '자막 스타일'),
        h('div', { class: 'seg' }, [['ko', '한국어'], ['en', 'English'], ['both', '둘 다']].map(([k, l]) => h('button', { type: 'button', 'data-vs-lang': k, 'aria-pressed': String(st.lang === k), onclick: () => putStyle({ lang: k }) }, l))),
        numField('위치 (화면 높이 %)', Math.round(st.yFrac * 100), { step: 2, min: 30, max: 90, 'data-vs-ypos': '' }, (v) => putStyle({ yFrac: v / 100 })),
        numField('글자 크기 (비우면 설정값)', st.fontSize || '', { step: 2, min: 30, max: 120, placeholder: '기본', 'data-vs-fontsize': '' }, (v) => putStyle({ fontSize: v || null })),
        h('div', { class: 'small muted' }, '미리보기는 근사치입니다. 실제 글꼴과 줄바꿈은 "최종 렌더" 탭의 미리보기 렌더(540×960)에서 확인하세요.'))));
}

// ------------------------------------------------------------ 4. sound
export function soundTab(ep, rerender) {
  const mix = ep.videoEdit.mix;
  const putMix = (patch) => act(() => api.put(`/api/episodes/${ep.id}/video-edit/mix`, patch), { ok: '믹스를 저장했습니다' });
  const list = (ep.sfx || []).filter((x) => x.sceneId);
  return h('div', { class: 'stack', style: 'gap:14px', 'data-vs-sound': '' },
    h('div', { class: 'card stack', style: 'gap:8px' }, h('b', null, '밸런스 (최종 렌더에 적용)'),
      h('div', { class: 'row', style: 'gap:12px;flex-wrap:wrap' },
        numField('음성 볼륨 (dB)', mix.voiceDb, { step: 1, min: -18, max: 12, 'data-vs-mix-voice': '' }, (v) => putMix({ voiceDb: v })),
        numField('효과음 전체 볼륨 (dB)', mix.sfxDb, { step: 1, min: -18, max: 12, 'data-vs-mix-sfx': '' }, (v) => putMix({ sfxDb: v }))),
      h('div', { class: 'small muted' }, '최종 믹스는 마지막에 loudnorm(-16 LUFS)으로 정리됩니다. 씬 합본(미리보기)에는 이 전체 볼륨이 적용되지 않습니다. 승인된 음성의 길이·위치는 바뀌지 않습니다.')),
    h('div', { class: 'card stack', style: 'gap:8px' }, h('b', null, '효과음 배치'),
      list.length ? list.map((x) => h('div', { class: 'row between', style: 'gap:8px;flex-wrap:wrap', 'data-vs-sfx-row': x.id }, h('span', null, `${x.sceneId} · ${x.label} · ${x.offsetSec}s · ${x.gainDb}dB` + (x.fadeInSec || x.fadeOutSec ? ` · 페이드 ${x.fadeInSec || 0}/${x.fadeOutSec || 0}s` : '')),
        h('div', { class: 'row', style: 'gap:6px' }, h('audio', { controls: true, preload: 'none', src: `/media/sfx/${ep.id}/${x.id}`, style: 'height:30px' }),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { ui().vsSel = 'sfx:' + x.id; setVideoTab(ep, 'timeline', rerender); } }, '타임라인에서 편집'))))
        : h('div', { class: 'small muted' }, '효과음이 없습니다. 애니메이션 스튜디오의 효과음 단계에서 추가하세요.')));
}

// ------------------------------------------------------------ pre-render checklist
export function finalChecklist(ep) {
  const plan = ep.derived.render.plan;
  const flows = ep.scenes.map((s) => flowOf(ep, s.id));
  const items = [
    { key: 'scenes', label: '모든 장면 최종 승인', ok: flows.every((f) => f && f.final.state === 'approved'), detail: flows.filter((f) => !f || f.final.state !== 'approved').length + '개 남음' },
    { key: 'audio', label: '모든 대사 오디오 승인', ok: flows.every((f) => f && ['approved', 'silent'].includes(f.audio.state)) },
    { key: 'sfx', label: '효과음 결정 (계획 승인 또는 없음)', ok: flows.every((f) => f && f.gate && ['approved', 'none'].includes(f.gate.sfx.state)) },
    { key: 'subs', label: '자막 오류 없음', ok: !plan.subtitleChecks.some((c) => !/HIDDEN/.test(c.code)), detail: plan.subtitleChecks.filter((c) => !/HIDDEN/.test(c.code)).length + '건' },
    { key: 'problems', label: '렌더 차단 항목 없음', ok: plan.canRender, detail: plan.problems.length + '건' },
    { key: 'paid', label: '이 단계는 유료 호출이 없습니다 (FFmpeg 로컬 렌더)', ok: true },
  ];
  return { items, ok: items.every((i) => i.ok) };
}

export function checklistCard(ep) {
  const c = finalChecklist(ep);
  return h('div', { class: 'card stack', style: 'gap:6px', 'data-vs-checklist': '', 'data-vs-ready': c.ok ? '1' : '0' }, h('b', null, '렌더 전 점검'),
    h('ul', { style: 'margin:0;padding-left:18px' }, c.items.map((i) => h('li', { 'data-vs-check': i.key, 'data-vs-check-ok': i.ok ? '1' : '0', style: i.ok ? '' : 'color:var(--clay)' }, (i.ok ? '✓ ' : '✗ ') + i.label + (!i.ok && i.detail ? ` — ${i.detail}` : '')))));
}
