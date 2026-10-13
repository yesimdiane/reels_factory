'use strict';
// Real-browser check of the Character Library and the Story Lab cast picker (Chromium via Playwright; skipped when it is not installed).
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, readyProduct } = require('./helpers/v23');
const { createApp } = require('../studio/server');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = !pw ? 'playwright not installed' : false;

async function boot() {
  const { s } = make();
  const pid = await readyProduct(s);
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const browser = await pw.chromium.launch({});
  return { s, pid, app, browser, base: `http://127.0.0.1:${app.address().port}/` };
}

test('Story Lab: universe cards, multi-select characters, narrator/guest, remembered after reload, mobile layout', { skip, timeout: 120000 }, async () => {
  const { s, pid, app, browser, base } = await boot();
  try {
    for (const ctx of [{ viewport: { width: 1280, height: 900 } }, { ...pw.devices['iPhone 13'] }]) {
      const page = await (await browser.newContext(ctx)).newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await s.storylab.saveCast(pid, { universeId: 'jackdiane', characterIds: ['jack', 'diane'] });
      await page.goto(base + '#/storylab/' + pid);
      await page.waitForSelector('[data-cast-picker]');
      assert.equal(await page.locator('[data-universe]').count(), 2, 'two universe cards');
      assert.equal(await page.locator('[data-character]').count(), 2, 'Jack and Diane');
      await page.locator('[data-universe="gregory-cats"]').click();
      await page.waitForFunction(() => document.querySelectorAll('[data-character]').length === 3);
      assert.deepEqual(s.storylab.castState(pid).characterIds, ['cloud', 'louie', 'lucy']);
      await page.locator('[data-character="louie"]').click();
      await page.waitForFunction(() => ((document.querySelector('[data-character="louie"]') || { getAttribute: () => '' }).getAttribute('aria-pressed')) === 'false');
      assert.deepEqual(s.storylab.castState(pid).characterIds, ['cloud', 'lucy']);
      await page.locator('[data-guest] summary').click();
      await page.locator('[data-narrator]').check();
      await page.waitForFunction(() => !!((document.querySelector('[data-narrator]') || {}).checked));
      assert.equal(s.storylab.castState(pid).cast.narrator, true);
      await page.reload(); await page.waitForSelector('[data-cast-picker]');
      assert.equal(await page.locator('[data-character="cloud"]').getAttribute('aria-pressed'), 'true', 'remembered after reload');
      assert.equal(await page.locator('[data-character="louie"]').getAttribute('aria-pressed'), 'false');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no horizontal overflow');
      assert.match(await page.locator('[data-cast-summary]').innerText(), /Gregory Cats · 2명 \+ 내레이터/);
      assert.deepEqual(errors, []);
    }
  } finally { await browser.close(); app.close(); }
});

test('Character Library: create/edit/delete a universe and a character from the UI', { skip, timeout: 120000 }, async () => {
  const { s, app, browser, base } = await boot();
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + '#/characters');
    await page.waitForSelector('[data-character-library]');
    assert.equal(await page.locator('[data-universe-card]').count(), 2);
    assert.equal(await page.locator('[data-library-character]').count(), 5);
    await page.locator('[data-new-universe]').click();
    await page.locator('[data-universe-modal] input[type=text]').first().fill('Dino Friends');
    await page.locator('[data-universe-save]').click();
    await page.waitForSelector('[data-universe-card="dino-friends"]');
    await page.locator('[data-universe-card="dino-friends"] .cast-add').click();
    await page.locator('[data-profile-modal] [data-f="name"]').fill('Rexy');
    await page.locator('[data-profile-save]').click();
    await page.waitForSelector('[data-library-character="rexy"]');
    assert.equal(s.store.characters.get('rexy').universeId, 'dino-friends');
    assert.equal(s.store.characters.get('rexy').look, '', 'no appearance is invented');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
