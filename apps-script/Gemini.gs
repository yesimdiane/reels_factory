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
    CONFIG.DEFAULT_GEMINI_MODEL
  );
}

/**
 * Calls Gemini once and returns the raw JSON text from the first candidate.
 * Throws an actionable Error on HTTP / safety / truncation problems.
 */
function callGemini(promptText) {
  const model = getGeminiModel();
  const url = CONFIG.GEMINI_API_BASE + encodeURIComponent(model) + ':generateContent';
  const body = {
    contents: [{ role: 'user', parts: [{ text: promptText }] }],
    generationConfig: {
      temperature: 0.8,
      responseMimeType: 'application/json',
      responseSchema: GEMINI_RESPONSE_SCHEMA,
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
    response = UrlFetchApp.fetch(url, options);
    code = response.getResponseCode();
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
    if (code === 404) hint = ' (GEMINI_MODEL "' + model + '"이 존재하는지 확인하세요)';
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
