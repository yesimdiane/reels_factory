// Image-First Reels Production v2 automated tests:
// 1. Reference images uploaded through dashboard
// 2. Gemini plans scenes S1-S5 from approved script + product photos
// 3. gemini-2.5-flash-image generates 9:16 storyboard images with actual reference bytes
// 4. Saved to Drive and stored in '장면 이미지(JSON)'
// 5. Scene-by-scene approval, revision requests, and regeneration
// 6. Invalidation of dependent video approvals when an approved image changes
// 7. Motion prompts and download URLs for manual Google Flow generation
// 8. Preservation of media rights, script approval gates, clip review, and rendering
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv, prd001Row } = require('./helpers/apps-script-mock');

const plain = (v) => JSON.parse(JSON.stringify(v));

function setupFixture({ images = 1, planFor } = {}) {
  let env;
  const planCalls = [];
  const imageCalls = [];

  env = createEnv({
    autoSelectHook: true,
    gemini: (n, body) => {
      const isImg = body.generationConfig &&
        Array.isArray(body.generationConfig.responseModalities) &&
        body.generationConfig.responseModalities.includes('IMAGE');
      if (isImg) {
        imageCalls.push(body);
        return {
          inlineData: {
            mimeType: 'image/png',
            data: Buffer.from('mock-gemini-image-bytes-scene-' + imageCalls.length).toString('base64'),
          },
        };
      }
      const isPlan = body.generationConfig &&
        body.generationConfig.responseSchema &&
        body.generationConfig.responseSchema.properties &&
        body.generationConfig.responseSchema.properties.product_visual;
      if (isPlan) {
        planCalls.push(body);
        return planFor ? planFor(planCalls.length, body) : plain(env.gs('FIXTURE_PRD_001_PRODUCTION_PLAN_RESPONSE'));
      }
      return plain(env.gs('FIXTURE_PRD_001_GEMINI_RESPONSE'));
    },
  });

  env.sheets.PRODUCTS.rows.push(prd001Row(env.gs, { permission: '자체 제작', affiliateUrl: 'https://link.coupang.com/a/x' }));
  const imageIds = [];
  for (let i = 0; i < images; i++) {
    imageIds.push(env.drive.addImage('product-ref-' + (i + 1) + '.png'));
  }
  env.sheets.PRODUCTS.rows[0].push('검증된 제품 이미지');
  env.sheets.PRODUCTS.rows[1].push(imageIds.map((id) => 'https://drive.google.com/file/d/' + id + '/view').join('\n'));

  env.gs('setupSheets()');

  const call = (fn, ...a) => plain(env.gs(fn).apply(null, a));
  const detail = (id = 'PRD-001-R01') => call('apiGetReel', id).detail;
  const act = (name, input = {}, id = 'PRD-001-R01') => {
    const d = detail(id);
    return call('apiAction', id, name, Object.assign({ expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion, expectedVideoVersion: d.summary.videoVersion }, input));
  };
  const row = (rowNum = 2) => env.sheets.REELS.record(rowNum);
  const audit = () => env.sheets.AUDIT.rows.slice(1).map((r) => r[env.sheets.AUDIT.rows[0].indexOf('작업')]);

  return { env, call, detail, act, row, audit, planCalls, imageCalls, imageIds };
}

function approveScript(s, id = 'PRD-001-R01') {
  assert.equal(s.call('apiGenerateScripts', 'PRD-001').ok, true);
  const r = s.act('APPROVE_SCRIPT', {}, id);
  assert.equal(r.ok, true, r.error);
  return s;
}

test('storyboard images gate: refused before SCRIPT_APPROVED or with tampered script', () => {
  const s = setupFixture();
  s.call('apiGenerateScripts', 'PRD-001');

  // 1. Before script approval
  const resBefore = s.call('apiGenerateStoryboardImages', 'PRD-001-R01', {});
  assert.equal(resBefore.ok, false);
  assert.match(resBefore.error, /대본 승인 후에만/);
  assert.equal(s.imageCalls.length, 0, 'No image generation API call before approval');

  // 2. Approve script
  const r = s.act('APPROVE_SCRIPT');
  assert.equal(r.ok, true);

  // 3. Tampering script in the sheet blocks storyboard image generation
  s.env.sheets.REELS.set(2, '후킹', '위조된 후킹 문장');
  const resTampered = s.call('apiGenerateStoryboardImages', 'PRD-001-R01', {});
  assert.equal(resTampered.ok, false);
  assert.match(resTampered.error, /승인된 대본과 현재 대본이 다릅니다/);
  assert.equal(s.imageCalls.length, 0);
});

