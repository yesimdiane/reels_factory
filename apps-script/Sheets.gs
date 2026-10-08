/**
 * Google Sheets I/O. Columns are always located by header name so existing
 * columns (and any extra columns the operator adds) are preserved.
 */

/** Returns { headerName: 1-based column index } for row 1. */
function getHeaderMap_(sheet) {
  const lastCol = sheet.getLastColumn();
  const map = {};
  if (lastCol === 0) return map;
  sheet
    .getRange(1, 1, 1, lastCol)
    .getValues()[0]
    .forEach(function (h, i) {
      const name = normalizeText(h);
      if (name && !map[name]) map[name] = i + 1;
    });
  return map;
}

function requireHeaders_(sheet, required) {
  const map = getHeaderMap_(sheet);
  const missing = required.filter(function (h) {
    return !map[h];
  });
  if (missing.length) {
    throw new Error(
      '"' + sheet.getName() + '" 시트 1행에 필요한 헤더가 없습니다: ' + missing.join(', ') +
        '. 기존 데이터는 자동으로 수정하지 않습니다 — 헤더를 직접 추가하거나 이름을 확인하세요.'
    );
  }
  return map;
}

/**
 * Creates the sheet with headers if it does not exist (or is completely empty).
 * Never modifies an existing header row; only verifies it.
 */
function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
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
  const sheet = ss.getSheetByName(CONFIG.SHEETS.PRODUCTS);
  if (!sheet) throw new Error('"' + CONFIG.SHEETS.PRODUCTS + '" 시트를 찾을 수 없습니다.');
  return sheet;
}

/** Reads one PRODUCTS row into a product object. */
function readProduct_(sheet, rowNumber) {
  const fields = CONFIG.PRODUCT_FIELDS;
  const headerNames = Object.keys(fields).map(function (k) {
    return fields[k];
  });
  const map = requireHeaders_(sheet, headerNames);
  const values = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
  const product = { rowNumber: rowNumber };
  Object.keys(fields).forEach(function (k) {
    product[k] = values[map[fields[k]] - 1];
  });
  product.id = normalizeText(product.id);
  return product;
}

/** All non-empty values in a column identified by header name (excluding header row). */
function readColumn_(sheet, map, headerName) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet
    .getRange(2, map[headerName], lastRow - 1, 1)
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
      if (map[h]) row[map[h] - 1] = rec[h];
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
    const sheet = ensureSheet_(ss, CONFIG.SHEETS.LOG, CONFIG.LOG_HEADERS);
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
