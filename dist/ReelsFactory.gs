/**
 * Reels Factory — single-file Apps Script bundle. GENERATED FILE, do not edit by hand.
 * Source: apps-script/*.gs. Rebuild with `npm run build`.
 * Install: paste this whole file into Extensions → Apps Script (see docs/setup.md).
 *
 * @OnlyCurrentDoc  Limits spreadsheet access to this workbook when scopes are auto-detected.
 */
// ===== Config.gs =====
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
      DEMO: 'starts as a close-up of the hands using the product, then slowly pulls back to show the product in place; handheld, smooth',
      BENEFIT: 'slow handheld walk-through: wide view of the space first, then a closer look at the tidy result',
      CTA: 'slow push-in to a close-up of the product in place, then hold steady for the last 2 seconds',
    },
    INTERACTION: {
      HOOK: 'show the everyday situation; the product may be absent or only in the background',
      PROBLEM: 'show the problem clearly; do not show the product solving it yet',
      DEMO: 'a person\'s hands use the product exactly as described, only in ways the verified features allow',
      BENEFIT: 'show the result with the product in place and being used naturally',
      CTA: 'the product is the clear subject, mounted or placed exactly as in the earlier scenes',
    },
  },

  // Story structure. PROBLEM may be folded into the HOOK scene; DEMO and BENEFIT are required.
  BEATS: ['HOOK', 'PROBLEM', 'DEMO', 'BENEFIT', 'CTA'],
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
    { type: '인증', pattern: /(특허|인증|KC|FDA|친환경|무독성|국내산|국산|최고|최강)/ },
  ],
};

// ===== Validation.gs =====
/**
 * Pure validation helpers (no Apps Script services) so they can be unit-tested in Node.
 */

function normalizeText(value) {
  return String(value == null ? '' : value)
    .replace(/[ \s]+/g, ' ')
    .trim();
}

/**
 * Splits the PRODUCTS "확인된 기능" cell into individual facts.
 * One fact per line or separated by ";". Commas are kept (e.g. colour lists).
 */
function parseConfirmedFeatures(text) {
  return String(text == null ? '' : text)
    .split(/[\n\r;]+/)
    .map(function (f) {
      return normalizeText(f.replace(/^[-•*]\s*/, ''));
    })
    .filter(function (f) {
      return f.length > 0;
    });
}

/** Returns a list of actionable errors for a PRODUCTS row object. */
function validateProduct(product) {
  const errors = [];
  const f = RF_CONFIG.PRODUCT_FIELDS;
  if (!normalizeText(product.id)) {
    errors.push('"' + f.id + '" 값이 비어 있습니다.');
  } else if (!RF_CONFIG.PRODUCT_ID_PATTERN.test(normalizeText(product.id))) {
    errors.push('"' + f.id + '" 형식이 올바르지 않습니다: "' + product.id + '" (예: PRD-001).');
  }
  if (!normalizeText(product.name)) {
    errors.push('"' + f.name + '" 값이 비어 있습니다.');
  }
  const kw = normalizeText(product.keyword);
  if (kw && !/^[^\s'"{}<>]{1,20}$/.test(kw)) {
    errors.push('"' + RF_CONFIG.PRODUCT_OPTIONAL_FIELDS.keyword + '"는 공백·따옴표 없이 20자 이내 한 단어여야 합니다 (예: 우산).');
  }
  if (parseConfirmedFeatures(product.features).length === 0) {
    errors.push(
      '"' + f.features + '" 값이 비어 있습니다. 검증된 기능을 한 줄에 하나씩 입력하세요.'
    );
  }
  return errors;
}

/** Extracts all numeric tokens (e.g. "190", "5.5") from text. */
function extractNumbers(text) {
  return String(text == null ? '' : text).match(/\d+(?:\.\d+)?/g) || [];
}

/** Parses model output as JSON, tolerating a ```json fenced block. */
function parseModelJson(rawText) {
  let text = String(rawText == null ? '' : rawText).trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) text = fence[1];
  try {
    return { value: JSON.parse(text), error: null };
  } catch (e) {
    return { value: null, error: 'Gemini 응답이 올바른 JSON이 아닙니다: ' + e.message };
  }
}

function isNonEmptyString_(v) {
  return typeof v === 'string' && normalizeText(v).length > 0;
}

/** Viewer-facing text of a reel: everything that ends up on screen or in the voiceover. */
function viewerFacingTexts_(reel) {
  const texts = [reel.hook, reel.narration];
  (Array.isArray(reel.captions) ? reel.captions : []).forEach(function (c) {
    texts.push(c);
  });
  (Array.isArray(reel.scenes) ? reel.scenes : []).forEach(function (s) {
    if (s) {
      texts.push(s.on_screen_text);
      texts.push(s.narration);
    }
  });
  return texts.filter(function (t) {
    return typeof t === 'string';
  });
}

/** Loose form for matching references and measurements: no spaces or punctuation, × → x, lower case. */
function looseText_(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[×✕✖*]/g, 'x')
    .replace(/[\s·.,:;()\[\]{}'"`~!?\/\\|_\-–—]+/g, '');
}

/** Stable reference for the i-th (0-based) verified fact, as shown to Gemini: F1, F2, … */
function factId(i) {
  return 'F' + (i + 1);
}

/**
 * Measurements in text: tuples like 190x55x50mm (with an optional 상단/하단 label before them)
 * and single numbers with a unit (82mm, 9,900원, 30%). Korean unit words after a number are normalised.
 */
function extractMeasures_(text) {
  let t = String(text == null ? '' : text)
    .replace(/[×✕✖*]/g, 'x')
    .replace(/(\d)\s*(밀리미터|밀리|미리)/g, '$1mm')
    .replace(/(\d)\s*(센티미터|센티|센치)/g, '$1cm')
    .replace(/(\d)\s*(킬로그램|킬로|키로)/g, '$1kg')
    .replace(/(\d)\s*그램/g, '$1g')
    .replace(/(\d)\s*미터/g, '$1m')
    .replace(/(\d)\s*퍼센트/g, '$1%')
    .replace(/(\d),(\d{3})/g, '$1$2');
  const tuples = [];
  const tupleRe = /(상단|하단|윗부분|아랫부분|위쪽|아래쪽)?[\s:：]*(\d+(?:\.\d+)?(?:\s*[xX]\s*\d+(?:\.\d+)?){1,2})\s*(mm|cm|m(?![a-z])|kg|g(?![a-z]))?/g;
  t = t.replace(tupleRe, function (all, label, nums, unit) {
    tuples.push({ text: all.trim(), label: label ? label.charAt(0) : '', nums: nums.replace(/\s+/g, '').toLowerCase(), unit: (unit || '').toLowerCase() });
    return ' ';
  });
  const singles = [];
  const singleRe = /(\d+(?:\.\d+)?)\s*(mm|cm|kg|ml|원|%|m(?![a-z])|g(?![a-z])|l(?![a-z]))/gi;
  let m;
  while ((m = singleRe.exec(t))) singles.push({ text: m[0].trim(), num: m[1], unit: m[2].toLowerCase() });
  return { tuples: tuples, singles: singles };
}

/** Facts, IDs, numbers and measurements a script may rely on, from PRODUCTS.확인된 기능 and 상품명. */
function factContext_(product) {
  const facts = parseConfirmedFeatures(product.features);
  const factSet = {};
  const byLoose = {};
  facts.forEach(function (f, i) {
    factSet[f] = true;
    byLoose[looseText_(f)] = i;
  });
  const allowedNumbers = {};
  extractNumbers(facts.join(' ') + ' ' + product.name).forEach(function (n) {
    allowedNumbers[n] = true;
  });
  const measures = extractMeasures_(facts.join('\n') + '\n' + product.name);
  const unitNumbers = {};
  measures.singles.forEach(function (x) {
    unitNumbers[x.num + x.unit] = true;
  });
  measures.tuples.forEach(function (x) {
    if (x.unit) x.nums.split('x').forEach(function (n) {
      unitNumbers[n + x.unit] = true;
    });
  });
  return {
    facts: facts,
    factSet: factSet,
    byLoose: byLoose,
    allowedNumbers: allowedNumbers,
    tuples: measures.tuples,
    unitNumbers: unitNumbers,
    looseAll: looseText_(facts.join(' ') + ' ' + product.name),
  };
}

/**
 * Resolves a fact reference from Gemini or the sheet to the index of a verified fact, or -1.
 * Accepts the ID ("F2", "F2: …"), the exact sheet wording, or the same wording with different
 * spacing/punctuation. A paraphrase is NOT a reference: unknown references are rejected.
 */
function resolveFactRef_(ref, ctx) {
  const r = normalizeText(ref);
  const id = r.match(/^\[?F\s*(\d+)\]?(?:$|[\s:：.)\]-])/i);
  if (id) {
    const i = Number(id[1]) - 1;
    return i >= 0 && i < ctx.facts.length ? i : -1;
  }
  const loose = looseText_(r);
  return loose && ctx.byLoose[loose] !== undefined ? ctx.byLoose[loose] : -1;
}

/** Fact references of a scene: Gemini's fact_ids (IDs) or the stored facts (sheet wording). */
function sceneFactRefs_(scene) {
  if (!scene) return [];
  if (Array.isArray(scene.fact_ids)) return scene.fact_ids;
  if (Array.isArray(scene.facts)) return scene.facts;
  return [];
}

const RF_COLOR_GROUPS_ = [
  ['화이트', '흰색', '흰', '하얀', '하양', '백색'],
  ['그레이', '회색', '그레이색'],
  ['다크그레이', '진회색', '짙은 회색', '차콜'],
  ['블랙', '검정', '검은', '검은색', '흑색'],
  ['베이지'], ['아이보리'], ['네이비', '남색'], ['핑크', '분홍'], ['민트'], ['실버', '은색'], ['골드', '금색'],
  ['브라운', '갈색'], ['레드', '빨간', '빨강'], ['블루', '파란', '파랑'], ['그린', '초록'], ['옐로', '노란', '노랑'], ['퍼플', '보라'],
];

/**
 * Product claims in viewer-facing text that need support in 확인된 기능: invented features,
 * compatibility, performance, material, price, reviews, certifications, colours. A term that also
 * appears in the verified facts (or product name) is allowed. Returns error strings.
 */
function unsupportedClaims_(text, ctx, where) {
  const errors = [];
  const t = normalizeText(text);
  if (!t) return errors;
  const hint = ' — "' + t + '". 확인된 기능(' + factId(0) + '~' + factId(Math.max(0, ctx.facts.length - 1)) + ')에 없는 내용이니 빼거나 확인된 기능만으로 다시 쓰세요.';
  RF_CONFIG.CLAIM_RULES.forEach(function (rule) {
    const re = new RegExp(rule.pattern.source, 'g');
    let m;
    while ((m = re.exec(t))) {
      const term = m[1] || m[0];
      if (ctx.looseAll.indexOf(looseText_(term)) !== -1) continue;
      errors.push(where + '확인되지 않은 ' + rule.type + ' 주장 "' + term + '"' + hint);
    }
  });
  RF_COLOR_GROUPS_.forEach(function (group) {
    // Longest first, so "다크그레이" is not also read as "그레이".
    const words = group.slice().sort(function (a, b) {
      return b.length - a.length;
    });
    const hit = words.filter(function (w) {
      return t.indexOf(w) !== -1;
    })[0];
    if (!hit) return;
    if (hit === '그레이' && t.indexOf('다크그레이') !== -1 && t.replace(/다크그레이/g, '').indexOf('그레이') === -1) return;
    const known = group.some(function (w) {
      return ctx.looseAll.indexOf(looseText_(w)) !== -1;
    });
    if (!known) errors.push(where + '확인되지 않은 색상 "' + hit + '"' + hint);
  });
  return errors;
}

/** Dimensions, units, prices and percentages must match 확인된 기능 exactly (including 상단/하단). */
function measurementErrors_(text, ctx, where) {
  const errors = [];
  const found = extractMeasures_(text);
  found.tuples.forEach(function (x) {
    const same = ctx.tuples.filter(function (f) {
      return f.nums === x.nums;
    });
    if (!same.length) {
      errors.push(where + '확인된 기능과 다른 치수입니다: "' + x.text + '". 치수는 확인된 기능에 적힌 그대로만 쓰세요.');
      return;
    }
    if (x.unit && !same.some(function (f) { return !f.unit || f.unit === x.unit; })) {
      errors.push(where + '치수 단위가 확인된 기능과 다릅니다: "' + x.text + '" (확인된 단위: ' + same[0].unit + ').');
    }
    if (x.label && !same.some(function (f) { return !f.label || f.label === x.label; })) {
      errors.push(where + '상단/하단 치수가 바뀌었습니다: "' + x.text + '". 확인된 기능의 구분 그대로 쓰세요.');
    }
  });
  found.singles.forEach(function (x) {
    if (x.unit === '원') {
      errors.push(where + '확인되지 않은 가격입니다: "' + x.text + '". 가격·할인은 쓰지 마세요.');
    } else if (!ctx.unitNumbers[x.num + x.unit]) {
      errors.push(where + '확인된 기능에 없는 수치/단위입니다: "' + x.text + '".');
    }
  });
  return errors;
}

/** Viewer-facing texts with a label for error messages. */
function labelledViewerTexts_(reel) {
  const out = [{ where: 'hook', text: reel.hook }, { where: 'narration', text: reel.narration }];
  (Array.isArray(reel.captions) ? reel.captions : []).forEach(function (c, i) {
    out.push({ where: 'captions[' + i + ']', text: c });
  });
  (Array.isArray(reel.scenes) ? reel.scenes : []).forEach(function (s, i) {
    if (!s) return;
    out.push({ where: '장면 ' + (i + 1) + ' narration', text: s.narration });
    out.push({ where: '장면 ' + (i + 1) + ' on_screen_text', text: s.on_screen_text });
  });
  return out.filter(function (x) {
    return typeof x.text === 'string' && normalizeText(x.text);
  });
}

/**
 * Validates one reel script (generated, regenerated or edited by a human) against the schema
 * and the product's confirmed facts. `label` prefixes each error, e.g. "릴스 2".
 */
function validateReelContent(reel, product, label, options) {
  const errors = [];
  // Storyboard rules apply to every new script, and to older scripts once they have beats.
  const storyboard =
    (options && options.requireStoryboard) ||
    (reel && Array.isArray(reel.scenes) && reel.scenes.some(function (sc) {
      return sc && (sc.beat !== undefined || sc.narration !== undefined);
    }));
  const L = RF_CONFIG.LIMITS;
  const ctx = factContext_(product);
  const allowedNumbers = ctx.allowedNumbers;
  const p = label + ': ';
  if (!reel || typeof reel !== 'object') {
    errors.push(p + '객체가 아닙니다.');
    return errors;
  }
  ['concept', 'hook', 'narration'].forEach(function (k) {
    if (!isNonEmptyString_(reel[k])) errors.push(p + '"' + k + '" 값이 비어 있습니다.');
  });
  if (isNonEmptyString_(reel.hook) && reel.hook.length > L.HOOK_MAX_CHARS) {
    errors.push(p + 'hook이 ' + L.HOOK_MAX_CHARS + '자를 초과합니다.');
  }
  if (isNonEmptyString_(reel.narration) && reel.narration.length > L.NARRATION_MAX_CHARS) {
    errors.push(p + 'narration이 ' + L.NARRATION_MAX_CHARS + '자를 초과합니다.');
  }

  if (!Array.isArray(reel.captions) || reel.captions.length === 0) {
    errors.push(p + '"captions" 배열이 비어 있습니다.');
  } else {
    reel.captions.forEach(function (c, ci) {
      if (!isNonEmptyString_(c)) errors.push(p + 'captions[' + ci + ']가 비어 있습니다.');
      else if (c.length > L.CAPTION_MAX_CHARS)
        errors.push(p + 'captions[' + ci + ']가 ' + L.CAPTION_MAX_CHARS + '자를 초과합니다.');
    });
  }

  if (!Array.isArray(reel.scenes)) {
    errors.push(p + '"scenes" 배열이 없습니다.');
  } else {
    if (reel.scenes.length < L.MIN_SCENES || reel.scenes.length > L.MAX_SCENES) {
      errors.push(p + '장면 수는 ' + L.MIN_SCENES + '~' + L.MAX_SCENES + '개여야 합니다 (받은 개수: ' + reel.scenes.length + ').');
    }
    let total = 0;
    reel.scenes.forEach(function (s, si) {
      const sp = p + '장면 ' + (si + 1) + ': ';
      if (!s || typeof s !== 'object') {
        errors.push(sp + '객체가 아닙니다.');
        return;
      }
      if (s.scene_no !== si + 1) errors.push(sp + 'scene_no는 ' + (si + 1) + '이어야 합니다.');
      if (typeof s.duration_sec !== 'number' || !(s.duration_sec > 0)) {
        errors.push(sp + 'duration_sec는 양수여야 합니다.');
      } else {
        total += s.duration_sec;
      }
      if (!isNonEmptyString_(s.visual)) errors.push(sp + '"visual" 값이 비어 있습니다.');
      if (typeof s.on_screen_text !== 'string') errors.push(sp + '"on_screen_text"는 문자열이어야 합니다.');
      if (!isNonEmptyString_(s.flow_prompt) || s.flow_prompt.length < L.MIN_FLOW_PROMPT_CHARS) {
        errors.push(sp + '"flow_prompt"가 비어 있거나 너무 짧습니다 (' + L.MIN_FLOW_PROMPT_CHARS + '자 이상).');
      }
      if (storyboard) {
        if (RF_CONFIG.BEATS.indexOf(s.beat) === -1) errors.push(sp + '"beat"는 ' + RF_CONFIG.BEATS.join('/') + ' 중 하나여야 합니다.');
        if (!isNonEmptyString_(s.narration)) {
          errors.push(sp + '"narration"(이 장면의 내레이션·자막 한 줄)이 비어 있습니다.');
        } else if ([...normalizeText(s.narration)].length > L.SCENE_NARRATION_MAX_CHARS) {
          errors.push(sp + 'narration은 자막 2줄 이내(' + L.SCENE_NARRATION_MAX_CHARS + '자)여야 합니다.');
        }
        // A scene must fit one Google Flow clip (minus margin); the storyboard limit is never looser.
        const maxSec = Math.min(L.SCENE_MAX_SEC, RF_CONFIG.FLOW.CLIP_SEC - RF_CONFIG.FLOW.CLIP_MARGIN_SEC);
        if (typeof s.duration_sec === 'number' && (s.duration_sec < L.SCENE_MIN_SEC || s.duration_sec > maxSec)) {
          errors.push(sp + '장면 길이는 ' + L.SCENE_MIN_SEC + '~' + maxSec + '초여야 합니다 (Flow 클립 ' + RF_CONFIG.FLOW.CLIP_SEC + '초로 덮을 수 있는 길이).');
        }
      }
    });
    if (storyboard) storyboardErrors_(reel.scenes).forEach(function (e) {
      errors.push(p + e);
    });
    if (total < L.MIN_TOTAL_SEC || total > L.MAX_TOTAL_SEC) {
      errors.push(p + '총 길이는 ' + L.MIN_TOTAL_SEC + '~' + L.MAX_TOTAL_SEC + '초여야 합니다 (현재 ' + total + '초).');
    }
  }

  // Fact references: IDs (F1…) from Gemini or the sheet wording stored in REELS. Never free paraphrases.
  const idRange = factId(0) + '~' + factId(Math.max(0, ctx.facts.length - 1));
  if (!Array.isArray(reel.facts_used) || reel.facts_used.length === 0) {
    errors.push(p + '"facts_used"가 비어 있습니다. 확인된 기능 ID(' + idRange + ') 중 최소 1개를 넣으세요.');
  } else {
    reel.facts_used.forEach(function (fact) {
      if (resolveFactRef_(fact, ctx) === -1) {
        errors.push(p + '확인되지 않은 기능을 참조했습니다: "' + fact + '". facts_used에는 확인된 기능 ID(' + idRange + ')만 넣으세요.');
      }
    });
  }
  if (Array.isArray(reel.scenes)) {
    reel.scenes.forEach(function (s, si) {
      if (!s || typeof s !== 'object') return;
      const refs = sceneFactRefs_(s);
      refs.forEach(function (ref) {
        if (resolveFactRef_(ref, ctx) === -1) {
          errors.push(p + '장면 ' + (si + 1) + ': 확인되지 않은 기능을 참조했습니다: "' + ref + '". fact_ids에는 ' + idRange + '만 넣으세요.');
        }
      });
      if (options && options.requireFactRefs && (s.beat === 'DEMO' || s.beat === 'BENEFIT') && !refs.length) {
        errors.push(p + '장면 ' + (si + 1) + ' (' + s.beat + '): 이 장면이 근거로 삼는 확인된 기능 ID를 fact_ids에 넣으세요.');
      }
    });
  }

  labelledViewerTexts_(reel).forEach(function (x) {
    const where = p + x.where + ': ';
    unsupportedClaims_(x.text, ctx, where).concat(measurementErrors_(x.text, ctx, where)).forEach(function (e) {
      errors.push(e);
    });
  });

  const viewerText = viewerFacingTexts_(reel).join('\n');
  extractNumbers(viewerText).forEach(function (n) {
    if (!allowedNumbers[n]) {
      errors.push(p + '확인된 기능에 없는 수치가 포함되어 있습니다: "' + n + '".');
    }
  });
  RF_CONFIG.BANNED_PHRASES.forEach(function (phrase) {
    if (viewerText.indexOf(phrase) !== -1) {
      errors.push(p + '과장/검증 불가 표현이 포함되어 있습니다: "' + phrase + '".');
    }
  });
  if (/https?:\/\/|www\.|coupang\.com|link\.coupang/i.test(viewerText)) {
    errors.push(p + '대본에 URL이 포함되어 있습니다. 링크는 ManyChat DM으로만 전달합니다.');
  }
  return errors;
}

/**
 * Validates the parsed Gemini payload: exactly `expectedCount` reels (default 3), each passing
 * validateReelContent, with distinct concepts and hooks. Returns { errors: string[], reels: object[] }.
 */
