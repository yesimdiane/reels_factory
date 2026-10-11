// Product workspace: product info, compliant extraction, reference images (retrieved / uploaded / AI-generated),
// image approval and the approved reference set that Story Lab is bound to.
//   Provenance is always visible: AI-generated images are never presented as manufacturer photos.
//   Extracted specs are "unverified" until the operator confirms them; nothing is invented.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { StudioError, nowIso, sha256, safeName, canonical, readJson, writeJsonAtomic, writeFileAtomic } = require('./util');
const { extractProduct, downloadImage, sniffImage } = require('./extract');

const MAX_UPLOADS = 5;
const MAX_RETRIEVED = 8;
const MAX_GENERATED = 5;
const MAX_SET = 8;
const KIND_LABEL = { retrieved: '원본 (쇼핑몰에서 수집)', uploaded: '직접 업로드', ai_generated: 'AI 생성 (제조사 사진 아님)' };
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const PID_RE = /^PRD-[A-Za-z0-9-]{1,30}$/;

function createProductService({ store, router, extractFn = extractProduct, downloadFn = downloadImage, log = () => {} }) {
  const root = () => store.path('products');
  const dirOf = (id) => {
    if (!PID_RE.test(String(id))) throw new StudioError('BAD_ID', '상품 ID 형식이 올바르지 않습니다: ' + id, { status: 400 });
    return path.join(root(), id);
  };
  const fileOf = (id) => path.join(dirOf(id), 'product.json');
  const queues = new Map();

  function get(id) {
    const p = readJson(fileOf(id));
    if (!p) throw new StudioError('NOT_FOUND', '상품을 찾을 수 없습니다: ' + id, { status: 404 });
    return p;
  }
  function update(id, fn) {
    const prev = queues.get(id) || Promise.resolve();
    const run = prev.then(() => {
      const p = get(id);
      const out = fn(p);
      p.updatedAt = nowIso();
      writeJsonAtomic(fileOf(id), p);
      return out === undefined ? p : out;
    });
    queues.set(id, run.catch(() => {}));
    return run;
  }
  function ids() {
    if (!fs.existsSync(root())) return [];
    return fs.readdirSync(root()).filter((d) => PID_RE.test(d) && fs.existsSync(path.join(root(), d, 'product.json'))).sort();
  }
  const nextId = () => {
    const n = ids().map((i) => /^PRD-(\d+)$/.exec(i)).filter(Boolean).map((m) => Number(m[1]));
    return 'PRD-' + String((n.length ? Math.max(...n) : 0) + 1).padStart(3, '0');
  };

  const setHash = (p, imageIds) => sha256(canonical(imageIds.slice().sort().map((i) => { const im = p.images.find((x) => x.id === i); return im ? [im.id, im.sha256] : [i, null]; })));
  function referenceState(p) {
    const s = p.referenceSet;
    if (!s) return { state: 'none', approved: false };
    if (s.waived) return { state: 'waived', approved: true, waived: s.waived, by: s.by, at: s.at };
    const ok = s.imageIds.every((i) => { const im = p.images.find((x) => x.id === i); return im && im.status === 'approved'; }) && setHash(p, s.imageIds) === s.hash;
    return ok ? { state: 'approved', approved: true, imageIds: s.imageIds, hash: s.hash, by: s.by, at: s.at } : { state: 'stale', approved: false, note: '승인 후 이미지가 바뀌었습니다. 참조 세트를 다시 승인하세요.' };
  }
  function verifiedFacts(p) {
    return (p.specs || []).filter((s) => s.verified).map((s) => s.text).concat((p.sellingPoints || []).filter((s) => s.verified).map((s) => s.text));
  }

  function view(p) {
    const refs = referenceState(p);
    return Object.assign({}, p, {
      images: p.images.map((im) => Object.assign({}, im, { kindLabel: KIND_LABEL[im.kind], url: `/media/product/${p.id}/${im.id}` })),
      reference: refs,
      verifiedFacts: verifiedFacts(p),
      limits: { uploads: MAX_UPLOADS, retrieved: MAX_RETRIEVED, generated: MAX_GENERATED },
      counts: { uploaded: p.images.filter((i) => i.kind === 'uploaded' && i.status !== 'replaced').length, retrieved: p.images.filter((i) => i.kind === 'retrieved').length, generated: p.images.filter((i) => i.kind === 'ai_generated').length },
      readiness: readiness(p, refs),
    });
  }
  function readiness(p, refs = referenceState(p)) {
    const missing = [];
    if (!p.name) missing.push('상품명');
    if (!verifiedFacts(p).length) missing.push('확인된 기능/특징(최소 1개)');
    if (!refs.approved) missing.push('승인된 참조 이미지 세트');
    return { ok: missing.length === 0, missing };
  }

  const list = () => ids().map((i) => { const p = get(i); return { id: p.id, name: p.name, url: p.url, extraction: p.extraction && p.extraction.status, reference: referenceState(p).state, images: p.images.length, readiness: readiness(p), updatedAt: p.updatedAt }; });

  async function create({ id, name, url = '', affiliateUrl = '', description = '', category = '', features = [], forbiddenClaims = [], legacy = false } = {}) {
    if (!String(name || '').trim() && !String(url || '').trim()) throw new StudioError('NEED_INPUT', '상품명이나 상품 URL 중 하나는 필요합니다.', { status: 400 });
    if (url) require('./extract').parseUrl(url);
    const pid = id || nextId();
    if (fs.existsSync(fileOf(pid))) throw new StudioError('DUPLICATE', '이미 있는 상품 ID입니다: ' + pid, { status: 409 });
    const p = {
      id: pid, name: String(name || '').trim().slice(0, 200), url: String(url || '').trim(), affiliateUrl: String(affiliateUrl || '').trim(), description: String(description || '').slice(0, 3000), category: String(category || '').slice(0, 100),
      specs: (features || []).map(String).map((t) => t.trim()).filter(Boolean).map((text) => ({ text, source: 'manual', verified: true, at: nowIso() })),
      sellingPoints: [], forbiddenClaims: (forbiddenClaims || []).map(String).filter(Boolean),
      extraction: { status: 'none', note: '', at: '' }, images: [], referenceSet: null, legacy: !!legacy, createdAt: nowIso(), updatedAt: nowIso(),
    };
    fs.mkdirSync(dirOf(pid), { recursive: true });
    writeJsonAtomic(fileOf(pid), p);
    return view(p);
  }

  async function edit(id, patch) {
    const p = await update(id, (p) => {
      ['name', 'category', 'description', 'url', 'affiliateUrl'].forEach((k) => patch[k] !== undefined && (p[k] = String(patch[k]).trim().slice(0, k === 'description' ? 3000 : 300)));
      if (patch.url) require('./extract').parseUrl(patch.url);
      if (Array.isArray(patch.forbiddenClaims)) p.forbiddenClaims = patch.forbiddenClaims.map(String).filter(Boolean);
      // specs: [{text, verified}] — a text the operator types or confirms is "verified"; changing text re-sets source to manual.
      if (Array.isArray(patch.specs)) {
        p.specs = patch.specs.filter((s) => s && String(s.text || '').trim()).map((s) => {
          const old = p.specs.find((o) => o.text === s.text);
          return { text: String(s.text).trim().slice(0, 300), source: old ? old.source : 'manual', verified: !!s.verified, at: old ? old.at : nowIso() };
        });
      }
      if (Array.isArray(patch.sellingPoints)) p.sellingPoints = patch.sellingPoints.filter((s) => s && String(s.text || '').trim()).map((s) => ({ text: String(s.text).trim().slice(0, 300), verified: !!s.verified }));
    });
    return view(p);
  }

  async function extract(id) {
    const p0 = get(id);
    if (!p0.url) throw new StudioError('NO_URL', '상품 URL이 없습니다. URL을 입력하거나 직접 입력하세요.', { status: 400 });
    const r = await extractFn(p0.url);
    const downloaded = [];
    const failed = [];
    if (r.status === 'ok') {
      for (const imgUrl of r.data.images.slice(0, MAX_RETRIEVED)) {
        try { downloaded.push(Object.assign(await downloadFn(imgUrl), { sourceUrl: imgUrl })); } catch (e) { failed.push({ url: imgUrl, reason: e.message }); }
      }
    }
    const p = await update(id, (p) => {
      p.extraction = { status: r.status, reason: r.reason || '', note: r.note, at: nowIso(), sourceUrl: r.sourceUrl, imageFailures: failed };
      if (r.status !== 'ok') return;
      if (!p.name && r.data.title) p.name = r.data.title.slice(0, 200);
      if (!p.description && r.data.description) p.description = r.data.description.slice(0, 3000);
      r.data.specs.forEach((t) => { if (!p.specs.some((s) => s.text === t)) p.specs.push({ text: t, source: 'extracted', verified: false, at: nowIso() }); });
      p.extracted = { title: r.data.title, description: r.data.description, at: nowIso() };
      downloaded.forEach((d) => {
        if (p.images.filter((i) => i.kind === 'retrieved').length >= MAX_RETRIEVED) return;
        const hash = sha256(d.buffer);
        if (p.images.some((i) => i.sha256 === hash)) return;
        const imgId = 'img_' + hash.slice(0, 10);
        writeFileAtomic(path.join(dirOf(id), imgId + d.ext), d.buffer);
        p.images.push({ id: imgId, file: imgId + d.ext, kind: 'retrieved', sha256: hash, size: d.buffer.length, status: 'pending', label: '수집 이미지', sourceUrl: d.sourceUrl, licenseNote: '쇼핑몰 이미지의 광고/AI 변형 사용 권한은 확인되지 않았습니다. 사용 전 권리를 확인하세요.', createdAt: nowIso() });
      });
    });
    return view(p);
  }

  function saveImage(p, id, { buffer, filename, kind, label, extra = {} }) {
    const sn = sniffImage(buffer);
    if (!sn) throw new StudioError('BAD_TYPE', 'PNG, JPG, WEBP 이미지만 올릴 수 있습니다.', { status: 415 });
    if (buffer.length > 10 * 1024 * 1024) throw new StudioError('TOO_LARGE', '10 MB 이하 이미지만 가능합니다.', { status: 413 });
    const hash = sha256(buffer);
    if (p.images.some((i) => i.sha256 === hash && i.status !== 'replaced')) throw new StudioError('DUPLICATE', '이미 있는 같은 이미지입니다.', { status: 409 });
    const imgId = 'img_' + hash.slice(0, 10);
    writeFileAtomic(path.join(dirOf(id), imgId + sn.ext), buffer);
    const im = Object.assign({ id: imgId, file: imgId + sn.ext, kind, sha256: hash, size: buffer.length, status: 'pending', label: label || safeName(filename || '').replace(/\.[^.]+$/, '') || KIND_LABEL[kind], originalName: safeName(filename || ''), createdAt: nowIso() }, extra);
    p.images.push(im);
    return im;
  }

  async function upload(id, buffer, filename, { label } = {}) {
    const p = await update(id, (p) => {
      if (!buffer || !buffer.length) throw new StudioError('EMPTY_FILE', '빈 파일입니다.', { status: 400 });
      if (p.images.filter((i) => i.kind === 'uploaded' && i.status !== 'replaced').length >= MAX_UPLOADS) throw new StudioError('UPLOAD_LIMIT', `업로드는 최대 ${MAX_UPLOADS}장입니다. 기존 이미지를 교체하거나 삭제하세요.`, { status: 409 });
      saveImage(p, id, { buffer, filename, kind: 'uploaded', label });
    });
    return view(p);
  }

  async function replace(id, imgId, buffer, filename) {
    const p = await update(id, (p) => {
      const old = p.images.find((i) => i.id === imgId);
      if (!old) throw new StudioError('NOT_FOUND', '이미지를 찾을 수 없습니다.', { status: 404 });
      const nu = saveImage(p, id, { buffer, filename, kind: 'uploaded', label: old.label, extra: { replaces: old.id } });
      old.status = 'replaced';
      old.replacedBy = nu.id;
    });
    return view(p);
  }

  async function setStatus(id, imgId, status, by = 'operator') {
    if (!['approved', 'rejected', 'pending'].includes(status)) throw new StudioError('BAD_VALUE', '상태가 올바르지 않습니다.', { status: 400 });
    const p = await update(id, (p) => {
      const im = p.images.find((i) => i.id === imgId);
      if (!im) throw new StudioError('NOT_FOUND', '이미지를 찾을 수 없습니다.', { status: 404 });
      if (im.status === 'replaced') throw new StudioError('REPLACED', '교체된 이미지입니다.', { status: 409 });
      im.status = status;
      im.decidedBy = by;
      im.decidedAt = nowIso();
    });
    return view(p);
  }

  /** AI product image (Gemini image-capable model). Always labelled AI-generated; needs explicit paid confirmation. */
  async function generateImage(id, { basedOn = [], prompt = '', confirm } = {}) {
    const p0 = get(id);
    if (p0.images.filter((i) => i.kind === 'ai_generated').length >= MAX_GENERATED) throw new StudioError('GEN_LIMIT', `AI 생성 이미지는 최대 ${MAX_GENERATED}장입니다.`, { status: 409 });
    const srcs = p0.images.filter((i) => basedOn.includes(i.id) && i.kind !== 'ai_generated' && i.status === 'approved');
    if (!srcs.length) throw new StudioError('NO_SOURCE', '기준이 될 승인된 원본/업로드 이미지를 선택하세요. (제품 모양을 임의로 만들지 않습니다.)', { status: 409 });
    const images = srcs.map((s) => ({ label: 'Product reference photo (keep exact shape, logo, colour and function):', mimeType: MIME[path.extname(s.file)] || 'image/png', data: fs.readFileSync(path.join(dirOf(id), s.file)).toString('base64') }));
    const instruction = [
      'Create a clean product image of EXACTLY the product shown in the reference photo(s).',
      'Do NOT change the product shape, proportions, logo, text, colour or functionality. Do not add features. No people, no extra text.',
      prompt ? 'Requested variation (background/angle/lighting only): ' + String(prompt).slice(0, 500) : 'Variation: neutral light background, product centered.',
    ].join('\n');
    const out = await router.runImage('imageGeneration', { prompt: instruction, images, confirm });
    const p = await update(id, (p) => {
      out.images.forEach((g) => {
        const buf = Buffer.from(g.data, 'base64');
        saveImage(p, id, { buffer: buf, filename: 'ai.png', kind: 'ai_generated', label: 'AI 생성 이미지', extra: { derivedFrom: srcs.map((s) => s.id), provider: out.provider, model: out.model, prompt: instruction, disclosure: 'AI가 만든 이미지입니다. 제조사 사진이 아닙니다.' } });
      });
    });
    return view(p);
  }

  async function approveReferenceSet(id, { imageIds, by = 'operator' } = {}) {
    const p = await update(id, (p) => {
      const sel = imageIds && imageIds.length ? imageIds : p.images.filter((i) => i.status === 'approved').map((i) => i.id);
      if (!sel.length) throw new StudioError('NO_IMAGES', '승인된 이미지가 없습니다. 먼저 이미지를 하나 이상 승인하세요.', { status: 409 });
      if (sel.length > MAX_SET) throw new StudioError('SET_LIMIT', `참조 세트는 최대 ${MAX_SET}장입니다.`, { status: 409 });
      sel.forEach((i) => { const im = p.images.find((x) => x.id === i); if (!im || im.status !== 'approved') throw new StudioError('NOT_APPROVED', '승인되지 않은 이미지가 포함되어 있습니다: ' + i, { status: 409 }); });
      p.referenceSet = { id: 'refset_' + sha256(sel.slice().sort().join()).slice(0, 8), imageIds: sel, hash: setHash(p, sel), by, at: nowIso(), kinds: Array.from(new Set(sel.map((i) => p.images.find((x) => x.id === i).kind))) };
    });
    return view(p);
  }

  async function waiveReferences(id, reason, by = 'operator') {
    if (!String(reason || '').trim()) throw new StudioError('NEED_REASON', '이미지 없이 진행하는 이유를 입력하세요.', { status: 400 });
    const p = await update(id, (p) => { p.referenceSet = { id: 'refset_waived', waived: String(reason).slice(0, 300), imageIds: [], hash: '', by, at: nowIso() }; });
    return view(p);
  }

  /** The record Story Lab / Script Studio bind to. Throws unless the product is ready. */
  function bindingFor(id) {
    const p = get(id);
    const r = readiness(p);
    if (!r.ok) throw new StudioError('PRODUCT_NOT_READY', '상품 준비가 끝나지 않았습니다: ' + r.missing.join(', '), { recovery: 'Products 화면에서 항목을 채우고 참조 이미지 세트를 승인하세요.', status: 409 });
    return { product: p, facts: verifiedFacts(p), reference: referenceState(p) };
  }

  function imageFiles(id, imageIds) {
    const p = get(id);
    return imageIds.map((i) => p.images.find((x) => x.id === i)).filter(Boolean).map((im) => ({ id: im.id, kind: im.kind, mimeType: MIME[path.extname(im.file)] || 'image/png', path: path.join(dirOf(id), im.file) }));
  }
  function mediaFile(id, imgId) {
    const im = get(id).images.find((i) => i.id === imgId);
    if (!im) throw new StudioError('NOT_FOUND', '이미지를 찾을 수 없습니다.', { status: 404 });
    return path.join(dirOf(id), im.file);
  }

  return { list, get: (id) => view(get(id)), raw: get, create, edit, extract, upload, replace, setStatus, generateImage, approveReferenceSet, waiveReferences, bindingFor, imageFiles, mediaFile, referenceState, verifiedFacts, readiness, MAX_UPLOADS };
}

module.exports = { createProductService, KIND_LABEL, MAX_UPLOADS };
