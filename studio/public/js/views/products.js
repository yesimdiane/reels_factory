// Products: product info → compliant extraction (or manual) → reference images → approved reference set.
import { h, chip, icon, toast, modal, confirmDialog } from '../ui.js';
import { state, act, go, setProduct } from '../state.js';
import { api } from '../api.js';
import { pageHead, asyncBlock, confirmPaid } from './common.js';

const KIND_CHIP = { retrieved: ['원본 · 쇼핑몰 수집', 'mock'], uploaded: ['직접 업로드', ''], ai_generated: ['AI 생성 · 제조사 사진 아님', 'attention'] };
const STATUS_CHIP = { pending: ['검토 대기', ''], approved: ['승인', 'done'], rejected: ['거절', 'err'], replaced: ['교체됨', 'mock'] };
const EXTRACT_CHIP = { none: ['미수집', ''], ok: ['수집됨 · 확인 필요', 'done'], blocked: ['수집 차단 → 직접 입력', 'attention'], failed: ['수집 실패 → 직접 입력', 'attention'] };

export function products() {
  const wrap = h('div', { class: 'stack', style: 'gap:20px' });
  const pid = state.productId;
  if (!pid || location.hash.split('/').length < 3) return list(wrap);
  return detail(wrap, pid);
}

function list(wrap) {
  const items = state.summary.products || [];
  wrap.append(pageHead('Products', '제품', '제품 URL 또는 직접 입력으로 시작합니다. 확인된 사실과 승인된 참조 이미지만 스토리 생성에 사용됩니다.', h('button', { class: 'btn', onclick: newProduct }, icon('plus'), '새 제품')));
  if (!items.length) wrap.append(h('div', { class: 'empty' }, h('h2', null, '제품이 없습니다'), h('p', null, '"새 제품"으로 쿠팡/기타 URL이나 제품 정보를 입력하세요.')));
  wrap.append(h('div', { class: 'grid three' }, items.map((p) => h('article', { class: 'card stack', style: 'gap:10px' },
    h('div', { class: 'row between' }, h('span', { class: 'eyebrow' }, p.id), chip(p.readiness.ok ? '스토리 준비 완료' : '준비 필요', p.readiness.ok ? 'done' : 'attention')),
    h('h3', null, p.name || '(이름 없음)'),
    h('div', { class: 'small muted' }, '이미지 ' + p.images + '장 · 참조 세트: ' + ({ none: '없음', approved: '승인됨', waived: '이미지 없이 진행(기록됨)', stale: '재승인 필요' }[p.reference] || p.reference)),
    p.readiness.ok ? null : h('div', { class: 'small', style: 'color:var(--clay)' }, '필요: ' + p.readiness.missing.join(', ')),
    h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => { setProduct(p.id); location.hash = '#/products/' + p.id; } }, '열기'), h('button', { class: 'btn sm ghost', disabled: !p.readiness.ok, onclick: () => { setProduct(p.id); location.hash = '#/storylab/' + p.id; } }, '스토리 랩'))))));
  return wrap;
}

