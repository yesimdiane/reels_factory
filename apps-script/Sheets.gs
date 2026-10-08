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
