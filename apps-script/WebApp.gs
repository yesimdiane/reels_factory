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
  const f = RF_CONFIG.PRODUCT_FIELDS;
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
  const products = readRecords_(productsSheet, productHeaders)
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
      let newReel = null;
      for (let attempt = 1; attempt <= RF_CONFIG.MAX_GEMINI_ATTEMPTS && !newReel; attempt++) {
        const raw = callGemini_(buildRegenerationPrompt(found.product, current, note, lastErrors), geminiResponseSchema(1));
        const parsed = parseModelJson(raw);
        const result = parsed.error ? { errors: [parsed.error] } : validateGeminiReels(parsed.value, found.product, 1);
        if (result.errors.length) {
          lastErrors = result.errors;
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
      }, 'Gemini (' + getGeminiModel() + ')');
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
