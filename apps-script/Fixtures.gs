/**
 * PRD-001 test fixture. Facts come only from README.md "First product".
 * Category/target are illustrative test inputs, not product claims.
 * URLs are intentionally blank and permission is "미확인" — they must be verified by the operator.
 *
 * FIXTURE_PRD_001_GEMINI_RESPONSE is a hand-written sample in the expected schema,
 * NOT a recorded Gemini response. Reel 1 is the operator's approved PRD-001 storyboard
 * (HOOK → DEMO → DEMO → BENEFIT → CTA, 23 s).
 */

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

function fixtureReel_(concept, scenes, factsUsed) {
  return {
    concept: concept,
    hook: scenes[0][2],
    narration: scenes.map(function (s) { return s[2]; }).join(' '),
    captions: scenes.map(function (s) { return s[2]; }),
    scenes: scenes.map(function (s, i) {
      return { scene_no: i + 1, beat: s[0], duration_sec: s[1], narration: s[2], visual: s[3], on_screen_text: '', flow_prompt: s[4] };
    }),
    facts_used: factsUsed,
  };
}

const FIXTURE_PRD_001_GEMINI_RESPONSE = {
  reels: [
    fixtureReel_('문제 해결: 좁은 현관의 우산 자리', [
      ['HOOK', 3, '현관 좁은 집은 우산 어디 둬요?', '좁은 현관 바닥에 젖은 장우산과 접이식 우산이 어지럽게 놓인 모습',
        'Vertical 9:16 handheld phone footage, narrow Korean apartment entryway, several wet umbrellas lying messily on the floor tiles, soft daylight, realistic, no text, no logos.'],
      ['DEMO', 4, '저는 그냥 문에 붙였어요.', '손으로 자석 우산꽂이를 철제 현관문 아래쪽에 붙이는 클로즈업',
        'Vertical 9:16 close-up, a hand placing a slim dark gray magnetic umbrella holder onto the lower part of a steel apartment front door, natural light, realistic, no text.'],
      ['DEMO', 6, '바닥 공간을 안 차지하니까', '문에 붙은 우산꽂이에 장우산과 접이식 우산을 차례로 꽂는 모습',
        'Vertical 9:16 medium shot, a person sliding a long umbrella and then a folding umbrella into a slim dark gray holder attached to a steel front door, natural light, no text.'],
      ['BENEFIT', 6, '현관이 훨씬 깔끔해져요.', '우산이 문에 정리되고 바닥이 비어 있는 깔끔한 현관 전체 모습',
        'Vertical 9:16 wide shot, tidy small Korean apartment entryway, umbrellas neatly held by a holder on the steel front door, clear floor, warm daylight, no text.'],
      ['CTA', 4, "제품 정보는 댓글에 '{키워드}' ☂️", '현관문에 붙은 우산꽂이 제품 클로즈업',
        'Vertical 9:16 slow close-up of a slim dark gray umbrella holder mounted on a steel door with one umbrella inside, soft light, shallow depth of field, no text.'],
    ], ['호환되는 철제 표면에 자석으로 부착 가능', '장우산과 접이식 우산 모두 수납 가능']),
    fixtureReel_('구성 소개: 상단·하단 분리형', [
      ['HOOK', 3, '우산꽂이가 두 조각인 이유', '두 조각으로 된 우산꽂이 부품을 양손에 하나씩 든 모습',
        'Vertical 9:16 close-up, two hands each holding one piece of a two-piece dark gray umbrella holder in a bright entryway, realistic, no text.'],
      ['DEMO', 5, '상단 190×55×50mm,', '상단 부품을 철제 문 위쪽에 붙이는 손',
        'Vertical 9:16 close-up, a hand attaching the upper piece of a dark gray umbrella holder to a steel door, natural light, no text.'],
      ['DEMO', 5, '하단 188×55×82mm, 따로 분리돼요.', '하단 부품을 철제 문 아래쪽에 붙이는 손',
        'Vertical 9:16 close-up, a hand attaching the lower tray piece of a dark gray umbrella holder near the bottom of a steel door, natural light, no text.'],
      ['BENEFIT', 5, '철제 문에 자석으로 착.', '위아래 부품이 붙은 문에 장우산 하나가 서 있는 모습',
        'Vertical 9:16 medium shot, steel apartment door with a two-piece umbrella holder, a long umbrella standing in it, tidy floor, daylight, no text.'],
      ['CTA', 4, "제품 정보는 댓글에 '{키워드}'", '문에 붙은 다크그레이 우산꽂이 클로즈업',
        'Vertical 9:16 slow close-up of a dark gray two-piece umbrella holder on a steel door, soft light, no text.'],
    ], ['상단·하단 분리형 (상단 190×55×50mm, 하단 188×55×82mm)', '호환되는 철제 표면에 자석으로 부착 가능']),
    fixtureReel_('인테리어: 현관 색에 맞춰 고르기', [
      ['HOOK', 3, '현관 분위기에 맞는 우산꽂이?', '밝은 현관 문 앞에서 우산꽂이 색상을 고민하는 손',
        'Vertical 9:16 close-up, a hand holding a small umbrella holder against a light-colored steel front door, bright natural light, no text.'],
      ['PROBLEM', 4, '기대 세운 우산, 자꾸 쓰러지죠.', '벽에 기대 세워 둔 우산이 미끄러져 쓰러지는 모습',
        'Vertical 9:16 medium shot, an umbrella leaning on an entryway wall slowly sliding and falling to the floor, realistic, no text.'],
      ['DEMO', 5, '다크그레이, 그레이, 화이트 중에', '다크그레이·그레이·화이트 우산꽂이 세 개를 나란히 보여 주는 손',
        'Vertical 9:16 top-down shot, three plain umbrella holders in dark gray, gray and white side by side on a wooden shoe bench, soft light, no text.'],
      ['BENEFIT', 5, '문 색에 맞춰 골라 붙이면 돼요.', '흰 철제 문에 흰색 우산꽂이가 붙어 정돈된 현관',
        'Vertical 9:16 wide shot, white steel apartment door with a white umbrella holder holding umbrellas, tidy floor, warm light, no text.'],
      ['CTA', 4, "제품 정보는 댓글에 '{키워드}'", '문에 붙은 흰색 우산꽂이 클로즈업',
        'Vertical 9:16 slow close-up of a white umbrella holder on a white steel door, one umbrella inside, soft light, no text.'],
    ], ['색상: 다크그레이, 그레이, 화이트', '호환되는 철제 표면에 자석으로 부착 가능']),
  ],
};
