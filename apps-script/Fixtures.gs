/**
 * PRD-001 test fixture. Facts come only from README.md "First product".
 * Category/target are illustrative test inputs, not product claims.
 * URLs are intentionally blank and permission is "미확인" — they must be verified by the operator.
 *
 * FIXTURE_PRD_001_GEMINI_RESPONSE is the REFERENCE SPECIFICATION for new products (the five-hook
 * workflow the operator approved): five hooks H1–H5 (one per type), a recommended hook with a reason,
 * a customer-facing comment keyword, and one 24-second script that starts with the recommended hook
 * (HOOK → EMPATHY → SOLUTION → DEMO → DEMO → CTA) with visual directions, subtitle emphasis, sound
 * effects, Flow prompts and fact IDs. It is hand-written, NOT a recorded Gemini response.
 * Fact IDs follow the 확인된 기능 order (F1 = first line); the wording is true for both the README
 * facts below and the operator's sheet wording (FIXTURE_PRD_001_SHEET_FEATURES).
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

const FIXTURE_PRD_001_GEMINI_RESPONSE = {
  hooks: [
    { id: 'H1', type: 'QUESTION', text: '급하게 출근할 때마다 우산 깜빡하는 사람?',
      visual: '현관문을 급히 나서다 멈칫하고 뒤돌아보는 사람, 신발장 구석에 세워 둔 우산',
      flow_prompt: 'Vertical 9:16 handheld shot, a person in work clothes hurrying out of a small Korean apartment front door, stopping and looking back at an umbrella leaning in the corner, natural light, no text.',
      emphasis: "'깜빡' 흔들림 효과", sfx: '문 닫히는 소리' },
    { id: 'H2', type: 'NUMBER', text: '두 조각만 문에 붙이면 바닥이 비어요',
      visual: '손이 상단·하단 두 조각을 하나씩 들어 보이는 클로즈업 → 우산이 널린 현관 바닥',
      flow_prompt: 'Vertical 9:16 close-up, two hands each holding one piece of a two-piece dark gray umbrella holder, then a quick tilt down to umbrellas cluttering the entryway floor, natural light, no text.',
      emphasis: "'두 조각' 노란색", sfx: '' },
    { id: 'H3', type: 'MYTH', text: '현관 우산 자리, 바닥이 아니에요',
      visual: '현관 바닥에 세워 둔 우산꽂이와 우산 더미를 내려다보는 POV',
      flow_prompt: 'Vertical 9:16 top-down POV, a bulky umbrella stand and several umbrellas taking up a small Korean apartment entryway floor, natural light, realistic, no text.',
      emphasis: "'바닥이 아니에요' 강조", sfx: '띵' },
    { id: 'H4', type: 'SITUATION', text: '비 오는 날, 현관에 젖은 우산이 굴러다녀요',
      visual: '첫 프레임부터 현관 바닥에 아무렇게나 놓인 젖은 우산 클로즈업 → 발이 우산을 피해 지나감',
      flow_prompt: 'Vertical 9:16 handheld close-up, wet umbrellas lying messily on a small Korean apartment entryway floor, a foot stepping around them, rainy-day light, realistic, no text, no logos.',
      emphasis: "'굴러다녀요' 흔들림 효과", sfx: '빗소리' },
    { id: 'H5', type: 'CONCLUSION', text: '좁은 현관 우산 정리, 문에 붙이면 돼요',
      visual: '좁은 현관 와이드 → 철제 현관문 아래쪽을 가리키는 손',
      flow_prompt: 'Vertical 9:16 handheld wide shot of a narrow Korean apartment entryway, then a hand pointing at the lower part of the steel front door, natural light, no text.',
      emphasis: "'문에 붙이면' 강조", sfx: '' },
  ],
  recommended_hook: {
    id: 'H4',
    reason: '첫 프레임부터 젖은 우산이 굴러다니는 현관을 보여 줄 수 있어 영상만 봐도 문제가 바로 보이고, 문에 붙여 바닥을 비우는 해결책과 자연스럽게 이어집니다. 지어낸 경험 없이 시청자 상황만 묘사합니다.',
  },
  comment_keyword: '우산',
  reels: [
    {
      pillar: 'PRODUCT_DISCOVERY',
      concept: '비 오는 날 현관',
      hook: '비 오는 날, 현관에 젖은 우산이 굴러다녀요',
      narration: '',
      captions: [],
      scenes: [
        { beat: 'HOOK', duration_sec: 3, narration: '비 오는 날, 현관에 젖은 우산이 굴러다녀요',
          visual: '첫 프레임부터 현관 바닥에 아무렇게나 놓인 젖은 우산 클로즈업 → 발이 우산을 피해 지나감',
          emphasis: "'굴러다녀요' 흔들림 효과", sfx: '빗소리',
          flow_prompt: 'Vertical 9:16 handheld close-up, wet umbrellas lying messily on a small Korean apartment entryway floor, a foot stepping around them, rainy-day light, realistic, no text, no logos.',
          fact_ids: [] },
        { beat: 'EMPATHY', duration_sec: 4, narration: '신발 둘 자리도 모자라잖아요',
          visual: '신발로 꽉 찬 좁은 현관을 위에서 내려다본 POV',
          emphasis: "'모자라잖아요' 빨간색", sfx: '',
          flow_prompt: 'Vertical 9:16 top-down POV, a tiny Korean apartment entryway floor crowded with shoes and no free space, natural light, realistic, no text.',
          fact_ids: [] },
        { beat: 'SOLUTION', duration_sec: 5, narration: '자석이라 철제 현관문에 붙이면 돼요',
          visual: '손이 우산꽂이를 철제 현관문 아래쪽에 자석으로 붙이는 순간 클로즈업',
          emphasis: "'현관문에' 강조", sfx: '착',
          flow_prompt: 'Vertical 9:16 close-up, a hand placing a slim dark gray magnetic umbrella holder onto the lower part of a steel apartment front door, natural light, realistic, no text.',
          fact_ids: ['F1'] },
        { beat: 'DEMO', duration_sec: 5, narration: '긴 우산도 접는 우산도 쏙 꽂아요',
          visual: '문에 붙은 우산꽂이에 장우산 → 접이식 우산을 차례로 꽂는 장면',
          emphasis: "'쏙' 통통 튀는 효과", sfx: '쏙 (두 번)',
          flow_prompt: 'Vertical 9:16 medium shot, a person sliding a long umbrella and then a folding umbrella into a slim dark gray holder attached to a steel front door, natural light, no text.',
          fact_ids: ['F3'] },
        { beat: 'DEMO', duration_sec: 4, narration: '위아래 두 조각으로 나뉘어 있어요',
          visual: '상단·하단 조각을 손으로 하나씩 들어 보여 주는 클로즈업',
          emphasis: "'두 조각' 노란색", sfx: '',
          flow_prompt: 'Vertical 9:16 close-up, two hands each holding one piece of a two-piece dark gray umbrella holder in a bright entryway, realistic, no text.',
          fact_ids: ['F2'] },
        { beat: 'CTA', duration_sec: 3, narration: "저장해 두고, 댓글에 '{키워드}' 남겨 주세요",
          visual: '문에 붙은 우산꽂이와 비어 있는 현관 바닥 와이드 → 제품 클로즈업',
          emphasis: '저장 아이콘 깜빡임', sfx: '띵',
          flow_prompt: 'Vertical 9:16 slow push-in to a slim dark gray umbrella holder on a steel door with one umbrella inside, clear entryway floor, soft light, no text.',
          fact_ids: [] },
      ].map(function (sc, i) {
        return Object.assign({ scene_no: i + 1, on_screen_text: '' }, sc);
      }),
      facts_used: ['F1', 'F2', 'F3'],
      needs_verification: [],
    },
  ],
};
FIXTURE_PRD_001_GEMINI_RESPONSE.reels.forEach(function (r) {
  r.captions = r.scenes.map(function (sc) { return sc.narration; });
  r.narration = r.captions.join(' ');
});