function validateGeminiReels(payload, product, expectedCount) {
  const count = expectedCount || RF_CONFIG.REELS_PER_PRODUCT;
  const errors = [];
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.reels)) {
    return { errors: ['응답에 "reels" 배열이 없습니다.'], reels: [], reelErrors: [] };
  }
  const reels = payload.reels;
  if (reels.length !== count) {
    errors.push('릴스 대본은 정확히 ' + count + '개여야 합니다 (받은 개수: ' + reels.length + ').');
  }
  const reelErrors = reels.map(function (reel, i) {
    return dedupe_(validateReelContent(reel, product, '릴스 ' + (i + 1), { requireStoryboard: true, requireFactRefs: true }));
  });
  reelErrors.forEach(function (list) {
    list.forEach(function (e) {
      errors.push(e);
    });
  });

  // The three reels must be distinct concepts.
  const seenHooks = {};
  const seenConcepts = {};
  reels.forEach(function (reel, i) {
    if (!reel) return;
    const h = normalizeText(reel.hook).toLowerCase();
    const c = normalizeText(reel.concept).toLowerCase();
    if (h && seenHooks[h]) errors.push('릴스 ' + (i + 1) + ': hook이 릴스 ' + seenHooks[h] + '와 중복됩니다.');
    if (c && seenConcepts[c]) errors.push('릴스 ' + (i + 1) + ': concept이 릴스 ' + seenConcepts[c] + '와 중복됩니다.');
    if (h) seenHooks[h] = i + 1;
    if (c) seenConcepts[c] = i + 1;
  });

  // De-duplicate identical messages (e.g. the same number repeated).
  const unique = dedupe_(errors);
  return {
    errors: unique,
    reels: unique.length ? [] : reels.map(function (r) {
      return canonicalReel_(r, product);
    }),
    reelErrors: reelErrors,
  };
}

function dedupe_(list) {
  return list.filter(function (e, idx) {
    return list.indexOf(e) === idx;
  });
}

/**
 * A validated reel with fact references replaced by the exact PRODUCTS wording, so REELS keeps
 * human-readable facts (and the same columns and fingerprint as before). Scene references go to
 * scene.facts; facts_used also includes every fact a scene relies on.
 */
function canonicalReel_(reel, product) {
  const ctx = factContext_(product);
  const out = JSON.parse(JSON.stringify(reel));
  const used = [];
  const add = function (ref) {
    const i = resolveFactRef_(ref, ctx);
    if (i !== -1 && used.indexOf(i) === -1) used.push(i);
    return i;
  };
  (out.facts_used || []).forEach(add);
  (out.scenes || []).forEach(function (s) {
    if (!s) return;
    const idx = [];
    sceneFactRefs_(s).forEach(function (ref) {
      const i = add(ref);
      if (i !== -1 && idx.indexOf(i) === -1) idx.push(i);
    });
    delete s.fact_ids;
    s.facts = idx.map(function (i) {
      return ctx.facts[i];
    });
  });
  out.facts_used = used.sort(function (a, b) {
    return a - b;
  }).map(function (i) {
    return ctx.facts[i];
  });
  return out;
}

/**
 * Builds the best payload from several attempts without another paid call: for each position the
 * latest reel that passed on its own. Returns { errors, reels } like validateGeminiReels, or null.
 */
function combineValidReels(attempts, product, expectedCount) {
  const count = expectedCount || RF_CONFIG.REELS_PER_PRODUCT;
  const picked = [];
  for (let i = 0; i < count; i++) {
    for (let a = attempts.length - 1; a >= 0; a--) {
      const at = attempts[a];
      if (at && at.reels && at.reels[i] && at.reelErrors && at.reelErrors[i] && !at.reelErrors[i].length) {
        picked[i] = at.reels[i];
        break;
      }
    }
    if (!picked[i]) return null;
  }
  const res = validateGeminiReels({ reels: picked }, product, count);
  return res.errors.length ? null : res;
}

/** HOOK first, CTA last, DEMO and BENEFIT present, beats in story order, keyword placeholder in the CTA. */
function storyboardErrors_(scenes) {
  const errors = [];
  const beats = scenes.map(function (sc) {
    return sc ? sc.beat : '';
  });
  const order = RF_CONFIG.BEATS;
  if (beats[0] !== 'HOOK') errors.push('첫 장면은 HOOK이어야 합니다.');
  if (beats[beats.length - 1] !== 'CTA') errors.push('마지막 장면은 CTA여야 합니다.');
  ['DEMO', 'BENEFIT'].forEach(function (b) {
    if (beats.indexOf(b) === -1) errors.push(b + ' 장면이 필요합니다.');
  });
  for (let i = 1; i < beats.length; i++) {
    if (order.indexOf(beats[i]) < order.indexOf(beats[i - 1])) {
      errors.push('장면 순서는 HOOK → PROBLEM → DEMO → BENEFIT → CTA여야 합니다.');
      break;
    }
  }
  const cta = scenes[scenes.length - 1];
  if (cta && typeof cta.narration === 'string' && cta.narration.indexOf(RF_CONFIG.KEYWORD_PLACEHOLDER) === -1) {
    errors.push('CTA 내레이션에 댓글 키워드 자리 "' + RF_CONFIG.KEYWORD_PLACEHOLDER + '"가 필요합니다.');
  }
  return errors;
}

/** Finds duplicate values in a list (ignoring blanks). */
function findDuplicates(values) {
  const seen = {};
  const dups = [];
  values.forEach(function (v) {
    const k = normalizeText(v);
    if (!k) return;
    if (seen[k] && dups.indexOf(k) === -1) dups.push(k);
    seen[k] = true;
  });
  return dups;
}

// ===== States.gs =====
/**
 * Approval state machine for REELS rows. Pure functions only (no Apps Script services),
 * so every gate is unit-tested in Node.
 *
 * Operator touchpoints (Issue #2):
 *   1. Select products, enter affiliate URL / verified facts / media permission (PRODUCTS sheet)
 *   2. Approve, edit, request changes or reject scripts before any video work
 *   3. Approve or reject finished videos
 *   4. Publish to Instagram and configure ManyChat manually, then confirm both
 */

const RF_STATUS = {
  SCRIPT_REVIEW_PENDING: 'SCRIPT_REVIEW_PENDING',
  SCRIPT_CHANGES_REQUESTED: 'SCRIPT_CHANGES_REQUESTED',
  SCRIPT_REJECTED: 'SCRIPT_REJECTED',
  SCRIPT_APPROVED: 'SCRIPT_APPROVED',
  VIDEO_IN_PRODUCTION: 'VIDEO_IN_PRODUCTION',
  VIDEO_FAILED: 'VIDEO_FAILED',
  VIDEO_REVIEW_PENDING: 'VIDEO_REVIEW_PENDING',
  VIDEO_CHANGES_REQUESTED: 'VIDEO_CHANGES_REQUESTED',
  VIDEO_REJECTED: 'VIDEO_REJECTED',
  VIDEO_APPROVED: 'VIDEO_APPROVED',
  READY_TO_PUBLISH: 'READY_TO_PUBLISH',
  COMPLETED: 'COMPLETED',
};

const RF_STATUS_LABELS = {
  SCRIPT_REVIEW_PENDING: '대본 검토 대기',
  SCRIPT_CHANGES_REQUESTED: '대본 수정 요청됨',
  SCRIPT_REJECTED: '대본 반려',
  SCRIPT_APPROVED: '대본 승인',
  VIDEO_IN_PRODUCTION: '영상 제작 중',
  VIDEO_FAILED: '영상 제작 오류',
  VIDEO_REVIEW_PENDING: '영상 검토 대기',
  VIDEO_CHANGES_REQUESTED: '영상 수정 요청됨',
  VIDEO_REJECTED: '영상 반려',
  VIDEO_APPROVED: '영상 승인',
  READY_TO_PUBLISH: '게시 준비 완료',
  COMPLETED: '게시·ManyChat 확인 완료',
};

// Cells that make up "the script". The approved fingerprint covers all of them, so any later edit
// (in the dashboard or directly in the sheet) blocks video work until the new version is approved.
const RF_SCRIPT_FIELDS = [
  '컨셉',
  '후킹',
  '내레이션',
  '자막',
  '장면(JSON)',
  'Flow 프롬프트',
  'CTA',
  'ManyChat 키워드',
  '광고 표기',
  '사용한 확인 기능',
];

/**
 * touchpoint: 0 = system step, 1–4 = operator responsibility.
 * from: statuses the action is allowed from. to: resulting status (COMPUTED → decided in planTransition).
 */
const RF_ACTIONS = {
  APPROVE_SCRIPT: { touchpoint: 2, from: ['SCRIPT_REVIEW_PENDING'], to: 'SCRIPT_APPROVED', label: '대본 승인' },
  REQUEST_SCRIPT_CHANGES: { touchpoint: 2, from: ['SCRIPT_REVIEW_PENDING'], to: 'SCRIPT_CHANGES_REQUESTED', label: '대본 수정 요청', noteRequired: true },
  EDIT_SCRIPT: { touchpoint: 2, from: ['SCRIPT_REVIEW_PENDING', 'SCRIPT_CHANGES_REQUESTED'], to: 'SCRIPT_REVIEW_PENDING', label: '대본 직접 수정' },
  REGENERATE_SCRIPT: { touchpoint: 0, from: ['SCRIPT_CHANGES_REQUESTED'], to: 'SCRIPT_REVIEW_PENDING', label: '대본 재생성 (Gemini)' },
  REJECT_SCRIPT: { touchpoint: 2, from: ['SCRIPT_REVIEW_PENDING', 'SCRIPT_CHANGES_REQUESTED'], to: 'SCRIPT_REJECTED', label: '대본 반려' },
  REOPEN_SCRIPT: { touchpoint: 2, from: ['SCRIPT_APPROVED'], to: 'SCRIPT_REVIEW_PENDING', label: '대본 승인 취소' },
  START_VIDEO: { touchpoint: 0, from: ['SCRIPT_APPROVED', 'VIDEO_CHANGES_REQUESTED', 'VIDEO_FAILED'], to: 'VIDEO_IN_PRODUCTION', label: '영상 제작 시작' },
  REGISTER_VIDEO: { touchpoint: 0, from: ['VIDEO_IN_PRODUCTION'], to: 'VIDEO_REVIEW_PENDING', label: '완성 영상 등록' },
  MARK_VIDEO_FAILED: { touchpoint: 0, from: ['VIDEO_IN_PRODUCTION'], to: 'VIDEO_FAILED', label: '영상 제작 오류', noteRequired: true },
  APPROVE_VIDEO: { touchpoint: 3, from: ['VIDEO_REVIEW_PENDING'], to: 'VIDEO_APPROVED', label: '영상 승인' },
  REQUEST_VIDEO_CHANGES: { touchpoint: 3, from: ['VIDEO_REVIEW_PENDING'], to: 'VIDEO_CHANGES_REQUESTED', label: '영상 수정 요청', noteRequired: true },
  REJECT_VIDEO: { touchpoint: 3, from: ['VIDEO_REVIEW_PENDING'], to: 'VIDEO_REJECTED', label: '영상 반려' },
  MARK_READY_TO_PUBLISH: { touchpoint: 0, from: ['VIDEO_APPROVED'], to: 'READY_TO_PUBLISH', label: '게시 준비' },
  CONFIRM_PUBLISHED: { touchpoint: 4, from: ['READY_TO_PUBLISH'], to: 'COMPUTED', label: '인스타그램 게시 확인' },
  CONFIRM_MANYCHAT: { touchpoint: 4, from: ['READY_TO_PUBLISH'], to: 'COMPUTED', label: 'ManyChat 설정 확인' },
};

// Values written by the MVP before the 상태 column existed.
const RF_LEGACY_STATUS = { '대본 검토 대기': 'SCRIPT_REVIEW_PENDING' };

function cellText_(v) {
  if (v instanceof Date) return v.toISOString();
  return String(v == null ? '' : v).replace(/\r\n?/g, '\n').trim();
}

