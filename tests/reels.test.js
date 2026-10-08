// Unit tests for the pure Apps Script logic, run with `node --test`.
// Loads the .gs files into one shared VM context, mirroring Apps Script's global scope.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'apps-script');
const FILES = ['Config.gs', 'Validation.gs', 'States.gs', 'Reels.gs', 'Prompt.gs', 'Fixtures.gs'];

function load() {
  const ctx = vm.createContext({ console });
  for (const f of FILES) {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  }
  return (expr) => vm.runInContext(expr, ctx);
}

// Values created inside the VM have different Array/Object prototypes; copy them into this realm.
const plain = (v) => JSON.parse(JSON.stringify(v));

const gs = load();
const product = gs('FIXTURE_PRD_001_PRODUCT');
const fixture = () => JSON.parse(JSON.stringify(gs('FIXTURE_PRD_001_GEMINI_RESPONSE')));
const prepare = gs('prepareReelRecords');
const validate = gs('validateGeminiReels');
const meta = { model: 'test-model', generatedAt: '2026-10-08T00:00:00Z' };

test('PRD-001 product fixture is valid', () => {
  assert.deepEqual(plain(gs('validateProduct')(product)), []);
  assert.equal(gs('parseConfirmedFeatures')(product.features).length, 4);
});

test('PRD-001 fixture response produces 3 REELS records', () => {
  const res = prepare(product, JSON.stringify(fixture()), [], [], meta);
  assert.deepEqual(plain(res.errors), []);
  assert.equal(res.records.length, 3);
  assert.deepEqual(
    plain(res.records.map((r) => r['릴스ID'])),
    ['PRD-001-R01', 'PRD-001-R02', 'PRD-001-R03']
  );
  assert.deepEqual(
    plain(res.records.map((r) => r['ManyChat 키워드'])),
    ['PRD001R01', 'PRD001R02', 'PRD001R03']
  );
  const headers = gs('RF_CONFIG.REELS_HEADERS');
  for (const r of res.records) {
    for (const k of Object.keys(r)) assert.ok(headers.includes(k), 'unknown header ' + k);
    assert.equal(r['상태'], 'SCRIPT_REVIEW_PENDING');
    assert.equal(r['대본 버전'], 1);
    assert.equal(r['광고 표기'], gs('RF_CONFIG.AFFILIATE_DISCLOSURE'));
    assert.match(r['CTA'], new RegExp(r['ManyChat 키워드']));
    assert.match(r['Flow 생성'], /수동/);
    assert.match(r['검토 메모'], /허가 미확인/);
    assert.equal(r['제작 상태'], '대본 검토 대기');
    assert.equal(r['영상 사용 허가 상태'], '미확인');
    assert.ok(r['Flow 프롬프트'].startsWith('S1 ('));
    assert.doesNotThrow(() => JSON.parse(r['장면(JSON)']));
  }
});

test('accepts ```json fenced output', () => {
  const res = prepare(product, '```json\n' + JSON.stringify(fixture()) + '\n```', [], [], meta);
  assert.deepEqual(plain(res.errors), []);
});

test('rejects non-JSON output', () => {
  const res = prepare(product, 'Sure! Here are your reels:', [], [], meta);
  assert.equal(res.records.length, 0);
  assert.match(res.errors[0], /JSON/);
});

test('rejects wrong number of reels', () => {
  const p = fixture();
  p.reels.pop();
  assert.match(validate(p, product).errors.join('\n'), /정확히 3개/);
});

test('rejects facts not in 확인된 기능', () => {
  const p = fixture();
  p.reels[0].facts_used.push('녹이 슬지 않는 스테인리스 소재');
  assert.match(validate(p, product).errors.join('\n'), /확인되지 않은 기능/);
});

test('rejects invented numbers in viewer-facing text', () => {
  const p = fixture();
  p.reels[0].narration += ' 무게는 3kg까지 버팁니다.';
  assert.match(validate(p, product).errors.join('\n'), /수치.*"3"/);
});

