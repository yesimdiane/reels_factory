// Reusable product-ending templates ("Jack & Diane — Coupang Ending v1" is the default and is applied to every new episode).
//   A template = the three fixed ending shots (shopping_excuse, product_demonstration, jack_reaction) with numbered, never-rewritten versions.
//   Only the CONTENT of those three shots is editable; the structure (exactly three shots, in this order) is fixed in code.
//   Product-specific words are placeholders ({{PRODUCT_NAME}}, {{USE_PHRASE}} …) filled per episode.
//   Persistence: <data dir>/ending-templates.json (the persistent volume); seeded only when the file does not exist.
'use strict';
const path = require('node:path');
const { StudioError, nowIso, readJson, writeJsonAtomic } = require('./util');
const { ENDING_KEYS } = require('./formula');
const { checkTitleKo } = require('./episode');

const DEFAULT_ID = 'jack-diane-coupang-ending-v1';
const VARS = [
  ['PRODUCT_NAME', '제품 이름 (영어 대사용)'], ['PRODUCT_NAME_KO', '제품 이름 (한국어 자막용)'],
  ['USE_PHRASE', '잭이 쓰기를 거부하는 것 (영어, 예: an umbrella)'], ['USE_PHRASE_KO', '잭이 쓰기를 거부하는 것 (한국어, 예: 우산을)'],
  ['DEMO_ACTION', '시연 동작 (영어 연출)'], ['DEMO_ACTION_KO', '시연 동작 (한국어 메모)'],
  ['DEMO_LINE_EN', '시연 컷 대사 (영어)'], ['DEMO_LINE_KO', '시연 컷 자막 (한국어)'],
];
const VAR_KEYS = VARS.map((v) => v[0]);
const CHARS = new Set(['jack', 'diane']);

/** Product-specific defaults used until the AI (or the operator) fills them in. Never invents product facts. */
function defaultVars(product = {}) {
  const name = String(product.name || 'the product').trim();
  return { PRODUCT_NAME: name, PRODUCT_NAME_KO: name, USE_PHRASE: 'it', USE_PHRASE_KO: '그걸', DEMO_ACTION: `Diane uses ${name} exactly as intended.`, DEMO_ACTION_KO: `${name}를 제대로 쓰는 모습`, DEMO_LINE_EN: 'Look how easy that is!', DEMO_LINE_KO: '봐, 이렇게 쉬워!' };
}
const fill = (text, vars) => String(text == null ? '' : text).replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null && String(vars[k]).trim() !== '' ? String(vars[k]) : m));

