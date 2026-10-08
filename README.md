# Seoul Home Reels Factory

Low-cost Instagram home-decor affiliate reels production workflow.

## Objective
Turn a verified product entry into three distinct 9:16 short-form video concepts, assemble approved assets with voiceover and captions, and prepare for human-reviewed Instagram publishing and ManyChat comment-to-DM.

## Stack
- Google Sheets: PRODUCTS, REELS, PERFORMANCE
- Gemini: structured script and Flow scene prompts
- Google Flow: manually generate supplemental video clips within available credits
- Google Drive: licensed source assets and generated outputs
- Google Apps Script: Sheets menus and workflow coordination
- FFmpeg: low-cost final rendering
- ManyChat: post-specific keyword-to-affiliate-link automation

## MVP workflow
1. Enter a product in PRODUCTS.
2. Generate three distinct REELS records using verified facts only.
3. Review source permissions and create scene prompts.
4. Generate Flow clips manually and upload MP4 files to Drive.
5. Assemble clips, narration, subtitles, disclosure and CTA.
6. Review the finished MP4 before publishing.
7. Match the Instagram post with its correct ManyChat keyword and affiliate link.

## Implementation status
- [x] Sheets schema — [docs/sheets-schema.md](docs/sheets-schema.md)
- [x] Apps Script menu: selected PRODUCTS row → Gemini → 3 validated REELS rows — [`apps-script/`](apps-script)
- [x] Fact / number / duplicate-ID validation with errors recorded in the LOG sheet
- [x] Scene-level Google Flow prompts (Flow generation stays **manual**)
- [ ] FFmpeg render workflow
- [ ] ManyChat integration

Setup and tests: [docs/setup.md](docs/setup.md). Run `npm test` locally (Node ≥ 20, no dependencies).

## First product
PRD-001 — 리템 우산꽂이 자석형 (magnetic umbrella holder).
Confirmed features: magnetic attachment to compatible steel surfaces; separate top and bottom pieces (190×55×50 mm and 188×55×82 mm); accommodates long and folding umbrellas; dark gray, gray, white variants.
Asset URL and actual reuse/AI-edit permissions must be verified, not inferred from marketplace availability.

## Collaboration
- ChatGPT: requirements, architecture, issue tracking, reviews.
- Claude Code: implementation and pull requests.
- Gemini: script and scene prompt generation.
- Operator: Flow generation, permissions, final content approval.

Never commit API keys, tokens, private customer data, or affiliate account credentials.
