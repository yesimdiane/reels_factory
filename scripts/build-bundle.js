#!/usr/bin/env node
// Concatenates apps-script/*.gs into dist/ReelsFactory.gs — one file a non-technical user can paste
// into Extensions → Apps Script. Run `npm run build` after editing anything in apps-script/.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'apps-script');
// Config first so its constants are defined before anything else is read at load time.
const ORDER = ['Config.gs', 'Validation.gs', 'Reels.gs', 'Prompt.gs', 'Gemini.gs', 'Sheets.gs', 'Fixtures.gs', 'Code.gs'];
const OUT = path.join(ROOT, 'dist', 'ReelsFactory.gs');

function build() {
  const present = fs.readdirSync(SRC).filter((f) => f.endsWith('.gs')).sort();
  const missing = present.filter((f) => !ORDER.includes(f));
  if (missing.length) throw new Error('Add to ORDER in scripts/build-bundle.js: ' + missing.join(', '));
  const header = [
    '/**',
    ' * Reels Factory — single-file Apps Script bundle. GENERATED FILE, do not edit by hand.',
    ' * Source: apps-script/*.gs. Rebuild with `npm run build`.',
    ' * Install: paste this whole file into Extensions → Apps Script (see docs/setup.md).',
    ' *',
    ' * @OnlyCurrentDoc  Limits spreadsheet access to this workbook when scopes are auto-detected.',
    ' */',
    '',
  ].join('\n');
  return header + ORDER.map((f) => '// ===== ' + f + ' =====\n' + fs.readFileSync(path.join(SRC, f), 'utf8').trimEnd() + '\n').join('\n');
}

module.exports = { build, OUT };

if (require.main === module) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, build());
  console.log('Wrote ' + path.relative(ROOT, OUT));
}
