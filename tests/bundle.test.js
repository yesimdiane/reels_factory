// The committed single-file bundle must match the sources, and must load as one Apps Script file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { build, OUT } = require('../scripts/build-bundle.js');

test('dist/ReelsFactory.gs is up to date (run `npm run build`)', () => {
  assert.equal(fs.readFileSync(OUT, 'utf8'), build());
});

test('bundle parses and defines no clashing top-level constants twice', () => {
  const src = fs.readFileSync(OUT, 'utf8');
  assert.doesNotThrow(() => new vm.Script(src, { filename: 'ReelsFactory.gs' }));
  const consts = [...src.matchAll(/^const (\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(consts.sort(), ['FIXTURE_PRD_001_GEMINI_RESPONSE', 'FIXTURE_PRD_001_PRODUCT', 'RF_CONFIG', 'RF_GEMINI_RESPONSE_SCHEMA']);
  const fns = [...src.matchAll(/^function (\w+)/gm)].map((m) => m[1]);
  assert.equal(new Set(fns).size, fns.length, 'duplicate function names in bundle');
});
