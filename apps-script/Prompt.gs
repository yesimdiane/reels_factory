/**
 * Gemini prompt and structured-output schema.
 */

// Gemini `responseSchema` (OpenAPI subset). Validation.gs re-checks everything regardless.
const RF_GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reels: {
      type: 'ARRAY',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'OBJECT',
        properties: {
          concept: { type: 'STRING' },
          hook: { type: 'STRING' },
          narration: { type: 'STRING' },
          captions: { type: 'ARRAY', items: { type: 'STRING' } },
          scenes: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                scene_no: { type: 'INTEGER' },
                beat: { type: 'STRING', enum: ['HOOK', 'PROBLEM', 'DEMO', 'BENEFIT', 'CTA'] },
                narration: { type: 'STRING' },
                duration_sec: { type: 'NUMBER' },
                visual: { type: 'STRING' },
                on_screen_text: { type: 'STRING' },
                flow_prompt: { type: 'STRING' },
              },
              required: ['scene_no', 'beat', 'narration', 'duration_sec', 'visual', 'on_screen_text', 'flow_prompt'],
              propertyOrdering: ['scene_no', 'beat', 'narration', 'duration_sec', 'visual', 'on_screen_text', 'flow_prompt'],
            },
          },
          facts_used: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['concept', 'hook', 'narration', 'captions', 'scenes', 'facts_used'],
        propertyOrdering: ['concept', 'hook', 'narration', 'captions', 'scenes', 'facts_used'],
      },
    },
  },
  required: ['reels'],
};

/** Response schema for `count` reels (3 for a new product, 1 for a regenerated script). */
function geminiResponseSchema(count) {
  const schema = JSON.parse(JSON.stringify(RF_GEMINI_RESPONSE_SCHEMA));
  schema.properties.reels.minItems = count;
  schema.properties.reels.maxItems = count;
  return schema;
}

/**
 * Prompt to rewrite ONE script after the reviewer requested changes. Uses the same rules as
 * buildGeminiPrompt, the current script and the reviewer's note. Costs one Gemini call.
 */
function buildRegenerationPrompt(product, currentReel, reviewerNote, previousErrors) {
  const base = buildGeminiPrompt(product, previousErrors)
    .replace(
      '서로 다른 컨셉의 릴스 대본을 정확히 ' + RF_CONFIG.REELS_PER_PRODUCT + '개 작성하세요.',
      '아래 "현재 대본"을 검토자 요청에 맞게 고쳐 릴스 대본을 정확히 1개 작성하세요.'
    )
    .replace(/\n9\. 세 릴스는[^\n]*/, '');
  return [
    base,
    '',
    '## 현재 대본 (JSON)',
    JSON.stringify(currentReel),
    '',
    '## 검토자 수정 요청',
    normalizeText(reviewerNote) || '(메모 없음 — 전반적으로 개선)',
    '',
    '응답의 reels 배열에는 수정된 대본 1개만 넣으세요.',
  ].join('\n');
}

/**
 * Builds the Gemini prompt for one product.
 * `previousErrors` (optional) feeds validation failures back for a corrective retry.
 */
