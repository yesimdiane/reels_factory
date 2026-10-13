// Rendering Readiness: ONE free, read-only check that lists every specific reason a video cannot be generated or rendered yet,
// grouped by what the operator has to do. Replaces "rendering failed" with the exact blocker.
//   stage 'generate' = what the video model needs per scene (approved script/storyboard, start image, prompt, animation, references, provider)
//   stage 'render'   = what the final FFmpeg render needs (approved clips, valid files, audio, approved B-roll images)
// Nothing here calls a provider or writes anything.
'use strict';
const fs = require('node:fs');
const { isScriptApproved } = require('./episode');
const { isGeneric } = require('./animdraft');

const CATS = [
  ['script', '승인된 대본'], ['images', '장면 이미지 (시작 프레임)'], ['animation', '애니메이션 타임라인'], ['prompt', '영상 생성 프롬프트'],
  ['references', '캐릭터 참조 이미지'], ['provider', '렌더링 제공자'], ['assets', '파일 경로 · 권한'], ['clips', '승인된 영상 클립 · 오디오'],
];

function createRenderReadiness({ store, gen, charRefs, animplan, sba, renderer, providerMode, getModel }) {
  const readable = (f) => { try { fs.accessSync(f, fs.constants.R_OK); return true; } catch (_) { return false; } };

  function check(ep) {
    const items = [];
    const add = (cat, severity, code, message, recovery = '', sceneId = '', stage = 'generate') => items.push({ cat, severity, code, message, recovery, sceneId, stage });
    const scenes = ep.scenes || [];
    const mode = providerMode();

    // script
    if (!isScriptApproved(ep)) add('script', 'block', 'SCRIPT_NOT_APPROVED', '대본이 승인되지 않았거나 승인 후 수정되었습니다.', 'Script Studio에서 대본을 승인하세요.');

    // everything the generation gate already knows (storyboard approval, start image, approval, placeholders, sheet, prompts, model)
    const MAP = { SCRIPT_NOT_APPROVED: null, STORYBOARD_NOT_APPROVED: 'script', NO_PROMPT: 'prompt', NO_START_IMAGE: 'images', START_IMAGE_NOT_APPROVED: 'images', SHEET_AS_START_FRAME: 'images', PLACEHOLDER_IMAGE: 'images', MODEL_UNVERIFIED: 'provider' };
    let blockers = [];
    try { blockers = gen.blockers(ep, scenes, getModel()); } catch (e) { add('provider', 'block', 'MODEL_CHECK_FAILED', '영상 모델 설정을 확인하지 못했습니다: ' + e.message, 'Settings에서 영상 모델을 선택하세요.'); }
    blockers.forEach((b) => {
      const cat = MAP[b.code];
      if (cat === null || cat === undefined && /^CHARACTER_REF/.test(b.code)) return; // covered below
      const sid = (/^(S\d+|E\d+|[A-Z]\d+):/.exec(b.message) || [])[1] || '';
      add(cat || 'provider', 'block', b.code, b.message, b.recovery, sid);
    });

    // animation timeline
    scenes.forEach((sc) => {
      const m = ep.motion && ep.motion[sc.id];
      if (!m || !m.beats || !m.beats.length) return add('animation', 'block', 'NO_ANIMATION', `${sc.id}: 애니메이션 타임라인이 없습니다.`, 'Storyboard → 애니메이션에서 "애니메이션 자동 생성"을 누르세요.', sc.id);
      const { problems } = sba.cleanBeats(m.beats, sc);
      problems.slice(0, 3).forEach((p) => add('animation', 'block', 'INVALID_ANIMATION', `${sc.id}: ${p.message}`, '비트를 고치거나 "애니메이션 자동 생성"으로 다시 만드세요.', sc.id));
      const covered = m.beats.reduce((mx, b) => Math.max(mx, b.t1), 0);
      if (!problems.length && covered < Number(sc.durationSec) - 1e-6) add('animation', 'warn', 'ANIMATION_SHORT', `${sc.id}: 타임라인이 ${covered}초에서 끝납니다 (장면 ${sc.durationSec}초). 마지막은 정지 유지로 처리됩니다.`, '', sc.id);
      const gen2 = m.beats.filter(isGeneric).length;
      if (gen2) add('animation', 'warn', 'ANIMATION_GENERIC', `${sc.id}: ${gen2}개 비트가 일반적인 자리표시 문구입니다 (neutral, holds the opening pose …).`, '"애니메이션 자동 생성"으로 대본에 맞는 비트를 만드세요.', sc.id);
    });

    // video prompt
    scenes.forEach((sc) => {
      const p = ep.prompts && ep.prompts[sc.id];
      if (p && String(p.video || '').trim() && String(p.video).trim().length < 30) add('prompt', 'block', 'PROMPT_TOO_SHORT', `${sc.id}: 영상 프롬프트가 너무 짧습니다.`, 'Storyboard에서 프롬프트를 보강하세요.', sc.id);
    });

    // character references (always: they define the start frame and the identity of the video)
    charRefs.validate(ep, scenes).problems.forEach((p) => add('references', 'block', p.code, p.message, '캐릭터 라이브러리에서 실제 참조 이미지를 올리고 승인하거나 장면의 "캐릭터 참조 이미지"에서 고르세요.', p.sceneId));

    // provider
    const caps = animplan.capabilities(mode);
    if (mode !== 'live') add('provider', 'warn', 'PROVIDER_MOCK', 'MOCK 모드입니다: 실제 캐릭터 애니메이션 없이 확인용 샘플 클립만 만들어집니다. ' + caps.providerAnimation.note, 'Settings에서 영상 제공자(Muapi) 키와 RF_STUDIO_VIDEO_MODE=live를 설정하세요.');
    add('provider', 'info', 'CAPABILITIES', `제공자 애니메이션: ${caps.providerAnimation.available ? '사용 가능' : '사용 불가(MOCK)'} · 로컬 효과: ${caps.localEffects.note}`);

    // asset paths and permissions
    scenes.forEach((sc) => {
      const img = gen.startImage(ep, sc);
      if (!img.error && !readable(img.file)) add('assets', 'block', 'ASSET_UNREADABLE', `${sc.id}: 시작 이미지 파일을 읽을 수 없습니다 (경로 또는 권한).`, '파일을 다시 올리거나 서버 볼륨 권한을 확인하세요.', sc.id);
    });
    try { fs.accessSync(store.episodes.file(ep.id, '.'), fs.constants.W_OK); } catch (_) { add('assets', 'block', 'DIR_NOT_WRITABLE', '에피소드 폴더에 쓸 수 없습니다.', '서버의 /data 볼륨 권한을 확인하세요.'); }

    // final render stage (approved clips, valid files, audio, B-roll files)
    let plan = { problems: [] };
    try { plan = renderer.plan(ep.id); } catch (_) { /* readiness stays usable */ }
    plan.problems.forEach((p) => add(p.code === 'NO_AUDIO' || /^CLIP|^CUTS|^BROLL/.test(p.code) ? 'clips' : 'assets', 'block', p.code, p.message, p.recovery || '', (/^(\w+\d+):/.exec(p.message) || [])[1] || '', 'render'));

    const gate = (stage) => !items.some((i) => i.severity === 'block' && i.stage === stage);
    const blocking = items.filter((i) => i.severity === 'block');
    const byCat = CATS.map(([key, label]) => ({ key, label, blocking: blocking.filter((i) => i.cat === key).length, warnings: items.filter((i) => i.cat === key && i.severity === 'warn').length }));
    return { canGenerateVideo: gate('generate'), canRender: items.every((i) => i.severity !== 'block'), blocking: blocking.length, warnings: items.filter((i) => i.severity === 'warn').length, categories: byCat, items, mode, capabilities: caps };
  }
  return { check };
}

module.exports = { createRenderReadiness, CATS };
