'use strict';
// Animation Studio gates (all mocked, nothing billable): SFX decision, lip-sync acknowledgement, readiness checklist,
// per-character voice settings, MuAPI TTS (live path guarded + no paid call before confirmation).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { approveWithScenes } = require('./helpers/approve');
const { png } = require('./helpers/v23');
const { loadConfig } = require('../renderer/lib/config');
const { createStudio } = require('../studio/lib/studio');
const { createMockVideoProvider } = require('../studio/lib/providers/mock');

const cfgFor = (extra = {}) => loadConfig(Object.assign({ RF_STUDIO_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rf-gate-')), RF_FONT_NAME: 'Noto Sans CJK KR', RF_ALLOW_FONT_FALLBACK: '1' }, extra), { dotenvFile: '/nonexistent' });
const ID = 'EP01';
async function ready(s) {
  await approveWithScenes(s, ID);
  await s.rebuildPrompts(ID);
  ['jack', 'diane'].forEach((cid, i) => { s.store.characters.addReference(cid, { buffer: png(30 + i), filename: cid + '.png', mime: 'image/png' }); const r = s.store.characters.get(cid).references.slice(-1)[0]; s.store.characters.update(cid, (c) => { c.references.find((x) => x.id === r.id).approved = true; }); });
  const ids = s.store.episodes.get(ID).scenes.map((x) => x.id);
  for (const [i, sid] of ids.entries()) { await s.uploadStartFrame(ID, sid, png(60 + i), sid + '.png'); await s.approveStartFrame(ID, sid, true); }
  await s.approveStoryboard(ID);
  const est = s.voice.estimate(ID); await s.voice.synthesize(ID, { confirmChars: est.billableChars });
  const ep = s.store.episodes.get(ID);
  for (const sc of ep.scenes) if (s.sceneFlow.audioState(ep, sc.id).state === 'unapproved') await s.sceneFlow.approveAudio(ID, sc.id);
  return ids;
}
const codes = (s, sid) => s.gen.estimate(ID, { sceneIds: [sid] }).blockers.map((b) => b.code);
const mk = () => { const cfg = cfgFor(); return createStudio({ cfg, provider: createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg }) }); };

test('SFX must be decided (plan approved or explicitly "none") before generation; changes make the decision stale', async () => {
  const s = mk();
  const ids = await ready(s);
  const sid = ids.find((id) => !(s.store.episodes.get(ID).lines.some((l) => l.sceneId === id))) || ids[0];
  assert.ok(codes(s, sid).includes('SFX_NOT_DECIDED'), 'undecided blocks');
  await assert.rejects(s.animGate.decideSfx(ID, sid, 'plan'), (e) => e.code === 'NO_SFX', 'nothing to approve');
  await s.animGate.decideSfx(ID, sid, 'none');
  assert.ok(!codes(s, sid).includes('SFX_NOT_DECIDED'));
  assert.equal(s.animGate.sfxState(s.store.episodes.get(ID), sid).state, 'none');
  await s.sfx.addBuiltin(ID, { name: 'pop', sceneId: sid, offsetSec: 0.5 });
  assert.equal(s.animGate.sfxState(s.store.episodes.get(ID), sid).state, 'stale', 'adding an effect after "none" invalidates it');
  assert.ok(codes(s, sid).includes('SFX_NOT_DECIDED'));
  await assert.rejects(s.animGate.decideSfx(ID, sid, 'none'), (e) => e.code === 'SFX_PRESENT');
  await s.animGate.decideSfx(ID, sid, 'plan');
  assert.equal(s.animGate.sfxState(s.store.episodes.get(ID), sid).state, 'approved');
  const fx = s.store.episodes.get(ID).sfx.find((x) => x.sceneId === sid);
  await s.sfx.update(ID, fx.id, { offsetSec: 0.8 });
  assert.equal(s.animGate.sfxState(s.store.episodes.get(ID), sid).state, 'stale', 'retiming an approved plan invalidates it');
  await s.animGate.revokeSfx(ID, sid);
  assert.equal(s.animGate.sfxState(s.store.episodes.get(ID), sid).state, 'undecided');
});

test('lip-sync: a dialogue scene needs the mix-only acknowledgement unless the model declares audio lip sync; silent scenes need nothing', async () => {
  const s = mk();
  const ids = await ready(s);
  const ep = s.store.episodes.get(ID);
  const talk = ids.find((id) => ep.lines.some((l) => l.sceneId === id));
  assert.ok(talk, 'fixture has a dialogue scene');
  await s.animGate.decideSfx(ID, talk, 'none');
  assert.ok(codes(s, talk).includes('LIPSYNC_NOT_CHOSEN'));
  await s.animGate.acknowledgeMixOnly(ID, talk);
  assert.ok(!codes(s, talk).includes('LIPSYNC_NOT_CHOSEN'));
  assert.equal(s.animGate.lipState(s.store.episodes.get(ID), talk, {}).state, 'mix-only');
  assert.equal(s.animGate.lipState(s.store.episodes.get(ID), talk, { lipSync: true, audioField: 'audio_url' }).state, 'model');
  const quiet = ids.find((id) => !ep.lines.some((l) => l.sceneId === id));
  if (quiet) { assert.equal(s.animGate.lipState(s.store.episodes.get(ID), quiet, {}).state, 'na'); await assert.rejects(s.animGate.acknowledgeMixOnly(ID, quiet), (e) => e.code === 'NO_DIALOGUE'); }
});

test('readiness checklist lists every requirement and goes fully green only when all gates pass; authorize is refused until then and no job is created', async () => {
  const s = mk();
  const ids = await ready(s);
  const sid = ids[0];
  const view = () => s.episodeView(ID).sceneFlow.scenes[sid].gate;
  let g = view();
  assert.deepEqual(g.items.map((i) => i.key), ['image', 'audio', 'sfx', 'lipsync', 'prompt', 'model', 'endpoint', 'cost']);
  assert.equal(g.ready, false);
  const failing = g.items.filter((i) => !i.ok).map((i) => i.key);
  assert.ok(failing.includes('sfx'));
  const est = s.gen.estimate(ID, { sceneIds: [sid] });
  await assert.rejects(Promise.resolve().then(() => s.gen.authorize(ID, { sceneIds: [sid], confirmUsd: est.totalUsd, confirmUnknown: false })), (e) => /SFX|효과음|BLOCK/i.test(e.code + e.message));
  assert.equal((s.store.episodes.get(ID).generation.jobs || []).length, 0, 'no job was created');
  await s.animGate.decideSfx(ID, sid, 'none');
  if (s.store.episodes.get(ID).lines.some((l) => l.sceneId === sid)) await s.animGate.acknowledgeMixOnly(ID, sid);
  g = view();
  assert.equal(g.ready, true, JSON.stringify(g.items.filter((i) => !i.ok)));
});

test('per-character voice settings persist (provider, MuAPI voice_id, rate, style, emotion) and are reused by every episode', async () => {
  const s = mk();
  s.updateCharacter('jack', { voice: { provider: 'muapi', muapiVoiceId: 'v_abc', speed: 1.1, style: 'warm', emotion: 'curious' } });
  const c = s.store.characters.get('jack');
  assert.deepEqual([c.voice.provider, c.voice.muapiVoiceId, c.voice.speed, c.voice.style, c.voice.emotion], ['muapi', 'v_abc', 1.1, 'warm', 'curious']);
  assert.equal(s.characterView(c).voiceInfo.provider, 'muapi');
  assert.equal(s.characterView(c).voiceInfo.state, 'unverified', 'TTS endpoint not confirmed yet');
  s.confirmMuapiTts(true);
  assert.equal(s.characterView(s.store.characters.get('jack')).voiceInfo.ready, true);
  assert.equal(s.store.characters.get('diane').voice.provider, 'heygen', 'other characters keep their own voice');
});

test('MuAPI TTS live path: blocked until the endpoint is confirmed and a voice_id exists; nothing is sent before the operator confirms the character count', async () => {
  const cfg = cfgFor({ MUAPI_API_KEY: 'test-key' });
  const calls = [];
  const fetchFn = async (url, init) => { calls.push({ url: String(url), method: (init && init.method) || 'GET', body: init && init.body ? JSON.parse(init.body) : null }); return { ok: false, status: 500, json: async () => ({}) }; };
  const s = createStudio({ cfg, fetchFn, provider: createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg }) });
  await approveWithScenes(s, ID);
  s.store.settings.save({ providers: Object.assign({}, s.store.settings.get().providers, { muapi: { mode: 'live' } }) });
  s.updateCharacter('jack', { voice: { provider: 'muapi', muapiVoiceId: '' } });
  let est = s.voice.estimate(ID);
  assert.ok(est.blockers.some((b) => b.code === 'TTS_UNVERIFIED'));
  assert.ok(est.blockers.some((b) => b.code === 'NO_VOICE_ID'));
  await assert.rejects(s.voice.synthesize(ID, { confirmChars: est.billableChars }), (e) => e.code === 'BLOCKED');
  s.confirmMuapiTts(true);
  s.updateCharacter('jack', { voice: { muapiVoiceId: 'v_abc' } });
  est = s.voice.estimate(ID);
  assert.ok(!est.blockers.some((b) => ['TTS_UNVERIFIED', 'NO_VOICE_ID'].includes(b.code)), JSON.stringify(est.blockers));
  assert.ok(est.billableChars > 0, 'a live MuAPI voice is billable');
  await assert.rejects(s.voice.synthesize(ID, { confirmChars: est.billableChars + 1 }), (e) => e.code === 'CONFIRM_MISMATCH');
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0, 'no paid POST before an exact confirmation');
});
