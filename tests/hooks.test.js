// Regression: hook style and story structure for new Gemini scripts (Korean home-decor / small-space
// account). Hooks open with a relatable problem, not an ad; three distinct angles; HOOK → EMPATHY →
// SOLUTION → DEMO → CTA. Fact validation, existing rows, reviewer edits and gates are unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv, prd001Row } = require('./helpers/apps-script-mock');

const plain = (v) => JSON.parse(JSON.stringify(v));
const fixture = (env) => plain(env.gs('FIXTURE_PRD_001_GEMINI_RESPONSE'));

function setup(gemini) {
  const env = createEnv({ gemini: gemini || (() => fixture(env)) });
  env.sheets.PRODUCTS.rows.push(prd001Row(env.gs, { permission: '자체 제작', affiliateUrl: 'https://link.coupang.com/a/x' }));
  env.gs('setupSheets()');
  const product = plain(env.gs('FIXTURE_PRD_001_PRODUCT'));
  const call = (fn, ...a) => plain(env.gs(fn).apply(null, a));
  const hookErrors = (hook, avoid) => plain(env.gs('hookStyleErrors_')({ hook }, product, '릴스 1', avoid || []));
  const validate = (payload, options) => plain(env.gs('validateGeminiReels')(payload, product, null, options));
  return { env, product, call, hookErrors, validate };
}
// Sets reel i's hook (first scene line, caption and hook stay the same text).
function setHook(payload, i, hook) {
  const r = payload.reels[i];
  r.hook = hook;
  r.scenes[0].narration = hook;
  r.captions[0] = hook;
  return payload;
}

test('relatable problem-first hooks (the account style) are accepted', () => {
  const { hookErrors } = setup();
  for (const h of [
    '급하게 출근하면 꼭 까먹는 우산!',
    '원룸 살 때 제일 애매한 게 우산꽂이였어요.',
    '좁은 현관에 우산꽂이까지 놓기 싫잖아요.',
    '비 오는 날 집에 오면 젖은 우산부터 문제',
    '신발장 옆에 우산 세우면 꼭 쓰러지죠',
  ]) {
    assert.deepEqual(hookErrors(h), [], h);
  }
});

test('generic advertising hooks are rejected with a concrete fix for the retry', () => {
  const { hookErrors } = setup();
  const cases = [
    ['현관이 좁아 우산 둘 곳이 없다면?', /"~다면\?" 같은 뻔한 질문형/],
    ['우산꽂이 하나로 현관이 달라집니다.', /제품 이름으로 시작합니다/],
    ['우산꽂이 하나로 현관이 달라집니다.', /"~니다" 말투/],
    ['우산꽂이 하나로 현관이 달라집니다.', /광고 문구/],
    ['현관 정리 고민이신가요?', /"~하시나요\?" 같은 뻔한 질문형/],
    ['현관 우산 정리, 어떻게 하시나요?', /뻔한 질문형/],
    ['현관 정리 필수템 소개해요', /광고 문구/],
    ['지금 바로 확인하세요!', /권유형/],
    ['이거 붙이면 현관이 달라져요', /결과 약속/],
    ['리템 자석 우산꽂이로 정리해요', /제품 이름으로 시작합니다/],
    ['비 오는 날마다 젖은 우산을 어디에 둘지 매번 고민하게 되는 좁은 현관', /25자 이내/],
  ];
  for (const [hook, re] of cases) {
    const errs = hookErrors(hook).join('\n');
    assert.match(errs, re, hook);
    assert.match(errs, /구체적인 불편·상황으로 시작|25자 이내/, 'the error tells Gemini how to fix it');
  }
});

test('three distinct angles and openings are required; this product\'s earlier hooks are not repeated', () => {
  const { env, validate } = setup();
  assert.deepEqual(validate(fixture(env)).errors, []);
  const sameAngle = fixture(env);
  sameAngle.reels[2].angle = 'SMALL_SPACE';
  assert.match(validate(sameAngle).errors.join('\n'), /angle SMALL_SPACE이 릴스 2와 같습니다/);
  const noAngle = fixture(env);
  delete noAngle.reels[1].angle;
  assert.match(validate(noAngle).errors.join('\n'), /릴스 2: angle은 EVERYDAY_FRUSTRATION, SMALL_SPACE, LIFESTYLE_SITUATION 중 하나/);
  const sameOpening = setHook(fixture(env), 2, '좁은 현관에 젖은 우산까지 있으면 답답해요');
  assert.match(validate(sameOpening).errors.join('\n'), /릴스 3: hook이 릴스 2와 같은 말\("좁은 현관에"\)로 시작합니다/);
  const repeat = validate(fixture(env), { avoidHooks: ['급하게 출근하면 꼭 까먹는 우산'] });
  assert.match(repeat.errors.join('\n'), /이 상품의 기존 릴스 hook과 같습니다/);
});

