// MOCK text provider. Only used when the operator explicitly routes a task to "mock" (demo/tests). Its output is
// labelled as a sample in the UI and is never billed. It makes no network calls.
'use strict';

function createMockText() {
  const calls = [];
  return {
    name: 'mock',
    mock: true,
    supportsImages: true,
    calls,
    async listModels() { return ['mock-1']; },
    async generate({ task, prompt, images = [], json }) {
      calls.push({ task, promptChars: prompt.length, images: images.length });
      const product = (/PRODUCT_NAME:\s*(.+)/.exec(prompt) || [, '제품'])[1].trim();
      if (task === 'storyConcepts') {
        const n = Number((/COUNT:\s*(\d+)/.exec(prompt) || [, 3])[1]);
        const base = [
          ['현관 우산 대참사', 'Jack drips rainwater across the entryway while Diane holds a cleaning cloth.', '비 오는 날 현관이 물바다가 되는 부부 신경전'],
          ['Jack은 안 쓸 거라고 했다', 'Diane brings a new gadget; Jack insists he will never use it.', '새 물건을 두고 벌어지는 고집 대결'],
          ['보이지 않는 집 정리 대결', 'A tidy-off competition between Diane and Jack ends with a surprise.', '정리 내기에서 뜻밖의 반전'],
          ['한밤의 택배 미스터리', 'A late-night parcel arrives and Jack suspects Diane\'s Coupang habit.', '택배 상자를 둘러싼 유쾌한 추궁'],
        ];
        return { text: '', json: { concepts: base.slice(0, Math.max(3, n)).map((b, i) => ({ title: `[샘플] ${b[0]}`, hook: `${product}: ${b[1]}`, situation: b[2], productRole: `${product}를 확인된 기능 범위에서만 보여줍니다.`, characterUsage: i === 2 ? 'Diane과 Jack 모두 등장' : i === 1 ? 'Diane 중심, Jack 반응' : 'Jack 중심, Diane 개입', plot: `[샘플] ${b[2]} → Jack과 Diane의 티키타카 → 제품 등장 → 반전 마무리 (약 ${38 + i * 2}초)`, visualComedy: '[샘플] 과장된 표정 클로즈업과 리액션 컷', payoff: '반전 대사로 마무리', viewerAppeal: '공감 가는 집안 상황', ctaDirection: '댓글 키워드로 링크 안내', estimatedDurationSec: 38 + i * 2, estimatedScenes: 6 + i })) }, usage: { inputTokens: null, outputTokens: null } };
      }
      if (task === 'scriptWriting') {
        const c = (/CONCEPT_TITLE:\s*(.+)/.exec(prompt) || [, '샘플'])[1].trim();
        return { text: '', json: { title: c, beats: ['상황 제시', '문제 확대', '제품 발견', '반전'], scenes: [{ id: 'S1', title_ko: '문제에 빠진 남편', title: '문제에 빠진 남편', beat: 1, durationSec: 5, characters: ['jack'], showsProduct: false, visual: 'Jack faces the household problem at the entryway.', action: 'Jack sighs.', narration: '' }, { id: 'S2', title_ko: '아내의 신문물 자랑', title: '아내의 신문물 자랑', beat: 2, durationSec: 5, characters: ['diane', 'jack'], showsProduct: true, visual: 'Diane shows the product to Jack.', action: 'Diane points at the product.', narration: '' }], lines: [{ id: 'L1', sceneId: 'S2', speaker: 'diane', en: 'Look what I found!', ko: '내가 뭘 찾았게!' }], cta: { lines: ['댓글에 ‘링크’ 남기면 링크 드림!'], keyword: '링크', durationSec: 3.5 } }, usage: { inputTokens: null, outputTokens: null } };
      }
      return { text: 'MOCK', json: json ? {} : undefined, usage: { inputTokens: null, outputTokens: null } };
    },
    async generateImage() { throw Object.assign(new Error('mock does not generate images'), { category: 'bad_request' }); },
  };
}

module.exports = { createMockText };
