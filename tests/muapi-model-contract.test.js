'use strict';
// MuAPI model contract: per-model request shape, endpoint validation against the trusted base, verification gate, no network on registration.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mc = require('../studio/lib/modelcontract');
const { createMuapiProvider } = require('../studio/lib/providers/muapi');
const { loadConfig } = require('../renderer/lib/config');
const { createStudio } = require('../studio/lib/studio');

const make = () => { const cfg = loadConfig({ RF_STUDIO_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rf-mc-')) }, { dotenvFile: '/nonexistent' }); return { cfg, s: createStudio({ cfg }) }; };

test('endpoint validation: only a relative path under the trusted base', () => {
  assert.equal(mc.validateEndpoint('seedance-pro-i2v-fast'), 'seedance-pro-i2v-fast');
  assert.equal(mc.validateEndpoint('/api/v1/kling-master'), 'kling-master');
  for (const bad of ['https://evil.example/x', 'http://x', '//evil.example/x', 'a/../b', 'a//b', 'x?y=1', 'x#f', 'a b', '', 'javascript:alert(1)', 'a\\b']) assert.equal(mc.validateEndpoint(bad), null, bad);
});

test('each model declares its own request fields; nothing is assumed identical', () => {
  const a = mc.buildBody({ endpoint: 'a' }, { prompt: 'P', imageUrl: 'U', aspectRatio: '9:16', duration: 5, negativePrompt: 'N' });
  assert.deepEqual(a, { prompt: 'P', image_url: 'U', aspect_ratio: '9:16', duration: 5, negative_prompt: 'N' });
  const b = mc.buildBody({ endpoint: 'b', promptField: 'text', imageField: 'start_image', durationField: 'length', aspectField: 'ratio', negativeField: 'neg', extraParams: { mode: 'std' } }, { prompt: 'P', imageUrl: 'U', aspectRatio: '9:16', duration: 8, negativePrompt: 'N' });
  assert.deepEqual(b, { mode: 'std', text: 'P', start_image: 'U', ratio: '9:16', length: 8, neg: 'N' });
  assert.throws(() => mc.cleanExtra({ nested: { a: 1 } }));
  assert.throws(() => mc.cleanExtra('[1]'));
});

test('adapter posts to the registered endpoint with that model\'s field names, and refuses a foreign endpoint', async () => {
  const calls = [];
  const fetchFn = async (url, init) => { calls.push({ url, body: init.body ? JSON.parse(init.body) : null }); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ request_id: 'r1', status: 'queued' }), text: async () => '{"request_id":"r1","status":"queued"}' }; };
  const p = createMuapiProvider({ apiKey: 'k', fetchFn });
  const model = { endpoint: 'my-i2v', promptField: 'text', imageField: 'first_frame', durationField: 'seconds' };
  const r = await p.submit({ model, prompt: 'hi', imageUrl: 'https://x/i.png', duration: 6 });
  assert.equal(r.requestId, 'r1');
  assert.match(calls[0].url, /^https:\/\/api\.muapi\.ai\/api\/v1\/my-i2v$/);
  assert.equal(calls[0].body.text, 'hi'); assert.equal(calls[0].body.first_frame, 'https://x/i.png'); assert.equal(calls[0].body.seconds, 6);
  const n = calls.length;
  await assert.rejects(p.submit({ model: { endpoint: 'https://evil.example/x' }, prompt: 'p', imageUrl: 'u' }), (e) => e.code === 'BAD_REQUEST');
  await assert.rejects(p.submit({ model: { endpoint: '../x' }, prompt: 'p', imageUrl: 'u' }), (e) => e.code === 'BAD_REQUEST');
  assert.equal(calls.length, n, 'no request left the app');
});

test('registration is free (no network), unconfirmed models stay "unverified" and block LIVE generation; confirming lifts to user-entered; seed kling-master is not trusted', () => {
  const { s } = make();
  const seed = s.store.models().find((m) => m.id === 'kling-master');
  assert.equal(seed.verification, 'unverified');
  s.addCustomModel({ id: 'x-model', endpoint: 'x-model', durations: [5], promptField: 'text', extraParams: { mode: 'std' }, costEstimateUsd: 0.4 });
  let m = s.store.models().find((x) => x.id === 'x-model');
  assert.equal(m.verification, 'unverified'); assert.equal(m.promptField, 'text'); assert.deepEqual(m.extraParams, { mode: 'std' }); assert.equal(m.costEstimateUsd, 0.4);
  assert.throws(() => s.addCustomModel({ id: 'bad1', endpoint: 'https://evil.example/x', durations: [5] }), (e) => e.code === 'BAD_MODEL');
  assert.throws(() => s.addCustomModel({ id: 'bad2', endpoint: 'ok', durations: [5], promptField: 'a b' }), (e) => e.code === 'BAD_MODEL');
  assert.throws(() => s.addCustomModel({ id: 'bad3', endpoint: 'ok', durations: [5], extraParams: '{"a":{"b":1}}' }), (e) => e.code === 'BAD_MODEL');
  s.confirmModel('x-model');
  m = s.store.models().find((x) => x.id === 'x-model');
  assert.equal(m.verification, 'user-entered');
  s.confirmModel('kling-master');
  assert.equal(s.store.models().find((x) => x.id === 'kling-master').verification, 'user-entered');
  assert.throws(() => s.confirmModel('nope'), (e) => e.code === 'NOT_FOUND');
  assert.throws(() => s.gen.estimate('EP01', { modelId: 'does-not-exist' }), (e) => e.code === 'MODEL', 'an unknown model is an error, never a silent fallback');
});
