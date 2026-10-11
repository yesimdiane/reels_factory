// Scene video-prompt generation.
//   template : free, deterministic (prompts.js). Never calls an API.
//   gemini   : multimodal. Sends the APPROVED character reference sheets (real image bytes, inlineData) of the
//              characters selected in each scene, plus the approved script/storyboard, and asks for the creative
//              sections only (camera, actions, environment, lighting, continuity, negative additions).
//              Code then assembles the final prompt: house style, exact cast count, identity, verified product block,
//              duration/format and the mandatory character-sheet rule are added by CODE, never trusted to the model.
// A Gemini call is billable (price not known to the Studio), so it needs an explicit operator click (confirmAi).
// Nothing is saved if validation fails; edited prompts are never overwritten unless force is set.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { StudioError, nowIso, sha256 } = require('./util');
const { isScriptApproved } = require('./episode');
const { buildScenePromptParts, buildNegativePrompt, lintPrompt } = require('./prompts');
const { lintCast, SHEET_RULE } = require('./charrules');
const { clipSecFor, modelById } = require('./budget');

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const SECTION_KEYS = ['camera', 'actions', 'environment', 'lighting', 'continuity'];

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    scenes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          scene_id: { type: 'STRING' },
          camera: { type: 'STRING' },
          actions: { type: 'STRING' },
          environment: { type: 'STRING' },
          lighting: { type: 'STRING' },
          continuity: { type: 'STRING' },
          negative_additions: { type: 'STRING' },
        },
        required: ['scene_id', 'camera', 'actions', 'environment', 'lighting', 'continuity'],
      },
    },
  },
  required: ['scenes'],
};

function geminiInstruction(ep, scenes, lib, clipSecOf) {
  const sceneBlocks = scenes.map((s) => {
    const lines = (ep.lines || []).filter((l) => l.sceneId === s.id);
    return [
      `SCENE ${s.id} — ${s.title} (${s.durationSec}s planned, clip ${clipSecOf(s)}s)`,
      `Scene description (approved): ${s.visual}`,
      `Characters selected in the editor: ${(s.characters || []).length ? s.characters.map((c) => (lib.characters.find((x) => x.id === c) || { name: c }).name).join(' + ') : 'NONE'}`,
      `Product visible: ${s.showsProduct ? 'YES' : 'NO'}`,
      lines.length ? 'Approved dialogue in this scene (for acting/expressions only): ' + lines.map((l) => `${l.speaker}: "${l.en}"`).join(' / ') : 'No dialogue.',
    ].join('\n');
  }).join('\n\n');
  return [
    'You write image-to-video prompts for a hand-drawn 2D Korean webtoon / anime Instagram Reel (vertical 9:16). Output JSON only.',
    'For each scene return concise English text for: camera (movement and framing), actions (what each selected character does, expressions), environment, lighting (light + visual style), continuity (what must match the previous scene), negative_additions (extra things to avoid, optional).',
    '',
    'CHARACTER REFERENCE SHEETS — CRITICAL:',
    '- The attached images are master character SHEETS. Each sheet shows ONE individual many times (portraits, expressions, outfits, close-ups, colour palette, poses, example scenes). They are identity guides, NOT scene layouts.',
    '- NEVER interpret multiple drawings on a sheet as several people. NEVER describe a sheet, collage, grid, turnaround, labels, flags, colour swatches or speech bubbles as part of the scene.',
    '- Do not mix outfits/poses/expressions from the sheet. Choose outfit, pose, expression and setting from the approved scene description only.',
    '- Include ONLY the characters selected for that scene: exactly one Diane and/or exactly one Jack; two people if both are selected; none if none are selected. Never mention an unselected character as present.',
    '- Do not invent product features. Only the product facts given below may be shown, and only when "Product visible" is YES.',
    '- Do not add on-screen text, subtitles, logos or speech bubbles.',
    '',
    'PRODUCT (verified): ' + (ep.product.visualSummary || (ep.product.verifiedFeatures || []).join('; ')),
    'Forbidden product claims: ' + ((ep.product.forbiddenClaims || []).join(', ') || 'none'),
    '',
    'APPROVED STORYBOARD:',
    sceneBlocks,
  ].join('\n');
}

