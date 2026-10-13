// Story Lab: multiple distinct story concepts per product, human approval gate, full traceability.
//   concept lifecycle: candidate → approved | rejected (saved) ; superseded when regenerated ; editing an approved concept
//   bumps its revision and requires re-approval (an approval is bound to a revision, never silently carried over).
//   The approval record stores: product ID, concept ID + revision, provider/model, prompt versions, reference image IDs, status, timestamp.
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { StudioError, nowIso, readJson, writeJsonAtomic, sha256 } = require('./util');
const { claimHits } = require('./claims');
const cats = require('./storycategories');

const FIELDS = ['title', 'hook', 'situation', 'plot', 'productRole', 'characterUsage', 'visualComedy', 'payoff', 'viewerAppeal', 'ctaDirection'];
// Added in the Product Studio update: stored concepts from before it may lack these, so they are required for NEW concepts only.
const NEW_FIELDS = ['plot', 'visualComedy'];
const FIELD_LABEL = { title: '제목', hook: '오프닝 훅 (첫 3초)', situation: '제품 문제 / 사용 상황', plot: '30~45초 줄거리', productRole: '자연스러운 제품 등장', characterUsage: 'Jack·Diane 상호작용', visualComedy: '비주얼 코미디 포인트', payoff: '결말/페이오프', viewerAppeal: '시청자 공감 포인트', ctaDirection: '마지막 CTA' };
const MAX_REFS_TO_AI = 4;

const tokens = (s) => new Set(String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1));
function similarity(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((w) => B.has(w) && inter++);
  return inter / (A.size + B.size - inter);
}

// Appended by CODE to every concept request so these rules never depend on which prompt version is stored.
const STORY_RULES = [
  '--- STORY RULES (mandatory, in addition to the instructions above) ---',
  'Every concept MUST include these JSON fields: title, hook (what happens in the FIRST 3 SECONDS), situation (the product problem and use case),',
  'plot (the 30-45 second plot, beat by beat), productRole (the natural product reveal), characterUsage (Jack and Diane interactions),',
  'visualComedy (visual comedy opportunities), payoff, viewerAppeal, ctaDirection (the final CTA), estimatedDurationSec (30-45), estimatedScenes (integer 4-12).',
  'CHARACTERS: Diane = Korean wife, long black hair, energetic, impulsive shopper. When excited she shouts "BABYYYY!!!!!!" (do not force it into every concept).',
  'Jack = British husband, muscular/stocky, brown wavy hair, thick mustache, tattooed arms, affectionate dry humour.',
  'Diane NEVER calls Jack "오빠". Spoken dialogue is in ENGLISH; on-screen subtitles are in KOREAN. Keep the approved 2D character look.',
  'Concepts must be meaningfully different (different situation and payoff). Use ONLY the verified product facts; never invent specs, prices or availability.',
  'CATEGORY: every concept MUST include "category" = exactly one of drama | viral | info, matching CATEGORY_PLAN below. Produce exactly the concepts listed in CATEGORY_PLAN, no more and no fewer.',
  'LANGUAGE: write every concept field in natural ENGLISH, and in the SAME response also give a natural, idiomatic KOREAN translation of each text field as <field>_ko',
  '(title_ko, hook_ko, situation_ko, plot_ko, productRole_ko, characterUsage_ko, visualComedy_ko, payoff_ko, viewerAppeal_ko, ctaDirection_ko). Not word-for-word: it must read as natural Korean.',
].join('\n');

