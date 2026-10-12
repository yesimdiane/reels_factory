#!/usr/bin/env node
// Reels Factory Studio — local web server (no dependencies).
//   node studio/server.js            → http://127.0.0.1:4173   (MOCK mode unless RF_MUAPI_MODE=live)
// API keys (MUAPI_API_KEY, HEYGEN_API_KEY) are read from renderer/.env or the environment by THIS process only.
// No response ever contains a key. Binds to 127.0.0.1 by default; mutating requests need a custom header and a
// same-origin Origin, and an optional RF_STUDIO_TOKEN protects everything else.
'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../renderer/lib/config');
const { createStudio } = require('./lib/studio');
const { StudioError } = require('./lib/util');
const { ProviderError } = require('./lib/providers');
const { createSheetsBridge } = require('./lib/sheets-bridge');

const VERSION = require('../package.json').version;

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const MAX_JSON = 2 * 1024 * 1024;
const MAX_UPLOAD = 60 * 1024 * 1024;

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) {
        reject(new StudioError('TOO_LARGE', `요청이 너무 큽니다 (최대 ${Math.round(limit / 1048576)} MB).`, { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

function sendFile(req, res, file, { download = false } = {}) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '파일을 찾을 수 없습니다.' } });
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' };
  if (type.startsWith('text/html')) {
    headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
    headers['X-Frame-Options'] = 'DENY';
    headers['Referrer-Policy'] = 'no-referrer';
  }
  if (download) headers['Content-Disposition'] = 'attachment; filename="' + path.basename(file) + '"';
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
    if (start > end || start >= st.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
      return res.end();
    }
    end = Math.min(end, st.size - 1);
    res.writeHead(206, Object.assign(headers, { 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 }));
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, Object.assign(headers, { 'Content-Length': st.size }));
  fs.createReadStream(file).pipe(res);
}

// ---------- login (cloud) ----------
// A signed, HttpOnly, SameSite=Strict session cookie. The signing key is derived from RF_MASTER_KEY (or the admin password).
// Failed logins are rate-limited per client IP. Local use without RF_ADMIN_PASSWORD keeps the old behaviour (loopback only).
function createAuth({ password = '', secret = '', ttlMs = 12 * 3600 * 1000, now = () => Date.now() } = {}) {
  const enabled = !!password;
  const key = crypto.createHash('sha256').update('rf-session|' + (secret || password)).digest();
  const sign = (p) => crypto.createHmac('sha256', key).update(p).digest('base64url');
  const fails = new Map();
  const eq = (a, b) => { const x = crypto.createHash('sha256').update(String(a)).digest(); const y = crypto.createHash('sha256').update(String(b)).digest(); return crypto.timingSafeEqual(x, y); };
  return {
    enabled,
    attempt(ip, supplied) {
      const f = fails.get(ip) || { n: 0, until: 0, first: now() };
      if (f.until > now()) throw new StudioError('RATE_LIMITED', '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.', { status: 429 });
      if (!eq(supplied || '', password)) {
        f.n += 1;
        if (now() - f.first > 10 * 60 * 1000) { f.n = 1; f.first = now(); }
        if (f.n >= 5) { f.until = now() + 10 * 60 * 1000; f.n = 0; f.first = now(); }
        fails.set(ip, f);
        throw new StudioError('LOGIN_FAILED', '비밀번호가 올바르지 않습니다.', { status: 401 });
      }
      fails.delete(ip);
      const payload = `${now() + ttlMs}.${crypto.randomBytes(8).toString('hex')}`;
      return payload + '.' + sign(payload);
    },
    verify(cookie) {
      if (!enabled) return true;
      const m = /^(\d+)\.([0-9a-f]+)\.([A-Za-z0-9_-]+)$/.exec(cookie || '');
      if (!m) return false;
      const payload = m[1] + '.' + m[2];
      return eq(sign(payload), m[3]) && Number(m[1]) > now();
    },
    ttlMs,
  };
}

const RAILWAY_HEALTHCHECK_HOST = 'healthcheck.railway.app'; // https://docs.railway.com/deployments/healthchecks

