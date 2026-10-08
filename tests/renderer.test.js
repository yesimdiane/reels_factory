// Renderer: approval gate, cost guards, TTS cache, Google TTS request, timing plan, ASS overlay,
// and (when FFmpeg is installed) a real low-resolution render.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createEnv, prd001Row } = require('./helpers/apps-script-mock');
const { verifyJob, sign, GateError } = require('../renderer/lib/job');
const { createTtsService, splitNarration, BudgetError, voiceFamily } = require('../renderer/lib/tts');
const { createGoogleTts, apiKeyAuth, ENDPOINT } = require('../renderer/lib/tts/google');
const { createSilentTts } = require('../renderer/lib/tts/silent');
const { parseWav, silentWav } = require('../renderer/lib/wav');
const { buildPlan, chunkSubtitle } = require('../renderer/lib/plan');
const { buildAss, esc } = require('../renderer/lib/ass');
const { createLocalStorage } = require('../renderer/lib/storage/local');
const { render } = require('../renderer/lib/render');

const plain = (v) => JSON.parse(JSON.stringify(v));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rf-test-'));

// Real server flow → signed job for PRD-001-R01 in VIDEO_IN_PRODUCTION.
function issueJob({ startVideo = true, permission = '자체 제작' } = {}) {
  const env = createEnv({ gemini: () => plain(env.gs('FIXTURE_PRD_001_GEMINI_RESPONSE')) });
  env.sheets.PRODUCTS.rows.push(prd001Row(env.gs, { permission, affiliateUrl: 'https://link.coupang.com/a/secret-link' }));
  env.gs('setupSheets()');
  const call = (fn, ...a) => plain(env.gs(fn).apply(null, a));
  call('apiGenerateScripts', 'PRD-001');
  call('apiAction', 'PRD-001-R01', 'APPROVE_SCRIPT', { expectedStatus: 'SCRIPT_REVIEW_PENDING', expectedScriptVersion: 1, expectedVideoVersion: 0 });
  if (startVideo) call('apiAction', 'PRD-001-R01', 'START_VIDEO', { expectedStatus: 'SCRIPT_APPROVED', expectedScriptVersion: 1, expectedVideoVersion: 0 });
  const res = call('apiGetRenderJob', 'PRD-001-R01');
  return { env, call, res, secret: env.props.RF_RENDER_SECRET, jobFile: res.ok ? JSON.parse(res.jobFile) : null };
}

// A provider that records calls and pretends to be paid.
function spyProvider() {
  const inner = createSilentTts();
  return { name: 'spy', paid: true, calls: inner.calls, synthesize: inner.synthesize };
}
function service(provider, dir, extra = {}) {
  return createTtsService(Object.assign({ provider, voice: 'ko-KR-Wavenet-A', speakingRate: 1, cacheDir: path.join(dir, 'cache'), ledgerFile: path.join(dir, 'usage.json') }, extra));
}

// ------------------------------------------------------------------ server side: issuing jobs

test('render jobs are issued only for approved reels in production, signed, without the affiliate link', () => {
  assert.match(issueJob({ startVideo: false }).res.error, /영상 제작 중/);
  const { res, env, secret } = issueJob();
  assert.equal(res.ok, true, res.error);
  assert.equal(res.fileName, 'PRD-001-R01_v1.render-job.json');
  const file = JSON.parse(res.jobFile);
  assert.equal(file.signature, sign(file.payload, secret), 'Apps Script and Node HMAC agree');
  assert.doesNotMatch(res.jobFile, /secret-link|test-key/);
  assert.ok(env.sheets.AUDIT.rows.some((r) => r[3] === 'RENDER_JOB_ISSUED'));
  env.state.email = 'intruder@example.com';
  assert.equal(plain(env.gs('apiGetRenderJob')('PRD-001-R01')).ok, false);
});

test('editing the approved script in the sheet stops new render jobs', () => {
  const { env, call } = issueJob();
  const i = env.sheets.REELS.rows.findIndex((r) => r[0] === 'PRD-001-R01');
  env.sheets.REELS.set(i + 1, '내레이션', '바뀐 내레이션');
  assert.match(call('apiGetRenderJob', 'PRD-001-R01').error, /승인된 대본과 현재 대본이 다릅니다/);
});

// ------------------------------------------------------------------ renderer gate (before any cost)

