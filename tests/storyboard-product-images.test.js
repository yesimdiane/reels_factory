'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { make, png } = require('./helpers/v23');

test('existing storyboard resolves current Product Studio uploads without a reference snapshot', async (t) => {
  const { s } = make();
  t.after(() => fs.rmSync(s.store.dir, { recursive: true, force: true }));
  const p = await s.products.create({ name: '우산꽂이' });
  await s.products.upload(p.id, png(10), 'umbrella.png');
  const image = s.products.get(p.id).images[0];
  const ep = s.store.episodes.list()[0];
  await s.store.episodes.update(ep.id, (e) => {
    e.productId = p.id;
    delete e.productRefs;
    e.scenes[0].showsProduct = true;
  });
  const before = s.store.episodes.get(ep.id);
  const view = s.episodeView(ep.id);
  assert.equal(view.productStudioImages[0].url, `/media/product/${p.id}/${image.id}`);
  assert.equal(view.scenes[0].productImages[0].status, 'pending');
  assert.deepEqual(view.productRefImages, [], 'preview does not approve the upload');
  assert.deepEqual(s.store.episodes.get(ep.id), before, 'reading the storyboard does not rewrite user data');
  const off = await s.saveScript(ep.id, { scenes: before.scenes.map((sc, i) => i ? { id: sc.id } : { id: sc.id, showsProduct: false }) });
  assert.deepEqual(off.scenes[0].productImages, []);
  assert.equal(off.productStudioImages.length, 1);
  assert.deepEqual(off.scenes[0].startImage, before.scenes[0].startImage);
});

test('storyboard follows replacement uploads and excludes rejected images and other products', async (t) => {
  const { s } = make();
  t.after(() => fs.rmSync(s.store.dir, { recursive: true, force: true }));
  const p = await s.products.create({ name: '제품 A' });
  await s.products.upload(p.id, png(11), 'old.png');
  const old = s.products.get(p.id).images[0];
  await s.products.replace(p.id, old.id, png(12), 'new.png');
  await s.products.upload(p.id, png(13), 'rejected.png');
  const images = s.products.get(p.id).images;
  await s.products.setStatus(p.id, images.find((im) => im.label === 'rejected').id, 'rejected');
  const other = await s.products.create({ name: '제품 B' });
  await s.products.upload(other.id, png(14), 'other.png');
  const ep = s.store.episodes.list()[0];
  await s.store.episodes.update(ep.id, (e) => { e.productId = p.id; e.scenes[0].showsProduct = true; });
  const view = s.episodeView(ep.id);
  assert.equal(view.scenes[0].productImages.length, 1);
  assert.equal(view.scenes[0].productImages[0].id, images.find((im) => im.id !== old.id && im.status !== 'replaced' && im.label !== 'rejected').id);
  await s.store.episodes.update(ep.id, (e) => { e.productId = 'PRD-missing'; });
  assert.deepEqual(s.episodeView(ep.id).scenes[0].productImages, []);
});

test('product checkbox immediately previews images, saves visibility and rolls back failed saves', async () => {
  const nodes = [];
  const h = (tag, attrs, ...children) => {
    const node = { tag, attrs: attrs || {}, children: children.flat(Infinity).filter(Boolean), append(...xs) { this.children.push(...xs); }, replaceChildren(...xs) { this.children = xs; } };
    nodes.push(node);
    return node;
  };
  const ep = { id: 'E1', productId: 'P1', productStudioImages: [{ id: 'im1', url: '/media/product/P1/im1', status: 'pending' }], lines: [], derived: {}, scenes: [] };
  const sc = { id: 'S1', characters: [], visual: '', showsProduct: false, clips: {}, promptWarnings: [] };
  ep.scenes = [sc];
  const state = { draft: {}, summary: { characters: [] } };
  const calls = [];
  let fail = false;
  const context = { h, state, translateControl: () => ({ btn: null, panel: null }), chip: () => null, icon: () => null, api: { put: async (url, body) => { calls.push({ url, body }); if (fail) throw Error('failed'); sc.showsProduct = body.scenes[0].showsProduct; return ep; } }, act: async (fn) => { try { return await fn(); } catch { return null; } } };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '../studio/public/js/views/storyboard.js'), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  vm.runInContext(source, context);
  context.sceneCard(ep, sc, 0, []);
  const checkbox = nodes.find((n) => n.attrs['aria-label'] === '제품이 보임');
  const panel = nodes.find((n) => n.tag === 'div' && n.attrs.class === 'stack' && n.attrs.style === 'gap:8px');
  const input = { checked: true };
  await checkbox.attrs.onchange({ target: input });
  assert.ok(JSON.stringify(panel).includes('/media/product/P1/im1'));
  assert.equal(calls[0].url, '/api/episodes/E1/script');
  assert.equal(calls[0].body.scenes[0].showsProduct, true);
  assert.equal(sc.showsProduct, true);
  assert.equal(input.disabled, false);
  fail = true;
  input.checked = false;
  await checkbox.attrs.onchange({ target: input });
  assert.equal(input.checked, true);
  assert.equal(state.draft['sb:S1'].showsProduct, true);
  assert.ok(JSON.stringify(panel).includes('/media/product/P1/im1'));
});
