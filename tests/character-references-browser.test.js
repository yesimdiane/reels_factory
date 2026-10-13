'use strict';
// Real-browser check: the Storyboard shows each scene's saved Character Library thumbnails (actual images, asset ids, status),
// opens the full image and changes the reference for one scene. Skipped when Playwright is not installed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, readyProduct, png } = require('./helpers/v23');
const { createApp } = require('../studio/server');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = !pw ? 'playwright not installed' : false;

test('storyboard: character reference section shows real thumbnails and lets the operator change one scene\'s reference', { skip, timeout: 120000 }, async () => {
  const m = make();
  const pid = await readyProduct(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'drama', maxDurationSec: 60 });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, {});
  const add = (cid, seed, label) => { m.s.store.characters.addReference(cid, { buffer: png(seed), filename: `${cid}${seed}.png`, mime: 'image/png', label }); const r = m.s.store.characters.get(cid).references.slice(-1)[0]; m.s.store.characters.setReferenceApproved(cid, r.id, true); return r; };
  const j1 = add('jack', 111, 'front'); const j2 = add('jack', 112, 'side'); add('diane', 113, 'front');
  const sid = m.s.store.episodes.get(id).scenes.find((s) => (s.characters || []).includes('jack')).id;
  const app = createApp(m.s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  let browser;
  try { browser = await pw.chromium.launch({}); } catch (e) { app.close(); throw e; }
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1100 } })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${app.address().port}/#/storyboard/${id}`);
    const box = `[data-char-refs="${sid}"]`;
    await page.waitForSelector(box);
    const jack = page.locator(`${box} [data-char-ref="jack"]`);
    assert.match(await jack.innerText(), new RegExp(`jack:${j1.id}`));
    assert.match(await jack.innerText(), /승인됨/);
    const src = await jack.locator('img').getAttribute('src');
    assert.equal(src, `/media/ref/jack/${j1.id}`, 'thumbnail is the saved Character Library image');
    const got = await page.evaluate(async (u) => { const r = await fetch(u); return { ok: r.ok, n: (await r.arrayBuffer()).byteLength }; }, src);
    assert.ok(got.ok && got.n === m.s.store.characters.get('jack').references.find((r) => r.id === j1.id).size, 'the served bytes are the stored file');
    await jack.locator('[data-ref-view]').click();
    await page.waitForSelector('img[alt$="참조 이미지 원본"]');
    await page.getByRole('button', { name: /닫기/ }).first().click();
    await jack.locator('[data-ref-change]').click();
    await page.locator(`[data-ref-option="jack:${j2.id}"]`).click();
    await page.waitForFunction(([b, a]) => { const el = document.querySelector(b); return el && el.innerText.includes(a); }, [box, `jack:${j2.id}`]);
    assert.equal(m.s.store.episodes.get(id).sceneRefs[sid].jack, j2.id);
    await page.reload();
    await page.waitForSelector(box);
    assert.match(await page.locator(`${box} [data-char-ref="jack"]`).innerText(), new RegExp(`jack:${j2.id}`), 'survives refresh');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
