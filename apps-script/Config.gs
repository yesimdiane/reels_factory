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
  // gemini-2.5-flash is scheduled for shutdown on 2026-10-16; override with Script Property GEMINI_MODEL.
  DEFAULT_GEMINI_MODEL: 'gemini-3.5-flash',
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
  },

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
};