test('verifyJob accepts the server-issued job', () => {
  const { jobFile, secret } = issueJob();
  const job = verifyJob(jobFile, { secret });
  assert.equal(job.reelId, 'PRD-001-R01');
  assert.equal(job.status, 'VIDEO_IN_PRODUCTION');
});

test('verifyJob rejects missing secret, wrong secret, tampering, expiry, wrong status and fingerprint mismatch', () => {
  const { jobFile, secret } = issueJob();
  const p = JSON.parse(jobFile.payload);
  const resign = (mut) => {
    const q = JSON.parse(jobFile.payload);
    mut(q);
    const payload = JSON.stringify(q);
    return { payload, signature: sign(payload, secret) };
  };
  assert.throws(() => verifyJob(jobFile, { secret: '' }), GateError);
  assert.throws(() => verifyJob(jobFile, { secret: 'wrong' }), /서명이 맞지 않습니다/);
  const tampered = { payload: jobFile.payload.replace('현관', '거실'), signature: jobFile.signature };
  assert.throws(() => verifyJob(tampered, { secret }), /서명이 맞지 않습니다/);
  assert.throws(() => verifyJob(jobFile, { secret, now: new Date(Date.parse(p.expiresAt) + 1000) }), /만료/);
  assert.throws(() => verifyJob(resign((q) => (q.status = 'SCRIPT_REVIEW_PENDING')), { secret }), /영상 제작 중/);
  assert.throws(() => verifyJob(resign((q) => (q.script['내레이션'] += '!')), { secret }), /지문 불일치/);
  assert.throws(() => verifyJob(resign((q) => (q.permission = '미확인')), { secret }), /허가/);
  assert.throws(() => verifyJob({ hello: 1 }, { secret }), /형식/);
});

test('no TTS call happens when the gate, clips, FFmpeg or budget would stop the render', async () => {
  const { jobFile, secret } = issueJob();
  const dir = tmp();
  const provider = spyProvider();
  const base = {
    jobFile, secret, tts: service(provider, dir), storage: createLocalStorage({ outputDir: path.join(dir, 'out') }),
    clipsDir: path.join(dir, 'clips'), ffmpeg: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }, font: 'NanumGothic',
  };
  await assert.rejects(render(Object.assign({}, base, { secret: 'wrong' })), GateError);
  await assert.rejects(render(base), /Flow 클립이 없습니다/); // final render needs real clips
  await assert.rejects(render(Object.assign({}, base, { preview: true, ffmpeg: { ffmpeg: '/nonexistent/ffmpeg', ffprobe: '/nonexistent/ffprobe' } })), /FFmpeg/);
  const tight = Object.assign({}, base, { preview: true, tts: service(provider, dir, { maxCharsPerJob: 10 }) });
  if (hasFfmpeg) await assert.rejects(render(tight), BudgetError);
  const dry = await render(Object.assign({}, base, { dryRun: true }));
  assert.equal(dry.dryRun, true);
  assert.ok(dry.estimate.billableChars > 50);
  assert.equal(provider.calls.length, 0, 'nothing was synthesized');
});

// ------------------------------------------------------------------ TTS service

test('TTS cache: each sentence is paid once; the ledger counts characters', async () => {
  const dir = tmp();
  const provider = spyProvider();
  const tts = service(provider, dir);
  const segs = ['첫 문장입니다.', '두 번째 문장.'];
  const est = tts.estimate(segs);
  assert.equal(est.billableChars, [...segs.join('')].length);
  assert.ok(est.estimatedUsd > 0 && est.estimatedUsd < 0.001);
  await tts.synthesizeAll(segs);
  await tts.synthesizeAll(segs);
  assert.equal(provider.calls.length, 2, 'second run is fully cached');
  assert.equal(tts.estimate(segs).billableChars, 0);
  const ledger = JSON.parse(fs.readFileSync(path.join(dir, 'usage.json'), 'utf8'));
  const month = Object.values(ledger)[0];
  assert.equal(month.chars, est.billableChars);
  assert.equal(month.requests, 2);
});

test('TTS monthly limit blocks before calling the API', async () => {
  const dir = tmp();
  const provider = spyProvider();
  fs.writeFileSync(path.join(dir, 'usage.json'), JSON.stringify({ [new Date().toISOString().slice(0, 7)]: { chars: 999990, requests: 1 } }));
  const tts = service(provider, dir, { monthlyCharLimit: 1000000 });
  await assert.rejects(tts.synthesizeAll(['열 글자 이상 되는 문장입니다.']), /이번 달 TTS 사용량 한도/);
  assert.equal(provider.calls.length, 0);
});

