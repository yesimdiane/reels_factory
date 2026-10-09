/**
 * PRD-001 test fixture. Facts come only from README.md "First product".
 * Category/target are illustrative test inputs, not product claims.
 * URLs are intentionally blank and permission is "미확인" — they must be verified by the operator.
 *
 * FIXTURE_PRD_001_GEMINI_RESPONSE is a hand-written sample in the expected schema,
 * NOT a recorded Gemini response, written in the account's style: each reel opens with a relatable
 * problem (angles A/B/C) and follows HOOK → EMPATHY → SOLUTION → DEMO → CTA. Reel 1 keeps the timing
 * of the operator's approved PRD-001 storyboard (3+4+6+6+4 = 23 s). Facts are referenced by ID (F1 = first line of
 * 확인된 기능 …), as Gemini returns them; REELS stores the matching sheet wording.
 *
 * FIXTURE_PRD_001_SHEET_FEATURES is the operator's real PRODUCTS wording for PRD-001 (regression
 * test for natural paraphrases).
 */

const FIXTURE_PRD_001_SHEET_FEATURES = [
  '자석 부착형 거치 방식',
  '상·하단 분리형 2피스 구조 (상단 190x55x50mm, 하단 188x55x82mm)',
  '장우산/접이식 우산 분할 거치',
  '철제 도어 부착',
  '색상 옵션(다크그레이/그레이/화이트)',
].join('\n');

const FIXTURE_PRD_001_PRODUCT = {
  id: 'PRD-001',
  name: '리템 우산꽂이 자석형',
  category: '생활용품 > 현관 수납',
  features: [
    '호환되는 철제 표면에 자석으로 부착 가능',
    '상단·하단 분리형 (상단 190×55×50mm, 하단 188×55×82mm)',
    '장우산과 접이식 우산 모두 수납 가능',
    '색상: 다크그레이, 그레이, 화이트',
  ].join('\n'),
  target: '현관 공간이 좁은 집',
  affiliateUrl: '',
  sourceUrl: '',
  permission: '미확인',
  status: '',
};

function fixtureReel_(angle, concept, scenes, factsUsed) {
  return {
    angle: angle,
    pillar: 'PRODUCT_DISCOVERY',
    concept: concept,
    hook: scenes[0][2],
    narration: scenes.map(function (s) { return s[2]; }).join(' '),
    captions: scenes.map(function (s) { return s[2]; }),
    scenes: scenes.map(function (s, i) {
      return { scene_no: i + 1, beat: s[0], duration_sec: s[1], narration: s[2], visual: s[3], on_screen_text: '', flow_prompt: s[4], fact_ids: s[5] || [] };
    }),
    facts_used: factsUsed,
    needs_verification: [],
  };
}

