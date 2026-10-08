# Google Sheets schema

The Apps Script code finds every column **by its row-1 header name**, not by position.
Columns can be reordered and extra operator columns can be added; required headers must keep their exact names.

The script **never edits the PRODUCTS sheet** and never rewrites an existing header row.
If a required header is missing it stops with an error naming the missing header.

## PRODUCTS (existing — read only)

| Col | Header | Required for generation | Notes |
|---|---|---|---|
| A | 상품ID | yes | Format `PRD-###` (e.g. `PRD-001`). Must be unique in the sheet. |
| B | 상품명 | yes | |
| C | 카테고리 | no | Context for the prompt only. |
| D | 확인된 기능 | yes | **One verified fact per line** (or separated by `;`). These are the only facts Gemini may use. Commas are kept, so `색상: 다크그레이, 그레이, 화이트` is one fact. |
| E | 타깃 | no | Context for the prompt only. |
| F | 쿠팡파트너스 URL | no | Never sent to Gemini, never placed in scripts. Used later by ManyChat. |
| G | 영상 소스 URL | no | Not sent to Gemini. |
| H | 영상 사용 허가 상태 | no | Copied to REELS. Only `허가`, `허가됨`, `승인`, `승인됨`, `확인 완료`, `허가 완료` count as verified; anything else adds a warning to the reel's 검토 메모. Marketplace availability is **not** permission. |
| I | 제작 상태 | no | Not modified by the script. |

## REELS (created by the script if missing)

One row per reel script. Three rows are appended per generation run, in a single write, only after all three pass validation.

| Header | Source | Description |
|---|---|---|
| 릴스ID | code | `{상품ID}-R{nn}` e.g. `PRD-001-R01`. Continues after the highest existing number for that product; never reused. |
| 상품ID | PRODUCTS | |
| 버전 | code | 1–3 within the generation run. |
| 컨셉 | Gemini | Distinct per reel. |
| 후킹 | Gemini | ≤ 40 chars. Distinct per reel. |
| 내레이션 | Gemini | ≤ 300 chars voiceover. |
| 자막 | Gemini | On-screen caption lines, newline separated, each ≤ 40 chars. |
| 장면(JSON) | Gemini | JSON array of `{scene_no, duration_sec, visual, on_screen_text, flow_prompt}`; 3–6 scenes, 10–40 s total. |
| Flow 프롬프트 | Gemini | `S{n} ({sec}s): <English prompt>` per line, for pasting into Google Flow. |
| Flow 생성 | code | Always `수동 생성 필요 …`. Google Flow is **not** called through the Gemini API; an operator generates clips manually. |
| CTA | code | `댓글에 "{키워드}" 남기면 상품 링크를 DM으로 보내드려요.` |
| ManyChat 키워드 | code | Post-specific keyword, `{릴스ID without dashes}` e.g. `PRD001R01`. Must be unique across REELS (checked case-insensitively). The operator may change it before publishing but must keep it unique and update ManyChat to match. |
| 광고 표기 | code | Fixed Coupang Partners disclosure: `이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.` |
| 사용한 확인 기능 | Gemini (validated) | Exact lines from PRODUCTS.확인된 기능 the reel relies on. |
| 영상 사용 허가 상태 | PRODUCTS | Snapshot of column H at generation time (`미확인` if blank). |
| 제작 상태 | code | Starts at `대본 검토 대기`. |
| 검토 메모 | code | Permission warning (if unverified) and the human-review reminder. |
| 생성 모델 | code | Gemini model ID used. |
| 생성일시 | code | Timestamp. |

## PERFORMANCE (created by the script if missing; filled manually for now)

| Header | Description |
|---|---|
| 릴스ID | Links to REELS.릴스ID |
| 게시일 | Instagram publish date |
| 인스타그램 URL | |
| 조회수 / 좋아요 / 댓글 / 저장 / 공유 | Instagram insights |
| ManyChat DM 발송수 | DMs sent for this reel's keyword |
| 링크 클릭수 | Coupang Partners clicks |
| 주문수 | |
| 수익(원) | |
| 메모 | |

## LOG (created by the script if missing)

| Header | Description |
|---|---|
| 일시 | Timestamp |
| 레벨 | `INFO`, `WARN` (validation failed, retrying), `ERROR` |
| 작업 | `generateReels`, `validateGemini`, `setupSheets`, `liveTestPRD001` |
| 상품ID | |
| 메시지 | Short actionable summary |
| 상세 | All validation errors plus the raw Gemini response, or a stack trace |

## Validation rules applied to Gemini output

A run writes nothing to REELS unless **all** of these pass (one corrective retry is made, with the errors fed back to Gemini):

- Valid JSON with exactly 3 reels and all required fields.
- Length limits for hook, narration, captions; 3–6 scenes numbered 1..n; total duration 10–40 s; every scene has a Flow prompt (≥ 30 chars).
- `facts_used` is non-empty and each entry exactly matches a line of 확인된 기능.
- Every number in viewer-facing text (hook, narration, captions, on-screen text) appears in 확인된 기능 or 상품명 — blocks invented specs, prices, ratings.
- No exaggerated phrases (`최저가`, `100%`, `무조건`, `완벽`, `1위`, `품절 임박`, … see `CONFIG.BANNED_PHRASES`).
- No URLs in viewer-facing text (links go via ManyChat DM only).
- Concepts and hooks are distinct across the three reels.
- New 릴스ID / ManyChat 키워드 do not collide with existing rows; existing duplicates in REELS or duplicate 상품ID in PRODUCTS stop the run.
