// AI start images for scenes: one 2D anime/webtoon first frame per scene, built from the scene's own description,
// the approved character references of the cast and (only when the scene shows the product) the approved product references.
//   * paid (image model) → needs the script to be APPROVED (backend gate), an explicit cost confirmation, and spend limits
//   * results are saved as UNAPPROVED start frames; the operator approves each one (same flow as uploaded frames)
//   * never overwrites an approved frame; earlier files are kept on disk; a scene that already has a generated frame is skipped unless forced
//   * every scene is saved before the next paid call, so a failure part-way keeps (and never re-bills) what was already made
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { StudioError, nowIso, sha256 } = require('./util');
const { isScriptApproved } = require('./episode');
const { castDirective, identityLines, SHEET_RULE } = require('./charrules');
const { sniffImage } = require('./extract');

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const MAX_PRODUCT_REFS = 3;

function createStartImages({ store, products, router, lib, charRefs, log = () => {} }) {
  const hasFrame = (s) => !!(s.startImage && s.startImage.type === 'upload');

  /** Which scenes would be generated, and why the others are skipped. Pure: nothing is billed or changed. */
  function plan(ep, sceneIds, { force = false } = {}) {
    const wanted = sceneIds && sceneIds.length ? ep.scenes.filter((s) => sceneIds.includes(s.id)) : ep.scenes;
    if (sceneIds && sceneIds.length && wanted.length !== new Set(sceneIds).size) throw new StudioError('NOT_FOUND', '존재하지 않는 장면이 포함되어 있습니다.', { status: 404 });
    const targets = [];
    const skipped = [];
    wanted.forEach((s) => {
      if (hasFrame(s) && s.startImage.approved) skipped.push({ sceneId: s.id, reason: '이미 승인된 시작 프레임이 있습니다 (먼저 승인을 취소해야 바꿀 수 있습니다).' });
      else if (hasFrame(s) && s.startImage.generated && !force) skipped.push({ sceneId: s.id, reason: '이미 AI로 만든 시작 프레임이 있습니다 (다시 만들려면 "다시 생성"을 선택하세요).' });
      else targets.push(s);
    });
    return { targets, skipped };
  }

  function gate(ep) {
    if (!isScriptApproved(ep)) throw new StudioError('SCRIPT_NOT_APPROVED', '대본이 승인되기 전에는 AI 시작 이미지를 만들 수 없습니다 (유료 생성).', { recovery: 'Script Studio에서 대본을 승인하세요.', status: 409 });
  }

  /** Inputs for one scene. Throws (before any paid call) when the cast has no approved, non-placeholder character reference. */
  function inputs(ep, scene) {
    const L = lib();
    const cast = scene.characters || [];
    // the ACTUAL approved image bytes of the characters in this scene (validated first; throws before any paid call)
    const ci = charRefs.inputsFor(ep, scene);
    const images = ci.images.slice();
    const used = ci.used;
    let productIds = [];
    if (scene.showsProduct && ep.productId && ep.productRefs && (ep.productRefs.imageIds || []).length) {
      const files = products.imageFiles(ep.productId, ep.productRefs.imageIds.slice(0, MAX_PRODUCT_REFS));
      files.forEach((f) => images.push({ label: 'APPROVED product reference (the product must match this exactly: shape, logo, colour, function):', mimeType: f.mimeType, data: fs.readFileSync(f.path).toString('base64') }));
      productIds = files.map((f) => f.id);
    }
    const facts = scene.showsProduct ? (ep.product.verifiedFeatures || []) : [];
    const prompt = [
      'Create ONE vertical 9:16 illustration: the FIRST FRAME of a short animated comedy scene, in a clean 2D anime / Korean webtoon style (ink outlines, flat cel shading, expressive faces).',
      `SCENE ${scene.id}: ${scene.title || ''}`,
      'VISUAL: ' + (scene.visual || '(not described)'),
      scene.action ? 'ACTION AT THE FIRST FRAME: ' + scene.action : '',
      castDirective(cast, L),
      ...identityLines(cast, L),
      ...ci.lines,
      cast.length ? SHEET_RULE : '',
      scene.showsProduct && productIds.length ? 'The product appears in this scene: draw it EXACTLY like the approved product reference(s). Never add features. Verified facts only: ' + (facts.join('; ') || 'none') : 'Do NOT show the product in this frame.',
      'No text, captions, subtitles, speech bubbles, logos or watermarks anywhere in the image.',
    ].filter(Boolean).join('\n');
    return { images, prompt, used, productIds };
  }

  function estimate(epId, sceneIds, opts = {}) {
    const ep = store.episodes.get(epId);
    const { targets, skipped } = plan(ep, sceneIds, opts);
    let usd = 0;
    let unknown = false;
    let est = null;
    const scenes = targets.map((s) => {
      const q = inputs(ep, s);
      est = router.estimate('imageGeneration', { inputChars: q.prompt.length, outputTokens: 1500, images: q.images.length });
      if (est.usd == null) unknown = true; else usd += est.usd;
      return { sceneId: s.id, images: q.images.length };
    });
    if (!est) return { count: 0, scenes, skipped, provider: router.routeFor('imageGeneration').provider, model: router.routeFor('imageGeneration').model, usd: 0, note: '만들 장면이 없습니다.' };
    return Object.assign({}, est, { usd: unknown ? null : Math.round(usd * 1e6) / 1e6, count: targets.length, scenes, skipped, note: `장면 ${targets.length}개 × 이미지 1장 (장면당 별도 호출). ` + (est.note || '') });
  }

  async function generate(epId, sceneIds, { confirm, force = false, by = 'operator' } = {}) {
    const ep0 = store.episodes.get(epId);
    gate(ep0);
    const { targets, skipped } = plan(ep0, sceneIds, { force });
    if (!targets.length) return { generated: [], skipped, failed: null };
    targets.forEach((s) => inputs(ep0, s)); // all pre-flight problems surface BEFORE the first paid call
    const generated = [];
    let failed = null;
    for (const scene of targets) {
      const ep = store.episodes.get(epId);
      gate(ep);
      const cur = ep.scenes.find((x) => x.id === scene.id);
      if (!cur || (hasFrame(cur) && cur.startImage.approved)) { skipped.push({ sceneId: scene.id, reason: '진행 중에 승인된 프레임이 생겨 건너뜁니다.' }); continue; }
      const q = inputs(ep, cur);
      let out;
      try {
        out = await router.runImage('imageGeneration', { prompt: q.prompt, images: q.images, confirm });
      } catch (e) {
        if (!generated.length) throw e;
        failed = { sceneId: scene.id, code: e.code || 'ERROR', message: e.message, recovery: e.recovery || '' };
        break;
      }
      try {
        const buf = Buffer.from(out.images[0].data, 'base64');
        const sn = sniffImage(buf);
        if (!sn) throw new StudioError('BAD_IMAGE', '이미지 모델이 올바른 이미지를 돌려주지 않았습니다.', { status: 502 });
        const hash = sha256(buf);
        const file = hash.slice(0, 12) + sn.ext;
        store.episodes.saveFile(epId, path.join('startframes', file), buf);
        await store.episodes.update(epId, (e) => {
          const s = e.scenes.find((x) => x.id === scene.id);
          s.startImage = { type: 'upload', file, sha256: hash, approved: false, generated: true, name: `AI 시작 프레임 ${scene.id}`, provider: out.provider, model: out.model, prompt: q.prompt, characterRefs: q.used, characterRefAssetIds: q.used.map((u) => u.assetId), productImageIds: q.productIds, createdAt: nowIso(), createdBy: by };
        });
        store.episodes.audit(epId, 'startimage.generated', { sceneId: scene.id, provider: out.provider, model: out.model, file });
        generated.push({ sceneId: scene.id, file });
      } catch (e) {
        failed = { sceneId: scene.id, code: e.code || 'ERROR', message: e.message, recovery: e.recovery || '' };
        break;
      }
    }
    return { generated, skipped, failed };
  }

  return { estimate, generate, plan };
}

module.exports = { createStartImages };
