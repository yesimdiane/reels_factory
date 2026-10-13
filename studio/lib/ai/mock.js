// MOCK text provider. Only used when the operator explicitly routes a task to "mock" (demo/tests). Its output is
// labelled as a sample in the UI and is never billed. It makes no network calls.
'use strict';


/** Sample output for the fixed episode formula (clearly generic; real AI replaces it). */
function mockFormula(prompt) {
  const product = (/PRODUCT_NAME:\s*(.+)/.exec(prompt) || [, '제품'])[1].trim();
  const scene = (title, visual, lines) => ({ title_ko: title, durationSec: 4, characters: lines.some((l) => l[0] === 'diane') ? ['diane'] : ['jack'], showsProduct: false, visual, action: '[샘플] ' + visual, narration: '', placement: '', lines: lines.map(([speaker, en, ko]) => ({ speaker, en, ko })) });
  const beats = {
    setup: { title_ko: '영국인의 자신감', story_en: '[sample] Jack confidently ignores the obvious preparation.', visual: 'Jack strides down a busy Seoul street.', scenes: [scene('영국인의 자신감', 'Jack strides down a busy Seoul street.', [['jack', 'I do not need that.', '그건 필요 없어.']])] },
    problem: { title_ko: '서울이 잠긴 날', story_en: '[sample] A real problem starts.', visual: 'The problem begins around Jack.', scenes: [scene('서울이 잠긴 날', 'The problem begins around Jack.', [['jack', 'It is fine. Totally fine.', '괜찮아. 완전 괜찮아.']])] },
    absurd_escalation: { title_ko: '도시를 삼킨 대재앙', story_en: '[sample] The same problem becomes cartoon-sized.', visual: 'The problem grows to an absurd size.', scenes: [scene('도시를 삼킨 대재앙', 'The problem grows to an absurd size.', [['jack', 'Still fine!', '아직 괜찮아!']])] },
    unexpected_twist: { title_ko: '출근길의 보트', story_en: '[sample] The world around Jack acts unexpectedly normal.', visual: 'Commuters carry on as if nothing happened.', scenes: [scene('출근길의 보트', 'Commuters carry on as if nothing happened.', [['jack', 'Wait, what?', '잠깐, 뭐라고?']])] },
    resolution: { title_ko: '물에 빠진 생쥐', story_en: '[sample] Jack makes it home, soaked.', visual: 'Jack reaches the hilltop home.', scenes: [scene('물에 빠진 생쥐', 'Jack reaches the hilltop home.', [['jack', 'I made it.', '해냈어.']])] },
    product_bridge: { title_ko: '현관 출입 금지', story_en: '[sample] Jack drips everywhere; Diane has her excuse.', visual: 'Diane stops Jack at the door with a towel.', scenes: [scene('현관 출입 금지', 'Diane stops Jack at the door with a towel.', [['diane', 'Stop right there! Not one drop inside!', '거기 서! 한 방울도 안 돼!']])] },
  };
  const vars = { PRODUCT_NAME: product, PRODUCT_NAME_KO: product, USE_PHRASE: 'it', USE_PHRASE_KO: '그걸', DEMO_ACTION: `Diane uses ${product} as intended (sample).`, DEMO_ACTION_KO: `${product} 사용 (샘플)`, DEMO_LINE_EN: 'Look how easy that is!', DEMO_LINE_KO: '봐, 이렇게 쉬워!' };
  const target = /TARGET_BEAT:\s*(\w+)/.exec(prompt);
  if (target && beats[target[1]]) return { beat: beats[target[1]] };
  if (!/"comedy_story": \{"setup"/.test(prompt)) return { ending_vars: vars };
  return { title: '[샘플] ' + product, comedy_story: beats, ending_vars: vars, cta: { lines: ["댓글에 '링크' 남기면 링크 드림!"], keyword: '링크', durationSec: 3.5 } };
}


/** Sample dialogue shortening (generic: keeps the first lines, trims each to a few words; real AI rewrites properly). */
function mockTiming(prompt) {
  const m = /TIMING_TARGETS[^\n]*\n(\[[\s\S]*?\n\])/.exec(prompt);
  let targets = [];
  try { targets = JSON.parse(m[1]); } catch (_) { /* none */ }
  return { scenes: targets.map((t) => ({ id: t.id, lines: t.lines.slice(0, Math.max(1, Math.min(2, t.lines.length))).map((l) => ({ id: l.id, speaker: l.speaker, en: l.en.split(/\s+/).slice(0, Math.max(2, Math.min(5, Math.floor(t.wordBudget / 2) || 2))).join(' '), ko: l.ko.split(/\s+/).slice(0, 3).join(' ') })) })) };
}

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
      if (task === 'scriptWriting' && /TRANSLATE_TO:/.test(prompt)) { const to = /TRANSLATE_TO:\s*(\w+)/.exec(prompt)[1]; const src = /<<<TEXT\n([\s\S]*?)\nTEXT>>>/.exec(prompt)[1]; return { text: '', json: { translation: (to === 'Korean' ? '[샘플 번역 — AI 미연결] ' : '[Sample translation — AI not connected] ') + src }, usage: { inputTokens: null, outputTokens: null } }; }
      if (task === 'scriptWriting' && /TIMING_TARGETS/.test(prompt)) return { text: '', json: mockTiming(prompt), usage: { inputTokens: null, outputTokens: null } };
      if (task === 'scriptWriting' && /"comedy_story": \{"setup"|\{"ending_vars"|\{"beat": BEAT/.test(prompt)) return { text: '', json: mockFormula(prompt), usage: { inputTokens: null, outputTokens: null } };
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
