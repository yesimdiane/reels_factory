// Story Lab categories and the generation-request rules (shared by the API, the prompt and the validation).
//   drama  — everyday comedy with escalating absurdity and a twist; goal: purchase conversion
//   viral  — absurd, visually memorable concepts built for views / shares / discovery
//   info   — useful, verifiable recommendations; goal: follows, saves, shares
//   all    — exactly one of each (count is fixed to 3)
'use strict';
const { StudioError } = require('./util');

const CATEGORIES = {
  drama: {
    ko: '반전형 생활 개그', en: 'Drama',
    brief: '제품을 자연스럽게 녹인 생활 코미디. 황당함이 점점 커지다가 예상 밖의 반전으로 끝납니다.',
    goal: '구매 전환',
    rule: 'DRAMA: a natural product promotion told as a comedic everyday story. Absurdity ESCALATES beat by beat and ends with an unexpected twist. The product solves the problem inside the story. Primary goal: purchase conversion.',
  },
  viral: {
    ko: '바이럴형', en: 'Viral',
    brief: '조회·공유·채널 발견을 노린 황당하고 눈에 남는 숏폼. 예: Jack이 제품을 들고 춤춘다.',
    goal: '조회·공유·채널 발견',
    rule: 'VIRAL: an absurd, visually memorable short-form concept designed for views, shares and channel discovery (example: Jack dancing while holding the product). Lead with ONE striking visual idea that works with the sound off and is easy to share. Keep the product visible but never claim anything the verified facts do not support.',
  },
  info: {
    ko: '신뢰·정보형', en: 'Informational',
    brief: '확인된 사실로 보여주는 유용한 추천·시연·비교·리스트. 예: "잘 산 쿠팡템 3가지".',
    goal: '팔로우·저장·공유',
    rule: 'INFORMATIONAL: a useful product recommendation, verified demonstration, comparison or list (example: "잘 산 쿠팡템 3가지"). Primary goal: follows, saves and shares. State ONLY facts from VERIFIED_PRODUCT_FACTS; never invent facts, rankings or comparisons about this or any other product. If the format is a list or comparison, items other than this product must be left as neutral placeholders for the operator to fill in. Jack and Diane may still present it in character.',
  },
};
const ORDER = ['drama', 'viral', 'info'];
const ALL = 'all';
const MIN_COUNT = 1;
const MAX_COUNT = 5;
const ALL_COUNT = 3;

const options = () => [
  ...ORDER.map((k) => ({ key: k, ko: CATEGORIES[k].ko, en: CATEGORIES[k].en, brief: CATEGORIES[k].brief, goal: CATEGORIES[k].goal, minCount: MIN_COUNT, maxCount: MAX_COUNT, defaultCount: 1 })),
  { key: ALL, ko: '모두 1개씩 만들기', en: 'One of Each', brief: '반전형 생활 개그 · 바이럴형 · 신뢰·정보형을 정확히 1개씩, 총 3개를 만듭니다.', goal: '세 가지 방향 비교', minCount: ALL_COUNT, maxCount: ALL_COUNT, defaultCount: ALL_COUNT, fixedCount: true },
];

/**
 * Validates a generation request and returns { category, count, plan } where plan lists the category of every concept to generate.
 * category is REQUIRED. 1–5 for a single category (default 1); "all" is always exactly 3 (a different count is refused, not silently changed).
 */
function resolveRequest({ category, count } = {}) {
  if (category == null || category === '') throw new StudioError('CATEGORY_REQUIRED', '스토리 카테고리를 선택하세요.', { status: 422, recovery: '반전형 생활 개그 / 바이럴형 / 신뢰·정보형 / 모두 1개씩 중 하나를 고르세요.' });
  if (category !== ALL && !CATEGORIES[category]) throw new StudioError('INVALID_CATEGORY', '알 수 없는 스토리 카테고리입니다: ' + category, { status: 422 });
  if (category === ALL) {
    if (count != null && count !== '' && Number(count) !== ALL_COUNT) throw new StudioError('INVALID_COUNT', '"모두 1개씩 만들기"는 항상 3개입니다 (요청: ' + count + '개).', { status: 422 });
    return { category, count: ALL_COUNT, plan: ORDER.slice() };
  }
  const n = count == null || count === '' ? 1 : Number(count);
  if (!Number.isInteger(n) || n < MIN_COUNT || n > MAX_COUNT) throw new StudioError('INVALID_COUNT', `컨셉 수는 ${MIN_COUNT}~${MAX_COUNT}개의 정수여야 합니다 (요청: ${count}).`, { status: 422 });
  return { category, count: n, plan: Array(n).fill(category) };
}

const tally = (list) => list.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {});
const planText = (plan) => ORDER.map((k) => ({ k, n: plan.filter((x) => x === k).length })).filter((x) => x.n).map((x) => `${CATEGORIES[x.k].ko} ${x.n}개`).join(' · ');

module.exports = { CATEGORIES, ORDER, ALL, MIN_COUNT, MAX_COUNT, ALL_COUNT, options, resolveRequest, tally, planText };
