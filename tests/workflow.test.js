// End-to-end test of the menu action with in-memory Apps Script service mocks.
// Verifies PRODUCTS is never modified and REELS rows are written by header name.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'apps-script');
const PRODUCT_HEADERS = ['상품ID', '상품명', '카테고리', '확인된 기능', '타깃', '쿠팡파트너스 URL', '영상 소스 URL', '영상 사용 허가 상태', '제작 상태'];

class MockSheet {
  constructor(name, rows) {
    this.name = name;
    this.rows = rows.map((r) => r.slice());
    this.activeRow = 1;
  }
  getName() { return this.name; }
  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i--) if (this.rows[i].some((v) => v !== '' && v != null)) return i + 1;
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.rows.forEach((r) => r.forEach((v, i) => { if (v !== '' && v != null) max = Math.max(max, i + 1); }));
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
        values.forEach((vals, i) => {
          const r = (sheet.rows[row - 1 + i] = sheet.rows[row - 1 + i] || []);
          vals.forEach((v, j) => { r[col - 1 + j] = v; });
        });
        return this;
      },
      setFontWeight() { return this; },
    };
  }
  getActiveRange() { return this.getRange(this.activeRow, 1, 1, 1); }
  setFrozenRows() {}
}

function setup({ productRows, reelsRows, geminiPayload, alertAnswer = 'YES' }) {
  const products = new MockSheet('PRODUCTS', [PRODUCT_HEADERS, ...productRows]);
  const sheets = { PRODUCTS: products };
  if (reelsRows) sheets.REELS = new MockSheet('REELS', reelsRows);
  const alerts = [];
  let fetchCount = 0;
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = new MockSheet(n, [])),
    getActiveSheet: () => products,
    toast() {},
  };
  const ui = {
    Button: { YES: 'YES', NO: 'NO', OK: 'OK' },
    ButtonSet: { YES_NO: 'YES_NO', OK_CANCEL: 'OK_CANCEL' },
    alert: (...args) => { alerts.push(args.length > 1 ? args[1] : args[0]); return alertAnswer; },
  };
  const ctx = vm.createContext({
    console,
    SpreadsheetApp: { getUi: () => ui, getActiveSpreadsheet: () => ss },
    LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => ({ GEMINI_API_KEY: 'test-key' })[k] || null }),
    },
    UrlFetchApp: {
      fetch(url, opts) {
        fetchCount++;
        assert.match(url, /generativelanguage\.googleapis\.com\/v1beta\/models\/.+:generateContent$/);
        assert.equal(opts.headers['x-goog-api-key'], 'test-key');
        assert.ok(!url.includes('test-key'), 'API key must not be in the URL');
        const body = JSON.parse(opts.payload);
        assert.equal(body.generationConfig.responseMimeType, 'application/json');
        const payload = typeof geminiPayload === 'function' ? geminiPayload(fetchCount) : geminiPayload;
        const text = JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(payload) }] } }] });
        return { getResponseCode: () => 200, getContentText: () => text };
      },
    },
    Utilities: { sleep() {} },
  });
  for (const f of fs.readdirSync(SRC).filter((f) => f.endsWith('.gs')).sort()) {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  }
  return { ctx, sheets, products, alerts, fetches: () => fetchCount };
}

function prd001Row(ctx) {
  const p = vm.runInContext('FIXTURE_PRD_001_PRODUCT', ctx);
  return [p.id, p.name, p.category, p.features, p.target, p.affiliateUrl, p.sourceUrl, p.permission, p.status];
}

function fixturePayload() {
  const { ctx } = setup({ productRows: [] });
  return JSON.parse(JSON.stringify(vm.runInContext('FIXTURE_PRD_001_GEMINI_RESPONSE', ctx)));
}

test('generates 3 REELS rows for PRD-001 without touching PRODUCTS', () => {
  const env = setup({ productRows: [], geminiPayload: fixturePayload() });
  const row = prd001Row(env.ctx);
  env.products.rows.push(row);
  const before = JSON.stringify(env.products.rows);
  env.products.activeRow = 2;

  vm.runInContext('generateReelsForSelectedProduct()', env.ctx);

  assert.equal(JSON.stringify(env.products.rows), before, 'PRODUCTS must be unchanged');
  const reels = env.sheets.REELS.rows;
  assert.equal(reels.length, 4);
  assert.equal(reels[0][0], '릴스ID');
  assert.deepEqual(reels.slice(1).map((r) => r[0]), ['PRD-001-R01', 'PRD-001-R02', 'PRD-001-R03']);
  assert.equal(env.fetches(), 1);
  assert.match(env.alerts.at(-1), /REELS에 3개 행을 추가/);
  assert.match(env.alerts.at(-1), /허가 미확인/);
  const log = env.sheets.LOG.rows;
  assert.equal(log.at(-1)[1], 'INFO');
});