function createApp(studio, { token = '', port = 0, host = '127.0.0.1', log = () => {}, bridge = null, auth = createAuth(), publicHost = '' } = {}) {
  const S = studio;
  const routes = [];
  const route = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:[a-zA-Z]+/g, '([^/]+)') + '$'), names: (pattern.match(/:[a-zA-Z]+/g) || []).map((s) => s.slice(1)), handler, opts });
  const ep = (id) => S.episodeView(id);
  const bg = (promise, label) => promise.catch((e) => log(label + ': ' + e.message)); // background work: errors are stored in the episode

  // ---- session / health ----
  route('GET', '/healthz', async () => ({ ok: true, version: VERSION, schemaVersion: (require('./lib/util').readJson(S.store.path('schema.json'), {}) || {}).schemaVersion || null, video: S.video.mode, voice: S.voice.mode, time: new Date().toISOString() }));
  route('GET', '/api/session', async ({ cookie }) => ({ authRequired: auth.enabled, authenticated: auth.verify(cookie) }));
  route('POST', '/api/login', async ({ body, ip, res, secure }) => {
    const v = auth.attempt(ip, body.password);
    res.setHeader('Set-Cookie', `rf_session=${v}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(auth.ttlMs / 1000)}${secure ? '; Secure' : ''}`);
    return { ok: true };
  });
  route('POST', '/api/logout', async ({ res }) => { res.setHeader('Set-Cookie', 'rf_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return { ok: true }; });

  // ---- products / reference images ----
  route('GET', '/api/products', async () => S.products.list());
  route('POST', '/api/products', async ({ body }) => S.products.create(body));
  route('GET', '/api/products/:id', async ({ p }) => S.products.get(p.id));
  route('PUT', '/api/products/:id', async ({ p, body }) => S.products.edit(p.id, body));
  route('POST', '/api/products/:id/extract', async ({ p }) => S.products.extract(p.id));
  route('POST', '/api/products/:id/images', async ({ p, raw, headers, query }) => S.products.upload(p.id, raw, decodeURIComponent(headers['x-filename'] || 'image.png'), { label: query.label }), { upload: true });
  route('POST', '/api/products/:id/images/generate', async ({ p, body }) => S.products.generateImage(p.id, { basedOn: body.basedOn || [], extraImageIds: body.extraImageIds || [], style: body.style || 'anime', prompt: body.prompt, confirm: body.confirm }));
  route('POST', '/api/products/:id/images/:iid/choose', async ({ p }) => S.products.chooseVersion(p.id, p.iid));
  route('POST', '/api/products/:id/images/estimate', async ({ p, body }) => S.router.estimate('imageGeneration', { inputChars: 1200, outputTokens: 1500, images: Math.max(1, (body.basedOn || body.extraImageIds) ? S.products.imageCount(p.id, { basedOn: body.basedOn || [], extraImageIds: body.extraImageIds || [] }) : 2) }));
  route('POST', '/api/products/:id/images/:iid/replace', async ({ p, raw, headers }) => S.products.replace(p.id, p.iid, raw, decodeURIComponent(headers['x-filename'] || 'image.png')), { upload: true });
  route('POST', '/api/products/:id/images/:iid/status', async ({ p, body }) => S.products.setStatus(p.id, p.iid, body.status));
  route('POST', '/api/products/:id/references/approve', async ({ p, body }) => S.products.approveReferenceSet(p.id, { imageIds: body.imageIds }));
  route('POST', '/api/products/:id/references/waive', async ({ p, body }) => S.products.waiveReferences(p.id, body.reason));

  // ---- Story Lab ----
  route('GET', '/api/storylab/:pid', async ({ p }) => S.storylab.list(p.pid));
  route('POST', '/api/storylab/:pid/estimate', async ({ p, body }) => S.storylab.estimate(p.pid, body));
  route('POST', '/api/storylab/:pid/generate', async ({ p, body }) => S.storylab.generate(p.pid, { count: body.count, extra: body.extra, confirm: body.confirm }));
  route('POST', '/api/storylab/:pid/concepts/:cid/regenerate', async ({ p, body }) => S.storylab.regenerate(p.pid, p.cid, { feedback: body.feedback, confirm: body.confirm }));
  route('PUT', '/api/storylab/:pid/concepts/:cid', async ({ p, body }) => S.storylab.edit(p.pid, p.cid, body));
  route('POST', '/api/storylab/:pid/concepts/:cid/approve', async ({ p }) => S.storylab.approve(p.pid, p.cid));
  route('POST', '/api/storylab/:pid/concepts/:cid/revoke', async ({ p }) => S.storylab.revoke(p.pid, p.cid));
  route('POST', '/api/storylab/:pid/concepts/:cid/reject', async ({ p, body }) => S.storylab.reject(p.pid, p.cid, body.reason));
  route('POST', '/api/storylab/:pid/concepts/:cid/reopen', async ({ p }) => S.storylab.reopen(p.pid, p.cid));
  route('POST', '/api/storylab/:pid/concepts/:cid/episode', async ({ p, body }) => { const id = await S.createEpisodeFromConcept({ productId: p.pid, conceptId: p.cid, newVersion: body.newVersion === true }); return ep(id); });

  // ---- Settings: AI integrations / prompts ----
  route('GET', '/api/ai', async () => S.integrations.overview());
  route('PUT', '/api/ai/keys/:prov', async ({ p, body }) => S.integrations.setKey(p.prov, body.key));
  route('DELETE', '/api/ai/keys/:prov', async ({ p }) => S.integrations.removeKey(p.prov));
  route('POST', '/api/ai/test/:prov', async ({ p, body }) => S.integrations.test(p.prov, body.model));
  route('PUT', '/api/ai/models/:prov', async ({ p, body }) => S.integrations.setModel(p.prov, body.model));
  route('PUT', '/api/ai/routing/:task', async ({ p, body }) => S.integrations.setRouting(p.task, body));
  route('PUT', '/api/ai/pricing', async ({ body }) => S.integrations.setPricing(body.provider, body.model, body));
  route('PUT', '/api/ai/limits', async ({ body }) => S.integrations.setLimits(body));
  route('PUT', '/api/ai/mode/:prov', async ({ p, body }) => S.integrations.setMode(p.prov, body.mode, { confirm: body.confirm }));
  route('GET', '/api/ai/usage', async ({ query }) => S.integrations.usageView(Number(query.limit) || 100));
  route('GET', '/api/ai/audit', async () => S.integrations.auditLog());
  route('GET', '/api/prompts', async () => ({ channel: S.prompts.channel(), prompts: S.prompts.list() }));
  route('PUT', '/api/channel', async ({ body }) => S.prompts.saveChannel(body));
  route('GET', '/api/prompts/:key', async ({ p }) => S.prompts.get(p.key));
  route('PUT', '/api/prompts/:key', async ({ p, body }) => S.prompts.save(p.key, body));
  route('POST', '/api/prompts/:key/restore', async ({ p, body }) => S.prompts.restore(p.key, body));
  route('GET', '/api/prompts/:key/versions/:v', async ({ p }) => ({ key: p.key, v: Number(p.v), text: S.prompts.versionText(p.key, p.v) }));
  route('POST', '/api/prompts/:key/preview', async ({ p, body }) => ({ text: S.prompts.preview(p.key, body.vars || {}) }));

  // ---- script generation from the approved concept ----
  route('POST', '/api/episodes/:id/script/generate', async ({ p, body }) => { const r = await S.scriptgen.generate(p.id, { confirm: body.confirm, overwrite: body.overwrite === true, extra: body.extra }); const v = ep(p.id); v.generated = r; return v; });
  route('POST', '/api/episodes/:id/script/estimate', async ({ p, body }) => { const e = S.store.episodes.get(p.id); const c = S.storylab.requireApproved(e.concept && e.concept.productId, e.concept && e.concept.conceptId); const q = S.scriptgen.buildPrompt(e, c, body.extra); return S.router.estimate('scriptWriting', { inputChars: q.prompt.length, outputTokens: 6000, override: q.composed.providerOverride || undefined }); });

  // ---- state ----
  route('GET', '/api/sheets/status', async () => ({ enabled: !!(bridge && bridge.enabled), note: 'Studio is authoritative; Sheets receives a read-only mirror of Studio episodes.' }));
  route('POST', '/api/sheets/sync', async () => {
    if (!bridge || !bridge.enabled) throw new StudioError('NOT_CONFIGURED', 'Sheets bridge URL/token are not configured.', {status:400});
    const episodes = S.store.episodes.list();
    const results = [];
    for (const e of episodes) {
      try { await bridge.push(e); results.push({id:e.id,ok:true}); }
      catch(err) { results.push({id:e.id,ok:false,error:err.message}); }
    }
    return { synced:results.filter(x=>x.ok).length, total:results.length, results };
  });
  route('GET', '/api/state', async () => S.summary());
  route('GET', '/api/episodes/:id', async ({ p }) => ep(p.id));
  route('POST', '/api/episodes', async ({ body }) => {
    if (body.conceptId) return ep(await S.createEpisodeFromConcept({ productId: body.productId, conceptId: body.conceptId, id: body.id }));
    if (body.manual !== true) throw new StudioError('CONCEPT_REQUIRED', '에피소드는 승인된 스토리 컨셉에서 시작해야 합니다 (제품 → 스토리 컨셉 → 대본).', { recovery: 'Story Lab에서 컨셉을 승인한 뒤 "이 컨셉으로 에피소드 만들기"를 누르세요.', status: 409 });
    await S.createEpisode(body);
    return ep(body.id);
  });

  // ---- script ----
  route('PUT', '/api/episodes/:id/script', async ({ p, body }) => S.saveScript(p.id, body, 'operator', body.note));
  route('POST', '/api/episodes/:id/script/approve', async ({ p }) => S.approveScript(p.id));
  route('POST', '/api/episodes/:id/script/revoke', async ({ p }) => S.revokeScript(p.id));
  route('POST', '/api/episodes/:id/versions/:n/restore', async ({ p }) => S.restoreVersion(p.id, Number(p.n)));
  route('GET', '/api/episodes/:id/versions/:n', async ({ p }) => S.store.episodes.version(p.id, Number(p.n)));
  route('POST', '/api/episodes/:id/suggestions/:i/add', async ({ p }) => S.addSuggestion(p.id, Number(p.i)));

  // ---- storyboard ----
  route('POST', '/api/episodes/:id/storyboard/prompts', async ({ p, body }) => S.rebuildPrompts(p.id, body.sceneIds, { force: !!body.force, mode: body.mode === 'gemini' ? 'gemini' : 'template', confirmAi: body.confirmAi === true }));
  route('PUT', '/api/episodes/:id/scenes/:sid/prompt', async ({ p, body }) => S.savePrompt(p.id, p.sid, body));
  route('PUT', '/api/episodes/:id/scenes/:sid/start-image', async ({ p, body }) => S.setStartImage(p.id, p.sid, body));
  route('POST', '/api/episodes/:id/scenes/:sid/start-frame', async ({ p, raw, headers }) => S.uploadStartFrame(p.id, p.sid, raw, decodeURIComponent(headers['x-filename'] || 'frame.png')), { upload: true });
  route('POST', '/api/episodes/:id/start-images/estimate', async ({ p, body }) => S.startImages.estimate(p.id, body.sceneIds, { force: body.force === true }));
  route('POST', '/api/episodes/:id/start-images/generate', async ({ p, body }) => { const r = await S.startImages.generate(p.id, body.sceneIds, { confirm: body.confirm, force: body.force === true }); const v = ep(p.id); v.startImageResult = r; return v; });
  route('POST', '/api/episodes/:id/scenes/:sid/start-frame/approve', async ({ p, body }) => S.approveStartFrame(p.id, p.sid, body.approved !== false));
  route('POST', '/api/episodes/:id/storyboard/approve', async ({ p }) => S.approveStoryboard(p.id));
  route('PUT', '/api/episodes/:id/spend-limit', async ({ p, body }) => S.setSpendLimit(p.id, body.usd));

  // ---- animation ----
  route('POST', '/api/episodes/:id/generation/estimate', async ({ p, body }) => S.gen.estimate(p.id, body));
  route('POST', '/api/episodes/:id/generation/authorize', async ({ p, body }) => S.gen.authorize(p.id, body));
  route('POST', '/api/episodes/:id/generation/run', async ({ p, body }) => {
    const { accepted, done } = await S.gen.run(p.id, body.authorizationId);
    bg(done, 'generation');
    return { status: 202, data: { accepted } };
  });
  route('POST', '/api/episodes/:id/jobs/:jid/resume', async ({ p }) => {
    bg(S.gen.resume(p.id, p.jid), 'resume');
    return { status: 202, data: { accepted: true } };
  });
  route('POST', '/api/episodes/:id/jobs/:jid/dismiss', async ({ p }) => { await S.gen.dismissJob(p.id, p.jid); return ep(p.id); });
  route('POST', '/api/episodes/:id/clips/:sid/upload', async ({ p, raw, headers }) => { await S.gen.addManualClip(p.id, p.sid, raw, decodeURIComponent(headers['x-filename'] || 'clip.mp4')); return ep(p.id); }, { upload: true });
  route('POST', '/api/episodes/:id/clips/:sid/:v/review', async ({ p, body }) => { await S.gen.review(p.id, p.sid, Number(p.v), body.decision, { note: body.note }); return ep(p.id); });

  // ---- voice ----
  route('POST', '/api/episodes/:id/voice/estimate', async ({ p }) => S.voice.estimate(p.id));
  route('POST', '/api/episodes/:id/voice/run', async ({ p, body }) => { await S.voice.synthesize(p.id, { confirmChars: body.confirmChars }); return ep(p.id); });
  route('POST', '/api/characters/:id/voice/verify', async ({ p }) => { await S.voice.verify(p.id); return S.characterView(S.store.characters.get(p.id)); });

  // ---- render / review ----
  route('POST', '/api/episodes/:id/render', async ({ p, body }) => {
    const { done } = await S.renderer.render(p.id, { preview: !!body.preview });
    bg(done, 'render');
    return { status: 202, data: { accepted: true } };
  });
  route('POST', '/api/episodes/:id/renders/:v/approve', async ({ p }) => { await S.renderer.approveFinal(p.id, Number(p.v)); return ep(p.id); });
  route('POST', '/api/episodes/:id/final/revoke', async ({ p }) => { await S.renderer.revokeFinal(p.id); return ep(p.id); });
  route('POST', '/api/episodes/:id/sfx', async ({ p, raw, headers, query }) => S.uploadSfx(p.id, raw, decodeURIComponent(headers['x-filename'] || 'sfx.wav'), query.label, query.atSec), { upload: true });
  route('PUT', '/api/episodes/:id/sfx/:fid', async ({ p, body }) => S.updateSfx(p.id, p.fid, body));

  // ---- publishing ----
  route('POST', '/api/episodes/:id/publishing/generate', async ({ p, body }) => { await S.publishing.init(p.id, { force: !!body.force }); return ep(p.id); });
  route('PUT', '/api/episodes/:id/publishing', async ({ p, body }) => { await S.publishing.save(p.id, body); return ep(p.id); });
  route('POST', '/api/episodes/:id/publishing/approve', async ({ p }) => { await S.publishing.approve(p.id); return ep(p.id); });
  route('PUT', '/api/episodes/:id/publishing/checklist', async ({ p, body }) => { await S.publishing.setChecklist(p.id, body.key, body.value); return ep(p.id); });
  route('POST', '/api/episodes/:id/publishing/published', async ({ p, body }) => { await S.publishing.markPublished(p.id, body.postUrl); return ep(p.id); });

  // ---- characters / settings ----
  route('PUT', '/api/characters/:id/references/:rid', async ({ p, body }) => { S.store.characters.setReferenceKind(p.id, p.rid, body.isSheet !== false); return S.characterView(S.store.characters.get(p.id)); });
  route('PUT', '/api/characters/:id', async ({ p, body }) => S.updateCharacter(p.id, body));
  route('POST', '/api/characters/:id/references', async ({ p, raw, headers, query }) => {
    S.store.characters.addReference(p.id, { buffer: raw, filename: decodeURIComponent(headers['x-filename'] || 'ref.png'), mime: (headers['content-type'] || '').split(';')[0], label: query.label || '' });
    return S.characterView(S.store.characters.get(p.id));
  }, { upload: true });
  route('POST', '/api/characters/:id/references/:rid/approve', async ({ p, body }) => { S.store.characters.setReferenceApproved(p.id, p.rid, body.approved !== false); return S.characterView(S.store.characters.get(p.id)); });
  route('DELETE', '/api/characters/:id/references/:rid', async ({ p }) => { S.store.characters.removeReference(p.id, p.rid); return S.characterView(S.store.characters.get(p.id)); });
  route('POST', '/api/demo/references', async () => ({ made: await S.loadDemoReferences() }));
  route('PUT', '/api/settings', async ({ body }) => S.saveSettings(body));

  // ---- media (ids only) ----
  route('GET', '/media/product/:a/:b', async ({ p }) => ({ file: S.mediaFile('product', p.a, p.b) }));
  route('GET', '/media/ref/:a/:b', async ({ p }) => ({ file: S.mediaFile('ref', p.a, p.b) }));
  route('GET', '/media/clip/:a/:b/:c', async ({ p }) => ({ file: S.mediaFile('clip', p.a, p.b, p.c) }));
  route('GET', '/media/render/:a/:b', async ({ p, query }) => ({ file: S.mediaFile('render', p.a, p.b), download: query.download === '1' }));
  route('GET', '/media/audio/:a/:b', async ({ p }) => ({ file: S.mediaFile('audio', p.a, p.b) }));
  route('GET', '/media/startframe/:a/:b', async ({ p }) => ({ file: S.mediaFile('startframe', p.a, p.b) }));

  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host);
  const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, host + ':' + port]);
  if (publicHost) { allowedHosts.add(publicHost); allowedHosts.add(publicHost + ':' + port); }
  const PUBLIC_API = new Set(['/api/session', '/api/login', '/api/logout']);

  // Last line of defence: no API key can ever leave in an error body, even if a provider echoed it.
  function scrubSecrets(obj) {
    let t = JSON.stringify(obj);
    try { S.vault.providers.forEach((pn) => { const k = S.vault.get(pn); if (k && k.length >= 8) t = t.split(k).join('[redacted]'); }); } catch (_) { /* vault unreadable: nothing to scrub */ }
    return JSON.parse(t);
  }

  async function handle(req, res) {
    try {
      const url = new URL(req.url, 'http://x');
      const reqHost = String(req.headers.host || '');
      // Railway's deploy healthcheck calls GET /healthz with Host: healthcheck.railway.app. Only that exact request is exempt.
      const railwayHealthcheck = req.method === 'GET' && url.pathname === '/healthz' && reqHost === RAILWAY_HEALTHCHECK_HOST;
      if (port && (loopback || publicHost) && !railwayHealthcheck && !allowedHosts.has(reqHost)) return sendJson(res, 403, { error: { code: 'HOST', message: '허용되지 않은 호스트입니다.' } });
      const isApi = url.pathname.startsWith('/api/');
      const isMedia = url.pathname.startsWith('/media/');
      const cookies = req.headers.cookie || '';
      const sess = /(?:^|;\s*)rf_session=([^;]+)/.exec(cookies);
      if (auth.enabled && (isApi || isMedia) && !PUBLIC_API.has(url.pathname) && !auth.verify(sess && sess[1])) return sendJson(res, 401, { error: { code: 'LOGIN_REQUIRED', message: '로그인이 필요합니다.', recovery: '관리자 비밀번호로 로그인하세요.' } });
      if (token && (isApi || isMedia)) {
        const cookie = /(?:^|;\s*)rf_token=([^;]+)/.exec(req.headers.cookie || '');
        const supplied = req.headers['x-rf-token'] || (cookie && decodeURIComponent(cookie[1])) || url.searchParams.get('t');
        if (supplied !== token) return sendJson(res, 401, { error: { code: 'TOKEN', message: '접근 토큰이 필요합니다.', recovery: '설정한 RF_STUDIO_TOKEN 값을 입력하세요.' } });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const origin = req.headers.origin;
        if (req.headers['x-rf-studio'] !== '1') return sendJson(res, 403, { error: { code: 'CSRF', message: '잘못된 요청입니다.' } });
        let originHost = '';
        try { originHost = origin ? new URL(origin).host : ''; } catch (_) { originHost = '?'; }
        if (origin && port && originHost !== reqHost) return sendJson(res, 403, { error: { code: 'ORIGIN', message: '다른 출처의 요청입니다.' } });
      }
      if (isApi || isMedia || url.pathname === '/healthz') {
        const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
        if (!r) return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '알 수 없는 경로입니다.' } });
        const m = r.re.exec(url.pathname);
        const p = {};
        r.names.forEach((n, i) => (p[n] = decodeURIComponent(m[i + 1])));
        let body = {};
        let raw = null;
        if (req.method === 'POST' || req.method === 'PUT') {
          if (r.opts.upload) raw = await readBody(req, MAX_UPLOAD);
          else {
            const buf = await readBody(req, MAX_JSON);
            if (buf.length) {
              try {
                body = JSON.parse(buf.toString('utf8'));
              } catch {
                throw new StudioError('BAD_JSON', '요청 형식이 올바르지 않습니다.');
              }
            }
          }
        }
        const out = await r.handler({ p, body, raw, headers: req.headers, query: Object.fromEntries(url.searchParams), res, ip: req.socket.remoteAddress || '', cookie: sess && sess[1], secure: req.headers['x-forwarded-proto'] === 'https' });
        // Best-effort mirror after successful episode mutations. Never fail the primary operation if Sheets is offline.
        if (bridge && bridge.enabled && req.method !== 'GET' && p.id && !url.pathname.startsWith('/api/sheets/')) {
          try {
            const snapshot = S.store.episodes.get(p.id);
            bg(bridge.push(snapshot), 'sheets mirror ' + p.id);
          } catch (_) { /* Non-episode IDs (e.g. characters) are not mirrored. */ }
        }
        if (isMedia) return sendFile(req, res, out.file, { download: out.download });
        if (out && out.status && out.data !== undefined) return sendJson(res, out.status, out.data);
        return sendJson(res, 200, out);
      }
      // static files
      let rel = url.pathname === '/' ? '/index.html' : url.pathname;
      const file = path.normalize(path.join(PUBLIC_DIR, rel));
      if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { error: { code: 'PATH', message: '잘못된 경로입니다.' } });
      if (!fs.existsSync(file)) return sendFile(req, res, path.join(PUBLIC_DIR, 'index.html'));
      return sendFile(req, res, file);
    } catch (e) {
      const known = e instanceof StudioError;
      const prov = e instanceof ProviderError;
      const status = known ? e.status : prov ? 502 : 500;
      if (!known && !prov) log('internal error: ' + (e && e.stack));
      return sendJson(res, status, scrubSecrets({ error: { code: e.code || 'ERROR', message: known || prov ? e.message : '서버 오류가 발생했습니다: ' + e.message, recovery: e.recovery || '', details: e.details } }));
    }
  }

  return http.createServer(handle);
}

