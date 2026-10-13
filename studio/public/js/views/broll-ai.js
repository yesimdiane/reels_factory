// B-roll "AI 이미지 생성": editable prompt, the real reference images that will be attached, cost estimate, then an explicit paid call.
// Generated images are saved as "검토 대기" — never approved automatically. Nothing is generated when B-rolls are suggested.
import { h, chip, modal, toast, fmtUsd } from '../ui.js';
import { act } from '../state.js';
import { api } from '../api.js';

export function previewBroll(b) {
  modal((close) => h('div', { class: 'stack', style: 'gap:10px;align-items:center' },
    h('h2', { style: 'margin:0' }, `${b.id}${b.assetId ? ' · ' + b.assetId : ''}`),
    h('img', { src: b.imageUrl, alt: b.id + ' 큰 미리보기', style: 'max-width:100%;max-height:72vh;border-radius:12px' }),
    h('button', { class: 'btn ghost', type: 'button', onclick: close }, '닫기')), { wide: true });
}

export async function openBrollAi(ep, b) {
  let plan;
  try { plan = await api.get(`/api/episodes/${ep.id}/broll/${b.id}/image/plan`); } catch (e) { return toast(e.message, { error: true, recovery: e.recovery }); }
  const st = { prompt: plan.prompt, chars: plan.options.selectedCharacters.slice(), product: plan.options.product, overwrite: false };
  modal((close) => {
    const status = h('div', { class: 'small', 'data-broll-ai-status': '' });
    const body = h('div', { class: 'stack', style: 'gap:10px' });
    const draw = (p) => {
      plan = p;
      const blocked = !p.scriptApproved || p.warnings.length > 0;
      const go = h('button', { class: 'btn clay', type: 'button', 'data-broll-ai-go': b.id, disabled: blocked, onclick: run }, p.hasImage ? '재생성' : '생성');
      body.replaceChildren(
        h('div', { class: 'small muted' }, `${b.kindLabel || b.kind} · ${b.insertAtSec}s에 ${b.durationSec}초. 이미지 한 장만 만듭니다 (영상은 만들지 않습니다). 결과는 "검토 대기"로 저장됩니다.`),
        !p.scriptApproved ? h('div', { class: 'issue err' }, '대본이 승인되어야 만들 수 있습니다 (유료 생성).') : null,
        ...p.warnings.map((w) => h('div', { class: 'issue err', 'data-broll-ai-warning': '' }, w)),
        h('div', { class: 'field' }, h('label', null, '이미지 프롬프트 (수정 가능)'), h('textarea', { rows: 8, 'data-broll-ai-prompt': '', value: st.prompt, oninput: (e) => (st.prompt = e.target.value) }),
          h('div', { class: 'small muted' }, '참조 이미지 첨부 규칙(캐릭터·제품 그대로 유지, 글자 금지)은 자동으로 추가되며 지울 수 없습니다.')),
        h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
          h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => { try { draw(await api.put(`/api/episodes/${ep.id}/broll/${b.id}/image/prompt`, { prompt: st.prompt, refCharacters: st.chars, refProduct: st.product })); toast('프롬프트·참조 선택을 저장했습니다 (이미지는 바뀌지 않음)'); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); } } }, '프롬프트 저장'),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => { try { const r = await api.del(`/api/episodes/${ep.id}/broll/${b.id}/image/prompt`); st.prompt = r.prompt; draw(r); } catch (e) { toast(e.message, { error: true }); } } }, '초안으로 되돌리기')),
        h('div', { class: 'small', style: 'font-weight:600' }, '첨부되는 참조 이미지'),
        h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
          p.options.characters.map((cid) => h('label', { class: 'chk-btn' }, h('input', { type: 'checkbox', checked: st.chars.includes(cid), onchange: async (e) => { st.chars = e.target.checked ? st.chars.concat(cid) : st.chars.filter((x) => x !== cid); draw(await api.put(`/api/episodes/${ep.id}/broll/${b.id}/image/prompt`, { prompt: st.prompt, refCharacters: st.chars, refProduct: st.product })); } }), cid)),
          p.options.productAvailable ? h('label', { class: 'chk-btn' }, h('input', { type: 'checkbox', checked: st.product, onchange: async (e) => { st.product = e.target.checked; draw(await api.put(`/api/episodes/${ep.id}/broll/${b.id}/image/prompt`, { prompt: st.prompt, refCharacters: st.chars, refProduct: st.product })); } }), '제품') : null),
        h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap', 'data-broll-ai-refs': '' }, p.refs.length ? p.refs.map((r) => h('div', { class: 'card flat stack', style: 'gap:4px;width:120px' },
          r.url && r.status === 'approved' ? h('img', { src: r.url, alt: r.name, style: 'width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px' }) : h('div', { class: 'sb-main-img empty', style: 'aspect-ratio:1' }, h('small', null, '없음')),
          h('div', { class: 'small' }, r.name), h('div', { class: 'small mono muted' }, r.assetId || '—'), chip(r.status === 'approved' ? '승인됨' : '필요', r.status === 'approved' ? 'done' : 'err'))) : [h('div', { class: 'small muted' }, '이 B-roll에는 참조 이미지를 붙이지 않습니다.')]),
        h('div', { class: 'card flat' }, h('div', { class: 'row between' }, h('span', { class: 'muted' }, '제공자 / 모델'), h('b', { class: 'mono' }, `${p.route.provider} / ${p.route.model || '(모델 미선택)'}`)),
          h('div', { class: 'row between' }, h('span', { class: 'muted' }, '예상 비용 (추정)'), h('b', null, p.estimate ? (p.estimate.usd == null ? '알 수 없음' : fmtUsd(p.estimate.usd)) : '—'))),
        p.approved ? h('label', { class: 'row small', style: 'gap:8px' }, h('input', { type: 'checkbox', 'data-broll-ai-overwrite': '', onchange: (e) => { st.overwrite = e.target.checked; } }), '승인된 이미지를 교체합니다 (새 이미지가 생기면 승인이 취소되며, 이전 파일은 보관됩니다)') : null,
        p.estimate && p.estimate.usd == null ? h('label', { class: 'row small', style: 'gap:8px' }, h('input', { type: 'checkbox', 'data-broll-ai-unknown': '', onchange: (e) => { st.unknown = e.target.checked; } }), '가격을 모르는 상태로 진행합니다') : null,
        h('div', { class: 'small muted' }, '실패해도 자동으로 다시 시도하지 않습니다. 버튼을 누를 때만 유료 호출이 한 번 일어납니다.'),
        status,
        h('div', { class: 'row end', style: 'gap:8px' }, h('button', { class: 'btn ghost', type: 'button', onclick: close }, '닫기'), go));
    };
    async function run() {
      if (plan.estimate && plan.estimate.usd == null && !st.unknown) return toast('가격을 모르는 상태로 진행하려면 체크하세요', { error: true });
      if (plan.approved && !st.overwrite) return toast('승인된 이미지를 교체하려면 체크하세요', { error: true });
      status.textContent = '생성 중… (이미지 모델 호출 1회)';
      body.querySelectorAll('button').forEach((x) => { x.disabled = true; });
      try {
        await api.put(`/api/episodes/${ep.id}/broll/${b.id}/image/prompt`, { prompt: st.prompt, refCharacters: st.chars, refProduct: st.product });
        await api.post(`/api/episodes/${ep.id}/broll/${b.id}/image/generate`, { confirm: { paid: true, unknownCost: !!st.unknown }, force: plan.hasImage, overwriteApproved: plan.approved && st.overwrite });
        close(); toast('B-roll 이미지를 만들었습니다 (검토 대기). 확인 후 승인하세요.');
      } catch (e) {
        status.textContent = '실패: ' + e.message + (e.recovery ? ' — ' + e.recovery : '');
        toast(e.message, { error: true, recovery: e.recovery });
        try { draw(await api.get(`/api/episodes/${ep.id}/broll/${b.id}/image/plan`)); status.textContent = '실패: ' + e.message; } catch (_) { /* keep */ }
      }
      await act(async () => null);
    }
    draw(plan);
    return h('div', { class: 'stack' }, h('h2', { style: 'margin:0' }, `${b.id} · AI 이미지 생성`), body);
  }, { wide: true });
}