test('reference images gate: refused before verified product reference photos exist in PRODUCTS', () => {
  const s = setupFixture({ images: 0 });
  // clear reference images from product
  s.env.sheets.PRODUCTS.rows[1][s.env.sheets.PRODUCTS.rows[0].indexOf('검증된 제품 이미지')] = '';
  approveScript(s);

  const res = s.call('apiGenerateStoryboardImages', 'PRD-001-R01', {});
  assert.equal(res.ok, false);
  assert.match(res.error, /검증된 제품 이미지가 없습니다/);
  assert.equal(s.imageCalls.length, 0, 'Zero paid calls without reference photos');
});

test('reference image upload via dashboard: media rights confirmed, saved to Drive, linked to PRODUCTS', () => {
  const s = setupFixture({ images: 0 });
  s.env.sheets.PRODUCTS.rows[1][s.env.sheets.PRODUCTS.rows[0].indexOf('검증된 제품 이미지')] = '';

  // 1. Upload without rights confirmed -> refused
  const noRights = s.call('apiUploadReferencePhoto', 'PRD-001', {
    data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64'),
    rightsConfirmed: false,
  });
  assert.equal(noRights.ok, false);
  assert.match(noRights.error, /권리/);

  // 2. Upload with rights confirmed -> saved
  const pngHeader = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const okUpload = s.call('apiUploadReferencePhoto', 'PRD-001', {
    data: Buffer.from(pngHeader.concat(new Array(100).fill(1))).toString('base64'),
    rightsConfirmed: true,
  });
  assert.equal(okUpload.ok, true, okUpload.error);
  assert.equal(okUpload.reference.count, 1);

  // Check product cell
  const col = s.env.sheets.PRODUCTS.rows[0].indexOf('검증된 제품 이미지');
  assert.ok(s.env.sheets.PRODUCTS.rows[1][col].includes('https://drive.google.com/file/d/'));
});

test('gemini-2.5-flash-image generates 9:16 storyboard images with actual reference bytes and stores in Drive', () => {
  const s = approveScript(setupFixture({ images: 2 }));
  // create production plan
  s.call('apiCreateProductionPlan', 'PRD-001-R01', {});

  // Generate all storyboard images (scenes S1–S6 for PRD-001 fixture)
  const res = s.call('apiGenerateStoryboardImages', 'PRD-001-R01', {});
  assert.equal(res.ok, true, res.error);
  assert.equal(s.imageCalls.length, 6, 'Generated images for all approved scenes');

  // Inspect the first Gemini image call
  const call1 = s.imageCalls[0];
  assert.equal(call1.generationConfig.imageConfig.aspectRatio, '9:16', '9:16 portrait aspect ratio specified');
  assert.deepEqual(call1.generationConfig.responseModalities, ['TEXT', 'IMAGE']);

  // Actual reference image bytes included in the request
  const inlineParts = call1.contents[0].parts.filter((p) => p.inlineData);
  assert.equal(inlineParts.length, 2, 'Actual reference image bytes passed inline to Gemini');
  assert.ok(inlineParts[0].inlineData.data.length > 0);

  // Prompt includes photorealistic, 9:16, product name and no-text rules
  const promptText = call1.contents[0].parts[0].text;
  assert.match(promptText, /9:16/);
  assert.match(promptText, /photorealistic/);
  assert.match(promptText, /NO on-screen text/);

  // Check Drive files created
  const files = Object.values(s.env.drive.nodes).filter((n) => n.kind === 'file' && n.name && n.name.startsWith('S1_v1'));
  assert.equal(files.length, 1);

  // Check stored metadata in '장면 이미지(JSON)'
  const rawStore = s.row()['장면 이미지(JSON)'];
  assert.ok(rawStore, 'Store written to sheet');
  const store = JSON.parse(rawStore);
  assert.ok(store.images.S1);
  assert.equal(store.images.S1.current, 1);
  assert.equal(store.images.S1.versions[0].status, 'PENDING_REVIEW');
  assert.equal(store.images.S1.versions[0].mime, 'image/png');
  assert.ok(store.images.S1.versions[0].motionPrompt.includes('Google Flow Image-to-Video'));

  // Dashboard detail view
  const d = s.detail();
  assert.equal(d.storyboard.visible, true);
  assert.equal(d.storyboard.images.length, 6);
  assert.equal(d.storyboard.approvedCount, 0);
  assert.equal(d.storyboard.totalCount, 6);
  assert.equal(d.storyboard.images[0].status, 'PENDING_REVIEW');
  assert.ok(d.storyboard.images[0].current.downloadUrl.includes('drive.google.com'));
});