function start(cfg = loadConfig(), opts = {}) {
  if (cfg.production) {
    const missing = [];
    if (!cfg.masterKey) missing.push('RF_MASTER_KEY');
    if (!cfg.adminPassword) missing.push('RF_ADMIN_PASSWORD');
    if (missing.length) throw new Error('운영 환경(RF_ENV=production)에는 ' + missing.join(', ') + ' 가 필요합니다. docs/DEPLOYMENT.md 를 참고하세요.');
    if (cfg.adminPassword.length < 12) throw new Error('RF_ADMIN_PASSWORD는 12자 이상이어야 합니다.');
  }
  const auth = createAuth({ password: cfg.adminPassword, secret: cfg.masterKey });
  const studio = opts.studio || createStudio({ cfg, log: (m) => console.log('[studio] ' + m) });
  const bridge = createSheetsBridge({ url: cfg.sheetsBridgeUrl, token: cfg.sheetsBridgeToken, log: (m) => console.log('[sheets] ' + m) });
  const server = createApp(studio, { token: cfg.studioToken, port: cfg.studioPort, host: cfg.studioHost, bridge, auth, publicHost: cfg.publicHost, log: (m) => console.log('[studio] ' + m) });
  return new Promise((resolve) => {
    server.listen(cfg.studioPort, cfg.studioHost, () => resolve({ server, studio, url: `http://${cfg.studioHost}:${server.address().port}` }));
  });
}

if (require.main === module) {
  const cfg = loadConfig();
  start(cfg).then(({ url, studio }) => {
    const st = studio.providerStatus();
    console.log(`Reels Factory Studio  ${url}`);
    console.log(`  영상 생성: ${st.video.mode.toUpperCase()}${st.video.mode === 'mock' ? ' (요금 없음)' : ' (실제 유료 호출 가능 — 모든 호출은 화면에서 승인해야 실행됩니다)'}`);
    console.log(`  Muapi 키: ${st.video.keyConfigured ? '설정됨' : '없음'} · 음성: ${st.voice.mode.toUpperCase()} · HeyGen 키: ${st.voice.keyConfigured ? '설정됨' : '없음'}`);
    console.log(`  데이터 폴더: ${cfg.studioDir}`);
  });
}

module.exports = { createApp, createAuth, start };
