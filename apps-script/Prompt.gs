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
          // Creative angle: one reel each (A 일상 불편, B 좁은 공간, C 생활 상황).
          angle: { type: 'STRING', enum: ['EVERYDAY_FRUSTRATION', 'SMALL_SPACE', 'LIFESTYLE_SITUATION'] },
          // Content pillar (RF_CONFIG.BRAND.PILLARS).
          pillar: { type: 'STRING', enum: ['AI_MAKEOVER', 'PRODUCT_DISCOVERY', 'INTL_COUPLE', 'COMPARE'] },
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
                beat: { type: 'STRING', enum: ['HOOK', 'EMPATHY', 'SOLUTION', 'DEMO', 'BENEFIT', 'CTA'] },
                narration: { type: 'STRING' },
                duration_sec: { type: 'NUMBER' },
                visual: { type: 'STRING' },
                on_screen_text: { type: 'STRING' },
                flow_prompt: { type: 'STRING' },
                // IDs (F1, F2 …) of the verified facts this scene says or shows.
                fact_ids: { type: 'ARRAY', items: { type: 'STRING' } },
                // true when the scene shows an AI interior visualization (labelled "AI 시뮬레이션").
                ai_visualization: { type: 'BOOLEAN' },
              },
              required: ['scene_no', 'beat', 'narration', 'duration_sec', 'visual', 'on_screen_text', 'flow_prompt', 'fact_ids'],
              propertyOrdering: ['scene_no', 'beat', 'narration', 'duration_sec', 'visual', 'on_screen_text', 'flow_prompt', 'fact_ids'],
            },
          },
          // IDs (F1, F2 …) of every verified fact the reel relies on.
          facts_used: { type: 'ARRAY', items: { type: 'STRING' } },
          // Anything the operator must confirm is real before approval (empty if none).
          needs_verification: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['angle', 'pillar', 'concept', 'hook', 'narration', 'captions', 'scenes', 'facts_used'],
        propertyOrdering: ['angle', 'pillar', 'concept', 'hook', 'narration', 'captions', 'scenes', 'facts_used', 'needs_verification'],
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
function buildRegenerationPrompt(product, currentReel, reviewerNote, previousErrors, previousResponse) {
  const base = buildGeminiPrompt(product, previousErrors, previousResponse)
    .replace(
      '서로 다른 컨셉의 릴스 대본을 정확히 ' + RF_CONFIG.REELS_PER_PRODUCT + '개 작성하세요.',
      '아래 "현재 대본"을 검토자 요청에 맞게 고쳐 릴스 대본을 정확히 1개 작성하세요.'
    )
    .replace(/\n9\. 세 릴스는[^\n]*/, '')
    .replace(/\n## 세 가지 각도[\s\S]*?\n\n/, '\n## 각도\n- 현재 대본과 같은 angle을 유지하세요.\n\n');
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
 * `previousErrors` (optional) feeds validation failures back for a corrective retry, together with
 * the previous response (`previousResponse`, optional) so Gemini edits only what failed.
 */
function buildGeminiPrompt(product, previousErrors, previousResponse, avoidHooks) {
  const L = RF_CONFIG.LIMITS;
  const B = RF_CONFIG.BRAND;
  const facts = parseConfirmedFeatures(product.features);
  const lines = [
    '당신은 인스타그램 계정 "' + B.NAME + '"의 릴스(9:16 세로 숏폼) 대본 작가입니다.',
    '- 계정 소개: ' + B.POSITIONING,
    '- 슬로건: "' + B.TAGLINE + '"',
    '- 말투: ' + B.PERSONALITY,
    '- 차별점: ' + B.DIFFERENTIATORS.join(' / '),
    '- ' + B.CURRENT_FOCUS,
    '광고 문구가 아니라 실제 한국 라이프스타일 크리에이터가 친구에게 말하듯 쓰세요.',
    '아래 상품에 대해 서로 다른 컨셉의 릴스 대본을 정확히 ' + RF_CONFIG.REELS_PER_PRODUCT + '개 작성하세요.',
    '',
    '## 상품',
    '- 상품ID: ' + product.id,
    '- 상품명: ' + normalizeText(product.name),
    '- 카테고리: ' + (normalizeText(product.category) || '(미입력)'),
    '- 타깃: ' + (normalizeText(product.target) || '(미입력)'),
    '',
    '## 확인된 기능 (이 목록만 사실로 사용, ID로 참조)',
  ];
  facts.forEach(function (f, i) {
    lines.push('- ' + factId(i) + ': ' + f);
  });
  lines.push(
    '',
    '## 규칙',
    '1. 제품에 대한 사실은 위 확인된 기능(' + factId(0) + '~' + factId(facts.length - 1) + ')만 사용하세요. 목록에 없는 기능, 소재, 내구성·강도, 호환 표면(냉장고·벽·타일 등), 설치 방식(무타공·공구 등), 수납 개수, 가격, 할인, 순위, 후기, 인증, 색상, 수치는 절대 만들지 마세요.',
    '2. 확인된 기능을 자연스러운 한국어 구어체로 바꿔 말하세요. 기술 설명 문구를 그대로 읽지 마세요. 예: "자석 부착형 거치 방식" → "자석으로 붙여서 쓰는 우산꽂이", "철제 도어 부착" → "철제 현관문에 붙일 수 있어요". 뜻을 넓히거나 보태지는 마세요.',
    '3. 숫자·치수·단위는 확인된 기능에 적힌 그대로만 쓰세요. 상단/하단 치수를 바꾸거나 반올림·환산하지 마세요. 가격·할인·퍼센트는 쓰지 마세요.',
    '4. 각 장면의 fact_ids에는 그 장면이 말하거나 보여 주는 확인된 기능 ID를 넣으세요 (예: ["' + factId(0) + '"]). DEMO·BENEFIT 장면은 최소 1개, SOLUTION은 기능을 말하면 넣고, HOOK·EMPATHY·CTA는 보통 []. facts_used에는 릴스 전체에서 사용한 ID를 넣으세요. 기능 문장을 직접 쓰지 말고 ID만 쓰세요.',
    '5. 과장 표현(최저가, 100%, 무조건, 완벽, 평생, 절대, 1위, 최고, 튼튼, 강력 등)과 후기·인기 표현(후기, 리뷰, 다들 사요, 품절 등)을 쓰지 마세요.',
    '6. URL, 가격, 광고 표기는 쓰지 마세요. 댓글 키워드는 CTA 장면에서 자리표시자 ' + RF_CONFIG.KEYWORD_PLACEHOLDER + ' 로만 쓰세요.',
    '7. hook은 ' + L.HOOK_MAX_CHARS + '자 이내, narration은 ' + L.NARRATION_MAX_CHARS + '자 이내의 자연스러운 한국어 구어체. captions는 화면 자막 줄 목록이며 각 ' + L.CAPTION_MAX_CHARS + '자 이내.',
    '8. scenes는 ' + L.MIN_SCENES + '~' + L.MAX_SCENES + '개, scene_no는 1부터 순서대로, duration_sec 합계는 ' + L.MIN_TOTAL_SEC + '~' + L.MAX_TOTAL_SEC + '초.',
    '9. 세 릴스는 angle, concept, hook, hook의 첫마디가 모두 서로 달라야 합니다.',
    '10. 시연은 실제로 가능한 사용 장면만 묘사하세요.',
    '11. 경험담·구매·테스트·남편 반응·전후 결과를 지어내지 마세요 ("한 달 써 보니", "샀는데", "테스트해 보니", "남편이 좋아했어요", "바꿨더니 ~됐어요" 금지). 상황은 시청자 입장에서 "~잖아요", "~죠", "~할 때"처럼 말하세요.',
    '12. 실제 경험이나 제품 테스트가 꼭 필요한 내용이면 지어내지 말고 needs_verification에 무엇을 확인해야 하는지 적으세요 (운영자가 승인 전에 확인합니다). 없으면 [].',
    '13. AI 인테리어 시뮬레이션 장면은 ai_visualization=true로 표시하세요 (영상에 "' + B.AI_LABEL + '"이 표시됩니다). 실제 제품 장면과 섞어 진짜처럼 보이게 하지 마세요.',
    '',
    '## 콘텐츠 기둥 (릴스마다 pillar 하나 — 목표 비율은 계정 전체 기준이며, 상품에 맞는 것을 고르세요)',
    Object.keys(B.PILLARS).map(function (id) {
      const pl = B.PILLARS[id];
      return '- ' + id + ' (' + pl.label + ', 목표 ' + pl.target + '%): ' + pl.hint;
    }).join('\n'),
    '',
    '## 세 가지 각도 (릴스마다 하나씩, angle 필드에 표시)',
    '- 세 대본은 서로 확실히 다른 컨셉·hook·각도여야 합니다.',
    '- EVERYDAY_FRUSTRATION (A 일상 불편): 매일 겪는 짜증·깜빡함에서 시작. 예: "급하게 출근할 때마다 우산 깜빡하는 사람?"',
    '- SMALL_SPACE (B 좁은 공간): 원룸·좁은 현관·수납 부족 문제에서 시작. 예: "원룸 살면 우산꽂이 둘 자리도 애매하잖아요."',
    '- LIFESTYLE_SITUATION (C 생활 상황): 비 오는 날 귀가, 손님 올 때, 이사 직후 같은 구체적인 장면에서 시작. 예: "비 오는 날마다 현관이 지저분해지는 이유."',
    '',
    '## hook (첫 장면, 첫 2~3초)',
    '- ' + RF_CONFIG.HOOK_STYLE.MAX_CHARS + '자 이내. 첫 2초 안에 "어, 나도 그래" 싶은 구체적인 불편이나 상황을 말하세요.',
    '- 제품 이름으로 시작하지 마세요. 제품 소개·결과 약속으로 시작하지 마세요.',
    '- 쓰지 말 것: "~니다" 광고 말투, "~다면?"·"~하시나요?" 같은 뻔한 질문, "~하세요" 권유, "하나로", "소개", "추천", "필수템", "꿀템", "~이 달라집니다".',
    '- 나쁜 예: "현관이 좁아 우산 둘 곳이 없다면?", "우산꽂이 하나로 현관이 달라집니다."',
    '- 좋은 예: "급하게 출근할 때마다 우산 깜빡하는 사람?", "원룸 살면 우산꽂이 둘 자리도 애매하잖아요.", "비 오는 날마다 현관이 지저분해지는 이유."',
    '- 기능 나열로 시작하지 마세요 (예: "자석형 2피스 우산꽂이" ✗).',
    '- 첫 장면 visual은 첫 프레임부터 그 불편한 상황을 보여 주세요 (느린 도입·로고·제품 클로즈업 금지).',
    '',
    '## 스토리보드 (영상이 이야기를 이끌고, 자막은 보조)',
    '- 이야기 흐름: PROBLEM → EMPATHY → SOLUTION → DEMONSTRATION → CTA.',
    '- 장면 beat: HOOK(= PROBLEM, 공감 가는 불편·상황, 0~3초) → EMPATHY(왜 짜증 나는지) → SOLUTION(제품을 자연스럽게 등장) → DEMO(= DEMONSTRATION, 확인된 기능 시연) → CTA(댓글에 키워드 남기기). 필요하면 DEMO 뒤에 BENEFIT 1개를 더할 수 있습니다.',
    '- SOLUTION은 "그래서 ~" 처럼 자연스럽게 이어 주세요. 제품을 광고처럼 소개하지 마세요.',
    '- 각 장면의 narration은 그 장면에서 말하는 한 문장이며 그대로 자막이 됩니다: ' + L.SCENE_NARRATION_MAX_CHARS + '자 이내, 짧고 자연스러운 구어체.',
    '- 장면 길이 ' + L.SCENE_MIN_SEC + '~' + L.SCENE_MAX_SEC + '초, 전체 20~25초. hook = 첫 장면 narration. narration(전체) = 장면 narration을 순서대로 이은 것, captions = 장면 narration 목록.',
    '- 말투: 크리에이터가 직접 말하듯 짧은 구어체 구절 (예: "인테리어 하면서", "나무 질감을 중요하게 생각해서"). 자막은 한 줄씩 짧게 바뀝니다. 기업 광고 말투(~합니다, ~드립니다)는 쓰지 마세요.',
    '- visual은 실제 생활 공간에서 사람이 제품을 쓰는 모습을 구체적으로: 카메라를 보는 사람, 손으로 제품 사용 클로즈업, 발·손 POV, 질감 클로즈업, 공간 와이드. 자연광, 핸드헬드. 글자만 있는 화면·단색 배경·그래픽 금지.',
    '- on_screen_text는 빈 문자열로 두세요 (자막은 narration으로 충분합니다).',
    '- CTA 장면 narration 예: "제품 정보는 댓글에 \'' + RF_CONFIG.KEYWORD_PLACEHOLDER + '\' 남겨 주세요" — 과장 없이 자연스럽게, 댓글로 키워드를 남기도록.',
    '',
    '## flow_prompt (Google Flow 수동 생성용, 영어)',
    '- 각 장면마다 Google Flow에 붙여넣을 영어 영상 프롬프트를 작성하세요.',
    '- 9:16 vertical, photorealistic, Korean apartment interior, natural light, 장면 길이에 맞는 단일 샷.',
    '- 브랜드 로고, 상표, 읽을 수 있는 글자, 실존 인물의 얼굴을 넣지 마세요.',
    '- 확인된 기능과 다른 동작(예: 확인되지 않은 부착 방식)을 묘사하지 마세요.',
    '',
    'JSON 스키마에 맞춰 JSON만 출력하세요.'
  );
  if (avoidHooks && avoidHooks.length) {
    lines.push('', '## 이 상품에 이미 쓴 hook (비슷하게 쓰지 마세요)');
    avoidHooks.slice(-12).forEach(function (h) {
      lines.push('- ' + normalizeText(h));
    });
  }
  if (previousErrors && previousErrors.length) {
    lines.push(
      '',
      '## 이전 응답의 검증 오류 (반드시 수정)',
      '아래 문제만 고치세요. 지적된 문장은 확인된 기능만으로 다시 쓰거나 삭제하고, 문제가 없는 릴스와 장면은 그대로 두세요.'
    );
    previousErrors.slice(0, 25).forEach(function (e) {
      lines.push('- ' + e);
    });
    if (previousResponse) {
      lines.push('', '## 이전 응답 (JSON — 위 오류만 고쳐서 다시 출력)', String(previousResponse).slice(0, 12000));
    }
  }
  return lines.join('\n');
}
