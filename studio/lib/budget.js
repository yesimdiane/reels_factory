// Cost estimation and spending limits. Prices are NEVER invented: Muapi publishes no price table, so a per-clip
// estimate is an operator-entered number (Settings). With an unknown estimate, live generation is blocked.
'use strict';
const { sha256, canonical, StudioError } = require('./util');

const round = (n) => Math.round(n * 1e6) / 1e6;

function modelById(models, id) {
  const m = models.find((x) => x.id === id);
  if (!m) throw new StudioError('MODEL', '알 수 없는 모델입니다: ' + id, { recovery: 'Settings에서 모델을 선택하세요.' });
  return m;
}

/** Smallest allowed clip length that covers the scene (never shorter than the scene). */
function clipSecFor(model, sceneSec) {
  const ds = (model.durations || []).slice().sort((a, b) => a - b);
  if (!ds.length) return Math.ceil(sceneSec);
  return ds.find((d) => d >= sceneSec - 1e-9) || ds[ds.length - 1];
}

function limitFor(ep, settings, cfg) {
  const v = ep.spendLimitUsd != null ? ep.spendLimitUsd : settings.reelSpendLimitUsd != null ? settings.reelSpendLimitUsd : cfg.reelSpendLimitUsd;
  return Number(v);
}

function spentUsd(ep) {
  return round((ep.spend || []).filter((s) => !s.mock).reduce((n, s) => n + (s.actualUsd != null ? s.actualUsd : s.estimatedUsd || 0), 0));
}

/** Content address of one generation: same inputs → same key → the cached clip is reused (no second charge). */
function jobKey({ model, prompt, negative, clipSec, aspectRatio, imageSha256 }) {
  return sha256(canonical({ m: model.id, e: model.endpoint, prompt, negative: negative || '', clipSec, aspectRatio, image: imageSha256 }));
}

/**
 * estimateRun: { items, totalUsd|null, unknown, spentUsd, limitUsd, remainingUsd, withinLimit }.
 * cached(sceneId) → true if a clip with the same job key already exists (free).
 */
function estimateRun({ ep, scenes, model, settings, cfg, cached = () => false }) {
  // Operator-entered estimate per clip length, e.g. { usdByDuration: { "5": 0.4, "10": 0.8 } }. Unset → unknown.
  const table = (settings.modelEstimates && settings.modelEstimates[model.id] && settings.modelEstimates[model.id].usdByDuration) || {};
  const priceFor = (sec) => (table[String(sec)] != null && table[String(sec)] !== '' && Number.isFinite(Number(table[String(sec)])) ? Number(table[String(sec)]) : null);
  const items = scenes.map((s) => {
    const clipSec = clipSecFor(model, s.durationSec);
    const isCached = cached(s.id);
    const price = priceFor(clipSec);
    return { sceneId: s.id, clipSec, cached: isCached, usd: isCached ? 0 : price != null ? round(price) : null };
  });
  const billable = items.filter((i) => !i.cached);
  const unknown = billable.some((i) => i.usd == null);
  const totalUsd = unknown ? null : round(billable.reduce((n, i) => n + i.usd, 0));
  const limitUsd = limitFor(ep, settings, cfg);
  const spent = spentUsd(ep);
  const remainingUsd = round(limitUsd - spent);
  return {
    modelId: model.id,
    items,
    billableClips: billable.length,
    totalUsd,
    unknown,
    priceTable: table,
    spentUsd: spent,
    limitUsd,
    remainingUsd,
    withinLimit: totalUsd == null ? null : totalUsd <= remainingUsd + 1e-9,
  };
}

module.exports = { modelById, clipSecFor, limitFor, spentUsd, jobKey, estimateRun, round };
