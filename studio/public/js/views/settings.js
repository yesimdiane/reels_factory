import { h, chip, icon, confirmDialog, toast, fmtUsd } from '../ui.js';
import { state, act } from '../state.js';
import { api } from '../api.js';
import { pageHead, charAvatar } from './common.js';
import { aiIntegrations, promptManager, usagePanel } from './ai-settings.js';

function kv(k, v) { return h('div', { class: 'row between', style: 'padding:6px 0;border-bottom:1px solid var(--line)' }, h('span', { class: 'muted' }, k), h('span', null, v)); }

function parts() {
  const s = state.summary;
  const p = s.providers;
  const st = s.settings;
  const wrap = h('div', { class: 'stack', style: 'gap:20px' });

  // Providers
  wrap.append(h('div', { class: 'grid two' },
    h('div', { class: 'card' }, h('h2', null, '영상 생성 (Muapi)'),
      kv('모드', p.video.mode === 'live' ? chip('LIVE (유료)', 'live') : chip('MOCK', 'mock')),
      kv('API 키', p.video.keyConfigured ? chip('서버에 설정됨', 'done') : chip('없음', 'attention')),
      kv('실제 모드 요청', p.video.liveWithoutKey ? chip('요청됨 · 키 없음 → MOCK 동작', 'attention') : p.video.liveRequested ? '켜짐' : '꺼짐'),
      kv('Base URL', h('span', { class: 'mono small' }, p.video.baseUrl)),
      h('p', { class: 'small muted', style: 'margin:10px 0 0' }, p.how)),
    h('div', { class: 'card' }, h('h2', null, '음성 (HeyGen)'),
      kv('모드', p.voice.mode === 'live' ? chip('LIVE (유료)', 'live') : chip('MOCK', 'mock')),
      kv('API 키', p.voice.keyConfigured ? chip('서버에 설정됨', 'done') : chip('없음', 'attention')),
      kv('실제 모드 요청', p.voice.liveWithoutKey ? chip('요청됨 · 키 없음 → MOCK 동작', 'attention') : p.voice.liveRequested ? '켜짐' : '꺼짐'),
      kv('1회 최대 글자 수', String(p.limits.maxCharsPerJob || '—')),
      kv('월 글자 한도', String(p.limits.monthlyCharLimit || '—')),
      kv('립싱크', chip('미제공', 'attention')),
      kv('Gemini (프롬프트 AI)', p.gemini.configured ? chip('키 설정됨 · ' + p.gemini.model, 'done') : chip('키 없음 — 템플릿만', 'attention')),
      h('p', { class: 'small muted', style: 'margin:10px 0 0' }, p.lipSync.note))));

  // Spend + prices
  const f = { limit: st.reelSpendLimitUsd == null ? '' : st.reelSpendLimitUsd, voice: st.voiceUsdPer1kChars == null ? '' : st.voiceUsdPer1kChars, prices: {} };
  const rows = s.models.map((m) => {
    const cur = ((st.modelEstimates || {})[m.id] || {}).usdByDuration || {};
    f.prices[m.id] = Object.fromEntries(m.durations.map((d) => [String(d), cur[String(d)] === undefined ? '' : cur[String(d)]]));
    return h('tr', null,
      h('td', null, h('b', null, m.label || m.id), h('div', { class: 'small muted mono' }, m.endpoint), h('div', { class: 'small muted' }, '검증 수준: ' + m.verification)),
      m.durations.map((d) => h('td', null, h('input', { type: 'number', min: 0, step: 0.01, placeholder: '미입력', value: f.prices[m.id][String(d)], style: 'width:100px', oninput: (e) => (f.prices[m.id][String(d)] = e.target.value) }))));
  });
  const maxDur = Math.max(...s.models.map((m) => m.durations.length), 1);
  wrap.append(h('div', { class: 'card stack', style: 'gap:12px' },
    h('div', { class: 'card-head' }, h('h2', null, '비용 한도와 가격 추정'),
      h('button', { class: 'btn sm', onclick: () => act(async () => { await api.put('/api/settings', { reelSpendLimitUsd: f.limit, voiceUsdPer1kChars: f.voice, modelEstimates: Object.fromEntries(Object.entries(f.prices).map(([k, v]) => [k, { usdByDuration: v }])) }); return null; }, { ok: '설정을 저장했습니다' }) }, '저장')),
    h('div', { class: 'banner warn' }, icon('lock'), h('div', null, 'Muapi 공식 문서에서 모델별 단가표를 확인하지 못해 가격을 임의로 채우지 않았습니다. Muapi 계정의 가격 안내를 보고 직접 입력하세요. 입력하기 전에는 실제 모드에서 생성이 차단됩니다(비용 확인 없이는 실행 불가).')),
    h('div', { class: 'grid two' },
      h('div', { class: 'field' }, h('label', null, '릴스 1편당 지출 한도 (USD)'), h('input', { type: 'number', min: 0, step: 0.5, value: f.limit, placeholder: '기본값 $' + st.effectiveReelSpendLimitUsd + ' (RF_REEL_SPEND_LIMIT_USD)', oninput: (e) => (f.limit = e.target.value) }), h('div', { class: 'small muted' }, '현재 적용: ' + fmtUsd(st.effectiveReelSpendLimitUsd) + ' · 비워두면 서버 기본값 사용')),
      h('div', { class: 'field' }, h('label', null, 'HeyGen 1,000자당 추정 가격 (USD, 선택)'), h('input', { type: 'number', min: 0, step: 0.01, value: f.voice, placeholder: '미입력', oninput: (e) => (f.voice = e.target.value) }))),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, '모델 (클립 1개 가격, USD)'), ...Array.from({ length: maxDur }, (_, i) => h('th', null, (s.models[0].durations[i] || '') + '초')))), h('tbody', null, rows)))));

  // Render prefs
  const r = Object.assign({}, st.render);
  wrap.append(h('div', { class: 'card stack', style: 'gap:12px' },
    h('div', { class: 'card-head' }, h('h2', null, '렌더링'), h('button', { class: 'btn sm', onclick: () => act(async () => { await api.put('/api/settings', { render: { font: r.font, fontSize: Number(r.fontSize), burnDisclosure: !!r.burnDisclosure, previewWidth: Number(r.previewWidth) } }); return null; }, { ok: '렌더 설정을 저장했습니다' }) }, '저장')),
    h('div', { class: 'grid three' },
      h('div', { class: 'field' }, h('label', null, '자막 글꼴 이름'), h('input', { type: 'text', value: r.font || '', placeholder: '기본: NanumSquareRound', oninput: (e) => (r.font = e.target.value) })),
      h('div', { class: 'field' }, h('label', null, '자막 크기'), h('input', { type: 'number', min: 30, max: 120, value: r.fontSize, oninput: (e) => (r.fontSize = e.target.value) })),
      h('div', { class: 'field' }, h('label', null, '미리보기 폭(px)'), h('input', { type: 'number', min: 270, max: 1080, value: r.previewWidth, oninput: (e) => (r.previewWidth = e.target.value) }))),
    h('label', { style: 'display:flex;gap:8px;align-items:center' }, h('input', { type: 'checkbox', checked: !!r.burnDisclosure, onchange: (e) => (r.burnDisclosure = e.target.checked) }), '영상에 광고 표기를 직접 넣기 (기본은 캡션 첫 줄에 표기)')));

  // Characters
  const chars = h('div', { class: 'stack', style: 'gap:20px' });
  chars.append(h('div', { class: 'card-head' }, h('h2', { style: 'margin:0' }, '캐릭터 라이브러리'), h('button', { class: 'btn sm ghost', onclick: async () => {
    const ok = await confirmDialog({ title: '데모용 임시 참조 이미지를 만들까요?', body: '실제 캐릭터 그림이 아닌 단색 자리표시 이미지입니다. 목업 모드에서 흐름을 확인하는 용도이며, 실제 모드에서는 사용할 수 없습니다. 이미 승인된 참조가 있으면 건드리지 않습니다.' });
    if (ok) await act(async () => { const r2 = await api.post('/api/demo/references'); toast(r2.made ? `${r2.made}개 만들었습니다` : '만들 것이 없습니다'); return null; });
  } }, '데모 참조 만들기')));
  chars.append(h('div', { class: 'small muted' }, '승인된 참조 이미지가 캐릭터의 기준입니다. 생성할 때 승인된 참조만 시작 프레임으로 사용됩니다. 스타일: ' + (s.style.summary || s.style.name || '손그림 2D 한국 웹툰/애니메이션 · 뮤트 베이지 톤')));
  chars.append(h('div', { class: 'grid two' }, s.characters.map(charCard)));
  return { general: wrap, characters: chars };
}