/** 53-bit string hash (cyrb53). Detects edits; not a security primitive. */
function hash53_(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/** Fingerprint of the script cells of a REELS row (object keyed by header name). */
function scriptFingerprint(row) {
  return 'v1-' + hash53_(JSON.stringify(RF_SCRIPT_FIELDS.map(function (f) {
    return cellText_(row[f]);
  })));
}

/** Current status code of a row, understanding MVP-era rows that only have 제작 상태. */
function reelStatus(row) {
  const code = cellText_(row['상태']);
  if (RF_STATUS[code]) return code;
  const legacy = RF_LEGACY_STATUS[cellText_(row['제작 상태'])];
  return legacy || '';
}

function scriptVersionOf(row) {
  return parseInt(cellText_(row['대본 버전']), 10) || 1;
}

function videoVersionOf(row) {
  return parseInt(cellText_(row['영상 버전']), 10) || 0;
}

/** True if the row's current script is exactly the version that was approved. */
function isApprovedScriptIntact(row) {
  const approvedVersion = parseInt(cellText_(row['승인 대본 버전']), 10);
  return (
    !!cellText_(row['승인 대본 해시']) &&
    approvedVersion === scriptVersionOf(row) &&
    cellText_(row['승인 대본 해시']) === scriptFingerprint(row)
  );
}

/** Script cells → reel object in the Gemini schema. */
function rowToReel(row) {
  let scenes = [];
  try {
    scenes = JSON.parse(cellText_(row['장면(JSON)']) || '[]');
  } catch (e) {
    scenes = null;
  }
  return {
    concept: cellText_(row['컨셉']),
    hook: cellText_(row['후킹']),
    narration: cellText_(row['내레이션']),
    captions: cellText_(row['자막']).split('\n').map(normalizeText).filter(function (c) {
      return c.length > 0;
    }),
    scenes: scenes,
    facts_used: cellText_(row['사용한 확인 기능']).split('\n').map(normalizeText).filter(function (c) {
      return c.length > 0;
    }),
  };
}

/** Reel object → script cells (except keyword/CTA/disclosure, which are code-owned). */
function reelToScriptCells(reel) {
  // Storyboard scripts: the scene lines ARE the narration and the subtitles (single source).
  const lines = Array.isArray(reel.scenes) && reel.scenes.length && reel.scenes.every(function (sc) {
    return sc && typeof sc.narration === 'string' && sc.narration.trim();
  })
    ? reel.scenes.map(function (sc) {
        return normalizeText(sc.narration);
      })
    : null;
  return {
    '컨셉': normalizeText(reel.concept),
    '후킹': normalizeText(reel.hook),
    '내레이션': lines ? lines.join(' ') : normalizeText(reel.narration),
    '자막': (lines || reel.captions.map(normalizeText)).join('\n'),
    '장면(JSON)': JSON.stringify(reel.scenes),
    'Flow 프롬프트': reel.scenes
      .map(function (s) {
        return 'S' + s.scene_no + ' (' + s.duration_sec + 's): ' + normalizeText(s.flow_prompt);
      })
      .join('\n'),
    '사용한 확인 기능': reel.facts_used.map(normalizeText).join('\n'),
  };
}

/**
 * Applies a human edit to the current script. Only text fields are editable; scene count,
 * timing and facts_used stay as generated unless explicitly provided.
 */
function mergeScriptEdit(current, edit) {
  const merged = JSON.parse(JSON.stringify(current));
  ['concept', 'hook', 'narration'].forEach(function (k) {
    if (typeof edit[k] === 'string') merged[k] = edit[k];
  });
  if (Array.isArray(edit.captions)) merged.captions = edit.captions.map(String);
  if (Array.isArray(edit.facts_used)) merged.facts_used = edit.facts_used.map(String);
  if (Array.isArray(edit.scenes) && Array.isArray(merged.scenes)) {
    if (edit.scenes.length !== merged.scenes.length) {
      throw new Error('장면 개수는 수정할 수 없습니다. 장면 구성을 바꾸려면 "수정 요청"으로 재생성하세요.');
    }
    edit.scenes.forEach(function (es, i) {
      ['visual', 'on_screen_text', 'flow_prompt', 'narration'].forEach(function (k) {
        if (typeof es[k] === 'string') merged.scenes[i][k] = es[k];
      });
    });
  }
  return merged;
}

function hostOf_(url) {
  const m = String(url).match(/^https:\/\/([^\/?#:]+)/i);
  return m ? m[1].toLowerCase() : '';
}

/** Returns '' if the Coupang Partners URL is acceptable, otherwise an actionable error. */
function affiliateUrlError(url) {
  const u = normalizeText(url);
  if (!u) return 'PRODUCTS의 "쿠팡파트너스 URL"이 비어 있습니다. 쿠팡 파트너스에서 만든 링크를 입력하세요.';
  if (RF_CONFIG.AFFILIATE_URL_HOSTS.indexOf(hostOf_(u)) === -1) {
    return '"쿠팡파트너스 URL"은 https://link.coupang.com/… 또는 https://coupa.ng/… 형식의 파트너스 링크여야 합니다: ' + u;
  }
  return '';
}

/** Extracts a Google Drive file ID from a share link or a bare ID. Returns '' if none. */
function parseDriveFileId(input) {
  const s = normalizeText(input);
  let m = s.match(/\/file\/d\/([A-Za-z0-9_-]{20,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  m = s.match(/^([A-Za-z0-9_-]{20,})$/);
  return m ? m[1] : '';
}

function driveViewUrl(fileId) {
  return 'https://drive.google.com/file/d/' + fileId + '/view';
}

function drivePreviewUrl(fileId) {
  return 'https://drive.google.com/file/d/' + fileId + '/preview';
}

function disclosureError_(row) {
  const d = cellText_(row['광고 표기']);
  if (d.indexOf('쿠팡 파트너스') === -1 || d.indexOf('수수료') === -1) {
    return '"광고 표기"에 쿠팡 파트너스 활동 및 수수료 문구가 없습니다. 기본 문구로 되돌리세요: ' + RF_CONFIG.AFFILIATE_DISCLOSURE;
  }
  return '';
}

function staleError_(row, status) {
  return new Error(
    '이 릴스(' + row['릴스ID'] + ')는 이미 다른 곳에서 변경되었습니다 (현재: ' +
      (RF_STATUS_LABELS[status] || status || '알 수 없음') + ', 대본 v' + scriptVersionOf(row) +
      '). 새로고침 후 다시 확인하세요.'
  );
}

/**
 * Plans a transition. Pure: returns { updates, audit, status, noop } or throws an Error
 * with an actionable Korean message. The caller writes `updates` to the REELS row and `audit` to AUDIT.
 *
 * input: {
 *   expectedStatus, expectedScriptVersion, expectedVideoVersion,  // optimistic concurrency
 *   note, edit (EDIT_SCRIPT), reel (REGENERATE_SCRIPT), videoUrl (REGISTER_VIDEO), instagramUrl
 * }
 * ctx: { actor, now }
 */
function planTransition(row, product, action, input, ctx) {
  const def = RF_ACTIONS[action];
  if (!def) throw new Error('알 수 없는 작업입니다: ' + action);
  input = input || {};
  const status = reelStatus(row);
  const scriptVersion = scriptVersionOf(row);
  const videoVersion = videoVersionOf(row);
  const note = normalizeText(input.note);

  // Manual confirmations are idempotent: confirming twice changes nothing.
  if (
    (action === 'CONFIRM_PUBLISHED' && cellText_(row['게시 확인일시'])) ||
    (action === 'CONFIRM_MANYCHAT' && cellText_(row['ManyChat 설정 확인일시']))
  ) {
    return { noop: true, status: status, updates: {}, audit: null };
  }

  // Stale or duplicate request (e.g. double tap on iPhone, two open tabs).
  const versionsMatch =
    (input.expectedScriptVersion == null || Number(input.expectedScriptVersion) === scriptVersion) &&
    (input.expectedVideoVersion == null || Number(input.expectedVideoVersion) === videoVersion);
  if (input.expectedStatus && input.expectedStatus !== status) {
    if (def.to === status && versionsMatch && !/EDIT|REGENERATE|REGISTER/.test(action)) {
      return { noop: true, status: status, updates: {}, audit: null };
    }
    throw staleError_(row, status);
  }
  if (!versionsMatch) throw staleError_(row, status);

  if (def.from.indexOf(status) === -1) {
    throw new Error(
      '"' + def.label + '"은(는) 현재 상태(' + (RF_STATUS_LABELS[status] || status || '상태 없음') + ')에서 할 수 없습니다.'
    );
  }
  if (def.noteRequired && !note) throw new Error('"' + def.label + '"에는 메모(사유)가 필요합니다.');

  const now = ctx.now;
  const actor = ctx.actor || '';
  const updates = {};
  let snapshot = null;
  let to = def.to;
  let newScriptVersion = scriptVersion;
  let newVideoVersion = videoVersion;

  function reviewScript() {
    updates['대본 검토자'] = actor;
    updates['대본 검토일시'] = now;
    updates['대본 검토 메모'] = note;
  }
  function reviewVideo() {
    updates['영상 검토자'] = actor;
    updates['영상 검토일시'] = now;
    updates['영상 검토 메모'] = note;
  }
  function requireApprovedScript() {
    if (!isApprovedScriptIntact(row)) {
      throw new Error(
        '승인된 대본과 현재 대본이 다릅니다 (승인 후 시트에서 수정되었을 수 있음). ' +
          '"대본 승인 취소" 후 현재 버전을 다시 검토·승인하세요.'
      );
    }
  }
  function requirePermission() {
    if (!isPermissionApproved(product.permission)) {
      throw new Error(
        'PRODUCTS의 "영상 사용 허가 상태"가 확인되지 않았습니다 (현재: "' + (normalizeText(product.permission) || '비어 있음') + '"). ' +
          '판매처/제조사 미디어의 재사용·AI 편집 허가를 확인한 뒤 "허가 완료"로, 자체 촬영·AI 생성 영상만 쓴다면 "자체 제작"으로 입력하세요. ' +
          '마켓 등록만으로는 허가가 아닙니다.'
      );
    }
  }
  function replaceScript(newReel, label) {
    const errors = validateReelContent(newReel, product, label);
    if (errors.length) throw new Error('수정한 대본이 검증 규칙에 맞지 않습니다:\n- ' + errors.join('\n- '));
    const cells = reelToScriptCells(newReel);
    Object.keys(cells).forEach(function (k) {
      updates[k] = cells[k];
    });
    newScriptVersion = scriptVersion + 1;
    updates['대본 버전'] = newScriptVersion;
    updates['승인 대본 버전'] = '';
    updates['승인 대본 해시'] = '';
    updates['Flow 장면 프롬프트'] = '';
    snapshot = cells;
  }

  switch (action) {
    case 'APPROVE_SCRIPT': {
      if (input.expectedScriptVersion == null) throw new Error('승인할 대본 버전이 지정되지 않았습니다. 새로고침 후 다시 시도하세요.');
      const reel = rowToReel(row);
      if (!reel.scenes) throw new Error('"장면(JSON)" 셀이 올바른 JSON이 아닙니다. 대시보드에서 수정하거나 재생성하세요.');
      const errors = validateReelContent(reel, product, '대본');
      if (errors.length) throw new Error('현재 대본이 검증 규칙에 맞지 않아 승인할 수 없습니다:\n- ' + errors.join('\n- '));
      const dErr = disclosureError_(row);
      if (dErr) throw new Error(dErr);
      updates['승인 대본 버전'] = scriptVersion;
      updates['승인 대본 해시'] = scriptFingerprint(row);
      // Flow prompts exist only for an approved script (protects Flow credits). Generated by code, free.
      updates['Flow 장면 프롬프트'] = JSON.stringify(buildFlowScenePrompts(row, product));
      reviewScript();
      snapshot = {};
      RF_SCRIPT_FIELDS.forEach(function (f) {
        snapshot[f] = cellText_(row[f]);
      });
      break;
    }
    case 'REQUEST_SCRIPT_CHANGES':
    case 'REJECT_SCRIPT':
      reviewScript();
      break;
    case 'REOPEN_SCRIPT':
      updates['승인 대본 버전'] = '';
      updates['승인 대본 해시'] = '';
      updates['Flow 장면 프롬프트'] = '';
      reviewScript();
      break;
    case 'EDIT_SCRIPT': {
      const current = rowToReel(row);
      if (!current.scenes) throw new Error('"장면(JSON)" 셀이 올바른 JSON이 아닙니다. "수정 요청" 후 재생성하세요.');
      replaceScript(mergeScriptEdit(current, input.edit || {}), '수정한 대본');
      reviewScript();
      break;
    }
    case 'REGENERATE_SCRIPT':
      replaceScript(input.reel, '재생성 대본');
      break;
    case 'START_VIDEO':
      requireApprovedScript();
      requirePermission();
      updates['오류'] = '';
      break;
    case 'REGISTER_VIDEO': {
      const fileId = parseDriveFileId(input.videoUrl);
      if (!fileId) throw new Error('Google Drive MP4 공유 링크(https://drive.google.com/file/d/…)를 입력하세요.');
      requireApprovedScript();
      newVideoVersion = videoVersion + 1;
      updates['영상 버전'] = newVideoVersion;
      updates['영상 파일 URL'] = driveViewUrl(fileId);
      updates['오류'] = '';
      snapshot = { video: driveViewUrl(fileId) };
      break;
    }
    case 'MARK_VIDEO_FAILED':
      updates['오류'] = note;
      break;
    case 'APPROVE_VIDEO':
      if (input.expectedVideoVersion == null) throw new Error('승인할 영상 버전이 지정되지 않았습니다. 새로고침 후 다시 시도하세요.');
      requireApprovedScript();
      reviewVideo();
      snapshot = { video: cellText_(row['영상 파일 URL']) };
      break;
    case 'REQUEST_VIDEO_CHANGES':
    case 'REJECT_VIDEO':
      reviewVideo();
      break;
    case 'MARK_READY_TO_PUBLISH': {
      requireApprovedScript();
      requirePermission();
      const errs = [affiliateUrlError(product.affiliateUrl), disclosureError_(row)];
      if (!parseDriveFileId(row['영상 파일 URL'])) errs.push('"영상 파일 URL"이 비어 있습니다.');
      if (!cellText_(row['ManyChat 키워드'])) errs.push('"ManyChat 키워드"가 비어 있습니다.');
      const real = errs.filter(function (e) {
        return e;
      });
      if (real.length) throw new Error('게시 준비 조건이 부족합니다:\n- ' + real.join('\n- '));
      updates['오류'] = '';
      break;
    }
    case 'CONFIRM_PUBLISHED':
    case 'CONFIRM_MANYCHAT': {
      const isPublish = action === 'CONFIRM_PUBLISHED';
      if (isPublish) {
        const ig = normalizeText(input.instagramUrl);
        if (ig && !/^https:\/\/(www\.)?instagram\.com\//i.test(ig)) {
          throw new Error('인스타그램 게시물 URL은 https://www.instagram.com/… 형식이어야 합니다.');
        }
        updates['게시 확인일시'] = now;
        if (ig) updates['인스타그램 URL'] = ig;
      } else {
        updates['ManyChat 설정 확인일시'] = now;
      }
      const published = isPublish || !!cellText_(row['게시 확인일시']);
      const manychat = !isPublish || !!cellText_(row['ManyChat 설정 확인일시']);
      to = published && manychat ? 'COMPLETED' : 'READY_TO_PUBLISH';
      break;
    }
  }

  updates['상태'] = to;
  updates['제작 상태'] = RF_STATUS_LABELS[to];

  return {
    noop: false,
    status: to,
    updates: updates,
    audit: {
      '일시': now,
      '릴스ID': row['릴스ID'],
      '상품ID': row['상품ID'],
      '작업': action,
      '이전 상태': status,
      '새 상태': to,
      '대본 버전': newScriptVersion,
      '영상 버전': newVideoVersion,
      '작업자': actor,
      '메모': note,
      '스냅샷(JSON)': snapshot ? JSON.stringify(snapshot) : '',
    },
  };
}

/** The four operator touchpoints for one reel, for display and audit. */
function touchpointSummary(row, product) {
  const status = reelStatus(row);
  const after = function (s) {
    const order = Object.keys(RF_STATUS);
    return order.indexOf(status) >= order.indexOf(s);
  };
  const scriptApproved = !!cellText_(row['승인 대본 해시']) && status !== 'SCRIPT_REJECTED';
  const videoApproved = ['VIDEO_APPROVED', 'READY_TO_PUBLISH', 'COMPLETED'].indexOf(status) !== -1;
  return [
    {
      n: 1,
      label: '상품·제휴 링크·허가 확인',
      done: !affiliateUrlError(product.affiliateUrl) && isPermissionApproved(product.permission) &&
        parseConfirmedFeatures(product.features).length > 0,
      detail: [
        affiliateUrlError(product.affiliateUrl) ? '제휴 링크 필요' : '제휴 링크 ✓',
        isPermissionApproved(product.permission) ? '영상 허가 ✓' : '영상 허가 미확인',
      ].join(' · '),
    },
    {
      n: 2,
      label: '대본 승인',
      done: scriptApproved,
      detail: scriptApproved
        ? 'v' + cellText_(row['승인 대본 버전']) + ' · ' + cellText_(row['대본 검토자']) + ' · ' + cellText_(row['대본 검토일시'])
        : RF_STATUS_LABELS[status] || '',
    },
    {
      n: 3,
      label: '영상 승인',
      done: videoApproved,
      detail: videoApproved
        ? 'v' + videoVersionOf(row) + ' · ' + cellText_(row['영상 검토자']) + ' · ' + cellText_(row['영상 검토일시'])
        : after('VIDEO_IN_PRODUCTION') ? RF_STATUS_LABELS[status] : '대본 승인 후',
    },
    {
      n: 4,
      label: '인스타그램 게시·ManyChat 설정',
      done: status === 'COMPLETED',
      detail: [
        cellText_(row['게시 확인일시']) ? '게시 ✓' : '게시 미확인',
        cellText_(row['ManyChat 설정 확인일시']) ? 'ManyChat ✓' : 'ManyChat 미확인',
      ].join(' · '),
    },
  ];
}

/** Text the operator pastes into Instagram and ManyChat. Only for READY_TO_PUBLISH / COMPLETED reels. */
function buildPublishingPack(row, product) {
  const status = reelStatus(row);
  if (['READY_TO_PUBLISH', 'COMPLETED'].indexOf(status) === -1) {
    throw new Error('게시 자료는 "게시 준비 완료" 상태에서만 볼 수 있습니다.');
  }
  const disclosure = cellText_(row['광고 표기']);
  const keyword = cellText_(row['ManyChat 키워드']);
  const fileId = parseDriveFileId(row['영상 파일 URL']);
  return {
    reelId: row['릴스ID'],
    videoUrl: driveViewUrl(fileId),
    videoDownloadUrl: 'https://drive.google.com/uc?export=download&id=' + fileId,
    instagramCaption: ['[광고] ' + disclosure, '', cellText_(row['후킹']), '', buildCta(keyword)].join('\n'),
    manychatKeyword: keyword,
    manychatDm: '요청하신 상품 링크예요 👉 ' + normalizeText(product.affiliateUrl) + '\n\n' + disclosure,
    affiliateUrl: normalizeText(product.affiliateUrl),
    checklist: [
      'MP4를 iPhone에 저장 (Drive 앱 → ⋯ → 사본 보내기 → 동영상 저장)',
      '인스타그램에 릴스 업로드, 캡션 붙여넣기 (첫 줄 [광고] 표기 유지)',
      '"유료 광고 포함" 라벨 설정 (인스타그램 고급 설정)',
      'Google Flow 등 AI로 만든 장면이 있으면 인스타그램 "AI 정보" 라벨 켜기',
      'ManyChat에서 키워드 "' + keyword + '" → DM 문구 연결 후 활성화',
      '테스트 계정으로 댓글 달아 DM 링크가 맞는 상품인지 확인',
      '대시보드에서 "게시 확인", "ManyChat 확인" 누르기',
    ],
  };
}

// ===== Reels.gs =====
/**
 * Pure builders that turn validated Gemini output into REELS rows.
 */

function pad2_(n) {
  return n < 10 ? '0' + n : String(n);
}

/**
 * Returns `count` new reel IDs for a product, continuing after the highest existing one.
 * e.g. PRD-001 with existing [PRD-001-R01, PRD-001-R02] → [PRD-001-R03, ...].
 */
function nextReelIds(productId, existingIds, count) {
  const prefix = productId + '-R';
  let max = 0;
  existingIds.forEach(function (id) {
    const s = normalizeText(id);
    if (s.indexOf(prefix) !== 0) return;
    const suffix = s.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) return;
    const n = parseInt(suffix, 10);
    if (n > max) max = n;
  });
  const taken = {};
  existingIds.forEach(function (id) {
    taken[normalizeText(id)] = true;
  });
  const ids = [];
  let n = max;
  while (ids.length < count) {
    n += 1;
    const id = prefix + pad2_(n);
    if (!taken[id]) ids.push(id);
  }
  return ids;
}

/** Post-specific ManyChat keyword derived from the reel ID (e.g. PRD-001-R01 → PRD001R01). */
function buildManyChatKeyword(reelId) {
  return reelId.replace(/-/g, '');
}

function buildCta(keyword) {
  return '댓글에 "' + keyword + '" 남기면 상품 링크를 DM으로 보내드려요.';
}

function isPermissionApproved(permissionValue) {
  const v = normalizeText(permissionValue);
  return RF_CONFIG.PERMISSION_APPROVED_VALUES.indexOf(v) !== -1;
}

/** Normalised keyword entries: strings (product unknown) or { keyword, productId }. */
function keywordOwners_(existingKeywords) {
  const owners = {};
  existingKeywords.forEach(function (k) {
    const kw = normalizeText(typeof k === 'string' ? k : k.keyword).toUpperCase();
    if (!kw) return;
    (owners[kw] = owners[kw] || []).push(typeof k === 'string' ? '' : normalizeText(k.productId));
  });
  return owners;
}

/**
 * Builds REELS row objects keyed by REELS header names.
 * Keyword: PRODUCTS.'ManyChat 키워드' if the operator set one (shared by that product's reels),
 * otherwise a per-reel code (PRD001R01). Throws if an ID or keyword would collide with another product.
 */
function buildReelRecords(product, reels, existingIds, existingKeywords, meta) {
  const ids = nextReelIds(product.id, existingIds, reels.length);
  const owners = keywordOwners_(existingKeywords);
  const productKeyword = normalizeText(product.keyword);
  const approved = isPermissionApproved(product.permission);

  return reels.map(function (reel, i) {
    const reelId = ids[i];
    const keyword = productKeyword || buildManyChatKeyword(reelId);
    const key = keyword.toUpperCase();
    const others = (owners[key] || []).filter(function (pid) {
      return !productKeyword || pid !== product.id;
    });
    if (others.length) {
      throw new Error('ManyChat 키워드 "' + keyword + '"가 이미 다른 릴스·상품에서 쓰이고 있습니다. 상품마다 다른 키워드를 쓰세요.');
    }
    (owners[key] = owners[key] || []).push(product.id);

    const notes = [];
    if (!approved) notes.push(RF_CONFIG.PERMISSION_UNVERIFIED_NOTE);
    notes.push('게시·DM 자동화 전 사람 검토 필요.');

    const record = {
      '릴스ID': reelId,
      '상품ID': product.id,
      '버전': i + 1,
      'Flow 생성': RF_CONFIG.FLOW_STATUS_MANUAL,
      'CTA': buildCta(keyword),
      'ManyChat 키워드': keyword,
      '광고 표기': RF_CONFIG.AFFILIATE_DISCLOSURE,
      '영상 사용 허가 상태': normalizeText(product.permission) || '미확인',
      '상태': RF_STATUS.SCRIPT_REVIEW_PENDING,
      '제작 상태': RF_STATUS_LABELS.SCRIPT_REVIEW_PENDING,
      '대본 버전': 1,
      '영상 버전': 0,
      '검토 메모': notes.join(' '),
      '생성 모델': meta.model,
      '생성일시': meta.generatedAt,
    };
    const cells = reelToScriptCells(reel);
    Object.keys(cells).forEach(function (k) {
      record[k] = cells[k];
    });
    return record;
  });
}

/**
 * Full pure pipeline: raw Gemini text → validated → REELS row objects.
 * Returns { errors: string[], records: object[] }.
 */
function prepareReelRecords(product, rawText, existingIds, existingKeywords, meta) {
  const parsed = parseModelJson(rawText);
  if (parsed.error) return { errors: [parsed.error], records: [], attempt: null };
  const result = validateGeminiReels(parsed.value, product);
  // Kept so a later attempt can be combined with this one's valid reels (no extra paid call).
  const attempt = { reels: parsed.value && parsed.value.reels, reelErrors: result.reelErrors };
  if (result.errors.length) return { errors: result.errors, records: [], attempt: attempt };
  return {
    errors: [],
    records: buildReelRecords(product, result.reels, existingIds, existingKeywords, meta),
    attempt: attempt,
  };
}

// ===== Prompt.gs =====
/**
 * Gemini prompt and structured-output schema.
 */

// Gemini `responseSchema` (OpenAPI subset). Validation.gs re-checks everything regardless.
const RF_GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reels: {
      type: 'ARRAY',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'OBJECT',
        properties: {
          concept: { type: 'STRING' },
          hook: { type: 'STRING' },
          narration: { type: 'STRING' },
          captions: { type: 'ARRAY', items: { type: 'STRING' } },
          scenes: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                scene_no: { type: 'INTEGER' },
                beat: { type: 'STRING', enum: ['HOOK', 'PROBLEM', 'DEMO', 'BENEFIT', 'CTA'] },
                narration: { type: 'STRING' },
                duration_sec: { type: 'NUMBER' },
                visual: { type: 'STRING' },
                on_screen_text: { type: 'STRING' },
                flow_prompt: { type: 'STRING' },
                // IDs (F1, F2 …) of the verified facts this scene says or shows.
                fact_ids: { type: 'ARRAY', items: { type: 'STRING' } },
              },
              required: ['scene_no', 'beat', 'narration', 'duration_sec', 'visual', 'on_screen_text', 'flow_prompt', 'fact_ids'],
              propertyOrdering: ['scene_no', 'beat', 'narration', 'duration_sec', 'visual', 'on_screen_text', 'flow_prompt', 'fact_ids'],
            },
          },
          // IDs (F1, F2 …) of every verified fact the reel relies on.
          facts_used: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['concept', 'hook', 'narration', 'captions', 'scenes', 'facts_used'],
        propertyOrdering: ['concept', 'hook', 'narration', 'captions', 'scenes', 'facts_used'],
      },
    },
  },
  required: ['reels'],
};

/** Response schema for `count` reels (3 for a new product, 1 for a regenerated script). */
function geminiResponseSchema(count) {
  const schema = JSON.parse(JSON.stringify(RF_GEMINI_RESPONSE_SCHEMA));
  schema.properties.reels.minItems = count;
  schema.properties.reels.maxItems = count;
  return schema;
}

/**
 * Prompt to rewrite ONE script after the reviewer requested changes. Uses the same rules as
 * buildGeminiPrompt, the current script and the reviewer's note. Costs one Gemini call.
 */
function buildRegenerationPrompt(product, currentReel, reviewerNote, previousErrors, previousResponse) {
  const base = buildGeminiPrompt(product, previousErrors, previousResponse)
    .replace(
      '서로 다른 컨셉의 릴스 대본을 정확히 ' + RF_CONFIG.REELS_PER_PRODUCT + '개 작성하세요.',
      '아래 "현재 대본"을 검토자 요청에 맞게 고쳐 릴스 대본을 정확히 1개 작성하세요.'
    )
    .replace(/\n9\. 세 릴스는[^\n]*/, '');
  return [
    base,
    '',
    '## 현재 대본 (JSON)',
    JSON.stringify(currentReel),
    '',
    '## 검토자 수정 요청',
    normalizeText(reviewerNote) || '(메모 없음 — 전반적으로 개선)',
    '',
    '응답의 reels 배열에는 수정된 대본 1개만 넣으세요.',
  ].join('\n');
}

/**
 * Builds the Gemini prompt for one product.
 * `previousErrors` (optional) feeds validation failures back for a corrective retry, together with
 * the previous response (`previousResponse`, optional) so Gemini edits only what failed.
 */
function buildGeminiPrompt(product, previousErrors, previousResponse) {
  const L = RF_CONFIG.LIMITS;
  const facts = parseConfirmedFeatures(product.features);
  const lines = [
    '당신은 한국 인스타그램 홈데코 릴스(9:16 세로 숏폼) 대본 작가입니다.',
    '아래 상품에 대해 서로 다른 컨셉의 릴스 대본을 정확히 ' + RF_CONFIG.REELS_PER_PRODUCT + '개 작성하세요.',
    '',
    '## 상품',
    '- 상품ID: ' + product.id,
    '- 상품명: ' + normalizeText(product.name),
    '- 카테고리: ' + (normalizeText(product.category) || '(미입력)'),
    '- 타깃: ' + (normalizeText(product.target) || '(미입력)'),
    '',
    '## 확인된 기능 (이 목록만 사실로 사용, ID로 참조)',
  ];
  facts.forEach(function (f, i) {
    lines.push('- ' + factId(i) + ': ' + f);
  });
  lines.push(
    '',
    '## 규칙',
    '1. 제품에 대한 사실은 위 확인된 기능(' + factId(0) + '~' + factId(facts.length - 1) + ')만 사용하세요. 목록에 없는 기능, 소재, 내구성·강도, 호환 표면(냉장고·벽·타일 등), 설치 방식(무타공·공구 등), 수납 개수, 가격, 할인, 순위, 후기, 인증, 색상, 수치는 절대 만들지 마세요.',
    '2. 확인된 기능을 자연스러운 한국어 구어체로 바꿔 말하세요. 기술 설명 문구를 그대로 읽지 마세요. 예: "자석 부착형 거치 방식" → "자석으로 붙여서 쓰는 우산꽂이", "철제 도어 부착" → "철제 현관문에 붙일 수 있어요". 뜻을 넓히거나 보태지는 마세요.',
    '3. 숫자·치수·단위는 확인된 기능에 적힌 그대로만 쓰세요. 상단/하단 치수를 바꾸거나 반올림·환산하지 마세요. 가격·할인·퍼센트는 쓰지 마세요.',
    '4. 각 장면의 fact_ids에는 그 장면이 말하거나 보여 주는 확인된 기능 ID를 넣으세요 (예: ["' + factId(0) + '"]). DEMO·BENEFIT 장면은 최소 1개, HOOK·PROBLEM·CTA는 해당 없으면 []. facts_used에는 릴스 전체에서 사용한 ID를 넣으세요. 기능 문장을 직접 쓰지 말고 ID만 쓰세요.',
    '5. 과장 표현(최저가, 100%, 무조건, 완벽, 평생, 절대, 1위, 최고, 튼튼, 강력 등)과 후기·인기 표현(후기, 리뷰, 다들 사요, 품절 등)을 쓰지 마세요.',
    '6. URL, 가격, 광고 표기는 쓰지 마세요. 댓글 키워드는 CTA 장면에서 자리표시자 ' + RF_CONFIG.KEYWORD_PLACEHOLDER + ' 로만 쓰세요.',
    '7. hook은 ' + L.HOOK_MAX_CHARS + '자 이내, narration은 ' + L.NARRATION_MAX_CHARS + '자 이내의 자연스러운 한국어 구어체. captions는 화면 자막 줄 목록이며 각 ' + L.CAPTION_MAX_CHARS + '자 이내.',
    '8. scenes는 ' + L.MIN_SCENES + '~' + L.MAX_SCENES + '개, scene_no는 1부터 순서대로, duration_sec 합계는 ' + L.MIN_TOTAL_SEC + '~' + L.MAX_TOTAL_SEC + '초.',
    '9. 세 릴스는 concept과 hook이 서로 달라야 합니다 (예: 문제 해결, 설치 과정, 공간 비포/애프터).',
    '10. 시연은 실제로 가능한 사용 장면만 묘사하세요.',
    '',
    '## 스토리보드 (영상이 이야기를 이끌고, 자막은 보조)',
    '- 장면 순서: HOOK → (PROBLEM) → DEMO → BENEFIT → CTA. 첫 장면 HOOK, 마지막 장면 CTA, DEMO와 BENEFIT은 반드시 포함. PROBLEM은 HOOK 장면에 합쳐도 됩니다.',
    '- 각 장면의 narration은 그 장면에서 말하는 한 문장이며 그대로 자막이 됩니다: ' + L.SCENE_NARRATION_MAX_CHARS + '자 이내, 짧고 자연스러운 구어체.',
    '- 장면 길이 ' + L.SCENE_MIN_SEC + '~' + L.SCENE_MAX_SEC + '초, 전체 20~25초. hook = 첫 장면 narration. narration(전체) = 장면 narration을 순서대로 이은 것, captions = 장면 narration 목록.',
    '- 말투: 크리에이터가 직접 말하듯 짧은 구어체 구절 (예: "인테리어 하면서", "나무 질감을 중요하게 생각해서"). 자막은 한 줄씩 짧게 바뀝니다.',
    '- visual은 실제 생활 공간에서 사람이 제품을 쓰는 모습을 구체적으로: 카메라를 보는 사람, 손으로 제품 사용 클로즈업, 발·손 POV, 질감 클로즈업, 공간 와이드. 자연광, 핸드헬드. 글자만 있는 화면·단색 배경·그래픽 금지.',
    '- on_screen_text는 빈 문자열로 두세요 (자막은 narration으로 충분합니다).',
    '- CTA 장면 narration 예: "제품 정보는 댓글에 \'' + RF_CONFIG.KEYWORD_PLACEHOLDER + '\'" — 과장 없이 자연스럽게.',
    '',
    '## flow_prompt (Google Flow 수동 생성용, 영어)',
    '- 각 장면마다 Google Flow에 붙여넣을 영어 영상 프롬프트를 작성하세요.',
    '- 9:16 vertical, photorealistic, Korean apartment interior, natural light, 장면 길이에 맞는 단일 샷.',
    '- 브랜드 로고, 상표, 읽을 수 있는 글자, 실존 인물의 얼굴을 넣지 마세요.',
    '- 확인된 기능과 다른 동작(예: 확인되지 않은 부착 방식)을 묘사하지 마세요.',
    '',
    'JSON 스키마에 맞춰 JSON만 출력하세요.'
  );
  if (previousErrors && previousErrors.length) {
    lines.push(
      '',
      '## 이전 응답의 검증 오류 (반드시 수정)',
      '아래 문제만 고치세요. 지적된 문장은 확인된 기능만으로 다시 쓰거나 삭제하고, 문제가 없는 릴스와 장면은 그대로 두세요.'
    );
    previousErrors.slice(0, 25).forEach(function (e) {
      lines.push('- ' + e);
    });
    if (previousResponse) {
      lines.push('', '## 이전 응답 (JSON — 위 오류만 고쳐서 다시 출력)', String(previousResponse).slice(0, 12000));
    }
  }
  return lines.join('\n');
}

// ===== Gemini.gs =====
/**
 * Gemini API client (generateContent with JSON structured output).
 * API key is read from Script Properties: GEMINI_API_KEY. Optional: GEMINI_MODEL.
 *
 * Model choice: GEMINI_MODEL (if set) or RF_CONFIG.DEFAULT_GEMINI_MODEL. If Google answers 404
 * ("model not found" — nothing was generated, nothing billed), the call falls back to
 * RF_CONFIG.GEMINI_FALLBACK_MODELS in order. Any other error is never retried on another model.
 */

// Model that actually answered the last call (recorded in REELS.생성 모델 and AUDIT).
const RF_GEMINI_STATE = { lastModel: '' };

function getGeminiApiKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) {
    throw new Error(
      'GEMINI_API_KEY가 설정되지 않았습니다. 메뉴 "릴스 팩토리 → Gemini API 키 설정" 또는 ' +
        'Apps Script → 프로젝트 설정 → 스크립트 속성에서 설정하세요.'
    );
  }
  return key;
}

