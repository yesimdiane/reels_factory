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
const { createEpisodeIds } = require('./episodeids');
const { createStoryboardAssets } = require('./storyboardassets');
const { createScriptPresets } = require('./scriptpresets');
const { createEndingTemplates } = require('./endingtemplates');
const F = require('./formula');
const SF = require('./scriptformula');
const { createStartImages } = require('./startimages');
const { createProjects } = require('./projects');
const { createTranslator } = require('./translate');
const cuts = require('./cuts');
const { createCutPresets } = require('./cutpresets');
const { run: runFfmpeg } = require('../../renderer/lib/ffmpeg');
const { createIntegrations } = require('./integrations');
const { createVideoProvider } = require('./providers');
const { createGenerationService } = require('./generation');
const { createVoiceService } = require('./voice');
const { createRenderService } = require('./render');
const { createPromptService } = require('./promptgen');
const { createPublishingService, checklist: publishChecklist, validate: validatePublishing } = require('./publishing');
const { dialogueTiming, checkTitleKo, sceneTitle, validateScript, pipeline, isScriptApproved, isStoryboardApproved, scriptFingerprint, storyboardFingerprint, totalPlannedSec } = require('./episode');
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
  const presets = createScriptPresets({ store, prompts, seedDir: SEED_DIR });
  const endings = createEndingTemplates({ store, seedDir: SEED_DIR });
  const episodeIds = createEpisodeIds({ store, products });
  const scriptgen = createScriptGen({ store, products, storylab, episodeIds, prompts, presets, endings, router, lib: () => store.characters.load() });
  const translator = createTranslator({ store, router });
  const cutPresets = createCutPresets({ store });
  const startImages = createStartImages({ store, products, router, lib: () => store.characters.load(), log });
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
  const sba = createStoryboardAssets({ store, dialogueTiming, lib: () => store.characters.load() });
  const gen = createGenerationService({ store, provider: video, cfg, log, composePrompt: sba.composePrompt });
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
  // Projects / scene approvals / Image Development hand-off (no AI or video provider is wired in: nothing here can spend money).
  const projects = createProjects({ store, lib: () => store.characters.load(), endings, products, episodeIds, log });
  store.episodes.hooks.before = projects.hooks.before;
  store.episodes.hooks.after = projects.hooks.after;

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
  /** Compact asset availability for Script Studio (no galleries): product reference photos, per-character reference + voice readiness. */
  function assetReadiness(ep) {
    let productReady = false; let productCount = 0;
    try { const b = products.bindingFor(ep.productId); productCount = (b.reference.imageIds || []).length; productReady = !!(b.reference.approved || b.reference.waived) && (productCount > 0 || !!b.reference.waived); } catch (_) { productReady = !!(ep.productRefs && (ep.productRefs.imageIds || []).length); productCount = ((ep.productRefs || {}).imageIds || []).length; }
    const keyOk = !!runtime.heygenKey();
    const chars = lib().characters.filter((c) => (ep.characters || []).includes(c.id)).map((c) => {
      const referenceReady = c.references.some((r) => r.approved);
      const voiceReady = !!c.voice.heygenVoiceId && keyOk;
      return { id: c.id, name: c.name, referenceReady, voiceReady, voiceNote: voiceReady ? '목소리 준비' : '목소리 API 필요' };
    });
    return { product: { ready: productReady, count: productCount }, characters: chars };
  }


  function jobsRunning(ep) {
    return (ep.generation.jobs || []).some((j) => ACTIVE_JOB.has(j.status));
  }

  /** Structured view of the fixed formula for the Script Studio UI (Part A beats, Part B template slots, what is template vs episode-specific). */
  function formulaView(ep) {
    if (!F.isStructured(ep)) return { structured: false };
    const shape = (key, group) => {
      const b = ep[group][key] || {};
      return Object.assign({ key, label: (F.beatMeta(key) || {}).ko, labelEn: (F.beatMeta(key) || {}).en, role: (F.beatMeta(key) || {}).role || '' }, b, { subtitle_ko: F.beatSubtitles(ep, key) });
    };
    return {
      structured: true,
      partA: F.BEAT_KEYS.map((k) => shape(k, 'comedy_story')),
      partB: F.ENDING_KEYS.map((k) => shape(k, 'product_ending')),
      ending: { templateId: (ep.ending || {}).templateId, templateName: (ep.ending || {}).templateName, templateVersion: (ep.ending || {}).templateVersion, pinnedVersion: (ep.ending || {}).version || null, structureLocked: !!(ep.ending || {}).structureLocked, vars: SF.endingVars(ep), manualVars: (ep.ending || {}).manualVars || [] },
    };
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
    // Resolve current Product Studio uploads at read time, including older episodes
    // without a reference-set snapshot. Previewing does not approve these images.
    let productStudioImages = [];
    if (ep.productId) {
      try {
        productStudioImages = products.get(ep.productId).images
          .filter((im) => !['replaced', 'rejected'].includes(im.status))
          .map((im) => ({ id: im.id, url: im.url, kind: im.kind, kindLabel: im.kindLabel, label: im.label, status: im.status }));
      } catch (e) { if (!['NOT_FOUND', 'BAD_ID'].includes(e.code)) throw e; }
    }
    const readiness = projects.readiness(ep);
    const sceneLinks = projects.sceneLinks(ep);
    const sceneViews = ep.scenes.map((s) => {
      const img = gen.startImage(ep, s);
      const clips = ep.clips[s.id] || { versions: [], approvedVersion: null };
      const model = modelById(store.models(), settings.defaultModelId);
      return Object.assign({}, s, {
        title_ko: sceneTitle(s),
        titleKoMissing: !s.title_ko,
        clipSec: clipSecFor(model, s.durationSec),
        prompt: ep.prompts[s.id] || null,
        motion: (ep.motion && ep.motion[s.id]) || null,
        broll: (ep.broll || []).filter((b) => b.sceneId === s.id && b.status !== 'removed'),
        promptWarnings: ep.prompts[s.id] ? lintPrompt(ep.prompts[s.id].video, ep) : [],
        castWarnings: ep.prompts[s.id] ? lintCast(ep.prompts[s.id].video, s, L) : [],
        usesSheet: promptSvc.usesSheetFor(s, L),
        productImages: s.showsProduct ? productStudioImages : [],
        startImageInfo: img.error ? { error: img.error } : { label: img.label, generated: !!img.generated, approved: img.approved, placeholder: img.placeholder, url: img.characterId ? `/media/ref/${img.characterId}/${img.refId}` : `/media/startframe/${id}/${s.id}` },
        clips: { approvedVersion: clips.approvedVersion, versions: clips.versions.map((v) => Object.assign({}, v, { url: `/media/clip/${id}/${s.id}/${v.v}` })) },
        line: ep.lines.filter((l) => l.sceneId === s.id).map((l) => l.id),
        approval: readiness.scenes.find((x) => x.sceneId === s.id),
        cutInfo: cutInfoFor(ep, s),
        link: sceneLinks[s.id] || null,
      });
    });
    // Dialogue timing: ESTIMATE (words → seconds) vs ACTUAL (recorded/synthesized audio, when every line of the scene has current audio).
    const timing = dialogueTiming(ep).map((t) => {
      const own = ep.lines.filter((l) => l.sceneId === t.sceneId);
      const audio = own.map((l) => voice.lineAudio(ep, l));
      const done = audio.filter((a) => a.valid);
      const complete = own.length > 0 && done.length === own.length;
      const actualNeed = complete ? Math.round((0.25 + done.reduce((n, a) => n + a.durationSec, 0) + 0.18 * (done.length - 1) + 0.35) * 100) / 100 : null;
      return Object.assign({}, t, { actual: { complete, syncedLines: done.length, totalLines: own.length, needSec: actualNeed, overSec: actualNeed == null ? null : Math.round((actualNeed - t.durationSec) * 100) / 100, mock: done.some((a) => a.mock) } });
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
        project: { id: ep.projectId || '', name: (projects.ensureProject(ep) || {}).name || '' },
        sceneApproval: { progress: readiness.progress, approvedCount: readiness.approvedCount, sceneCount: readiness.sceneCount, allScenesApproved: readiness.allScenesApproved, blockers: readiness.blockers, canApproveProject: readiness.canApprove, readyScenes: readiness.readyScenes },
        handoff: Object.assign(projects.handoffState(ep), { ready: isScriptApproved(ep) && readiness.allScenesApproved }),
        steps,
        timing: { scenes: timing, overCount: timing.filter((t) => t.status !== 'ok' && t.lineCount).length, overflowCount: timing.filter((t) => t.status === 'overflow').length, totalOverSec: Math.round(timing.reduce((n, t) => n + (t.lineCount && t.overSec > 0 ? t.overSec : 0), 0) * 100) / 100 },
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
        versions: store.episodes.versions(id).filter((v) => !deletedVersions(ep)[v.version]),
        deletedVersionCount: Object.keys(deletedVersions(ep)).length,
        header: null,
        broll: sba.brollView(ep),
        assets: assetReadiness(ep),
      },
      productRefImages: (() => {
        const refs = ep.productRefs && ep.productRefs.imageIds;
        if (!refs || !refs.length || !ep.productId) return [];
        try { const pv = products.get(ep.productId); return refs.map((i) => pv.images.find((x) => x.id === i)).filter(Boolean).map((im) => ({ id: im.id, url: im.url, kind: im.kind, kindLabel: im.kindLabel, label: im.label })); } catch (_) { return []; }
      })(),
      productStudioImages,
      formula: formulaView(ep),
      renders: ep.renders.map((r) => Object.assign({}, r, { url: `/media/render/${id}/${r.v}`, current: !!(ep.approvals.final && ep.approvals.final.v === r.v) })),
      sfx: ep.sfx,
      timeline: used,
    });
    view.derived.header = episodeHeader(ep, view.derived);
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
      episodes: eps.map((e) => ({ id: e.id, displayId: e.displayId || e.id, uuid: e.uuid || '', productCode: e.productCode || '', episodeNumber: e.episodeNumber || null, category: e.category || (e.concept && e.concept.category) || '', productId: e.productId || '', concept: e.derived.concept, title: e.title, titleEn: e.titleEn, productName: e.product.name, steps: e.derived.steps, spentUsd: e.derived.spentUsd, limitUsd: e.derived.limitUsd, totalPlannedSec: e.derived.totalPlannedSec, scenes: e.scenes.length, thumb: firstClipThumb(e), published: !!(e.publishing && e.publishing.publishedAt), finalApproved: !!e.approvals.final, archived: !!e.archivedAt, onHold: !!e.holdAt, header: e.derived.header, updatedAt: e.updatedAt })),
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
  episodeIds.migrate(); // old episodes keep their ids; each gets an immutable uuid + display id (idempotent)
  projects.migrateAll(); // old episodes: scenes of an already approved script stay approved; every episode joins a project (idempotent)

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
  async function createEpisodeFromConcept({ productId, conceptId, id, newVersion = false, requestId = '' }) {
    const epId = await scriptgen.createEpisodeFromConcept(productId, conceptId, { id, newVersion, requestId });
    store.episodes.audit(epId, 'episode.from_concept', { productId, conceptId, newVersion: !!newVersion });
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

  /** Structured product appearance for a scene (only meaningful when the product is ON): where, how big, which way, how visible, how the characters handle it, which approved reference. */
  const PLACE = { position: ['left', 'center', 'right', 'foreground', 'background'], scale: ['small', 'medium', 'large'], orientation: ['front', 'side', 'angled', 'top', 'back'], visibility: ['partial', 'full', 'hero'] };
  function cleanPlacement(p) {
    if (!p || typeof p !== 'object') return undefined;
    const out = {};
    Object.keys(PLACE).forEach((k) => { if (p[k] && PLACE[k].includes(String(p[k]))) out[k] = String(p[k]); });
    out.interaction = String(p.interaction || '').trim().slice(0, 300);
    out.refImageId = String(p.refImageId || '').slice(0, 80);
    return out;
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
        // title_ko is the Korean scene title (edited on its own); the legacy `title` mirrors it so every older reader shows the same text.
        title_ko: String(s.title_ko != null ? s.title_ko : prev.title_ko || '').trim().slice(0, 60),
        title: (s.title_ko != null ? String(s.title_ko).trim() : prev.title_ko) ? String(s.title_ko != null ? s.title_ko : prev.title_ko).trim().slice(0, 60) : String(s.title != null ? s.title : prev.title || '').slice(0, 120),
        // fixed formula: which beat (and part) the scene belongs to; a Part B scene's slot can never be re-assigned from the client
        part: prev.part === 'B' ? 'B' : (F.partOf(s.beatKey) || prev.part || ''),
        beatKey: prev.part === 'B' ? prev.beatKey : (F.partOf(s.beatKey) === 'A' ? s.beatKey : prev.beatKey || ''),
        manualEdit: !!prev.manualEdit,
        beat: num(s.beat, prev.beat || i + 1),
        durationSec: num(s.durationSec, prev.durationSec || 4),
        characters: Array.isArray(s.characters) ? s.characters.map(String) : prev.characters || [],
        showsProduct: s.showsProduct != null ? !!s.showsProduct : !!prev.showsProduct,
        visual: String(s.visual != null ? s.visual : prev.visual || '').slice(0, 2000),
        action: String(s.action != null ? s.action : prev.action || '').slice(0, 1500),
        emotion: String(s.emotion != null ? s.emotion : prev.emotion || '').slice(0, 200),
        productPlacement: s.productPlacement !== undefined ? cleanPlacement(s.productPlacement) : prev.productPlacement,
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
      return { id, sceneId: String(l.sceneId || ''), speaker: String(l.speaker || ''), en: String(l.en || '').trim(), ko: String(l.ko || '').trim(), edited: !!((ep.lines || []).find((o) => o.id === id) || {}).edited };
    });
  }

  async function saveScript(id, patch, by = 'operator', note = '') {
    const ep = await store.episodes.update(id, (ep) => {
      const prevEp = F.isStructured(ep) ? JSON.parse(JSON.stringify(ep)) : null;
      if (patch.title !== undefined) ep.title = String(patch.title).slice(0, 200);
      if (patch.titleEn !== undefined) ep.titleEn = String(patch.titleEn).slice(0, 200);
      if (Array.isArray(patch.beats)) ep.beats = patch.beats.map(String);
      if (Array.isArray(patch.scenes)) {
        ep.scenes = sanitizeScenes(patch.scenes, ep.scenes);
        if (prevEp) SF.enforceLock(prevEp, ep.scenes); // Part B structure stays locked while only its product-specific content changes
      }
      if (Array.isArray(patch.lines)) ep.lines = sanitizeLines(patch.lines, ep);
      if (prevEp) {
        SF.markEdits(prevEp, ep); // hand edits are remembered so AI actions never silently overwrite them
        SF.markBeatEdits(prevEp, ep, patch);
        if (patch.ending && typeof patch.ending === 'object') {
          const cur = SF.endingVars(ep);
          const pv = patch.ending.vars || {};
          const manual = new Set(ep.ending.manualVars || []);
          let varsChanged = false;
          Object.keys(pv).forEach((k) => { if (endings.VAR_KEYS.includes(k) && String(pv[k]).trim() !== String(cur[k] || '').trim()) { ep.ending.vars[k] = String(pv[k]).trim().slice(0, 300); manual.add(k); varsChanged = true; } });
          ep.ending.manualVars = Array.from(manual);
          if (varsChanged) SF.applyEnding(ep, endings, { respectEdits: true }); // only when a product-specific value really changed
        }
        F.syncBeats(ep);
      }
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
      projects.assertProjectReady(ep); // every scene must be approved first (never approved silently)
      ep.approvals.script = { hash: scriptFingerprint(ep), version: ep.version || 0, by, at: nowIso() };
    });
    store.episodes.audit(id, 'script.approved', { by, version: store.episodes.get(id).version || 0 });
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
    if (deletedVersions(store.episodes.get(id))[Number(n)]) throw new StudioError('VERSION_DELETED', `v${n}은 삭제된 버전입니다. 먼저 삭제를 취소하세요.`, { status: 409 });
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
      const prevP = ep.prompts[sceneId];
      const promptHistory = prevP ? (prevP.history || []).concat([{ rev: prevP.rev || 1, video: prevP.video, negative: prevP.negative, at: prevP.editedAt || prevP.at || null }]).slice(-20) : [];
      ep.prompts[sceneId] = Object.assign({}, ep.prompts[sceneId], { rev: (prevP ? prevP.rev || 1 : 0) + 1, history: promptHistory, video: text, negative: String(negative != null ? negative : (ep.prompts[sceneId] || {}).negative || ''), edited: true, editedAt: nowIso() });
    });
    return episodeView(id);
  }

  // ---------- 에피소드 삭제 = 휴지통: hidden from every list, nothing on disk is removed, restorable ----------
  /**
   * "Deleting" an episode moves it to the trash: it disappears from the lists, but its script, clips, voices, renders, approvals,
   * history and spend records stay on disk (spend still counts toward the limits) and it can be restored. Its id is never reused.
   * Refused while a generation or a render is running; a published episode needs an explicit extra confirmation.
   */
  /** Script versions that were approved at some point (current approval, Image Development snapshots, approval audit entries). They are history worth keeping. */
  function approvedScriptVersions(ep) {
    const set = new Set();
    if (ep.approvals && ep.approvals.script && ep.approvals.script.version != null) set.add(Number(ep.approvals.script.version));
    ((ep.imageDev && ep.imageDev.snapshots) || []).forEach((x) => x.scriptVersion != null && set.add(Number(x.scriptVersion)));
    try { store.episodes.auditLog(ep.id, 5000).forEach((e) => e.event === 'script.approved' && e.version != null && set.add(Number(e.version))); } catch (_) { /* no audit yet */ }
    return set;
  }
  const deletedVersions = (ep) => ep.deletedVersions || {};

  /** What deleting this episode touches — shown in the confirmation. Nothing here is removed from disk; the whole episode moves to the trash and comes back as it was. */
  function episodeImpact(id) {
    const ep = store.episodes.get(id);
    const del = deletedVersions(ep);
    const versions = store.episodes.versions(id).filter((v) => !del[v.version]);
    const approvedV = [...approvedScriptVersions(ep)].filter((n) => versions.some((v) => v.version === n));
    const scenes = ep.scenes || [];
    const prompts = Object.keys(ep.prompts || {}).length;
    const imgs = scenes.filter((x) => x.startImage && x.startImage.file);
    const clipVersions = Object.values(ep.clips || {}).reduce((n, c) => n + ((c && c.versions) || []).length, 0);
    const clipApproved = Object.values(ep.clips || {}).filter((c) => c && c.approvedVersion).length;
    const voiceLines = Object.keys((ep.voice && ep.voice.lines) || {}).length;
    const renders = (ep.renders || []).length;
    const published = !!(ep.publishing && ep.publishing.publishedAt);
    const protectedItems = [];
    if (approvedV.length) protectedItems.push(`승인된 대본 버전 ${approvedV.map((n) => 'v' + n).join(', ')}`);
    if (ep.approvals && ep.approvals.storyboard) protectedItems.push('승인된 스토리보드');
    if (clipApproved) protectedItems.push(`승인된 클립 ${clipApproved}개`);
    if (ep.approvals && ep.approvals.final) protectedItems.push('최종 승인된 영상');
    if (published) protectedItems.push('게시 기록');
    return {
      id, title: ep.title, published, archived: !!ep.archivedAt,
      scripts: { versions: versions.length, approved: approvedV, current: ep.version || 0, scenes: scenes.length, lines: (ep.lines || []).length },
      storyboards: { prompts, approved: !!(ep.approvals && ep.approvals.storyboard) },
      images: { startImages: imgs.length, approvedStartImages: imgs.filter((x) => x.startImage.approved).length },
      videos: { clipVersions, approvedClips: clipApproved, renders, finalApproved: !!(ep.approvals && ep.approvals.final), voiceLines },
      spentUsd: (ep.spend || []).reduce((n, x) => n + (Number(x.usd) || 0), 0),
      protected: protectedItems,
      requiresApprovedConfirm: protectedItems.length > 0,
      busy: !!(jobsRunning(ep) || (ep.renderJob && ep.renderJob.status === 'running')),
    };
  }

  /**
   * 삭제 = 휴지통: the episode leaves every list but NOTHING is removed from disk — scripts, storyboards, images, clips, voices, renders,
   * approvals and spend stay as they were and come back on restore. Refused while a generation or a render is running. Episodes that carry
   * approved history (approved script / storyboard / clips / final) or were published need an explicit confirmation.
   */
  async function trashEpisode(id, { confirmPublished = false, confirmApproved = false, by = 'operator' } = {}) {
    const ep0 = store.episodes.get(id);
    if (ep0.trashedAt) throw new StudioError('ALREADY_TRASHED', '이미 휴지통에 있는 에피소드입니다.', { status: 409 });
    if (jobsRunning(ep0) || (ep0.renderJob && ep0.renderJob.status === 'running')) throw new StudioError('BUSY', '영상 생성이나 렌더링이 진행 중인 에피소드는 지울 수 없습니다. 끝난 뒤 다시 시도하세요.', { status: 409 });
    if (ep0.publishing && ep0.publishing.publishedAt && !confirmPublished) throw new StudioError('PUBLISHED', '이미 게시한 에피소드입니다. 휴지통으로 옮기려면 한 번 더 확인해야 합니다.', { status: 409, details: [{ publishedAt: ep0.publishing.publishedAt }] });
    const imp = episodeImpact(id);
    if (imp.protected.length && !confirmApproved && !(imp.protected.length === 1 && imp.published && confirmPublished)) {
      throw new StudioError('APPROVED_CONTENT', `승인된 기록이 있는 에피소드입니다 (${imp.protected.join(' · ')}). 삭제하려면 명시적으로 확인해야 합니다.`, { status: 409, details: imp.protected, recovery: '확인하면 휴지통으로 이동하며, 승인 기록은 지워지지 않고 복원하면 그대로 돌아옵니다.' });
    }
    await store.episodes.update(id, (ep) => { ep.trashedAt = nowIso(); ep.trashedBy = by; });
    store.episodes.audit(id, 'episode.trashed', { by, confirmedApproved: !!confirmApproved });
    return { id, trashed: true };
  }
  async function restoreEpisode(id, by = 'operator') {
    const ep0 = store.episodes.get(id);
    if (!ep0.trashedAt) throw new StudioError('NOT_TRASHED', '휴지통에 있는 에피소드가 아닙니다.', { status: 409 });
    await store.episodes.update(id, (ep) => { delete ep.trashedAt; delete ep.trashedBy; });
    store.episodes.audit(id, 'episode.restored', { by });
    return episodeView(id);
  }
  const trashList = () => store.episodes.list({ trashed: true }).map((e) => ({ id: e.id, title: e.title, productName: (e.product || {}).name || '', trashedAt: e.trashedAt, scenes: (e.scenes || []).length, published: !!(e.publishing && e.publishing.publishedAt), finalApproved: !!(e.approvals && e.approvals.final) }));

  /** 보관: keeps the episode (and everything linked to it) but moves it out of the working list. Not a deletion; reversible with 보관 해제. */
  async function archiveEpisode(id, by = 'operator') {
    const ep0 = store.episodes.get(id);
    if (ep0.trashedAt) throw new StudioError('TRASHED', '휴지통에 있는 에피소드는 보관할 수 없습니다. 먼저 복원하세요.', { status: 409 });
    if (ep0.archivedAt) throw new StudioError('ALREADY_ARCHIVED', '이미 보관된 에피소드입니다.', { status: 409 });
    await store.episodes.update(id, (ep) => { ep.archivedAt = nowIso(); ep.archivedBy = by; });
    store.episodes.audit(id, 'episode.archived', { by });
    return episodeView(id);
  }
  async function unarchiveEpisode(id, by = 'operator') {
    const ep0 = store.episodes.get(id);
    if (!ep0.archivedAt) throw new StudioError('NOT_ARCHIVED', '보관된 에피소드가 아닙니다.', { status: 409 });
    await store.episodes.update(id, (ep) => { delete ep.archivedAt; delete ep.archivedBy; });
    store.episodes.audit(id, 'episode.unarchived', { by });
    return episodeView(id);
  }

  /** 보류: pauses an episode. It stays visible, nothing is removed, and every PAID action (AI script, images, video generation) is refused until it is resumed. */
  async function holdEpisode(id, reason = '', by = 'operator') {
    const ep0 = store.episodes.get(id);
    if (ep0.trashedAt) throw new StudioError('TRASHED', '휴지통에 있는 에피소드입니다.', { status: 409 });
    if (ep0.holdAt) throw new StudioError('ALREADY_HOLD', '이미 보류 중인 에피소드입니다.', { status: 409 });
    await store.episodes.update(id, (ep) => { ep.holdAt = nowIso(); ep.holdBy = by; ep.holdReason = String(reason || '').slice(0, 300); });
    store.episodes.audit(id, 'episode.hold', { by, reason: String(reason || '').slice(0, 300) });
    return episodeView(id);
  }
  async function resumeEpisode(id, by = 'operator') {
    const ep0 = store.episodes.get(id);
    if (!ep0.holdAt) throw new StudioError('NOT_HOLD', '보류 중인 에피소드가 아닙니다.', { status: 409 });
    await store.episodes.update(id, (ep) => { delete ep.holdAt; delete ep.holdBy; delete ep.holdReason; });
    store.episodes.audit(id, 'episode.resumed', { by });
    return episodeView(id);
  }
  function assertNotHeld(id) {
    const ep = store.episodes.get(id);
    if (ep.holdAt) throw new StudioError('EPISODE_ON_HOLD', '보류 중인 에피소드입니다. 보류를 해제한 뒤 유료 생성을 진행하세요.', { status: 409, recovery: '에피소드 메뉴 → 보류 해제' });
  }
  /** Title is the only free-text field that is edited here; the ID, uuid, product and story snapshot never change. */
  async function editEpisode(id, { title } = {}, by = 'operator') {
    const t = String(title == null ? '' : title).trim().slice(0, 200);
    if (!t) throw new StudioError('NEED_TITLE', '제목을 입력하세요.', { status: 422 });
    const before = store.episodes.get(id).title;
    if (before === t) return episodeView(id);
    await store.episodes.update(id, (ep) => { ep.title = t; });
    store.episodes.audit(id, 'episode.edited', { by, field: 'title', from: before, to: t });
    return episodeView(id);
  }
  /** What the compact Episode header shows. Advanced metadata (uuid, ids, versions …) is deliberately not part of it. */
  function episodeHeader(ep, derived) {
    const steps = derived.steps || [];
    const cur = steps.find((x) => x.state !== 'done') || null;
    const approvals = [
      { key: 'story', label: '스토리', ok: !!(ep.story || ep.concept) && !!(derived.concept && derived.concept.ok !== false) },
      { key: 'script', label: '대본', ok: !!derived.scriptApproved },
      { key: 'storyboard', label: '스토리보드', ok: !!(steps.find((x) => x.key === 'storyboard') || {}).state && steps.find((x) => x.key === 'storyboard').state === 'done' },
      { key: 'final', label: '최종', ok: !!(ep.approvals && ep.approvals.final) },
    ];
    return {
      code: ep.displayId || ep.id, title: ep.title, productName: (ep.product || {}).name || '', productCode: ep.productCode || '', category: ep.category || (ep.concept && ep.concept.category) || '',
      stage: cur ? { key: cur.key, label: cur.label, state: cur.state } : { key: 'done', label: '완료', state: 'done' },
      approvals, approvedCount: approvals.filter((a) => a.ok).length,
      onHold: !!ep.holdAt, holdReason: ep.holdReason || '', archived: !!ep.archivedAt, published: !!(ep.publishing && ep.publishing.publishedAt),
      resumeStep: cur ? cur.key : null,
    };
  }

  /** The CURRENT category is a separate field: changing it never changes the Episode ID (UMB-01-D stays UMB-01-D). */
  async function setEpisodeCategory(id, category, by = 'operator') {
    if (!['drama', 'viral', 'info'].includes(category)) throw new StudioError('INVALID_CATEGORY', '알 수 없는 스토리 카테고리입니다: ' + category, { status: 422 });
    const before = store.episodes.get(id).category || null;
    if (before === category) return episodeView(id);
    await store.episodes.update(id, (ep) => { ep.category = category; ep.categoryHistory = (ep.categoryHistory || []).concat([{ from: before, to: category, at: nowIso(), by }]); });
    store.episodes.audit(id, 'episode.category_changed', { by, from: before, to: category });
    return episodeView(id);
  }

  // ---------- script versions: soft delete (the numbered version file is never removed) ----------
  /** Every saved script version with its state. Deleted versions stay listed (with deleted: true) so they can be restored. */
  function scriptVersions(id) {
    const ep = store.episodes.get(id);
    const del = deletedVersions(ep);
    const approved = approvedScriptVersions(ep);
    const cur = ep.approvals && ep.approvals.script ? Number(ep.approvals.script.version) : null;
    return store.episodes.versions(id).map((v) => Object.assign({}, v, {
      current: v.version === (ep.version || 0), approvedNow: cur === v.version, wasApproved: approved.has(v.version),
      deleted: !!del[v.version], deletedAt: (del[v.version] || {}).at || null,
      canDelete: !del[v.version] && v.version !== (ep.version || 0),
    }));
  }
  /**
   * Hides one saved script version. The parent episode, the current script, other versions and every asset (storyboard prompts, images, clips,
   * voices, renders, approved-script snapshots) are untouched. The live version cannot be deleted; a version that was approved needs confirmApproved.
   */
  async function deleteScriptVersion(id, n, { confirmApproved = false, by = 'operator' } = {}) {
    n = Number(n);
    const ep0 = store.episodes.get(id);
    if (ep0.trashedAt) throw new StudioError('TRASHED', '휴지통에 있는 에피소드입니다.', { status: 409 });
    store.episodes.version(id, n); // 404 when missing
    if (deletedVersions(ep0)[n]) throw new StudioError('ALREADY_DELETED', `v${n}은 이미 삭제되었습니다.`, { status: 409 });
    if (n === (ep0.version || 0)) throw new StudioError('CURRENT_VERSION', `v${n}은 지금 사용 중인 대본입니다. 다른 버전으로 되돌린 뒤 삭제하세요.`, { status: 409, recovery: '대본 스튜디오 → 버전 기록에서 다른 버전을 복원하면 이 버전을 삭제할 수 있습니다.' });
    const wasApproved = approvedScriptVersions(ep0).has(n);
    if (wasApproved && !confirmApproved) throw new StudioError('APPROVED_VERSION', `v${n}은 승인된 적이 있는 대본입니다. 삭제하려면 명시적으로 확인해야 합니다.`, { status: 409, details: [{ version: n }], recovery: '확인해도 파일은 지워지지 않고 목록에서만 숨겨지며 언제든 복원할 수 있습니다.' });
    await store.episodes.update(id, (ep) => { ep.deletedVersions = Object.assign({}, ep.deletedVersions, { [n]: { at: nowIso(), by, wasApproved } }); });
    store.episodes.audit(id, 'script.version_deleted', { by, version: n, wasApproved });
    return { id, version: n, deleted: true, versions: scriptVersions(id) };
  }
  async function undeleteScriptVersion(id, n, by = 'operator') {
    n = Number(n);
    const ep0 = store.episodes.get(id);
    if (!deletedVersions(ep0)[n]) throw new StudioError('NOT_DELETED', `v${n}은 삭제된 버전이 아닙니다.`, { status: 409 });
    await store.episodes.update(id, (ep) => { const d = Object.assign({}, ep.deletedVersions); delete d[n]; ep.deletedVersions = d; });
    store.episodes.audit(id, 'script.version_restored', { by, version: n });
    return { id, version: n, deleted: false, versions: scriptVersions(id) };
  }

  // ---------- insert shots (컷 추가): crops of the scene's own approved clip; no AI / video call, no cost ----------
  /** The picture the crops come from: the approved clip (else the newest one); before any clip exists only the start image can be previewed. */
  function cutSource(ep, scene) {
    const c = ep.clips[scene.id] || { versions: [], approvedVersion: null };
    const v = c.versions.find((x) => x.v === c.approvedVersion) || c.versions[c.versions.length - 1];
    if (v) return { kind: 'clip', approved: v.v === c.approvedVersion, v: v.v, width: v.width || 0, height: v.height || 0, durationSec: v.durationSec || 0 };
    const img = gen.startImage(ep, scene);
    if (!img.error && img.file && !img.characterId) return { kind: 'start_image', approved: !!img.approved, width: 0, height: 0, durationSec: 0 };
    return { kind: 'none', approved: false, width: 0, height: 0, durationSec: 0 };
  }
  function cutInfoFor(ep, scene) {
    const src = cutSource(ep, scene);
    let inserts = []; let warnings = [];
    try { ({ inserts, warnings } = cuts.normalizeInserts(scene.inserts || [], { durationSec: scene.durationSec, src, sceneId: scene.id })); } catch (e) { warnings = [{ code: e.code || 'INSERTS_INVALID', message: e.message }]; inserts = scene.inserts || []; }
    return { source: src, inserts, warnings, effectNote: '컷은 카메라 크롭입니다. 새로운 눈·표정 움직임은 만들지 않습니다.' };
  }
  /** Replaces the scene's insert shots (the whole editable list). Versioned; the scene needs a new approval; the scene length never changes. */
  async function saveInserts(id, sceneId, list, by = 'operator') {
    const ep0 = store.episodes.get(id);
    const sc0 = ep0.scenes.find((x) => x.id === sceneId);
    if (!sc0) throw new StudioError('NOT_FOUND', '장면을 찾을 수 없습니다: ' + sceneId, { status: 404 });
    const { inserts, warnings } = cuts.normalizeInserts(list, { durationSec: sc0.durationSec, src: cutSource(ep0, sc0), sceneId });
    await store.episodes.update(id, (ep) => {
      const sc = ep.scenes.find((x) => x.id === sceneId);
      sc.inserts = inserts.map((i) => { const { resolution, motion, ...keep } = i; return keep; });
    }, { snapshot: true, by, note: `컷 편집 (${sceneId})` });
    store.episodes.audit(id, 'scene.inserts', { sceneId, count: inserts.length, by });
    const v = episodeView(id);
    v.cutWarnings = warnings;
    return v;
  }
  /** A still frame of the approved clip (cached JPEG) for the crop preview. t is clamped to the clip; the start image is used before a clip exists. */
  async function cutFrame(id, sceneId, t = 0) {
    const ep = store.episodes.get(id);
    const sc = ep.scenes.find((x) => x.id === sceneId);
    if (!sc) throw new StudioError('NOT_FOUND', '장면을 찾을 수 없습니다.', { status: 404 });
    const src = cutSource(ep, sc);
    if (src.kind === 'start_image') return gen.startImage(ep, sc).file;
    if (src.kind !== 'clip') throw new StudioError('NO_SOURCE', '이 장면에는 미리볼 클립이나 시작 이미지가 없습니다.', { status: 404 });
    const ver = ep.clips[sceneId].versions.find((x) => x.v === src.v);
    const clipFile = store.episodes.file(id, ver.file);
    const at = Math.max(0, Math.min(Number(t) || 0, Math.max(0, (src.durationSec || 1) - 0.1)));
    const out = store.cachePath('cutframes', `${ver.sha256.slice(0, 16)}-${at.toFixed(1)}.jpg`);
    if (!fs.existsSync(out)) {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await runFfmpeg(cfg.ffmpeg.ffmpeg, ['-hide_banner', '-y', '-ss', at.toFixed(2), '-i', clipFile, '-frames:v', '1', '-q:v', '3', out], { cwd: path.dirname(out) });
    }
    return out;
  }

  /**
   * 씬 저장: saves ONE scene (its fields and its dialogue lines) as a draft, even when validation is incomplete. Other scenes, their ids,
   * order, dialogue, assets and approvals are untouched. Saving never approves: an approved scene that is edited simply becomes a new
   * draft revision (its approved version stays in the approval history).
   */
  async function saveScene(id, sceneId, patch = {}, by = 'operator') {
    await store.episodes.update(id, (ep) => {
      const sc = ep.scenes.find((x) => x.id === sceneId);
      if (!sc) throw new StudioError('NOT_FOUND', '장면을 찾을 수 없습니다: ' + sceneId, { status: 404 });
      const prevEp = F.isStructured(ep) ? JSON.parse(JSON.stringify(ep)) : null;
      const incoming = Object.assign({}, patch.scene || {}, { id: sceneId });
      const [clean] = sanitizeScenes([incoming], [sc]);
      // identity, order and position in the story never change from a scene save
      Object.assign(sc, clean, { id: sc.id, part: sc.part, beatKey: sc.beatKey, beat: sc.beat });
      if (Array.isArray(patch.lines)) {
        const others = ep.lines.filter((l) => l.sceneId !== sceneId);
        const used = new Set(others.map((l) => l.id));
        let n = 0;
        ep.lines.forEach((l) => { const m = /^L(\d+)/.exec(l.id); if (m) n = Math.max(n, Number(m[1])); });
        const old = new Map(ep.lines.filter((l) => l.sceneId === sceneId).map((l) => [l.id, l]));
        const mine = patch.lines.map((l) => {
          let lid = String(l.id || '').trim();
          if (!lid || used.has(lid)) { do { n += 1; lid = 'L' + n; } while (used.has(lid)); }
          used.add(lid);
          return { id: lid, sceneId, speaker: String(l.speaker || ''), en: String(l.en || '').trim(), ko: String(l.ko || '').trim(), edited: !!(old.get(lid) || {}).edited };
        });
        const at = ep.lines.findIndex((l) => l.sceneId === sceneId);
        const rest = ep.lines.filter((l) => l.sceneId !== sceneId);
        const pos = at < 0 ? rest.length : ep.lines.slice(0, at).filter((l) => l.sceneId !== sceneId).length;
        ep.lines = rest.slice(0, pos).concat(mine, rest.slice(pos));
      }
      if (prevEp) { SF.markEdits(prevEp, ep); F.syncBeats(ep); }
    }, { snapshot: true, by, note: `씬 저장 (${sceneId})` });
    store.episodes.audit(id, 'scene.saved', { sceneId, by });
    await syncPromptsWithCast(id);
    return episodeView(id);
  }

  /** 씬 추가: a new empty scene right after `afterSceneId` (formula episodes: inside that Part A beat, or at the end of "제품 연결" when the current scene is Part B). Nothing existing is overwritten. */
  async function addScene(id, { afterSceneId, beatKey } = {}, by = 'operator') {
    let newId = '';
    await store.episodes.update(id, (ep) => {
      // never reuse an id that still has clips / prompts / approval history (a deleted scene's assets must not attach to a new scene)
      const used = new Set(ep.scenes.map((s) => s.id).concat(Object.keys(ep.clips || {}), Object.keys(ep.prompts || {}), Object.keys(ep.sceneApprovals || {})));
      let n = ep.scenes.length + 1;
      while (used.has('S' + n)) n += 1;
      newId = 'S' + n;
      const structured = F.isStructured(ep);
      const after = (afterSceneId && ep.scenes.find((s) => s.id === afterSceneId)) || ep.scenes[ep.scenes.length - 1] || null;
      let key = '';
      let idx = ep.scenes.length;
      if (structured) {
        key = beatKey || (after && after.part === 'A' ? after.beatKey : 'product_bridge');
        if (!F.BEAT_KEYS.includes(key)) throw new StudioError('BAD_BEAT', '새 장면은 PART A의 여섯 단계 중 하나에 들어가야 합니다.', { status: 422 });
        if (after && after.part === 'A' && after.beatKey === key) idx = ep.scenes.indexOf(after) + 1;
        else { let last = -1; ep.scenes.forEach((s, i) => { if (s.part === 'A' && s.beatKey === key) last = i; }); idx = last >= 0 ? last + 1 : ep.scenes.filter((s) => s.part === 'A').length; }
      } else if (after) idx = ep.scenes.indexOf(after) + 1;
      const sc = { id: newId, part: structured ? 'A' : '', beatKey: key, beat: structured ? F.ALL_KEYS.indexOf(key) + 1 : idx + 1, title_ko: '', title: '', durationSec: 4, characters: after ? (after.characters || []).slice() : [], showsProduct: false, visual: '', action: '', narration: '', placement: '', manualEdit: true };
      ep.scenes.splice(idx, 0, sc);
      const nxt = ep.scenes[idx + 1];
      if (nxt && ep.prompts[nxt.id]) ep.prompts[nxt.id].stale = true; // its predecessor changed
      if (structured) F.syncBeats(ep);
    }, { snapshot: true, by, note: '씬 추가' });
    store.episodes.audit(id, 'scene.added', { sceneId: newId, by });
    const v = episodeView(id);
    v.newSceneId = newId;
    return v;
  }

  /** Removes one scene and its dialogue. Clips, images, prompts and the approval history stay on disk (nothing is deleted). The fixed ending and the last scene of a story beat cannot be removed. */
  async function deleteScene(id, sceneId, by = 'operator') {
    await store.episodes.update(id, (ep) => {
      const sc = ep.scenes.find((x) => x.id === sceneId);
      if (!sc) throw new StudioError('NOT_FOUND', '장면을 찾을 수 없습니다: ' + sceneId, { status: 404 });
      if (F.isStructured(ep)) {
        if (sc.part === 'B') throw new StudioError('ENDING_LOCKED', '고정 제품 엔딩 컷은 삭제할 수 없습니다.', { status: 409 });
        if (ep.scenes.filter((x) => x.part === 'A' && x.beatKey === sc.beatKey).length <= 1) throw new StudioError('BEAT_EMPTY', '각 스토리 단계에는 최소 한 씬이 필요합니다. 이 씬이 이 단계의 마지막 씬입니다.', { status: 422 });
      } else if (ep.scenes.length <= 1) throw new StudioError('LAST_SCENE', '마지막 씬은 삭제할 수 없습니다.', { status: 422 });
      const i = ep.scenes.indexOf(sc);
      ep.scenes.splice(i, 1);
      ep.lines = ep.lines.filter((l) => l.sceneId !== sceneId);
      const nxt = ep.scenes[i];
      if (nxt && ep.prompts[nxt.id]) ep.prompts[nxt.id].stale = true;
      if (F.isStructured(ep)) F.syncBeats(ep);
    }, { snapshot: true, by, note: `씬 삭제 (${sceneId})` });
    store.episodes.audit(id, 'scene.deleted', { sceneId, by });
    return episodeView(id);
  }

  /**
   * Drag & drop reorder. Formula episodes: { beats: { setup: [ids], problem: [ids], ... } } moves Part A scenes within / between the six beats
   * (every beat keeps at least one scene; Part B, the fixed ending, can never be moved). Other episodes: { order: [ids] }.
   * Only the order / beat assignment changes; a scene whose predecessor changed gets its (template/AI) prompt flagged stale.
   */
  async function reorderScenes(id, { beats, order } = {}, by = 'operator') {
    await store.episodes.update(id, (ep) => {
      const before = ep.scenes.map((x) => x.id);
      if (F.isStructured(ep)) {
        if (!beats || typeof beats !== 'object') throw new StudioError('BAD_ORDER', '단계별 장면 순서가 필요합니다.', { status: 422 });
        const a = ep.scenes.filter((x) => x.part !== 'B');
        const b = ep.scenes.filter((x) => x.part === 'B');
        const given = [].concat(...F.BEAT_KEYS.map((k) => (Array.isArray(beats[k]) ? beats[k].map(String) : [])));
        if (given.length !== a.length || new Set(given).size !== a.length || a.some((x) => !given.includes(x.id))) throw new StudioError('BAD_ORDER', '장면 목록이 현재와 맞지 않습니다. 화면을 새로고침하세요.', { status: 409 });
        const empty = F.BEAT_KEYS.filter((k) => !(beats[k] || []).length);
        if (empty.length) throw new StudioError('BEAT_EMPTY', `각 단계에는 최소 한 장면이 필요합니다 (비는 단계: ${empty.map((k) => (F.beatMeta(k) || {}).ko).join(', ')}).`, { status: 422 });
        const next = [];
        F.BEAT_KEYS.forEach((k) => beats[k].forEach((sid) => {
          const sc = a.find((x) => x.id === sid);
          sc.part = 'A'; sc.beatKey = k; sc.beat = F.ALL_KEYS.indexOf(k) + 1;
          next.push(sc);
        }));
        ep.scenes = next.concat(b);
        F.syncBeats(ep);
      } else {
        if (!Array.isArray(order) || order.length !== ep.scenes.length || new Set(order).size !== order.length || ep.scenes.some((x) => !order.includes(x.id))) throw new StudioError('BAD_ORDER', '장면 목록이 현재와 맞지 않습니다. 화면을 새로고침하세요.', { status: 409 });
        ep.scenes = order.map((sid) => ep.scenes.find((x) => x.id === sid));
        ep.scenes.forEach((x, i) => { x.beat = i + 1; });
      }
      const after = ep.scenes.map((x) => x.id);
      if (JSON.stringify(before) === JSON.stringify(after) && !F.isStructured(ep)) return;
      // the continuity line of a prompt names the previous scene: flag prompts whose predecessor changed
      after.forEach((sid, i) => { if (before[before.indexOf(sid) - 1] !== after[i - 1] && ep.prompts[sid]) ep.prompts[sid].stale = true; });
    }, { snapshot: true, by, note: '장면 순서 변경' });
    store.episodes.audit(id, 'scenes.reordered', { by });
    return episodeView(id);
  }

  /** Edits ONLY the Korean title of one scene. Titles are not part of the script/storyboard fingerprints, so approvals stay valid. */
  async function setSceneTitle(id, sceneId, title) {
    const t = String(title == null ? '' : title).trim();
    const chk = checkTitleKo(t);
    if (chk.errors.length) throw new StudioError('SCENE_TITLE', chk.errors[0], { details: chk.errors, recovery: '장면의 핵심 행동이나 웃음 포인트를 3~12자 한국어로 적어 주세요. (예: 영국인의 자신감)', status: 422 });
    await store.episodes.update(id, (ep) => {
      const sc = ep.scenes.find((x) => x.id === sceneId);
      if (!sc) throw new StudioError('NOT_FOUND', '장면을 찾을 수 없습니다.', { status: 404 });
      sc.title_ko = t;
      sc.title = t;
    });
    store.episodes.audit(id, 'scene.title', { sceneId, title: t });
    return episodeView(id);
  }

  /**
   * Reuse approved ending start frames from another episode (same series template slots). A frame that shows the product is only
   * reused when it is the SAME product; frames are copied (the source episode is never changed) and keep their approval record.
   */
  async function reuseEndingAssets(id, fromId, by = 'operator') {
    const ep = store.episodes.get(id);
    const src = store.episodes.get(fromId);
    if (!F.isStructured(ep) || !F.isStructured(src)) throw new StudioError('NOT_FORMULA', '두 에피소드 모두 고정 에피소드 포맷이어야 합니다.', { status: 409 });
    if (id === fromId) throw new StudioError('SAME_EPISODE', '같은 에피소드입니다.', { status: 400 });
    const copied = [];
    const skipped = [];
    for (const key of F.ENDING_KEYS) {
      const from = src.scenes.find((x) => x.part === 'B' && x.beatKey === key);
      const to = ep.scenes.find((x) => x.part === 'B' && x.beatKey === key);
      const si = from && from.startImage;
      if (!from || !to || !si || si.type !== 'upload' || !si.approved) { skipped.push({ key, reason: '승인된 시작 프레임이 없습니다.' }); continue; }
      if (to.showsProduct && src.productId !== ep.productId) { skipped.push({ key, reason: '다른 제품이 보이는 컷이라 재사용하지 않습니다.' }); continue; }
      const file = store.episodes.file(fromId, 'startframes', si.file);
      if (!fs.existsSync(file)) { skipped.push({ key, reason: '원본 파일이 없습니다.' }); continue; }
      store.episodes.saveFile(id, path.join('startframes', si.file), fs.readFileSync(file));
      await store.episodes.update(id, (e) => { const t = e.scenes.find((x) => x.id === to.id); t.startImage = { type: 'upload', file: si.file, sha256: si.sha256, approved: true, approvedBy: by, name: si.name || '재사용 프레임', reusedFrom: { episodeId: fromId, sceneId: from.id } }; });
      copied.push(key);
    }
    store.episodes.audit(id, 'ending.assets_reused', { from: fromId, copied, skipped });
    return { copied, skipped, view: episodeView(id) };
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
    if (kind === 'broll') {
      const bi = (ep.broll || []).find((x) => x.id === b && x.imageRef && x.imageRef.type === 'upload');
      if (!bi) throw new StudioError('NOT_FOUND', 'B-roll 이미지가 없습니다.', { status: 404 });
      return store.episodes.file(a, path.join('broll', bi.imageRef.file));
    }
    if (kind === 'startframe') {
      const s = ep.scenes.find((x) => x.id === b);
      if (!s || !s.startImage || s.startImage.type !== 'upload') throw new StudioError('NOT_FOUND', '시작 프레임이 없습니다.', { status: 404 });
      return store.episodes.file(a, 'startframes', s.startImage.file);
    }
    throw new StudioError('NOT_FOUND', '알 수 없는 미디어입니다.', { status: 404 });
  }

  /** Export filename: the Episode ID first, so files from different episodes never collide in a download folder. */
  const exportName = (id, file) => `${(store.episodes.get(id).displayId || id)}_${require('node:path').basename(file)}`;

  return {
    exportName, cfg, store, video, gen, startImages, presets, endings, voice, renderer, publishing, vault: keys, runtime, usage, prompts, router, products, storylab, scriptgen, integrations, createEpisodeFromConcept, migrateLegacy, projects, translator, cutPresets, saveInserts, cutFrame,
    summary, episodeView, episodeIds, sba, setEpisodeCategory, holdEpisode, resumeEpisode, assertNotHeld, editEpisode, providerStatus, createEpisode, saveScript, approveScript, revokeScript, restoreVersion, addSuggestion,
    rebuildPrompts, savePrompt, setSceneTitle, reorderScenes, saveScene, addScene, deleteScene, trashEpisode, restoreEpisode, trashList, archiveEpisode, unarchiveEpisode, episodeImpact, scriptVersions, deleteScriptVersion, undeleteScriptVersion, reuseEndingAssets, setStartImage, uploadStartFrame, approveStartFrame, approveStoryboard, setSpendLimit,
    updateCharacter, characterView, promptStatus: promptSvc.status, saveSettings, loadDemoReferences, uploadSfx, updateSfx, mediaFile,
  };
}

module.exports = { createStudio };

