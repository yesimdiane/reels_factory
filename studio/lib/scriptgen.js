// Script generation from an APPROVED story concept (Script Studio entry point).
//   * refuses unless the concept is approved at its current revision
//   * writes the draft into an episode (scene-by-scene dialogue, narration, actions, timing, visual direction, product placement, CTA)
//   * records ep.concept (traceability) and ep.scriptSource (provider/model/prompt versions); every generation is a numbered version
//   * never overwrites an existing script without overwrite:true; never approves anything itself
'use strict';
const { StudioError, nowIso } = require('./util');
const fs = require('node:fs');
const path = require('node:path');
const { validateScript, checkTitleKo, isScriptApproved } = require('./episode');
const F = require('./formula');
const SF = require('./scriptformula');
const { sha256, uid } = require('./util');

function createScriptGen({ store, products, storylab, prompts, presets, endings, router, lib }) {
  function episodeIdFor(pid) {
    const used = store.episodes.list().map((e) => e.id).filter((i) => i.startsWith(pid + '-R')).map((i) => Number(i.slice(pid.length + 2))).filter(Number.isFinite);
    return `${pid}-R${String((used.length ? Math.max(...used) : 1) + 1).padStart(2, '0')}`;
  }

  /** Creates an (empty) episode bound to an approved concept. Product facts are copied from the verified product record. */
  async function createEpisodeFromConcept(pid, cid, { id, newVersion = false } = {}) {
    const concept = storylab.requireApproved(pid, cid);
    const b = products.bindingFor(pid);
    const p = b.product;
    // A concept that already produced an episode never silently produces another one, and an existing episode is never touched:
    // a repeat handoff is only allowed with an explicit confirmation and always creates a NEW episode (a version of the earlier one).
    const existing = store.episodes.list().filter((e) => e.concept && e.concept.conceptId === cid);
    if (existing.length && !newVersion) throw new StudioError('EPISODE_EXISTS', `이 컨셉으로 만든 에피소드가 이미 있습니다: ${existing.map((e) => e.id).join(', ')}`, { details: existing.map((e) => e.id), recovery: '기존 에피소드를 열거나, 확인 후 새 버전 에피소드를 만드세요. 기존 에피소드는 변경되지 않습니다.', status: 409 });
    const epId = id || episodeIdFor(pid);
    const seed = {
      id: epId, reelId: epId, productId: pid, title: concept.title, titleEn: '', series: 'Jack & Diane',
      product: { id: pid, name: p.name, kind: p.category || '', verifiedFeatures: b.facts, forbiddenClaims: p.forbiddenClaims || [], affiliateUrl: p.affiliateUrl || '', visualSummary: p.description || '', sourceNote: '운영자가 확인한 사실만 사용합니다 (Products 화면).' },
      characters: ['jack', 'diane'], beats: [],
      scenes: [], lines: [], suggestions: [],
      cta: { lines: [], durationSec: 3.5, keyword: '' },
      publishing: { keyword: '', affiliateUrl: p.affiliateUrl || '', disclosure: '[광고] 이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.' },
      concept: { productId: pid, conceptId: cid, revision: concept.revision, title: concept.title, approvedAt: concept.approval.at, hook: concept.hook, ctaDirection: concept.ctaDirection, estimatedScenes: concept.estimatedScenes || null, versionOf: existing.length ? existing[0].id : null },
      // Approved product reference images travel with the episode so Storyboard / Animation can show and use the same images.
      productRefs: { referenceSetId: b.reference.waived ? 'waived' : (p.referenceSet || {}).id || '', imageIds: b.reference.imageIds || [], waived: b.reference.waived || '' },
      characterRules: ['Diane never calls Jack "오빠".', 'Spoken dialogue in English; subtitles in Korean.', 'Diane may shout "BABYYYY!!!!!!" when excited (not in every scene).', 'Keep the approved 2D character references; exactly one Jack and one Diane.'],
      scriptSource: null,
      formula: 1,
    };
    SF.seedFormula(seed, endings); // fixed formula: empty six-beat Part A + the default three-shot ending (Part B) applied automatically
    store.episodes.create(seed);
    return epId;
  }

  const STORY_ACTIONS = {
    story: { mode: 'story', instruction: '' },
    escalation: { mode: 'beat', key: 'absurd_escalation', instruction: 'IMPROVE THE ESCALATION: rewrite ONLY the absurd_escalation beat so the SAME problem becomes even more impossible and cartoonishly exaggerated. Keep the setup, problem, twist and the rest as they are.' },
    twist: { mode: 'beat', key: 'unexpected_twist', instruction: 'STRENGTHEN THE UNEXPECTED TWIST: rewrite ONLY the unexpected_twist beat so the reversal is more surprising and stays directly connected to the escalating problem (background-world absurdity, unexpected character behaviour; never unrelated randomness).' },
    bridge: { mode: 'beat', key: 'product_bridge', instruction: 'IMPROVE THE PRODUCT BRIDGE: rewrite ONLY the product_bridge beat so the consequences of the story create a more believable problem at home and a natural excuse for Diane to buy the product. Do not advertise.' },
    ending: { mode: 'ending', instruction: '' },
  };


  /** Extra input data for the fixed formula: operator-written beats, context for a single beat and the ending the application will append. */
  function formulaData(ep, act) {
    const lines = ['--- FIXED FORMULA INPUT ---'];
    const user = F.BEATS.filter((b) => String((ep.comedy_story[b.key] || {}).story_en || '').trim());
    lines.push('USER_STORY_BEATS (operator-written; preserve each as that beat\'s premise):');
    lines.push(...(user.length ? user.map((b) => `- ${b.key} (${b.ko}): ${ep.comedy_story[b.key].story_en}`) : ['- (none written yet)']));
    if (act.mode === 'beat') {
      lines.push('TARGET_BEAT: ' + act.key, 'CURRENT_STORY (context; other beats stay as they are):');
      F.BEATS.forEach((b) => {
        const bb = ep.comedy_story[b.key] || {};
        const sc = ep.scenes.filter((s) => s.beatKey === b.key).map((s) => s.title_ko).join(' / ');
        lines.push(`- ${b.key}: ${bb.title_ko || '(empty)'} — ${bb.story_en || sc || '(empty)'}`);
      });
    }
    const v = SF.endingVars(ep);
    lines.push('ENDING (added by the application, Part B, three fixed shots): Diane\'s shopping excuse → product demonstration → Jack\'s recurring refusal.');
    lines.push('CURRENT_ENDING_VARS: ' + JSON.stringify(v));
    return lines;
  }

  function buildPrompt(ep, concept, extra, selOverride, action) {
    const structured = F.isStructured(ep);
    const act = structured ? STORY_ACTIONS[action || 'story'] : null;
    if (structured && !act) throw new StudioError('BAD_ACTION', '알 수 없는 대본 생성 동작: ' + action, { status: 400 });
    const L = lib();
    // Creative text comes from the selected preset version; the constraints below it are enforced by code (presets.LOCKED).
    const sel = Object.assign(structured ? { comedyLevel: 3 } : {}, ep.promptPreset || {}, selOverride || {}); // the fixed formula defaults to comedy intensity 3
    const pc = presets.compose(sel, { EXTRA: '' }, { mode: structured ? act.mode : 'legacy' });
    let legacyOverride = null;
    try { legacyOverride = prompts.compose('script', {}).providerOverride; } catch (_) { /* none */ }
    const chars = L.characters.map((c) => `- ${c.id}: ${c.name} — ${c.promptBlock}${c.forbiddenWords && c.forbiddenWords.length ? ' (never says: ' + c.forbiddenWords.join(', ') + ')' : ''}`);
    const data = [
      '--- INPUT DATA (authoritative) ---',
      'CONCEPT_ID: ' + concept.id + ' (revision ' + concept.revision + ')',
      'CONCEPT_TITLE: ' + concept.title,
      ...['hook', 'situation', 'plot', 'productRole', 'characterUsage', 'visualComedy', 'payoff', 'viewerAppeal', 'ctaDirection'].filter((k) => concept[k]).map((k) => `CONCEPT_${k.toUpperCase()}: ${concept[k]}`),
      ...(concept.estimatedScenes ? ['ESTIMATED_SCENES: ' + concept.estimatedScenes] : []),
      'LANGUAGE: spoken dialogue in ENGLISH, subtitles in KOREAN. Diane never calls Jack "오빠".',
      'ESTIMATED_DURATION_SEC: ' + concept.estimatedDurationSec,
      'PRODUCT_NAME: ' + ep.product.name,
      'VERIFIED_PRODUCT_FACTS (use ONLY these):',
      ...ep.product.verifiedFeatures.map((f) => '- ' + f),
      'FORBIDDEN_CLAIMS: ' + (ep.product.forbiddenClaims.join(', ') || 'none'),
      'CHARACTERS (speaker/characters ids must be one of these):',
      ...chars,
      ...(structured ? formulaData(ep, act) : []),
    ].join('\n');
    const extraText = [structured && act.instruction ? 'ACTION: ' + act.instruction : '', extra ? 'ADDITIONAL INSTRUCTION FOR THIS RUN (operator):\n' + String(extra).slice(0, 2000) : ''].filter(Boolean).join('\n\n');
    const full = [pc.editable, extraText, data, pc.locked].filter(Boolean).join('\n\n');
    const composed = { text: pc.editable, versions: { script: pc.presetVersion }, providerOverride: legacyOverride, preset: pc };
    return { composed, prompt: full, parts: { editable: pc.editable + (extraText ? '\n\n' + extraText : ''), data, locked: pc.locked }, meta: { mode: structured ? act.mode : 'legacy', action: structured ? (action || 'story') : null, presetId: pc.presetId, presetName: pc.presetName, presetVersion: pc.presetVersion, comedyLevel: pc.comedyLevel, pinned: pc.pinned, promptHash: sha256(full).slice(0, 12) } };
  }

  function normalize(raw) {
    if (!raw || typeof raw !== 'object') throw new StudioError('SCRIPT_REJECTED', 'AI가 대본 JSON을 반환하지 않았습니다.', { status: 422 });
    const L = lib();
    const ids = new Set(L.characters.map((c) => c.id));
    const scenes = (Array.isArray(raw.scenes) ? raw.scenes : []).map((s, i) => ({
      id: String(s.id || 'S' + (i + 1)), title_ko: String(s.title_ko || '').trim(), title: String(s.title_ko || '').trim(), beat: Number(s.beat) || i + 1, durationSec: Number(s.durationSec) || 4,
      characters: (Array.isArray(s.characters) ? s.characters : []).map(String).filter((c) => ids.has(c)), showsProduct: !!s.showsProduct,
      visual: String(s.visual || ''), action: String(s.action || ''), narration: String(s.narration || ''), placement: String(s.placement || ''),
    }));
    const titleProblems = [];
    scenes.forEach((sc) => checkTitleKo(sc.title_ko).errors.forEach((m) => titleProblems.push(`${sc.id}: ${m}`)));
    if (titleProblems.length) throw new StudioError('SCRIPT_REJECTED', '한국어 장면 제목(title_ko) 규칙을 지키지 않은 응답이라 저장하지 않았습니다: ' + titleProblems[0], { details: titleProblems, recovery: '다시 생성하거나 프롬프트를 확인하세요. 제목은 장면의 핵심 행동·웃음 포인트를 나타내는 한국어여야 합니다.', status: 422 });
    const lines = (Array.isArray(raw.lines) ? raw.lines : []).map((l, i) => ({ id: String(l.id || 'L' + (i + 1)), sceneId: String(l.sceneId || ''), speaker: String(l.speaker || ''), en: String(l.en || '').trim(), ko: String(l.ko || '').trim() }));
    const cta = raw.cta && typeof raw.cta === 'object' ? { lines: (raw.cta.lines || []).map(String), keyword: String(raw.cta.keyword || '').trim(), durationSec: Number(raw.cta.durationSec) || 3.5 } : null;
    if (!scenes.length || !lines.length || !cta) throw new StudioError('SCRIPT_REJECTED', 'AI 응답에 장면, 대사 또는 CTA가 없습니다. 저장하지 않았습니다.', { recovery: '다시 생성하거나 프롬프트를 확인하세요.', status: 422 });
    return { title: String(raw.title || ''), beats: (raw.beats || []).map(String), scenes, lines, cta };
  }

  /**
   * generate(epId, { confirm, overwrite, extra, override })
   * The episode must be bound to a concept (ep.concept) that is approved at its current revision.
   */
  async function generate(epId, { confirm, overwrite = false, extra = '', override, by = 'operator' } = {}) {
    const ep0 = store.episodes.get(epId);
    if (F.isStructured(ep0)) return generateFormula(epId, 'story', { confirm, overwrite, extra, override, by });
    if (!ep0.concept || !ep0.concept.conceptId) throw new StudioError('NO_CONCEPT', '이 에피소드는 스토리 컨셉과 연결되어 있지 않아 AI 대본을 만들 수 없습니다.', { recovery: 'Story Lab에서 컨셉을 승인한 뒤 그 컨셉으로 에피소드를 만드세요.', status: 409 });
    const concept = storylab.requireApproved(ep0.concept.productId, ep0.concept.conceptId);
    if ((ep0.lines || []).length && !overwrite) throw new StudioError('SCRIPT_EXISTS', '이미 대본이 있습니다. 덮어쓰려면 확인하세요 (이전 버전은 버전 기록에 남습니다).', { recovery: '"덮어쓰기"를 선택하면 현재 대본이 버전 기록에 보관된 뒤 새 대본이 만들어집니다.', status: 409 });
    const { composed, prompt } = buildPrompt(ep0, concept, extra);
    const ov = override || composed.providerOverride || undefined;
    const res = await router.run('scriptWriting', { prompt, json: true, maxTokens: 6000, confirm, override: ov, dedupeKey: epId });
    const s = normalize(res.json);
    const source = { conceptId: concept.id, conceptRevision: concept.revision, productId: concept.productId, provider: res.provider, model: res.model, mock: !!res.mock, promptKey: 'script-preset', promptVersion: composed.versions.script, promptVersions: composed.versions, presetId: composed.preset.presetId, presetName: composed.preset.presetName, presetVersion: composed.preset.presetVersion, comedyLevel: composed.preset.comedyLevel, promptHash: sha256(prompt).slice(0, 12), titleKo: true, generatedAt: nowIso(), by };
    await store.episodes.update(epId, (ep) => {
      if (ep.lines.length) ep.preAiScript = { at: nowIso(), lines: ep.lines.length, scenes: ep.scenes.length };
      ep.title = s.title || ep.title;
      ep.beats = s.beats;
      ep.scenes = s.scenes;
      ep.lines = s.lines;
      ep.cta = Object.assign({}, ep.cta, s.cta);
      ep.publishing = Object.assign({}, ep.publishing, { keyword: s.cta.keyword });
      ep.concept = Object.assign({}, ep.concept, { revision: concept.revision, title: concept.title });
      ep.scriptSource = source;
      ep.approvals.script = null; // a regenerated script is a new draft: it must be approved again
      ep.approvals.storyboard = null;
    }, { snapshot: true, by, note: `AI 대본 · 컨셉 ${concept.id} r${concept.revision} · ${res.mock ? '샘플' : res.provider + '/' + res.model} · 프롬프트 v${composed.versions.script}` });
    store.episodes.audit(epId, 'script.generated', { conceptId: concept.id, revision: concept.revision, provider: res.provider, model: res.model, mock: !!res.mock, promptVersion: composed.versions.script });
    return { validation: validateScript(store.episodes.get(epId), lib()), source };
  }


  // ---------- fixed formula: story / single beat / product-specific ending ----------
  const charIds = () => new Set(lib().characters.map((c) => c.id));
  const ACTION_LABEL = { story: '코미디 스토리 다시 만들기', escalation: '위기 2(과장) 개선', twist: '절정(반전) 강화', bridge: '제품 연결 개선', ending: '제품별 엔딩 대사 다시 만들기' };

  /**
   * One paid AI action on a formula episode. Part B (the ending template) is never rewritten by Part A actions;
   * hand-edited content is protected: an action that would replace it needs overwrite:true.
   */
  async function generateFormula(epId, action, { confirm, overwrite = false, extra = '', override, by = 'operator' } = {}) {
    const ep0 = store.episodes.get(epId);
    if (!ep0.concept || !ep0.concept.conceptId) throw new StudioError('NO_CONCEPT', '이 에피소드는 스토리 컨셉과 연결되어 있지 않아 AI 대본을 만들 수 없습니다.', { recovery: 'Story Lab에서 컨셉을 승인한 뒤 그 컨셉으로 에피소드를 만드세요.', status: 409 });
    const concept = storylab.requireApproved(ep0.concept.productId, ep0.concept.conceptId);
    const q0 = buildPrompt(ep0, concept, extra, undefined, action); // throws BAD_ACTION early
    const hasA = ep0.scenes.some((s) => s.part === 'A');
    const keys = action === 'story' ? null : action === 'ending' ? [] : [STORY_ACTIONS[action].key];
    if (action === 'story' && hasA && !overwrite) throw new StudioError('SCRIPT_EXISTS', '이미 PART A 이야기가 있습니다. 다시 만들려면 확인하세요 (이전 버전은 버전 기록에 남습니다).', { recovery: '"덮어쓰기"를 선택하면 현재 대본이 버전 기록에 보관된 뒤 새로 만듭니다.', status: 409 });
    if (action !== 'story' && action !== 'ending' && !ep0.scenes.some((s) => s.beatKey === keys[0])) throw new StudioError('BEAT_EMPTY', '먼저 코미디 스토리를 만드세요. (이 단계가 비어 있습니다)', { status: 409 });
    if (action !== 'ending' && SF.partAHasEdits(ep0, keys) && !overwrite) throw new StudioError('MANUAL_EDITS', '직접 수정한 내용이 있는 단계입니다. 다시 만들면 그 수정이 사라집니다 (이전 버전은 보관됩니다).', { recovery: '확인한 뒤 "덮어쓰기"로 다시 실행하세요.', status: 409 });
    if (isScriptApproved(ep0) && !overwrite) throw new StudioError('SCRIPT_APPROVED', '승인된 대본입니다. 다시 만들면 승인이 취소됩니다 (이전 버전은 보관됩니다).', { recovery: '확인한 뒤 "덮어쓰기"로 다시 실행하세요.', status: 409 });
    const res = await router.run('scriptWriting', { prompt: q0.prompt, json: true, maxTokens: action === 'story' ? 8000 : 3000, confirm, override: override || q0.composed.providerOverride || undefined, dedupeKey: epId + ':' + action });
    // validate EVERYTHING before touching the episode (a bad answer changes nothing; the call is in the usage log)
    let story = null; let beat = null; let vars = {};
    if (action === 'story') { story = SF.normalizeStory(res.json, charIds()); vars = story.vars; }
    else if (action === 'ending') { vars = SF.normalizeVars(res.json && res.json.ending_vars); if (!Object.keys(vars).length) throw new StudioError('SCRIPT_REJECTED', 'AI 응답에 ending_vars가 없습니다. 저장하지 않았습니다.', { status: 422 }); }
    else beat = SF.normalizeBeat(res.json && res.json.beat, keys[0], charIds());
    const meta = q0.meta;
    const source = { conceptId: concept.id, conceptRevision: concept.revision, productId: concept.productId, provider: res.provider, model: res.model, mock: !!res.mock, promptKey: 'script-preset', promptVersion: meta.presetVersion, promptVersions: { script: meta.presetVersion }, presetId: meta.presetId, presetName: meta.presetName, presetVersion: meta.presetVersion, comedyLevel: meta.comedyLevel, promptHash: meta.promptHash, titleKo: true, formula: 1, action, generatedAt: nowIso(), by };
    await store.episodes.update(epId, (ep) => {
      if (ep.lines.length) ep.preAiScript = { at: nowIso(), lines: ep.lines.length, scenes: ep.scenes.length };
      if (story) {
        SF.replacePartA(ep, story.beats);
        if (story.title) ep.title = story.title;
        if (story.cta && story.cta.lines.length) { ep.cta = Object.assign({}, ep.cta, story.cta); ep.publishing = Object.assign({}, ep.publishing, { keyword: story.cta.keyword }); }
      } else if (beat) SF.replaceBeat(ep, keys[0], beat);
      // product-specific ending variables: AI values fill only what the operator has not typed by hand
      // Part B (the ending) is filled from the AI's variables ONCE (first generation) or when the ending action is asked for;
      // a later Part A regeneration never rewrites it.
      const manual = new Set((ep.ending.manualVars) || []);
      if (action === 'ending' || (story && !ep.ending.aiVarsApplied)) {
        Object.keys(vars).forEach((k) => { if (!manual.has(k)) ep.ending.vars[k] = vars[k]; });
        SF.applyEnding(ep, endings, { respectEdits: true });
        ep.ending.aiVarsApplied = true;
      }
      ep.concept = Object.assign({}, ep.concept, { revision: concept.revision, title: concept.title });
      ep.scriptSource = source;
      ep.approvals.script = null; // any regenerated part is a new draft: approve again
      ep.approvals.storyboard = null;
    }, { snapshot: true, by, note: `${action === 'story' ? 'AI 대본 · ' : ''}${ACTION_LABEL[action]} · ${meta.presetName} v${meta.presetVersion} · 강도 ${meta.comedyLevel} · ${res.mock ? '샘플' : res.provider + '/' + res.model}` });
    store.episodes.audit(epId, 'script.generated', { action, conceptId: concept.id, revision: concept.revision, provider: res.provider, model: res.model, mock: !!res.mock, presetId: meta.presetId, presetVersion: meta.presetVersion, comedyLevel: meta.comedyLevel });
    return { validation: validateScript(store.episodes.get(epId), lib()), source };
  }
  const regenerate = async (epId, action, opts) => {
    if (!F.isStructured(store.episodes.get(epId))) throw new StudioError('NOT_FORMULA', '이 에피소드는 고정 에피소드 포맷이 아닙니다 (이전에 만든 에피소드).', { status: 409 });
    return generateFormula(epId, action, opts);
  };

  /** Selects the ending template (and optionally resets hand-edited shots). Part A is never touched. */
  async function selectEnding(epId, { templateId, version, resetEdits = false, by = 'operator' } = {}) {
    if (!F.isStructured(store.episodes.get(epId))) throw new StudioError('NOT_FORMULA', '이 에피소드는 고정 에피소드 포맷이 아닙니다.', { status: 409 });
    endings.resolve({ templateId, version }); // throws NOT_FOUND
    await store.episodes.update(epId, (ep) => {
      ep.ending = Object.assign({}, ep.ending, { templateId: templateId || endings.activeId(), version: version ? Number(version) : null });
      SF.applyEnding(ep, endings, { respectEdits: !resetEdits });
      ep.approvals.script = null;
      ep.approvals.storyboard = null;
    }, { snapshot: true, by, note: '엔딩 템플릿 선택' });
    store.episodes.audit(epId, 'script.ending_selected', { templateId, version: version || null, resetEdits });
    return store.episodes.get(epId).ending;
  }

  /** Is the script still in sync with its concept? Used by the UI ("script regeneration required"). */
  function conceptStatus(ep) {
    if (!ep.concept || !ep.concept.conceptId) return { linked: false, legacy: true, note: '스토리 랩 이전에 만든 에피소드(연결된 컨셉 없음)' };
    const c = storylab.peek(ep.concept.productId, ep.concept.conceptId);
    if (!c) return { linked: true, ok: false, state: 'missing', note: '연결된 컨셉을 찾을 수 없습니다.' };
    const approved = storylab.isApproved(c);
    const usedRev = ep.scriptSource ? ep.scriptSource.conceptRevision : ep.concept.revision;
    const changed = usedRev !== c.revision;
    return {
      linked: true, conceptId: c.id, title: c.title, revision: c.revision, scriptRevision: usedRev, approved, scriptGenerated: !!ep.scriptSource,
      regenerationRequired: !!(ep.scriptSource && changed), ok: approved && !(ep.scriptSource && changed),
      state: !approved ? 'not_approved' : changed && ep.scriptSource ? 'script_stale' : 'ok',
      note: !approved ? '컨셉 승인이 취소되었거나 수정 후 재승인이 필요합니다.' : changed && ep.scriptSource ? `컨셉이 r${usedRev} → r${c.revision}로 바뀌었습니다. 대본을 다시 생성해야 합니다.` : '',
    };
  }


  // ---- selection, effective prompt and Test Prompt ----
  const testsDir = (epId) => store.episodes.file(epId, 'prompt-tests');

  /** Which preset/version/comedy level the episode will use for its NEXT generation (never changes an existing script). */
  async function selectPreset(epId, { presetId, version, comedyLevel } = {}) {
    const cur = store.episodes.get(epId).promptPreset || {};
    const next = { presetId: presetId || cur.presetId || presets.activeId(), version: version ? Number(version) : null, comedyLevel: [1, 2, 3].includes(Number(comedyLevel)) ? Number(comedyLevel) : cur.comedyLevel || (F.isStructured(store.episodes.get(epId)) ? 3 : 2) };
    presets.resolve(next); // throws NOT_FOUND for an unknown preset/version
    await store.episodes.update(epId, (ep) => { ep.promptPreset = next; });
    store.episodes.audit(epId, 'script.preset_selected', next);
    return next;
  }

  /** The full effective prompt exactly as it would be sent (editable text + input data + code-enforced constraints). */
  function effectivePrompt(epId, sel, extra, action) {
    const ep = store.episodes.get(epId);
    if (!ep.concept || !ep.concept.conceptId) throw new StudioError('NO_CONCEPT', '이 에피소드는 스토리 컨셉과 연결되어 있지 않아 AI 프롬프트를 만들 수 없습니다.', { status: 409 });
    const concept = storylab.requireApproved(ep.concept.productId, ep.concept.conceptId);
    const q = buildPrompt(ep, concept, extra, sel, action);
    return { parts: q.parts, full: q.prompt, meta: q.meta, chars: q.prompt.length };
  }

  /**
   * "Test Prompt": the same paid call as a real generation, but the result is stored as a separate test draft and the
   * episode (script, approvals, versions) is NOT touched. Needs the same explicit cost confirmation.
   */
  async function testPrompt(epId, { sel, confirm, extra = '', by = 'operator' } = {}) {
    const ep0 = store.episodes.get(epId);
    if (!ep0.concept || !ep0.concept.conceptId) throw new StudioError('NO_CONCEPT', '이 에피소드는 스토리 컨셉과 연결되어 있지 않습니다.', { status: 409 });
    const concept = storylab.requireApproved(ep0.concept.productId, ep0.concept.conceptId);
    const { composed, prompt, meta } = buildPrompt(ep0, concept, extra, sel);
    const ov = composed.providerOverride || undefined;
    const res = await router.run('scriptWriting', { prompt, json: true, maxTokens: 6000, confirm, override: ov, dedupeKey: epId + ':test:' + meta.promptHash });
    const rec = { id: uid('ptest'), at: nowIso(), by, epId, meta, mock: !!res.mock, provider: res.provider, model: res.model, extra: String(extra).slice(0, 2000), estimate: res.estimate || null, draft: null, validation: null, error: null, rawJson: null };
    try {
      if (F.isStructured(ep0)) {
        // formula episode: build the whole script on a COPY (Part A from the test + the selected ending); nothing is saved
        const st = SF.normalizeStory(res.json, charIds());
        const copy = JSON.parse(JSON.stringify(ep0));
        SF.replacePartA(copy, st.beats);
        Object.keys(st.vars).forEach((k) => { if (!(copy.ending.manualVars || []).includes(k)) copy.ending.vars[k] = st.vars[k]; });
        SF.applyEnding(copy, endings, { respectEdits: true });
        if (st.cta && st.cta.lines.length) copy.cta = Object.assign({}, copy.cta, st.cta);
        copy.publishing = Object.assign({}, copy.publishing, { keyword: copy.cta.keyword });
        rec.draft = { title: st.title || copy.title, scenes: copy.scenes, lines: copy.lines, cta: copy.cta, beats: copy.comedy_story, ending: copy.product_ending, formula: true };
        rec.validation = validateScript(copy, lib());
      } else {
      const s = normalize(res.json);
      const probe = Object.assign({}, ep0, { title: s.title || ep0.title, beats: s.beats, scenes: s.scenes, lines: s.lines, cta: s.cta, publishing: Object.assign({}, ep0.publishing, { keyword: s.cta.keyword }), scriptSource: { titleKo: true } });
      rec.draft = s;
      rec.validation = validateScript(probe, lib());
      }
    } catch (e) {
      rec.error = { code: e.code || 'ERROR', message: e.message, details: e.details || [] };
      rec.rawJson = JSON.stringify(res.json || null).slice(0, 20000);
    }
    store.episodes.saveFile(epId, path.join('prompt-tests', rec.id + '.json'), Buffer.from(JSON.stringify(rec, null, 1)));
    store.episodes.audit(epId, 'script.prompt_tested', { testId: rec.id, presetId: meta.presetId, presetVersion: meta.presetVersion, comedyLevel: meta.comedyLevel, ok: !rec.error });
    return rec;
  }
  function listTests(epId) {
    const dir = testsDir(epId);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { return null; } }).filter(Boolean).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }

  return { createEpisodeFromConcept, generate, regenerate, selectEnding, conceptStatus, buildPrompt, episodeIdFor, selectPreset, effectivePrompt, testPrompt, listTests };
}

module.exports = { createScriptGen };