function getGeminiModel() {
  return (
    PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') ||
    RF_CONFIG.DEFAULT_GEMINI_MODEL
  );
}

/** Configured model first, then the fallbacks (no duplicates). */
function geminiModelChain_() {
  const chain = [getGeminiModel()];
  RF_CONFIG.GEMINI_FALLBACK_MODELS.forEach(function (m) {
    if (chain.indexOf(m) === -1) chain.push(m);
  });
  return chain;
}

/** One model, with retries for 429/5xx and network errors. Returns { code, text }. */
function requestGemini_(model, body) {
  const url = RF_CONFIG.GEMINI_API_BASE + encodeURIComponent(model) + ':generateContent';
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': getGeminiApiKey_() },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  };
  let response;
  let code;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      response = UrlFetchApp.fetch(url, options);
      code = response.getResponseCode();
    } catch (e) {
      // Network errors and UrlFetchApp timeouts throw even with muteHttpExceptions.
      if (attempt === 3) {
        throw new Error(
          'Gemini API에 연결하지 못했습니다 (' + e.message + '). 인터넷/Google 서비스 상태를 확인하고 다시 시도하세요. ' +
            '시간 초과가 반복되면 스크립트 속성 GEMINI_MODEL을 더 빠른 모델(예: Flash-Lite 계열)로 바꿔 보세요.'
        );
      }
      Utilities.sleep(2000 * attempt);
      continue;
    }
    if (code !== 429 && code < 500) break;
    if (attempt < 3) Utilities.sleep(2000 * attempt);
  }
  return { code: code, text: response.getContentText() };
}

/**
 * Calls Gemini once and returns the raw JSON text from the first candidate.
 * Throws an actionable Error on HTTP / safety / truncation problems.
 */
function callGemini_(promptText, responseSchema) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: promptText }] }],
    // Temperature left at the model default: Gemini 3.x models are tuned for 1.0.
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: responseSchema || RF_GEMINI_RESPONSE_SCHEMA,
    },
  };
  const chain = geminiModelChain_();
  let model;
  let res;
  for (let i = 0; i < chain.length; i++) {
    model = chain[i];
    res = requestGemini_(model, body);
    if (res.code !== 404 || i === chain.length - 1) break;
    logEvent_('WARN', 'geminiModel', '', '모델 "' + model + '"을 찾을 수 없어 "' + chain[i + 1] + '"로 대체합니다 (404, 과금 없음).', String(res.text).slice(0, 500));
  }
  const code = res.code;
  const text = res.text;
  if (code !== 200) {
    let detail = text;
    try {
      detail = JSON.parse(text).error.message;
    } catch (e) {
      // keep raw text
    }
    let hint = '';
    if (code === 400) hint = ' (요청 형식 또는 모델명 GEMINI_MODEL을 확인하세요)';
    if (code === 401 || code === 403) hint = ' (GEMINI_API_KEY가 유효한지 확인하세요)';
    if (code === 404) {
      hint = ' (모델 ' + chain.join(', ') + ' 모두 사용할 수 없습니다. "릴스 팩토리 → Gemini 모델 확인"으로 확인한 뒤 ' +
        '스크립트 속성 GEMINI_MODEL에 현재 Flash 모델 ID를 입력하세요)';
    }
    if (code === 429) hint = ' (요청 한도 초과 — 잠시 후 다시 시도하세요)';
    throw new Error('Gemini API 오류 HTTP ' + code + hint + ': ' + String(detail).slice(0, 500));
  }
  RF_GEMINI_STATE.lastModel = model;

  const json = JSON.parse(text);
  if (json.promptFeedback && json.promptFeedback.blockReason) {
    throw new Error('Gemini가 요청을 차단했습니다: ' + json.promptFeedback.blockReason);
  }
  const candidate = json.candidates && json.candidates[0];
  if (!candidate || !candidate.content || !candidate.content.parts) {
    throw new Error('Gemini 응답에 candidates가 없습니다: ' + text.slice(0, 500));
  }
  if (candidate.finishReason && candidate.finishReason !== 'STOP') {
    throw new Error('Gemini 응답이 완료되지 않았습니다 (finishReason=' + candidate.finishReason + ').');
  }
  return candidate.content.parts
    .map(function (p) {
      return p.text || '';
    })
    .join('');
}

/**
 * Free check (models.get — no tokens, no charge): is each model in the chain available for
 * generateContent? Returns [{ model, ok, detail }].
 */
function checkGeminiModels_() {
  const key = getGeminiApiKey_();
  return geminiModelChain_().map(function (model) {
    const res = UrlFetchApp.fetch(RF_CONFIG.GEMINI_API_BASE + encodeURIComponent(model), {
      method: 'get',
      headers: { 'x-goog-api-key': key },
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code !== 200) return { model: model, ok: false, detail: 'HTTP ' + code };
    const info = JSON.parse(res.getContentText());
    const methods = info.supportedGenerationMethods || [];
    const ok = methods.indexOf('generateContent') !== -1;
    return { model: model, ok: ok, detail: (info.displayName || info.name) + (ok ? '' : ' — generateContent 미지원') };
  });
}

/** Menu: shows which Gemini model will be used (free). */
function showGeminiModelCheck() {
  const ui = SpreadsheetApp.getUi();
  try {
    const rows = checkGeminiModels_();
    const use = rows.filter(function (r) {
      return r.ok;
    })[0];
    ui.alert(
      'Gemini 모델 확인 (무료 — 토큰 사용 없음)\n\n' +
        rows.map(function (r) {
          return (r.ok ? '✓ ' : '✗ ') + r.model + ' — ' + r.detail;
        }).join('\n') +
        '\n\n' + (use ? '사용할 모델: ' + use.model : '사용 가능한 모델이 없습니다. GEMINI_MODEL을 현재 Flash 모델 ID로 설정하세요.') +
        '\n실제 JSON 생성까지 확인하려면 "테스트: PRD-001 Gemini 실제 호출"을 실행하세요 (1회 과금).'
    );
  } catch (e) {
    ui.alert('Gemini 모델 확인 실패\n\n' + e.message);
  }
}

// ===== Sheets.gs =====
/**
 * Google Sheets I/O. Columns are always located by header name so existing
 * columns (and any extra columns the operator adds) are preserved.
 */

/** Header comparison key: ignores spaces, line breaks and letter case ("상품 ID" == "상품ID"). */
function headerKey_(name) {
  return normalizeText(name).replace(/\s+/g, '').toLowerCase();
}

/** Returns { headerKey: 1-based column index } for row 1. Use colOf_() to look up by header name. */
function getHeaderMap_(sheet) {
  const lastCol = sheet.getLastColumn();
  const map = {};
  if (lastCol === 0) return map;
  sheet
    .getRange(1, 1, 1, lastCol)
    .getValues()[0]
    .forEach(function (h, i) {
      const key = headerKey_(h);
      if (key && !map[key]) map[key] = i + 1;
    });
  return map;
}

/** 1-based column index of a header name, or 0 if absent. */
function colOf_(map, headerName) {
  return map[headerKey_(headerName)] || 0;
}

function missingHeaders_(sheet, required) {
  const map = getHeaderMap_(sheet);
  return required.filter(function (h) {
    return !colOf_(map, h);
  });
}

function requireHeaders_(sheet, required) {
  const missing = missingHeaders_(sheet, required);
  if (missing.length) {
    let hint = '헤더를 직접 추가하거나 이름을 확인하세요.';
    if (sheet.getName() !== RF_CONFIG.SHEETS.PRODUCTS) {
      hint = '메뉴 "릴스 팩토리 → 시트 준비"를 실행하면 기존 데이터를 건드리지 않고 1행 오른쪽 빈 칸에 누락된 헤더를 추가할 수 있습니다.';
    }
    throw new Error(
      '"' + sheet.getName() + '" 시트 1행에 필요한 헤더가 없습니다: ' + missing.join(', ') +
        '. 기존 데이터는 자동으로 수정하지 않습니다 — ' + hint
    );
  }
  return getHeaderMap_(sheet);
}

/** Finds a sheet by name, tolerating surrounding spaces and letter case ("Products ", "products"). */
function findSheet_(ss, name) {
  const exact = ss.getSheetByName(name);
  if (exact) return exact;
  const want = normalizeText(name).toLowerCase();
  const matches = ss.getSheets().filter(function (sh) {
    return normalizeText(sh.getName()).toLowerCase() === want;
  });
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Appends missing headers to the first empty cells at the right end of row 1.
 * Existing headers and data are never moved or overwritten. Returns the headers added.
 */
function appendMissingHeaders_(sheet, headers) {
  const missing = missingHeaders_(sheet, headers);
  if (!missing.length) return [];
  const start = sheet.getLastColumn() + 1;
  sheet.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight('bold');
  return missing;
}

/**
 * Creates the sheet with headers if it does not exist (or is completely empty).
 * Never modifies an existing header row; only verifies it.
 */
function ensureSheet_(ss, name, headers) {
  let sheet = findSheet_(ss, name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0 && sheet.getLastColumn() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  requireHeaders_(sheet, headers);
  return sheet;
}

function getProductsSheet_(ss) {
  const sheet = findSheet_(ss, RF_CONFIG.SHEETS.PRODUCTS);
  if (!sheet) {
    throw new Error(
      '"' + RF_CONFIG.SHEETS.PRODUCTS + '" 시트를 찾을 수 없습니다. 상품 시트 탭 이름을 PRODUCTS로 바꾸거나 ' +
        'Config의 RF_CONFIG.SHEETS.PRODUCTS를 실제 탭 이름으로 수정하세요.'
    );
  }
  return sheet;
}

/** Reads one PRODUCTS row into a product object. */
function readProduct_(sheet, rowNumber) {
  const fields = RF_CONFIG.PRODUCT_FIELDS;
  const headerNames = Object.keys(fields).map(function (k) {
    return fields[k];
  });
  const map = requireHeaders_(sheet, headerNames);
  const values = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
  const product = { rowNumber: rowNumber };
  Object.keys(fields).forEach(function (k) {
    product[k] = values[colOf_(map, fields[k]) - 1];
  });
  const optional = RF_CONFIG.PRODUCT_OPTIONAL_FIELDS;
  Object.keys(optional).forEach(function (k) {
    const col = colOf_(map, optional[k]);
    product[k] = col ? values[col - 1] : '';
  });
  product.id = normalizeText(product.id);
  return product;
}

/** All non-empty values in a column identified by header name (excluding header row). */
function readColumn_(sheet, map, headerName) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet
    .getRange(2, colOf_(map, headerName), lastRow - 1, 1)
    .getValues()
    .map(function (r) {
      return normalizeText(r[0]);
    })
    .filter(function (v) {
      return v.length > 0;
    });
}

/** Appends records (objects keyed by header) in one write, honouring the sheet's column order. */
function appendRecords_(sheet, records, textHeaders) {
  if (!records.length) return;
  const map = getHeaderMap_(sheet);
  const width = sheet.getLastColumn();
  const rows = records.map(function (rec) {
    const row = new Array(width).fill('');
    Object.keys(rec).forEach(function (h) {
      const col = colOf_(map, h);
      if (col) row[col - 1] = rec[h];
    });
    return row;
  });
  const startRow = sheet.getLastRow() + 1;
  // Plain-text format so Sheets never turns script text into numbers/dates (keeps fingerprints stable).
  (textHeaders || []).forEach(function (h) {
    const col = colOf_(map, h);
    if (col) sheet.getRange(startRow, col, rows.length, 1).setNumberFormat('@');
  });
  sheet.getRange(startRow, 1, rows.length, width).setValues(rows);
}

/** Reads all data rows as objects keyed by the given header names, plus `_row` (1-based). */
function readRecords_(sheet, headers) {
  const map = getHeaderMap_(sheet);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol === 0) return [];
  return sheet
    .getRange(2, 1, lastRow - 1, lastCol)
    .getValues()
    .map(function (values, i) {
      const rec = { _row: i + 2 };
      headers.forEach(function (h) {
        const col = colOf_(map, h);
        rec[h] = col ? values[col - 1] : '';
      });
      return rec;
    });
}

/**
 * Writes only the changed cells of one row (never the whole row), so formulas or notes the
 * operator keeps in other columns are untouched.
 */
function updateRecord_(sheet, rowNumber, updates) {
  const map = getHeaderMap_(sheet);
  const missing = Object.keys(updates).filter(function (h) {
    return !colOf_(map, h);
  });
  if (missing.length) {
    throw new Error(
      '"' + sheet.getName() + '" 시트에 헤더가 없습니다: ' + missing.join(', ') +
        '. Google Sheets에서 "릴스 팩토리 → 시트 준비"를 실행하세요.'
    );
  }
  Object.keys(updates).forEach(function (h) {
    const cell = sheet.getRange(rowNumber, colOf_(map, h), 1, 1);
    if (RF_SCRIPT_FIELDS.indexOf(h) !== -1) cell.setNumberFormat('@');
    cell.setValues([[updates[h]]]);
  });
}

/** Appends entries to the append-only AUDIT sheet. */
function appendAudit_(ss, entries) {
  const list = entries.filter(function (e) {
    return e;
  });
  if (!list.length) return;
  const sheet = ensureSheet_(ss, RF_CONFIG.SHEETS.AUDIT, RF_CONFIG.AUDIT_HEADERS);
  appendRecords_(sheet, list);
}

/** Appends a row to the LOG sheet. Logging failures must never hide the original error. */
function logEvent_(level, action, productId, message, detail) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ensureSheet_(ss, RF_CONFIG.SHEETS.LOG, RF_CONFIG.LOG_HEADERS);
    appendRecords_(sheet, [
      {
        '일시': new Date(),
        '레벨': level,
        '작업': action,
        '상품ID': productId || '',
        '메시지': message,
        '상세': detail ? String(detail).slice(0, 45000) : '',
      },
    ]);
  } catch (e) {
    console.error('LOG 기록 실패: ' + e.message);
  }
}

// ===== Fixtures.gs =====
/**
 * PRD-001 test fixture. Facts come only from README.md "First product".
 * Category/target are illustrative test inputs, not product claims.
 * URLs are intentionally blank and permission is "미확인" — they must be verified by the operator.
 *
 * FIXTURE_PRD_001_GEMINI_RESPONSE is a hand-written sample in the expected schema,
 * NOT a recorded Gemini response. Reel 1 is the operator's approved PRD-001 storyboard
 * (HOOK → DEMO → DEMO → BENEFIT → CTA, 23 s). Facts are referenced by ID (F1 = first line of
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

function fixtureReel_(concept, scenes, factsUsed) {
  return {
    concept: concept,
    hook: scenes[0][2],
    narration: scenes.map(function (s) { return s[2]; }).join(' '),
    captions: scenes.map(function (s) { return s[2]; }),
    scenes: scenes.map(function (s, i) {
      return { scene_no: i + 1, beat: s[0], duration_sec: s[1], narration: s[2], visual: s[3], on_screen_text: '', flow_prompt: s[4], fact_ids: s[5] || [] };
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
        'Vertical 9:16 close-up, a hand placing a slim dark gray magnetic umbrella holder onto the lower part of a steel apartment front door, natural light, realistic, no text.', ['F1']],
      ['DEMO', 6, '바닥 공간을 안 차지하니까', '문에 붙은 우산꽂이에 장우산과 접이식 우산을 차례로 꽂는 모습',
        'Vertical 9:16 medium shot, a person sliding a long umbrella and then a folding umbrella into a slim dark gray holder attached to a steel front door, natural light, no text.', ['F3', 'F1']],
      ['BENEFIT', 6, '현관이 훨씬 깔끔해져요.', '우산이 문에 정리되고 바닥이 비어 있는 깔끔한 현관 전체 모습',
        'Vertical 9:16 wide shot, tidy small Korean apartment entryway, umbrellas neatly held by a holder on the steel front door, clear floor, warm daylight, no text.', ['F1', 'F3']],
      ['CTA', 4, "제품 정보는 댓글에 '{키워드}' ☂️", '현관문에 붙은 우산꽂이 제품 클로즈업',
        'Vertical 9:16 slow close-up of a slim dark gray umbrella holder mounted on a steel door with one umbrella inside, soft light, shallow depth of field, no text.'],
    ], ['F1', 'F3']),
    fixtureReel_('구성 소개: 상단·하단 분리형', [
      ['HOOK', 3, '우산꽂이가 두 조각인 이유', '두 조각으로 된 우산꽂이 부품을 양손에 하나씩 든 모습',
        'Vertical 9:16 close-up, two hands each holding one piece of a two-piece dark gray umbrella holder in a bright entryway, realistic, no text.'],
      ['DEMO', 5, '상단 190×55×50mm,', '상단 부품을 철제 문 위쪽에 붙이는 손',
        'Vertical 9:16 close-up, a hand attaching the upper piece of a dark gray umbrella holder to a steel door, natural light, no text.', ['F2']],
      ['DEMO', 5, '하단 188×55×82mm, 따로 분리돼요.', '하단 부품을 철제 문 아래쪽에 붙이는 손',
        'Vertical 9:16 close-up, a hand attaching the lower tray piece of a dark gray umbrella holder near the bottom of a steel door, natural light, no text.', ['F2']],
      ['BENEFIT', 5, '철제 문에 자석으로 착.', '위아래 부품이 붙은 문에 장우산 하나가 서 있는 모습',
        'Vertical 9:16 medium shot, steel apartment door with a two-piece umbrella holder, a long umbrella standing in it, tidy floor, daylight, no text.', ['F1']],
      ['CTA', 4, "제품 정보는 댓글에 '{키워드}'", '문에 붙은 다크그레이 우산꽂이 클로즈업',
        'Vertical 9:16 slow close-up of a dark gray two-piece umbrella holder on a steel door, soft light, no text.'],
    ], ['F2', 'F1']),
    fixtureReel_('인테리어: 현관 색에 맞춰 고르기', [
      ['HOOK', 3, '현관 분위기에 맞는 우산꽂이?', '밝은 현관 문 앞에서 우산꽂이 색상을 고민하는 손',
        'Vertical 9:16 close-up, a hand holding a small umbrella holder against a light-colored steel front door, bright natural light, no text.'],
      ['PROBLEM', 4, '기대 세운 우산, 자꾸 쓰러지죠.', '벽에 기대 세워 둔 우산이 미끄러져 쓰러지는 모습',
        'Vertical 9:16 medium shot, an umbrella leaning on an entryway wall slowly sliding and falling to the floor, realistic, no text.'],
      ['DEMO', 5, '다크그레이, 그레이, 화이트 중에', '다크그레이·그레이·화이트 우산꽂이 세 개를 나란히 보여 주는 손',
        'Vertical 9:16 top-down shot, three plain umbrella holders in dark gray, gray and white side by side on a wooden shoe bench, soft light, no text.', ['F4']],
      ['BENEFIT', 5, '문 색에 맞춰 골라 붙이면 돼요.', '흰 철제 문에 흰색 우산꽂이가 붙어 정돈된 현관',
        'Vertical 9:16 wide shot, white steel apartment door with a white umbrella holder holding umbrellas, tidy floor, warm light, no text.', ['F4', 'F1']],
      ['CTA', 4, "제품 정보는 댓글에 '{키워드}'", '문에 붙은 흰색 우산꽂이 클로즈업',
        'Vertical 9:16 slow close-up of a white umbrella holder on a white steel door, one umbrella inside, soft light, no text.'],
    ], ['F4', 'F1']),
  ],
};

// ===== FlowPrompts.gs =====
/**
 * Google Flow scene prompts, generated by code (no API call, no cost) from the APPROVED script and the
 * verified product facts. Written to REELS.'Flow 장면 프롬프트' on SCRIPT_APPROVED and cleared when the
 * script changes, so Flow credits are only ever spent on an approved storyboard.
 * One 8-second clip per scene; the renderer takes several short cuts from each clip.
 */