const FIXTURE_PRD_001_GEMINI_RESPONSE = {
  reels: [
    fixtureReel_('EVERYDAY_FRUSTRATION', '출근길에 깜빡하는 우산', [
      ['HOOK', 3, '급하게 출근하면 꼭 까먹는 우산!', '현관문을 급히 나서다 멈칫하고 뒤돌아보는 사람, 신발장 구석에 세워 둔 우산',
        'Vertical 9:16 handheld shot, a person in work clothes hurrying out of a small Korean apartment front door, stopping and looking back at an umbrella leaning in the corner, natural light, no text.'],
      ['EMPATHY', 4, '구석에 세워 두면 눈에 안 띄잖아요.', '신발장 옆 구석에 기대 세워 둔 우산 클로즈업, 신발에 가려 잘 안 보임',
        'Vertical 9:16 close-up, an umbrella leaning in a dim corner beside a shoe cabinet, partly hidden behind shoes, realistic, no text.'],
      ['SOLUTION', 6, '그래서 현관문에 붙이는 우산꽂이', '손이 슬림한 다크그레이 우산꽂이를 철제 현관문 아래쪽에 자석으로 붙이는 모습',
        'Vertical 9:16 close-up, a hand placing a slim dark gray magnetic umbrella holder onto the lower part of a steel apartment front door, natural light, realistic, no text.', ['F1']],
      ['DEMO', 6, '장우산도 접이식 우산도 쏙 들어가요.', '문에 붙은 우산꽂이에 장우산과 접이식 우산을 차례로 꽂는 모습',
        'Vertical 9:16 medium shot, a person sliding a long umbrella and then a folding umbrella into a slim dark gray holder attached to a steel front door, natural light, no text.', ['F3', 'F1']],
      ['CTA', 4, "제품 정보는 댓글에 '{키워드}' ☂️", '현관문에 붙은 우산꽂이 제품 클로즈업',
        'Vertical 9:16 slow close-up of a slim dark gray umbrella holder mounted on a steel door with one umbrella inside, soft light, shallow depth of field, no text.'],
    ], ['F1', 'F3']),
    fixtureReel_('SMALL_SPACE', '좁은 현관 바닥 비우기', [
      ['HOOK', 3, '좁은 현관에 우산꽂이까지 놓기 싫잖아요.', '신발로 가득 찬 좁은 현관 바닥을 내려다보는 POV',
        'Vertical 9:16 top-down POV, a tiny Korean apartment entryway floor crowded with shoes, no free space, natural light, realistic, no text.'],
      ['EMPATHY', 4, '신발 둘 자리도 빠듯한데 말이죠.', '신발을 발로 밀어 자리를 만드는 모습',
        'Vertical 9:16 close-up, a foot pushing shoes aside to make room on a small entryway floor, realistic, no text.'],
      ['SOLUTION', 5, '바닥 말고 철제 문에 붙이면 돼요.', '두 조각 우산꽂이를 철제 문에 붙이는 손',
        'Vertical 9:16 close-up, a hand attaching a dark gray two-piece umbrella holder to a steel door, natural light, no text.', ['F1']],
      ['DEMO', 5, '상단 190×55×50mm, 하단 188×55×82mm', '위아래로 나뉜 두 부품을 하나씩 보여 주고 문에 붙인 모습',
        'Vertical 9:16 medium shot, steel apartment door with the upper and lower pieces of a dark gray umbrella holder, a long umbrella standing in it, tidy floor, daylight, no text.', ['F2']],
      ['CTA', 4, "궁금하면 댓글에 '{키워드}' 남겨 주세요", '문에 붙은 다크그레이 우산꽂이 클로즈업',
        'Vertical 9:16 slow close-up of a dark gray two-piece umbrella holder on a steel door, soft light, no text.'],
    ], ['F1', 'F2']),
    fixtureReel_('LIFESTYLE_SITUATION', '비 오는 날 귀가', [
      ['HOOK', 3, '비 오는 날 집에 오면 젖은 우산부터 문제', '비 오는 날 현관에 들어서며 젖은 장우산을 든 채 둘 곳을 찾는 사람',
        'Vertical 9:16 handheld shot, a person stepping into a small Korean apartment entryway on a rainy day holding a wet long umbrella, looking for a place to put it, no text.'],
      ['EMPATHY', 4, '바닥에 눕혀 두면 현관이 금방 어수선해요.', '현관 바닥에 아무렇게나 놓인 젖은 우산들',
        'Vertical 9:16 close-up, wet umbrellas lying messily on entryway floor tiles, realistic, no text.'],
      ['SOLUTION', 5, '문에 붙여 쓰는 우산꽂이로 정리해요.', '흰 철제 문에 붙은 흰색 우산꽂이에 젖은 우산을 꽂는 손',
        'Vertical 9:16 close-up, a hand putting a wet umbrella into a white umbrella holder attached to a white steel door, natural light, no text.', ['F1']],
      ['DEMO', 5, '다크그레이, 그레이, 화이트 중에 골라요.', '다크그레이·그레이·화이트 우산꽂이 세 개를 나란히 보여 주는 손',
        'Vertical 9:16 top-down shot, three plain umbrella holders in dark gray, gray and white side by side on a wooden shoe bench, soft light, no text.', ['F4']],
      ['CTA', 4, "색상 정보는 댓글에 '{키워드}'", '문에 붙은 흰색 우산꽂이 클로즈업',
        'Vertical 9:16 slow close-up of a white umbrella holder on a white steel door, one umbrella inside, soft light, no text.'],
    ], ['F1', 'F4']),
  ],
};