function createPromptService({ store, cfg, geminiFactory = null, clientFactory = null, available = null, composeExtra = null, log = () => {} }) {
  const lib = () => store.characters.load();

  function usesSheetFor(scene, L) {
    return (scene.characters || []).some((id) => {
      const c = L.characters.find((x) => x.id === id);
      return c && c.references.some((r) => r.approved && r.isSheet !== false);
    });
  }

  function status() {
    return { template: true, gemini: { available: !!geminiFactory || (available ? !!available() : !!cfg.geminiApiKey), model: cfg.geminiModel, billable: true } };
  }

  function collectImages(ep, scenes, L) {
    const used = new Map(); // key → {label, mimeType, data, sha}
    const missing = [];
    scenes.forEach((s) => (s.characters || []).forEach((cid) => {
      const c = L.characters.find((x) => x.id === cid);
      const ref = c && c.references.find((r) => r.approved);
      if (!ref) return missing.push(`${s.id}: ${c ? c.name : cid}`);
      if (used.has(ref.id)) return;
      const file = store.characters.refPath(cid, ref);
      const buf = fs.readFileSync(file);
      used.set(ref.id, { label: `Character sheet for ${c.name} (ONE person, identity reference only):`, mimeType: MIME[path.extname(file).toLowerCase()] || 'image/png', data: buf.toString('base64'), sha: ref.sha256 });
    }));
    return { images: Array.from(used.values()), missing };
  }

  function compose(ep, scene, L, clipSec, over, negExtra, idx) {
    const prev = idx > 0 ? ep.scenes[idx - 1] : null;
    const parts = buildScenePromptParts(ep, scene, L, clipSec, { prev, usesSheet: usesSheetFor(scene, L), sections: over });
    const negBase = buildNegativePrompt(ep, scene, L);
    const sheetNeg = (scene.characters || []).length ? ', character sheet, reference sheet, collage, expression grid, turnaround, text labels, flags, color swatches, speech bubbles, duplicate characters, twins, extra people' : ', Diane, Jack, any human characters';
    return { video: parts.text, negative: negBase + sheetNeg + (negExtra ? ', ' + String(negExtra).replace(/^[,\s]+|[,\s]+$/g, '') : ''), sections: parts.sections };
  }

  /**
   * options: { sceneIds, mode: 'template'|'gemini', confirmAi, force }
   * Returns the list of {sceneId, source}; throws (saving nothing) when the AI output breaks a rule.
   */
  async function generate(epId, { sceneIds, mode = 'template', confirmAi = false, force = false, by = 'operator' } = {}) {
    const ep0 = store.episodes.get(epId);
    if (!isScriptApproved(ep0)) throw new StudioError('SCRIPT_NOT_APPROVED', '대본이 승인된 뒤에 프롬프트를 만들 수 있습니다.', { recovery: '대본 스튜디오에서 대본을 승인하세요.', status: 409 });
    const L = lib();
    const settings = store.settings.get();
    const model = modelById(store.models(), settings.defaultModelId);
    const scenes = ep0.scenes.filter((s) => !sceneIds || !sceneIds.length || sceneIds.includes(s.id));
    if (!scenes.length) throw new StudioError('NO_SCENES', '대상 장면이 없습니다.');
    const clipSecOf = (s) => clipSecFor(model, s.durationSec);
    const todo = scenes.filter((s) => force || !(ep0.prompts[s.id] && ep0.prompts[s.id].edited));
    const skipped = scenes.filter((s) => !todo.includes(s)).map((s) => s.id);
    let ai = null;
    let aiMeta = null;
    let extra = null;
    if (mode === 'gemini') {
      if (!confirmAi) throw new StudioError('CONFIRM_REQUIRED', 'Gemini 호출은 유료일 수 있습니다. 확인 후 다시 실행하세요.', { recovery: '"AI로 만들기"에서 비용 안내를 확인하고 승인하세요.', status: 409 });
      if (!todo.length) throw new StudioError('NOTHING_TO_DO', '수정한 프롬프트만 있어 AI가 만들 장면이 없습니다.', { recovery: '덮어쓰기를 선택하거나 장면을 지정하세요.' });
      const { images, missing } = collectImages(ep0, todo, L);
      if (missing.length) throw new StudioError('NO_APPROVED_REFERENCE', '승인된 캐릭터 참조 이미지가 없는 장면이 있습니다: ' + missing.join(', '), { recovery: '설정 → 캐릭터 라이브러리에서 참조 이미지를 올리고 승인하세요. (참조 없이 AI가 캐릭터를 추측하게 하지 않습니다.)', status: 409 });
      const client = geminiFactory ? geminiFactory() : clientFactory ? clientFactory() : require('../../renderer/lib/gemini').createGeminiClient({ apiKey: cfg.geminiApiKey, model: cfg.geminiModel });
      extra = composeExtra ? composeExtra() : null;
      let out;
      try {
        out = await client.generateJson({ prompt: geminiInstruction(ep0, todo, L, clipSecOf) + (extra && extra.text ? '\n\nOPERATOR PROMPT (editable in Settings → Prompt Manager; the CHARACTER SHEET and PRODUCT rules above always win):\n' + extra.text : ''), images, schema: SCHEMA });
      } catch (e) {
        throw new StudioError('GEMINI_FAILED', String(e.message || e).replace(cfg.geminiApiKey || '\u0000', '[redacted]').slice(0, 400), { recovery: 'Gemini API 키/모델을 확인하거나 "템플릿으로 만들기"(무료)를 사용하세요. 기존 프롬프트는 바뀌지 않았습니다.', status: 502 });
      }
      ai = new Map(((out && out.scenes) || []).map((x) => [x.scene_id, x]));
      aiMeta = { model: client.model || cfg.geminiModel, provider: client.provider || 'gemini', promptVersions: extra ? extra.versions : undefined, imageShas: images.map((i) => i.sha), at: nowIso() };
    }
    const results = [];
    const staged = {};
    const problems = [];
    todo.forEach((s) => {
      const idx = ep0.scenes.findIndex((x) => x.id === s.id);
      let over = null;
      let neg = '';
      let source = 'template';
      if (ai) {
        const g = ai.get(s.id);
        if (!g || SECTION_KEYS.some((k) => !String(g[k] || '').trim())) {
          problems.push({ sceneId: s.id, code: 'AI_INCOMPLETE', message: `${s.id}: Gemini 응답에 필요한 항목이 없습니다.` });
          return;
        }
        over = Object.fromEntries(SECTION_KEYS.map((k) => [k, String(g[k]).trim()]));
        neg = g.negative_additions || '';
        source = 'gemini';
      }
      const c = compose(ep0, s, L, clipSecOf(s), over, neg, idx);
      if (source === 'gemini') {
        const body = SECTION_KEYS.map((k) => over[k]).join('\n') + '\n' + neg;
        const bad = lintPrompt(body, ep0).map((w) => ({ code: 'PRODUCT_CLAIM', message: `확인되지 않은 제품 주장 "${w}"` }));
        const castBad = lintCast(body, s, L);
        bad.concat(castBad).forEach((b) => problems.push({ sceneId: s.id, code: b.code, message: `${s.id}: ${b.message}` }));
      }
      staged[s.id] = { video: c.video, negative: c.negative, sections: c.sections, source, edited: false, builtAt: nowIso(), ai: source === 'gemini' ? aiMeta : undefined, castIds: (s.characters || []).slice(), usedSheetRule: c.video.includes(SHEET_RULE) };
      results.push({ sceneId: s.id, source });
    });
    if (problems.length) throw new StudioError('AI_OUTPUT_REJECTED', problems[0].message, { details: problems, recovery: 'AI가 만든 프롬프트가 규칙(캐릭터 수, 제품 주장, 시트 재현 금지)을 어겨 저장하지 않았습니다. 다시 만들거나 템플릿을 사용하세요. 기존 프롬프트는 그대로입니다.', status: 422 });
    await store.episodes.update(epId, (ep) => {
      Object.keys(staged).forEach((id) => {
        const cur = ep.prompts[id];
        const hist = (cur && cur.history ? cur.history : []).slice(-4);
        if (cur && cur.video) hist.push({ video: cur.video, negative: cur.negative, source: cur.source || 'template', edited: !!cur.edited, at: cur.editedAt || cur.builtAt });
        ep.prompts[id] = Object.assign({}, staged[id], { history: hist });
      });
    });
    store.episodes.audit(epId, 'storyboard.prompts_generated', { mode, scenes: results.map((r) => r.sceneId), skippedEdited: skipped, by });
    return { results, skippedEdited: skipped };
  }

  return { generate, status, usesSheetFor };
}

module.exports = { createPromptService, geminiInstruction, SCHEMA };
