/**
 * Reels Factory — shared configuration.
 *
 * Secrets (GEMINI_API_KEY) are NOT stored here. They live in
 * Apps Script → Project Settings → Script Properties.
 */

const RF_CONFIG = {
  SHEETS: {
    PRODUCTS: 'PRODUCTS',
    REELS: 'REELS',
    PERFORMANCE: 'PERFORMANCE',
    LOG: 'LOG',
    AUDIT: 'AUDIT',
  },

  // Existing PRODUCTS columns (A–I). Matched by header name, never rewritten.
  PRODUCT_FIELDS: {
    id: '상품ID',
    name: '상품명',
    category: '카테고리',
    features: '확인된 기능',
    target: '타깃',
    affiliateUrl: '쿠팡파트너스 URL',
    sourceUrl: '영상 소스 URL',
    permission: '영상 사용 허가 상태',
    status: '제작 상태',
  },

  // Optional PRODUCTS columns the operator may add (right of column I). Never required, never written.
  PRODUCT_OPTIONAL_FIELDS: {
    keyword: 'ManyChat 키워드', // e.g. 우산 — shared by this product's reels, unique across products
    appearance: '제품 외형', // e.g. 슬림한 사각 두 조각, 무광 다크그레이 플라스틱 — used in Flow prompts
  },

  REELS_HEADERS: [
    '릴스ID',
    '상품ID',
    '버전',
    '컨셉',
    '후킹',
    '내레이션',
    '자막',
    '장면(JSON)',
    'Flow 프롬프트',
    'Flow 생성',
    'CTA',
    'ManyChat 키워드',
    '광고 표기',
    '사용한 확인 기능',
    '영상 사용 허가 상태',
    '제작 상태',
    '검토 메모',
    '생성 모델',
    '생성일시',
    // Approval workflow (appended after the MVP columns so existing rows keep their layout).
    '상태',
    '대본 버전',
    '승인 대본 버전',
    '승인 대본 해시',
    '대본 검토자',
    '대본 검토일시',
    '대본 검토 메모',
    '영상 버전',
    '영상 파일 URL',
    '영상 검토자',
    '영상 검토일시',
    '영상 검토 메모',
    '게시 확인일시',
    'ManyChat 설정 확인일시',
    '인스타그램 URL',
    '오류',
    // Written automatically on script approval (not part of the approved fingerprint).
    'Flow 장면 프롬프트',
  ],

  // Append-only history of every operator decision and system transition.
  AUDIT_HEADERS: ['일시', '릴스ID', '상품ID', '작업', '이전 상태', '새 상태', '대본 버전', '영상 버전', '작업자', '메모', '스냅샷(JSON)'],

  PERFORMANCE_HEADERS: [
    '릴스ID',
    '게시일',
    '인스타그램 URL',
    '조회수',
    '좋아요',
    '댓글',
    '저장',
    '공유',
    'ManyChat DM 발송수',
    '링크 클릭수',
    '주문수',
    '수익(원)',
    '메모',
  ],

  LOG_HEADERS: ['일시', '레벨', '작업', '상품ID', '메시지', '상세'],

  PRODUCT_ID_PATTERN: /^PRD-\d{3,}$/,
  REELS_PER_PRODUCT: 3,

  GEMINI_API_BASE: 'https://generativelanguage.googleapis.com/v1beta/models/',
  // gemini-3.5-flash: GA Flash model with structured output (ai.google.dev/gemini-api/docs/models).
  // gemini-2.5-flash is scheduled for shutdown on 2026-10-16. Override with Script Property GEMINI_MODEL.
  DEFAULT_GEMINI_MODEL: 'gemini-3.5-flash',
  // Used only if the configured model returns 404 (not found → nothing generated or billed).
  GEMINI_FALLBACK_MODELS: ['gemini-flash-latest'],
  MAX_GEMINI_ATTEMPTS: 2,

  // Coupang Partners required disclosure wording. Inserted by code, never by the model.
  AFFILIATE_DISCLOSURE:
    '이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.',

  FLOW_STATUS_MANUAL: '수동 생성 필요 (Google Flow는 Gemini API로 호출되지 않음)',
  PERMISSION_UNVERIFIED_NOTE:
    '영상 사용 허가 미확인 — 쿠팡/판매처 미디어를 AI 편집·광고에 사용하기 전 허가를 확인하세요.',
  // Values in PRODUCTS.영상 사용 허가 상태 that count as verified permission.
  // '자체 제작' = only operator-shot or AI-generated footage is used, no marketplace media.
  PERMISSION_APPROVED_VALUES: ['허가', '허가됨', '승인', '승인됨', '확인 완료', '허가 완료', '자체 제작'],

  // Hosts accepted for PRODUCTS.쿠팡파트너스 URL before a reel can be marked ready to publish.
  AFFILIATE_URL_HOSTS: ['link.coupang.com', 'coupa.ng'],

  // Script Property holding comma-separated Google account emails allowed to use the dashboard.
  REVIEWERS_PROPERTY: 'RF_REVIEWERS',

  LIMITS: {
    HOOK_MAX_CHARS: 40,
    NARRATION_MAX_CHARS: 300,
    CAPTION_MAX_CHARS: 40,
    MIN_SCENES: 3,
    MAX_SCENES: 6,
    MIN_TOTAL_SEC: 10,
    MAX_TOTAL_SEC: 40,
    MIN_FLOW_PROMPT_CHARS: 30,
    // Storyboard (video-first template): one narration line per scene = the subtitle.
    SCENE_MIN_SEC: 2,
    SCENE_MAX_SEC: 6,
    SCENE_NARRATION_MAX_CHARS: 30,
  },

  // Google Flow prompts generated (free, by code) after SCRIPT_APPROVED: one 8-second clip per scene.
  FLOW: {
    CLIP_SEC: 8,
    // Unused head/tail of each clip. A scene longer than CLIP_SEC − CLIP_MARGIN_SEC needs more clips.
    CLIP_MARGIN_SEC: 0.5,
    ENVIRONMENT: 'a real, lived-in small Korean apartment, natural daylight from a window or door, realistic everyday colours',
    CAMERA: {
      HOOK: 'handheld medium shot at eye level, slight natural movement; ends with a quick natural whip pan',
      PROBLEM: 'handheld medium shot that slowly moves closer to the problem detail',
      EMPATHY: 'handheld medium shot that slowly moves closer to the annoying detail, as if the viewer is standing there',
      SOLUTION: 'handheld medium shot; the product comes into frame naturally in the same place as the problem',
      DEMO: 'starts as a close-up of the hands using the product, then slowly pulls back to show the product in place; handheld, smooth',
      BENEFIT: 'slow handheld walk-through: wide view of the space first, then a closer look at the tidy result',
      CTA: 'slow push-in to a close-up of the product in place, then hold steady for the last 2 seconds',
    },
    INTERACTION: {
      HOOK: 'show the everyday situation; the product may be absent or only in the background',
      PROBLEM: 'show the problem clearly; do not show the product solving it yet',
      EMPATHY: 'show why the situation is annoying (clutter, no space, things in the way); no product yet',
      SOLUTION: 'a person\'s hands bring in or place the product in the space from the earlier scenes; calm and natural, no presenting gesture',
      DEMO: 'a person\'s hands use the product exactly as described, only in ways the verified features allow',
      BENEFIT: 'show the result with the product in place and being used naturally',
      CTA: 'the product is the clear subject, mounted or placed exactly as in the earlier scenes',
    },
  },

  // Story structure. New scripts: HOOK → EMPATHY → SOLUTION → DEMO → CTA (BENEFIT optional before CTA).
  // Older scripts (HOOK → PROBLEM → DEMO → BENEFIT → CTA) stay valid. PROBLEM and EMPATHY share a slot.
  BEATS: ['HOOK', 'PROBLEM', 'EMPATHY', 'SOLUTION', 'DEMO', 'BENEFIT', 'CTA'],
  BEAT_RANK: { HOOK: 0, PROBLEM: 1, EMPATHY: 1, SOLUTION: 2, DEMO: 3, BENEFIT: 4, CTA: 5 },
  // Beats where the product is on screen (Flow prompts and the renderer's footage check).
  PRODUCT_BEATS: ['SOLUTION', 'DEMO', 'BENEFIT', 'CTA'],

  // Creative angles: one reel each, so the three scripts never feel alike.
  ANGLES: {
    EVERYDAY_FRUSTRATION: 'A 일상 불편',
    SMALL_SPACE: 'B 좁은 공간',
    LIFESTYLE_SITUATION: 'C 생활 상황',
  },

  // Hook style for new Gemini scripts (not applied to reviewer edits): a relatable problem, spoken in
  // the first ~2–3 seconds — not an ad. Each pattern is a common ad-style hook.
  HOOK_STYLE: {
    MAX_CHARS: 25,
    AD_PATTERNS: [
      { pattern: /니다[.!?~…]*$/, why: '광고 문구 같은 "~니다" 말투' },
      { pattern: /(다면|라면|이라면)\s*[?？]*[.!~…]*$/, why: '"~다면?" 같은 뻔한 질문형' },
      { pattern: /(하시나요|시나요|신가요|있나요|아시나요|어떨까요|어떠세요|궁금하지\s*않|해\s*보셨나요)\s*[?？]*[.!~…]*$/, why: '"~하시나요?" 같은 뻔한 질문형' },
      { pattern: /(하세요|해\s*보세요|만나\s*보세요|확인하세요)[.!~…]*$/, why: '광고 같은 권유형' },
      { pattern: /(하나로|소개|추천|필수템|꿀템|신박템|강추|이것만|역대)/, why: '광고 문구' },
      { pattern: /달라(집니다|져요|졌어요|지는)/, why: '"~이 달라집니다" 같은 결과 약속' },
    ],
  },
  // Written by Gemini in the CTA line; replaced with the reel's ManyChat keyword at render time.
  KEYWORD_PLACEHOLDER: '{키워드}',

  // Exaggerated / unverifiable claims that must not appear in viewer-facing text.
  BANNED_PHRASES: [
    '최저가',
    '100%',
    '무조건',
    '완벽',
    '평생',
    '절대',
    '1위',
    '역대급',
    '품절 임박',
    '마감 임박',
    '효과 보장',
    '보장합니다',
    '세상에서',
    '유일한',
  ],

  // Product claims that need support in 확인된 기능 (checked in hook, narration, captions, scene lines).
  // Group 1 is the claim term; it is allowed when the verified facts or product name contain it.
  // Natural paraphrases of verified facts ("자석으로 붙여요", "철제 현관문에 붙일 수 있어요") pass.
  CLAIM_RULES: [
    { type: '호환성', pattern: /(냉장고|세탁기|벽면|벽|타일|유리|나무|원목|목문|방화문|알루미늄|스테인리스|대리석|콘크리트|화이트보드|자동차|차량)(?:에도|에|면|문에|문에도)?\s*(?:다|도|잘)?\s*(?:붙|부착|달|설치|고정|쓸 수|사용 가능)/ },
    { type: '호환성', pattern: /((?:모든|어떤|어느|아무)\s*(?:문|현관|곳|표면|데|우산|사이즈))/ },
    { type: '호환성', pattern: /(어디(?:든|에나|서나|에든))/ },
    { type: '성능', pattern: /(튼튼|견고|단단|강력|강한\s*자석|자력|내구|하중|무게|버텨|버티|흔들림|안\s*떨어|떨어지지\s*않|미끄러지지|오래\s*(?:써|쓸|가))/ },
    { type: '기능', pattern: /(방수|방청|배수|물받이|물빠짐|물\s*빠|습기|곰팡이|항균|위생|녹(?:이|슬| 안)|접이식\s*거치대|회전|각도\s*조절|높이\s*조절|잠금)/ },
    { type: '설치', pattern: /(무타공|구멍|드릴|타공|나사|못\s*없이|공구\s*없이|설치\s*끝|\d+\s*초\s*만에)/ },
    { type: '소재', pattern: /(스테인리스|스텐|알루미늄|원목|플라스틱|실리콘|ABS|소재|재질|철제|금속)/ },
    { type: '수납 용량', pattern: /(대용량|여러\s*개|몇\s*개(?:든|라도)|가득|\d+\s*개까지)/ },
    { type: '가격', pattern: /(가격|할인|세일|쿠폰|특가|무료\s*배송|로켓|가성비|저렴|(?<![가-힣])싸(?:요|다|게|고)|(?:만|천)\s*원|공짜|이벤트|혜택)/ },
    { type: '후기·인기', pattern: /(후기|리뷰|별점|평점|구매평|만족도|재구매|판매량|인기|베스트|입소문|난리|품절|대박|핫한|다들\s*(?:사|쓰))/ },
    { type: '체험·결과', pattern: /(써\s*보니|써\s*봤|써\s*본\s|사용해\s*보니|사용해\s*봤|\d+\s*(?:일|주|달|개월)\s*(?:째|동안|간)|한\s*달\s*(?:째|동안|간|써)|일주일\s*(?:째|동안|간|써)|바꿨더니|붙였더니|샀더니)/ },
    { type: '인증', pattern: /(특허|인증|KC|FDA|친환경|무독성|국내산|국산|최고|최강)/ },
  ],
};