function createEndingTemplates({ store, seedDir }) {
  const file = store.path('ending-templates.json');
  const seed = () => readJson(path.join(seedDir, 'ending-templates.json'));
  function read() {
    let d = readJson(file);
    if (!d) {
      const s = seed();
      d = { schema: 1, activeTemplateId: s.templateId, templates: {}, updatedAt: nowIso() };
      d.templates[s.templateId] = { id: s.templateId, name: s.name, description: s.description, builtIn: true, createdAt: nowIso(), current: 1, versions: [{ v: 1, shots: JSON.parse(JSON.stringify(s.shots)), structureLocked: s.structureLocked !== false, at: nowIso(), by: 'default', note: '기본값', default: true }] };
      writeJsonAtomic(file, d);
    }
    return d;
  }
  const write = (d) => { d.updatedAt = nowIso(); writeJsonAtomic(file, d); };
  const find = (d, id) => { const t = d.templates[id]; if (!t) throw new StudioError('NOT_FOUND', '엔딩 템플릿을 찾을 수 없습니다: ' + id, { status: 404 }); return t; };
  const ver = (t, v) => { const x = t.versions.find((y) => y.v === Number(v)); if (!x) throw new StudioError('NOT_FOUND', '템플릿 버전을 찾을 수 없습니다.', { status: 404 }); return x; };
  const meta = (t, d) => ({ id: t.id, name: t.name, description: t.description || '', builtIn: !!t.builtIn, active: d.activeTemplateId === t.id, current: t.current, versions: t.versions.map((x) => ({ v: x.v, at: x.at, by: x.by, note: x.note, default: !!x.default })), derivedFrom: t.derivedFrom || null });

  /** Validates edited shots. The three keys and their order cannot change; content must be sound. */
  function cleanShots(input, base) {
    const out = {};
    ENDING_KEYS.forEach((k) => {
      const b = base[k];
      const i = (input && input[k]) || {};
      const sh = {
        title_ko: String(i.title_ko !== undefined ? i.title_ko : b.title_ko).trim(),
        story_en: String(i.story_en !== undefined ? i.story_en : b.story_en).trim().slice(0, 1500),
        visual: String(i.visual !== undefined ? i.visual : b.visual).trim().slice(0, 2000),
        action: String(i.action !== undefined ? i.action : b.action).trim().slice(0, 1500),
        durationSec: Number(i.durationSec !== undefined ? i.durationSec : b.durationSec),
        characters: (i.characters !== undefined ? i.characters : b.characters).map(String),
        showsProduct: i.showsProduct !== undefined ? !!i.showsProduct : !!b.showsProduct,
        lines: (i.lines !== undefined ? i.lines : b.lines).map((l) => ({ speaker: String(l.speaker || '').trim(), en: String(l.en || '').trim().slice(0, 600), ko: String(l.ko || '').trim().slice(0, 600) })),
      };
      const label = k;
      const tk = checkTitleKo(sh.title_ko);
      if (tk.errors.length) throw new StudioError('TEMPLATE_INVALID', `${label}: ${tk.errors[0]}`, { status: 422 });
      if (!(sh.durationSec >= 1 && sh.durationSec <= 15)) throw new StudioError('TEMPLATE_INVALID', `${label}: 길이는 1~15초여야 합니다.`, { status: 422 });
      if (!sh.characters.length || sh.characters.some((c) => !CHARS.has(c))) throw new StudioError('TEMPLATE_INVALID', `${label}: 등장 캐릭터는 jack 또는 diane이어야 합니다.`, { status: 422 });
      if (!sh.lines.length) throw new StudioError('TEMPLATE_INVALID', `${label}: 대사가 최소 한 줄 필요합니다.`, { status: 422 });
      sh.lines.forEach((l) => {
        if (!CHARS.has(l.speaker)) throw new StudioError('TEMPLATE_INVALID', `${label}: 알 수 없는 화자입니다 (${l.speaker}).`, { status: 422 });
        if (!l.en || !l.ko) throw new StudioError('TEMPLATE_INVALID', `${label}: 영어 대사와 한국어 자막이 모두 필요합니다.`, { status: 422 });
        if (/오빠/.test(l.en + l.ko) && l.speaker === 'diane') throw new StudioError('TEMPLATE_INVALID', `${label}: Diane은 Jack을 "오빠"라고 부르지 않습니다.`, { status: 422 });
      });
      out[k] = sh;
    });
    return out;
  }

  const view = (id) => { const d = read(); const t = find(d, id); const cur = ver(t, t.current); return Object.assign(meta(t, d), { shots: cur.shots, structureLocked: !!cur.structureLocked, vars: VARS.map(([key, label]) => ({ key, label })), keys: ENDING_KEYS }); };

  const api = {
    DEFAULT_ID, VARS, VAR_KEYS, defaultVars, fill,
    list() { const d = read(); return { activeTemplateId: d.activeTemplateId, templates: Object.values(d.templates).map((t) => meta(t, d)), vars: VARS.map(([key, label]) => ({ key, label })), keys: ENDING_KEYS }; },
    get: view,
    versionData(id, v) { const t = find(read(), id); const x = ver(t, v); return { shots: x.shots, structureLocked: !!x.structureLocked }; },
    activeId: () => read().activeTemplateId,
    save(id, { shots, structureLocked, name, note = '', by = 'operator' } = {}) {
      const d = read();
      const t = find(d, id);
      const cur = ver(t, t.current);
      const next = cleanShots(shots, cur.shots);
      const lock = structureLocked === undefined ? !!cur.structureLocked : !!structureLocked;
      const changed = lock !== !!cur.structureLocked || JSON.stringify(next) !== JSON.stringify(cur.shots);
      if (name !== undefined && String(name).trim() && String(name).trim() !== t.name) t.name = String(name).trim().slice(0, 80);
      if (changed) { const v = Math.max(...t.versions.map((x) => x.v)) + 1; t.versions.push({ v, shots: next, structureLocked: lock, at: nowIso(), by, note: String(note).slice(0, 200) }); t.current = v; }
      write(d);
      return view(id);
    },
    duplicate(id, { name, by = 'operator' } = {}) {
      const d = read();
      const src = find(d, id);
      let n = 2; let nid;
      do { nid = (id.replace(/-copy\d*$/, '') + '-copy' + (n > 2 ? n : '')).slice(0, 70); n += 1; } while (d.templates[nid]);
      const cur = ver(src, src.current);
      d.templates[nid] = { id: nid, name: String(name || '').trim().slice(0, 80) || `${src.name} 복제본`, description: `${src.name} v${cur.v}에서 복제`, builtIn: false, createdAt: nowIso(), current: 1, derivedFrom: { templateId: id, version: cur.v }, versions: [{ v: 1, shots: JSON.parse(JSON.stringify(cur.shots)), structureLocked: !!cur.structureLocked, at: nowIso(), by, note: `${src.name} v${cur.v}에서 복제` }] };
      write(d);
      return view(nid);
    },
    restore(id, { version, toDefault = false, by = 'operator' } = {}) {
      const d = read();
      const t = find(d, id);
      let shots; let lock; let note;
      if (toDefault) {
        if (!t.builtIn) throw new StudioError('NO_DEFAULT', '기본값은 기본 제공 템플릿에만 있습니다. 이전 버전으로 복원하세요.', { status: 409 });
        const s = seed(); shots = JSON.parse(JSON.stringify(s.shots)); lock = s.structureLocked !== false; note = '기본값으로 복원';
      } else { const x = ver(t, version); shots = JSON.parse(JSON.stringify(x.shots)); lock = !!x.structureLocked; note = `v${version} 복원`; }
      const v = Math.max(...t.versions.map((x) => x.v)) + 1;
      t.versions.push({ v, shots, structureLocked: lock, at: nowIso(), by, note, default: !!toDefault });
      t.current = v;
      write(d);
      return view(id);
    },
    setActive(id) { const d = read(); find(d, id); d.activeTemplateId = id; write(d); return api.list(); },
    /** The shots of a template version with product-specific vars filled in. Unfilled placeholders stay visible (never silently dropped). */
    resolve(sel = {}) { const d = read(); const t = find(d, sel.templateId || d.activeTemplateId); const x = ver(t, sel.version || t.current); return { template: t, version: x, pinned: !!sel.version }; },
    instantiate(sel, vars) {
      const r = api.resolve(sel);
      const shots = ENDING_KEYS.map((k) => {
        const s = r.version.shots[k];
        return { beatKey: k, title_ko: s.title_ko, story_en: fill(s.story_en, vars), visual: fill(s.visual, vars), action: fill(s.action, vars), durationSec: s.durationSec, characters: s.characters.slice(), showsProduct: !!s.showsProduct, lines: s.lines.map((l) => ({ speaker: l.speaker, en: fill(l.en, vars), ko: fill(l.ko, vars) })) };
      });
      return { shots, templateId: r.template.id, templateName: r.template.name, templateVersion: r.version.v, structureLocked: !!r.version.structureLocked };
    },
  };
  return api;
}

module.exports = { createEndingTemplates, DEFAULT_ID, VARS, VAR_KEYS, defaultVars, fill };