test('allows numbers that appear in confirmed facts', () => {
  const p = fixture();
  assert.match(p.reels[1].narration, /190×55×50mm/);
  assert.deepEqual(plain(validate(p, product).errors), []);
});

test('rejects banned exaggerated phrases and URLs', () => {
  const p = fixture();
  p.reels[2].hook = '최저가 우산꽂이';
  p.reels[1].captions.push('https://link.coupang.com/a/xyz');
  const errs = validate(p, product).errors.join('\n');
  assert.match(errs, /최저가/);
  assert.match(errs, /URL/);
});

test('rejects duplicate hooks / concepts across reels', () => {
  const p = fixture();
  p.reels[1].hook = p.reels[0].hook;
  p.reels[2].concept = p.reels[0].concept;
  const errs = validate(p, product).errors.join('\n');
  assert.match(errs, /hook이 릴스 1와 중복/);
  assert.match(errs, /concept이 릴스 1와 중복/);
});

test('rejects bad scene structure and missing flow prompts', () => {
  const p = fixture();
  p.reels[0].scenes[1].scene_no = 5;
  p.reels[0].scenes[2].flow_prompt = '';
  p.reels[2].scenes = p.reels[2].scenes.slice(0, 2);
  const errs = validate(p, product).errors.join('\n');
  assert.match(errs, /scene_no는 2/);
  assert.match(errs, /flow_prompt/);
  assert.match(errs, /장면 수는 3~6개/);
});

test('rejects total duration out of range', () => {
  const p = fixture();
  p.reels[0].scenes.forEach((s) => (s.duration_sec = 20));
  assert.match(validate(p, product).errors.join('\n'), /총 길이/);
});

test('reel IDs continue after existing ones and skip collisions', () => {
  const next = gs('nextReelIds');
  assert.deepEqual(
    [...next('PRD-001', ['PRD-001-R01', 'PRD-001-R02', 'PRD-002-R07', 'PRD-001-Rx'], 3)],
    ['PRD-001-R03', 'PRD-001-R04', 'PRD-001-R05']
  );
  assert.deepEqual([...next('PRD-001', ['PRD-001-R09'], 2)], ['PRD-001-R10', 'PRD-001-R11']);
});

test('existing REELS IDs are not reused', () => {
  const res = prepare(product, JSON.stringify(fixture()), ['PRD-001-R01', 'PRD-001-R02', 'PRD-001-R03'], [], meta);
  assert.deepEqual(
    plain(res.records.map((r) => r['릴스ID'])),
    ['PRD-001-R04', 'PRD-001-R05', 'PRD-001-R06']
  );
});

test('throws on ManyChat keyword collision', () => {
  assert.throws(
    () => prepare(product, JSON.stringify(fixture()), [], ['prd001r01'], meta),
    /ManyChat 키워드/
  );
});

test('approved permission removes the unverified note', () => {
  const approved = { ...product, permission: '허가됨' };
  const res = prepare(approved, JSON.stringify(fixture()), [], [], meta);
  assert.doesNotMatch(res.records[0]['검토 메모'], /허가 미확인/);
});

test('validateProduct reports actionable errors', () => {
  const errs = gs('validateProduct')({ id: 'P1', name: '', features: '  ' });
  assert.equal(errs.length, 3);
  assert.match(errs[0], /PRD-001/);
});

test('prompt includes facts, rules and retry errors', () => {
  const prompt = gs('buildGeminiPrompt')(product, ['릴스 1: hook이 너무 깁니다.']);
  assert.match(prompt, /PRD-001/);
  assert.match(prompt, /상단 190×55×50mm/);
  assert.match(prompt, /Google Flow/);
  assert.match(prompt, /이전 응답의 검증 오류/);
  assert.doesNotMatch(gs('buildGeminiPrompt')(product), /이전 응답의 검증 오류/);
});

test('findDuplicates', () => {
  assert.deepEqual([...gs('findDuplicates')(['A', 'B', 'A ', '', '', 'B', 'C'])], ['A', 'B']);
});
