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
    .addItem('선택한 상품으로 훅 5개 + 대본 생성', 'generateReelsForSelectedProduct')
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
      [RF_CONFIG.SHEETS.REELS, RF_CONFIG.REELS_HEADERS.concat(RF_CONFIG.REELS_OPTIONAL_HEADERS)],
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
function generateValidatedRecords_(product, existingIds, existingKeywords, previousHooks) {
  const vopts = { avoidHooks: previousHooks || [] };
  let lastErrors = [];
  let lastRaw = '';
  const attempts = [];
  const meta = function () {
    return { model: RF_GEMINI_STATE.lastModel || getGeminiModel(), generatedAt: new Date() };
  };
  for (let attempt = 1; attempt <= RF_CONFIG.MAX_GEMINI_ATTEMPTS; attempt++) {
    // A retry gets the exact failing claims and the previous response, so Gemini fixes only those.
    const raw = callGemini_(buildGeminiPrompt(product, lastErrors, lastRaw, vopts.avoidHooks));
    const result = prepareReelRecords(product, raw, existingIds, existingKeywords, meta(), vopts);
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
    const combined = attempts.length > 1 ? combineValidReels(attempts, product, null, vopts) : null;
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

  const reelsSheet = ensureSheet_(ss, RF_CONFIG.SHEETS.REELS, RF_CONFIG.REELS_HEADERS, RF_CONFIG.REELS_OPTIONAL_HEADERS);
  // The five hooks and the operator's choice need their columns — checked before paying for Gemini.
  const hookMissing = missingHeaders_(reelsSheet, RF_CONFIG.REELS_HOOK_HEADERS);
  if (hookMissing.length) {
    throw new Error('REELS에 훅 저장 열이 없습니다 (' + hookMissing.join(', ') + '). "릴스 팩토리 → 시트 준비"를 먼저 실행하세요 — 기존 데이터는 바뀌지 않고 1행 오른쪽에 열만 추가됩니다. Gemini는 호출하지 않았습니다.');
  }
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

  // Hooks this product already has: Gemini is asked not to repeat them, and exact repeats are refused.
  const previousHooks = [];
  readRecords_(reelsSheet, ['후킹', '상품ID', '훅 후보(JSON)'])
    .filter(function (r) {
      return normalizeText(r['상품ID']) === product.id;
    })
    .forEach(function (r) {
      if (normalizeText(r['후킹'])) previousHooks.push(normalizeText(r['후킹']));
      parseHookSet(r['훅 후보(JSON)']).hooks.forEach(function (h) {
        if (previousHooks.indexOf(h.text) === -1) previousHooks.push(h.text);
      });
    });
  const result = generateValidatedRecords_(product, existingIds, existingKeywords, previousHooks);
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
        productId + '에 이미 릴스 ' + res.needsConfirm + '개가 있습니다. 새 훅 5개와 대본을 추가로 생성할까요?',
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
