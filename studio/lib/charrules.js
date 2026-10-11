// Character-reference rules shared by the template builder, the Gemini prompt generator and the validators.
// A character reference "sheet" shows ONE person many times (expressions, outfits, poses, example panels).
// It is an identity guide, never a scene layout. These rules are appended by CODE to every prompt that uses a sheet,
// so they never depend on the model remembering them.
'use strict';

const SHEET_RULE = 'IMPORTANT CHARACTER REFERENCE RULE: The provided character sheet contains multiple depictions of the SAME individual for identity reference only. ' +
  'Generate exactly one instance of that character in the scene (never a duplicate, twin or crowd). ' +
  'Extract only the consistent identity (face shape, hairstyle, skin tone, body type, distinctive features, illustration style). ' +
  'Do NOT recreate the reference sheet, collage, expression grid, turnaround, panels, labels, Korean/English text, flags, colour swatches or speech bubbles. ' +
  'Do NOT combine different outfits, poses or expressions; take the outfit, action, expression and environment from the scene description only. ' +
  'Example comic panels on the sheet are not scene content.';

const IDENTITY = {
  jack: 'Jack (exactly ONE): British male, wavy light-brown hair, neatly groomed mustache, stocky solid build, distinctive tattoos on the arms when the arms are visible.',
  diane: 'Diane (exactly ONE): Korean female, long dark hair, expressive eyes, consistent facial proportions.',
};

/** Exact head-count instruction for the characters selected in the scene editor (and nobody else). */
function castDirective(characterIds, lib) {
  const ids = Array.from(new Set(characterIds || []));
  const names = (id) => {
    const c = lib && lib.characters.find((x) => x.id === id);
    return c ? c.name : id;
  };
  if (!ids.length) return 'CAST: No recurring characters in this scene. Do NOT introduce Diane or Jack, or anyone resembling them.';
  if (ids.length === 1) return `CAST: Exactly ONE person is a main character: ${names(ids[0])}. Do not add any other recurring character (the other one of Diane/Jack must not appear).`;
  return `CAST: Exactly ${ids.length === 2 ? 'TWO' : ids.length} people: ${ids.map((i) => 'one ' + names(i)).join(' and ')}. Do not duplicate either character and do not add anyone else.`;
}

function identityLines(characterIds, lib) {
  return (characterIds || []).map((id) => {
    const c = lib && lib.characters.find((x) => x.id === id);
    const base = IDENTITY[id] || (c ? `${c.name}: ${c.look}` : '');
    return c && c.look && !IDENTITY[id] ? `${c.name}: ${c.look}` : base;
  }).filter(Boolean);
}

/** Problems in a prompt that would break the cast / sheet rules. Returns [{code,message}]. */
function lintCast(text, scene, lib) {
  const t = String(text || '');
  const lower = t.toLowerCase();
  const sel = new Set(scene.characters || []);
  const out = [];
  (lib.characters || []).forEach((c) => {
    const mentioned = new RegExp('\\b' + c.name.toLowerCase() + '\\b').test(lower);
    // Only flag when the unselected character is described as present; the CAST line itself names them as absent.
    const body = lower.split('\n').filter((l) => !/^cast:/.test(l) && !/do not (introduce|add)|must not appear|never show/.test(l)).join('\n');
    if (!sel.has(c.id) && new RegExp('\\b' + c.name.toLowerCase() + '\\b').test(body)) out.push({ code: 'UNSELECTED_CHARACTER', message: `${c.name}는 이 장면에서 선택되지 않았는데 프롬프트에 등장합니다.` });
    if (new RegExp('(two|2|twin|duplicate|another|second)\\s+' + c.name.toLowerCase() + '\\b').test(lower)) out.push({ code: 'DUPLICATE_CHARACTER', message: `${c.name}가 두 명 이상 등장하도록 쓰여 있습니다.` });
    void mentioned;
  });
  if (/(character sheet|reference sheet|turnaround|expression grid|collage|color swatch|colour swatch)/.test(lower.replace(/important character reference rule:[\s\S]*?example comic panels on the sheet are not scene content\./i, '').replace(/^.*(do not|never|no)\b.*$/gim, ''))) {
    out.push({ code: 'SHEET_IN_SCENE', message: '레퍼런스 시트·콜라주·표정 그리드를 장면에 그리라는 표현이 있습니다.' });
  }
  return out;
}

module.exports = { SHEET_RULE, IDENTITY, castDirective, identityLines, lintCast };
