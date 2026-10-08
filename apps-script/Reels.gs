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