function newProduct() {
  const f = { name: '', url: '', affiliateUrl: '', description: '', features: '' };
  modal((close) => h('div', { class: 'stack' },
    h('h2', null, '새 제품'),
    h('p', { class: 'small muted', style: 'margin:0' }, 'URL을 넣으면 공개된 페이지에서 제목·이미지·사양을 가져와 보려고 시도합니다(robots.txt 준수, 차단·로그인 우회 없음). 안 되면 직접 입력으로 이어집니다. 가져온 사양은 "미확인"으로 표시되며 확인해야 사용됩니다.'),
    inp('제품 URL (쿠팡 등, 선택)', 'url', 'https://…', (v) => (f.url = v)),
    inp('제품 이름', 'text', '', (v) => (f.name = v)),
    inp('쿠팡 파트너스(제휴) 링크', 'url', '', (v) => (f.affiliateUrl = v)),
    h('div', { class: 'field' }, h('label', null, '제품 설명 (선택)'), h('textarea', { rows: 2, oninput: (e) => (f.description = e.target.value) })),
    h('div', { class: 'field' }, h('label', null, '확인된 기능·특징 (한 줄에 하나, 직접 확인한 것만)'), h('textarea', { rows: 3, oninput: (e) => (f.features = e.target.value) })),
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: close }, '취소'), h('button', { class: 'btn', onclick: async () => {
      const r = await act(() => api.post('/api/products', { name: f.name, url: f.url, affiliateUrl: f.affiliateUrl, description: f.description, features: f.features.split('\n').map((x) => x.trim()).filter(Boolean) }), { ok: '제품을 만들었습니다' });
      if (r && r.id) { close(); setProduct(r.id); if (f.url) { try { await api.post(`/api/products/${r.id}/extract`); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); } } location.hash = '#/products/' + r.id; }
    } }, '만들기'))));
}
const inp = (label, type, ph, on) => h('div', { class: 'field' }, h('label', null, label), h('input', { type, placeholder: ph, oninput: (e) => on(e.target.value) }));

function detail(wrap, pid) {
  return asyncBlock(() => api.get('/api/products/' + pid), (p) => draw(p));
}