test('new scripts follow HOOK → EMPATHY → SOLUTION → DEMO → CTA; the angle is shown in 컨셉', () => {
  const { env, validate, call } = setup();
  const noSolution = fixture(env);
  noSolution.reels[0].scenes[2].beat = 'DEMO';
  assert.match(validate(noSolution).errors.join('\n'), /릴스 1: SOLUTION 장면\(제품을 자연스럽게 등장\)이 필요합니다/);
  const noEmpathy = fixture(env);
  noEmpathy.reels[1].scenes[1].beat = 'SOLUTION';
  assert.match(validate(noEmpathy).errors.join('\n'), /릴스 2: EMPATHY 장면/);
  const wrongOrder = fixture(env);
  [wrongOrder.reels[0].scenes[1].beat, wrongOrder.reels[0].scenes[2].beat] = ['SOLUTION', 'EMPATHY'];
  assert.match(validate(wrongOrder).errors.join('\n'), /장면 순서는 HOOK → EMPATHY → SOLUTION → DEMO/);
  const res = call('apiGenerateScripts', 'PRD-001');
  assert.equal(res.ok, true, res.error);
  const rows = env.sheets.REELS.rows;
  assert.deepEqual(rows.slice(1).map((r) => r[rows[0].indexOf('컨셉')]), ['A 일상 불편 · 출근길에 깜빡하는 우산', 'B 좁은 공간 · 좁은 현관 바닥 비우기', 'C 생활 상황 · 비 오는 날 귀가']);
  assert.deepEqual(rows.slice(1).map((r) => r[rows[0].indexOf('후킹')]), ['급하게 출근하면 꼭 까먹는 우산!', '좁은 현관에 우산꽂이까지 놓기 싫잖아요.', '비 오는 날 집에 오면 젖은 우산부터 문제']);
});

test('invented personal experiences or results are rejected; fact rules still apply', () => {
  const { env, validate } = setup();
  const exp = fixture(env);
  exp.reels[0].scenes[3].narration = '한 달 써 보니 현관이 넓어졌어요';
  assert.match(validate(exp).errors.join('\n'), /확인되지 않은 체험·결과 주장/);
  const tried = fixture(env);
  tried.reels[1].scenes[2].narration = '문에 붙였더니 바닥이 넓어졌어요';
  assert.match(validate(tried).errors.join('\n'), /체험·결과 주장 "붙였더니"/);
  const invented = fixture(env);
  invented.reels[2].scenes[2].narration = '냉장고에도 붙일 수 있어요';
  assert.match(validate(invented).errors.join('\n'), /호환성 주장 "냉장고"/);
  const dims = fixture(env);
  dims.reels[1].scenes[3].narration = '상단 188×55×50mm';
  assert.match(validate(dims).errors.join('\n'), /확인된 기능과 다른 치수/);
});

test('the prompt asks for the account style: three angles, structure, good and bad hooks, no invented experiences', () => {
  const { env, product } = setup();
  const prompt = env.gs('buildGeminiPrompt')(product, [], '', ['예전 hook 하나']);
  for (const s of [
    '한국 홈데코, 작은 집·원룸 살이, 정리 수납',
    '라이프스타일 크리에이터',
    'EVERYDAY_FRUSTRATION (A 일상 불편)', 'SMALL_SPACE (B 좁은 공간)', 'LIFESTYLE_SITUATION (C 생활 상황)',
    'HOOK(공감 가는 불편·상황, 2~3초) → EMPATHY(왜 짜증 나는지) → SOLUTION(제품을 자연스럽게 등장) → DEMO(확인된 기능 시연) → CTA(댓글 키워드)',
    '나쁜 예: "현관이 좁아 우산 둘 곳이 없다면?", "우산꽂이 하나로 현관이 달라집니다."',
    '좋은 예: "급하게 출근하면 꼭 까먹는 우산!"',
    '25자 이내', '첫 2초',
    '경험담·사용 결과를 지어내지 마세요',
    '## 이 상품에 이미 쓴 hook', '- 예전 hook 하나',
  ]) assert.ok(prompt.includes(s), s);
  const schema = plain(env.gs('RF_GEMINI_RESPONSE_SCHEMA'));
  assert.deepEqual(schema.properties.reels.items.properties.angle.enum, ['EVERYDAY_FRUSTRATION', 'SMALL_SPACE', 'LIFESTYLE_SITUATION']);
  assert.ok(schema.properties.reels.items.properties.scenes.items.properties.beat.enum.includes('EMPATHY'));
  // Regeneration keeps the reel's angle instead of asking for three.
  const regen = env.gs('buildRegenerationPrompt')(product, { hook: 'x' }, '더 자연스럽게', []);
  assert.ok(regen.includes('현재 대본과 같은 angle을 유지하세요'));
  assert.ok(!regen.includes('릴스마다 하나씩'));
});

