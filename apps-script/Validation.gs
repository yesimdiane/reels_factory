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

/** Facts and numbers a script may rely on, derived from PRODUCTS.확인된 기능 and 상품명. */
function factContext_(product) {
  const facts = parseConfirmedFeatures(product.features);
  const factSet = {};
  facts.forEach(function (f) {
    factSet[f] = true;
  });
  const allowedNumbers = {};
  extractNumbers(facts.join(' ') + ' ' + product.name).forEach(function (n) {
    allowedNumbers[n] = true;
  });
  return { facts: facts, factSet: factSet, allowedNumbers: allowedNumbers };
}

/**
 * Validates one reel script (generated, regenerated or edited by a human) against the schema
 * and the product's confirmed facts. `label` prefixes each error, e.g. "릴스 2".
 */
function validateReelContent(reel, product, label) {
  const errors = [];
  const L = RF_CONFIG.LIMITS;
  const ctx = factContext_(product);
  const factSet = ctx.factSet;
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
    return { errors: ['응답에 "reels" 배열이 없습니다.'], reels: [] };
  }
  const reels = payload.reels;
  if (reels.length !== count) {
    errors.push('릴스 대본은 정확히 ' + count + '개여야 합니다 (받은 개수: ' + reels.length + ').');
  }
  reels.forEach(function (reel, i) {
    validateReelContent(reel, product, '릴스 ' + (i + 1)).forEach(function (e) {
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