/** First colour listed in a "색상: …" fact, so every scene shows the same variant. */
function primaryColour_(facts) {
  for (let i = 0; i < facts.length; i++) {
    const m = facts[i].match(/^색상\s*[:：]\s*(.+)$/);
    if (m) return normalizeText(m[1].split(/[,，/]/)[0]);
  }
  return '';
}

function productAppearance_(product, facts) {
  const parts = [];
  if (normalizeText(product.appearance)) parts.push(normalizeText(product.appearance));
  const colour = primaryColour_(facts);
  if (colour) parts.push('주 색상 ' + colour + ' (모든 장면에서 같은 색)');
  facts.filter(function (f) {
    return /\d+\s*[×xX]\s*\d+/.test(f);
  }).forEach(function (f) {
    parts.push('크기: ' + f);
  });
  return parts.join('; ');
}

/** Clips needed so every part of a scene fits one clip (minus margin). 1 for valid storyboards. */
function flowClipParts(sceneSec) {
  const usable = RF_CONFIG.FLOW.CLIP_SEC - RF_CONFIG.FLOW.CLIP_MARGIN_SEC;
  return Math.max(1, Math.ceil(Number(sceneSec) / usable - 1e-9));
}

/** File name of part k (1-based) of scene n: S3.mp4, S3b.mp4, S3c.mp4 … */
function flowClipFile(sceneNo, part) {
  return 'S' + sceneNo + (part > 1 ? String.fromCharCode(96 + part) : '') + '.mp4';
}

/**
 * Returns [{ scene, part, parts, file, beat, clipSec, scriptedSec, coversSec, prompt }] for the reel's
 * current script — one entry per Flow clip (normally one per scene).
 * Uses only PRODUCTS.확인된 기능 (+ optional 제품 외형) — never invented attributes.
 */
function buildFlowScenePrompts(row, product) {
  const reel = rowToReel(row);
  if (!reel.scenes || !reel.scenes.length) return [];
  const F = RF_CONFIG.FLOW;
  const facts = parseConfirmedFeatures(product.features);
  const appearance = productAppearance_(product, facts);
  const n = reel.scenes.length;
  const out = [];
  reel.scenes.forEach(function (s, i) {
    const beat = s.beat || (i === 0 ? 'HOOK' : i === n - 1 ? 'CTA' : 'DEMO');
    const parts = flowClipParts(s.duration_sec);
    for (let part = 1; part <= parts; part++) {
      const prompt = [
        'Google Flow · ' + cellText_(row['릴스ID']) + ' · scene ' + (i + 1) + '/' + n + ' · ' + beat + ' · ' + F.CLIP_SEC + '-second clip, vertical 9:16, photorealistic',
        'PRODUCT (identical in every scene): ' + normalizeText(product.name) + (appearance ? ' — ' + appearance : '') + '.',
        'Verified features only: ' + facts.join(' / ') + '. Do not add other features, logos, brand names or text on the product.',
        'SCENE: ' + normalizeText(s.flow_prompt) + ' (' + normalizeText(s.visual) + ')',
        'PRODUCT INTERACTION: ' + F.INTERACTION[beat] + '.',
        'CAMERA: ' + F.CAMERA[beat] + '. One continuous take, no cuts, transitions or effects inside the clip.',
        'LIGHTING & ENVIRONMENT: ' + F.ENVIRONMENT + '. No on-screen text, subtitles, watermarks or logos.',
        parts > 1 ? 'PART ' + part + ' of ' + parts + ': ' + (part === 1 ? 'the beginning of this scene.' : 'continue the same action, place and lighting from where part ' + (part - 1) + ' ended.') : '',
        'DURATION: ' + F.CLIP_SEC + ' seconds. The editor uses about ' + +(Number(s.duration_sec) / parts).toFixed(1) + ' s of it as several short cuts, so let the framing change during the clip.',
        'CONSISTENCY: same product colour, shape and size as the other scenes; same location, door, floor and time of day; ' +
          'if a person appears, same clothing and hands in every scene. If Flow accepts a reference image, use a photo of the real product you are allowed to use.',
      ].filter(Boolean).join('\n');
      out.push({
        scene: i + 1, part: part, parts: parts, file: flowClipFile(i + 1, part), beat: beat, clipSec: F.CLIP_SEC,
        scriptedSec: Number(s.duration_sec), coversSec: +(Number(s.duration_sec) / parts).toFixed(2), prompt: prompt,
      });
    }
  });
  return out;
}

// ===== RenderJob.gs =====
/**
 * Render jobs: the ONLY way the renderer (Mac now, cloud later) receives a script.
 *
 * A job is issued only for a reel that is VIDEO_IN_PRODUCTION, whose approved script is intact
 * and whose media permission is verified. The job is signed (HMAC-SHA256, Script Property
 * RF_RENDER_SECRET); the renderer refuses unsigned, tampered, expired or unapproved jobs
 * BEFORE making any paid API call (TTS). Pure functions here; signing lives in WebApp.gs.
 */

const RF_RENDER_JOB_VERSION = 1;
const RF_RENDER_JOB_TTL_HOURS = 72;

/** Returns '' if a render job may be issued for this row, otherwise the reason. */
function renderJobBlocker(row, product) {
  const status = reelStatus(row);
  if (status !== 'VIDEO_IN_PRODUCTION') {
    return '렌더 작업은 "영상 제작 중" 상태에서만 만들 수 있습니다 (현재: ' + (RF_STATUS_LABELS[status] || status || '상태 없음') + '). 대본 승인 후 "영상 제작 시작"을 누르세요.';
  }
  if (!isApprovedScriptIntact(row)) {
    return '승인된 대본과 현재 대본이 다릅니다. 승인 취소 후 다시 승인하세요.';
  }
  if (!isPermissionApproved(product.permission)) {
    return 'PRODUCTS의 "영상 사용 허가 상태"가 확인되지 않았습니다.';
  }
  return '';
}

/**
 * Job payload (as a JSON string, so the signature covers exact bytes).
 * Contains only what rendering needs: no affiliate URL, no API keys.
 */
function buildRenderJobPayload(row, product, issuedAtIso, ttlHours) {
  const blocker = renderJobBlocker(row, product);
  if (blocker) throw new Error(blocker);
  const cells = {};
  RF_SCRIPT_FIELDS.forEach(function (f) {
    cells[f] = cellText_(row[f]);
  });
  const issued = new Date(issuedAtIso);
  const expires = new Date(issued.getTime() + (ttlHours || RF_RENDER_JOB_TTL_HOURS) * 3600 * 1000);
  return JSON.stringify({
    jobVersion: RF_RENDER_JOB_VERSION,
    reelId: cellText_(row['릴스ID']),
    productId: cellText_(row['상품ID']),
    productName: normalizeText(product.name),
    status: 'VIDEO_IN_PRODUCTION',
    scriptVersion: scriptVersionOf(row),
    approvedScriptVersion: parseInt(cellText_(row['승인 대본 버전']), 10),
    approvedHash: cellText_(row['승인 대본 해시']),
    nextVideoVersion: videoVersionOf(row) + 1,
    permission: normalizeText(product.permission),
    // What the renderer needs for the shot list; facts are already public product claims.
    product: {
      name: normalizeText(product.name),
      facts: parseConfirmedFeatures(product.features),
      appearance: normalizeText(product.appearance),
    },
    flowPrompts: (function () {
      try {
        const v = JSON.parse(cellText_(row['Flow 장면 프롬프트']) || '[]');
        if (Array.isArray(v) && v.length) return v;
      } catch (e) {
        // fall through: approved before prompts existed → generate now (free)
      }
      return buildFlowScenePrompts(row, product);
    })(),
    issuedAt: issued.toISOString(),
    expiresAt: expires.toISOString(),
    script: cells,
  });
}

/** Hex encoding of a signed byte array (Apps Script Utilities returns -128..127). */
function bytesToHex_(bytes) {
  return bytes
    .map(function (b) {
      const v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? '0' + v : v;
    })
    .join('');
}

// ===== Code.gs =====
/**
 * Reels Factory — Google Sheets menu and workflow orchestration.
 *
 * @OnlyCurrentDoc
 */

/**
 * Simple trigger. If this Apps Script project already has its own onOpen(), delete this one
 * and add the line `addReelsFactoryMenu();` inside the existing onOpen() instead.
 */
function onOpen() {
  addReelsFactoryMenu();
}

function addReelsFactoryMenu() {
  SpreadsheetApp.getUi()
    .createMenu('릴스 팩토리')
    .addItem('선택한 상품으로 릴스 대본 3개 생성', 'generateReelsForSelectedProduct')
    .addSeparator()
    .addItem('시트 준비 (REELS / PERFORMANCE / LOG / AUDIT)', 'setupSheets')
    .addItem('iPhone 대시보드 링크 보기', 'showDashboardLink')
    .addItem('렌더 키 보기 (Mac 렌더러 설정용)', 'showRenderSecret')
    .addItem('Gemini API 키 설정', 'promptForGeminiApiKey')
    .addItem('Gemini 모델 확인 (무료)', 'showGeminiModelCheck')
    .addSeparator()
    .addItem('테스트: PRD-001 오프라인 검증', 'runOfflineFixtureTest')
    .addItem('테스트: PRD-001 Gemini 실제 호출 (시트에 쓰지 않음)', 'runLiveGeminiTestPRD001')
    .addToUi();
}

/**
 * Creates missing REELS / PERFORMANCE / LOG sheets and verifies PRODUCTS headers.
 * Never edits PRODUCTS. For existing REELS / PERFORMANCE / LOG sheets, missing headers are
 * appended to the right end of row 1 only after the user confirms.
 */
function setupSheets() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const report = [];
  try {
    const fields = RF_CONFIG.PRODUCT_FIELDS;
    const productHeaders = Object.keys(fields).map(function (k) {
      return fields[k];
    });
    const productsMissing = missingHeaders_(getProductsSheet_(ss), productHeaders);
    report.push(
      productsMissing.length
        ? '✗ PRODUCTS: 헤더 없음 → ' + productsMissing.join(', ') + ' (PRODUCTS는 자동 수정하지 않습니다. 1행 헤더 이름을 확인하세요.)'
        : '✓ PRODUCTS: 필요한 헤더 9개 확인'
    );

    const managed = [
      [RF_CONFIG.SHEETS.REELS, RF_CONFIG.REELS_HEADERS],
      [RF_CONFIG.SHEETS.PERFORMANCE, RF_CONFIG.PERFORMANCE_HEADERS],
      [RF_CONFIG.SHEETS.LOG, RF_CONFIG.LOG_HEADERS],
      [RF_CONFIG.SHEETS.AUDIT, RF_CONFIG.AUDIT_HEADERS],
    ];
    const toFix = [];
    managed.forEach(function (m) {
      const existing = findSheet_(ss, m[0]);
      if (!existing || (existing.getLastRow() === 0 && existing.getLastColumn() === 0)) {
        ensureSheet_(ss, m[0], m[1]);
        report.push('✓ ' + m[0] + ': ' + (existing ? '빈 시트에 헤더 작성' : '새로 만듦'));
        return;
      }
      const missing = missingHeaders_(existing, m[1]);
      if (missing.length) toFix.push({ sheet: existing, headers: m[1], missing: missing });
      else report.push('✓ ' + m[0] + ': 기존 시트 확인');
    });

    if (toFix.length) {
      const answer = ui.alert(
        '기존 시트에 헤더 추가',
        toFix
          .map(function (t) {
            return t.sheet.getName() + ': ' + t.missing.join(', ');
          })
          .join('\n') +
          '\n\n위 헤더를 각 시트 1행 오른쪽 끝 빈 칸에 추가할까요? 기존 셀과 데이터는 바뀌지 않습니다.',
        ui.ButtonSet.YES_NO
      );
      toFix.forEach(function (t) {
        if (answer === ui.Button.YES) {
          appendMissingHeaders_(t.sheet, t.headers);
          report.push('✓ ' + t.sheet.getName() + ': 헤더 추가 → ' + t.missing.join(', '));
        } else {
          report.push('✗ ' + t.sheet.getName() + ': 헤더 없음 → ' + t.missing.join(', '));
        }
      });
    }
    report.push(registerSelfAsReviewer_());
    ui.alert('시트 준비 결과\n\n' + report.join('\n'));
  } catch (e) {
    logEvent_('ERROR', 'setupSheets', '', e.message, e.stack);
    ui.alert('시트 준비 실패\n\n' + report.concat([e.message]).join('\n'));
  }
}

/** Stores the Gemini API key in Script Properties (never in the sheet or Git). */
function promptForGeminiApiKey() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt(
    'Gemini API 키 설정',
    'Google AI Studio에서 발급한 API 키를 입력하세요. 키는 스크립트 속성(GEMINI_API_KEY)에만 저장됩니다.',
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const key = normalizeText(res.getResponseText());
  if (!key) {
    ui.alert('빈 값은 저장하지 않았습니다.');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', key);
  ui.alert('GEMINI_API_KEY 저장 완료. (모델 변경은 스크립트 속성 GEMINI_MODEL로 설정)');
}

/**
 * Generates up to MAX_GEMINI_ATTEMPTS Gemini responses until one passes validation,
 * then returns { records, attempts }. Throws with all validation errors otherwise.
 */
function generateValidatedRecords_(product, existingIds, existingKeywords) {
  let lastErrors = [];
  let lastRaw = '';
  const attempts = [];
  const meta = function () {
    return { model: RF_GEMINI_STATE.lastModel || getGeminiModel(), generatedAt: new Date() };
  };
  for (let attempt = 1; attempt <= RF_CONFIG.MAX_GEMINI_ATTEMPTS; attempt++) {
    // A retry gets the exact failing claims and the previous response, so Gemini fixes only those.
    const raw = callGemini_(buildGeminiPrompt(product, lastErrors, lastRaw));
    const result = prepareReelRecords(product, raw, existingIds, existingKeywords, meta());
    if (!result.errors.length) return { records: result.records, attempts: attempt };
    attempts.push(result.attempt);
    lastErrors = result.errors;
    lastRaw = raw;
    logEvent_(
      attempt < RF_CONFIG.MAX_GEMINI_ATTEMPTS ? 'WARN' : 'ERROR',
      'validateGemini',
      product.id,
      '검증 실패 (시도 ' + attempt + '/' + RF_CONFIG.MAX_GEMINI_ATTEMPTS + '): ' + result.errors.length + '건',
      result.errors.join('\n') + '\n\n--- 원본 응답 ---\n' + raw
    );
    // Free rescue: if every position has a reel that passed in some attempt, use those.
    const combined = attempts.length > 1 ? combineValidReels(attempts, product) : null;
    if (combined) {
      logEvent_('INFO', 'validateGemini', product.id, '시도별로 검증을 통과한 대본을 합쳐 사용합니다 (추가 호출 없음).', '');
      return { records: buildReelRecords(product, combined.reels, existingIds, existingKeywords, meta()), attempts: attempt };
    }
  }
  throw new Error(
    'Gemini 응답이 ' + RF_CONFIG.MAX_GEMINI_ATTEMPTS + '회 모두 검증에 실패했습니다. REELS에는 아무것도 기록하지 않았습니다.\n' +
      '자세한 내용은 LOG 시트를 확인하세요.\n\n- ' + lastErrors.slice(0, 8).join('\n- ')
  );
}

/** Document lock (falls back to the script lock where no document lock is available). */
function getLock_() {
  return LockService.getDocumentLock() || LockService.getScriptLock();
}

/** Email of the Google account running this call ('' if Google does not reveal it). */
function currentUserEmail_() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (e) {
    return '';
  }
}

/** 1-based PRODUCTS row of a product ID; throws if missing or duplicated. */
function findProductRow_(productsSheet, productId) {
  const map = requireHeaders_(productsSheet, [RF_CONFIG.PRODUCT_FIELDS.id]);
  const lastRow = productsSheet.getLastRow();
  const ids = lastRow < 2 ? [] : productsSheet.getRange(2, colOf_(map, RF_CONFIG.PRODUCT_FIELDS.id), lastRow - 1, 1).getValues();
  const rows = [];
  ids.forEach(function (r, i) {
    if (normalizeText(r[0]) === productId) rows.push(i + 2);
  });
  if (!rows.length) throw new Error('PRODUCTS에서 상품ID "' + productId + '"를 찾을 수 없습니다.');
  if (rows.length > 1) throw new Error('PRODUCTS에 상품ID "' + productId + '"가 여러 번 있습니다. 중복을 정리한 뒤 다시 실행하세요.');
  return rows[0];
}

/**
 * Shared by the Sheets menu and the dashboard. Caller must hold getLock_().
 * Returns { needsConfirm: n } if the product already has n reels and allowAdditional is false,
 * otherwise { ids, product } after writing 3 validated REELS rows and AUDIT entries.
 */
function generateScriptsForProduct_(ss, rowNumber, options) {
  const productsSheet = getProductsSheet_(ss);
  const product = readProduct_(productsSheet, rowNumber);

  const productErrors = validateProduct(product);
  if (productErrors.length) {
    throw new Error('PRODUCTS ' + product.rowNumber + '행을 수정하세요:\n- ' + productErrors.join('\n- '));
  }
  findProductRow_(productsSheet, product.id); // duplicate 상품ID check

  const reelsSheet = ensureSheet_(ss, RF_CONFIG.SHEETS.REELS, RF_CONFIG.REELS_HEADERS);
  const reelsMap = getHeaderMap_(reelsSheet);
  const existingIds = readColumn_(reelsSheet, reelsMap, '릴스ID');
  const existingKeywords = readRecords_(reelsSheet, ['ManyChat 키워드', '상품ID'])
    .map(function (r) {
      return { keyword: normalizeText(r['ManyChat 키워드']), productId: normalizeText(r['상품ID']) };
    })
    .filter(function (r) {
      return r.keyword;
    });
  const dupIds = findDuplicates(existingIds);
  if (dupIds.length) {
    throw new Error('REELS에 중복된 릴스ID가 있습니다: ' + dupIds.join(', ') + '. 정리한 뒤 다시 실행하세요.');
  }
  // A keyword may repeat within one product (same link) but must never point to two products.
  const byKeyword = {};
  existingKeywords.forEach(function (k) {
    const key = k.keyword.toUpperCase();
    (byKeyword[key] = byKeyword[key] || {})[k.productId] = true;
  });
  const clashes = Object.keys(byKeyword).filter(function (k) {
    return Object.keys(byKeyword[k]).length > 1;
  });
  if (clashes.length) {
    throw new Error('REELS에서 같은 ManyChat 키워드가 여러 상품에 쓰이고 있습니다: ' + clashes.join(', ') + '. 정리한 뒤 다시 실행하세요.');
  }

  // Check the product keyword before paying for Gemini: it must not belong to another product.
  const productKeyword = normalizeText(product.keyword).toUpperCase();
  if (productKeyword) {
    const owner = existingKeywords.filter(function (k) {
      return k.keyword.toUpperCase() === productKeyword && k.productId !== product.id;
    })[0];
    if (owner) {
      throw new Error('ManyChat 키워드 "' + product.keyword + '"가 이미 다른 릴스·상품(' + owner.productId + ')에서 쓰이고 있습니다. 상품마다 다른 키워드를 쓰세요.');
    }
  }

  const already = existingIds.filter(function (id) {
    return id.indexOf(product.id + '-R') === 0;
  }).length;
  if (already > 0 && !options.allowAdditional) return { needsConfirm: already, product: product };

  const result = generateValidatedRecords_(product, existingIds, existingKeywords);
  appendRecords_(reelsSheet, result.records, RF_SCRIPT_FIELDS);

  const now = new Date();
  const actor = options.actor || '';
  const audit = [
    {
      '일시': now,
      '상품ID': product.id,
      '작업': 'PRODUCT_SUBMITTED',
      '작업자': actor,
      '메모': '터치포인트 1: 상품 선택 → 대본 생성 요청',
      '스냅샷(JSON)': JSON.stringify({
        상품명: normalizeText(product.name),
        확인된기능: parseConfirmedFeatures(product.features),
        제휴링크입력: !affiliateUrlError(product.affiliateUrl),
        영상사용허가: normalizeText(product.permission),
      }),
    },
  ];
  result.records.forEach(function (r) {
    const snap = {};
    RF_SCRIPT_FIELDS.forEach(function (f) {
      snap[f] = r[f];
    });
    audit.push({
      '일시': now,
      '릴스ID': r['릴스ID'],
      '상품ID': product.id,
      '작업': 'SCRIPTS_GENERATED',
      '새 상태': r['상태'],
      '대본 버전': 1,
      '영상 버전': 0,
      '작업자': 'Gemini (' + r['생성 모델'] + ')',
      '스냅샷(JSON)': JSON.stringify(snap),
    });
  });
  appendAudit_(ss, audit);

  const ids = result.records.map(function (r) {
    return r['릴스ID'];
  });
  logEvent_('INFO', 'generateReels', product.id, '릴스 대본 생성 완료: ' + ids.join(', '), '시도 횟수: ' + result.attempts);
  return { ids: ids, product: product };
}

