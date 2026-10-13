// Paid animation generation, behind every gate.
//
//   estimate  (free, no network)  → what it would cost, what blocks it
//   authorize (free)              → the operator confirms the exact estimate; a short-lived authorization is stored
//   run       (BILLABLE in live)  → spends exactly the authorized scenes, once each
//   review                        → every generated clip waits for human approval (checksum-bound)
//
// Rules enforced here (tests cover each one):
//   * approved + unchanged script AND approved + unchanged storyboard are required
//   * a start image must be an approved reference (placeholders only work in mock mode)
//   * live mode needs a known price estimate and must fit the per-reel spending limit
//   * an authorization is bound to script/storyboard hashes, provider mode, model, scenes and expires
//   * identical inputs reuse the cached clip (no second charge)
//   * a failed or uncertain paid job is NEVER retried automatically; a new authorization is required
//   * "resume" only polls/downloads an already-submitted job (free)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { StudioError, uid, nowIso, sha256File, writeFileAtomic } = require('./util');
const { isScriptApproved, isStoryboardApproved, scriptFingerprint, storyboardFingerprint } = require('./episode');
const { modelById, clipSecFor, estimateRun, jobKey, spentUsd, limitFor, round } = require('./budget');
const { ProviderError } = require('./providers');
const { probe } = require('../../renderer/lib/ffmpeg');

const AUTH_TTL_MS = 30 * 60 * 1000;
const ACTIVE = new Set(['preparing', 'submitting', 'processing']);
const RECOVERABLE = new Set(['processing', 'polling_interrupted', 'download_failed']);

