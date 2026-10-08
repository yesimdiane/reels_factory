// TTS orchestration: sentence segmentation, content-addressed cache, cost estimate and budget guard.
// The budget is checked BEFORE any request; cached sentences are never paid for twice.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parseWav } = require('../wav');

// USD per 1M characters by voice family. Approximate — verify at cloud.google.com/text-to-speech/pricing.
const PRICE_PER_MILLION = { Standard: 4, Wavenet: 4, Neural2: 16, 'Chirp3-HD': 30, Studio: 160 };

function voiceFamily(voice) {
  const m = /^[a-z]{2}-[A-Z]{2}-(Standard|Wavenet|Neural2|Chirp3-HD|Studio)/.exec(voice || '');
  return m ? m[1] : 'Unknown';
}

class BudgetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BudgetError';
  }
}

/** Splits narration into sentences (each one TTS request and one subtitle block). */
function splitNarration(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Google bills every character including spaces. */
function billedChars(text) {
  return [...text].length;
}

function createTtsService({ provider, voice, speakingRate = 1.0, cacheDir, ledgerFile, maxCharsPerJob = 1500, monthlyCharLimit = 500000, now = () => new Date() }) {
  const keyOf = (text) =>
    crypto.createHash('sha256').update(JSON.stringify({ p: provider.name, voice, speakingRate, text })).digest('hex');
  const cachePath = (text) => path.join(cacheDir, keyOf(text) + '.wav');
  const month = () => now().toISOString().slice(0, 7);

  function readLedger() {
    try {
      return JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
    } catch {
      return {};
    }
  }
  function addUsage(chars) {
    const l = readLedger();
    const m = month();
    l[m] = l[m] || { chars: 0, requests: 0 };
    l[m].chars += chars;
    l[m].requests += 1;
    fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
    fs.writeFileSync(ledgerFile, JSON.stringify(l, null, 2));
  }

  /** What a render would cost, without calling anything. */
  function estimate(segments) {
    const uncached = segments.filter((s) => !fs.existsSync(cachePath(s)));
    const chars = uncached.reduce((n, s) => n + billedChars(s), 0);
    const price = PRICE_PER_MILLION[voiceFamily(voice)];
    const usedThisMonth = (readLedger()[month()] || {}).chars || 0;
    return {
      provider: provider.name,
      paid: provider.paid,
      voice,
      voiceFamily: voiceFamily(voice),
      segments: segments.length,
      cachedSegments: segments.length - uncached.length,
      billableChars: provider.paid ? chars : 0,
      estimatedUsd: provider.paid && price != null ? (chars / 1e6) * price : 0,
      usedThisMonth,
      monthlyCharLimit,
    };
  }

  function assertBudget(est) {
    if (!provider.paid) return;
    if (est.billableChars > maxCharsPerJob) {
      throw new BudgetError('이 작업의 TTS 글자 수(' + est.billableChars + ')가 작업당 한도 RF_TTS_MAX_CHARS_PER_JOB(' + maxCharsPerJob + ')를 넘습니다.');
    }
    if (est.usedThisMonth + est.billableChars > monthlyCharLimit) {
      throw new BudgetError('이번 달 TTS 사용량 한도 RF_TTS_MONTHLY_CHAR_LIMIT(' + monthlyCharLimit + ')를 넘게 됩니다 (사용 ' + est.usedThisMonth + ' + 이번 ' + est.billableChars + ').');
    }
  }

  /** Returns [{ text, file, duration, cached }] in order. Checks the budget first. */
  async function synthesizeAll(segments) {
    assertBudget(estimate(segments));
    fs.mkdirSync(cacheDir, { recursive: true });
    const out = [];
    for (const text of segments) {
      const file = cachePath(text);
      let cached = true;
      if (!fs.existsSync(file)) {
        cached = false;
        const audio = await provider.synthesize({ text, voice, speakingRate });
        parseWav(audio); // validate before caching
        if (provider.paid) addUsage(billedChars(text));
        fs.writeFileSync(file + '.tmp', audio);
        fs.renameSync(file + '.tmp', file);
      }
      out.push({ text, file, duration: parseWav(fs.readFileSync(file)).duration, cached });
    }
    return out;
  }

  return { estimate, synthesizeAll, cachePath };
}

module.exports = { createTtsService, splitNarration, billedChars, voiceFamily, BudgetError, PRICE_PER_MILLION };
