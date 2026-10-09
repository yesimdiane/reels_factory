// In-memory stand-ins for the Apps Script services the bundle uses. Not a test file itself.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const BUNDLE = path.join(__dirname, '..', '..', 'dist', 'ReelsFactory.gs');
const PRODUCT_HEADERS = ['상품ID', '상품명', '카테고리', '확인된 기능', '타깃', '쿠팡파트너스 URL', '영상 소스 URL', '영상 사용 허가 상태', '제작 상태'];

class MockSheet {
  constructor(name, rows) {
    this.name = name;
    this.rows = rows.map((r) => r.slice());
    this.activeRow = 1;
    this.writes = 0;
  }
  getName() { return this.name; }
  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i--) if ((this.rows[i] || []).some((v) => v !== '' && v != null)) return i + 1;
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.rows.forEach((r) => (r || []).forEach((v, i) => { if (v !== '' && v != null) max = Math.max(max, i + 1); }));
    return max;
  }
  getRange(row, col, nr = 1, nc = 1) {
    const sheet = this;
    return {
      getRow: () => row,
      getNumRows: () => nr,
      getValues: () => Array.from({ length: nr }, (_, i) =>
        Array.from({ length: nc }, (_, j) => ((sheet.rows[row - 1 + i] || [])[col - 1 + j] ?? ''))),
      setValues(values) {
        sheet.writes++;
        values.forEach((vals, i) => {
          const r = (sheet.rows[row - 1 + i] = sheet.rows[row - 1 + i] || []);
          vals.forEach((v, j) => { r[col - 1 + j] = v; });
        });
        return this;
      },
      setFontWeight() { return this; },
      setNumberFormat() { return this; },
    };
  }
  getActiveRange() { return this.getRange(this.activeRow, 1, 1, 1); }
  setFrozenRows() {}
  // Test helper: row as { header: value }.
  record(rowNumber) {
    const out = {};
    this.rows[0].forEach((h, i) => { out[h] = (this.rows[rowNumber - 1] || [])[i] ?? ''; });
    return out;
  }
  set(rowNumber, header, value) {
    const col = this.rows[0].indexOf(header);
    if (col === -1) throw new Error('no header ' + header);
    this.rows[rowNumber - 1][col] = value;
  }
}

/**
 * opts: { products: [[...row]], email, reviewers, gemini: payload | (n, body) => payload | Error, serviceUrl }
 */
function createEnv(opts = {}) {
  const sheets = { PRODUCTS: new MockSheet('PRODUCTS', [PRODUCT_HEADERS, ...(opts.products || [])]) };
  const props = Object.assign({ GEMINI_API_KEY: 'test-key' }, opts.reviewers ? { RF_REVIEWERS: opts.reviewers } : {});
  const state = { email: opts.email ?? 'owner@example.com', fetches: [], modelCalls: [], alerts: [], locks: 0 };
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = new MockSheet(n, [])),
    getSheets: () => Object.values(sheets),
    getActiveSheet: () => sheets.PRODUCTS,
    toast() {},
  };
  const ui = {
    Button: { YES: 'YES', NO: 'NO', OK: 'OK' },
    ButtonSet: { YES_NO: 'YES_NO', OK_CANCEL: 'OK_CANCEL' },
    alert: (...args) => { state.alerts.push(args.length > 1 ? args[1] : args[0]); return 'YES'; },
    showModalDialog: (out) => state.alerts.push(out.getContent()),
  };
  const htmlOutput = (content) => {
    const o = { content, title: '', meta: {} };
    o.setTitle = (t) => { o.title = t; return o; };
    o.addMetaTag = (k, v) => { o.meta[k] = v; return o; };
    o.setWidth = () => o; o.setHeight = () => o;
    o.getContent = () => o.content;
    return o;
  };
  const ctx = vm.createContext({
    console,
    SpreadsheetApp: { getUi: () => ui, getActiveSpreadsheet: () => ss },
    LockService: {
      getDocumentLock: () => ({ tryLock: () => (state.locks++, true), releaseLock() {} }),
      getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }),
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }),
    },
    Session: { getActiveUser: () => ({ getEmail: () => state.email }) },
    ScriptApp: { getService: () => ({ getUrl: () => opts.serviceUrl || '' }) },
    HtmlService: { createHtmlOutput: htmlOutput, createHtmlOutputFromFile: () => htmlOutput('') },
    UrlFetchApp: {
      fetch(url, o) {
        const m = url.match(/\/models\/([^:/?]+)(:generateContent)?$/);
        const model = m ? decodeURIComponent(m[1]) : '';
        state.modelCalls.push((m && m[2] ? 'generate ' : 'get ') + model);
        if ((opts.missingModels || []).includes(model)) {
          const t = JSON.stringify({ error: { code: 404, message: `models/${model} is not found for API version v1beta` } });
          return { getResponseCode: () => 404, getContentText: () => t };
        }
        if (m && !m[2]) {
          const t = JSON.stringify({ name: 'models/' + model, displayName: model, supportedGenerationMethods: ['generateContent', 'countTokens'] });
          return { getResponseCode: () => 200, getContentText: () => t };
        }
        const body = JSON.parse(o.payload);
        state.fetches.push(body);
        let payload = typeof opts.gemini === 'function' ? opts.gemini(state.fetches.length, body) : opts.gemini;
        if (payload instanceof Error) throw payload;
        const text = JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(payload) }] } }] });
        return { getResponseCode: () => 200, getContentText: () => text };
      },
    },
    Utilities: {
      sleep() {},
      getUuid: () => crypto.randomUUID(),
      Charset: { UTF_8: 'UTF-8' },
      // Like Apps Script: returns signed bytes (-128..127).
      computeHmacSha256Signature: (value, key) =>
        Array.from(crypto.createHmac('sha256', Buffer.from(key, 'utf8')).update(value, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
    },
  });
  vm.runInContext(fs.readFileSync(BUNDLE, 'utf8'), ctx, { filename: 'ReelsFactory.gs' });
  const gs = (expr) => vm.runInContext(expr, ctx);
  // Approval requires the operator's hook choice and a "reviewed" confirmation. Most tests are about other
  // steps, so by default the harness does both first (the current script's hook, no script change), like
  // an operator tapping a hook and ticking the box. Tests of the hook gate pass { autoSelectHook: false }.
  if (opts.autoSelectHook !== false) {
    const approve = ctx.apiAction;
    ctx.apiAction = function (reelId, action, input) {
      if (action === 'APPROVE_SCRIPT') {
        const r = ctx.apiGetReel(reelId);
        const h = r && r.ok && r.detail.hooks;
        if (h && h.required && !h.selectionValid && h.canSelect) {
          ctx.apiSelectHook(reelId, {
            hookId: (h.recommended && h.recommended.id) || h.candidates[0].id,
            text: r.detail.reel.hook,
            mode: 'keep',
            expectedStatus: r.detail.summary.status,
            expectedScriptVersion: r.detail.summary.scriptVersion,
          });
        }
      }
      // …and confirms having reviewed the script with that hook (the approve-screen checkbox).
      if (action === 'APPROVE_SCRIPT') input = Object.assign({ hookReviewed: true }, input || {});
      return approve(reelId, action, input);
    };
  }
  return { ctx, gs, sheets, props, state, ss };
}

function prd001Row(gs, over = {}) {
  const p = Object.assign({}, gs('FIXTURE_PRD_001_PRODUCT'), over);
  return [p.id, p.name, p.category, p.features, p.target, p.affiliateUrl, p.sourceUrl, p.permission, p.status];
}

module.exports = { createEnv, prd001Row, MockSheet, PRODUCT_HEADERS };
