
## Scene start images (AI)
Dashboard (오늘의 제작 현황 → "장면별 시작 이미지") and Storyboard (모든 장면 / 장면별 "시작 이미지 만들기") create one 2D anime/webtoon first frame per scene with the Gemini image route ("제품 이미지 생성" task in Settings).
- Inputs: the scene's visual/action text, the approved **non-placeholder** character references of the scene's cast (exact head-count rules), and — only when the scene shows the product — the approved product reference images and verified facts.
- Backend gates: the script must be **approved**; the estimated cost is shown and must be confirmed; spend limits apply; all pre-flight problems (e.g. no real character reference) are reported before the first paid call.
- Results are saved as **unapproved** start frames; approve each one in Storyboard ("이 프레임 승인") before video generation can use it. An approved frame is never overwritten; a scene that already has an AI frame is skipped unless you pick "다시 만들기"; files are never deleted.
- Each scene is saved before the next paid call, so a failure part-way keeps (and never re-bills) the frames already made.
- Blocker: needs a Gemini key and an image-capable model; without them the buttons show the blocker (no placeholder frame is created).
