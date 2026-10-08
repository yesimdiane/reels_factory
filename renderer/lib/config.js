// Configuration from environment variables (and renderer/.env). Same keys locally and in the cloud.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function loadConfig(env = process.env, { dotenvFile = path.join(__dirname, '..', '.env'), platform = process.platform } = {}) {
  const e = Object.assign({}, loadDotEnv(dotenvFile), env);
  const num = (k, d) => (e[k] != null && e[k] !== '' ? Number(e[k]) : d);
  const stateDir = e.RF_STATE_DIR || path.join(os.homedir(), '.reels-factory');
  const inCloud = !!(e.K_SERVICE || e.CLOUD_RUN_JOB);
  return {
    secret: e.RF_RENDER_SECRET || '',
    ttsProvider: e.RF_TTS_PROVIDER || 'google',
    ttsAuth: e.RF_TTS_AUTH || (e.GOOGLE_TTS_API_KEY ? 'apiKey' : inCloud ? 'metadata' : 'gcloud'),
    googleApiKey: e.GOOGLE_TTS_API_KEY || '',
    gcpProject: e.RF_GCP_PROJECT || '',
    voice: e.RF_TTS_VOICE || 'ko-KR-Wavenet-A',
    speakingRate: num('RF_TTS_RATE', 1.05),
    maxCharsPerJob: num('RF_TTS_MAX_CHARS_PER_JOB', 1500),
    monthlyCharLimit: num('RF_TTS_MONTHLY_CHAR_LIMIT', 500000),
    stateDir,
    cacheDir: path.join(stateDir, 'cache', 'tts'),
    ledgerFile: path.join(stateDir, 'tts-usage.json'),
    outputDir: e.RF_OUTPUT_DIR || path.join(__dirname, '..', 'output'),
    clipsDir: e.RF_CLIPS_DIR || path.join(__dirname, '..', 'clips'),
    jobsDir: e.RF_JOBS_DIR || path.join(__dirname, '..', 'jobs'),
    // Declared provenance for clips without an assets.json (the operator's workflow: Google Flow).
    defaultSource: e.RF_DEFAULT_FOOTAGE_SOURCE || 'flow-generated',
    allowFontFallback: e.RF_ALLOW_FONT_FALLBACK === '1',
    ffmpeg: { ffmpeg: e.RF_FFMPEG || 'ffmpeg', ffprobe: e.RF_FFPROBE || 'ffprobe' },
    font: e.RF_FONT_NAME || (platform === 'darwin' ? 'Apple SD Gothic Neo' : 'NanumGothic'),
    fontsDir: e.RF_FONTS_DIR || '',
    crf: num('RF_CRF', 20),
    preset: e.RF_X264_PRESET || 'medium',
  };
}

module.exports = { loadConfig, loadDotEnv };
