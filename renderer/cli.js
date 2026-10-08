#!/usr/bin/env node
// Reels Factory renderer CLI.
//   node renderer/cli.js check                       # FFmpeg/font/config sanity — no API calls
//   node renderer/cli.js estimate --job <file>       # verify approval + cost estimate — no API calls
//   node renderer/cli.js render   --job <file> [--preview] [--force] [--tts google|local|silent]
//   node renderer/cli.js usage                       # TTS characters used this month
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { loadConfig } = require('./lib/config');
const { loadJobFile, GateError } = require('./lib/job');
const { createTtsService, BudgetError } = require('./lib/tts');
const { createGoogleTts, apiKeyAuth, metadataAuth, gcloudAuth } = require('./lib/tts/google');
const { createLocalTts } = require('./lib/tts/local');
const { createSilentTts } = require('./lib/tts/silent');
const { createLocalStorage } = require('./lib/storage/local');
const { checkFfmpeg } = require('./lib/ffmpeg');
const { render } = require('./lib/render');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}

function makeProvider(name, cfg) {
  if (name === 'local') return createLocalTts();
  if (name === 'silent') return createSilentTts();
  if (name !== 'google') throw new Error('알 수 없는 TTS 제공자: ' + name);
  const auth = cfg.ttsAuth === 'apiKey'
    ? apiKeyAuth(cfg.googleApiKey)
    : cfg.ttsAuth === 'metadata' ? metadataAuth() : gcloudAuth(cfg.gcpProject);
  if (cfg.ttsAuth === 'apiKey' && !cfg.googleApiKey) throw new Error('GOOGLE_TTS_API_KEY가 없습니다 (renderer/.env).');
  return createGoogleTts({ auth });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || 'help';
  const cfg = loadConfig();
  const log = (m) => console.log(m);

  if (cmd === 'check') {
    const ff = await checkFfmpeg(cfg.ffmpeg);
    log('✓ ' + ff.version);
    log('글꼴: ' + cfg.font + (cfg.fontsDir ? ' (' + cfg.fontsDir + ')' : ''));
    log('TTS: ' + cfg.ttsProvider + ' / ' + cfg.voice + ' / 인증 ' + cfg.ttsAuth + (cfg.googleApiKey ? ' (키 설정됨)' : ''));
    log('렌더 키: ' + (cfg.secret ? '설정됨' : '없음 — Sheets 메뉴 "렌더 키 보기"'));
    log('클립 폴더: ' + cfg.clipsDir + '\n출력 폴더: ' + cfg.outputDir + '\n캐시/사용량: ' + cfg.stateDir);
    return;
  }
  if (cmd === 'usage') {
    const f = cfg.ledgerFile;
    log(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '아직 사용량이 없습니다.');
    log('월 한도(RF_TTS_MONTHLY_CHAR_LIMIT): ' + cfg.monthlyCharLimit);
    return;
  }
  if (cmd !== 'render' && cmd !== 'estimate') {
    log('사용법: node renderer/cli.js check | estimate --job <file> | render --job <file> [--preview] [--force] [--tts google|local|silent] | usage');
    return;
  }
  if (!args.job) throw new Error('--job <렌더 작업 파일> 이 필요합니다.');

  const preview = !!args.preview;
  // Previews default to the free local voice; final renders use Google Cloud TTS.
  const providerName = args.tts || (preview ? 'local' : cfg.ttsProvider);
  const provider = makeProvider(providerName, cfg);
  const tts = createTtsService({
    provider,
    voice: providerName === 'google' ? cfg.voice : providerName,
    speakingRate: cfg.speakingRate,
    cacheDir: cfg.cacheDir,
    ledgerFile: cfg.ledgerFile,
    maxCharsPerJob: cfg.maxCharsPerJob,
    monthlyCharLimit: cfg.monthlyCharLimit,
  });
  const result = await render({
    jobFile: loadJobFile(path.resolve(args.job)),
    secret: cfg.secret,
    tts,
    storage: createLocalStorage({ outputDir: path.resolve(args.out || cfg.outputDir) }),
    clipsDir: path.resolve(args.clips || cfg.clipsDir),
    preview,
    dryRun: cmd === 'estimate' || !!args['dry-run'],
    force: !!args.force,
    ffmpeg: cfg.ffmpeg,
    font: cfg.font,
    fontsDir: cfg.fontsDir,
    crf: cfg.crf,
    preset: cfg.preset,
    log,
  });
  if (result.dryRun) {
    const e = result.estimate;
    log('(예상만 계산 — API 호출 없음)');
    log(`문장 ${e.segments}개 (캐시 ${e.cachedSegments}) · 과금 글자 ${e.billableChars} · ${e.voice} · 예상 $${e.estimatedUsd.toFixed(4)}`);
    log(`이번 달 사용 ${e.usedThisMonth} / 한도 ${e.monthlyCharLimit} 글자`);
    result.clips.forEach((c, i) => log(`장면 ${i + 1}: ${c.clip ? '✓ ' + c.clip : '✗ 없음 → ' + c.expected}`));
    return;
  }
  log(JSON.stringify({ output: result.output.path, duration: result.output.duration, tts: { billableChars: result.tts.billableChars, estimatedUsd: result.tts.estimatedUsd }, reused: !!result.reused }, null, 2));
}

main().catch((e) => {
  const kind = e instanceof GateError ? '승인 확인 실패 (비용 발생 없음)' : e instanceof BudgetError ? '예산 한도 (비용 발생 없음)' : '오류';
  console.error('✗ ' + kind + ': ' + e.message);
  process.exit(e instanceof GateError || e instanceof BudgetError ? 2 : 1);
});