const TABS = [['general', '일반 · 비용'], ['ai', 'AI 연동'], ['prompts', '프롬프트 매니저'], ['usage', '사용량 · 한도'], ['characters', '캐릭터']];

export function settings() {
  const wrap = h('div', { class: 'stack', style: 'gap:20px' });
  const tab = TABS.some((t) => t[0] === state.settingsTab) ? state.settingsTab : 'general';
  wrap.append(pageHead('Settings', '설정', 'API 키는 서버의 암호화 저장소에만 저장되며 이 화면에 다시 표시되지 않습니다. 키·모델·프롬프트·한도는 코드나 .env를 고치지 않고 여기서 바꿉니다.'));
  wrap.append(h('div', { class: 'seg', role: 'tablist', style: 'align-self:flex-start;flex-wrap:wrap' }, TABS.map(([k, l]) => h('button', { role: 'tab', 'aria-pressed': tab === k ? 'true' : 'false', onclick: () => { state.settingsTab = k; import('../state.js').then(({ hooks }) => hooks.rerender()); } }, l))));
  if (tab === 'ai') wrap.append(aiIntegrations());
  else if (tab === 'prompts') wrap.append(promptManager());
  else if (tab === 'usage') wrap.append(usagePanel());
  else { const p = parts(); wrap.append(tab === 'characters' ? p.characters : p.general); }
  return wrap;
}