/** Menu action: PRODUCTS selected row → Gemini → 3 validated REELS rows. */
function generateReelsForSelectedProduct() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const active = ss.getActiveSheet();
  const range = active.getActiveRange();

  const productsTab = findSheet_(ss, RF_CONFIG.SHEETS.PRODUCTS);
  const onProducts = productsTab && active.getName() === productsTab.getName();
  if (!onProducts || !range || range.getNumRows() !== 1 || range.getRow() < 2) {
    ui.alert('PRODUCTS 시트에서 상품 행 하나(2행 이상)를 선택한 뒤 다시 실행하세요.');
    return;
  }

  const lock = getLock_();
  if (!lock.tryLock(30000)) {
    ui.alert('다른 생성 작업이 진행 중입니다. 잠시 후 다시 시도하세요.');
    return;
  }

  let productId = '';
  try {
    const opts = { actor: currentUserEmail_(), allowAdditional: false };
    let res = generateScriptsForProduct_(ss, range.getRow(), opts);
    productId = res.product.id;
    if (res.needsConfirm) {
      const ok = ui.alert(
        '추가 생성 확인',
        productId + '에 이미 릴스 ' + res.needsConfirm + '개가 있습니다. 새 대본 3개를 추가로 생성할까요?',
        ui.ButtonSet.YES_NO
      );
      if (ok !== ui.Button.YES) return;
      opts.allowAdditional = true;
      ss.toast('Gemini로 ' + productId + ' 대본 생성 중…', '릴스 팩토리', 60);
      res = generateScriptsForProduct_(ss, range.getRow(), opts);
    }

    let msg = 'REELS에 ' + res.ids.length + '개 행을 추가했습니다:\n' + res.ids.join('\n') +
      '\n\n다음 단계: iPhone 대시보드(또는 REELS 시트)에서 대본을 검토·승인하세요. 승인 전에는 영상 작업이 시작되지 않습니다.';
    if (!isPermissionApproved(res.product.permission)) msg += '\n\n⚠ ' + RF_CONFIG.PERMISSION_UNVERIFIED_NOTE;
    ui.alert(msg);
  } catch (e) {
    logEvent_('ERROR', 'generateReels', productId, e.message, e.stack);
    ui.alert('릴스 대본 생성 실패\n\n' + e.message);
  } finally {
    lock.releaseLock();
  }
}

/** Validates the bundled PRD-001 fixture response without calling Gemini or writing to sheets. */
function runOfflineFixtureTest() {
  const result = prepareReelRecords(
    FIXTURE_PRD_001_PRODUCT,
    JSON.stringify(FIXTURE_PRD_001_GEMINI_RESPONSE),
    [],
    [],
    { model: 'fixture', generatedAt: new Date() }
  );
  const msg = result.errors.length
    ? '실패:\n- ' + result.errors.join('\n- ')
    : '통과: ' + result.records.map(function (r) {
        return r['릴스ID'] + ' / ' + r['ManyChat 키워드'];
      }).join(', ');
  SpreadsheetApp.getUi().alert('PRD-001 오프라인 테스트\n\n' + msg);
}

/** Calls Gemini for the PRD-001 fixture and validates the result. Writes only to LOG. */
function runLiveGeminiTestPRD001() {
  const ui = SpreadsheetApp.getUi();
  try {
    const result = generateValidatedRecords_(FIXTURE_PRD_001_PRODUCT, [], []);
    logEvent_('INFO', 'liveTestPRD001', 'PRD-001', '실제 Gemini 테스트 통과 (시도 ' + result.attempts + ')',
      JSON.stringify(result.records, null, 2));
    ui.alert('PRD-001 Gemini 테스트 통과 (시도 ' + result.attempts + '회).\n결과는 LOG 시트에 기록했습니다. REELS에는 쓰지 않았습니다.');
  } catch (e) {
    logEvent_('ERROR', 'liveTestPRD001', 'PRD-001', e.message, e.stack);
    ui.alert('PRD-001 Gemini 테스트 실패\n\n' + e.message);
  }
}

// ===== WebApp.gs =====
/**
 * iPhone-first approval dashboard (Apps Script HTML Service web app).
 *
 * Access model (see docs/iphone-dashboard.md):
 * - Deploy as web app with "Execute as: User accessing the web app" and "Who has access: Only myself"
 *   (or "Anyone with a Google account" for a team), so Google signs the user in.
 * - Every api* function additionally checks the signed-in email against Script Property RF_REVIEWERS.
 * - The Gemini API key never leaves the server. Affiliate URLs are returned only in the publishing pack
 *   of a READY_TO_PUBLISH reel.
 * - Google Sheets stays the system of record: every decision is written to REELS and AUDIT.
 */

const RF_CLIENT_ACTIONS = [
  'APPROVE_SCRIPT',
  'REQUEST_SCRIPT_CHANGES',
  'EDIT_SCRIPT',
  'REJECT_SCRIPT',
  'REOPEN_SCRIPT',
  'START_VIDEO',
  'REGISTER_VIDEO',
  'MARK_VIDEO_FAILED',
  'APPROVE_VIDEO',
  'REQUEST_VIDEO_CHANGES',
  'REJECT_VIDEO',
  'MARK_READY_TO_PUBLISH',
  'CONFIRM_PUBLISHED',
  'CONFIRM_MANYCHAT',
];

function doGet() {
  let html;
  try {
    requireReviewer_();
    html = typeof RF_DASHBOARD_HTML !== 'undefined'
      ? RF_DASHBOARD_HTML
      : HtmlService.createHtmlOutputFromFile('Dashboard').getContent();
  } catch (e) {
    html = '<!doctype html><meta charset="utf-8"><body style="font:16px -apple-system,sans-serif;padding:24px">' +
      '<h2>접근할 수 없습니다</h2><p>' + escapeHtml_(e.message) + '</p></body>';
  }
  return HtmlService.createHtmlOutput(html)
    .setTitle('릴스 팩토리')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function reviewerList_() {
  const raw = PropertiesService.getScriptProperties().getProperty(RF_CONFIG.REVIEWERS_PROPERTY) || '';
  return raw
    .split(',')
    .map(function (e) {
      return normalizeText(e).toLowerCase();
    })
    .filter(function (e) {
      return e.length > 0;
    });
}

/** Throws unless the signed-in Google account is listed in RF_REVIEWERS. Returns the email. */
function requireReviewer_() {
  const list = reviewerList_();
  if (!list.length) {
    throw new Error('검토자가 등록되지 않았습니다. Google Sheets에서 "릴스 팩토리 → 시트 준비"를 실행해 본인 계정을 등록하세요.');
  }
  const email = currentUserEmail_().toLowerCase();
  if (!email) {
    throw new Error('Google 계정을 확인할 수 없습니다. 웹 앱을 "실행 사용자: 웹 앱에 액세스하는 사용자"로 배포했는지 확인하세요.');
  }
  if (list.indexOf(email) === -1) {
    throw new Error('이 계정(' + email + ')은 검토 권한이 없습니다. 소유자가 스크립트 속성 RF_REVIEWERS에 추가해야 합니다.');
  }
  return email;
}

/** Adds the current user to RF_REVIEWERS. Returns a report line for 시트 준비. */
function registerSelfAsReviewer_() {
  const email = currentUserEmail_().toLowerCase();
  if (!email) return '✗ 대시보드 검토자: 현재 Google 계정 이메일을 확인할 수 없습니다.';
  const list = reviewerList_();
  if (list.indexOf(email) === -1) {
    list.push(email);
    PropertiesService.getScriptProperties().setProperty(RF_CONFIG.REVIEWERS_PROPERTY, list.join(','));
  }
  return '✓ 대시보드 검토자: ' + list.join(', ');
}

/** Menu: shows the deployed dashboard URL to open on iPhone. */
function showDashboardLink() {
  const ui = SpreadsheetApp.getUi();
  let url = '';
  try {
    url = ScriptApp.getService().getUrl() || '';
  } catch (e) {
    url = '';
  }
  if (!url) {
    ui.alert(
      '대시보드가 아직 배포되지 않았습니다.\n\nApps Script 편집기 → 배포 → 새 배포 → 유형: 웹 앱\n' +
        '실행 사용자: 웹 앱에 액세스하는 사용자 / 액세스 권한: 나만\n\n자세한 방법: docs/iphone-dashboard.md'
    );
    return;
  }
  const safe = escapeHtml_(url);
  ui.showModalDialog(
    HtmlService.createHtmlOutput(
      '<p style="font:14px sans-serif">iPhone Safari에서 이 링크를 열고 <b>공유 → 홈 화면에 추가</b>를 누르세요.</p>' +
        '<p style="font:14px sans-serif;word-break:break-all"><a href="' + safe + '" target="_blank">' + safe + '</a></p>'
    ).setWidth(420).setHeight(180),
    'iPhone 대시보드 링크'
  );
}

/** Wraps an API call: auth check, error → { ok:false, error }, and Date → string for google.script.run. */
function api_(fn) {
  try {
    const user = requireReviewer_();
    const result = fn(user);
    return JSON.parse(JSON.stringify(Object.assign({ ok: true, user: user }, result || {})));
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function productFromRecord_(rec) {
  const f = Object.assign({}, RF_CONFIG.PRODUCT_FIELDS, RF_CONFIG.PRODUCT_OPTIONAL_FIELDS);
  const p = { rowNumber: rec._row };
  Object.keys(f).forEach(function (k) {
    p[k] = rec[f[k]];
  });
  p.id = normalizeText(p.id);
  return p;
}

/** Loads PRODUCTS and REELS as plain objects. */
function loadData_(ss) {
  const f = RF_CONFIG.PRODUCT_FIELDS;
  const productsSheet = getProductsSheet_(ss);
  const productHeaders = Object.keys(f).map(function (k) {
    return f[k];
  });
  requireHeaders_(productsSheet, productHeaders);
  const optionalHeaders = Object.keys(RF_CONFIG.PRODUCT_OPTIONAL_FIELDS).map(function (k) {
    return RF_CONFIG.PRODUCT_OPTIONAL_FIELDS[k];
  });
  const products = readRecords_(productsSheet, productHeaders.concat(optionalHeaders))
    .map(productFromRecord_)
    .filter(function (p) {
      return p.id;
    });
  const byId = {};
  products.forEach(function (p) {
    byId[p.id] = byId[p.id] ? 'DUPLICATE' : p;
  });

  const warnings = [];
  const reelsSheet = findSheet_(ss, RF_CONFIG.SHEETS.REELS);
  let reels = [];
  if (reelsSheet && reelsSheet.getLastColumn() > 0) {
    const missing = missingHeaders_(reelsSheet, RF_CONFIG.REELS_HEADERS);
    if (missing.length) {
      warnings.push('REELS 시트에 승인 관리용 헤더가 없습니다 (' + missing.length + '개). Google Sheets에서 "릴스 팩토리 → 시트 준비"를 실행하세요.');
    }
    reels = readRecords_(reelsSheet, RF_CONFIG.REELS_HEADERS).filter(function (r) {
      return normalizeText(r['릴스ID']);
    });
  }
  return { products: products, productById: byId, reels: reels, reelsSheet: reelsSheet, warnings: warnings };
}

function findReel_(data, reelId) {
  const matches = data.reels.filter(function (r) {
    return normalizeText(r['릴스ID']) === reelId;
  });
  if (!matches.length) throw new Error('REELS에서 릴스ID "' + reelId + '"를 찾을 수 없습니다.');
  if (matches.length > 1) throw new Error('REELS에 릴스ID "' + reelId + '"가 여러 번 있습니다. 시트에서 중복을 정리하세요.');
  const row = matches[0];
  const product = data.productById[normalizeText(row['상품ID'])];
  if (!product) throw new Error('PRODUCTS에서 상품ID "' + row['상품ID'] + '"를 찾을 수 없습니다.');
  if (product === 'DUPLICATE') throw new Error('PRODUCTS에 상품ID "' + row['상품ID'] + '"가 여러 번 있습니다.');
  return { row: row, product: product };
}

function reelSummary_(row, data) {
  const status = reelStatus(row);
  const product = data.productById[normalizeText(row['상품ID'])];
  return {
    reelId: normalizeText(row['릴스ID']),
    productId: normalizeText(row['상품ID']),
    productName: product && product !== 'DUPLICATE' ? normalizeText(product.name) : '',
    variant: row['버전'],
    status: status,
    statusLabel: RF_STATUS_LABELS[status] || '상태 확인 필요',
    concept: cellText_(row['컨셉']),
    hook: cellText_(row['후킹']),
    scriptVersion: scriptVersionOf(row),
    videoVersion: videoVersionOf(row),
    error: cellText_(row['오류']),
  };
}

function allowedActions_(status) {
  return RF_CLIENT_ACTIONS.filter(function (a) {
    return RF_ACTIONS[a].from.indexOf(status) !== -1;
  });
}

function parseFlowScenePrompts_(row) {
  try {
    const v = JSON.parse(cellText_(row['Flow 장면 프롬프트']) || '[]');
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

function reelDetail_(ss, reelId) {
  const data = loadData_(ss);
  const found = findReel_(data, reelId);
  const row = found.row;
  const product = found.product;
  const status = reelStatus(row);
  const reel = rowToReel(row);
  const fileId = parseDriveFileId(row['영상 파일 URL']);

  const auditSheet = findSheet_(ss, RF_CONFIG.SHEETS.AUDIT);
  const history = auditSheet && auditSheet.getLastColumn() > 0
    ? readRecords_(auditSheet, RF_CONFIG.AUDIT_HEADERS)
        .filter(function (a) {
          return normalizeText(a['릴스ID']) === reelId ||
            (!normalizeText(a['릴스ID']) && normalizeText(a['상품ID']) === product.id);
        })
        .slice(-40)
        .reverse()
        .map(function (a) {
          return {
            at: a['일시'],
            action: a['작업'],
            label: (RF_ACTIONS[a['작업']] && RF_ACTIONS[a['작업']].label) || a['작업'],
            to: RF_STATUS_LABELS[a['새 상태']] || a['새 상태'],
            scriptVersion: a['대본 버전'],
            videoVersion: a['영상 버전'],
            actor: a['작업자'],
            note: a['메모'],
          };
        })
    : [];

  return {
    summary: reelSummary_(row, data),
    reel: reel,
    scenesInvalid: !reel.scenes,
    cta: cellText_(row['CTA']),
    keyword: cellText_(row['ManyChat 키워드']),
    disclosure: cellText_(row['광고 표기']),
    flowPrompts: cellText_(row['Flow 프롬프트']),
    flowScenePrompts: parseFlowScenePrompts_(row),
    flowStatus: cellText_(row['Flow 생성']),
    approvedVersion: cellText_(row['승인 대본 버전']),
    approvedIntact: isApprovedScriptIntact(row),
    scriptReview: { by: cellText_(row['대본 검토자']), at: row['대본 검토일시'], note: cellText_(row['대본 검토 메모']) },
    videoReview: { by: cellText_(row['영상 검토자']), at: row['영상 검토일시'], note: cellText_(row['영상 검토 메모']) },
    video: fileId ? { url: driveViewUrl(fileId), previewUrl: drivePreviewUrl(fileId) } : null,
    product: {
      id: product.id,
      name: normalizeText(product.name),
      facts: parseConfirmedFeatures(product.features),
      target: normalizeText(product.target),
      permission: normalizeText(product.permission) || '미입력',
      permissionOk: isPermissionApproved(product.permission),
      affiliateUrlOk: !affiliateUrlError(product.affiliateUrl),
    },
    touchpoints: touchpointSummary(row, product),
    allowedActions: allowedActions_(status),
    canRegenerate: status === 'SCRIPT_CHANGES_REQUESTED',
    history: history,
    warnings: data.warnings,
  };
}

/** Plans and writes one transition (caller holds the lock). Returns the plan. */
function applyTransition_(ss, reelId, action, input, actor) {
  const data = loadData_(ss);
  const found = findReel_(data, reelId);
  const plan = planTransition(found.row, found.product, action, input, { actor: actor, now: new Date() });
  if (!plan.noop) {
    updateRecord_(data.reelsSheet, found.row._row, plan.updates);
    appendAudit_(ss, [plan.audit]);
  }
  return plan;
}

function withLock_(fn) {
  const lock = getLock_();
  if (!lock.tryLock(20000)) throw new Error('다른 작업이 진행 중입니다. 잠시 후 다시 시도하세요.');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- API (google.script.run)

function apiGetDashboard() {
  return api_(function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const data = loadData_(ss);
    const reelCount = {};
    data.reels.forEach(function (r) {
      const id = normalizeText(r['상품ID']);
      reelCount[id] = (reelCount[id] || 0) + 1;
    });
    return {
      warnings: data.warnings,
      products: data.products.map(function (p) {
        return {
          id: p.id,
          name: normalizeText(p.name),
          factsCount: parseConfirmedFeatures(p.features).length,
          affiliateUrlOk: !affiliateUrlError(p.affiliateUrl),
          permission: normalizeText(p.permission) || '미입력',
          permissionOk: isPermissionApproved(p.permission),
          reelCount: reelCount[p.id] || 0,
          duplicate: data.productById[p.id] === 'DUPLICATE',
        };
      }),
      reels: data.reels.map(function (r) {
        return reelSummary_(r, data);
      }),
    };
  });
}

function apiGetReel(reelId) {
  return api_(function () {
    return { detail: reelDetail_(SpreadsheetApp.getActiveSpreadsheet(), normalizeText(reelId)) };
  });
}

function apiAction(reelId, action, input) {
  return api_(function (user) {
    if (RF_CLIENT_ACTIONS.indexOf(action) === -1) throw new Error('허용되지 않은 작업입니다: ' + action);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(reelId);
    let notice = '';
    const plan = withLock_(function () {
      const p = applyTransition_(ss, id, action, input || {}, user);
      // A video approval immediately tries to prepare publishing; missing prerequisites are recorded, not hidden.
      if (action === 'APPROVE_VIDEO' && !p.noop) {
        try {
          applyTransition_(ss, id, 'MARK_READY_TO_PUBLISH', {}, 'system');
        } catch (e) {
          const data = loadData_(ss);
          const found = findReel_(data, id);
          updateRecord_(data.reelsSheet, found.row._row, { '오류': e.message });
          appendAudit_(ss, [{
            '일시': new Date(),
            '릴스ID': id,
            '상품ID': found.row['상품ID'],
            '작업': 'READY_TO_PUBLISH_BLOCKED',
            '이전 상태': 'VIDEO_APPROVED',
            '새 상태': 'VIDEO_APPROVED',
            '대본 버전': scriptVersionOf(found.row),
            '영상 버전': videoVersionOf(found.row),
            '작업자': 'system',
            '메모': e.message,
          }]);
          notice = '영상은 승인되었지만 게시 준비를 마치지 못했습니다:\n' + e.message;
        }
      }
      return p;
    });
    return {
      noop: plan.noop,
      notice: notice || (plan.noop ? '이미 처리된 요청입니다.' : ''),
      detail: reelDetail_(ss, id),
    };
  });
}

/** Rewrites one script with Gemini after "수정 요청". One paid call (plus one corrective retry). */
function apiRegenerateScript(reelId, input) {
  return api_(function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(reelId);
    input = input || {};
    withLock_(function () {
      const data = loadData_(ss);
      const found = findReel_(data, id);
      const status = reelStatus(found.row);
      if (status !== 'SCRIPT_CHANGES_REQUESTED' || Number(input.expectedScriptVersion) !== scriptVersionOf(found.row)) {
        throw staleError_(found.row, status);
      }
      const current = rowToReel(found.row);
      const note = cellText_(found.row['대본 검토 메모']);
      let lastErrors = [];
      let lastRaw = '';
      let newReel = null;
      for (let attempt = 1; attempt <= RF_CONFIG.MAX_GEMINI_ATTEMPTS && !newReel; attempt++) {
        const raw = callGemini_(buildRegenerationPrompt(found.product, current, note, lastErrors, lastRaw), geminiResponseSchema(1));
        const parsed = parseModelJson(raw);
        const result = parsed.error ? { errors: [parsed.error] } : validateGeminiReels(parsed.value, found.product, 1);
        if (result.errors.length) {
          lastErrors = result.errors;
          lastRaw = raw;
          logEvent_('WARN', 'regenerateScript', found.product.id, id + ' 재생성 검증 실패 (시도 ' + attempt + ')',
            result.errors.join('\n') + '\n\n--- 원본 응답 ---\n' + raw);
        } else {
          newReel = result.reels[0];
        }
      }
      if (!newReel) {
        throw new Error('재생성된 대본이 검증을 통과하지 못했습니다. 대본은 바뀌지 않았습니다.\n- ' + lastErrors.slice(0, 6).join('\n- '));
      }
      applyTransition_(ss, id, 'REGENERATE_SCRIPT', {
        expectedStatus: status,
        expectedScriptVersion: scriptVersionOf(found.row),
        reel: newReel,
        note: note,
      }, 'Gemini (' + (RF_GEMINI_STATE.lastModel || getGeminiModel()) + ')');
    });
    return { detail: reelDetail_(ss, id) };
  });
}

/** Touchpoint 1 from the phone: generate 3 scripts for a product already entered in PRODUCTS. */
function apiGenerateScripts(productId, allowAdditional) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    return withLock_(function () {
      const row = findProductRow_(getProductsSheet_(ss), normalizeText(productId));
      const res = generateScriptsForProduct_(ss, row, { actor: user, allowAdditional: !!allowAdditional });
      return res.needsConfirm ? { needsConfirm: res.needsConfirm } : { ids: res.ids };
    });
  });
}

function apiGetPublishingPack(reelId) {
  return api_(function () {
    const data = loadData_(SpreadsheetApp.getActiveSpreadsheet());
    const found = findReel_(data, normalizeText(reelId));
    return { pack: buildPublishingPack(found.row, found.product) };
  });
}

// ---------------------------------------------------------------- render jobs

/** Shared HMAC key between this script and the renderer. Created on first use. */
function getRenderSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('RF_RENDER_SECRET');
  if (!secret) {
    secret = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('RF_RENDER_SECRET', secret);
  }
  return secret;
}

