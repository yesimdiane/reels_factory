'use strict';
// MuAPI video-model contract. MuAPI documents the submit/poll protocol but each model endpoint takes its own JSON
// field names, so nothing here assumes two models share a request shape: every model declares its own field map.
// Verification levels (strongest last): 'unverified' (seed / catalog id only) < 'user-entered' (operator confirmed the
// endpoint and parameters in the MuAPI playground) < 'verified' (a real job on this endpoint completed).

const LEVELS = ['unverified', 'user-entered', 'verified'];
const LIVE_OK = ['user-entered', 'verified'];

/** Endpoint path relative to the fixed MuAPI base. No scheme, host, query, fragment, backslash, '//' or '..'. */
function validateEndpoint(raw) {
  const ep = String(raw == null ? '' : raw).trim().replace(/^\/(?!\/)/, '').replace(/^api\/v1\//, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9/_.-]{1,100}$/.test(ep) || ep.includes('..') || ep.includes('//') || /^[a-z][a-z0-9+.-]*:/i.test(ep)) return null;
  return ep;
}

const FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
function field(v, dflt) { const s = String(v == null || v === '' ? dflt : v).trim(); return FIELD.test(s) ? s : null; }

/** extraParams: flat JSON of scalar constants the model requires (e.g. {"mode":"std"}); never secrets, never nested. */
function cleanExtra(x) {
  if (x == null || x === '') return {};
  const o = typeof x === 'string' ? JSON.parse(x) : x;
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('extraParams must be a JSON object');
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (!FIELD.test(k)) throw new Error('bad extraParams key: ' + k);
    if (!['string', 'number', 'boolean'].includes(typeof v)) throw new Error('extraParams values must be string/number/boolean: ' + k);
    out[k] = typeof v === 'string' ? v.slice(0, 200) : v;
  }
  return out;
}

/** The request body for one submit. Field names come from the model; unset optional fields are simply not sent. */
function buildBody(model, { prompt, imageUrl, aspectRatio, duration, negativePrompt, extra = {} }) {
  const body = Object.assign({}, model.extraParams || {}, extra);
  body[model.promptField || 'prompt'] = prompt;
  body[model.imageField || 'image_url'] = imageUrl;
  if (aspectRatio != null) body[model.aspectField || 'aspect_ratio'] = aspectRatio;
  if (duration != null) body[model.durationField || 'duration'] = duration;
  if (negativePrompt) body[model.negativeField || 'negative_prompt'] = negativePrompt;
  return body;
}

module.exports = { LEVELS, LIVE_OK, validateEndpoint, field, cleanExtra, buildBody };
