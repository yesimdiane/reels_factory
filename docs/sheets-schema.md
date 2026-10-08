# Google Sheets schema

The Apps Script code finds every column **by its row-1 header name**, not by position.
Columns can be reordered and extra operator columns can be added. Header matching ignores spaces and letter case
(`상품 ID` = `상품ID`), and tab names tolerate surrounding spaces / case (`Products ` = `PRODUCTS`); otherwise the words must match.

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

If a REELS tab already exists without some of these headers, **시트 준비** offers to append only the missing headers
to the right end of row 1 (after confirmation; existing cells are never changed).

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
| 제작 상태 | code | Korean label of 상태 (e.g. `대본 검토 대기`). MVP-era rows with only this column are read as `SCRIPT_REVIEW_PENDING`. |
| 검토 메모 | code | Permission warning (if unverified) and the human-review reminder. |
| 생성 모델 | code | Gemini model ID used. |
| 생성일시 | code | Timestamp. |

### Approval columns (appended after the MVP columns by 시트 준비)

| Header | Written by | Description |
|---|---|---|
| 상태 | state machine | Status code. See [iphone-dashboard.md](iphone-dashboard.md#status-flow) for the flow. |
| 대본 버전 | state machine | Starts at 1. Each edit or regeneration adds 1. |
| 승인 대본 버전 | ② approve | The version that was approved. It is cleared when the script changes or the approval is cancelled. |
| 승인 대본 해시 | ② approve | Fingerprint of all script cells (컨셉 … 사용한 확인 기능, Flow 프롬프트, CTA, ManyChat 키워드, 광고 표기). Video and publishing steps require it to match the current cells. |
| 대본 검토자 / 대본 검토일시 / 대본 검토 메모 | ② | Who decided, when, and why. |
| 영상 버전 | registering an MP4 | Adds 1 for each MP4 registered for review. |
| 영상 파일 URL | registering an MP4 | Google Drive link to the MP4 being reviewed. |
| 영상 검토자 / 영상 검토일시 / 영상 검토 메모 | ③ | Who decided, when, and why. |
| 게시 확인일시 / ManyChat 설정 확인일시 | ④ | Manual confirmations. The reel becomes `COMPLETED` once both are set. |
| 인스타그램 URL | ④ | Optional link to the published post. |
| 오류 | system | Last blocking error, e.g. a missing Partners link or a render failure. |

Script cells are written with plain-text number format, so Sheets never turns script text into numbers or dates.

## AUDIT (created by the script; append-only)

| Header | Description |
|---|---|
| 일시 | Timestamp |
| 릴스ID / 상품ID | |
| 작업 | One of: `PRODUCT_SUBMITTED` (①), `SCRIPTS_GENERATED`, `APPROVE_SCRIPT`, `EDIT_SCRIPT`, `REQUEST_SCRIPT_CHANGES`, `REGENERATE_SCRIPT`, `REJECT_SCRIPT`, `REOPEN_SCRIPT`, `START_VIDEO`, `REGISTER_VIDEO`, `MARK_VIDEO_FAILED`, `APPROVE_VIDEO`, `REQUEST_VIDEO_CHANGES`, `REJECT_VIDEO`, `READY_TO_PUBLISH_BLOCKED`, `RENDER_JOB_ISSUED`, `MARK_READY_TO_PUBLISH`, `CONFIRM_PUBLISHED`, `CONFIRM_MANYCHAT` |
| 이전 상태 / 새 상태 | Status codes |
| 대본 버전 / 영상 버전 | Versions after the action |
| 작업자 | Google account email, `Gemini (<model>)`, or `system` |
| 메모 | Reviewer note or blocking reason |
| 스냅샷(JSON) | For script actions, the exact script cells (the approved snapshot is kept here). For video actions, the video link. |

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