function signRenderJob_(payload) {
  return bytesToHex_(Utilities.computeHmacSha256Signature(payload, getRenderSecret_(), Utilities.Charset.UTF_8));
}

/**
 * Issues a signed render job for an approved reel in production. No paid API is called here;
 * the renderer spends TTS characters only after verifying this signature.
 */
function apiGetRenderJob(reelId) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const data = loadData_(ss);
    const found = findReel_(data, normalizeText(reelId));
    const payload = buildRenderJobPayload(found.row, found.product, new Date().toISOString(), RF_RENDER_JOB_TTL_HOURS);
    const job = JSON.parse(payload);
    appendAudit_(ss, [{
      '일시': new Date(),
      '릴스ID': job.reelId,
      '상품ID': job.productId,
      '작업': 'RENDER_JOB_ISSUED',
      '이전 상태': job.status,
      '새 상태': job.status,
      '대본 버전': job.scriptVersion,
      '영상 버전': job.nextVideoVersion - 1,
      '작업자': user,
      '메모': '만료: ' + job.expiresAt,
    }]);
    return {
      fileName: job.reelId + '_v' + job.scriptVersion + '.render-job.json',
      jobFile: JSON.stringify({ payload: payload, signature: signRenderJob_(payload) }, null, 2),
    };
  });
}

/** Menu: shows the render key once so the operator can put it in renderer/.env on the Mac. */
function showRenderSecret() {
  const ui = SpreadsheetApp.getUi();
  const secret = escapeHtml_(getRenderSecret_());
  ui.showModalDialog(
    HtmlService.createHtmlOutput(
      '<p style="font:14px sans-serif">Mac의 <code>renderer/.env</code> 파일에 아래 한 줄을 넣으세요. 이 키가 있어야 승인된 렌더 작업만 실행됩니다. 다른 사람과 공유하지 마세요.</p>' +
        '<pre style="font:13px monospace;white-space:pre-wrap;word-break:break-all;background:#f3f3f3;padding:8px">RF_RENDER_SECRET=' + secret + '</pre>'
    ).setWidth(460).setHeight(200),
    '렌더 키 (Mac 설정용)'
  );
}