function draw(p) {
  const wrap = h('div', { class: 'stack', style: 'gap:20px' });
  const reload = () => import('../state.js').then(({ hooks }) => hooks.rerender());
  const run = async (fn, ok) => { try { await fn(); if (ok) toast(ok); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); } await act(async () => null); };
  wrap.append(pageHead('Products · ' + p.id, p.name || '제품', 'A 제품 정보 → B 참조 이미지 → C 승인. 모든 단계는 저장되고 다시 열어도 유지됩니다.',
    h('button', { class: 'btn ghost', onclick: () => { location.hash = '#/products'; } }, '목록'),
    h('button', { class: 'btn sage', disabled: !p.readiness.ok, onclick: () => { location.hash = '#/storylab/' + p.id; } }, '스토리 랩으로 →')));

  // ---- A. info ----
  const f = { name: p.name, category: p.category, url: p.url, affiliateUrl: p.affiliateUrl, description: p.description, forbidden: (p.forbiddenClaims || []).join(', '), specs: p.specs.map((s) => ({ text: s.text, verified: s.verified, source: s.source })) };
  const ex = p.extraction || { status: 'none' };
  const specBox = h('div', { class: 'stack', style: 'gap:8px' });
  const drawSpecs = () => specBox.replaceChildren(...f.specs.map((s, i) => h('div', { class: 'row', style: 'flex-wrap:nowrap' },
    h('input', { type: 'text', value: s.text, 'aria-label': '사양/기능', oninput: (e) => (s.text = e.target.value) }),
    h('label', { class: 'small row', style: 'gap:6px;white-space:nowrap' }, h('input', { type: 'checkbox', checked: !!s.verified, onchange: (e) => (s.verified = e.target.checked) }), '확인됨'),
    chip(s.source === 'extracted' ? '추출됨' : '직접 입력', s.source === 'extracted' ? 'attention' : ''),
    h('button', { class: 'btn icon danger', 'aria-label': '삭제', onclick: () => { f.specs.splice(i, 1); drawSpecs(); } }, icon('trash')))), h('button', { class: 'btn sm ghost', onclick: () => { f.specs.push({ text: '', verified: true, source: 'manual' }); drawSpecs(); } }, icon('plus'), '기능/사양 추가'));
  drawSpecs();
  wrap.append(h('div', { class: 'card stack', style: 'gap:14px' },
    h('div', { class: 'card-head' }, h('h2', null, 'A · 제품 정보'), h('div', { class: 'row' }, chip(...EXTRACT_CHIP[ex.status] || EXTRACT_CHIP.none), h('button', { class: 'btn sm ghost', disabled: !p.url, onclick: () => run(() => api.post(`/api/products/${p.id}/extract`), 'URL 수집을 시도했습니다') }, icon('refresh'), 'URL에서 가져오기'))),
    ex.note ? h('div', { class: 'banner ' + (ex.status === 'ok' ? 'ok' : 'warn') }, h('div', null, ex.note, ex.imageFailures && ex.imageFailures.length ? h('div', { class: 'small' }, `이미지 ${ex.imageFailures.length}장은 가져오지 못했습니다.`) : null)) : null,
    h('div', { class: 'grid two' }, fld('제품 이름', f.name, (v) => (f.name = v)), fld('카테고리', f.category, (v) => (f.category = v)), fld('제품 URL', f.url, (v) => (f.url = v)), fld('쿠팡 파트너스(제휴) 링크', f.affiliateUrl, (v) => (f.affiliateUrl = v))),
    h('div', { class: 'field' }, h('label', null, '제품 설명'), h('textarea', { rows: 2, oninput: (e) => (f.description = e.target.value) }, f.description)),
    h('div', { class: 'field' }, h('label', null, '확인된 기능·사양 — "확인됨"으로 표시된 것만 스토리 생성에 사용됩니다'), specBox),
    fld('금지 표현 (쉼표로 구분 — 영상/대본에서 쓰면 안 되는 제품 주장)', f.forbidden, (v) => (f.forbidden = v)),
    h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => run(() => api.put('/api/products/' + p.id, { name: f.name, category: f.category, url: f.url, affiliateUrl: f.affiliateUrl, description: f.description, specs: f.specs, forbiddenClaims: f.forbidden.split(',').map((x) => x.trim()).filter(Boolean) }), '저장했습니다') }, '저장')),
    p.url ? h('p', { class: 'small muted', style: 'margin:0' }, '출처 URL: ' + p.url + ' · 가격·할인·평점은 수집하지 않으며 제품 사실은 직접 확인한 것만 사용합니다.') : null));

  // ---- B. images ----
  const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, style: 'display:none', onchange: async (e) => { for (const file of e.target.files) await run(() => api.upload(`/api/products/${p.id}/images?label=${encodeURIComponent(file.name)}`, file), file.name + ' 업로드됨 (승인 필요)'); e.target.value = ''; } });
  const dz = h('div', { class: 'dropzone', tabindex: 0, onclick: () => input.click(), ondragover: (e) => { e.preventDefault(); dz.classList.add('over'); }, ondragleave: () => dz.classList.remove('over'),
    ondrop: async (e) => { e.preventDefault(); dz.classList.remove('over'); for (const file of e.dataTransfer.files) await run(() => api.upload(`/api/products/${p.id}/images?label=${encodeURIComponent(file.name)}`, file), file.name + ' 업로드됨'); } },
  input, icon('upload'), ` 제품 이미지를 끌어놓거나 클릭해서 올리기 (${p.counts.uploaded}/${p.limits.uploads}장 · PNG·JPG·WebP)`);
  const imgs = p.images;
  const card = (im) => {
    const rep = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', style: 'display:none', onchange: async (e) => { const file = e.target.files[0]; if (file) await run(() => api.upload(`/api/products/${p.id}/images/${im.id}/replace`, file), '이미지를 교체했습니다'); e.target.value = ''; } });
    const set = (status) => run(() => api.post(`/api/products/${p.id}/images/${im.id}/status`, { status }));
    return h('figure', { class: 'ref' + (im.status === 'approved' ? ' ok' : ''), style: im.status === 'replaced' ? 'opacity:.5' : '' },
      h('img', { src: im.url, alt: im.label || '제품 이미지' }),
      h('figcaption', null,
        h('div', { class: 'row', style: 'gap:6px' }, chip(...KIND_CHIP[im.kind]), chip(...STATUS_CHIP[im.status])),
        h('div', { class: 'small' }, im.label || ''),
        im.disclosure ? h('div', { class: 'small', style: 'color:var(--clay)' }, im.disclosure) : null,
        im.licenseNote ? h('div', { class: 'small muted' }, im.licenseNote) : null,
        im.kind === 'ai_generated' ? h('div', { class: 'small muted mono' }, (im.provider || '') + ' / ' + (im.model || '')) : null,
        im.status === 'replaced' ? null : h('div', { class: 'row', style: 'gap:6px' },
          h('button', { class: 'btn sm ' + (im.status === 'approved' ? 'ghost' : 'sage'), onclick: () => set(im.status === 'approved' ? 'pending' : 'approved') }, im.status === 'approved' ? '승인 취소' : '승인'),
          h('button', { class: 'btn sm danger', disabled: im.status === 'rejected', onclick: () => set('rejected') }, '거절'),
          rep, h('button', { class: 'btn sm ghost', onclick: () => rep.click() }, '교체'),
          im.kind === 'ai_generated' ? h('button', { class: 'btn sm ghost', onclick: () => compare(p, im) }, '원본과 비교') : null)));
  };
  const approvedOrig = imgs.filter((i) => i.kind !== 'ai_generated' && i.status === 'approved');
  wrap.append(h('div', { class: 'card stack', style: 'gap:14px' },
    h('div', { class: 'card-head' }, h('h2', null, 'B · 참조 이미지'), h('div', { class: 'row' },
      h('button', { class: 'btn sm ghost', disabled: !approvedOrig.length, title: approvedOrig.length ? '' : '먼저 원본/업로드 이미지를 하나 승인하세요', onclick: () => genDialog(p, approvedOrig) }, 'AI 제품 이미지 만들기'))),
    h('div', { class: 'banner' }, icon('lock'), h('div', null, '쇼핑몰에서 가져온 이미지는 광고·AI 변형 사용 권한이 확인되지 않았습니다. AI 생성 이미지는 항상 "AI 생성"으로 표시되며 제조사 사진으로 쓰이지 않습니다. 제품의 모양·로고·색상·기능을 바꾼 이미지는 승인하지 마세요.')),
    imgs.length ? h('div', { class: 'ref-grid', style: 'grid-template-columns:repeat(auto-fill,minmax(170px,1fr))' }, imgs.map(card)) : h('div', { class: 'empty' }, '이미지가 없습니다. 업로드하거나 URL에서 가져오세요.'),
    dz));

  // ---- C. reference set approval ----
  const r = p.reference;
  const approvedIds = imgs.filter((i) => i.status === 'approved').map((i) => i.id);
  wrap.append(h('div', { class: 'card stack', style: 'gap:12px' },
    h('div', { class: 'card-head' }, h('h2', null, 'C · 참조 세트 승인'), chip(({ none: '미승인', approved: '승인됨', stale: '재승인 필요', waived: '이미지 없이 진행' })[r.state], r.approved ? 'done' : 'attention')),
    r.state === 'approved' ? h('p', { class: 'small', style: 'margin:0' }, `${r.imageIds.length}장 승인 · ${new Date(r.at).toLocaleString('ko-KR')} · 세트 해시 ${r.hash.slice(0, 10)}. 이미지가 바뀌면 자동으로 무효가 됩니다.`) : null,
    r.state === 'stale' ? h('div', { class: 'banner warn' }, r.note) : null,
    r.state === 'waived' ? h('p', { class: 'small', style: 'margin:0' }, '사유: ' + r.waived) : null,
    p.readiness.ok ? h('div', { class: 'banner ok' }, '스토리 랩에서 사용할 준비가 되었습니다.') : h('div', { class: 'banner warn' }, h('div', null, '필요: ' + p.readiness.missing.join(', '))),
    h('div', { class: 'row' },
      h('button', { class: 'btn sage', disabled: !approvedIds.length, onclick: () => run(() => api.post(`/api/products/${p.id}/references/approve`, { imageIds: approvedIds }), '참조 이미지 세트를 승인했습니다') }, icon('check'), `승인된 이미지 ${approvedIds.length}장을 참조 세트로 승인`),
      h('button', { class: 'btn ghost', onclick: waive }, '이미지 없이 진행…'))));
  async function waive() {
    const reason = prompt('이미지 없이 진행하는 이유를 적으세요 (기록됩니다)');
    if (reason) await run(() => api.post(`/api/products/${p.id}/references/waive`, { reason }), '기록했습니다');
  }
  void reload;
  return wrap;
}