function charCard(c) {
  const f = { look: c.look, promptBlock: c.promptBlock, catchphrase: c.catchphrase || '' };
  const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, style: 'display:none', onchange: async (e) => { for (const file of e.target.files) await act(async () => { await api.upload(`/api/characters/${c.id}/references?label=${encodeURIComponent(file.name)}`, file); return null; }, { ok: file.name + ' 업로드됨 (승인 필요)' }); e.target.value = ''; } });
  const dz = h('div', { class: 'dropzone', tabindex: 0, onclick: () => input.click(),
    ondragover: (e) => { e.preventDefault(); dz.classList.add('over'); }, ondragleave: () => dz.classList.remove('over'),
    ondrop: async (e) => { e.preventDefault(); dz.classList.remove('over'); for (const file of e.dataTransfer.files) await act(async () => { await api.upload(`/api/characters/${c.id}/references?label=${encodeURIComponent(file.name)}`, file); return null; }, { ok: file.name + ' 업로드됨 (승인 필요)' }); } },
    input, icon('upload'), ' 참조 이미지를 끌어놓거나 클릭해서 올리기 (PNG·JPG·WebP)');
  return h('div', { class: 'card stack', style: 'gap:12px' },
    h('div', { class: 'row between' }, h('div', { class: 'row' }, charAvatar(c, true), h('div', null, h('h3', null, c.name + ' · ' + c.nameKo), h('div', { class: 'small muted' }, c.role))), chip(c.references.some((r) => r.approved) ? '승인된 참조 있음' : '승인된 참조 없음', c.references.some((r) => r.approved) ? 'done' : 'attention')),
    h('div', { class: 'ref-grid' }, c.references.map((r) => h('figure', { class: 'ref' + (r.approved ? ' ok' : '') },
      h('img', { src: r.url, alt: r.label || c.name }),
      h('figcaption', null, h('div', { class: 'small' }, (r.label || '참조') + (r.placeholder ? ' · 임시' : '')),
        h('label', { class: 'small', style: 'display:flex;gap:6px;align-items:center', title: '여러 그림이 모인 시트이면 체크 (시작 프레임으로 직접 쓸 수 없음)' }, h('input', { type: 'checkbox', checked: r.isSheet !== false, onchange: (e) => act(async () => { await api.put(`/api/characters/${c.id}/references/${r.id}`, { isSheet: e.target.checked }); return null; }) }), '캐릭터 시트'),
        h('div', { class: 'row', style: 'gap:6px' },
          h('button', { class: 'btn sm ' + (r.approved ? 'ghost' : 'sage'), onclick: () => act(async () => { await api.post(`/api/characters/${c.id}/references/${r.id}/approve`, { approved: !r.approved }); return null; }) }, r.approved ? '승인 취소' : '승인'),
          h('button', { class: 'btn sm ghost', 'aria-label': '삭제', onclick: async () => { if (await confirmDialog({ title: '참조 이미지를 삭제할까요?', body: '이 이미지를 시작 프레임으로 쓰는 장면은 다시 지정해야 합니다.', confirm: '삭제', tone: 'clay' })) act(async () => { await api.del(`/api/characters/${c.id}/references/${r.id}`); return null; }); } }, icon('trash')))))) ),
    dz,
    h('div', { class: 'field' }, h('label', null, '외형 설명'), h('textarea', { rows: 3, value: f.look, oninput: (e) => (f.look = e.target.value) })),
    h('div', { class: 'field' }, h('label', null, '프롬프트 블록 (생성에 그대로 들어감)'), h('textarea', { rows: 3, value: f.promptBlock, oninput: (e) => (f.promptBlock = e.target.value) })),
    c.forbiddenWords && c.forbiddenWords.length ? h('div', { class: 'small muted' }, '금지어: ' + c.forbiddenWords.join(', ')) : null,
    h('div', { class: 'row end' }, h('button', { class: 'btn sm', onclick: () => act(async () => { await api.put('/api/characters/' + c.id, f); return null; }, { ok: c.name + ' 정보를 저장했습니다' }) }, '저장')));
}