// ===== Dashboard.html (embedded) =====
const RF_DASHBOARD_HTML = "<!doctype html>\n<html lang=\"ko\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<base target=\"_top\">\n<title>릴스 팩토리</title>\n<style>\n  :root {\n    --bg: #f2f2f7; --card: #ffffff; --text: #1c1c1e; --muted: #6e6e73; --line: #d1d1d6;\n    --accent: #0a66d6; --ok: #1a7f37; --warn: #a15c00; --bad: #c62828; --chip: #e9e9ef;\n  }\n  @media (prefers-color-scheme: dark) {\n    :root { --bg: #000; --card: #1c1c1e; --text: #f2f2f7; --muted: #a1a1a6; --line: #38383a;\n      --accent: #4c9aff; --ok: #3fb950; --warn: #e3a008; --bad: #ff6b6b; --chip: #2c2c2e; }\n  }\n  * { box-sizing: border-box; }\n  html, body { margin: 0; background: var(--bg); color: var(--text);\n    font: 16px/1.45 -apple-system, BlinkMacSystemFont, \"Apple SD Gothic Neo\", \"Noto Sans KR\", sans-serif; }\n  header { position: sticky; top: 0; z-index: 5; background: var(--bg);\n    padding: calc(env(safe-area-inset-top) + 10px) 16px 8px; border-bottom: 1px solid var(--line); }\n  header h1 { font-size: 20px; margin: 0; display: flex; align-items: center; gap: 8px; }\n  header .user { font-size: 12px; color: var(--muted); }\n  main { padding: 12px 16px calc(env(safe-area-inset-bottom) + 90px); max-width: 720px; margin: 0 auto; }\n  nav { position: fixed; bottom: 0; left: 0; right: 0; z-index: 5; display: flex; background: var(--card);\n    border-top: 1px solid var(--line); padding-bottom: env(safe-area-inset-bottom); }\n  nav button { flex: 1; border: 0; background: none; color: var(--muted); padding: 8px 2px 10px; font-size: 12px;\n    min-height: 56px; position: relative; }\n  nav button.on { color: var(--accent); font-weight: 600; }\n  nav .n { position: absolute; top: 4px; right: 18%; background: var(--bad); color: #fff; border-radius: 9px;\n    font-size: 11px; min-width: 18px; padding: 0 5px; }\n  nav .ico { display: block; font-size: 20px; line-height: 24px; }\n  .card { background: var(--card); border-radius: 14px; padding: 14px; margin: 0 0 12px; border: 1px solid var(--line); }\n  .card.tap { cursor: pointer; }\n  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }\n  .muted { color: var(--muted); font-size: 13px; }\n  .chip { display: inline-block; background: var(--chip); border-radius: 999px; padding: 2px 10px; font-size: 12px; }\n  .chip.ok { color: var(--ok); } .chip.warn { color: var(--warn); } .chip.bad { color: var(--bad); }\n  h2 { font-size: 17px; margin: 18px 0 8px; }\n  h3 { font-size: 15px; margin: 14px 0 6px; }\n  .hook { font-weight: 600; font-size: 17px; margin: 6px 0; }\n  .pre { white-space: pre-wrap; word-break: break-word; }\n  .scene { border-top: 1px solid var(--line); padding: 10px 0 2px; }\n  .flow { font-size: 15px; background: var(--chip); border-radius: 8px; padding: 8px; white-space: pre-wrap; word-break: break-word; }\n  .flow.mono { font-family: ui-monospace, Menlo, monospace; font-size: 13px; }\n  .btns { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }\n  .btns.one { grid-template-columns: 1fr; }\n  button.b { min-height: 48px; border-radius: 12px; border: 1px solid var(--line); background: var(--card);\n    color: var(--text); font-size: 16px; font-weight: 600; padding: 8px 12px; }\n  button.b.primary { background: var(--accent); color: #fff; border-color: var(--accent); }\n  button.b.ok { background: var(--ok); color: #fff; border-color: var(--ok); }\n  button.b.bad { color: var(--bad); }\n  button.b:disabled { opacity: .5; }\n  button.link { border: 0; background: none; color: var(--accent); font-size: 15px; padding: 8px 0; min-height: 44px; }\n  textarea, input[type=text], input[type=url] { width: 100%; font: inherit; font-size: 16px; color: var(--text);\n    background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: 10px; }\n  textarea { min-height: 88px; }\n  label { display: block; font-size: 13px; color: var(--muted); margin: 10px 0 4px; }\n  .banner { border-radius: 12px; padding: 10px 12px; margin: 0 0 12px; font-size: 14px; white-space: pre-wrap; }\n  .banner.warn { background: rgba(227,160,8,.15); } .banner.bad { background: rgba(198,40,40,.13); }\n  .banner.ok { background: rgba(26,127,55,.13); }\n  .tp { display: grid; grid-template-columns: 28px 1fr; gap: 4px 8px; align-items: start; padding: 6px 0; }\n  .tp .dot { width: 24px; height: 24px; border-radius: 12px; display: grid; place-items: center; font-size: 13px;\n    background: var(--chip); }\n  .tp .dot.done { background: var(--ok); color: #fff; }\n  .video { position: relative; width: 100%; max-width: 360px; aspect-ratio: 9 / 16; margin: 8px auto;\n    background: #000; border-radius: 12px; overflow: hidden; }\n  .video iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }\n  .tabs2 { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; }\n  .tabs2 button { flex: none; min-height: 36px; border-radius: 999px; border: 1px solid var(--line);\n    background: var(--card); color: var(--text); padding: 4px 12px; font-size: 14px; }\n  .tabs2 button.on { background: var(--accent); color: #fff; border-color: var(--accent); }\n  details summary { min-height: 44px; display: flex; align-items: center; color: var(--accent); cursor: pointer; }\n  .hist { font-size: 13px; border-top: 1px solid var(--line); padding: 6px 0; }\n  .empty { text-align: center; color: var(--muted); padding: 32px 0; }\n  #toast { position: fixed; left: 16px; right: 16px; bottom: calc(env(safe-area-inset-bottom) + 72px); z-index: 9;\n    background: #333; color: #fff; border-radius: 12px; padding: 12px; font-size: 14px; display: none; white-space: pre-wrap; }\n  #busy { position: fixed; inset: 0; z-index: 8; background: rgba(0,0,0,.25); display: none; place-items: center; }\n  #busy div { background: var(--card); padding: 16px 20px; border-radius: 12px; }\n</style>\n</head>\n<body>\n<header>\n  <h1 id=\"title\">릴스 팩토리</h1>\n  <div class=\"user\" id=\"user\"></div>\n</header>\n<main id=\"main\"><div class=\"empty\">불러오는 중…</div></main>\n<nav id=\"nav\"></nav>\n<div id=\"toast\"></div>\n<div id=\"busy\"><div id=\"busyText\">처리 중…</div></div>\n\n<script>\n'use strict';\n// ---------------------------------------------------------------- helpers\n// All data is rendered with textContent / attributes, never parsed as HTML.\nfunction h(tag, attrs, children) {\n  const el = document.createElement(tag);\n  Object.keys(attrs || {}).forEach(function (k) {\n    const v = attrs[k];\n    if (v == null || v === false) return;\n    if (k === 'class') el.className = v;\n    else if (k === 'text') el.textContent = v;\n    else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);\n    else el.setAttribute(k, v === true ? '' : v);\n  });\n  (children || []).forEach(function (c) {\n    if (c == null || c === false) return;\n    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);\n  });\n  return el;\n}\nfunction clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }\nfunction fmt(v) {\n  if (!v) return '';\n  const d = new Date(v);\n  if (isNaN(d)) return String(v);\n  const p = function (n) { return (n < 10 ? '0' : '') + n; };\n  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());\n}\nfunction toast(msg, ms) {\n  const t = document.getElementById('toast');\n  t.textContent = msg; t.style.display = 'block';\n  clearTimeout(toast._t); toast._t = setTimeout(function () { t.style.display = 'none'; }, ms || 3500);\n}\nfunction busy(on, text) {\n  document.getElementById('busyText').textContent = text || '처리 중…';\n  document.getElementById('busy').style.display = on ? 'grid' : 'none';\n}\nfunction call(name) {\n  const args = Array.prototype.slice.call(arguments, 1);\n  return new Promise(function (resolve) {\n    const runner = google.script.run\n      .withSuccessHandler(function (res) { resolve(res || { ok: false, error: '빈 응답' }); })\n      .withFailureHandler(function (err) { resolve({ ok: false, error: (err && err.message) || String(err) }); });\n    runner[name].apply(runner, args);\n  });\n}\nfunction copyText(text) {\n  function fallback() {\n    const ta = h('textarea', { readonly: true, style: 'position:fixed;top:0;left:0;opacity:0' });\n    ta.value = text; document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);\n    let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }\n    document.body.removeChild(ta); return ok;\n  }\n  const done = function (ok) { toast(ok ? '복사했습니다' : '복사하지 못했습니다. 길게 눌러 직접 복사하세요.'); };\n  if (navigator.clipboard && navigator.clipboard.writeText) {\n    navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallback()); });\n  } else { done(fallback()); }\n}\nfunction copyBlock(label, text, mono) {\n  return h('div', {}, [\n    h('div', { class: 'row', style: 'justify-content:space-between' }, [\n      h('span', { class: 'muted', text: label }),\n      h('button', { class: 'link', type: 'button', onclick: function () { copyText(text); }, text: '복사' }),\n    ]),\n    h('div', { class: 'flow' + (mono ? ' mono' : ''), text: text }),\n  ]);\n}\n\n// ---------------------------------------------------------------- state\nconst TABS = [\n  { key: 'script', ico: '📝', label: '대본', statuses: ['SCRIPT_REVIEW_PENDING', 'SCRIPT_CHANGES_REQUESTED'], badge: ['SCRIPT_REVIEW_PENDING'] },\n  { key: 'make', ico: '🎬', label: '제작', statuses: ['SCRIPT_APPROVED', 'VIDEO_IN_PRODUCTION', 'VIDEO_FAILED', 'VIDEO_CHANGES_REQUESTED'], badge: ['VIDEO_FAILED'] },\n  { key: 'video', ico: '▶️', label: '영상', statuses: ['VIDEO_REVIEW_PENDING'], badge: ['VIDEO_REVIEW_PENDING'] },\n  { key: 'publish', ico: '📤', label: '게시', statuses: ['VIDEO_APPROVED', 'READY_TO_PUBLISH'], badge: ['READY_TO_PUBLISH', 'VIDEO_APPROVED'] },\n  { key: 'products', ico: '🛍️', label: '상품' },\n  { key: 'done', ico: '✅', label: '기록', statuses: ['COMPLETED', 'SCRIPT_REJECTED', 'VIDEO_REJECTED', ''] },\n];\nconst S = { tab: 'script', dash: null, detail: null, mode: 'view' };\n\nfunction tabFor(status) {\n  for (let i = 0; i < TABS.length; i++) if (TABS[i].statuses && TABS[i].statuses.indexOf(status) !== -1) return TABS[i].key;\n  return 'done';\n}\nfunction statusChip(status, label) {\n  const cls = /REJECTED|FAILED/.test(status) ? 'bad' : /APPROVED|READY|COMPLETED/.test(status) ? 'ok' : 'warn';\n  return h('span', { class: 'chip ' + cls, text: label || status || '상태 없음' });\n}\n\n// ---------------------------------------------------------------- loading\nfunction loadDashboard() {\n  return call('apiGetDashboard').then(function (res) {\n    if (!res.ok) { renderFatal(res.error); return; }\n    S.dash = res;\n    document.getElementById('user').textContent = res.user + ' · Google Sheets 기준';\n    renderNav(); if (!S.detail) renderList();\n  });\n}\nfunction openReel(reelId) {\n  busy(true, '불러오는 중…');\n  return call('apiGetReel', reelId).then(function (res) {\n    busy(false);\n    if (!res.ok) { toast(res.error, 6000); return; }\n    S.detail = res.detail; S.mode = 'view'; renderDetail(); window.scrollTo(0, 0);\n  });\n}\n// Reloads list data (badges, sibling chips) without leaving the open reel.\nfunction refreshAround() {\n  return loadDashboard().then(function () { if (S.detail && S.mode === 'view') renderDetail(); });\n}\nfunction backToList() { S.detail = null; S.mode = 'view'; loadDashboard().then(renderList); window.scrollTo(0, 0); }\n\nfunction renderFatal(msg) {\n  clear(document.getElementById('main')).appendChild(h('div', { class: 'banner bad', text: msg }));\n}\n\n// ---------------------------------------------------------------- nav + lists\nfunction renderNav() {\n  const nav = clear(document.getElementById('nav'));\n  const reels = (S.dash && S.dash.reels) || [];\n  TABS.forEach(function (t) {\n    const n = t.badge ? reels.filter(function (r) { return t.badge.indexOf(r.status) !== -1; }).length : 0;\n    nav.appendChild(h('button', {\n      type: 'button', class: S.tab === t.key && !S.detail ? 'on' : '',\n      onclick: function () { S.tab = t.key; S.detail = null; renderNav(); renderList(); window.scrollTo(0, 0); },\n    }, [h('span', { class: 'ico', text: t.ico }), t.label, n ? h('span', { class: 'n', text: String(n) }) : null]));\n  });\n}\n\nfunction warningsBanner(list) {\n  return (list || []).map(function (w) { return h('div', { class: 'banner warn', text: '⚠ ' + w }); });\n}\n\nfunction renderList() {\n  const main = clear(document.getElementById('main'));\n  const tab = TABS.filter(function (t) { return t.key === S.tab; })[0];\n  document.getElementById('title').textContent = '릴스 팩토리 · ' + tab.label;\n  warningsBanner(S.dash.warnings).forEach(function (b) { main.appendChild(b); });\n  if (tab.key === 'products') { renderProducts(main); return; }\n  const reels = S.dash.reels.filter(function (r) { return tabFor(r.status) === tab.key; });\n  const intro = {\n    script: '② 대본을 검토하세요. 승인된 대본 버전만 영상 제작에 쓰입니다.',\n    make: 'Google Flow 클립은 수동 생성입니다. 프롬프트를 복사해 Flow에서 만든 뒤, 완성 MP4를 Drive에 올려 등록하세요.',\n    video: '③ 완성 영상을 재생해 보고 승인/수정 요청/반려하세요.',\n    publish: '④ 게시 자료를 복사해 직접 인스타그램에 올리고 ManyChat을 설정한 뒤 확인을 누르세요. 자동 게시는 하지 않습니다.',\n    done: '완료·반려된 릴스와 상태 확인이 필요한 행입니다.',\n  }[tab.key];\n  main.appendChild(h('p', { class: 'muted', text: intro }));\n  if (!reels.length) { main.appendChild(h('div', { class: 'empty', text: '항목이 없습니다' })); return; }\n  reels.forEach(function (r) {\n    main.appendChild(h('div', { class: 'card tap', role: 'button', tabindex: '0', onclick: function () { openReel(r.reelId); } }, [\n      h('div', { class: 'row', style: 'justify-content:space-between' }, [\n        h('strong', { text: r.reelId }), statusChip(r.status, r.statusLabel),\n      ]),\n      h('div', { class: 'muted', text: r.productName + ' · 대본 v' + r.scriptVersion + (r.videoVersion ? ' · 영상 v' + r.videoVersion : '') }),\n      h('div', { class: 'hook', text: r.hook }),\n      h('div', { class: 'muted', text: r.concept }),\n      r.error ? h('div', { class: 'banner bad', style: 'margin:8px 0 0', text: r.error }) : null,\n    ]));\n  });\n}\n\nfunction renderProducts(main) {\n  main.appendChild(h('p', { class: 'muted', text: '① 상품 등록·제휴 링크·확인된 기능·영상 허가는 Google Sheets PRODUCTS에서 입력합니다. 여기서는 준비 상태를 확인하고 대본 생성을 요청할 수 있습니다.' }));\n  if (!S.dash.products.length) { main.appendChild(h('div', { class: 'empty', text: 'PRODUCTS에 상품이 없습니다' })); return; }\n  S.dash.products.forEach(function (p) {\n    const ready = p.factsCount > 0 && !p.duplicate;\n    main.appendChild(h('div', { class: 'card' }, [\n      h('div', { class: 'row', style: 'justify-content:space-between' }, [h('strong', { text: p.id }), h('span', { class: 'muted', text: '릴스 ' + p.reelCount + '개' })]),\n      h('div', { text: p.name }),\n      h('div', { class: 'row', style: 'margin-top:6px' }, [\n        h('span', { class: 'chip ' + (p.factsCount ? 'ok' : 'bad'), text: '확인된 기능 ' + p.factsCount }),\n        h('span', { class: 'chip ' + (p.affiliateUrlOk ? 'ok' : 'warn'), text: p.affiliateUrlOk ? '제휴 링크 ✓' : '제휴 링크 필요' }),\n        h('span', { class: 'chip ' + (p.permissionOk ? 'ok' : 'warn'), text: '영상 허가: ' + p.permission }),\n        p.duplicate ? h('span', { class: 'chip bad', text: '상품ID 중복' }) : null,\n      ]),\n      h('div', { class: 'btns one' }, [h('button', {\n        class: 'b', type: 'button', disabled: !ready,\n        onclick: function () { generate(p, false); },\n        text: p.reelCount ? '대본 3개 추가 생성' : '대본 3개 생성 (Gemini)',\n      })]),\n    ]));\n  });\n}\n\nfunction generate(p, allowAdditional) {\n  if (!allowAdditional && !confirm(p.id + ' 대본 3개를 Gemini로 생성할까요? (API 호출 1~2회)')) return;\n  busy(true, 'Gemini로 대본 생성 중… (최대 1분)');\n  call('apiGenerateScripts', p.id, allowAdditional).then(function (res) {\n    busy(false);\n    if (!res.ok) { toast(res.error, 8000); return; }\n    if (res.needsConfirm) {\n      if (confirm('이미 릴스 ' + res.needsConfirm + '개가 있습니다. 3개를 추가로 생성할까요?')) generate(p, true);\n      return;\n    }\n    toast('생성 완료: ' + res.ids.join(', '));\n    S.tab = 'script'; loadDashboard().then(function () { renderNav(); renderList(); });\n  });\n}\n\n// ---------------------------------------------------------------- detail\nfunction act(action, input, confirmText) {\n  const d = S.detail;\n  if (confirmText && !confirm(confirmText)) return;\n  const base = { expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion, expectedVideoVersion: d.summary.videoVersion };\n  busy(true);\n  call('apiAction', d.summary.reelId, action, Object.assign(base, input || {})).then(function (res) {\n    busy(false);\n    if (!res.ok) { toast(res.error, 8000); return; }\n    S.detail = res.detail; S.mode = 'view'; renderDetail();\n    toast(res.notice || '저장했습니다 (REELS·AUDIT 기록)', res.notice ? 8000 : 2500);\n    refreshAround();\n  });\n}\nfunction askNote(promptText, required) {\n  const v = prompt(promptText, '');\n  if (v === null) return null;\n  if (required && !v.trim()) { toast('메모(사유)를 입력해야 합니다.'); return null; }\n  return v.trim();\n}\n\nfunction renderDetail() {\n  const d = S.detail;\n  const main = clear(document.getElementById('main'));\n  renderNav();\n  document.getElementById('title').textContent = d.summary.reelId;\n  main.appendChild(h('button', { class: 'link', type: 'button', onclick: backToList, text: '‹ 목록' }));\n  warningsBanner(d.warnings).forEach(function (b) { main.appendChild(b); });\n\n  // Sibling versions (the 3 scripts generated for the same product).\n  const siblings = (S.dash ? S.dash.reels : []).filter(function (r) { return r.productId === d.product.id; });\n  if (siblings.length > 1) {\n    main.appendChild(h('div', { class: 'tabs2' }, siblings.map(function (r) {\n      return h('button', { type: 'button', class: r.reelId === d.summary.reelId ? 'on' : '', onclick: function () { openReel(r.reelId); }, text: r.reelId.replace(d.product.id + '-', '') + ' · ' + r.statusLabel });\n    })));\n  }\n\n  main.appendChild(h('div', { class: 'card' }, [\n    h('div', { class: 'row', style: 'justify-content:space-between' }, [h('strong', { text: d.product.name }), statusChip(d.summary.status, d.summary.statusLabel)]),\n    h('div', { class: 'muted', text: '대본 v' + d.summary.scriptVersion + (d.approvedVersion ? ' · 승인 v' + d.approvedVersion + (d.approvedIntact ? '' : ' (승인 후 변경됨!)') : '') + (d.summary.videoVersion ? ' · 영상 v' + d.summary.videoVersion : '') }),\n    d.summary.error ? h('div', { class: 'banner bad', style: 'margin:8px 0 0', text: d.summary.error }) : null,\n  ]));\n\n  if (S.mode === 'edit') { renderEditor(main); return; }\n\n  if (d.video && ['VIDEO_REVIEW_PENDING', 'VIDEO_APPROVED', 'READY_TO_PUBLISH', 'COMPLETED', 'VIDEO_CHANGES_REQUESTED', 'VIDEO_REJECTED'].indexOf(d.summary.status) !== -1) {\n    main.appendChild(h('div', { class: 'card' }, [\n      h('h3', { style: 'margin-top:0', text: '완성 영상 v' + d.summary.videoVersion }),\n      h('div', { class: 'video' }, [h('iframe', { src: d.video.previewUrl, allow: 'autoplay; fullscreen', title: '영상 미리보기' })]),\n      h('a', { href: d.video.url, target: '_blank', rel: 'noopener', text: 'Google Drive에서 열기 ↗' }),\n      h('div', { class: 'muted', text: '미리보기가 안 보이면 Drive에서 열어 재생하세요 (같은 Google 계정 로그인 필요).' }),\n    ]));\n  }\n\n  renderActions(main);\n\n  // Product facts (what the script may claim).\n  main.appendChild(h('div', { class: 'card' }, [\n    h('h3', { style: 'margin-top:0', text: '확인된 기능 (PRODUCTS)' }),\n    h('ul', { style: 'margin:0;padding-left:20px' }, d.product.facts.map(function (f) { return h('li', { text: f }); })),\n    h('div', { class: 'row', style: 'margin-top:8px' }, [\n      h('span', { class: 'chip ' + (d.product.permissionOk ? 'ok' : 'warn'), text: '영상 허가: ' + d.product.permission }),\n      h('span', { class: 'chip ' + (d.product.affiliateUrlOk ? 'ok' : 'warn'), text: d.product.affiliateUrlOk ? '제휴 링크 ✓' : '제휴 링크 필요' }),\n    ]),\n  ]));\n\n  // Full script.\n  const r = d.reel;\n  const scriptCard = h('div', { class: 'card' }, [\n    h('div', { class: 'muted', text: r.concept }),\n    h('div', { class: 'hook', text: r.hook }),\n    h('h3', { text: '내레이션' }), h('div', { class: 'pre', text: r.narration }),\n    h('h3', { text: '자막' }), h('div', { class: 'pre', text: (r.captions || []).join('\\n') }),\n    h('h3', { text: '사용한 확인 기능' }), h('div', { class: 'pre muted', text: (r.facts_used || []).join('\\n') }),\n    h('h3', { text: 'CTA · ManyChat 키워드' }), h('div', { class: 'pre', text: d.cta + '\\n키워드: ' + d.keyword }),\n    h('h3', { text: '광고 표기' }), h('div', { class: 'pre', text: d.disclosure }),\n  ]);\n  if (d.scenesInvalid) scriptCard.appendChild(h('div', { class: 'banner bad', text: '장면(JSON) 셀이 손상되었습니다. 수정 요청 후 재생성하세요.' }));\n  (r.scenes || []).forEach(function (s) {\n    scriptCard.appendChild(h('div', { class: 'scene' }, [\n      h('strong', { text: '장면 ' + s.scene_no + (s.beat ? ' · ' + s.beat : '') + ' · ' + s.duration_sec + '초' }),\n      s.narration ? h('div', { class: 'hook', text: '“' + s.narration + '”' }) : null,\n      h('div', { class: 'muted', text: '화면: ' + s.visual }),\n      s.on_screen_text ? h('div', { class: 'muted', text: '화면 문구: ' + s.on_screen_text }) : null,\n      d.approvedIntact\n        ? copyBlock('Google Flow 프롬프트 (수동 생성)', s.flow_prompt, true)\n        : h('div', {}, [h('div', { class: 'muted', text: 'Google Flow 프롬프트 — 대본 승인 후 복사·생성 (Flow 크레딧 보호)' }), h('div', { class: 'flow mono', text: s.flow_prompt })]),\n    ]));\n  });\n  main.appendChild(h('h2', { text: '대본' }));\n  main.appendChild(scriptCard);\n\n  // Touchpoints + history (audit).\n  main.appendChild(h('h2', { text: '운영자 확인 4단계' }));\n  main.appendChild(h('div', { class: 'card' }, d.touchpoints.map(function (t) {\n    return h('div', { class: 'tp' }, [\n      h('div', { class: 'dot' + (t.done ? ' done' : ''), text: t.done ? '✓' : String(t.n) }),\n      h('div', {}, [h('div', { text: t.label }), h('div', { class: 'muted', text: t.detail })]),\n    ]);\n  })));\n  main.appendChild(h('h2', { text: '기록 (AUDIT)' }));\n  main.appendChild(h('div', { class: 'card' }, d.history.length ? d.history.map(function (x) {\n    return h('div', { class: 'hist' }, [\n      h('div', {}, [h('strong', { text: x.label }), ' → ' + (x.to || ''), h('span', { class: 'muted', text: '  ' + fmt(x.at) })]),\n      h('div', { class: 'muted', text: [x.actor, x.scriptVersion ? '대본 v' + x.scriptVersion : '', x.videoVersion ? '영상 v' + x.videoVersion : ''].filter(Boolean).join(' · ') }),\n      x.note ? h('div', { class: 'pre', text: x.note }) : null,\n    ]);\n  }) : [h('div', { class: 'muted', text: '기록 없음' })]));\n}\n\nfunction renderActions(main) {\n  const d = S.detail;\n  const can = function (a) { return d.allowedActions.indexOf(a) !== -1; };\n  const card = h('div', { class: 'card' });\n  const st = d.summary.status;\n\n  if (st === 'SCRIPT_REVIEW_PENDING' || st === 'SCRIPT_CHANGES_REQUESTED') {\n    card.appendChild(h('h3', { style: 'margin-top:0', text: '② 대본 검토' }));\n    if (st === 'SCRIPT_CHANGES_REQUESTED') {\n      card.appendChild(h('div', { class: 'banner warn', text: '수정 요청: ' + (d.scriptReview.note || '') }));\n    }\n    const b = h('div', { class: 'btns' });\n    if (can('APPROVE_SCRIPT')) b.appendChild(h('button', { class: 'b ok', type: 'button', text: '승인 (v' + d.summary.scriptVersion + ')',\n      onclick: function () { act('APPROVE_SCRIPT', { note: '' }, '대본 v' + d.summary.scriptVersion + '을(를) 승인합니다. 이 버전 그대로 영상 제작에 사용됩니다.'); } }));\n    if (can('EDIT_SCRIPT')) b.appendChild(h('button', { class: 'b', type: 'button', text: '직접 수정', onclick: function () { S.mode = 'edit'; renderDetail(); } }));\n    if (can('REQUEST_SCRIPT_CHANGES')) b.appendChild(h('button', { class: 'b', type: 'button', text: '수정 요청',\n      onclick: function () { const n = askNote('무엇을 바꿀까요? (재생성 시 Gemini에 전달)', true); if (n !== null) act('REQUEST_SCRIPT_CHANGES', { note: n }); } }));\n    if (d.canRegenerate) b.appendChild(h('button', { class: 'b primary', type: 'button', text: 'Gemini 재생성', onclick: regenerate }));\n    if (can('REJECT_SCRIPT')) b.appendChild(h('button', { class: 'b bad', type: 'button', text: '반려',\n      onclick: function () { const n = askNote('반려 사유 (선택)', false); if (n !== null) act('REJECT_SCRIPT', { note: n }, '이 대본을 반려할까요? 되돌릴 수 없습니다.'); } }));\n    card.appendChild(b);\n  } else if (['SCRIPT_APPROVED', 'VIDEO_IN_PRODUCTION', 'VIDEO_FAILED', 'VIDEO_CHANGES_REQUESTED'].indexOf(st) !== -1) {\n    card.appendChild(h('h3', { style: 'margin-top:0', text: '영상 제작 (실제 제품 촬영·Flow → Mac 렌더)' }));\n    if (st === 'VIDEO_CHANGES_REQUESTED') card.appendChild(h('div', { class: 'banner warn', text: '영상 수정 요청: ' + (d.videoReview.note || '') }));\n    if (!d.product.permissionOk) card.appendChild(h('div', { class: 'banner warn', text: '영상 사용 허가가 확인되지 않아 제작을 시작할 수 없습니다. PRODUCTS의 \"영상 사용 허가 상태\"를 확인하세요.' }));\n    if (!d.approvedIntact && st !== 'VIDEO_IN_PRODUCTION') card.appendChild(h('div', { class: 'banner bad', text: '승인된 대본이 변경되었습니다. 승인 취소 후 다시 승인하세요.' }));\n    const b = h('div', { class: 'btns' });\n    if (can('START_VIDEO')) b.appendChild(h('button', { class: 'b primary', type: 'button', text: '영상 제작 시작', disabled: !d.product.permissionOk || !d.approvedIntact,\n      onclick: function () { act('START_VIDEO', {}); } }));\n    if (st === 'VIDEO_IN_PRODUCTION') b.appendChild(h('button', { class: 'b', type: 'button', text: '렌더 작업 파일 (Mac)', onclick: openRenderJob }));\n    if (can('REGISTER_VIDEO')) b.appendChild(h('button', { class: 'b ok', type: 'button', text: '완성 MP4 등록',\n      onclick: function () { const u = askNote('Google Drive MP4 공유 링크를 붙여넣으세요', true); if (u !== null) act('REGISTER_VIDEO', { videoUrl: u }); } }));\n    if (can('MARK_VIDEO_FAILED')) b.appendChild(h('button', { class: 'b bad', type: 'button', text: '제작 오류 기록',\n      onclick: function () { const n = askNote('오류 내용', true); if (n !== null) act('MARK_VIDEO_FAILED', { note: n }); } }));\n    if (can('REOPEN_SCRIPT')) b.appendChild(h('button', { class: 'b', type: 'button', text: '대본 승인 취소',\n      onclick: function () { const n = askNote('승인 취소 사유 (선택)', false); if (n !== null) act('REOPEN_SCRIPT', { note: n }); } }));\n    card.appendChild(b);\n    // Detailed scene prompts are generated automatically on approval (free). One 8-second clip per scene.\n    const fp = d.flowScenePrompts || [];\n    card.appendChild(h('h3', { text: 'Google Flow 장면 프롬프트 (' + fp.length + '개 · 장면당 8초 클립 1개)' }));\n    if (!fp.length) {\n      card.appendChild(h('div', { class: 'banner warn', text: '대본 승인 후 자동으로 만들어집니다.' }));\n    } else {\n      card.appendChild(h('div', { class: 'muted', text: '각 프롬프트로 Flow에서 클립을 하나씩 만든 뒤, Google Drive의 ReelsFactory/clips/' + d.summary.reelId + '/ 폴더에 S1.mp4, S2.mp4 … 이름으로 올리세요. Mac 렌더러가 자동으로 편집합니다.' }));\n      fp.forEach(function (p) {\n        card.appendChild(h('details', { style: 'margin-top:8px' }, [\n          h('summary', { text: 'S' + p.scene + ' · ' + p.beat + ' → 파일 이름 S' + p.scene + '.mp4' }),\n          copyBlock('S' + p.scene + ' 프롬프트', p.prompt, true),\n        ]));\n      });\n    }\n  } else if (st === 'VIDEO_REVIEW_PENDING') {\n    card.appendChild(h('h3', { style: 'margin-top:0', text: '③ 영상 검토 (v' + d.summary.videoVersion + ')' }));\n    card.appendChild(h('div', { class: 'btns' }, [\n      h('button', { class: 'b ok', type: 'button', text: '영상 승인',\n        onclick: function () { act('APPROVE_VIDEO', { note: '' }, '영상 v' + d.summary.videoVersion + '을(를) 승인할까요? 자동 게시는 되지 않습니다.'); } }),\n      h('button', { class: 'b', type: 'button', text: '수정 요청',\n        onclick: function () { const n = askNote('무엇을 고칠까요?', true); if (n !== null) act('REQUEST_VIDEO_CHANGES', { note: n }); } }),\n      h('button', { class: 'b bad', type: 'button', text: '반려',\n        onclick: function () { const n = askNote('반려 사유 (선택)', false); if (n !== null) act('REJECT_VIDEO', { note: n }, '이 릴스를 반려할까요?'); } }),\n    ]));\n  } else if (st === 'VIDEO_APPROVED') {\n    card.appendChild(h('h3', { style: 'margin-top:0', text: '게시 준비' }));\n    card.appendChild(h('div', { class: 'muted', text: '위 오류를 PRODUCTS에서 해결한 뒤 다시 시도하세요 (예: 쿠팡 파트너스 링크 입력).' }));\n    card.appendChild(h('div', { class: 'btns one' }, [h('button', { class: 'b primary', type: 'button', text: '게시 준비 다시 시도', onclick: function () { act('MARK_READY_TO_PUBLISH', {}); } })]));\n  } else if (st === 'READY_TO_PUBLISH' || st === 'COMPLETED') {\n    card.appendChild(h('h3', { style: 'margin-top:0', text: '④ 게시 · ManyChat (수동)' }));\n    card.appendChild(h('div', { class: 'btns one' }, [h('button', { class: 'b primary', type: 'button', text: '게시 자료 열기', onclick: openPack })]));\n    const b = h('div', { class: 'btns' });\n    if (can('CONFIRM_PUBLISHED')) b.appendChild(h('button', { class: 'b ok', type: 'button', text: '인스타그램 게시 완료',\n      onclick: function () { const u = askNote('게시물 URL (선택, https://www.instagram.com/…)', false); if (u !== null) act('CONFIRM_PUBLISHED', { instagramUrl: u }); } }));\n    if (can('CONFIRM_MANYCHAT')) b.appendChild(h('button', { class: 'b ok', type: 'button', text: 'ManyChat 설정 완료',\n      onclick: function () { act('CONFIRM_MANYCHAT', {}, '키워드 \"' + d.keyword + '\" 자동화를 직접 켜고, 테스트 댓글로 올바른 링크가 오는 것을 확인했나요?'); } }));\n    card.appendChild(b);\n    if (st === 'COMPLETED') card.appendChild(h('div', { class: 'banner ok', text: '게시와 ManyChat 설정이 확인되었습니다.' }));\n  } else {\n    return;\n  }\n  main.appendChild(card);\n}\n\nfunction regenerate() {\n  const d = S.detail;\n  if (!confirm('수정 요청 메모를 반영해 이 대본 1개를 Gemini로 다시 작성할까요? (API 호출 1~2회)')) return;\n  busy(true, 'Gemini로 재생성 중… (최대 1분)');\n  call('apiRegenerateScript', d.summary.reelId, { expectedScriptVersion: d.summary.scriptVersion }).then(function (res) {\n    busy(false);\n    if (!res.ok) { toast(res.error, 8000); return; }\n    S.detail = res.detail; renderDetail(); toast('새 버전 v' + res.detail.summary.scriptVersion + '이(가) 검토 대기 중입니다.');\n    refreshAround();\n  });\n}\n\n// Signed render job for the Mac/cloud renderer. Issued only for approved reels in production.\nfunction openRenderJob() {\n  busy(true);\n  call('apiGetRenderJob', S.detail.summary.reelId).then(function (res) {\n    busy(false);\n    if (!res.ok) { toast(res.error, 8000); return; }\n    const main = clear(document.getElementById('main'));\n    main.appendChild(h('button', { class: 'link', type: 'button', onclick: renderDetail, text: '‹ ' + S.detail.summary.reelId }));\n    main.appendChild(h('div', { class: 'banner warn', text: '이 파일은 72시간 동안 유효합니다. Mac에서 renderer/jobs/' + res.fileName + ' 로 저장한 뒤:\\n\\nnpm run render -- --job renderer/jobs/' + res.fileName + ' --dry-run\\n(비용·계획 확인 후) --dry-run 없이 다시 실행' }));\n    const a = h('a', { href: 'data:application/json;charset=utf-8,' + encodeURIComponent(res.jobFile), download: res.fileName, text: '파일 다운로드 ↓' });\n    main.appendChild(h('div', { class: 'card' }, [a, copyBlock(res.fileName, res.jobFile, true)]));\n    window.scrollTo(0, 0);\n  });\n}\n\nfunction openPack() {\n  busy(true);\n  call('apiGetPublishingPack', S.detail.summary.reelId).then(function (res) {\n    busy(false);\n    if (!res.ok) { toast(res.error, 6000); return; }\n    const p = res.pack;\n    const main = clear(document.getElementById('main'));\n    main.appendChild(h('button', { class: 'link', type: 'button', onclick: renderDetail, text: '‹ ' + p.reelId }));\n    main.appendChild(h('div', { class: 'banner warn', text: '자동 게시·자동 DM은 하지 않습니다. 아래 순서대로 직접 진행하세요.' }));\n    main.appendChild(h('div', { class: 'card' }, [\n      h('h3', { style: 'margin-top:0', text: '1. 영상' }),\n      h('a', { href: p.videoUrl, target: '_blank', rel: 'noopener', text: 'Drive에서 MP4 열기 ↗' }),\n      h('div', { class: 'muted', text: 'Drive 앱 → ⋯ → 사본 보내기 → 동영상 저장' }),\n    ]));\n    main.appendChild(h('div', { class: 'card' }, [h('h3', { style: 'margin-top:0', text: '2. 인스타그램 캡션' }), copyBlock('첫 줄 광고 표기 유지', p.instagramCaption)]));\n    main.appendChild(h('div', { class: 'card' }, [\n      h('h3', { style: 'margin-top:0', text: '3. ManyChat' }),\n      copyBlock('댓글 키워드', p.manychatKeyword, true),\n      copyBlock('DM 문구 (쿠팡 파트너스 링크 포함)', p.manychatDm),\n      copyBlock('쿠팡 파트너스 링크', p.affiliateUrl, true),\n    ]));\n    main.appendChild(h('div', { class: 'card' }, [h('h3', { style: 'margin-top:0', text: '체크리스트' }),\n      h('ol', { style: 'margin:0;padding-left:20px' }, p.checklist.map(function (c) { return h('li', { text: c }); }))]));\n    window.scrollTo(0, 0);\n  });\n}\n\n// ---------------------------------------------------------------- editor\nfunction renderEditor(main) {\n  const d = S.detail;\n  const r = d.reel;\n  // Storyboard scripts: each scene's line is the narration and the subtitle.\n  const storyboard = (r.scenes || []).some(function (s) { return s.beat || s.narration; });\n  const f = {};\n  function field(key, label, value, multiline) {\n    f[key] = multiline ? h('textarea', {}) : h('input', { type: 'text' });\n    f[key].value = value || '';\n    return h('div', {}, [h('label', { text: label }), f[key]]);\n  }\n  const card = h('div', { class: 'card' }, [\n    h('div', { class: 'banner warn', text: '수정하면 새 버전(v' + (d.summary.scriptVersion + 1) + ')이 되고 다시 승인해야 합니다. 숫자·기능은 PRODUCTS의 확인된 기능에 있는 것만 쓸 수 있습니다.' }),\n    field('concept', '컨셉', r.concept),\n    field('hook', '후킹 (40자 이내)', r.hook),\n    storyboard ? null : field('narration', '내레이션 (300자 이내)', r.narration, true),\n    storyboard ? null : field('captions', '자막 (한 줄에 하나, 각 40자 이내)', (r.captions || []).join('\\n'), true),\n  ]);\n  (r.scenes || []).forEach(function (s, i) {\n    card.appendChild(h('h3', { text: '장면 ' + s.scene_no + (s.beat ? ' · ' + s.beat : '') + ' · ' + s.duration_sec + '초' }));\n    if (storyboard) card.appendChild(field('s' + i + 'line', '내레이션 = 자막 (30자 이내, CTA에는 {키워드})', s.narration));\n    card.appendChild(field('s' + i + 'visual', '장면 설명', s.visual, true));\n    if (!storyboard) card.appendChild(field('s' + i + 'text', '화면 문구', s.on_screen_text));\n    card.appendChild(field('s' + i + 'flow', 'Flow 프롬프트 (영어)', s.flow_prompt, true));\n  });\n  card.appendChild(field('note', '수정 메모 (선택)', '', true));\n  card.appendChild(h('div', { class: 'btns' }, [\n    h('button', { class: 'b', type: 'button', text: '취소', onclick: function () { S.mode = 'view'; renderDetail(); } }),\n    h('button', { class: 'b primary', type: 'button', text: '저장 (v' + (d.summary.scriptVersion + 1) + ')', onclick: function () {\n      const edit = {\n        concept: f.concept.value, hook: f.hook.value,\n        narration: storyboard ? undefined : f.narration.value,\n        captions: storyboard ? undefined : f.captions.value.split('\\n').map(function (x) { return x.trim(); }).filter(Boolean),\n        scenes: (r.scenes || []).map(function (s, i) {\n          const out = { visual: f['s' + i + 'visual'].value, flow_prompt: f['s' + i + 'flow'].value };\n          if (storyboard) out.narration = f['s' + i + 'line'].value; else out.on_screen_text = f['s' + i + 'text'].value;\n          return out;\n        }),\n      };\n      act('EDIT_SCRIPT', { edit: edit, note: f.note.value });\n    } }),\n  ]));\n  main.appendChild(card);\n}\n\nloadDashboard();\n</script>\n</body>\n</html>\n";
