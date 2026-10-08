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
  assert.ok(consts.includes('RF_CONFIG') && consts.includes('RF_DASHBOARD_HTML'));
  for (const c of consts) assert.match(c, /^(RF_|FIXTURE_)/, 'top-level const must be prefixed: ' + c);
  assert.equal(new Set(consts).size, consts.length, 'duplicate top-level const');
  const fns = [...src.matchAll(/^function (\w+)/gm)].map((m) => m[1]);
  assert.equal(new Set(fns).size, fns.length, 'duplicate function names in bundle');
});

// Any page served by HtmlService can call ANY public (no trailing underscore) server function via
// google.script.run, so public functions that write data or spend API quota must be guarded:
// api* functions go through api_() (reviewer check); menu functions call SpreadsheetApp.getUi() first,
// which throws outside the spreadsheet UI.
test('public server functions that write or spend quota are guarded', () => {
  const src = fs.readFileSync(OUT, 'utf8');
  const fns = {};
  const re = /^function (\w+)\([^)]*\) \{\n([\s\S]*?)\n\}/gm;
  let m;
  while ((m = re.exec(src))) fns[m[1]] = m[2];
  const sensitive = /UrlFetchApp|callGemini_\(|setProperty\(|updateRecord_\(|appendRecords_\(|appendAudit_\(|generateScriptsForProduct_\(|generateValidatedRecords_\(|applyTransition_\(|appendMissingHeaders_\(|ensureSheet_\(/;
  const exposed = Object.keys(fns).filter((n) => !n.endsWith('_') && sensitive.test(fns[n]));
  for (const n of exposed) {
    const body = fns[n];
    if (/^api[A-Z]/.test(n)) {
      assert.match(body, /^\s*return api_\(function/, n + ' must be wrapped in api_()');
    } else {
      const firstStatement = body.trim().split('\n')[0];
      assert.match(firstStatement, /SpreadsheetApp\.getUi\(\)/, n + ' must call getUi() before anything else');
    }
  }
  assert.ok(!('callGemini' in fns), 'callGemini must stay private');
  assert.ok(exposed.length >= 5, 'sanity: found ' + exposed.join(', '));
});