test('scene-by-scene approval, revision requests, and regeneration with revision feedback', () => {
  const s = approveScript(setupFixture({ images: 1 }));
  s.call('apiGenerateStoryboardImages', 'PRD-001-R01', { scene: 1 });

  let d = s.detail();
  assert.equal(d.storyboard.images[0].status, 'PENDING_REVIEW');

  // 1. Scene approval
  const approveRes = s.call('apiReviewStoryboardImage', 'PRD-001-R01', {
    scene: 1,
    version: 1,
    decision: 'APPROVE',
  });
  assert.equal(approveRes.ok, true, approveRes.error);
  d = s.detail();
  assert.equal(d.storyboard.images[0].status, 'APPROVED');
  assert.equal(d.storyboard.images[0].current.reviewedBy, 'owner@example.com');
  assert.ok(s.audit().includes('STORYBOARD_IMAGE_APPROVED'));

  // 2. Revision request (rejects with required note)
  const rejectNoNote = s.call('apiReviewStoryboardImage', 'PRD-001-R01', {
    scene: 1,
    version: 1,
    decision: 'REJECT',
    note: '',
  });
  assert.equal(rejectNoNote.ok, false);
  assert.match(rejectNoNote.error, /이유/);

  const rejectOk = s.call('apiReviewStoryboardImage', 'PRD-001-R01', {
    scene: 1,
    version: 1,
    decision: 'REJECT',
    note: '현관문 자석 부착 부위를 더 클로즈업해 주세요',
  });
  assert.equal(rejectOk.ok, true, rejectOk.error);
  d = s.detail();
  assert.equal(d.storyboard.images[0].status, 'REJECTED');
  assert.equal(d.storyboard.images[0].current.note, '현관문 자석 부착 부위를 더 클로즈업해 주세요');
  assert.ok(s.audit().includes('STORYBOARD_IMAGE_REJECTED'));

  // 3. Regeneration incorporating revision feedback
  const regenRes = s.call('apiRegenerateStoryboardImage', 'PRD-001-R01', {
    scene: 1,
  });
  assert.equal(regenRes.ok, true, regenRes.error);
  d = s.detail();
  assert.equal(d.storyboard.images[0].status, 'PENDING_REVIEW');
  assert.equal(d.storyboard.images[0].current.v, 2);
  assert.equal(d.storyboard.images[0].versions.length, 2);
  assert.equal(d.storyboard.images[0].versions[0].status, 'REJECTED');

  // Check that the revision note was passed to Gemini prompt
  const lastImgCall = s.imageCalls[s.imageCalls.length - 1];
  assert.match(lastImgCall.contents[0].parts[0].text, /현관문 자석 부착 부위를 더 클로즈업해 주세요/);
});

