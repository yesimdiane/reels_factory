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
  ],

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

  REEL_STATUS_SCRIPT_REVIEW: '대본 검토 대기',
  FLOW_STATUS_MANUAL: '수동 생성 필요 (Google Flow는 Gemini API로 호출되지 않음)',
  PERMISSION_UNVERIFIED_NOTE:
    '영상 사용 허가 미확인 — 쿠팡/판매처 미디어를 AI 편집·광고에 사용하기 전 허가를 확인하세요.',
  // Values in PRODUCTS.영상 사용 허가 상태 that count as verified permission.
  PERMISSION_APPROVED_VALUES: ['허가', '허가됨', '승인', '승인됨', '확인 완료', '허가 완료'],

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
    if (s) texts.push(s.on_screen_text);
  });
  return texts.filter(function (t) {
    return typeof t === 'string';
  });
}

/**
 * Validates the parsed Gemini payload against the schema and the product's confirmed facts.
 * Returns { errors: string[], reels: object[] }.
 */
function validateGeminiReels(payload, product) {
  const errors = [];
  const L = RF_CONFIG.LIMITS;
  const facts = parseConfirmedFeatures(product.features);
  const factSet = {};
  facts.forEach(function (f) {
    factSet[f] = true;
  });
  const allowedNumbers = {};
  extractNumbers(facts.join(' ') + ' ' + product.name).forEach(function (n) {
    allowedNumbers[n] = true;
  });

  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.reels)) {
    return { errors: ['응답에 "reels" 배열이 없습니다.'], reels: [] };
  }
  const reels = payload.reels;
  if (reels.length !== RF_CONFIG.REELS_PER_PRODUCT) {
    errors.push(
      '릴스 대본은 정확히 ' + RF_CONFIG.REELS_PER_PRODUCT + '개여야 합니다 (받은 개수: ' + reels.length + ').'
    );
  }

  reels.forEach(function (reel, i) {
    const p = '릴스 ' + (i + 1) + ': ';
    if (!reel || typeof reel !== 'object') {
      errors.push(p + '객체가 아닙니다.');
      return;
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
      });
      if (total < L.MIN_TOTAL_SEC || total > L.MAX_TOTAL_SEC) {
        errors.push(p + '총 길이는 ' + L.MIN_TOTAL_SEC + '~' + L.MAX_TOTAL_SEC + '초여야 합니다 (현재 ' + total + '초).');
      }
    }

    if (!Array.isArray(reel.facts_used) || reel.facts_used.length === 0) {
      errors.push(p + '"facts_used"가 비어 있습니다. 확인된 기능 중 최소 1개를 사용해야 합니다.');
    } else {
      reel.facts_used.forEach(function (fact) {
        if (!factSet[normalizeText(fact)]) {
          errors.push(p + '확인되지 않은 기능을 사용했습니다: "' + fact + '". "확인된 기능" 문구를 그대로 사용해야 합니다.');
        }
      });
    }

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
  const unique = errors.filter(function (e, idx) {
    return errors.indexOf(e) === idx;
  });
  return { errors: unique, reels: unique.length ? [] : reels };
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

/**
 * Builds REELS row objects keyed by REELS header names.
 * Throws if an ID or keyword would collide with existing data.
 */
function buildReelRecords(product, reels, existingIds, existingKeywords, meta) {
  const ids = nextReelIds(product.id, existingIds, reels.length);
  const keywordTaken = {};
  existingKeywords.forEach(function (k) {
    keywordTaken[normalizeText(k).toUpperCase()] = true;
  });
  const approved = isPermissionApproved(product.permission);

  return reels.map(function (reel, i) {
    const reelId = ids[i];
    const keyword = buildManyChatKeyword(reelId);
    if (keywordTaken[keyword.toUpperCase()]) {
      throw new Error('ManyChat 키워드 "' + keyword + '"가 이미 REELS에 존재합니다. 중복 키워드를 정리한 뒤 다시 실행하세요.');
    }
    keywordTaken[keyword.toUpperCase()] = true;

    const flowPrompts = reel.scenes
      .map(function (s) {
        return 'S' + s.scene_no + ' (' + s.duration_sec + 's): ' + normalizeText(s.flow_prompt);
      })
      .join('\n');

    const notes = [];
    if (!approved) notes.push(RF_CONFIG.PERMISSION_UNVERIFIED_NOTE);
    notes.push('게시·DM 자동화 전 사람 검토 필요.');

    return {
      '릴스ID': reelId,
      '상품ID': product.id,
      '버전': i + 1,
      '컨셉': normalizeText(reel.concept),
      '후킹': normalizeText(reel.hook),
      '내레이션': normalizeText(reel.narration),
      '자막': reel.captions.map(normalizeText).join('\n'),
      '장면(JSON)': JSON.stringify(reel.scenes),
      'Flow 프롬프트': flowPrompts,
      'Flow 생성': RF_CONFIG.FLOW_STATUS_MANUAL,
      'CTA': buildCta(keyword),
      'ManyChat 키워드': keyword,
      '광고 표기': RF_CONFIG.AFFILIATE_DISCLOSURE,
      '사용한 확인 기능': reel.facts_used.map(normalizeText).join('\n'),
      '영상 사용 허가 상태': normalizeText(product.permission) || '미확인',
      '제작 상태': RF_CONFIG.REEL_STATUS_SCRIPT_REVIEW,
      '검토 메모': notes.join(' '),
      '생성 모델': meta.model,
      '생성일시': meta.generatedAt,
    };
  });
}