const fld = (label, value, on) => h('div', { class: 'field' }, h('label', null, label), h('input', { type: 'text', value, oninput: (e) => on(e.target.value) }));

function compare(p, im) {
  const src = (im.derivedFrom || []).map((id) => p.images.find((x) => x.id === id)).filter(Boolean);
  modal((close) => h('div', { class: 'stack' }, h('h2', null, '원본 vs AI 생성'),
    h('div', { class: 'grid two' },
      h('div', { class: 'stack', style: 'gap:6px' }, h('b', null, '원본 (승인됨)'), src.map((s) => h('img', { src: s.url, alt: '원본', style: 'width:100%;border-radius:12px;border:1px solid var(--line)' }))),
      h('div', { class: 'stack', style: 'gap:6px' }, h('b', null, 'AI 생성'), h('img', { src: im.url, alt: 'AI 생성', style: 'width:100%;border-radius:12px;border:1px solid var(--line)' }))),
    h('p', { class: 'small muted', style: 'margin:0' }, '제품의 모양·비율·로고·글자·색상·기능이 원본과 같은지 확인한 뒤에만 승인하세요. 다르면 거절하세요.'),
    h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: close }, '닫기')), ), { wide: true });
}

async function genDialog(p, originals) {
  const sel = new Set(originals.slice(0, 2).map((i) => i.id));
  let prompt = '';
  let est;
  try { est = await api.post(`/api/products/${p.id}/images/estimate`); } catch (e) { toast(e.message, { error: true }); return; }
  modal((close) => h('div', { class: 'stack' }, h('h2', null, 'AI 제품 이미지 만들기'),
    h('p', { class: 'small muted', style: 'margin:0' }, '승인된 원본을 기준으로 배경·각도·조명만 바꾼 이미지를 만듭니다. 제품 모양·로고·색상·기능은 바꾸지 않도록 지시하지만, 결과가 다를 수 있으므로 반드시 원본과 비교해 승인하세요.'),
    h('div', { class: 'ref-grid' }, originals.map((o) => h('label', { class: 'ref' }, h('img', { src: o.url, alt: '' }), h('figcaption', null, h('span', { class: 'row small', style: 'gap:6px' }, h('input', { type: 'checkbox', checked: sel.has(o.id), onchange: (e) => (e.target.checked ? sel.add(o.id) : sel.delete(o.id)) }), '기준으로 사용'))))),
    h('div', { class: 'field' }, h('label', null, '변형 요청 (배경/각도/조명만, 선택)'), h('textarea', { rows: 2, placeholder: '예: 밝은 원목 현관 벽 앞, 정면', oninput: (e) => (prompt = e.target.value) })),
    est.provider !== 'gemini' ? h('div', { class: 'banner warn' }, '이미지 생성 제공자가 연결되지 않았습니다. Settings → AI 연동에서 Gemini 키와 이미지 생성 가능 모델을 지정한 뒤 "제품 이미지 생성" 작업을 Gemini로 배정하세요.') : null,
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: close }, '취소'), h('button', { class: 'btn clay', disabled: est.provider !== 'gemini', onclick: async () => {
      const c = await confirmPaid({ title: 'AI 이미지 생성 (유료일 수 있음)', est, confirmLabel: '생성' });
      if (!c) return;
      close();
      try { await api.post(`/api/products/${p.id}/images/generate`, { basedOn: [...sel], prompt, confirm: c }); toast('AI 이미지를 만들었습니다 (원본과 비교 후 승인하세요)'); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); }
      await act(async () => null);
    } }, '생성…'))));
}

void go; void confirmDialog;
