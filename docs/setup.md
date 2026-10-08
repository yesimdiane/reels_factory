# Setup — Sheets → Gemini → 3 reel scripts

## 1. Prerequisites

- The Google Sheet with the existing **PRODUCTS** sheet (headers A–I as in [sheets-schema.md](sheets-schema.md)).
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey). The free tier is enough for testing.

## 2. Install the Apps Script code

**Option A — copy/paste (no tools)**

1. Open the spreadsheet → **Extensions → Apps Script**.
2. Create one script file per file in [`apps-script/`](../apps-script) with the same name
   (`Code`, `Config`, `Validation`, `Reels`, `Prompt`, `Gemini`, `Sheets`, `Fixtures`) and paste the contents.
3. **Project Settings → Show "appsscript.json" manifest file in editor**, then replace `appsscript.json` with the repository version
   (sets V8, Asia/Seoul time zone and minimal OAuth scopes).
4. Save.

**Option B — clasp**

```bash
npm install -g @google/clasp
clasp login
# Script ID: Apps Script editor → Project Settings → IDs
clasp clone <SCRIPT_ID> --rootDir apps-script   # creates .clasp.json (git-ignored)
clasp push
```

## 3. Store the API key (never in the sheet or Git)

Either:

- Reload the spreadsheet → menu **릴스 팩토리 → Gemini API 키 설정** and paste the key, or
- Apps Script → **Project Settings → Script Properties → Add property**: `GEMINI_API_KEY` = your key.

Optional property `GEMINI_MODEL` (default `gemini-2.5-flash`). Use any model ID that supports
`generateContent` with JSON `responseSchema`; check the current list in AI Studio.

## 4. Prepare the sheets

Menu **릴스 팩토리 → 시트 준비 (REELS / PERFORMANCE / LOG)**.
This verifies PRODUCTS headers (read only) and creates REELS, PERFORMANCE and LOG if they don't exist.
Existing sheets are only checked, never rewritten.

The first menu run asks for authorization:
- *See, edit … spreadsheets that this application has been installed in* (current spreadsheet only)
- *Connect to an external service* (Gemini API)
- *Display and run third-party web content in prompts and sidebars* (menu dialogs)

## 5. Generate scripts

1. In **PRODUCTS**, fill 확인된 기능 with one verified fact per line.
2. Click any cell in the product's row.
3. Menu **릴스 팩토리 → 선택한 상품으로 릴스 대본 3개 생성**.
4. Three rows appear in **REELS** with status `대본 검토 대기`. If validation fails twice, nothing is written and the
   reasons plus the raw Gemini response are in **LOG**.

Next (manual) steps: review the script → generate clips in Google Flow using the `Flow 프롬프트` column →
upload approved MP4s to Drive. Keep publishing and ManyChat link sending under human review.

## 6. Tests

### Local (no Google account, no API key)

```bash
npm test
```

Runs `tests/reels.test.js` (validation, IDs, keywords, prompt) and `tests/workflow.test.js`
(the full menu action against in-memory Sheets / Gemini mocks, checking that PRODUCTS is never modified)
using the PRD-001 fixture in `apps-script/Fixtures.gs`. Requires Node.js ≥ 20, no dependencies.

### In the spreadsheet

- **테스트: PRD-001 오프라인 검증** — validates the bundled sample response; no API call, no sheet writes.
- **테스트: PRD-001 Gemini 실제 호출 (시트에 쓰지 않음)** — calls Gemini with the PRD-001 fixture and validates the
  real response. Writes the result only to LOG, never to REELS.

### PRD-001 manual acceptance test

Add this row to PRODUCTS (if PRD-001 is not already there), select it, and run the generate menu:

| 상품ID | 상품명 | 확인된 기능 (one per line) | 영상 사용 허가 상태 |
|---|---|---|---|
| PRD-001 | 리템 우산꽂이 자석형 | 호환되는 철제 표면에 자석으로 부착 가능<br>상단·하단 분리형 (상단 190×55×50mm, 하단 188×55×82mm)<br>장우산과 접이식 우산 모두 수납 가능<br>색상: 다크그레이, 그레이, 화이트 | 미확인 |

Expected:
- REELS gains `PRD-001-R01..R03` (or the next free numbers), keywords `PRD001R01..R03`, each with the
  affiliate disclosure, a CTA containing its keyword, `Flow 생성 = 수동 생성 필요 …`, and a 검토 메모 warning that video
  permission is unverified.
- No number other than 190, 55, 50, 188, 82 appears in hooks, narration, captions or on-screen text.
- PRODUCTS is unchanged.
