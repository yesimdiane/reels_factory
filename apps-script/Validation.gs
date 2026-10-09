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
function unsupportedClaims_(text, ctx, where, generated) {
  const errors = [];
  const t = normalizeText(text);
  if (!t) return errors;
  const hint = ' — "' + t + '". 확인된 기능(' + factId(0) + '~' + factId(Math.max(0, ctx.facts.length - 1)) + ')에 없는 내용이니 빼거나 확인된 기능만으로 다시 쓰세요.';
  RF_CONFIG.CLAIM_RULES.forEach(function (rule) {
    if (rule.generatedOnly && !generated) return; // a reviewer's real experience → verification flag instead
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
    if (storyboard) storyboardErrors_(reel.scenes, options && options.newStructure).forEach(function (e) {
      errors.push(p + e);
    });
    const minTotal = options && options.generated ? L.GENERATED_MIN_TOTAL_SEC : L.MIN_TOTAL_SEC;
    if (total < minTotal || total > L.MAX_TOTAL_SEC) {
      errors.push(p + '총 길이는 ' + minTotal + '~' + L.MAX_TOTAL_SEC + '초여야 합니다 (현재 ' + total + '초). 내용에 맞게 조절하되 억지로 늘리지 마세요.');
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
    unsupportedClaims_(x.text, ctx, where, options && options.generated).concat(measurementErrors_(x.text, ctx, where)).forEach(function (e) {
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
 * Validates the parsed Gemini payload: exactly `expectedCount` reels, each passing validateReelContent,
 * with distinct concepts and hooks, plus (unless options.requireHooks === false) the five hooks H1–H5,
 * the recommended hook the script is built on, and the comment keyword.
 * options.fixedHook: the operator's selected hook — the script must start with exactly this text
 * (hook-style rules are not re-applied to the operator's own wording).
 * Returns { errors, reels, reelErrors, hookSet, commentKeyword }.
 */
function validateGeminiReels(payload, product, expectedCount, options) {
  const count = expectedCount || RF_CONFIG.REELS_PER_PRODUCT;
  const avoidHooks = (options && options.avoidHooks) || [];
  const errors = [];
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.reels)) {
    return { errors: ['응답에 "reels" 배열이 없습니다.'], reels: [], reelErrors: [] };
  }
  const reels = payload.reels;
  const requireHooks = !options || options.requireHooks !== false;
  const fixedHook = options && options.fixedHook ? normalizeText(options.fixedHook) : '';
  let hookSet = null;
  if (requireHooks) {
    const hs = validateHookSet(payload, product, avoidHooks);
    hs.errors.forEach(function (e) {
      errors.push(e);
    });
    hookSet = hs.errors.length ? null : hs.hookSet;
  }
  const keywordError = commentKeywordError(payload.comment_keyword);
  if (keywordError) errors.push(keywordError);
  if (reels.length !== count) {
    errors.push('릴스 대본은 정확히 ' + count + '개여야 합니다 (받은 개수: ' + reels.length + ').');
  }
  const reelErrors = reels.map(function (reel, i) {
    const label = '릴스 ' + (i + 1);
    const opts = { requireStoryboard: true, requireFactRefs: true, newStructure: true, generated: true };
    let errs = validateReelContent(reel, product, label, opts);
    if (!fixedHook) errs = errs.concat(hookStyleErrors_(reel, product, label, avoidHooks));
    errs = errs.concat(hookLinkErrors_(reel, label, fixedHook, requireHooks ? payload : null));
    if (reel && !RF_CONFIG.BRAND.PILLARS[reel.pillar]) {
      errs.push(label + ': pillar는 ' + Object.keys(RF_CONFIG.BRAND.PILLARS).join(', ') + ' 중 하나여야 합니다.');
    }
    if (count > 1 && reel && !RF_CONFIG.ANGLES[reel.angle]) {
      errs.push(label + ': angle은 ' + Object.keys(RF_CONFIG.ANGLES).join(', ') + ' 중 하나여야 합니다.');
    }
    return dedupe_(errs);
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
  // Three different angles and three different openings.
  if (count > 1) {
    const seenAngles = {};
    const seenOpenings = {};
    reels.forEach(function (reel, i) {
      if (!reel) return;
      if (RF_CONFIG.ANGLES[reel.angle] && seenAngles[reel.angle]) {
        errors.push('릴스 ' + (i + 1) + ': angle ' + reel.angle + '이 릴스 ' + seenAngles[reel.angle] + '와 같습니다. 세 릴스는 A·B·C 각도를 하나씩 써야 합니다.');
      }
      if (reel.angle) seenAngles[reel.angle] = i + 1;
      const o = hookOpening_(reel.hook);
      if (o && seenOpenings[o]) {
        errors.push('릴스 ' + (i + 1) + ': hook이 릴스 ' + seenOpenings[o] + '와 같은 말("' + o + '")로 시작합니다. 서로 다른 첫마디로 쓰세요.');
      }
      if (o) seenOpenings[o] = i + 1;
    });
  }

  // De-duplicate identical messages (e.g. the same number repeated).
  const unique = dedupe_(errors);
  // The script's own first scene is the recommended hook's opening (so "keep" changes nothing).
  if (!unique.length && hookSet && reels[0] && reels[0].scenes && reels[0].scenes[0]) {
    const first = reels[0].scenes[0];
    hookSet.hooks.forEach(function (h) {
      if (h.id !== hookSet.recommended.id || h.text !== normalizeText(reels[0].hook)) return;
      h.visual = normalizeText(first.visual);
      h.flow_prompt = normalizeText(first.flow_prompt);
      h.emphasis = normalizeText(first.emphasis);
      h.sfx = normalizeText(first.sfx);
    });
  }
  return {
    errors: unique,
    reels: unique.length ? [] : reels.map(function (r) {
      return canonicalReel_(r, product);
    }),
    reelErrors: reelErrors,
    hookSet: unique.length ? null : hookSet,
    commentKeyword: normalizeText(payload.comment_keyword),
  };
}

/** The script's hook is its first spoken line; it must be the recommended (or operator-selected) hook. */
function hookLinkErrors_(reel, label, fixedHook, payload) {
  const errors = [];
  if (!reel || !Array.isArray(reel.scenes) || !reel.scenes[0]) return errors;
  const hook = normalizeText(reel.hook);
  if (normalizeText(reel.scenes[0].narration) !== hook) {
    errors.push(label + ': 첫 장면 narration은 hook과 똑같아야 합니다 ("' + hook + '").');
  }
  if (fixedHook && hook !== fixedHook) {
    errors.push(label + ': 운영자가 선택한 훅 "' + fixedHook + '"으로 정확히 시작해야 합니다 (hook과 첫 장면 narration).');
  }
  if (!fixedHook && payload && Array.isArray(payload.hooks) && payload.recommended_hook) {
    const rec = payload.hooks.filter(function (h) {
      return h && h.id === payload.recommended_hook.id;
    })[0];
    if (rec && normalizeText(rec.text) !== hook) {
      errors.push(label + ': 대본은 추천 훅 ' + rec.id + ' "' + normalizeText(rec.text) + '"으로 시작해야 합니다.');
    }
  }
  return errors;
}

/**
 * Facts check for a hook the operator selected or edited: no invented claims, numbers or
 * measurements (the hook-style rules are the operator's call).
 */
function hookTextErrors(text, product) {
  const ctx = factContext_(product);
  const t = normalizeText(text);
  const errors = unsupportedClaims_(t, ctx, '', false).concat(measurementErrors_(t, ctx, ''));
  extractNumbers(t).forEach(function (n) {
    if (!ctx.allowedNumbers[n]) errors.push('확인된 기능에 없는 수치가 포함되어 있습니다: "' + n + '".');
  });
  RF_CONFIG.BANNED_PHRASES.forEach(function (phrase) {
    if (t.indexOf(phrase) !== -1) errors.push('과장/검증 불가 표현이 포함되어 있습니다: "' + phrase + '".');
  });
  return dedupe_(errors);
}

/** Parses REELS "훅 후보(JSON)" → { hooks: [{id,type,label,text}], recommended: {id,reason}|null }. */
function parseHookSet(cell) {
  try {
    const v = JSON.parse(String(cell == null ? '' : cell) || 'null');
    if (v && Array.isArray(v.hooks)) {
      return {
        hooks: v.hooks.filter(function (h) { return h && RF_CONFIG.HOOK_TYPES[h.id] && normalizeText(h.text); }).map(function (h) {
          return {
            id: h.id, type: RF_CONFIG.HOOK_TYPES[h.id].type, label: RF_CONFIG.HOOK_TYPES[h.id].label, text: normalizeText(h.text),
            visual: normalizeText(h.visual), flow_prompt: normalizeText(h.flow_prompt),
            emphasis: normalizeText(h.emphasis), sfx: normalizeText(h.sfx),
          };
        }),
        recommended: v.recommended && v.recommended.id ? { id: v.recommended.id, reason: normalizeText(v.recommended.reason) } : null,
      };
    }
  } catch (e) {
    // fall through
  }
  return { hooks: [], recommended: null };
}

/** Parses REELS "선택한 훅" → { id, text, edited, scriptVersion, by, at } or null. */
function parseSelectedHook(cell) {
  try {
    const v = JSON.parse(String(cell == null ? '' : cell) || 'null');
    return v && normalizeText(v.text) ? v : null;
  } catch (e) {
    return null;
  }
}

/** A simple customer-facing comment keyword (e.g. 우산), never an internal ID. '' = OK or absent. */
function commentKeywordError(keyword) {
  const k = normalizeText(keyword);
  if (!k) return '';
  if (!/^[가-힣A-Za-z]{1,10}$/.test(k) || /^PRD/i.test(k)) {
    return 'comment_keyword "' + k + '"는 공백·숫자·기호 없는 10자 이내 한 단어여야 합니다 (예: 우산). 내부 ID는 쓰지 마세요.';
  }
  return '';
}

const RF_KOREAN_NUMBERS_ = { 한: 1, 하나: 1, 두: 2, 둘: 2, 세: 3, 셋: 3, 네: 4, 넷: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10 };
const RF_COUNTERS_ = '개|가지|조각|칸|단|번|명|분|층|배|쌍|피스|군데|곳|초|일|달|주';

/** Numbers in a hook: digits (with an optional counter) and Korean numerals followed by a counter. */
function hookNumbers_(text) {
  const t = normalizeText(text);
  const out = [];
  const digitRe = new RegExp('(\\d+(?:\\.\\d+)?)\\s*(%|' + RF_COUNTERS_ + ')?', 'g');
  let m;
  while ((m = digitRe.exec(t))) out.push({ token: m[0].trim(), value: m[1], counter: m[2] || '' });
  const wordRe = new RegExp('(?:^|[^가-힣])(' + Object.keys(RF_KOREAN_NUMBERS_).join('|') + ')\\s*(' + RF_COUNTERS_ + ')', 'g');
  while ((m = wordRe.exec(t))) out.push({ token: (m[1] + ' ' + m[2]).trim(), value: String(RF_KOREAN_NUMBERS_[m[1]]), counter: m[2] });
  return out;
}

/**
 * Numbers a hook may use: numbers written in the verified facts / product name, plus the size of a list
 * in a fact ("다크그레이/그레이/화이트" → 3, "상·하단" → 2).
 */
function supportedNumbers_(ctx) {
  const set = {};
  Object.keys(ctx.allowedNumbers).forEach(function (n) {
    set[n] = true;
  });
  ctx.facts.forEach(function (f) {
    f.split(/[()（）:：]/).forEach(function (part) {
      const items = part.split(/[\/,·、]/).map(normalizeText).filter(Boolean);
      if (items.length >= 2) set[String(items.length)] = true;
    });
  });
  return set;
}

/** Type rules for H1–H5. Returns error strings. */
function hookTypeErrors_(id, text, ctx) {
  const t = normalizeText(text);
  const p = '훅 ' + id + ' "' + t + '" — ';
  const isQuestion = /[?？]\s*$/.test(t);
  const errors = [];
  if (id === 'H1') {
    if (!isQuestion) errors.push(p + '질문형은 시청자에게 묻는 질문(?)으로 끝나야 합니다.');
  } else if (isQuestion) {
    errors.push(p + RF_CONFIG.HOOK_TYPES[id].label + '은 질문이 아니어야 합니다.');
  }
  if (id === 'H2') {
    const nums = hookNumbers_(t);
    const ok = supportedNumbers_(ctx);
    if (!nums.length) errors.push(p + '숫자로 시작하는형은 확인된 기능에 근거한 숫자가 있어야 합니다 (예: "두 조각").');
    nums.forEach(function (n) {
      if (n.counter === '명' || n.counter === '%' || n.counter === '배') {
        errors.push(p + '통계·비율처럼 보이는 "' + n.token + '"는 지어낸 수치일 수 있어 쓸 수 없습니다.');
      } else if (!ok[n.value]) {
        errors.push(p + '"' + n.token + '"의 숫자 ' + n.value + '는 확인된 기능에 없습니다. 확인된 기능의 숫자만 쓰세요.');
      }
    });
  }
  if (id === 'H3' && !/(아니에요|아니라|아닙니다|아니죠|말고|오히려|사실은|착각|필요\s*없|안\s*해도|틀렸)/.test(t)) {
    errors.push(p + '통념을 뒤집는 단정형은 흔한 생각을 뒤집는 말("~아니에요", "~말고")이 있어야 합니다.');
  }
  if (id === 'H4' && !/(때|날|마다|하면|하는데|하다가|면서|아침|저녁|밤|출근|퇴근|비\s|이사|손님|집에|현관|원룸|자취|방|부엌|욕실|베란다)/.test(t)) {
    errors.push(p + '상황 묘사형은 언제·어디서 겪는 순간인지 보여야 합니다.');
  }
  if (id === 'H5' && !/(면\s*돼요|면\s*끝|면\s*돼|이\s*답|정답|해결|두면|붙이면|쓰면|바꾸면|결론)/.test(t)) {
    errors.push(p + '결론 먼저 던지는형은 해결책을 먼저 말해야 합니다 ("~하면 돼요").');
  }
  return errors;
}

/**
 * The five hooks: exactly H1–H5 once each, type rules, hook style (≤ 25 chars, problem-first, no ad
 * tone), verified facts/numbers only, distinct, not repeating this product's earlier hooks, and a
 * recommended hook with a reason. Returns { errors, hookSet }.
 */
function validateHookSet(payload, product, avoidHooks) {
  const errors = [];
  const ctx = factContext_(product);
  const T = RF_CONFIG.HOOK_TYPES;
  const ids = Object.keys(T);
  const hooks = Array.isArray(payload && payload.hooks) ? payload.hooks : [];
  if (hooks.length !== ids.length) errors.push('hooks는 정확히 ' + ids.length + '개(H1~H5)여야 합니다 (받은 개수: ' + hooks.length + ').');
  const byId = {};
  hooks.forEach(function (h) {
    if (!h || !T[h.id]) {
      errors.push('hooks의 id는 ' + ids.join(', ') + ' 중 하나여야 합니다: ' + JSON.stringify(h && h.id));
      return;
    }
    if (byId[h.id]) errors.push('훅 ' + h.id + '가 두 번 있습니다.');
    byId[h.id] = h;
    if (h.type && h.type !== T[h.id].type) errors.push('훅 ' + h.id + '의 type은 ' + T[h.id].type + '이어야 합니다.');
  });
  const seenText = {};
  const seenOpen = {};
  ids.forEach(function (id) {
    const h = byId[id];
    if (!h) {
      if (hooks.length === ids.length) errors.push('훅 ' + id + ' (' + T[id].label + ')이 없습니다.');
      return;
    }
    const text = normalizeText(h.text);
    if (!text) return errors.push('훅 ' + id + '의 text가 비어 있습니다.');
    hookStyleErrors_({ hook: text }, product, '훅 ' + id, avoidHooks).forEach(function (e) {
      errors.push(e);
    });
    hookTypeErrors_(id, text, ctx).forEach(function (e) {
      errors.push(e);
    });
    const where = '훅 ' + id + ': ';
    unsupportedClaims_(text, ctx, where, true).concat(measurementErrors_(text, ctx, where)).forEach(function (e) {
      errors.push(e);
    });
    extractNumbers(text).forEach(function (n) {
      if (!ctx.allowedNumbers[n] && id !== 'H2') errors.push(where + '확인된 기능에 없는 수치가 포함되어 있습니다: "' + n + '".');
    });
    // Its opening scene (scene 1 when this hook is chosen).
    if (!normalizeText(h.visual)) errors.push('훅 ' + id + ': visual(이 훅으로 시작할 때 첫 장면 연출)이 비어 있습니다.');
    if (normalizeText(h.flow_prompt).length < RF_CONFIG.LIMITS.MIN_FLOW_PROMPT_CHARS) {
      errors.push('훅 ' + id + ': flow_prompt(첫 장면 Google Flow 프롬프트)가 비어 있거나 너무 짧습니다.');
    }
    const key = looseText_(text);
    if (seenText[key]) errors.push('훅 ' + id + '가 ' + seenText[key] + '와 같습니다.');
    seenText[key] = id;
    const o = hookOpening_(text);
    if (o && seenOpen[o]) errors.push('훅 ' + id + '가 ' + seenOpen[o] + '와 같은 말("' + o + '")로 시작합니다. 다섯 훅은 서로 달라야 합니다.');
    if (o) seenOpen[o] = id;
  });
  const rec = payload && payload.recommended_hook;
  if (!rec || !byId[rec.id]) errors.push('recommended_hook.id는 H1~H5 중 하나여야 합니다.');
  else if (!normalizeText(rec.reason)) errors.push('recommended_hook.reason(추천 이유)이 비어 있습니다.');
  const hookSet = errors.length ? null : {
    hooks: ids.map(function (id) {
      const h = byId[id];
      return {
        id: id, type: T[id].type, label: T[id].label, text: normalizeText(h.text),
        visual: normalizeText(h.visual), flow_prompt: normalizeText(h.flow_prompt),
        emphasis: normalizeText(h.emphasis), sfx: normalizeText(h.sfx),
      };
    }),
    recommended: { id: rec.id, reason: normalizeText(rec.reason) },
  };
  return { errors: dedupe_(errors), hookSet: hookSet };
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
  // The creative angle is shown in 컨셉 (no new column), e.g. "A 일상 불편 · 출근길 우산".
  const angleLabel = RF_CONFIG.ANGLES[out.angle];
  if (angleLabel && normalizeText(out.concept).indexOf(angleLabel) !== 0) out.concept = angleLabel + ' · ' + normalizeText(out.concept);
  delete out.angle;
  applyAiLabel_(out);
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
function combineValidReels(attempts, product, expectedCount, options) {
  const count = expectedCount || RF_CONFIG.REELS_PER_PRODUCT;
  // One script + its own five hooks: nothing to combine across attempts.
  if (count < 2 || !options || options.requireHooks !== false) return null;
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
  const res = validateGeminiReels({ reels: picked }, product, count, options);
  return res.errors.length ? null : res;
}

/**
 * HOOK first, CTA last, beats in story order, keyword placeholder in the CTA.
 * New scripts (newStructure): HOOK → EMPATHY → SOLUTION → DEMO → CTA (BENEFIT optional).
 * Other scripts (older rows, reviewer edits): DEMO plus BENEFIT or SOLUTION.
 */
function storyboardErrors_(scenes, newStructure) {
  const errors = [];
  const beats = scenes.map(function (sc) {
    return sc ? sc.beat : '';
  });
  const rank = RF_CONFIG.BEAT_RANK;
  if (beats[0] !== 'HOOK') errors.push('첫 장면은 HOOK이어야 합니다.');
  if (beats[beats.length - 1] !== 'CTA') errors.push('마지막 장면은 CTA여야 합니다.');
  const has = function (b) {
    return beats.indexOf(b) !== -1;
  };
  if (newStructure) {
    if (!has('EMPATHY') && !has('PROBLEM')) errors.push('EMPATHY 장면(이 상황이 왜 불편한지)이 필요합니다.');
    if (!has('SOLUTION')) errors.push('SOLUTION 장면(제품을 자연스럽게 등장)이 필요합니다.');
    if (!has('DEMO')) errors.push('DEMO 장면(확인된 기능 시연)이 필요합니다.');
  } else {
    if (!has('DEMO')) errors.push('DEMO 장면이 필요합니다.');
    if (!has('BENEFIT') && !has('SOLUTION')) errors.push('BENEFIT 또는 SOLUTION 장면이 필요합니다.');
  }
  for (let i = 1; i < beats.length; i++) {
    if (rank[beats[i]] < rank[beats[i - 1]]) {
      errors.push('장면 순서는 HOOK → EMPATHY → SOLUTION → DEMO → (BENEFIT) → CTA여야 합니다.');
      break;
    }
  }
  const cta = scenes[scenes.length - 1];
  if (cta && typeof cta.narration === 'string' && cta.narration.indexOf(RF_CONFIG.KEYWORD_PLACEHOLDER) === -1) {
    errors.push('CTA 내레이션에 댓글 키워드 자리 "' + RF_CONFIG.KEYWORD_PLACEHOLDER + '"가 필요합니다.');
  }
  return errors;
}

/** Content pillar id from a stored label or id ('생활 꿀템 발견' or 'PRODUCT_DISCOVERY'), or ''. */
function pillarIdOf(value) {
  const v = normalizeText(value);
  if (!v) return '';
  const P = RF_CONFIG.BRAND.PILLARS;
  if (P[v]) return v;
  const ids = Object.keys(P).filter(function (id) {
    return looseText_(P[id].label) === looseText_(v);
  });
  return ids[0] || '';
}

function pillarLabel(id) {
  const p = RF_CONFIG.BRAND.PILLARS[id];
  return p ? p.label : '';
}

/** Scenes that show an AI visualization carry the on-screen label "AI 시뮬레이션" (renderer burns it in). */
function applyAiLabel_(reel) {
  const label = RF_CONFIG.BRAND.AI_LABEL;
  (Array.isArray(reel.scenes) ? reel.scenes : []).forEach(function (s) {
    if (!s) return;
    if (s.ai_visualization === true) {
      if (normalizeText(s.on_screen_text).indexOf(label) === -1) s.on_screen_text = normalizeText(label + ' ' + normalizeText(s.on_screen_text));
    } else {
      delete s.ai_visualization;
    }
  });
  return reel;
}

/**
 * Things the operator must confirm are real before approving: personal experience, product tests,
 * international-couple stories, before/after results, comparisons, AI visualizations. Detected in the
 * script text and from the content pillar. Returns [{ type, ask, where, text }] (deduplicated by type+where).
 */
function verificationFlags(reel, pillarId) {
  const flags = [];
  const seen = {};
  const add = function (type, ask, where, text) {
    const k = type + '|' + where;
    if (seen[k]) return;
    seen[k] = true;
    flags.push({ type: type, ask: ask, where: where, text: text || '' });
  };
  if (!reel) return flags;
  const texts = [{ where: 'hook', text: reel.hook }];
  (Array.isArray(reel.scenes) ? reel.scenes : []).forEach(function (s, i) {
    if (s) texts.push({ where: '장면 ' + (i + 1), text: s.narration }, { where: '장면 ' + (i + 1) + ' 화면', text: s.on_screen_text });
  });
  if (!(reel.scenes || []).some(function (s) { return s && s.narration; })) texts.push({ where: 'narration', text: reel.narration });
  texts.forEach(function (x) {
    const t = normalizeText(x.text);
    if (!t) return;
    RF_CONFIG.VERIFICATION_RULES.forEach(function (rule) {
      const m = t.match(rule.pattern);
      if (m) add(rule.type, rule.ask, x.where.replace(/ 화면$/, ''), '"' + t + '"');
    });
  });
  if (pillarId === 'INTL_COUPLE') add('국제부부 이야기', RF_CONFIG.VERIFICATION_RULES[2].ask, '콘텐츠 기둥', pillarLabel(pillarId));
  if (pillarId === 'COMPARE') add('비교', RF_CONFIG.VERIFICATION_RULES[4].ask, '콘텐츠 기둥', pillarLabel(pillarId));
  const aiScenes = (reel.scenes || []).map(function (s, i) {
    return s && s.ai_visualization === true ? i + 1 : 0;
  }).filter(Boolean);
  if (aiScenes.length || pillarId === 'AI_MAKEOVER') {
    add('AI 시뮬레이션', '영상에 "' + RF_CONFIG.BRAND.AI_LABEL + '" 표시가 보이는지, 실제 제품 장면과 구분되는지 확인', aiScenes.length ? '장면 ' + aiScenes.join(', ') : '콘텐츠 기둥', '');
  }
  return flags;
}

/** One line per flag, for the REELS "확인 필요" column. */
function formatVerificationFlags(flags) {
  return flags.map(function (f) {
    return '[' + f.type + '] ' + f.where + ': ' + f.ask + (f.text ? ' — ' + f.text : '');
  }).join('\n');
}

/** The first two words of a hook, for spotting three reels that open the same way. */
function hookOpening_(hook) {
  return normalizeText(hook).replace(/[^\s가-힣A-Za-z0-9]/g, '').split(' ').slice(0, 2).join(' ');
}

/**
 * Hook style for new Gemini scripts: short, starts from a relatable problem, not an ad.
 * Not applied to reviewer edits (the reviewer decides). Returns error strings with a fix.
 */
function hookStyleErrors_(reel, product, label, avoidHooks) {
  const errors = [];
  const hook = normalizeText(reel && reel.hook);
  if (!hook) return errors;
  const H = RF_CONFIG.HOOK_STYLE;
  const p = label + ': hook "' + hook + '" — ';
  const fix = ' 시청자가 겪는 구체적인 불편·상황으로 시작하는 짧은 구어체로 다시 쓰세요 (예: "급하게 출근하면 꼭 까먹는 우산!").';
  if ([...hook].length > H.MAX_CHARS) {
    errors.push(p + '첫 2~3초에 말할 수 있게 ' + H.MAX_CHARS + '자 이내여야 합니다.');
  }
  // Problem first: the hook must not open with the product.
  const nameTokens = normalizeText(product && product.name).split(' ').filter(function (t) {
    return [...t].length >= 2;
  });
  const first = hook.split(' ')[0];
  if (nameTokens.some(function (t) { return first.indexOf(t) === 0; })) {
    errors.push(p + '제품 이름으로 시작합니다. 제품이 아니라 상황·불편으로 시작하세요.' + fix);
  }
  H.AD_PATTERNS.forEach(function (rule) {
    if (rule.pattern.test(hook)) errors.push(p + rule.why + '입니다.' + fix);
  });
  (avoidHooks || []).forEach(function (old) {
    if (normalizeText(old) && looseText_(old) === looseText_(hook)) {
      errors.push(p + '이 상품의 기존 릴스 hook과 같습니다. 새로운 hook을 쓰세요.');
    }
  });
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