test('writes by header name into an existing REELS sheet with reordered/extra columns', () => {
  const headers = vm.runInContext('CONFIG.REELS_HEADERS', setup({ productRows: [] }).ctx).slice();
  const reordered = ['운영자 메모', ...headers.reverse()];
  const existing = new Array(reordered.length).fill('');
  existing[0] = '기존 메모 유지';
  existing[reordered.indexOf('릴스ID')] = 'PRD-001-R01';
  existing[reordered.indexOf('ManyChat 키워드')] = 'PRD001R01';
  const env = setup({ productRows: [], reelsRows: [reordered, existing], geminiPayload: fixturePayload() });
  env.products.rows.push(prd001Row(env.ctx));
  env.products.activeRow = 2;

  vm.runInContext('generateReelsForSelectedProduct()', env.ctx);

  const rows = env.sheets.REELS.rows;
  assert.equal(rows.length, 5);
  assert.equal(rows[1][0], '기존 메모 유지');
  const idCol = reordered.indexOf('릴스ID');
  assert.deepEqual(rows.slice(2).map((r) => r[idCol]), ['PRD-001-R02', 'PRD-001-R03', 'PRD-001-R04']);
  assert.equal(rows[2][0], '');
});

test('retries once with validation errors, then writes nothing if still invalid', () => {
  const bad = fixturePayload();
  bad.reels[0].facts_used = ['방수 기능'];
  const env = setup({ productRows: [], geminiPayload: bad });
  env.products.rows.push(prd001Row(env.ctx));
  env.products.activeRow = 2;

  vm.runInContext('generateReelsForSelectedProduct()', env.ctx);

  assert.equal(env.fetches(), 2);
  assert.equal(env.sheets.REELS.rows.length, 1, 'only the header row');
  assert.match(env.alerts.at(-1), /검증에 실패/);
  assert.match(env.alerts.at(-1), /방수 기능/);
  const levels = env.sheets.LOG.rows.slice(1).map((r) => r[1]);
  assert.deepEqual(levels, ['WARN', 'ERROR', 'ERROR']);
});

test('second attempt succeeds after a corrective retry', () => {
  const bad = fixturePayload();
  bad.reels[0].hook = '최저가 우산꽂이';
  const good = fixturePayload();
  const env = setup({ productRows: [], geminiPayload: (n) => (n === 1 ? bad : good) });
  env.products.rows.push(prd001Row(env.ctx));
  env.products.activeRow = 2;

  vm.runInContext('generateReelsForSelectedProduct()', env.ctx);

  assert.equal(env.fetches(), 2);
  assert.equal(env.sheets.REELS.rows.length, 4);
});

test('blocks duplicate product IDs in PRODUCTS before calling Gemini', () => {
  const env = setup({ productRows: [], geminiPayload: fixturePayload() });
  env.products.rows.push(prd001Row(env.ctx), prd001Row(env.ctx));
  env.products.activeRow = 2;

  vm.runInContext('generateReelsForSelectedProduct()', env.ctx);

  assert.equal(env.fetches(), 0);
  assert.match(env.alerts.at(-1), /여러 번/);
});

test('rejects header row selection and missing features', () => {
  const env = setup({ productRows: [], geminiPayload: fixturePayload() });
  const row = prd001Row(env.ctx);
  row[3] = '';
  env.products.rows.push(row);

  env.products.activeRow = 1;
  vm.runInContext('generateReelsForSelectedProduct()', env.ctx);
  assert.match(env.alerts.at(-1), /상품 행 하나/);

  env.products.activeRow = 2;
  vm.runInContext('generateReelsForSelectedProduct()', env.ctx);
  assert.match(env.alerts.at(-1), /확인된 기능/);
  assert.equal(env.fetches(), 0);
});
