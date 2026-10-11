// The Studio application facade: every dashboard action goes through here (the HTTP server only routes).
// It wires the store, character library, gates, generation, voice, render and publishing services together.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { createStore, SEED_DIR } = require('./store');
const { createVault } = require('./vault');
const { createRuntime } = require('./runtime');
const { createUsage } = require('./usage');
const { createPromptStore } = require('./promptstore');
const { createAiRouter } = require('./ai/router');
const { createProductService } = require('./products');
const { createStoryLab } = require('./storylab');
const { createScriptGen } = require('./scriptgen');
const { createIntegrations } = require('./integrations');
const { createVideoProvider } = require('./providers');
const { createGenerationService } = require('./generation');
const { createVoiceService } = require('./voice');
const { createRenderService } = require('./render');
const { createPromptService } = require('./promptgen');
const { createPublishingService, checklist: publishChecklist, validate: validatePublishing } = require('./publishing');
const { validateScript, pipeline, isScriptApproved, isStoryboardApproved, scriptFingerprint, storyboardFingerprint, totalPlannedSec } = require('./episode');
const { lintPrompt } = require('./prompts');
const { lintCast, SHEET_RULE } = require('./charrules');
const { clipSecFor, modelById, limitFor, spentUsd } = require('./budget');
const { StudioError, nowIso, sha256, safeName, writeFileAtomic } = require('./util');

const ACTIVE_JOB = new Set(['preparing', 'submitting', 'processing']);

