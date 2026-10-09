/**
 * PRD-001 test fixture. Facts come only from README.md "First product".
 * Category/target are illustrative test inputs, not product claims.
 * URLs are intentionally blank and permission is "미확인" — they must be verified by the operator.
 *
 * FIXTURE_PRD_001_GEMINI_RESPONSE is a hand-written sample in the expected schema,
 * NOT a recorded Gemini response.
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

const FIXTURE_PRD_001_GEMINI_RESPONSE = {
  reels: [
    {
      concept: '문제 해결: 현관 바닥에 쓰러진 우산 정리',
      hook: '현관에 우산 또 쓰러져 있나요?',
      narration:
        '비 오는 날마다 현관 바닥에 우산이 굴러다닌다면, 자석형 우산꽂이를 철제 현관문에 붙여 보세요. 장우산도 접이식 우산도 한 번에 정리됩니다.',
      captions: ['현관에 우산 또 쓰러져 있나요?', '철제 현관문에 자석으로 착', '장우산도 접이식 우산도 OK'],
      scenes: [
        {
          scene_no: 1,
          duration_sec: 3,
          visual: '현관 바닥에 우산 두 개가 쓰러져 있는 모습',
          on_screen_text: '현관에 우산 또 쓰러져 있나요?',
          flow_prompt:
            'Vertical 9:16 photorealistic shot of a narrow Korean apartment entryway floor with two wet umbrellas lying messily on tiles, soft natural daylight, no text, no logos.',
        },
        {
          scene_no: 2,
          duration_sec: 4,
          visual: '회색 우산꽂이를 철제 현관문 아래쪽에 붙이는 손',
          on_screen_text: '철제 현관문에 자석으로 착',
          flow_prompt:
            'Vertical 9:16 close-up of a hand placing a plain gray rectangular magnetic umbrella holder onto the lower part of a steel apartment front door, natural light, unbranded product, no text.',
        },
        {
          scene_no: 3,
          duration_sec: 5,
          visual: '장우산과 접이식 우산을 차례로 꽂는 모습',
          on_screen_text: '장우산도 접이식 우산도 OK',
          flow_prompt:
            'Vertical 9:16 medium shot of a person sliding a long umbrella and then a folding umbrella into a slim gray umbrella holder attached to a steel door, tidy entryway, no logos, no readable text.',
        },
      ],
      facts_used: ['호환되는 철제 표면에 자석으로 부착 가능', '장우산과 접이식 우산 모두 수납 가능'],
    },
    {
      concept: '구성 소개: 상단·하단 분리형 구조',
      hook: '우산꽂이가 두 조각인 이유',
      narration:
        '이 우산꽂이는 상단과 하단이 분리된 구조예요. 상단은 190×55×50mm, 하단은 188×55×82mm라서 현관 공간에 맞게 붙일 수 있어요.',
      captions: ['우산꽂이가 두 조각인 이유', '상단 190×55×50mm', '하단 188×55×82mm'],
      scenes: [
        {
          scene_no: 1,
          duration_sec: 3,
          visual: '테이블 위에 놓인 상단·하단 두 부품',
          on_screen_text: '우산꽂이가 두 조각인 이유',
          flow_prompt:
            'Vertical 9:16 top-down shot of two plain dark gray plastic pieces of an umbrella holder, a shorter top piece and a deeper bottom tray, on a light wooden table, no branding.',
        },
        {
          scene_no: 2,
          duration_sec: 4,
          visual: '상단 부품을 들어 보이는 손',
          on_screen_text: '상단 190×55×50mm',
          flow_prompt:
            'Vertical 9:16 close-up of a hand lifting a slim dark gray umbrella holder top piece toward the camera, soft studio light, neutral background, no text or logos.',
        },
        {
          scene_no: 3,
          duration_sec: 4,
          visual: '하단 부품을 들어 보이는 손',
          on_screen_text: '하단 188×55×82mm',
          flow_prompt:
            'Vertical 9:16 close-up of a hand holding a dark gray umbrella holder bottom tray piece, showing its depth, soft studio light, neutral background, no text or logos.',
        },
        {
          scene_no: 4,
          duration_sec: 4,
          visual: '두 부품이 철제 문에 위아래로 붙어 있는 완성 모습',
          on_screen_text: '',
          flow_prompt:
            'Vertical 9:16 shot of a steel apartment door with a dark gray two-piece umbrella holder attached, top piece above and bottom tray below, one umbrella standing inside, natural light.',
        },
      ],
      facts_used: ['상단·하단 분리형 (상단 190×55×50mm, 하단 188×55×82mm)', '호환되는 철제 표면에 자석으로 부착 가능'],
    },
    {
      concept: '인테리어 비포/애프터: 현관 색상 매칭',
      hook: '현관 분위기에 맞춰 고르는 우산꽂이',
      narration:
        '현관 문 색에 맞춰 다크그레이, 그레이, 화이트 중에 골라 보세요. 철제 현관문에 붙이니 바닥이 깔끔해졌어요.',
      captions: ['현관 분위기에 맞춰 고르기', '다크그레이 · 그레이 · 화이트', '바닥이 깔끔해진 현관'],
      scenes: [
        {
          scene_no: 1,
          duration_sec: 3,
          visual: '우산이 바닥에 놓인 어수선한 현관 (비포)',
          on_screen_text: '현관 분위기에 맞춰 고르기',
          flow_prompt:
            'Vertical 9:16 wide shot of a cluttered small Korean apartment entryway with umbrellas leaning on the wall and floor, natural morning light, no text, no logos.',
        },
        {
          scene_no: 2,
          duration_sec: 4,
          visual: '다크그레이, 그레이, 화이트 세 가지 색상 우산꽂이 나란히',
          on_screen_text: '다크그레이 · 그레이 · 화이트',
          flow_prompt:
            'Vertical 9:16 product lineup of three plain unbranded slim umbrella holders in dark gray, gray and white standing side by side on a white surface, soft even lighting.',
        },
        {
          scene_no: 3,
          duration_sec: 5,
          visual: '정돈된 현관, 문에 붙은 우산꽂이 (애프터)',
          on_screen_text: '바닥이 깔끔해진 현관',
          flow_prompt:
            'Vertical 9:16 wide shot of the same small entryway now tidy, a white umbrella holder attached to a steel front door holding umbrellas, clear floor, natural light, no text.',
        },
      ],
      facts_used: ['색상: 다크그레이, 그레이, 화이트', '호환되는 철제 표면에 자석으로 부착 가능'],
    },
  ],
};
