/**
 * Reels Factory — Google Sheets menu and workflow orchestration.
 */

function onOpen() {
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

/** Creates missing REELS / PERFORMANCE / LOG sheets and verifies PRODUCTS headers. Never edits PRODUCTS. */
function setupSheets() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    const fields = CONFIG.PRODUCT_FIELDS;
    requireHeaders_(
      getProductsSheet_(ss),
      Object.keys(fields).map(function (k) {
        return fields[k];
      })
    );
    ensureSheet_(ss, CONFIG.SHEETS.REELS, CONFIG.REELS_HEADERS);
    ensureSheet_(ss, CONFIG.SHEETS.PERFORMANCE, CONFIG.PERFORMANCE_HEADERS);
    ensureSheet_(ss, CONFIG.SHEETS.LOG, CONFIG.LOG_HEADERS);
    ui.alert('시트 준비 완료: PRODUCTS 헤더 확인, REELS / PERFORMANCE / LOG 준비됨.');
  } catch (e) {
    logEvent_('ERROR', 'setupSheets', '', e.message, e.stack);
    ui.alert('시트 준비 실패\n\n' + e.message);
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
  for (let attempt = 1; attempt <= CONFIG.MAX_GEMINI_ATTEMPTS; attempt++) {
    const raw = callGemini(buildGeminiPrompt(product, lastErrors));
    const result = prepareReelRecords(product, raw, existingIds, existingKeywords, {
      model: getGeminiModel(),
      generatedAt: new Date(),
    });
    if (!result.errors.length) return { records: result.records, attempts: attempt };
    lastErrors = result.errors;
    logEvent_(
      attempt < CONFIG.MAX_GEMINI_ATTEMPTS ? 'WARN' : 'ERROR',
      'validateGemini',
      product.id,
      '검증 실패 (시도 ' + attempt + '/' + CONFIG.MAX_GEMINI_ATTEMPTS + '): ' + result.errors.length + '건',
      result.errors.join('\n') + '\n\n--- 원본 응답 ---\n' + raw
    );
  }
  throw new Error(
    'Gemini 응답이 ' + CONFIG.MAX_GEMINI_ATTEMPTS + '회 모두 검증에 실패했습니다. REELS에는 아무것도 기록하지 않았습니다.\n' +
      '자세한 내용은 LOG 시트를 확인하세요.\n\n- ' + lastErrors.slice(0, 8).join('\n- ')
  );
}

/** Menu action: PRODUCTS selected row → Gemini → 3 validated REELS rows. */
function generateReelsForSelectedProduct() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const active = ss.getActiveSheet();
  const range = active.getActiveRange();

  if (active.getName() !== CONFIG.SHEETS.PRODUCTS || !range || range.getNumRows() !== 1 || range.getRow() < 2) {
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
    const dupProducts = findDuplicates(readColumn_(productsSheet, productsMap, CONFIG.PRODUCT_FIELDS.id));
    if (dupProducts.indexOf(product.id) !== -1) {
      throw new Error('PRODUCTS에 상품ID "' + product.id + '"가 여러 번 있습니다. 중복을 정리한 뒤 다시 실행하세요.');
    }

    const reelsSheet = ensureSheet_(ss, CONFIG.SHEETS.REELS, CONFIG.REELS_HEADERS);
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
    if (!isPermissionApproved(product.permission)) msg += '\n\n⚠ ' + CONFIG.PERMISSION_UNVERIFIED_NOTE;
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