function createGenerationService({ store, provider, cfg, now = () => Date.now(), log = () => {}, composePrompt = (ep, sid, text) => text }) {
  const running = new Set();
  const lib = () => store.characters.load();

  function sceneOf(ep, id) {
    const s = (ep.scenes || []).find((x) => x.id === id);
    if (!s) throw new StudioError('NOT_FOUND', '장면을 찾을 수 없습니다: ' + id, { status: 404 });
    return s;
  }

  /** The image used as the image-to-video start frame, or { error }. */
  function startImage(ep, scene) {
    const si = scene.startImage;
    if (si && si.type === 'upload') {
      const file = store.episodes.file(ep.id, 'startframes', si.file);
      if (!fs.existsSync(file)) return { error: '시작 이미지 파일이 없습니다.' };
      return { file, sha256: si.sha256, approved: !!si.approved, placeholder: false, generated: !!si.generated, label: si.generated ? 'AI 생성 시작 프레임' : '업로드한 시작 프레임' };
    }
    const l = lib();
    let charId = si && si.characterId;
    let ref = null;
    if (si && si.refId) {
      const c = l.characters.find((x) => x.id === charId);
      ref = c && c.references.find((r) => r.id === si.refId);
    }
    if (!ref) {
      for (const cid of scene.characters || []) {
        const c = l.characters.find((x) => x.id === cid);
        const r = c && c.references.find((x) => x.approved);
        if (r) {
          charId = cid;
          ref = r;
          break;
        }
      }
    }
    if (!ref) return { error: `이 장면(${scene.id})에 쓸 승인된 캐릭터 참조 이미지가 없습니다.` };
    return { file: store.characters.refPath(charId, ref), sha256: ref.sha256, approved: !!ref.approved, placeholder: !!ref.placeholder, label: `${charId} · ${ref.label}`, characterId: charId, refId: ref.id };
  }

  function blockers(ep, scenes, model) {
    const out = [];
    const add = (code, message, recovery) => out.push({ code, message, recovery });
    if (!isScriptApproved(ep)) add('SCRIPT_NOT_APPROVED', '대본이 승인되지 않았거나 승인 후 수정되었습니다.', 'Script Studio에서 대본을 다시 확인하고 승인하세요.');
    if (!isStoryboardApproved(ep)) add('STORYBOARD_NOT_APPROVED', '스토리보드가 승인되지 않았거나 승인 후 수정되었습니다.', 'Storyboard에서 프롬프트를 확인하고 승인하세요.');
    scenes.forEach((s) => {
      const p = ep.prompts && ep.prompts[s.id];
      if (!p || !String(p.video || '').trim()) add('NO_PROMPT', `${s.id}: 영상 프롬프트가 없습니다.`, 'Storyboard에서 프롬프트를 만드세요.');
      const img = startImage(ep, s);
      if (img.error) add('NO_START_IMAGE', `${s.id}: ${img.error}`, 'Settings → 캐릭터 라이브러리에서 참조 이미지를 올리고 승인하세요.');
      else {
        const ref = img.refId ? (lib().characters.find((x) => x.id === img.characterId) || { references: [] }).references.find((r) => r.id === img.refId) : null;
        if (ref && ref.isSheet !== false) add('SHEET_AS_START_FRAME', `${s.id}: 캐릭터 시트(여러 그림이 있는 이미지)를 그대로 시작 프레임으로 쓸 수 없습니다. 결과 영상에 시트가 그대로 재현될 수 있습니다.`, '장면 구도의 시작 프레임을 올려 승인하거나, 단일 일러스트라면 설정 → 캐릭터 라이브러리에서 "단일 그림"으로 표시하세요.');
        if (!img.approved) add('START_IMAGE_NOT_APPROVED', `${s.id}: 시작 이미지가 승인되지 않았습니다.`, '캐릭터 라이브러리에서 이미지를 승인하세요.');
        if (img.placeholder && provider.mode === 'live') add('PLACEHOLDER_IMAGE', `${s.id}: 데모용 임시 이미지는 실제(유료) 생성에 쓸 수 없습니다.`, '실제 캐릭터 참조 이미지를 올리고 승인하세요.');
      }
    });
    if (provider.mode === 'live' && model.verification !== 'verified' && model.verification !== 'docs-example') add('MODEL_UNVERIFIED', '모델 엔드포인트가 확인되지 않았습니다.', 'Muapi 플레이그라운드에서 확인 후 모델 설정을 고치세요.');
    return out;
  }

  function cachedFor(ep, model) {
    return (sceneOrId) => {
      const scene = typeof sceneOrId === 'string' ? (ep.scenes || []).find((x) => x.id === sceneOrId) : sceneOrId;
      if (!scene) return false;
      const k = keyFor(ep, scene, model);
      return !!(k && fs.existsSync(store.cachePath('clips', k + '.mp4')));
    };
  }

  function keyFor(ep, scene, model) {
    const p = ep.prompts && ep.prompts[scene.id];
    const img = startImage(ep, scene);
    if (!p || img.error) return '';
    return jobKey({ model, prompt: composePrompt(ep, scene.id, p.video), negative: p.negative, clipSec: clipSecFor(model, scene.durationSec), aspectRatio: '9:16', imageSha256: img.sha256 });
  }

  function pickScenes(ep, sceneIds) {
    const ids = sceneIds && sceneIds.length ? sceneIds : (ep.scenes || []).map((s) => s.id);
    if (new Set(ids).size !== ids.length) throw new StudioError('DUPLICATE_SCENES', '같은 장면이 두 번 선택되었습니다.');
    return ids.map((id) => sceneOf(ep, id));
  }

  /** Free. Never touches the network. */
  function estimate(epId, { sceneIds, modelId } = {}) {
    const ep = store.episodes.get(epId);
    const settings = store.settings.get();
    const model = modelById(store.models(), modelId || settings.defaultModelId);
    const scenes = pickScenes(ep, sceneIds);
    const est = estimateRun({ ep, scenes, model, settings, cfg, cached: cachedFor(ep, model) });
    const b = blockers(ep, scenes, model);
    if (provider.mode === 'live' && est.unknown) b.push({ code: 'ESTIMATE_UNKNOWN', message: '이 모델의 클립당 가격 추정치가 없습니다. Muapi는 가격표를 공개하지 않습니다.', recovery: 'Muapi 플레이그라운드의 모델 페이지에 표시된 가격을 Settings → 비용에 입력하세요.' });
    if (est.withinLimit === false) b.push({ code: 'OVER_LIMIT', message: `예상 비용 $${est.totalUsd}이(가) 릴스 한도 남은 금액 $${est.remainingUsd}을(를) 넘습니다.`, recovery: 'Settings에서 릴스당 한도를 올리거나 장면 수를 줄이세요.' });
    return { mode: provider.mode, provider: provider.name, model: { id: model.id, label: model.label, verification: model.verification }, scenes: scenes.map((s) => s.id), ...est, blockers: b, canAuthorize: b.length === 0 };
  }

  /** Free. The operator must pass the exact estimate they saw. */
  async function authorize(epId, { sceneIds, modelId, confirmUsd, confirmUnknown = false, by = 'operator' } = {}) {
    const est = estimate(epId, { sceneIds, modelId });
    if (est.blockers.length) throw new StudioError('BLOCKED', est.blockers[0].message, { recovery: est.blockers[0].recovery, details: est.blockers, status: 409 });
    if (est.totalUsd == null) {
      if (!confirmUnknown) throw new StudioError('CONFIRM_REQUIRED', '비용 추정치가 없습니다. 목업 모드에서만 "추정치 없음"을 확인하고 진행할 수 있습니다.', { recovery: '목업 모드이거나 가격 추정치를 입력하세요.' });
      if (provider.mode === 'live') throw new StudioError('ESTIMATE_UNKNOWN', '실제 생성에는 가격 추정치가 필요합니다.');
    } else if (confirmUsd == null || Math.abs(Number(confirmUsd) - est.totalUsd) > 1e-6) {
      throw new StudioError('CONFIRM_MISMATCH', `확인한 금액($${confirmUsd})이 현재 예상 비용($${est.totalUsd})과 다릅니다. 화면을 새로고침해 다시 확인하세요.`, { status: 409 });
    }
    const a = {
      id: uid('auth'),
      sceneIds: est.scenes.slice(),
      modelId: est.model.id,
      mode: provider.mode,
      estimatedUsd: est.totalUsd,
      scriptHash: scriptFingerprint(store.episodes.get(epId)),
      storyboardHash: storyboardFingerprint(store.episodes.get(epId)),
      createdAt: new Date(now()).toISOString(),
      expiresAt: new Date(now() + AUTH_TTL_MS).toISOString(),
      by,
      consumed: [],
    };
    await store.episodes.update(epId, (ep) => {
      ep.generation.authorizations.push(a);
    });
    store.episodes.audit(epId, 'generation.authorized', { authorizationId: a.id, scenes: a.sceneIds, modelId: a.modelId, mode: a.mode, estimatedUsd: a.estimatedUsd, by });
    return a;
  }

  function checkAuthorization(ep, a, sceneId, model) {
    if (!a) throw new StudioError('NO_AUTH', '유효한 생성 승인이 없습니다.', { recovery: '비용을 확인하고 "생성 승인"을 누르세요.', status: 403 });
    if (a.mode !== provider.mode) throw new StudioError('AUTH_MODE', `이 승인은 ${a.mode} 모드용입니다. 현재는 ${provider.mode} 모드입니다.`, { recovery: '다시 승인하세요.', status: 403 });
    if (new Date(a.expiresAt).getTime() < now()) throw new StudioError('AUTH_EXPIRED', '생성 승인이 만료되었습니다 (30분).', { recovery: '다시 승인하세요.', status: 403 });
    if (!a.sceneIds.includes(sceneId)) throw new StudioError('AUTH_SCENE', `${sceneId}는 이 승인에 포함되지 않았습니다.`, { status: 403 });
    if (a.consumed.includes(sceneId)) throw new StudioError('AUTH_USED', `${sceneId}에 대한 승인은 이미 사용되었습니다. 다시 생성하려면 새로 승인하세요.`, { status: 403 });
    if (a.scriptHash !== scriptFingerprint(ep) || a.storyboardHash !== storyboardFingerprint(ep)) throw new StudioError('AUTH_STALE', '승인 후 대본/스토리보드가 바뀌었습니다.', { recovery: '다시 승인하세요.', status: 403 });
    if (a.modelId !== model.id) throw new StudioError('AUTH_MODEL', '승인된 모델과 다릅니다.', { status: 403 });
  }

  function setJob(epId, jobId, patch) {
    return store.episodes.update(epId, (ep) => {
      const j = ep.generation.jobs.find((x) => x.id === jobId);
      if (!j) throw new Error('job not found ' + jobId);
      Object.assign(j, patch, { updatedAt: nowIso() });
    });
  }

  function errInfo(e) {
    const recovery = {
      AUTH: 'renderer/.env의 MUAPI_API_KEY를 확인하세요. 자동 재시도하지 않았습니다.',
      CREDITS: 'Muapi 크레딧을 충전한 뒤 다시 승인하세요.',
      RATE_LIMIT: '잠시 후 다시 승인해서 시도하세요 (자동 재시도 3회 후 중단됨).',
      BAD_REQUEST: '프롬프트/이미지/모델 설정을 확인하세요. 요금은 청구되지 않았을 가능성이 높습니다.',
      SERVER: '요금이 청구되었는지 Muapi History에서 확인한 뒤 다시 승인하세요. 자동 재시도하지 않았습니다.',
      NETWORK: '연결을 확인하세요. 이미 제출된 작업이면 "다시 확인"으로 이어서 받을 수 있습니다.',
      TIMEOUT: '이미 제출된 작업이면 "다시 확인"으로 이어서 받을 수 있습니다 (추가 요금 없음).',
      FAILED: 'Muapi가 작업을 실패 처리했습니다. 환불 여부는 Muapi History에서 확인하세요. 다시 생성하려면 새로 승인해야 합니다.',
      NO_OUTPUT: 'Muapi History에서 요청 상태를 확인하세요.',
    }[e.code] || '오류 내용을 확인하고 다시 승인해서 시도하세요.';
    return { code: e.code || 'ERROR', message: e.message, recovery, uncertain: !!e.uncertain };
  }

  async function validateClip(file) {
    const p = await probe(cfg.ffmpeg.ffprobe, file);
    const v = p.streams.find((s) => s.codec_type === 'video');
    if (!v) throw new StudioError('BAD_CLIP', '영상 스트림이 없는 파일입니다.');
    if (!(p.duration > 0.5)) throw new StudioError('BAD_CLIP', '클립이 너무 짧습니다.');
    const aspect = v.width / v.height;
    const warnings = Math.abs(aspect - 9 / 16) > 0.03 ? [`세로 9:16이 아닙니다 (${v.width}×${v.height}). 렌더 때 중앙 크롭됩니다.`] : [];
    return { durationSec: Math.round(p.duration * 100) / 100, width: v.width, height: v.height, warnings };
  }

  async function addClipVersion(epId, sceneId, tmpFile, meta) {
    const info = await validateClip(tmpFile);
    const hash = sha256File(tmpFile);
    const size = fs.statSync(tmpFile).size;
    return store.episodes.update(epId, (ep) => {
      const c = (ep.clips[sceneId] = ep.clips[sceneId] || { versions: [], approvedVersion: null });
      const v = c.versions.length + 1;
      const rel = path.join('clips', sceneId, 'v' + v + '.mp4');
      fs.mkdirSync(path.dirname(store.episodes.file(epId, rel)), { recursive: true });
      fs.copyFileSync(tmpFile, store.episodes.file(epId, rel));
      c.versions.push(Object.assign({ v, file: rel, sha256: hash, size, ...info, status: 'pending_review', createdAt: nowIso() }, meta));
      return v;
    });
  }

  async function finishDownload(epId, job, outputs) {
    const tmp = store.episodes.file(epId, 'tmp', job.id + '.mp4');
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    try {
      await provider.download(outputs[0], tmp);
    } catch (e) {
      await setJob(epId, job.id, { status: 'download_failed', outputs, error: errInfo(e) });
      throw e;
    }
    try {
      const hash = sha256File(tmp);
      writeFileAtomic(store.cachePath('clips', job.key + '.mp4'), fs.readFileSync(tmp));
      const v = await addClipVersion(epId, job.sceneId, tmp, { jobId: job.id, key: job.key, requestId: job.requestId, mock: provider.mode === 'mock', reused: false, modelId: job.modelId, promptHash: job.promptHash });
      await setJob(epId, job.id, { status: 'completed', outputs, clipVersion: v, sha256: hash, error: null });
      return v;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  function applyCost(epId, job, cost) {
    if (!cost) return Promise.resolve();
    return store.episodes.update(epId, (ep) => {
      const sp = ep.spend.find((s) => s.jobId === job.id);
      if (sp && cost.amountUsd != null) sp.actualUsd = cost.amountUsd;
      const j = ep.generation.jobs.find((x) => x.id === job.id);
      if (j) j.cost = cost;
    });
  }

  async function generateScene(epId, authId, sceneId) {
    const gk = epId + ':' + sceneId;
    if (running.has(gk)) throw new StudioError('ALREADY_RUNNING', `${sceneId} 생성이 이미 진행 중입니다.`, { status: 409 });
    running.add(gk);
    let job = null;
    try {
      const ep0 = store.episodes.get(epId);
      const scene = sceneOf(ep0, sceneId);
      const auth = ep0.generation.authorizations.find((a) => a.id === authId);
      const model = modelById(store.models(), auth && auth.modelId);
      checkAuthorization(ep0, auth, sceneId, model);
      if (!isScriptApproved(ep0) || !isStoryboardApproved(ep0)) throw new StudioError('NOT_APPROVED', '대본과 스토리보드가 승인 상태여야 합니다.', { status: 403 });
      if ((ep0.generation.jobs || []).some((j) => j.sceneId === sceneId && ACTIVE.has(j.status))) throw new StudioError('ALREADY_RUNNING', `${sceneId}에 진행 중인 작업이 있습니다.`, { status: 409 });
      const img = startImage(ep0, scene);
      const prompt = ep0.prompts[sceneId];
      const clipSec = clipSecFor(model, scene.durationSec);
      const key = keyFor(ep0, scene, model);
      const est = estimateRun({ ep: ep0, scenes: [scene], model, settings: store.settings.get(), cfg, cached: cachedFor(ep0, model) });
      job = { id: uid('job'), sceneId, key, modelId: model.id, mode: provider.mode, authorizationId: authId, status: 'preparing', estimatedUsd: est.totalUsd, promptHash: require('./util').sha256(prompt.video), requestId: '', error: null, createdAt: nowIso(), updatedAt: nowIso() };

      // 1) Cache hit: reuse, no network, no charge.
      const cachedFile = store.cachePath('clips', key + '.mp4');
      if (fs.existsSync(cachedFile)) {
        job.status = 'completed';
        job.reused = true;
        await store.episodes.update(epId, (ep) => {
          ep.generation.jobs.push(job);
          ep.generation.authorizations.find((a) => a.id === authId).consumed.push(sceneId);
        });
        const v = await addClipVersion(epId, sceneId, cachedFile, { jobId: job.id, key, mock: provider.mode === 'mock', reused: true, modelId: model.id });
        await setJob(epId, job.id, { clipVersion: v });
        store.episodes.audit(epId, 'generation.reused', { sceneId, key, clipVersion: v });
        return { sceneId, status: 'reused', clipVersion: v };
      }

      // 2) Budget re-check right before spending.
      if (provider.mode === 'live') {
        if (est.totalUsd == null) throw new StudioError('ESTIMATE_UNKNOWN', '가격 추정치가 없습니다.');
        const ep1 = store.episodes.get(epId);
        const remaining = limitFor(ep1, store.settings.get(), cfg) - spentUsd(ep1);
        if (est.totalUsd > remaining + 1e-9) throw new StudioError('OVER_LIMIT', `릴스 한도를 넘습니다 (남은 금액 $${round(remaining)}).`, { status: 409 });
      }
      await store.episodes.update(epId, (ep) => {
        ep.generation.jobs.push(job);
      });

      // 3) Upload start image (free). Failure here has billed nothing and keeps the authorization usable.
      let imageUrl;
      try {
        imageUrl = (await provider.uploadImage(img.file)).url;
      } catch (e) {
        await setJob(epId, job.id, { status: 'failed', billed: false, error: errInfo(e) });
        throw e;
      }

      // 4) Submit — the first billable step. Persist "submitting" and consume the authorization BEFORE the call.
      await store.episodes.update(epId, (ep) => {
        ep.generation.authorizations.find((a) => a.id === authId).consumed.push(sceneId);
        ep.generation.jobs.find((j) => j.id === job.id).status = 'submitting';
      });
      let sub;
      try {
        sub = await provider.submit({ model, prompt: composePrompt(store.episodes.get(epId), sceneId, prompt.video), imageUrl, aspectRatio: '9:16', duration: clipSec, negativePrompt: prompt.negative });
      } catch (e) {
        const definitelyRefused = ['AUTH', 'BAD_REQUEST', 'CREDITS', 'RATE_LIMIT'].includes(e.code);
        await setJob(epId, job.id, { status: definitelyRefused ? 'failed' : 'uncertain', billed: definitelyRefused ? false : null, error: errInfo(e) });
        store.episodes.audit(epId, 'generation.submit_failed', { sceneId, code: e.code });
        throw e;
      }
      await store.episodes.update(epId, (ep) => {
        const j = ep.generation.jobs.find((x) => x.id === job.id);
        j.status = 'processing';
        j.requestId = sub.requestId;
        ep.spend.push({ at: nowIso(), kind: 'video', jobId: job.id, sceneId, requestId: sub.requestId, estimatedUsd: est.totalUsd, actualUsd: sub.cost && sub.cost.amountUsd != null ? sub.cost.amountUsd : null, mock: provider.mode === 'mock', modelId: model.id });
      });
      store.episodes.audit(epId, 'generation.submitted', { sceneId, requestId: sub.requestId, mode: provider.mode });
      job.requestId = sub.requestId;
      return await poll(epId, job, sceneId);
    } finally {
      running.delete(gk);
    }
  }

  async function poll(epId, job, sceneId) {
    let r;
    try {
      r = await provider.waitForResult(job.requestId);
    } catch (e) {
      const interrupted = ['TIMEOUT', 'NETWORK'].includes(e.code);
      await setJob(epId, job.id, { status: interrupted ? 'polling_interrupted' : 'failed', error: errInfo(e) });
      store.episodes.audit(epId, 'generation.' + (interrupted ? 'interrupted' : 'failed'), { sceneId, requestId: job.requestId, code: e.code });
      throw e;
    }
    await applyCost(epId, job, r.cost);
    const v = await finishDownload(epId, job, r.outputs);
    store.episodes.audit(epId, 'generation.completed', { sceneId, requestId: job.requestId, clipVersion: v });
    return { sceneId, status: 'completed', clipVersion: v };
  }

  /**
   * Runs the authorized scenes one after another. Returns { accepted, done } immediately after validation;
   * `done` resolves with per-scene results (errors are captured, never retried).
   */
  async function run(epId, authorizationId) {
    const ep = store.episodes.get(epId);
    const a = ep.generation.authorizations.find((x) => x.id === authorizationId);
    if (!a) throw new StudioError('NO_AUTH', '생성 승인을 찾을 수 없습니다.', { status: 403 });
    const model = modelById(store.models(), a.modelId);
    const todo = a.sceneIds.filter((id) => !a.consumed.includes(id));
    if (!todo.length) throw new StudioError('AUTH_USED', '이 승인은 이미 모두 사용되었습니다.', { status: 403 });
    todo.forEach((id) => checkAuthorization(ep, a, id, model)); // fail fast, before anything starts
    const done = (async () => {
      const results = [];
      for (const id of todo) {
        try {
          results.push(await generateScene(epId, authorizationId, id));
        } catch (e) {
          log('generation error ' + id + ': ' + e.message);
          results.push({ sceneId: id, status: 'error', error: errInfo(e) });
        }
      }
      return results;
    })();
    return { accepted: todo, done };
  }

  /** Free: continue an already-submitted job (poll + download). Never submits again. */
  async function resume(epId, jobId) {
    const ep = store.episodes.get(epId);
    const job = ep.generation.jobs.find((j) => j.id === jobId);
    if (!job) throw new StudioError('NOT_FOUND', '작업을 찾을 수 없습니다.', { status: 404 });
    if (!job.requestId) throw new StudioError('NO_REQUEST_ID', '요청 ID가 없어 이어서 확인할 수 없습니다.', { recovery: 'Muapi History에서 요금 청구 여부를 확인하세요. 필요하면 작업을 닫고 새로 승인해 생성하세요.' });
    if (!RECOVERABLE.has(job.status)) throw new StudioError('NOT_RESUMABLE', `이 작업은 이어서 확인할 수 없는 상태입니다 (${job.status}).`, { status: 409 });
    const gk = epId + ':' + job.sceneId;
    if (running.has(gk)) throw new StudioError('ALREADY_RUNNING', '이미 진행 중입니다.', { status: 409 });
    running.add(gk);
    try {
      if (job.status === 'download_failed' && job.outputs && job.outputs.length) {
        const v = await finishDownload(epId, job, job.outputs);
        return { sceneId: job.sceneId, status: 'completed', clipVersion: v };
      }
      await setJob(epId, job.id, { status: 'processing' });
      return await poll(epId, job, job.sceneId);
    } finally {
      running.delete(gk);
    }
  }

  /** Closes a failed/uncertain job so it stops blocking the scene. Does not delete anything. */
  async function dismissJob(epId, jobId, by = 'operator') {
    await store.episodes.update(epId, (ep) => {
      const j = ep.generation.jobs.find((x) => x.id === jobId);
      if (!j) throw new StudioError('NOT_FOUND', '작업을 찾을 수 없습니다.', { status: 404 });
      if (j.status === 'completed') throw new StudioError('NOT_RESUMABLE', '완료된 작업입니다.', { status: 409 });
      j.status = 'dismissed';
      j.dismissedBy = by;
    });
    store.episodes.audit(epId, 'generation.dismissed', { jobId, by });
  }

  /** Operator uploads a clip made elsewhere (e.g. Google Flow). It enters the same review/approval path. */
  async function addManualClip(epId, sceneId, buffer, filename) {
    sceneOf(store.episodes.get(epId), sceneId);
    const tmp = store.episodes.file(epId, 'tmp', uid('upload') + '.mp4');
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, buffer);
    try {
      const v = await addClipVersion(epId, sceneId, tmp, { manual: true, originalName: require('./util').safeName(filename), mock: false });
      store.episodes.audit(epId, 'clip.uploaded', { sceneId, clipVersion: v });
      return v;
    } catch (e) {
      throw e instanceof StudioError ? e : new StudioError('BAD_CLIP', '영상 파일을 읽을 수 없습니다: ' + e.message);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  async function review(epId, sceneId, version, decision, { note = '', by = 'operator' } = {}) {
    await store.episodes.update(epId, (ep) => {
      const c = ep.clips[sceneId];
      const v = c && c.versions.find((x) => x.v === Number(version));
      if (!v) throw new StudioError('NOT_FOUND', '클립 버전을 찾을 수 없습니다.', { status: 404 });
      if (decision === 'approve') {
        const f = store.episodes.file(epId, v.file);
        if (!fs.existsSync(f) || sha256File(f) !== v.sha256) throw new StudioError('CHECKSUM', '클립 파일이 기록된 체크섬과 다릅니다. 승인할 수 없습니다.', { recovery: '클립을 다시 생성하거나 업로드하세요.', status: 409 });
        c.versions.forEach((x) => x.status === 'approved' && (x.status = 'superseded'));
        v.status = 'approved';
        v.approvedBy = by;
        v.approvedAt = nowIso();
        c.approvedVersion = v.v;
      } else if (decision === 'reject') {
        v.status = 'rejected';
        if (c.approvedVersion === v.v) c.approvedVersion = null;
      } else throw new StudioError('BAD_DECISION', '승인 또는 거절만 가능합니다.');
      v.note = note;
    });
    store.episodes.audit(epId, 'clip.' + decision, { sceneId, version, by });
  }

  return { estimate, authorize, run, resume, dismissJob, addManualClip, review, startImage, provider };
}

module.exports = { createGenerationService };
