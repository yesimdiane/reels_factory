'use strict';
// Animation Studio gates in a real browser (mock providers, nothing billable): checklist, SFX decision, lip-sync acknowledgement,
// generate stays disabled until every item passes, character voice settings UI.
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
const { createApp } = require('../studio/server');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const cfg0 = () => loadConfig({ RF_STUDIO_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rf-gateb-')), RF_FONT_NAME: 'Noto Sans CJK KR', RF_ALLOW_FONT_FALLBACK: '1' }, { dotenvFile: '/nonexistent' });
const hasFfmpeg = (() => { try { return require('node:child_process').spawnSync(cfg0().ffmpeg.ffmpeg, ['-version']).status === 0; } catch { return false; } })();
const skip = !pw ? 'playwright not installed' : !hasFfmpeg ? 'ffmpeg not installed' : false;
const ID = 'EP01';

test('gates panel: checklist blocks generation until SFX and lip-sync are decided; decisions are explicit; nothing paid', { skip, timeout: 240000 }, async () => {
  const cfg = cfg0();
  const prov = createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg, pollsUntilDone: 1 });
  const s = createStudio({ cfg, provider: prov });
  await approveWithScenes(s, ID);
  await s.rebuildPrompts(ID);
  ['jack', 'diane'].forEach((cid, i) => { s.store.characters.addReference(cid, { buffer: png(500 + i), filename: cid + '.png', mime: 'image/png' }); const r = s.store.characters.get(cid).references.slice(-1)[0]; s.store.characters.update(cid, (c) => { c.references.find((x) => x.id === r.id).approved = true; }); });
  const ids = s.store.episodes.get(ID).scenes.map((x) => x.id);
  for (const [i, sid] of ids.entries()) { await s.uploadStartFrame(ID, sid, png(600 + i), sid + '.png'); await s.approveStartFrame(ID, sid, true); }
  await s.approveStoryboard(ID);
  const est = s.voice.estimate(ID); await s.voice.synthesize(ID, { confirmChars: est.billableChars });
  { const ep = s.store.episodes.get(ID); for (const sc of ep.scenes) if (s.sceneFlow.audioState(ep, sc.id).state === 'unapproved') await s.sceneFlow.approveAudio(ID, sc.id); }
  const talk = ids.find((id) => s.store.episodes.get(ID).lines.some((l) => l.sceneId === id));
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  let browser;
  try { browser = await pw.chromium.launch({}); } catch (e) { app.close(); throw e; }
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 2400 } })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${app.address().port}/#/animation/${ID}`);
    await page.waitForSelector('[data-animation-studio]');
    await page.locator(`[data-anim-scene="${talk}"]`).click();
    await page.waitForSelector(`[data-anim-gates="${talk}"]`);
    assert.equal(await page.locator(`[data-anim-gates="${talk}"]`).getAttribute('data-gates-ready'), '0');
    const keys = await page.locator('[data-gate-item]').evaluateAll((e) => e.map((x) => x.getAttribute('data-gate-item')));
    assert.deepEqual(keys, ['image', 'audio', 'sfx', 'lipsync', 'prompt', 'model', 'endpoint', 'cost']);
    assert.equal(await page.locator('[data-gate-item="sfx"]').getAttribute('data-gate-ok'), '0');
    assert.equal(await page.locator(`[data-anim-generate="${talk}"]`).isDisabled(), true, 'generate is blocked while the checklist is incomplete');
    // explicit "no SFX needed"
    await page.locator(`[data-sfx-none="${talk}"]`).click();
    await page.locator('[role=dialog]').getByRole('button', { name: /확인|예|네|진행/ }).last().click();
    await page.waitForSelector('[data-gate-item="sfx"][data-gate-ok="1"]');
    // lip-sync acknowledgement
    assert.equal(await page.locator('[data-gate-item="lipsync"]').getAttribute('data-gate-ok'), '0');
    await page.locator(`[data-lipsync-ack="${talk}"]`).click();
    await page.locator('[role=dialog]').getByRole('button', { name: /확인|예|네|진행/ }).last().click();
    await page.waitForSelector(`[data-anim-gates="${talk}"][data-gates-ready="1"]`);
    assert.equal(await page.locator(`[data-anim-generate="${talk}"]`).isDisabled(), false, 'unlocked only after every item is green');
    assert.equal(prov.calls.submit, 0, 'no paid call was made'); assert.equal(prov.calls.upload, 0);
    assert.deepEqual(errors, []);
    // the character library exposes per-character voice settings
    await page.goto(`http://127.0.0.1:${app.address().port}/#/settings/characters`);
    await page.waitForSelector('[data-voice-settings="jack"]');
    await page.locator('[data-voice-settings="jack"] [data-muapi-voice-id]').fill('v_demo');
    await page.locator('[data-voice-settings="jack"] [data-voice-emotion]').fill('curious');
    await page.locator('[data-voice-settings="jack"] [data-voice-settings-save]').click();
    await page.waitForFunction(() => true);
    await page.waitForTimeout(600);
    const v = s.store.characters.get('jack').voice;
    assert.equal(v.muapiVoiceId, 'v_demo'); assert.equal(v.emotion, 'curious');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