test('Requirement 6: invalidates dependent video approvals when an approved storyboard image changes', () => {
  const s = approveScript(setupFixture({ images: 1 }));
  s.call('apiCreateProductionPlan', 'PRD-001-R01', {});

  // 1. Generate and approve storyboard image for S1
  s.call('apiGenerateStoryboardImages', 'PRD-001-R01', { scene: 1 });
  const appImg = s.call('apiReviewStoryboardImage', 'PRD-001-R01', { scene: 1, version: 1, decision: 'APPROVE' });
  assert.equal(appImg.ok, true);

  // 2. Start video production and simulate video clip upload and review for S1
  s.act('START_VIDEO');
  assert.equal(s.detail().summary.status, 'VIDEO_IN_PRODUCTION');

  // Simulate S1 clip registered and approved
  const reelFolder = s.env.drive.folderByPath('Reels Factory', 'PRD-001', 'PRD-001-R01');
  const s1ClipFile = s.env.drive.addFile(reelFolder.id, 'S1_v1.mp4', Buffer.alloc(20000, 'mock-clip-bytes'), 'video/mp4');
  let dCur = s.detail();
  const attachRes = s.call('apiAttachDriveClip', 'PRD-001-R01', { clip: 'S1', fileId: s1ClipFile, rightsConfirmed: true, expectedStatus: dCur.summary.status, expectedScriptVersion: dCur.summary.scriptVersion });
  assert.equal(attachRes.ok, true, attachRes.error);
  dCur = s.detail();
  const appClip = s.call('apiReviewClip', 'PRD-001-R01', { clip: 'S1', version: 1, decision: 'APPROVE', expectedStatus: dCur.summary.status, expectedScriptVersion: dCur.summary.scriptVersion });
  assert.equal(appClip.ok, true, appClip.error);
  assert.equal(s.detail().media.clips.find((c) => c.key === 'S1').status, 'APPROVED');

  // 3. Complete and approve finished video
  const vidFile = s.env.drive.addFile('', 'final.mp4', [4, 5, 6], 'video/mp4');
  s.act('REGISTER_VIDEO', { videoUrl: 'https://drive.google.com/file/d/' + vidFile + '/view' });
  assert.equal(s.detail().summary.status, 'VIDEO_REVIEW_PENDING');
  s.act('APPROVE_VIDEO');
  // It enters READY_TO_PUBLISH (because affiliateUrl is valid) or VIDEO_APPROVED
  const approvedStatus = s.detail().summary.status;
  assert.ok(approvedStatus === 'READY_TO_PUBLISH' || approvedStatus === 'VIDEO_APPROVED');

  // 4. NOW: Change the approved storyboard image for S1 (e.g. regenerate or request revision)
  const regenImg = s.call('apiRegenerateStoryboardImage', 'PRD-001-R01', { scene: 1, note: '배경 색감 수정' });
  assert.equal(regenImg.ok, true);

  // 5. ASSERT: Dependent video approvals are invalidated!
  const dAfter = s.detail();

  // (a) Reel status reverted to VIDEO_IN_PRODUCTION
  assert.equal(dAfter.summary.status, 'VIDEO_IN_PRODUCTION');
  assert.match(dAfter.summary.error, /S1 스토리보드 이미지가 변경되었습니다/);

  // (b) S1 clip approval invalidated (superseded)
  const s1ClipAfter = dAfter.media.clips.find((c) => c.key === 'S1');
  assert.notEqual(s1ClipAfter.status, 'APPROVED', 'Clip approval was invalidated');

  // (c) Audit log recorded invalidations
  const auditList = s.audit();
  assert.ok(auditList.includes('VIDEO_APPROVAL_INVALIDATED'));
  assert.ok(auditList.includes('CLIP_APPROVAL_INVALIDATED'));
});

test('Requirement 7: provides motion prompts and direct download URLs for manual Flow handoff', () => {
  const s = approveScript(setupFixture({ images: 1 }));
  s.call('apiCreateProductionPlan', 'PRD-001-R01', {});
  s.call('apiGenerateStoryboardImages', 'PRD-001-R01', { scene: 1 });

  const d = s.detail();
  const s1 = d.storyboard.images[0];
  assert.equal(s1.key, 'S1');
  assert.ok(s1.current.downloadUrl.includes('drive.google.com/uc?export=download&id='));
  assert.ok(s1.current.previewUrl.includes('/preview'));
  assert.ok(s1.motionPrompt.includes('Google Flow Image-to-Video'));
  assert.ok(s1.motionPrompt.includes('START FRAME'));
  assert.ok(s1.motionPrompt.includes('CAMERA MOTION'));
  assert.ok(s1.motionPrompt.includes('ACTION PROGRESSION'));
  assert.equal(d.storyboard.flowUrl, 'https://flow.google');
});
