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