test('an ad-style hook costs one corrective retry with the exact fix; a second batch is told the earlier hooks', () => {
  const ad = (env) => setHook(fixture(env), 0, '우산꽂이 하나로 현관이 달라집니다.');
  let env;
  ({ env } = setup((n) => (n === 1 ? ad(env) : fixture(env))));
  const res = plain(env.gs('apiGenerateScripts')('PRD-001'));
  assert.equal(res.ok, true, res.error);
  assert.equal(env.state.fetches.length, 2);
  const retry = env.state.fetches[1].contents[0].parts[0].text;
  assert.match(retry, /릴스 1: hook "우산꽂이 하나로 현관이 달라집니다\." — 제품 이름으로 시작합니다/);
  assert.match(retry, /구체적인 불편·상황으로 시작하는 짧은 구어체로 다시 쓰세요/);
  // Second batch for the same product: the prompt lists the existing hooks; an exact repeat is refused.
  const again = plain(env.gs('apiGenerateScripts')('PRD-001', true));
  assert.equal(again.ok, false, 'the fixture repeats its hooks, so both attempts fail and nothing is written');
  assert.equal(env.sheets.REELS.rows.length, 4);
  const p3 = env.state.fetches[2].contents[0].parts[0].text;
  assert.match(p3, /## 이 상품에 이미 쓴 hook[\s\S]*- 급하게 출근하면 꼭 까먹는 우산!/);
  assert.equal(env.state.fetches.length, 4, 'still at most 2 calls per run');
});

test('older scripts and reviewer edits keep working: old structure approves, hook style is the reviewer\'s call', () => {
  const { env, call, product } = setup();
  call('apiGenerateScripts', 'PRD-001');
  // A REELS row in the older structure (HOOK → DEMO → DEMO → BENEFIT → CTA) written before this change.
  const old = {
    concept: '문제 해결', hook: '현관 좁은 집은 우산 어디 둬요?', narration: '', captions: [],
    scenes: [
      ['HOOK', 3, '현관 좁은 집은 우산 어디 둬요?', []], ['DEMO', 4, '저는 그냥 문에 붙였어요.', ['호환되는 철제 표면에 자석으로 부착 가능']],
      ['DEMO', 6, '바닥 공간을 안 차지하니까', []], ['BENEFIT', 6, '현관이 훨씬 깔끔해져요.', []], ['CTA', 4, "제품 정보는 댓글에 '{키워드}'", []],
    ].map((s, i) => ({ scene_no: i + 1, beat: s[0], duration_sec: s[1], narration: s[2], visual: '현관 모습', on_screen_text: '', flow_prompt: 'Vertical 9:16 photorealistic entryway shot, natural light, no text.', facts: s[3] })),
    facts_used: ['호환되는 철제 표면에 자석으로 부착 가능'],
  };
  old.captions = old.scenes.map((s) => s.narration);
  old.narration = old.captions.join(' ');
  const recs = env.gs('buildReelRecords')(product, [old], plain(env.gs('readColumn_')(env.sheets.REELS, env.gs('getHeaderMap_')(env.sheets.REELS), '릴스ID')), [], { model: 'old', generatedAt: 'g' });
  env.gs('appendRecords_')(env.sheets.REELS, recs, env.gs('RF_SCRIPT_FIELDS'));
  const act = (id, name, input = {}) => {
    const d = call('apiGetReel', id).detail;
    return call('apiAction', id, name, Object.assign({ expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion, expectedVideoVersion: d.summary.videoVersion }, input));
  };
  const before = JSON.stringify(env.sheets.REELS.rows.slice(0, 4));
  const approved = act('PRD-001-R04', 'APPROVE_SCRIPT');
  assert.equal(approved.ok, true, approved.error);
  assert.equal(JSON.stringify(env.sheets.REELS.rows.slice(0, 4)), before, 'other rows untouched');
  // The reviewer may keep or write any hook they want (only fact rules apply to edits).
  const edited = act('PRD-001-R01', 'EDIT_SCRIPT', { edit: { hook: '현관 우산 정리, 어떻게 하시나요?' } });
  assert.equal(edited.ok, true, edited.error);
  const refused = act('PRD-001-R02', 'EDIT_SCRIPT', { edit: { hook: '한 달 써 보니 현관이 넓어졌어요' } });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /체험·결과 주장/);
  // New-style scripts approve and produce one Flow prompt per scene; no render job before approval.
  assert.equal(call('apiGetRenderJob', 'PRD-001-R02').ok, false);
  assert.equal(act('PRD-001-R02', 'APPROVE_SCRIPT').ok, true);
  const flow = JSON.parse(env.sheets.REELS.rows[2][env.sheets.REELS.rows[0].indexOf('Flow 장면 프롬프트')]);
  assert.deepEqual(flow.map((p) => p.beat), ['HOOK', 'EMPATHY', 'SOLUTION', 'DEMO', 'CTA']);
  assert.match(flow[2].prompt, /product comes into frame naturally/);
});
