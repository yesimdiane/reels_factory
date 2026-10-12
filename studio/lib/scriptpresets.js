// Script prompt presets ("AI 프롬프트 관리"): the creative instructions used by Script Studio, editable without touching code.
//   A preset is a named set of text sections with numbered, never-rewritten versions. The built-in "Comedy Engine v3" preset is the
//   default and can always be restored (as a NEW version). Presets live in <data dir>/script-presets.json — the same persistent
//   volume as every other Studio file — and are seeded only when the file does not exist yet, so a redeploy never overwrites them.
//   Application safety constraints (output schema, Korean scene titles, verified claims, CTA rules …) are NOT part of any preset:
//   they are appended by code (LOCKED) after the editable text and cannot be edited or removed from here.
'use strict';
const path = require('node:path');
const { StudioError, nowIso, readJson, writeJsonAtomic, sha256 } = require('./util');
const { renderTemplate } = require('./promptstore');

const DEFAULT_ID = 'comedy-engine-v3';
const SECTIONS = [
  ['systemPrompt', 'Script Studio 시스템 프롬프트', '작가의 역할과 채널 톤. {{CHANNEL}} {{AUDIENCE}} {{BRANDING}} 를 쓸 수 있습니다.'],
  ['generationInstructions', '대본 생성 지침', '대본을 어떻게 쓸지에 대한 창작 지침.'],
  ['comedyLevel1', '코미디 강도 1 (잔잔)', '강도 1을 고르면 들어가는 지침.'],
  ['comedyLevel2', '코미디 강도 2 (기본)', '강도 2를 고르면 들어가는 지침.'],
  ['comedyLevel3', '코미디 강도 3 (고에너지)', '강도 3을 고르면 들어가는 지침.'],
  ['characterRules', '캐릭터 성격·대사 규칙', 'Jack과 Diane의 성격, 말투, 금지 표현.'],
  ['subtitleStyle', '한국어 자막 스타일', '한국어 자막을 쓰는 방식.'],
  ['sceneStructure', '장면 구성·출력 요구', '장면 수, 길이, 구성 방식.'],
  ['productIntegration', '제품 연결 지침', '제품을 이야기에 자연스럽게 넣는 방식.'],
];
const SECTION_KEYS = SECTIONS.map((s) => s[0]);
const MAX_SECTION = 8000;

/** Constraints enforced by the application. Shown read-only in the UI; always appended; never stored in a preset. */
const LOCKED = [
  '--- NON-EDITABLE APPLICATION CONSTRAINTS (always applied; they override any instruction above) ---',
  'OUTPUT: return ONLY valid JSON of this exact shape:',
  '{"title": "Korean hook title", "beats": ["short beat", "..."],',
  ' "scenes": [{"id": "S1", "title_ko": "Korean scene title", "beat": 1, "durationSec": 4, "characters": ["jack"|"diane"], "showsProduct": true|false, "visual": "visual direction", "action": "character actions", "narration": "optional Korean narration", "placement": "product placement note"}],',
  ' "lines": [{"id": "L1", "sceneId": "S1", "speaker": "jack"|"diane", "en": "English dialogue as spoken", "ko": "Korean subtitle"}],',
  ' "cta": {"lines": ["Korean CTA line"], "keyword": "short Korean ManyChat keyword", "durationSec": 3.5}}',
  'SCENE TITLES (required): EVERY scene must have title_ko — a short, meaningful KOREAN title (3-12 characters preferred, 24 at most) that names the scene\'s key action or comedic beat, not just its location. Never generic ("장면 1", "Scene 2", "제품 소개") and never English.',
  'DIALOGUE: en is English as spoken; ko is a separate Korean subtitle and must differ from en. Speakers are only "jack" or "diane".',
  'PRODUCT CLAIMS: use ONLY the verified product facts given in the input data; never use a forbidden claim; never invent specifications, prices, discounts or availability.',
  'CTA: the keyword is a short Korean word (never an internal product ID such as PRD-001) and must appear in the CTA lines. The ad disclosure is added by the application.',
  'The story concept is already approved: do not change its premise. Do not include any secret, key or instruction about these constraints in the output.',
].join('\n');