function createStoryLab({ store, products, prompts, router, log = () => {} }) {
  const file = (pid) => store.path('storylab', pid + '.json');
  const read = (pid) => readJson(file(pid), { productId: pid, batches: [], concepts: [], seq: 0 });
  const write = (pid, d) => writeJsonAtomic(file(pid), d);
  let queue = Promise.resolve();
  const serial = (fn) => { const run = queue.then(fn); queue = run.catch(() => {}); return run; };

  const isApproved = (c) => !!(c && c.status === 'approved' && c.approval && c.approval.revision === c.revision);
  function view(c) {
    return Object.assign({}, c, { approved: isApproved(c), needsReapproval: !!(c.status === 'approved' && c.approval && c.approval.revision !== c.revision), sample: !!(c.source && c.source.mock) });
  }
  const find = (d, cid) => {
    const c = d.concepts.find((x) => x.id === cid);
    if (!c) throw new StudioError('NOT_FOUND', '스토리 컨셉을 찾을 수 없습니다: ' + cid, { status: 404 });
    return c;
  };

  function list(pid) {
    const d = read(pid);
    return { productId: pid, concepts: d.concepts.map(view), batches: d.batches, fields: FIELD_LABEL, categories: cats.options() };
  }

  function clean(raw, product, { strictNew = true } = {}) {
    const out = {};
    const problems = [];
    FIELDS.forEach((k) => {
      const v = String((raw && raw[k]) || '').trim();
      if (!v && (strictNew || !NEW_FIELDS.includes(k))) problems.push(`${FIELD_LABEL[k]} 누락`);
      out[k] = v.slice(0, 1200);
    });
    const scenes = Number(raw && raw.estimatedScenes);
    if (scenes >= 3 && scenes <= 20) out.estimatedScenes = Math.round(scenes);
    else if (strictNew) problems.push('예상 장면 수(3~20) 오류');
    const dur = Number(raw && raw.estimatedDurationSec);
    if (!(dur >= 10 && dur <= 90)) problems.push('예상 길이(10~90초) 오류');
    out.estimatedDurationSec = Math.round(dur);
    const text = FIELDS.map((k) => out[k]).join(' ');
    claimHits(text, product.forbiddenClaims || []).forEach((h) => problems.push(`확인되지 않은 제품 주장 "${h.claim}"`));
    if (/오빠/.test(text)) problems.push('Diane이 Jack을 "오빠"라고 부르는 표현');
    return { out, problems };
  }

  /** Builds the generation request: verified facts only, approved reference images, character references. */
  function build(pid, { count, extra, plan }) {
    plan = plan || Array(count).fill('drama');
    const b = products.bindingFor(pid);
    const p = b.product;
    const vars = { COUNT: count, EXTRA: extra || '' };
    const composed = prompts.compose('storyConcept', vars);
    const data = [
      '--- INPUT DATA (authoritative) ---',
      'PRODUCT_NAME: ' + p.name,
      'PRODUCT_CATEGORY: ' + (p.category || 'unknown'),
      'VERIFIED_PRODUCT_FACTS (use ONLY these):',
      ...b.facts.map((f) => '- ' + f),
      'FORBIDDEN_CLAIMS (never imply): ' + ((p.forbiddenClaims || []).join(', ') || 'none'),
      'COUNT: ' + count,
      'CATEGORY_PLAN: ' + plan.join(', '),
      ...[...new Set(plan)].map((k) => cats.CATEGORIES[k].rule),
      'The attached product images are the APPROVED reference photos. Do not change the product\'s shape, logo or colour.',
      '',
      STORY_RULES,
    ].join('\n');
    const refs = b.reference.imageIds || [];
    const imgFiles = products.imageFiles(pid, refs).slice(0, MAX_REFS_TO_AI);
    const images = imgFiles.map((f) => ({ label: `Approved product reference (${f.kind}):`, mimeType: f.mimeType, data: fs.readFileSync(f.path).toString('base64') }));
    // Character identity refs (approved sheets) — identity only. One per character, only if the text provider takes images.
    const L = store.characters.load();
    const charRefs = [];
    L.characters.forEach((c) => {
      const r = c.references.find((x) => x.approved);
      if (r) { charRefs.push({ characterId: c.id, refId: r.id }); images.push({ label: `Character reference sheet for ${c.name} (ONE person, identity only, never a scene layout):`, mimeType: path.extname(r.file) === '.png' ? 'image/png' : path.extname(r.file) === '.webp' ? 'image/webp' : 'image/jpeg', data: fs.readFileSync(store.characters.refPath(c.id, r)).toString('base64') }); }
    });
    return { product: p, binding: b, prompt: composed.text + '\n\n' + data, composed, images, refs, charRefs };
  }

  /** What a request will generate (validated). Same rules as generate(): the UI summary, the estimate and the real call cannot disagree. */
  function plan(req) {
    const r = cats.resolveRequest(req);
    return Object.assign(r, { summary: cats.planText(r.plan) });
  }
  function estimate(pid, { category, count, extra = '', override } = {}) {
    const r = cats.resolveRequest({ category, count });
    const q = build(pid, { count: r.count, extra, plan: r.plan });
    return Object.assign({}, router.estimate('storyConcepts', { inputChars: q.prompt.length, outputTokens: 1500 * r.count, images: q.images.length, override: override || q.composed.providerOverride }), { category: r.category, count: r.count, plan: r.plan, summary: cats.planText(r.plan) });
  }

  const KO_FIELDS = FIELDS;
  function validateBatch(raw, q, plan) {
    const list = Array.isArray(raw && raw.concepts) ? raw.concepts : [];
    const items = [];
    const problems = [];
    const single = new Set(plan).size === 1;
    list.forEach((r, i) => {
      const { out, problems: pr } = clean(r, q.product);
      pr.forEach((m) => problems.push(`컨셉 ${i + 1}: ${m}`));
      let cat = r && r.category != null ? String(r.category).trim().toLowerCase() : '';
      if (!cat && single) cat = plan[0]; // one category requested: the request itself decides it
      if (!cat) problems.push(`컨셉 ${i + 1}: 카테고리 누락`);
      else if (!cats.CATEGORIES[cat]) problems.push(`컨셉 ${i + 1}: 알 수 없는 카테고리 "${cat}"`);
      out.category = cat;
      const ko = {};
      KO_FIELDS.forEach((k) => { const v = String((r && r[k + '_ko']) || '').trim(); if (v) ko[k] = v.slice(0, 1200); });
      out.ko = ko;
      out.koComplete = KO_FIELDS.every((k) => ko[k]);
      items.push(out);
    });
    if (items.length !== plan.length) problems.push(`컨셉이 ${items.length}개입니다 (정확히 ${plan.length}개 필요).`);
    const want = cats.tally(plan);
    const got = cats.tally(items.map((x) => x.category).filter(Boolean));
    if (JSON.stringify(Object.keys(want).sort().map((k) => [k, want[k]])) !== JSON.stringify(Object.keys(got).sort().map((k) => [k, got[k]]))) {
      problems.push(`카테고리 구성이 요청과 다릅니다 (요청: ${cats.planText(plan)} / 응답: ${cats.planText(items.map((x) => x.category).filter(Boolean)) || '없음'}).`);
    }
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const s = similarity(items[i].situation + ' ' + items[i].payoff, items[j].situation + ' ' + items[j].payoff);
        if (s > 0.6 || items[i].title === items[j].title) problems.push(`컨셉 ${i + 1}과 ${j + 1}이 너무 비슷합니다(서로 다른 상황·갈등·결말이어야 합니다).`);
      }
    }
    return { items, problems };
  }

  /** Generates the requested concepts (category required; 1–5 for one category, exactly 3 for "all"). Nothing is saved when validation fails (the call may still have been billed — it is in the usage log). */
  async function generate(pid, { category, count, extra = '', confirm, override, by = 'operator' } = {}) {
    const r = cats.resolveRequest({ category, count });
    const q = build(pid, { count: r.count, extra, plan: r.plan });
    const ov = override || q.composed.providerOverride || undefined;
    const res = await router.run('storyConcepts', { system: undefined, prompt: q.prompt, images: q.images, json: true, maxTokens: 1500 * r.count, confirm, override: ov, dedupeKey: pid });
    const { items, problems } = validateBatch(res.json, q, r.plan);
    if (problems.length) throw new StudioError('CONCEPTS_REJECTED', problems[0], { details: problems, recovery: 'AI 응답이 규칙(요청한 개수·카테고리 구성·서로 다른 내용·제품 주장)을 어겨 저장하지 않았습니다. 다시 생성하거나 프롬프트를 조정하세요.', status: 422 });
    return serial(() => {
      const d = read(pid);
      const batchId = 'B' + String(d.batches.length + 1).padStart(2, '0');
      const source = { provider: res.provider, model: res.model, mock: !!res.mock, promptVersions: q.composed.versions, promptKey: 'storyConcept', promptVersion: q.composed.versions.storyConcept, referenceSetId: q.binding.reference.waived ? 'waived' : (q.product.referenceSet || {}).id, referenceImageIds: q.refs, characterRefs: q.charRefs, generatedAt: nowIso(), by };
      d.batches.push({ id: batchId, at: nowIso(), count: items.length, category: r.category, plan: r.plan, source, extra: extra || '', estimate: res.estimate });
      items.forEach((it) => {
        d.seq += 1;
        d.concepts.push(Object.assign({ id: `${pid}-C${String(d.seq).padStart(3, '0')}`, productId: pid, batchId, status: 'candidate', revision: 1, edits: [], approval: null, rejection: null, createdAt: nowIso(), source }, it));
      });
      write(pid, d);
      return list(pid);
    });
  }

  /** Regenerate ONE concept: the old one is kept as "superseded" (never deleted); approved concepts cannot be regenerated. */
  async function regenerate(pid, cid, { feedback = '', confirm, override } = {}) {
    const d0 = read(pid);
    const old = find(d0, cid);
    if (old.status === 'approved') throw new StudioError('APPROVED_LOCKED', '승인된 컨셉은 다시 생성할 수 없습니다. 먼저 승인을 취소하세요.', { status: 409 });
    const extra = `Replace the concept titled "${old.title}" with ONE new, meaningfully different concept (different situation and payoff). ${feedback ? 'Operator feedback: ' + feedback : ''}`;
    const cat = old.category || 'drama'; // concepts from before categories existed are regenerated as Drama
    const q = build(pid, { count: 1, extra, plan: [cat] });
    const ov = override || q.composed.providerOverride || undefined;
    const res = await router.run('storyConcepts', { prompt: q.prompt, images: q.images, json: true, maxTokens: 1800, confirm, override: ov, dedupeKey: pid + cid });
    const raw = Array.isArray(res.json && res.json.concepts) ? res.json.concepts[0] : null;
    const v = validateBatch({ concepts: raw ? [raw] : [] }, q, [cat]);
    const out = v.items[0];
    if (!raw || v.problems.length) throw new StudioError('CONCEPTS_REJECTED', v.problems[0] || '컨셉이 비어 있습니다.', { details: v.problems, status: 422 });
    return serial(() => {
      const d = read(pid);
      const o = find(d, cid);
      if (similarity(o.situation + ' ' + o.payoff, out.situation + ' ' + out.payoff) > 0.6) throw new StudioError('TOO_SIMILAR', '새 컨셉이 기존 컨셉과 너무 비슷합니다. 피드백을 추가해 다시 시도하세요.', { status: 422 });
      o.status = 'superseded';
      d.seq += 1;
      const source = { provider: res.provider, model: res.model, mock: !!res.mock, promptVersions: q.composed.versions, promptKey: 'storyConcept', promptVersion: q.composed.versions.storyConcept, referenceSetId: (q.product.referenceSet || {}).id, referenceImageIds: q.refs, characterRefs: q.charRefs, generatedAt: nowIso() };
      d.concepts.push(Object.assign({ id: `${pid}-C${String(d.seq).padStart(3, '0')}`, productId: pid, batchId: o.batchId, status: 'candidate', revision: 1, edits: [], approval: null, rejection: null, createdAt: nowIso(), source, replaces: cid }, out));
      write(pid, d);
      return list(pid);
    });
  }

  function edit(pid, cid, patch, by = 'operator') {
    return serial(() => {
      const d = read(pid);
      const c = find(d, cid);
      if (['superseded', 'rejected'].includes(c.status)) throw new StudioError('LOCKED', '이 컨셉은 수정할 수 없습니다(되살린 뒤 수정하세요).', { status: 409 });
      const p = products.raw(pid);
      const next = Object.assign({}, Object.fromEntries(FIELDS.map((k) => [k, c[k] || ''])), { estimatedDurationSec: c.estimatedDurationSec, estimatedScenes: c.estimatedScenes });
      const before = JSON.stringify(next);
      FIELDS.forEach((k) => patch[k] !== undefined && (next[k] = String(patch[k]).trim().slice(0, 1200)));
      if (patch.estimatedDurationSec !== undefined) next.estimatedDurationSec = Math.round(Number(patch.estimatedDurationSec));
      if (patch.estimatedScenes !== undefined) next.estimatedScenes = Number(patch.estimatedScenes);
      const legacy = !c.plot; // concepts made before the Product Studio update keep working without the new fields
      const { out, problems } = clean(next, p, { strictNew: !legacy || NEW_FIELDS.some((k) => String(patch[k] || '').trim()) });
      if (problems.length) throw new StudioError('INVALID_CONCEPT', problems[0], { details: problems, status: 422 });
      if (JSON.stringify(out) === before) return list(pid);
      c.edits.push({ at: nowIso(), by, revisionBefore: c.revision, before: JSON.parse(before) });
      const changed = FIELDS.filter((k) => (c[k] || '') !== (out[k] || ''));
      Object.assign(c, out);
      if (c.ko && changed.length) c.koStale = [...new Set((c.koStale || []).concat(changed.filter((k) => c.ko[k])))]; // the Korean translation no longer matches the edited English
      c.revision += 1;
      c.edited = true;
      write(pid, d);
      return list(pid);
    });
  }

  function approve(pid, cid, by = 'operator') {
    return serial(() => {
      const binding = products.bindingFor(pid); // product must still be ready (verified facts + approved reference set)
      const d = read(pid);
      const c = find(d, cid);
      if (['superseded', 'rejected'].includes(c.status)) throw new StudioError('LOCKED', '이 컨셉은 승인할 수 없습니다(되살린 뒤 승인하세요).', { status: 409 });
      const s = c.source || {};
      c.status = 'approved';
      c.approval = { productId: pid, conceptId: c.id, revision: c.revision, provider: s.provider, model: s.model, mock: !!s.mock, storyPromptVersion: s.promptVersion, promptVersions: s.promptVersions, referenceSetId: binding.reference.waived ? 'waived' : (binding.product.referenceSet || {}).id, referenceImageIds: s.referenceImageIds || [], status: 'approved', by, at: nowIso() };
      write(pid, d);
      return list(pid);
    });
  }
  function revoke(pid, cid, by = 'operator') {
    return serial(() => {
      const d = read(pid);
      const c = find(d, cid);
      if (c.status !== 'approved') throw new StudioError('NOT_APPROVED', '승인된 컨셉이 아닙니다.', { status: 409 });
      c.status = 'candidate';
      c.approvalHistory = (c.approvalHistory || []).concat([Object.assign({}, c.approval, { revokedAt: nowIso(), revokedBy: by })]);
      c.approval = null;
      write(pid, d);
      return list(pid);
    });
  }
  function reject(pid, cid, reason = '', by = 'operator') {
    return serial(() => {
      const d = read(pid);
      const c = find(d, cid);
      if (c.status === 'approved') throw new StudioError('APPROVED_LOCKED', '승인된 컨셉은 거절할 수 없습니다. 먼저 승인을 취소하세요.', { status: 409 });
      c.status = 'rejected';
      c.rejection = { reason: String(reason).slice(0, 300), by, at: nowIso() };
      write(pid, d);
      return list(pid);
    });
  }
  function reopen(pid, cid) {
    return serial(() => {
      const d = read(pid);
      const c = find(d, cid);
      if (c.status !== 'rejected') throw new StudioError('NOT_REJECTED', '거절된 컨셉만 되살릴 수 있습니다.', { status: 409 });
      c.status = 'candidate';
      write(pid, d);
      return list(pid);
    });
  }

  /** For gating: returns the concept only when it is approved at its current revision. */
  function requireApproved(pid, cid) {
    const c = read(pid).concepts.find((x) => x.id === cid);
    if (!c) throw new StudioError('CONCEPT_NOT_FOUND', '스토리 컨셉을 찾을 수 없습니다.', { status: 404 });
    if (!isApproved(c)) throw new StudioError('CONCEPT_NOT_APPROVED', c.status === 'approved' ? '승인 후 수정된 컨셉입니다. 다시 승인해야 대본을 만들 수 있습니다.' : '승인된 스토리 컨셉이 있어야 대본을 만들 수 있습니다.', { recovery: 'Story Lab에서 컨셉을 승인하세요.', status: 409 });
    return c;
  }
  const peek = (pid, cid) => { const c = read(pid).concepts.find((x) => x.id === cid); return c ? view(c) : null; };

  return { list, generate, regenerate, edit, approve, revoke, reject, reopen, estimate, plan, requireApproved, peek, isApproved, FIELDS, FIELD_LABEL, similarity };
}

module.exports = { createStoryLab, FIELDS, NEW_FIELDS, STORY_RULES, similarity };