/**
 * Full pure pipeline: raw Gemini text → validated → REELS row objects.
 * Returns { errors: string[], records: object[] }.
 */
function prepareReelRecords(product, rawText, existingIds, existingKeywords, meta) {
  const parsed = parseModelJson(rawText);
  if (parsed.error) return { errors: [parsed.error], records: [] };
  const result = validateGeminiReels(parsed.value, product);
  if (result.errors.length) return { errors: result.errors, records: [] };
  return {
    errors: [],
    records: buildReelRecords(product, result.reels, existingIds, existingKeywords, meta),
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
                duration_sec: { type: 'NUMBER' },
                visual: { type: 'STRING' },
                on_screen_text: { type: 'STRING' },
                flow_prompt: { type: 'STRING' },
              },
              required: ['scene_no', 'duration_sec', 'visual', 'on_screen_text', 'flow_prompt'],
              propertyOrdering: ['scene_no', 'duration_sec', 'visual', 'on_screen_text', 'flow_prompt'],
            },
          },
          facts_used: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['concept', 'hook', 'narration', 'captions', 'scenes', 'facts_used'],
        propertyOrdering: ['concept', 'hook', 'narration', 'captions', 'scenes', 'facts_used'],
      },
    },
  },
  required: ['reels'],
};

/**
 * Builds the Gemini prompt for one product.
 * `previousErrors` (optional) feeds validation failures back for a corrective retry.
 */
function buildGeminiPrompt(product, previousErrors) {
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
    '## 확인된 기능 (이 목록만 사실로 사용)',
  ];
  facts.forEach(function (f) {
    lines.push('- ' + f);
  });
  lines.push(
    '',
    '## 규칙',
    '1. 위 "확인된 기능"에 없는 기능, 소재, 내구성, 가격, 할인, 순위, 후기, 수치를 절대 만들지 마세요.',
    '2. 화면 문구·내레이션·자막에 들어가는 숫자는 확인된 기능에 적힌 숫자만 사용하세요.',
    '3. facts_used에는 실제로 사용한 확인된 기능을 위 목록 문구 그대로(한 글자도 바꾸지 말고) 넣으세요.',
    '4. 과장 표현(최저가, 100%, 무조건, 완벽, 평생, 1위, 품절 임박 등)을 쓰지 마세요.',
    '5. URL, 가격, 광고 표기, CTA, 댓글 키워드는 쓰지 마세요. 시스템이 별도로 추가합니다.',
    '6. hook은 ' + L.HOOK_MAX_CHARS + '자 이내, narration은 ' + L.NARRATION_MAX_CHARS + '자 이내의 자연스러운 한국어 구어체.',
    '7. captions는 화면 자막 줄 목록이며 각 ' + L.CAPTION_MAX_CHARS + '자 이내.',
    '8. scenes는 ' + L.MIN_SCENES + '~' + L.MAX_SCENES + '개, scene_no는 1부터 순서대로, duration_sec 합계는 ' + L.MIN_TOTAL_SEC + '~' + L.MAX_TOTAL_SEC + '초.',
    '9. 세 릴스는 concept과 hook이 서로 달라야 합니다 (예: 문제 해결, 설치 과정, 공간 비포/애프터).',
    '10. 시연은 실제로 가능한 사용 장면만 묘사하세요.',
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
    lines.push('', '## 이전 응답의 검증 오류 (반드시 수정)');
    previousErrors.slice(0, 20).forEach(function (e) {
      lines.push('- ' + e);
    });
  }
  return lines.join('\n');
}

// ===== Gemini.gs =====
/**
 * Gemini API client (generateContent with JSON structured output).
 * API key is read from Script Properties: GEMINI_API_KEY. Optional: GEMINI_MODEL.
 */

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

/**
 * Calls Gemini once and returns the raw JSON text from the first candidate.
 * Throws an actionable Error on HTTP / safety / truncation problems.
 */
