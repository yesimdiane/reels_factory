# Script Studio & Storyboard UX consolidation — audit and progress

## Phase 1 — audit (what exists today)
**There is already one copy of each piece of scene data.** The two studios are different views over the same episode record, so no schema merge or data migration is needed for the work below.

| Data | Where it lives | Edited in | Notes |
|---|---|---|---|
| scene id/order/title/duration, `visual`, `action`, `emotion`, `placement`, `showsProduct`, `characters`, `inserts`, `startImage` | `ep.scenes[]` | Script Studio (all), Storyboard (visual text in 고급 설정, product toggle/placement, start image, refs) | `visual` can be edited in both places → duplicate control, one field |
| dialogue / subtitles | `ep.lines[]` (`en` spoken, `ko` subtitle, `speaker`) | Script Studio | generation uses the speaker's voice |
| image/video prompt | `ep.prompts[sid]` (`video`, `negative`, `rev`, `edited`, `source`) | Storyboard | manual edits are flagged `edited` and kept |
| 0.5 s timeline | `ep.motion[sid].beats` (+history) | Storyboard (고급) | single timeline; also used by prompt composition (`animplan.compose`), readiness and generation → already shared |
| B-cuts | `ep.scenes[].inserts` (crop cuts) and `ep.broll[]` (B-roll stills, AI image generation, approval) | Storyboard | |
| audio | `ep.voice.lines[lineId]` + `ep.audioApprovals[sid]` | Storyboard (오디오 확인 · 승인) | |
| sound effects | `ep.sfx[]` (scene-bound, `offsetSec`) | Storyboard (효과음 · 씬 합본) | HeyGen: catalog **search** only (no generation) |
| approvals | `approvals.script`, `approvals.storyboard` (v2 per scene/field), scene approval, `audioApprovals`, `sceneFinal`, clip `approvedVersion` | | unrelated metadata/UI changes do not invalidate (tests: `readiness-workflow`) |

## Done in this PR
- **Approved scene gallery** (Storyboard top): story-ordered 9:16 thumbnails, approval state (sage ✓ approved / clay unapproved / dashed rose missing — missing ones are highlighted, never hidden), compact `+N` B-cut count (B-cut images are not listed), click opens the scene, 🔍 full-size preview with prev/next, **비교** side-by-side comparison with scene pickers and the original uploaded filename. Reuses stored assets only; it never generates anything.
- **Approval UX**: a scene with an approved start image collapses its image/prompt editors (참조 이미지, 제품, 프롬프트, 고급) into a compact sage summary with `이미지·프롬프트 수정 열기`; the later production steps (오디오, 애니메이션, 컷, 효과음·합본) stay available. Readiness/jump links reopen the collapsed section automatically.
- Mobile: the gallery scrolls horizontally with snap; one scene editor at a time (existing).
- Tests: `tests/scene-gallery-browser.test.js`.

## Not done yet (honest list)
- Script Studio three-section redesign (Visual Direction with visible vs reference-only characters and B-cut concept tab; reorderable dialogue/subtitle/action/expression/camera/SFX assets with duplicate + drag; 0.5 s CCTV-style beat editor inside Script Studio).
- Script-side SFX library with preview (the search/upload/built-in sources already exist in the Storyboard scene panel and can be reused).
- Removing the duplicated `visual` text control from Storyboard 고급 설정.
- Storyboard image-prompt builder with structured sections (background, characters, body actions, emotions, optional facial/camera panels, recommended shot types), start-image "delete generated image" (must keep reference assets), voice selection per scene in the audio panel.
- Dedicated regression run of the PRD-001 episode through every step.

These are separate PRs; each keeps `ep.*` as the single source of truth and adds no paid call without its existing confirmation dialog.