function buildGeminiPrompt(product, previousErrors) {
  const L = RF_CONFIG.LIMITS;
  const facts = parseConfirmedFeatures(product.features);
  const lines = [
    '당신은 한국 인스타그램 홈데코 릴스(9:16 세로 숏폼) 대본 작가입니다.',
    '아래 상품에 대해 서로 다른 컨셉의 릴스 대본을 정확히 ' + RF_CONFIG.REELS_PER_PRODUCT + '개 작성하세요.',
    '',
    '## 상품',
    '- 상품ID: ' + product.id,
    '- 상품명: ' + normalizeText(product.name),
    '- 카테고리: ' + (normalizeText(product.category) || '(미입력)'),
    '- 타깃: ' + (normalizeText(product.target) || '(미입력)'),
    '',
    '## 확인된 기능 (이 목록만 사실로 사용)',
  ];
  facts.forEach(function (f) {
    lines.push('- ' + f);
  });
  lines.push(
    '',
    '## 규칙',
    '1. 위 "확인된 기능"에 없는 기능, 소재, 내구성, 가격, 할인, 순위, 후기, 수치를 절대 만들지 마세요.',
    '2. 화면 문구·내레이션·자막에 들어가는 숫자는 확인된 기능에 적힌 숫자만 사용하세요.',
    '3. facts_used에는 실제로 사용한 확인된 기능을 위 목록 문구 그대로(한 글자도 바꾸지 말고) 넣으세요.',
    '4. 과장 표현(최저가, 100%, 무조건, 완벽, 평생, 1위, 품절 임박 등)을 쓰지 마세요.',
    '5. URL, 가격, 광고 표기는 쓰지 마세요. 댓글 키워드는 CTA 장면에서 자리표시자 ' + RF_CONFIG.KEYWORD_PLACEHOLDER + ' 로만 쓰세요.',
    '6. hook은 ' + L.HOOK_MAX_CHARS + '자 이내, narration은 ' + L.NARRATION_MAX_CHARS + '자 이내의 자연스러운 한국어 구어체.',
    '7. captions는 화면 자막 줄 목록이며 각 ' + L.CAPTION_MAX_CHARS + '자 이내.',
    '8. scenes는 ' + L.MIN_SCENES + '~' + L.MAX_SCENES + '개, scene_no는 1부터 순서대로, duration_sec 합계는 ' + L.MIN_TOTAL_SEC + '~' + L.MAX_TOTAL_SEC + '초.',
    '9. 세 릴스는 concept과 hook이 서로 달라야 합니다 (예: 문제 해결, 설치 과정, 공간 비포/애프터).',
    '10. 시연은 실제로 가능한 사용 장면만 묘사하세요.',
    '',
    '## 스토리보드 (영상이 이야기를 이끌고, 자막은 보조)',
    '- 장면 순서: HOOK → (PROBLEM) → DEMO → BENEFIT → CTA. 첫 장면 HOOK, 마지막 장면 CTA, DEMO와 BENEFIT은 반드시 포함. PROBLEM은 HOOK 장면에 합쳐도 됩니다.',
    '- 각 장면의 narration은 그 장면에서 말하는 한 문장이며 그대로 자막이 됩니다: ' + L.SCENE_NARRATION_MAX_CHARS + '자 이내, 짧고 자연스러운 구어체.',
    '- 장면 길이 ' + L.SCENE_MIN_SEC + '~' + L.SCENE_MAX_SEC + '초, 전체 20~25초. hook = 첫 장면 narration. narration(전체) = 장면 narration을 순서대로 이은 것, captions = 장면 narration 목록.',
    '- 말투: 크리에이터가 직접 말하듯 짧은 구어체 구절 (예: "인테리어 하면서", "나무 질감을 중요하게 생각해서"). 자막은 한 줄씩 짧게 바뀝니다.',
    '- visual은 실제 생활 공간에서 사람이 제품을 쓰는 모습을 구체적으로: 카메라를 보는 사람, 손으로 제품 사용 클로즈업, 발·손 POV, 질감 클로즈업, 공간 와이드. 자연광, 핸드헬드. 글자만 있는 화면·단색 배경·그래픽 금지.',
    '- on_screen_text는 빈 문자열로 두세요 (자막은 narration으로 충분합니다).',
    '- CTA 장면 narration 예: "제품 정보는 댓글에 \'' + RF_CONFIG.KEYWORD_PLACEHOLDER + '\'" — 과장 없이 자연스럽게.',
    '',
    '## flow_prompt (Google Flow 수동 생성용, 영어)',
    '- 각 장면마다 Google Flow에 붙여넣을 영어 영상 프롬프트를 작성하세요.',
    '- 9:16 vertical, photorealistic, Korean apartment interior, natural light, 장면 길이에 맞는 단일 샷.',
    '- 브랜드 로고, 상표, 읽을 수 있는 글자, 실존 인물의 얼굴을 넣지 마세요.',
    '- 확인된 기능과 다른 동작(예: 확인되지 않은 부착 방식)을 묘사하지 마세요.',
    '',
    'JSON 스키마에 맞춰 JSON만 출력하세요.'
  );
  if (previousErrors && previousErrors.length) {
    lines.push('', '## 이전 응답의 검증 오류 (반드시 수정)');
    previousErrors.slice(0, 20).forEach(function (e) {
      lines.push('- ' + e);
    });
  }
  return lines.join('\n');
}