function createStudio({ cfg, store = createStore({ dir: cfg.studioDir }), provider = null, speechProvider = null, fetchFn = globalThis.fetch, geminiFactory = null, vault = null, aiProviderFactory = null, extractFn, downloadFn, muapiFactory, log = () => {} }) {
  // Keys live in the encrypted vault (Settings → AI Integrations); environment variables are only a fallback.
  const keys = vault || createVault({ dir: store.dir, masterKey: cfg.masterKey, requireMasterKey: !!cfg.production, env: { GEMINI_API_KEY: cfg.geminiApiKey, OPENAI_API_KEY: cfg.openaiApiKey, ANTHROPIC_API_KEY: cfg.anthropicApiKey, MUAPI_API_KEY: cfg.muapiApiKey, HEYGEN_API_KEY: cfg.heygenApiKey }, log });
  const runtime = createRuntime({ cfg, vault: keys, store });
  const usage = createUsage({ store, log });
  const prompts = createPromptStore({ store, seedDir: SEED_DIR });
  const router = createAiRouter({ store, vault: keys, usage, fetchFn, providerFactory: aiProviderFactory, log });
  const products = createProductService({ store, router, extractFn, downloadFn, log });
  const storylab = createStoryLab({ store, products, prompts, router, log });
  const scriptgen = createScriptGen({ store, products, storylab, prompts, router, lib: () => store.characters.load() });
  const integrations = createIntegrations({ store, vault: keys, runtime, router, usage, cfg, fetchFn, muapiFactory, log });

  // Video provider resolved per call: switching mode/key in Settings applies immediately. Live needs request AND key; otherwise MOCK (shown in the UI).
  const vcache = new Map();
  const currentVideo = () => {
    const mode = runtime.muapiMode();
    const key = mode === 'live' ? runtime.muapiKey() : '';
    const sig = mode + ':' + sha256(key).slice(0, 12) + ':' + cfg.muapiBaseUrl;
    if (!vcache.has(sig)) { vcache.clear(); vcache.set(sig, createVideoProvider(Object.assign({}, cfg, { muapiMode: mode, muapiApiKey: key }))); }
    return vcache.get(sig);
  };
  const video = provider || new Proxy({}, { get: (_t, prop) => currentVideo()[prop] });
  const gen = createGenerationService({ store, provider: video, cfg, log });
  const promptSvc = createPromptService({
    store, cfg, geminiFactory, log,
    available: () => router.routeFor('storyboardPrompts').provider !== 'mock' && !!keys.get(router.routeFor('storyboardPrompts').provider),
    composeExtra: () => { const c = prompts.compose('storyboard', {}); return { text: c.text, versions: c.versions }; },
    // Storyboard AI goes through the router (routing, limits, usage log). The operator already confirmed the paid call (confirmAi).
    clientFactory: () => {
      const r = router.routeFor('storyboardPrompts');
      if (r.provider === 'mock' || !keys.get(r.provider)) throw new StudioError('NOT_CONFIGURED', '스토리보드 AI 제공자가 연결되지 않았습니다 (Gemini API 키 GEMINI_API_KEY 또는 Settings → AI Integrations의 키/모델 설정 필요). 무료 템플릿 모드는 그대로 사용할 수 있습니다.', { recovery: 'Settings → AI Integrations에서 키를 저장하고 "스토리보드 프롬프트" 작업에 제공자/모델을 지정하세요.', status: 409 });
      return { model: r.model || 'mock', provider: r.provider, generateJson: async ({ prompt, images }) => (await router.run('storyboardPrompts', { prompt, images: images.map((i) => ({ mimeType: i.mimeType, data: i.data, label: i.label })), json: true, maxTokens: 8000, confirm: { paid: true, unknownCost: true } })).json };
    },
  });
  const voice = createVoiceService({ store, cfg, fetchFn, speechProvider, runtime });
  const renderer = createRenderService({ store, cfg, voice, log });
  const publishing = createPublishingService({ store });
  store.episodes.seedDemo();

  const lib = () => store.characters.load();

  // ---------- status (never contains a key) ----------
  function providerStatus() {
    const vm = runtime.muapiRequested() === 'live';
    const hm = runtime.voiceRequested() === 'live';
    const sb = router.routeFor('storyboardPrompts');
    return {
      video: { name: video.name, mode: video.mode, paid: video.paid, keyConfigured: !!runtime.muapiKey(), liveRequested: vm, liveWithoutKey: vm && !runtime.muapiKey(), envForcedLive: cfg.muapiMode === 'live', baseUrl: cfg.muapiBaseUrl },
      voice: { mode: voice.mode, keyConfigured: !!runtime.heygenKey(), liveRequested: hm, liveWithoutKey: hm && !runtime.heygenKey(), provider: voice.provider().name },
      gemini: { configured: !!keys.get('gemini'), model: sb.model, usedFor: 'AI 프롬프트 생성 (명시적 승인 후에만 호출, 유료일 수 있음)', provider: sb.provider },
      lipSync: { available: false, note: '립싱크는 선택한 영상 모델에서 지원이 확인되지 않아 제공하지 않습니다.' },
      limits: { reelSpendLimitUsd: cfg.reelSpendLimitUsd, maxCharsPerJob: cfg.maxCharsPerJob, monthlyCharLimit: cfg.monthlyCharLimit },
      how: '실제(유료) 모드는 Settings → AI Integrations에서 키 저장 후 "LIVE" 확인을 거쳐서만 켤 수 있습니다. 키가 없으면 실제 모드가 요청돼도 목업으로 동작하며 화면에 그렇게 표시됩니다.',
    };
  }

  function publicSettings() {
    const s = store.settings.get();
    return Object.assign({}, s, { effectiveReelSpendLimitUsd: s.reelSpendLimitUsd != null ? s.reelSpendLimitUsd : cfg.reelSpendLimitUsd });
  }

  function characterView(c) {
    return Object.assign({}, c, {
      references: c.references.map((r) => Object.assign({}, r, { url: `/media/ref/${c.id}/${r.id}` })),
      voiceStatus: !c.voice.heygenVoiceId ? (c.voice.heygenIdentityId ? 'identity-only' : 'unset') : c.voice.verified ? 'verified' : 'unverified',
    });
  }

  // ---------- derived view of one episode ----------
  function jobsRunning(ep) {
    return (ep.generation.jobs || []).some((j) => ACTIVE_JOB.has(j.status));
  }

  function episodeView(id) {
    const ep = store.episodes.get(id);
    const L = lib();
    const settings = store.settings.get();
    const validation = validateScript(ep, L);
    const conceptInfo = scriptgen.conceptStatus(ep);
    let productReady;
    if (ep.productId && ep.concept) { try { productReady = products.readiness(products.raw(ep.productId)).ok; } catch { productReady = undefined; } }
    const ctx = { concept: conceptInfo.linked ? conceptInfo : { legacy: true }, productReady, jobsRunning: jobsRunning(ep), renderState: ep.renderJob && ep.renderJob.status, voiceValid: (lid) => { const l = ep.lines.find((x) => x.id === lid); return !!l && voice.lineAudio(ep, l).valid; } };
    const steps = pipeline(ep, L, ctx);
    let genEstimate = null;
    try { genEstimate = gen.estimate(id, { modelId: settings.defaultModelId }); } catch (e) { genEstimate = { error: e.message }; }
    const renderPlan = renderer.plan(id);
    const sceneViews = ep.scenes.map((s) => {
      const img = gen.startImage(ep, s);
      const clips = ep.clips[s.id] || { versions: [], approvedVersion: null };
      const model = modelById(store.models(), settings.defaultModelId);
      return Object.assign({}, s, {
        clipSec: clipSecFor(model, s.durationSec),
        prompt: ep.prompts[s.id] || null,
        promptWarnings: ep.prompts[s.id] ? lintPrompt(ep.prompts[s.id].video, ep) : [],
        castWarnings: ep.prompts[s.id] ? lintCast(ep.prompts[s.id].video, s, L) : [],
        usesSheet: promptSvc.usesSheetFor(s, L),
        startImageInfo: img.error ? { error: img.error } : { label: img.label, approved: img.approved, placeholder: img.placeholder, url: img.characterId ? `/media/ref/${img.characterId}/${img.refId}` : `/media/startframe/${id}/${s.id}` },
        clips: { approvedVersion: clips.approvedVersion, versions: clips.versions.map((v) => Object.assign({}, v, { url: `/media/clip/${id}/${s.id}/${v.v}` })) },
        line: ep.lines.filter((l) => l.sceneId === s.id).map((l) => l.id),
      });
    });
    const used = renderPlan.timeline;
    const voiceEst = voice.estimate(id);
    const view = Object.assign({}, ep, {
      scenes: sceneViews,
      derived: {
        concept: conceptInfo,
        scriptHash: scriptFingerprint(ep),
        storyboardHash: storyboardFingerprint(ep),
        scriptApproved: isScriptApproved(ep),
        scriptChangedSinceApproval: !!(ep.approvals.script && !isScriptApproved(ep)),
        storyboardApproved: isStoryboardApproved(ep),
        storyboardChangedSinceApproval: !!(ep.approvals.storyboard && !isStoryboardApproved(ep)),
        validation,
        steps,
        totalPlannedSec: totalPlannedSec(ep),
        spentUsd: spentUsd(ep),
        mockSpendCount: ep.spend.filter((s) => s.mock).length,
        limitUsd: limitFor(ep, settings, cfg),
        generation: genEstimate,
        voice: Object.assign({}, voiceEst, { lines: voiceEst.lines.map((l) => Object.assign({}, l, { url: l.cached ? `/media/audio/${id}/${l.lineId}` : '' })) }),
        render: { plan: renderPlan, running: ep.renderJob && ep.renderJob.status === 'running', job: ep.renderJob || null },
        publishing: { checklist: publishChecklist(ep), validation: ep.publishing && ep.publishing.caption ? validatePublishing(ep, ep.publishing) : null },
        jobsRunning: jobsRunning(ep),
        audit: store.episodes.auditLog(id, 40),
        versions: store.episodes.versions(id),
      },
      renders: ep.renders.map((r) => Object.assign({}, r, { url: `/media/render/${id}/${r.v}`, current: !!(ep.approvals.final && ep.approvals.final.v === r.v) })),
      sfx: ep.sfx,
      timeline: used,
    });
    return view;
  }

  function summary() {
    const eps = store.episodes.list().map((e) => episodeView(e.id));
    const queue = [];
    eps.forEach((e) => {
      const d = e.derived;
      const q = (type, label, view) => queue.push({ episodeId: e.id, title: e.title, type, label, view });
      if (!d.scriptApproved && d.validation.ok) q('script', e.derived.scriptChangedSinceApproval ? '대본이 승인 후 수정됨 — 다시 승인 필요' : '대본 승인 대기', 'script');
      else if (d.scriptApproved && !d.storyboardApproved) q('storyboard', d.storyboardChangedSinceApproval ? '스토리보드가 승인 후 수정됨' : '스토리보드 승인 대기', 'storyboard');
      const pending = e.scenes.reduce((n, s) => n + s.clips.versions.filter((v) => v.status === 'pending_review').length, 0);
      if (pending) q('clips', `클립 ${pending}개 검토 대기`, 'animation');
      const lastFinal = [...e.renders].reverse().find((r) => !r.preview);
      if (lastFinal && !e.approvals.final && d.steps.find((s) => s.key === 'render').state === 'done') q('final', '최종 영상 승인 대기', 'review');
      if (e.approvals.final && !(e.publishing && e.publishing.approvedAt)) q('caption', '캡션·ManyChat 문구 승인 대기', 'publishing');
    });
    return {
      providers: providerStatus(),
      settings: publicSettings(),
      models: store.models(),
      characters: lib().characters.map(characterView),
      style: lib().style,
      products: products.list(),
      storylab: storylabSummary(),
      ai: { routing: integrations.overview().routing, usage: usage.summary(store.settings.get().ai.limits) },
      episodes: eps.map((e) => ({ id: e.id, concept: e.derived.concept, title: e.title, titleEn: e.titleEn, productName: e.product.name, steps: e.derived.steps, spentUsd: e.derived.spentUsd, limitUsd: e.derived.limitUsd, totalPlannedSec: e.derived.totalPlannedSec, scenes: e.scenes.length, thumb: firstClipThumb(e), published: !!(e.publishing && e.publishing.publishedAt), finalApproved: !!e.approvals.final, updatedAt: e.updatedAt })),
      queue,
      totals: {
        episodes: eps.length,
        spentUsd: Math.round(eps.reduce((n, e) => n + e.derived.spentUsd, 0) * 1e6) / 1e6,
        completed: eps.filter((e) => e.approvals.final).length,
        published: eps.filter((e) => e.publishing && e.publishing.publishedAt).length,
        inProduction: eps.filter((e) => !(e.publishing && e.publishing.publishedAt)).length,
      },
    };
  }

  function storylabSummary() {
    return products.list().map((p) => { const l = storylab.list(p.id); return { productId: p.id, name: p.name, concepts: l.concepts.length, approved: l.concepts.filter((c) => c.approved).length, candidates: l.concepts.filter((c) => c.status === 'candidate').length, needsReapproval: l.concepts.filter((c) => c.needsReapproval).length }; });
  }

  /** Idempotent, non-destructive: gives every pre-V2.3 episode a product record (reference images waived, flagged legacy). Existing data is never modified. */
  function migrateLegacy() {
    const made = [];
    store.episodes.list().forEach((ep) => {
      if (!ep.productId || !ep.product || !ep.product.name) return;
      try { products.raw(ep.productId); return; } catch (_) { /* not there yet */ }
      const dir = store.path('products', ep.productId);
      require('node:fs').mkdirSync(dir, { recursive: true });
      const rec = { id: ep.productId, name: ep.product.name, url: '', affiliateUrl: ep.product.affiliateUrl || '', description: ep.product.visualSummary || '', category: ep.product.kind || '', specs: (ep.product.verifiedFeatures || []).map((text) => ({ text, source: 'manual', verified: true, at: nowIso() })), sellingPoints: [], forbiddenClaims: ep.product.forbiddenClaims || [], extraction: { status: 'none', note: '레거시 에피소드에서 가져옴', at: nowIso() }, images: [], referenceSet: { id: 'refset_waived', waived: '레거시: 스토리 랩 이전에 만든 에피소드의 제품 정보', imageIds: [], hash: '', by: 'migration', at: nowIso() }, legacy: true, createdAt: nowIso(), updatedAt: nowIso() };
      require('./util').writeJsonAtomic(path.join(dir, 'product.json'), rec);
      made.push(ep.productId);
    });
    const schema = require('./util').readJson(store.path('schema.json'), null);
    if (!schema || schema.schemaVersion < 3) require('./util').writeJsonAtomic(store.path('schema.json'), { schemaVersion: 3, migratedAt: nowIso(), note: 'V2.3: products, story lab, vault, usage, prompts added (additive; no existing file rewritten)' });
    return made;
  }
  migrateLegacy();

  function firstClipThumb(e) {
    for (const s of e.scenes) {
      const v = s.clips.versions.find((x) => x.v === s.clips.approvedVersion) || s.clips.versions[s.clips.versions.length - 1];
      if (v) return v.url;
    }
    return '';
  }

  // ---------- script / storyboard editing ----------
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d);

  /** Normal path: an episode starts from an APPROVED story concept (Product → Story Lab → episode). */
  async function createEpisodeFromConcept({ productId, conceptId, id }) {
    const epId = await scriptgen.createEpisodeFromConcept(productId, conceptId, { id });
    store.episodes.audit(epId, 'episode.from_concept', { productId, conceptId });
    return epId;
  }

  /** Legacy/manual path (kept for compatibility; flagged manual and NOT linked to a concept). */
  async function createEpisode({ id, title, productName, features }) {
    const seed = {
      manual: true,
      id,
      reelId: id.replace(/^EP/, 'PRD-X-EP'),
      productId: '',
      title: title || '새 에피소드',
      titleEn: '',
      series: 'Jack & Diane',
      product: { id: '', name: productName || '', kind: '', verifiedFeatures: (features || []).map(String).filter(Boolean), forbiddenClaims: [], affiliateUrl: '', visualSummary: '', sourceNote: '운영자가 입력한 확인된 기능만 사용합니다.' },
      characters: ['jack', 'diane'],
      beats: [],
      scenes: [{ id: 'S1', title: '첫 장면', beat: 1, durationSec: 5, characters: ['jack'], showsProduct: false, visual: '' }],
      lines: [],
      suggestions: [],
      cta: { lines: [], durationSec: 3.5, keyword: '' },
      publishing: { keyword: '', affiliateUrl: '', disclosure: '[광고] 이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.' },
    };
    return store.episodes.create(seed);
  }

  function sanitizeScenes(list, old) {
    const seen = new Set();
    return list.map((s, i) => {
      const id = String(s.id || 'S' + (i + 1)).trim();
      if (seen.has(id)) throw new StudioError('SCENE_DUP', '장면 ID가 중복됩니다: ' + id);
      seen.add(id);
      const prev = old.find((o) => o.id === id) || {};
      return Object.assign({}, prev, {
        id,
        title: String(s.title != null ? s.title : prev.title || '').slice(0, 120),
        beat: num(s.beat, prev.beat || i + 1),
        durationSec: num(s.durationSec, prev.durationSec || 4),
        characters: Array.isArray(s.characters) ? s.characters.map(String) : prev.characters || [],
        showsProduct: s.showsProduct != null ? !!s.showsProduct : !!prev.showsProduct,
        visual: String(s.visual != null ? s.visual : prev.visual || '').slice(0, 2000),
        action: String(s.action != null ? s.action : prev.action || '').slice(0, 1500),
        narration: String(s.narration != null ? s.narration : prev.narration || '').slice(0, 1500),
        placement: String(s.placement != null ? s.placement : prev.placement || '').slice(0, 800),
        startImage: s.startImage !== undefined ? s.startImage : prev.startImage,
      });
    });
  }

  function sanitizeLines(list, ep) {
    let n = ep.lines.length;
    const seen = new Set();
    return list.map((l) => {
      let id = String(l.id || '').trim();
      if (!id || seen.has(id)) id = 'L' + ++n + (seen.has('L' + n) ? '_' : '');
      seen.add(id);
      return { id, sceneId: String(l.sceneId || ''), speaker: String(l.speaker || ''), en: String(l.en || '').trim(), ko: String(l.ko || '').trim() };
    });
  }

  async function saveScript(id, patch, by = 'operator', note = '') {
    const ep = await store.episodes.update(id, (ep) => {
      if (patch.title !== undefined) ep.title = String(patch.title).slice(0, 200);
      if (patch.titleEn !== undefined) ep.titleEn = String(patch.titleEn).slice(0, 200);
      if (Array.isArray(patch.beats)) ep.beats = patch.beats.map(String);
      if (Array.isArray(patch.scenes)) ep.scenes = sanitizeScenes(patch.scenes, ep.scenes);
      if (Array.isArray(patch.lines)) ep.lines = sanitizeLines(patch.lines, ep);
      if (patch.cta) {
        ep.cta = Object.assign({}, ep.cta, {
          lines: Array.isArray(patch.cta.lines) ? patch.cta.lines.map(String) : ep.cta.lines,
          durationSec: patch.cta.durationSec != null ? num(patch.cta.durationSec, ep.cta.durationSec) : ep.cta.durationSec,
          keyword: patch.cta.keyword != null ? String(patch.cta.keyword).trim() : ep.cta.keyword,
        });
        ep.publishing = Object.assign({}, ep.publishing, { keyword: ep.cta.keyword });
      }
    }, { snapshot: true, by, note: note || '대본 저장' });
    store.episodes.audit(id, 'script.saved', { version: ep.version, by });
    await syncPromptsWithCast(id);
    return episodeView(id);
  }

  /**
   * A scene's cast decides how many people the prompt must contain. When the cast of a scene changes:
   * untouched template prompts are rebuilt (free); edited or AI prompts are flagged stale so they are never silently kept wrong.
   */
  async function syncPromptsWithCast(id) {
    const ep = store.episodes.get(id);
    const rebuild = [];
    const stale = [];
    ep.scenes.forEach((s) => {
      const p = ep.prompts[s.id];
      if (!p || !p.castIds) return;
      const a = (s.characters || []).slice().sort().join();
      const b = p.castIds.slice().sort().join();
      if (a === b) return;
      if (p.source !== 'gemini' && !p.edited) rebuild.push(s.id);
      else stale.push(s.id);
    });
    if (rebuild.length && isScriptApproved(store.episodes.get(id))) await promptSvc.generate(id, { sceneIds: rebuild, mode: 'template', force: true });
    else stale.push(...rebuild);
    if (stale.length) await store.episodes.update(id, (e) => stale.forEach((sid) => e.prompts[sid] && (e.prompts[sid].stale = true)));
  }

  async function approveScript(id, by = 'operator') {
    await store.episodes.update(id, (ep) => {
      const cs = scriptgen.conceptStatus(ep);
      if (cs.linked && !cs.ok) throw new StudioError('CONCEPT_NOT_APPROVED', cs.note || '스토리 컨셉 승인이 필요합니다.', { recovery: cs.regenerationRequired ? 'Script Studio에서 "AI로 대본 다시 만들기"를 실행하세요.' : 'Story Lab에서 컨셉을 승인하세요.', status: 409 });
      const v = validateScript(ep, lib());
      if (!v.ok) throw new StudioError('INVALID_SCRIPT', v.errors[0].message, { details: v.errors, recovery: '오류를 고친 뒤 다시 승인하세요.', status: 409 });
      ep.approvals.script = { hash: scriptFingerprint(ep), version: ep.version || 0, by, at: nowIso() };
    });
    store.episodes.audit(id, 'script.approved', { by });
    // Free, deterministic: scenes that have no prompt yet get one right away so the Storyboard is never empty.
    const missing = store.episodes.get(id).scenes.filter((s) => !store.episodes.get(id).prompts[s.id]).map((s) => s.id);
    if (missing.length) await promptSvc.generate(id, { sceneIds: missing, mode: 'template' });
    return episodeView(id);
  }

  async function revokeScript(id, by = 'operator') {
    await store.episodes.update(id, (ep) => {
      ep.approvals.script = null;
      ep.approvals.storyboard = null;
    });
    store.episodes.audit(id, 'script.revoked', { by });
    return episodeView(id);
  }

  async function restoreVersion(id, n, by = 'operator') {
    const v = store.episodes.version(id, n);
    await store.episodes.update(id, (ep) => {
      ep.title = v.title;
      ep.scenes = v.scenes;
      ep.lines = v.lines;
      ep.cta = v.cta;
      ep.beats = v.beats || ep.beats;
    }, { snapshot: true, by, note: `v${n} 복원` });
    store.episodes.audit(id, 'script.restored', { from: n, by });
    return episodeView(id);
  }

  async function addSuggestion(id, index) {
    await store.episodes.update(id, (ep) => {
      const s = ep.suggestions[index];
      if (!s) throw new StudioError('NOT_FOUND', '제안을 찾을 수 없습니다.', { status: 404 });
      ep.lines.push({ id: 'L' + (ep.lines.length + 1) + '_' + sha256(s.en).slice(0, 4), sceneId: s.sceneId, speaker: s.speaker, en: s.en, ko: s.ko });
      ep.suggestions.splice(index, 1);
    }, { snapshot: true, note: 'PR #19 초안 대사 추가' });
    return episodeView(id);
  }

  /** mode: 'template' (free) | 'gemini' (billable, needs confirmAi). Edited prompts are kept unless force. */
  async function rebuildPrompts(id, sceneIds, { force = false, mode = 'template', confirmAi = false } = {}) {
    const r = await promptSvc.generate(id, { sceneIds, mode, confirmAi, force });
    const view = episodeView(id);
    view.promptResult = r;
    return view;
  }

  async function savePrompt(id, sceneId, { video, negative }) {
    await store.episodes.update(id, (ep) => {
      const sc = ep.scenes.find((s) => s.id === sceneId);
      if (!sc) throw new StudioError('NOT_FOUND', '장면을 찾을 수 없습니다.', { status: 404 });
      const bad = lintPrompt(video, ep);
      if (bad.length) throw new StudioError('PRODUCT_CLAIM', `확인되지 않은 제품 주장이 프롬프트에 있습니다: ${bad.join(', ')}`, { recovery: '해당 표현을 지우거나 제품의 확인된 기능만 쓰세요.' });
      const hard = lintCast(video, sc, lib()).filter((w) => w.code !== 'UNSELECTED_CHARACTER');
      if (hard.length) throw new StudioError('CAST_RULE', hard[0].message, { details: hard, recovery: '캐릭터는 장면에서 선택한 만큼 한 명씩만 등장해야 하고, 레퍼런스 시트를 장면에 그리게 해서는 안 됩니다.' });
      let text = String(video);
      // The character-sheet rule is mandatory whenever a sheet is used: it is re-appended if the operator deleted it.
      if (promptSvc.usesSheetFor(sc, lib()) && !text.includes(SHEET_RULE)) text = text.replace(/\s+$/, '') + '\n' + SHEET_RULE;
      ep.prompts[sceneId] = Object.assign({}, ep.prompts[sceneId], { video: text, negative: String(negative != null ? negative : (ep.prompts[sceneId] || {}).negative || ''), edited: true, editedAt: nowIso() });
    });
    return episodeView(id);
  }

  async function setStartImage(id, sceneId, startImage) {
    await store.episodes.update(id, (ep) => {
      const s = ep.scenes.find((x) => x.id === sceneId);
      if (!s) throw new StudioError('NOT_FOUND', '장면을 찾을 수 없습니다.', { status: 404 });
      if (startImage && startImage.refId) {
        const c = lib().characters.find((x) => x.id === startImage.characterId);
        if (!c || !c.references.some((r) => r.id === startImage.refId)) throw new StudioError('NOT_FOUND', '참조 이미지를 찾을 수 없습니다.', { status: 404 });
        s.startImage = { type: 'reference', characterId: startImage.characterId, refId: startImage.refId };
      } else s.startImage = null;
    });
    return episodeView(id);
  }

  async function uploadStartFrame(id, sceneId, buffer, filename) {
    const ext = path.extname(filename || '').toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) throw new StudioError('BAD_TYPE', 'PNG, JPG, WEBP 이미지만 올릴 수 있습니다.');
    if (buffer.length > 10 * 1024 * 1024) throw new StudioError('TOO_LARGE', '10 MB 이하 이미지만 가능합니다.');
    const hash = sha256(buffer);
    const file = hash.slice(0, 12) + ext;
    store.episodes.saveFile(id, path.join('startframes', file), buffer);
    await store.episodes.update(id, (ep) => {
      const s = ep.scenes.find((x) => x.id === sceneId);
      if (!s) throw new StudioError('NOT_FOUND', '장면을 찾을 수 없습니다.', { status: 404 });
      s.startImage = { type: 'upload', file, sha256: hash, approved: false, name: safeName(filename) };
    });
    return episodeView(id);
  }

  async function approveStartFrame(id, sceneId, approved, by = 'operator') {
    await store.episodes.update(id, (ep) => {
      const s = ep.scenes.find((x) => x.id === sceneId);
      if (!s || !s.startImage || s.startImage.type !== 'upload') throw new StudioError('NOT_FOUND', '업로드한 시작 프레임이 없습니다.', { status: 404 });
      s.startImage.approved = !!approved;
      s.startImage.approvedBy = by;
    });
    return episodeView(id);
  }

  async function approveStoryboard(id, by = 'operator') {
    await store.episodes.update(id, (ep) => {
      if (!isScriptApproved(ep)) throw new StudioError('SCRIPT_NOT_APPROVED', '대본을 먼저 승인하세요.', { status: 409 });
      const missing = ep.scenes.filter((s) => !ep.prompts[s.id] || !String(ep.prompts[s.id].video).trim());
      if (missing.length) throw new StudioError('NO_PROMPT', `프롬프트가 없는 장면: ${missing.map((s) => s.id).join(', ')}`, { recovery: '"프롬프트 만들기"를 누르세요.', status: 409 });
      const bad = ep.scenes.filter((s) => lintPrompt(ep.prompts[s.id].video, ep).length);
      if (bad.length) throw new StudioError('PRODUCT_CLAIM', `확인되지 않은 제품 주장이 있는 장면: ${bad.map((s) => s.id).join(', ')}`, { status: 409 });
      ep.approvals.storyboard = { hash: storyboardFingerprint(ep), by, at: nowIso() };
    });
    store.episodes.audit(id, 'storyboard.approved', { by });
    return episodeView(id);
  }

  async function setSpendLimit(id, usd) {
    const v = usd === null || usd === '' ? null : Number(usd);
    if (v !== null && !(v >= 0)) throw new StudioError('BAD_VALUE', '한도는 0 이상의 숫자여야 합니다.');
    await store.episodes.update(id, (ep) => { ep.spendLimitUsd = v; });
    store.episodes.audit(id, 'spend.limit', { usd: v });
    return episodeView(id);
  }

  // ---------- characters / settings ----------
  function updateCharacter(id, patch, by = 'operator') {
    store.characters.update(id, (c) => {
      ['look', 'promptBlock', 'catchphrase', 'catchphraseNote', 'role'].forEach((k) => patch[k] !== undefined && (c[k] = String(patch[k])));
      if (Array.isArray(patch.personality)) c.personality = patch.personality.map(String);
      if (patch.voice) {
        const v = patch.voice;
        if (v.heygenVoiceId !== undefined && String(v.heygenVoiceId).trim() !== c.voice.heygenVoiceId) {
          c.voice.heygenVoiceId = String(v.heygenVoiceId).trim();
          c.voice.verified = false; // a changed ID must be re-verified
          c.voice.verifiedAt = '';
        }
        if (v.heygenIdentityId !== undefined) c.voice.heygenIdentityId = String(v.heygenIdentityId).trim();
        if (v.speed !== undefined) c.voice.speed = Math.min(2, Math.max(0.5, num(v.speed, 1)));
      }
    });
    return characterView(store.characters.get(id));
  }

  function saveSettings(patch) {
    const cur = store.settings.get();
    const next = {};
    if (patch.reelSpendLimitUsd !== undefined) {
      const v = patch.reelSpendLimitUsd === '' || patch.reelSpendLimitUsd === null ? null : Number(patch.reelSpendLimitUsd);
      if (v !== null && !(v >= 0)) throw new StudioError('BAD_VALUE', '한도는 0 이상의 숫자여야 합니다.');
      next.reelSpendLimitUsd = v;
    }
    if (patch.modelEstimates) {
      next.modelEstimates = Object.assign({}, cur.modelEstimates);
      Object.entries(patch.modelEstimates).forEach(([mid, e]) => {
        modelById(store.models(), mid);
        const table = {};
        Object.entries((e && e.usdByDuration) || {}).forEach(([sec, usd]) => {
          if (usd === '' || usd === null) return;
          if (!(Number(usd) >= 0)) throw new StudioError('BAD_VALUE', '가격은 0 이상의 숫자여야 합니다.');
          table[String(sec)] = Number(usd);
        });
        next.modelEstimates[mid] = { usdByDuration: table, enteredAt: nowIso() };
      });
    }
    if (patch.voiceUsdPer1kChars !== undefined) next.voiceUsdPer1kChars = patch.voiceUsdPer1kChars === '' || patch.voiceUsdPer1kChars === null ? null : Number(patch.voiceUsdPer1kChars);
    if (patch.defaultModelId) { modelById(store.models(), patch.defaultModelId); next.defaultModelId = patch.defaultModelId; }
    if (patch.render) next.render = Object.assign({}, cur.render, patch.render);
    store.settings.save(next);
    return publicSettings();
  }

  /** Mock-mode only: two placeholder reference portraits so the pipeline can be demonstrated without real art. */
  async function loadDemoReferences() {
    if (video.mode !== 'mock') throw new StudioError('LIVE_MODE', '데모 임시 이미지는 목업 모드에서만 만들 수 있습니다. 실제 캐릭터 참조 이미지를 올리세요.');
    const made = [];
    for (const [id, [c0, c1]] of Object.entries({ jack: ['0xC9B79C', '0x6B5844'], diane: ['0xE5C9B8', '0x7C5A52'] })) {
      const c = store.characters.get(id);
      if (c.references.some((r) => r.placeholder)) continue;
      const tmp = store.path('tmp-' + id + '.png');
      await new Promise((resolve, reject) => execFile(cfg.ffmpeg.ffmpeg, ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', `gradients=s=720x960:d=1:c0=${c0}:c1=${c1}:speed=0.001`, '-vf', 'drawbox=x=250:y=180:w=220:h=220:color=0xF4EDE0@0.85:t=fill,drawbox=x=190:y=420:w=340:h=420:color=0xF4EDE0@0.6:t=fill', '-frames:v', '1', tmp], (e) => (e ? reject(e) : resolve())));
      const buf = fs.readFileSync(tmp);
      fs.rmSync(tmp, { force: true });
      store.characters.addReference(id, { buffer: buf, filename: id + '-demo-placeholder.png', mime: 'image/png', placeholder: true, label: '데모 임시 이미지 (실제 참조 아님)' });
      const added = store.characters.get(id).references.find((r) => r.placeholder);
      store.characters.setReferenceApproved(id, added.id, true, 'demo-placeholder');
      made.push(id);
    }
    return made;
  }

  async function uploadSfx(id, buffer, filename, label, atSec) {
    const ext = path.extname(filename || '').toLowerCase();
    if (!['.wav', '.mp3', '.m4a', '.ogg'].includes(ext)) throw new StudioError('BAD_TYPE', 'WAV, MP3, M4A, OGG 오디오만 올릴 수 있습니다.');
    const hash = sha256(buffer).slice(0, 12);
    store.episodes.saveFile(id, path.join('sfx', hash + ext), buffer);
    await store.episodes.update(id, (ep) => {
      ep.sfx.push({ id: 'fx_' + hash, label: String(label || safeName(filename)), file: path.join('sfx', hash + ext), atSec: num(atSec, 0), gainDb: -6, sha256: hash });
    });
    return episodeView(id);
  }
  async function updateSfx(id, sfxId, patch) {
    await store.episodes.update(id, (ep) => {
      const s = ep.sfx.find((x) => x.id === sfxId);
      if (!s) throw new StudioError('NOT_FOUND', '효과음을 찾을 수 없습니다.', { status: 404 });
      if (patch.atSec !== undefined) s.atSec = Math.max(0, num(patch.atSec, s.atSec));
      if (patch.gainDb !== undefined) s.gainDb = Math.min(6, Math.max(-30, num(patch.gainDb, s.gainDb)));
      if (patch.remove) ep.sfx = ep.sfx.filter((x) => x.id !== sfxId);
    });
    return episodeView(id);
  }

  // ---------- media lookup (ids only; never raw client paths) ----------
  function mediaFile(kind, a, b, c) {
    if (kind === 'product') return products.mediaFile(a, b);
    if (kind === 'ref') {
      const ch = store.characters.get(a);
      const r = ch.references.find((x) => x.id === b);
      if (!r) throw new StudioError('NOT_FOUND', '이미지를 찾을 수 없습니다.', { status: 404 });
      return store.characters.refPath(a, r);
    }
    const ep = store.episodes.get(a);
    if (kind === 'clip') {
      const v = ((ep.clips[b] || {}).versions || []).find((x) => x.v === Number(c));
      if (!v) throw new StudioError('NOT_FOUND', '클립을 찾을 수 없습니다.', { status: 404 });
      return store.episodes.file(a, v.file);
    }
    if (kind === 'render') {
      const r = ep.renders.find((x) => x.v === Number(b));
      if (!r) throw new StudioError('NOT_FOUND', '렌더를 찾을 수 없습니다.', { status: 404 });
      return store.episodes.file(a, r.file);
    }
    if (kind === 'audio') {
      const l = ep.lines.find((x) => x.id === b);
      const au = l && voice.lineAudio(ep, l);
      if (!au || !au.valid) throw new StudioError('NOT_FOUND', '음성이 없습니다.', { status: 404 });
      return au.file;
    }
    if (kind === 'startframe') {
      const s = ep.scenes.find((x) => x.id === b);
      if (!s || !s.startImage || s.startImage.type !== 'upload') throw new StudioError('NOT_FOUND', '시작 프레임이 없습니다.', { status: 404 });
      return store.episodes.file(a, 'startframes', s.startImage.file);
    }
    throw new StudioError('NOT_FOUND', '알 수 없는 미디어입니다.', { status: 404 });
  }

  return {
    cfg, store, video, gen, voice, renderer, publishing, vault: keys, runtime, usage, prompts, router, products, storylab, scriptgen, integrations, createEpisodeFromConcept, migrateLegacy,
    summary, episodeView, providerStatus, createEpisode, saveScript, approveScript, revokeScript, restoreVersion, addSuggestion,
    rebuildPrompts, savePrompt, setStartImage, uploadStartFrame, approveStartFrame, approveStoryboard, setSpendLimit,
    updateCharacter, characterView, promptStatus: promptSvc.status, saveSettings, loadDemoReferences, uploadSfx, updateSfx, mediaFile,
  };
}

module.exports = { createStudio };
