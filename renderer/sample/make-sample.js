#!/usr/bin/env node
// Builds a PRD-001 sample: runs the real Apps Script approval flow against in-memory Sheets
// (fixture script, no Gemini call), issues a signed render job, then renders a PREVIEW reel with
// the free local voice and placeholder visuals. Costs $0 and needs no Google account.
//   node renderer/sample/make-sample.js [outDir]
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createEnv, prd001Row } = require('../../tests/helpers/apps-script-mock');
const { createTtsService } = require('../lib/tts');
const { createLocalTts } = require('../lib/tts/local');
const { createLocalStorage } = require('../lib/storage/local');
const { loadConfig } = require('../lib/config');
const { render } = require('../lib/render');

async function main() {
  const outDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'output'));
  const plain = (v) => JSON.parse(JSON.stringify(v));

  // 1. Sheet-side flow (same bundle you paste into Apps Script).
  const env = createEnv({ gemini: () => plain(env.gs('FIXTURE_PRD_001_GEMINI_RESPONSE')) });
  env.sheets.PRODUCTS.rows.push(prd001Row(env.gs, { permission: '자체 제작', affiliateUrl: 'https://link.coupang.com/a/sample' }));
  env.gs('setupSheets()');
  const call = (fn, ...a) => plain(env.gs(fn).apply(null, a));
  const must = (r) => { if (!r.ok) throw new Error(r.error); return r; };
  must(call('apiGenerateScripts', 'PRD-001'));
  const d = must(call('apiGetReel', 'PRD-001-R01')).detail;
  must(call('apiAction', 'PRD-001-R01', 'APPROVE_SCRIPT', { expectedStatus: d.summary.status, expectedScriptVersion: 1, expectedVideoVersion: 0 }));
  must(call('apiAction', 'PRD-001-R01', 'START_VIDEO', { expectedStatus: 'SCRIPT_APPROVED', expectedScriptVersion: 1, expectedVideoVersion: 0 }));
  const jobRes = must(call('apiGetRenderJob', 'PRD-001-R01'));
  fs.mkdirSync(outDir, { recursive: true });
  const jobPath = path.join(outDir, jobRes.fileName);
  fs.writeFileSync(jobPath, jobRes.jobFile);
  console.log('✓ 서명된 렌더 작업: ' + jobPath);

  // 2. Renderer (preview: free local voice + placeholder visuals, watermarked).
  const cfg = loadConfig();
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-sample-'));
  const manifest = await render({
    jobFile: JSON.parse(jobRes.jobFile),
    secret: env.props.RF_RENDER_SECRET,
    tts: createTtsService({ provider: createLocalTts(), voice: 'local', speakingRate: 1.0, cacheDir: path.join(state, 'cache'), ledgerFile: path.join(state, 'usage.json') }),
    storage: createLocalStorage({ outputDir: outDir }),
    clipsDir: path.join(state, 'no-clips'),
    preview: true,
    ffmpeg: cfg.ffmpeg,
    font: cfg.font,
    fontsDir: cfg.fontsDir,
    log: (m) => console.log(m),
  });
  console.log(JSON.stringify({ output: manifest.output.path, duration: manifest.output.duration, timeline: manifest.timeline }, null, 2));
}

main().catch((e) => {
  console.error('✗ ' + e.message);
  process.exit(1);
});