function callGemini(promptText) {
  const model = getGeminiModel();
  const url = RF_CONFIG.GEMINI_API_BASE + encodeURIComponent(model) + ':generateContent';
  const body = {
    contents: [{ role: 'user', parts: [{ text: promptText }] }],
    // Temperature left at the model default: Gemini 3.x models are tuned for 1.0.
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RF_GEMINI_RESPONSE_SCHEMA,
    },
  };
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

  const text = response.getContentText();
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
      hint = ' (모델 "' + model + '"을 사용할 수 없습니다 — 종료된 모델일 수 있습니다. ' +
        'Google AI Studio에서 현재 모델 ID를 확인해 스크립트 속성 GEMINI_MODEL에 입력하세요)';
    }
    if (code === 429) hint = ' (요청 한도 초과 — 잠시 후 다시 시도하세요)';
    throw new Error('Gemini API 오류 HTTP ' + code + hint + ': ' + String(detail).slice(0, 500));
  }

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
function appendRecords_(sheet, records) {
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
  sheet.getRange(startRow, 1, rows.length, width).setValues(rows);
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
    .addItem('시트 준비 (REELS / PERFORMANCE / LOG)', 'setupSheets')
    .addItem('Gemini API 키 설정', 'promptForGeminiApiKey')
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
  for (let attempt = 1; attempt <= RF_CONFIG.MAX_GEMINI_ATTEMPTS; attempt++) {
    const raw = callGemini(buildGeminiPrompt(product, lastErrors));
    const result = prepareReelRecords(product, raw, existingIds, existingKeywords, {
      model: getGeminiModel(),
      generatedAt: new Date(),
    });
    if (!result.errors.length) return { records: result.records, attempts: attempt };
    lastErrors = result.errors;
    logEvent_(
      attempt < RF_CONFIG.MAX_GEMINI_ATTEMPTS ? 'WARN' : 'ERROR',
      'validateGemini',
      product.id,
      '검증 실패 (시도 ' + attempt + '/' + RF_CONFIG.MAX_GEMINI_ATTEMPTS + '): ' + result.errors.length + '건',
      result.errors.join('\n') + '\n\n--- 원본 응답 ---\n' + raw
    );
  }
  throw new Error(
    'Gemini 응답이 ' + RF_CONFIG.MAX_GEMINI_ATTEMPTS + '회 모두 검증에 실패했습니다. REELS에는 아무것도 기록하지 않았습니다.\n' +
      '자세한 내용은 LOG 시트를 확인하세요.\n\n- ' + lastErrors.slice(0, 8).join('\n- ')
  );
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

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    ui.alert('다른 생성 작업이 진행 중입니다. 잠시 후 다시 시도하세요.');
    return;
  }

  let productId = '';
  try {
    const productsSheet = getProductsSheet_(ss);
    const product = readProduct_(productsSheet, range.getRow());
    productId = product.id;

    const productErrors = validateProduct(product);
    if (productErrors.length) {
      throw new Error('PRODUCTS ' + product.rowNumber + '행을 수정하세요:\n- ' + productErrors.join('\n- '));
    }

    const productsMap = getHeaderMap_(productsSheet);
    const dupProducts = findDuplicates(readColumn_(productsSheet, productsMap, RF_CONFIG.PRODUCT_FIELDS.id));
    if (dupProducts.indexOf(product.id) !== -1) {
      throw new Error('PRODUCTS에 상품ID "' + product.id + '"가 여러 번 있습니다. 중복을 정리한 뒤 다시 실행하세요.');
    }

    const reelsSheet = ensureSheet_(ss, RF_CONFIG.SHEETS.REELS, RF_CONFIG.REELS_HEADERS);
    const reelsMap = getHeaderMap_(reelsSheet);
    const existingIds = readColumn_(reelsSheet, reelsMap, '릴스ID');
    const existingKeywords = readColumn_(reelsSheet, reelsMap, 'ManyChat 키워드');
    const dupIds = findDuplicates(existingIds);
    if (dupIds.length) {
      throw new Error('REELS에 중복된 릴스ID가 있습니다: ' + dupIds.join(', ') + '. 정리한 뒤 다시 실행하세요.');
    }
    const dupKeywords = findDuplicates(existingKeywords);
    if (dupKeywords.length) {
      throw new Error('REELS에 중복된 ManyChat 키워드가 있습니다: ' + dupKeywords.join(', ') + '. 정리한 뒤 다시 실행하세요.');
    }

    const already = existingIds.filter(function (id) {
      return id.indexOf(product.id + '-R') === 0;
    }).length;
    if (already > 0) {
      const ok = ui.alert(
        '추가 생성 확인',
        product.id + '에 이미 릴스 ' + already + '개가 있습니다. 새 대본 3개를 추가로 생성할까요?',
        ui.ButtonSet.YES_NO
      );
      if (ok !== ui.Button.YES) return;
    }

    ss.toast('Gemini로 ' + product.id + ' 대본 생성 중…', '릴스 팩토리', 60);
    const result = generateValidatedRecords_(product, existingIds, existingKeywords);
    appendRecords_(reelsSheet, result.records);

    const ids = result.records.map(function (r) {
      return r['릴스ID'];
    });
    logEvent_('INFO', 'generateReels', product.id, '릴스 대본 생성 완료: ' + ids.join(', '), '시도 횟수: ' + result.attempts);

    let msg = 'REELS에 ' + ids.length + '개 행을 추가했습니다:\n' + ids.join('\n') +
      '\n\n다음 단계: 대본 검토 → Flow 프롬프트로 Google Flow에서 수동 생성 → MP4를 Drive에 업로드.';
    if (!isPermissionApproved(product.permission)) msg += '\n\n⚠ ' + RF_CONFIG.PERMISSION_UNVERIFIED_NOTE;
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
