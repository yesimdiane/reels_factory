// Script generation from an APPROVED story concept (Script Studio entry point).
//   * refuses unless the concept is approved at its current revision
//   * writes the draft into an episode (scene-by-scene dialogue, narration, actions, timing, visual direction, product placement, CTA)
//   * records ep.concept (traceability) and ep.scriptSource (provider/model/prompt versions); every generation is a numbered version
//   * never overwrites an existing script without overwrite:true; never approves anything itself
'use strict';
const { StudioError, nowIso } = require('./util');
const { validateScript } = require('./episode');

function createScriptGen({ store, products, storylab, prompts, router, lib }) {
  function episodeIdFor(pid) {
    const used = store.episodes.list().map((e) => e.id).filter((i) => i.startsWith(pid + '-R')).map((i) => Number(i.slice(pid.length + 2))).filter(Number.isFinite);
    return `${pid}-R${String((used.length ? Math.max(...used) : 1) + 1).padStart(2, '0')}`;
  }

  /** Creates an (empty) episode bound to an approved concept. Product facts are copied from the verified product record. */
  async function createEpisodeFromConcept(pid, cid, { id } = {}) {
    const concept = storylab.requireApproved(pid, cid);
    const b = products.bindingFor(pid);
    const p = b.product;
    const epId = id || episodeIdFor(pid);
    const seed = {
      id: epId, reelId: epId, productId: pid, title: concept.title, titleEn: '', series: 'Jack & Diane',
      product: { id: pid, name: p.name, kind: p.category || '', verifiedFeatures: b.facts, forbiddenClaims: p.forbiddenClaims || [], affiliateUrl: p.affiliateUrl || '', visualSummary: p.description || '', sourceNote: '운영자가 확인한 사실만 사용합니다 (Products 화면).' },
      characters: ['jack', 'diane'], beats: [],
      scenes: [{ id: 'S1', title: '첫 장면', beat: 1, durationSec: 5, characters: ['jack'], showsProduct: false, visual: '' }], lines: [], suggestions: [],
      cta: { lines: [], durationSec: 3.5, keyword: '' },
      publishing: { keyword: '', affiliateUrl: p.affiliateUrl || '', disclosure: '[광고] 이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.' },
      concept: { productId: pid, conceptId: cid, revision: concept.revision, title: concept.title, approvedAt: concept.approval.at },
      scriptSource: null,
    };
    store.episodes.create(seed);
    return epId;
  }

  function buildPrompt(ep, concept, extra) {
    const L = lib();
    const composed = prompts.compose('script', { EXTRA: extra || '', COUNT: 1 });
    const chars = L.characters.map((c) => `- ${c.id}: ${c.name} — ${c.promptBlock}${c.forbiddenWords && c.forbiddenWords.length ? ' (never says: ' + c.forbiddenWords.join(', ') + ')' : ''}`);
    const data = [
      '--- INPUT DATA (authoritative) ---',
      'CONCEPT_ID: ' + concept.id + ' (revision ' + concept.revision + ')',
      'CONCEPT_TITLE: ' + concept.title,
      ...['hook', 'situation', 'productRole', 'characterUsage', 'payoff', 'viewerAppeal', 'ctaDirection'].map((k) => `CONCEPT_${k.toUpperCase()}: ${concept[k]}`),
      'ESTIMATED_DURATION_SEC: ' + concept.estimatedDurationSec,
      'PRODUCT_NAME: ' + ep.product.name,
      'VERIFIED_PRODUCT_FACTS (use ONLY these):',
      ...ep.product.verifiedFeatures.map((f) => '- ' + f),
      'FORBIDDEN_CLAIMS: ' + (ep.product.forbiddenClaims.join(', ') || 'none'),
      'CHARACTERS (speaker/characters ids must be one of these):',
      ...chars,
    ].join('\n');
    return { composed, prompt: composed.text + '\n\n' + data };
  }

  function normalize(raw) {
    if (!raw || typeof raw !== 'object') throw new StudioError('SCRIPT_REJECTED', 'AI가 대본 JSON을 반환하지 않았습니다.', { status: 422 });
    const L = lib();
    const ids = new Set(L.characters.map((c) => c.id));
    const scenes = (Array.isArray(raw.scenes) ? raw.scenes : []).map((s, i) => ({
      id: String(s.id || 'S' + (i + 1)), title: String(s.title || ''), beat: Number(s.beat) || i + 1, durationSec: Number(s.durationSec) || 4,
      characters: (Array.isArray(s.characters) ? s.characters : []).map(String).filter((c) => ids.has(c)), showsProduct: !!s.showsProduct,
      visual: String(s.visual || ''), action: String(s.action || ''), narration: String(s.narration || ''), placement: String(s.placement || ''),
    }));
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
    if (!ep0.concept || !ep0.concept.conceptId) throw new StudioError('NO_CONCEPT', '이 에피소드는 스토리 컨셉과 연결되어 있지 않아 AI 대본을 만들 수 없습니다.', { recovery: 'Story Lab에서 컨셉을 승인한 뒤 그 컨셉으로 에피소드를 만드세요.', status: 409 });
    const concept = storylab.requireApproved(ep0.concept.productId, ep0.concept.conceptId);
    if ((ep0.lines || []).length && !overwrite) throw new StudioError('SCRIPT_EXISTS', '이미 대본이 있습니다. 덮어쓰려면 확인하세요 (이전 버전은 버전 기록에 남습니다).', { recovery: '"덮어쓰기"를 선택하면 현재 대본이 버전 기록에 보관된 뒤 새 대본이 만들어집니다.', status: 409 });
    const { composed, prompt } = buildPrompt(ep0, concept, extra);
    const ov = override || composed.providerOverride || undefined;
    const res = await router.run('scriptWriting', { prompt, json: true, maxTokens: 6000, confirm, override: ov, dedupeKey: epId });
    const s = normalize(res.json);
    const source = { conceptId: concept.id, conceptRevision: concept.revision, productId: concept.productId, provider: res.provider, model: res.model, mock: !!res.mock, promptKey: 'script', promptVersion: composed.versions.script, promptVersions: composed.versions, generatedAt: nowIso(), by };
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

  return { createEpisodeFromConcept, generate, conceptStatus, buildPrompt, episodeIdFor };
}

module.exports = { createScriptGen };