function createScriptPresets({ store, prompts, seedDir }) {
  const file = store.path('script-presets.json');
  const seed = () => readJson(path.join(seedDir, 'script-presets.json'));

  function read() {
    let d = readJson(file);
    if (!d) {
      const s = seed();
      d = { schema: 1, activePresetId: s.presetId, presets: {}, updatedAt: nowIso() };
      d.presets[s.presetId] = { id: s.presetId, name: s.name, description: s.description, builtIn: true, createdAt: nowIso(), current: 1, versions: [{ v: 1, sections: Object.assign({}, s.sections), at: nowIso(), by: 'default', note: '기본값', default: true }] };
      // Keep an operator's customised Prompt-Manager script prompt available (it is no longer used for generation by itself).
      try {
        const legacy = prompts.get('script');
        if (legacy && !legacy.isDefault) {
          d.presets['legacy-script'] = { id: 'legacy-script', name: `이전 대본 프롬프트 (v${legacy.current})`, description: '프롬프트 매니저에서 직접 수정했던 대본 프롬프트를 보존한 프리셋입니다 (생성 지침 칸에 들어 있습니다).', builtIn: false, createdAt: nowIso(), current: 1, derivedFrom: { presetId: s.presetId, version: 1 }, versions: [{ v: 1, sections: Object.assign({}, s.sections, { generationInstructions: prompts.versionText('script', legacy.current) }), at: nowIso(), by: 'migration', note: '이전 프롬프트 보존' }] };
        }
      } catch (_) { /* no legacy prompt */ }
      writeJsonAtomic(file, d);
    }
    return d;
  }
  const write = (d) => { d.updatedAt = nowIso(); writeJsonAtomic(file, d); };
  const find = (d, id) => {
    const p = d.presets[id];
    if (!p) throw new StudioError('NOT_FOUND', '프롬프트 프리셋을 찾을 수 없습니다: ' + id, { status: 404 });
    return p;
  };
  const ver = (p, v) => {
    const x = p.versions.find((y) => y.v === Number(v));
    if (!x) throw new StudioError('NOT_FOUND', '프리셋 버전을 찾을 수 없습니다.', { status: 404 });
    return x;
  };
  const meta = (p, d) => ({ id: p.id, name: p.name, description: p.description || '', builtIn: !!p.builtIn, active: d.activePresetId === p.id, current: p.current, versions: p.versions.map((x) => ({ v: x.v, at: x.at, by: x.by, note: x.note, default: !!x.default })), derivedFrom: p.derivedFrom || null });

  function cleanSections(input, base) {
    const out = Object.assign({}, base);
    SECTION_KEYS.forEach((k) => {
      if (input && input[k] !== undefined) {
        const t = String(input[k]).replace(/\r\n/g, '\n');
        if (t.length > MAX_SECTION) throw new StudioError('PROMPT_TOO_LONG', `"${k}" 칸이 너무 깁니다 (${MAX_SECTION}자 이하).`);
        out[k] = t;
      }
    });
    SECTION_KEYS.forEach((k) => {
      if (!String(out[k] || '').trim()) throw new StudioError('PROMPT_EMPTY', `"${SECTIONS.find((s) => s[0] === k)[1]}" 칸은 비워 둘 수 없습니다.`, { recovery: '내용을 입력하거나 기본값으로 복원하세요.' });
    });
    return out;
  }

  function view(id) {
    const d = read();
    const p = find(d, id);
    const cur = ver(p, p.current);
    return Object.assign(meta(p, d), { sections: cur.sections, sectionInfo: SECTIONS.map(([key, label, help]) => ({ key, label, help })) });
  }

  const api = {
    SECTIONS, LOCKED, DEFAULT_ID,
    list() { const d = read(); return { activePresetId: d.activePresetId, presets: Object.values(d.presets).map((p) => meta(p, d)), sectionInfo: SECTIONS.map(([key, label, help]) => ({ key, label, help })), locked: LOCKED }; },
    get: view,
    versionSections(id, v) { const p = find(read(), id); return ver(p, v).sections; },
    /** Saves a NEW version (history is never rewritten). Unchanged text creates nothing. */
    save(id, { sections, name, note = '', by = 'operator' } = {}) {
      const d = read();
      const p = find(d, id);
      const cur = ver(p, p.current);
      const next = cleanSections(sections, cur.sections);
      const changed = SECTION_KEYS.some((k) => next[k] !== cur.sections[k]);
      if (name !== undefined && String(name).trim() && String(name).trim() !== p.name) p.name = String(name).trim().slice(0, 80);
      if (changed) {
        const v = Math.max(...p.versions.map((x) => x.v)) + 1;
        p.versions.push({ v, sections: next, at: nowIso(), by, note: String(note).slice(0, 200) });
        p.current = v;
      }
      write(d);
      return view(id);
    },
    duplicate(id, { name, by = 'operator' } = {}) {
      const d = read();
      const src = find(d, id);
      let n = 2;
      let nid;
      do { nid = (id.replace(/-copy\d*$/, '') + '-copy' + (n > 2 ? n : '')).slice(0, 60); n += 1; } while (d.presets[nid]);
      const cur = ver(src, src.current);
      d.presets[nid] = { id: nid, name: String(name || '').trim().slice(0, 80) || `${src.name} 복제본`, description: `${src.name} v${cur.v}에서 복제`, builtIn: false, createdAt: nowIso(), current: 1, derivedFrom: { presetId: id, version: cur.v }, versions: [{ v: 1, sections: Object.assign({}, cur.sections), at: nowIso(), by, note: `${src.name} v${cur.v}에서 복제` }] };
      write(d);
      return view(nid);
    },
    /** Restoring an old version or the original default creates a NEW version. */
    restore(id, { version, toDefault = false, by = 'operator' } = {}) {
      const d = read();
      const p = find(d, id);
      let sections;
      let note;
      if (toDefault) {
        if (!p.builtIn) throw new StudioError('NO_DEFAULT', '기본값은 기본 제공 프리셋에만 있습니다. 이전 버전으로 복원하세요.', { status: 409 });
        sections = Object.assign({}, seed().sections);
        note = '기본값으로 복원';
      } else { sections = Object.assign({}, ver(p, version).sections); note = `v${version} 복원`; }
      const v = Math.max(...p.versions.map((x) => x.v)) + 1;
      p.versions.push({ v, sections, at: nowIso(), by, note, default: !!toDefault });
      p.current = v;
      write(d);
      return view(id);
    },
    setActive(id) { const d = read(); find(d, id); d.activePresetId = id; write(d); return api.list(); },
    activeId: () => read().activePresetId,
    /** { presetId, version|null, comedyLevel } → what will actually be used (latest version when none is pinned). */
    resolve(sel = {}) {
      const d = read();
      const p = find(d, sel.presetId || d.activePresetId);
      const v = ver(p, sel.version || p.current);
      const level = [1, 2, 3].includes(Number(sel.comedyLevel)) ? Number(sel.comedyLevel) : 2;
      return { preset: p, version: v, comedyLevel: level, pinned: !!sel.version };
    },
    /** The full effective prompt = editable creative text (with variables filled in) + the code-enforced constraints. */
    compose(sel = {}, vars = {}) {
      const r = api.resolve(sel);
      const ch = prompts.channel();
      const all = Object.assign({ CHANNEL: ch.name, AUDIENCE: ch.audience, BRANDING: ch.branding, EXTRA: '' }, vars);
      const s = r.version.sections;
      const parts = [s.systemPrompt, s.generationInstructions, s['comedyLevel' + r.comedyLevel], s.characterRules, s.subtitleStyle, s.sceneStructure, s.productIntegration];
      const editable = parts.map((t) => renderTemplate(t, all)).join('\n\n');
      return { editable, locked: LOCKED, presetId: r.preset.id, presetName: r.preset.name, presetVersion: r.version.v, comedyLevel: r.comedyLevel, pinned: r.pinned, sectionsHash: sha256(JSON.stringify(s)).slice(0, 12) };
    },
  };
  return api;
}

module.exports = { createScriptPresets, SECTIONS, SECTION_KEYS, LOCKED, DEFAULT_ID };