test('free providers are never counted against the paid budget', async () => {
  const dir = tmp();
  const tts = service(createSilentTts(), dir, { maxCharsPerJob: 1 });
  const out = await tts.synthesizeAll(['아주 긴 문장도 무료 제공자는 한도에 걸리지 않습니다.']);
  assert.equal(out.length, 1);
  assert.equal(fs.existsSync(path.join(dir, 'usage.json')), false);
});

test('Google TTS request: ko-KR voice, LINEAR16, API key in header (not URL), retries 5xx', async () => {
  const calls = [];
  const wav = silentWav(0.5).toString('base64');
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) return { ok: false, status: 503, json: async () => ({ error: { message: 'busy' } }) };
    return { ok: true, status: 200, json: async () => ({ audioContent: wav }) };
  };
  const g = createGoogleTts({ auth: apiKeyAuth('KEY123'), fetchFn });
  const audio = await g.synthesize({ text: '안녕하세요.', voice: 'ko-KR-Wavenet-A', speakingRate: 1.05 });
  assert.equal(Math.round(parseWav(audio).duration * 10), 5);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, ENDPOINT);
  assert.equal(calls[1].init.headers['x-goog-api-key'], 'KEY123');
  assert.ok(!calls[1].url.includes('KEY123'));
  const body = JSON.parse(calls[1].init.body);
  assert.deepEqual(body.voice, { languageCode: 'ko-KR', name: 'ko-KR-Wavenet-A' });
  assert.equal(body.audioConfig.audioEncoding, 'LINEAR16');
  assert.equal(body.input.text, '안녕하세요.');

  const bad = createGoogleTts({ auth: apiKeyAuth('x'), fetchFn: async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'API disabled' } }) }) });
  await assert.rejects(bad.synthesize({ text: 'a', voice: 'ko-KR-Wavenet-A', speakingRate: 1 }), /Text-to-Speech API 사용 설정/);
});

test('voice families map to prices; unknown voices are not guessed', () => {
  assert.equal(voiceFamily('ko-KR-Wavenet-A'), 'Wavenet');
  assert.equal(voiceFamily('ko-KR-Neural2-B'), 'Neural2');
  assert.equal(voiceFamily('ko-KR-Chirp3-HD-Aoede'), 'Chirp3-HD');
  assert.equal(voiceFamily('local'), 'Unknown');
});

// ------------------------------------------------------------------ planning and overlay

test('narration is split per sentence and subtitles never end mid-clause', () => {
  assert.deepEqual(splitNarration('하나입니다. 둘이에요!  셋?'), ['하나입니다.', '둘이에요!', '셋?']);
  const cues = chunkSubtitle('비 오는 날마다 현관 바닥에 우산이 굴러다닌다면, 자석형 우산꽂이를 철제 현관문에 붙여 보세요.');
  assert.ok(cues[0].endsWith('굴러다닌다면,'));
  for (const c of cues) for (const line of c.split('\n')) assert.ok([...line].length <= 16, line);
});

test('plan: voice always fits, scenes keep proportions, end card follows', () => {
  const { jobFile, secret } = issueJob();
  const job = verifyJob(jobFile, { secret });
  const narration = [{ text: '가'.repeat(20) + '.', duration: 9 }, { text: '나'.repeat(10) + '.', duration: 6 }];
  const plan = buildPlan(job, narration);
  assert.ok(plan.voice[1].end <= plan.body);
  assert.ok(plan.stretch > 1, 'scripted 12s stretched to fit 15s of voice');
  const scripted = JSON.parse(job.script['장면(JSON)']).map((s) => s.duration_sec);
  plan.scenes.forEach((s, i) => assert.ok(Math.abs(s.duration - scripted[i] * plan.stretch) < 1e-9));
  assert.equal(plan.scenes.at(-1).end, plan.endCard.start);
  assert.ok(Math.abs(plan.total - (plan.body + 2.8)) < 1e-9);
  for (const c of plan.subtitles) assert.ok(c.start >= plan.voice[0].start - 1e-9 && c.end <= plan.voice[1].end + 1e-9);
  assert.equal(plan.endCard.keyword, 'PRD001R01');
  assert.equal(plan.disclosure.end, plan.total);

  const short = buildPlan(job, [{ text: '짧다.', duration: 1 }]);
  assert.equal(short.stretch, 1, 'never shrinks below the scripted length');
});

test('ASS overlay: disclosure for the whole video, escaped text, watermark only in preview', () => {
  const { jobFile, secret } = issueJob();
  const job = verifyJob(jobFile, { secret });
  job.script['광고 표기'] += ' {\\pos(0,0)}';
  const plan = buildPlan(job, [{ text: '테스트 {\\an8} 문장.', duration: 3 }]);
  const ass = buildAss(plan, { font: 'NanumGothic', preview: false });
  const disclosure = ass.split('\n').find((l) => l.includes(',Disclosure,'));
  assert.match(disclosure, /^Dialogue: 5,0:00:00\.00,/);
  assert.ok(disclosure.includes('쿠팡 파트너스'));
  assert.ok(!/\{\\pos\(0,0\)\}|\{\\an8\}/.test(ass), 'user text cannot inject override tags');
  assert.doesNotMatch(ass, /미리보기/);
  assert.match(buildAss(plan, { font: 'X', preview: true }), /게시 금지/);
  assert.equal(esc('a{b}\\c\nd'), 'a｛b｝＼c\\Nd');
});

test('WAV helpers', () => {
  const w = silentWav(1.5, 24000);
  const info = parseWav(w);
  assert.equal(info.sampleRate, 24000);
  assert.ok(Math.abs(info.duration - 1.5) < 1e-3);
  assert.throws(() => parseWav(Buffer.from('nope')), /WAV/);
});

// ------------------------------------------------------------------ real render (FFmpeg)

let hasFfmpeg = false;
try {
  hasFfmpeg = /\sass\s/.test(execFileSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' }));
} catch {
  hasFfmpeg = false;
}

test('renders a real MP4 (preview, silent voice, 360x640) and reuses it on the next run', { skip: !hasFfmpeg && 'FFmpeg with libass not installed' }, async () => {
  const { jobFile, secret } = issueJob();
  const dir = tmp();
  const provider = spyProvider();
  const opts = {
    jobFile, secret, tts: service(provider, dir), storage: createLocalStorage({ outputDir: path.join(dir, 'out') }),
    clipsDir: path.join(dir, 'clips'), preview: true, ffmpeg: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' },
    font: 'NanumGothic', size: { width: 360, height: 640 }, preset: 'ultrafast', crf: 30,
  };
  const m = await render(opts);
  assert.ok(fs.existsSync(m.output.path));
  assert.match(m.output.path, /_PREVIEW\.mp4$/);
  assert.ok(Math.abs(m.output.duration - m.timeline.total) < 0.15, m.output.duration + ' vs ' + m.timeline.total);
  const kinds = m.output.streams.map((s) => s.codec_name).sort();
  assert.deepEqual(kinds, ['aac', 'h264']);
  assert.equal(m.visuals.every((v) => v.source === 'placeholder'), true);
  const calls = provider.calls.length;
  const again = await render(opts);
  assert.equal(again.reused, true);
  assert.equal(provider.calls.length, calls, 'reuse costs nothing');
});

test('final render uses real clips per scene', { skip: !hasFfmpeg && 'FFmpeg with libass not installed' }, async () => {
  const { jobFile, secret } = issueJob();
  const dir = tmp();
  const clips = path.join(dir, 'clips', 'PRD-001-R01');
  fs.mkdirSync(clips, { recursive: true });
  for (let n = 1; n <= 3; n++) {
    // 1-second 16:9 test clips (with audio, which must be dropped) — looped and cropped to 9:16.
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=s=320x180:d=1:r=30`, '-f', 'lavfi', '-i', 'sine=d=1', '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', path.join(clips, `S${n}.mp4`)]);
  }
  const m = await render({
    jobFile, secret, tts: service(createSilentTts(), dir), storage: createLocalStorage({ outputDir: path.join(dir, 'out') }),
    clipsDir: path.join(dir, 'clips'), ffmpeg: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }, font: 'NanumGothic',
    size: { width: 360, height: 640 }, preset: 'ultrafast', crf: 30,
  });
  assert.equal(m.variant, 'final');
  assert.deepEqual(m.visuals.map((v) => v.source), ['S1.mp4', 'S2.mp4', 'S3.mp4']);
  assert.doesNotMatch(m.output.path, /PREVIEW/);
  assert.equal(m.output.streams.filter((s) => s.codec_type === 'audio').length, 1, 'clip audio dropped, narration kept');
});
