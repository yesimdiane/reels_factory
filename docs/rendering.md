# Rendering reels (video-first, FFmpeg + Google Cloud Text-to-Speech)

The renderer turns an **approved storyboard** and **approved footage** into a 1080×1920 lifestyle reel.

- **Footage:** full-screen 9:16 footage of the real product in use, with a hard cut every 2–4 s.
- **Voice and subtitles:** Korean narration (Google Cloud TTS), one short line per scene. Each line is shown as a **white bold subtitle with a thin black outline** in the lower-middle safe area, at most 2 lines.
- **Disclosure:** the full Coupang Partners sentence at the **start and end**, with a small `광고` tag in between. No banners, headlines, slides or animations.

It runs on your Mac today. The same code runs in a container (Cloud Run) later, with only configuration changes.

```
Approved script (storyboard: HOOK → PROBLEM → DEMO → BENEFIT → CTA, one narration line per scene)
   │ 렌더 작업 파일 (Mac)  ← signed by the Sheet; valid 72 h; no links or keys
   ▼
renderer/cli.js render
   1 approval gate ── signature · status · approved-script fingerprint · permission · expiry
   2 storyboard ───── beats → shots (2–4 s each, e.g. a 6 s beat = 2 cuts); {키워드} → ManyChat keyword
   3 pre-flight QC ── structure · CTA keyword · shot lengths · ≤2-line subtitles inside the safe area
   4 footage ──────── clips/<릴스ID>/assets.json: every shot present, allowed source, real product where
                      required, ≥720p, not solid-colour, not a still image  → otherwise ASSETS_REQUIRED
   5 FFmpeg check · 6 reuse · 7 TTS (budget-checked, cached, one line per scene)
   8 render ───────── scale/crop each shot to fill 9:16, hard cuts, subtitles, disclosure, narration −16 LUFS
   9 post-render QC ─ 1080x1920 · H.264/yuv420p · 30 fps · AAC · duration · every shot from an asset
   ▼
renderer/output/<릴스ID>/v<N>-<지문>-<footage>-lifestyle-v1-final/<릴스ID>_script-v<N>.mp4 + manifest.json
```

There is **no code path that draws coloured slides or placeholder visuals**. With no approved footage, the job stops with `ASSETS_REQUIRED` (exit code 3) and writes:
- `clips/<릴스ID>/SHOTLIST.md`: every cut to film or generate, its line, minimum length and allowed source;
- `assets.template.json`: a starting point for the footage manifest.

## What separates what

| Piece | Where | Reusable across products |
|---|---|---|
| Visual template (canvas, safe area, subtitle style, shot length, disclosure, asset rules) | `renderer/templates/lifestyle-v1.json` | Yes. Copy it to make another look; select with `--template` or `RF_TEMPLATE`. |
| Storyboard (beats, lines, scene timing, visual descriptions) | Approved script in REELS (`장면(JSON)`) | Generated per product by Gemini, approved by you |
| Scene assets (footage + provenance) | `renderer/clips/<릴스ID>/assets.json` + clips | Per reel |
| Narration | Google Cloud TTS, cached per line in `~/.reels-factory/cache` | Per line |
| Rendering configuration (voice, caps, FFmpeg, font, paths) | `renderer/.env` / environment variables | Per machine |

## Footage rules (`assets.json`)

```json
{
  "reelId": "PRD-001-R01",
  "shots": {
    "S1-1": { "file": "S1-1.mp4", "source": "flow-generated", "showsProduct": false, "in": 0 },
    "S2-1": { "file": "S2-1.mp4", "source": "own-footage", "showsProduct": true, "rights": "직접 촬영 2026-10-09", "in": 1.2 }
  }
}
```

- **`source`:**
  - `own-footage` (you filmed it);
  - `licensed` (written permission; `rights` is required);
  - `flow-generated` (Google Flow, only after approval).

  Anything else, including marketplace or Coupang listing videos, is rejected.
- **Real-product beats:** **DEMO, BENEFIT and CTA** shots must show the **real product** (`showsProduct: true`) from `own-footage` or `licensed`. AI-generated clips may only be used for HOOK/PROBLEM context shots, so demonstrations stay truthful.
- **Clip checks:**
  - short side ≥ 720 px;
  - at least the length in SHOTLIST (each shot plus 1 s headroom);
  - automatically rejected if mostly a single colour or if it does not move (a still image saved as video).
- **`in`:** the second in the clip where the cut starts. Clip audio is not used.
- **Re-rendering:** after you change footage, the renderer re-renders, but the narration comes from the cache ($0).

## Keyword and disclosure

- **Keyword:** the CTA line is written as `… 댓글에 '{키워드}'` and replaced with the reel's **ManyChat 키워드** (e.g. `우산`). QC fails if the CTA subtitle doesn't contain this reel's keyword. Change the keyword in REELS **before** approving; it is part of the approved fingerprint.
- **Disclosure:** the full sentence (`광고 표기`) appears during the first 2.5 s and the last scene, and a small `광고` tag in between. This follows Korean FTC (공정위) guidance for videos: start and end, visible to people who join mid-video. To remove the in-between tag, set `disclosure.persistentTag.enabled` to `false` in the template. The Instagram caption keeps `[광고]` on its first line, and you should also turn on Instagram's paid-partnership label.
- **Emoji:** emoji in a line (e.g. ☂️) are removed from the burned subtitle and the voice, because the font and TTS don't support them. QC reports this as a warning. Put emoji in the Instagram caption instead.

## No paid assets before script approval

| What costs money | When it can happen |
|---|---|
| Google Cloud TTS (narration) | Only after steps 1–3 pass. A render job can only be issued by the Sheet for a reel that is **approved, unchanged since approval, permission-verified and in production**. The renderer re-checks all of this. Unsigned, edited, expired or unapproved jobs stop with `승인 확인 실패 (비용 발생 없음)`. |
| Google Flow credits (clips) | Flow is manual. The dashboard only lets you copy Flow prompts after the script is approved. |
| Gemini | Only for generating or regenerating scripts (text). It is never used for video. |

Steps 2 and 3 run **before** TTS on purpose. A render that would fail anyway, because of missing clips or a broken FFmpeg, never spends characters.

## Keeping cost minimal

- **Default voice `ko-KR-Wavenet-A`.** WaveNet is one of the two cheapest Korean voice families (Standard and WaveNet). You can switch to Neural2 or Chirp 3 HD with `RF_TTS_VOICE` for better quality at a higher price.
- **Rough cost:** one reel narration is about 100–200 characters. At the approximate prices below, that is about $0.0004–0.0008 per reel, and well inside the monthly free allowance.

  | Voice family | ≈ USD per 1M characters | Free allowance / month |
  |---|---|---|
  | Standard, WaveNet | 4 | ~4M |
  | Neural2 | 16 | ~1M |
  | Chirp 3 HD | 30 | ~1M |

  These figures are from third-party summaries. **Check the [official pricing page](https://cloud.google.com/text-to-speech/pricing)** before relying on them. A billing account is required even for the free tier.
- **Cache:** re-rendering after a "영상 수정 요청" (new clips, same script) reuses the cached narration at **$0**. An identical re-render is skipped entirely (`--force` to override).
- **Caps:** `RF_TTS_MAX_CHARS_PER_JOB` (default 1500) and `RF_TTS_MONTHLY_CHAR_LIMIT` (default 500,000) stop the render **before** any call. Usage is recorded in `~/.reels-factory/tts-usage.json`; `npm run render:usage` shows it.
- **Free checks first:**
  - `npm run render:estimate -- --job <file>` verifies approval and prints the exact billable characters and estimated cost. It makes no API calls.
  - `--preview` renders your real footage with the **free local Mac voice (Yuna)**, so you can check timing before paying for Google TTS. The output is marked "미리보기 음성" and named `_PREVIEW`. It never adds placeholder visuals.

## Mac setup (once, about 20 minutes)

1. **Tools.**
   ```bash
   brew install node ffmpeg
   npm run render:check        # from the repo folder
   ```
   If `check` reports that the `ass` filter is missing (Homebrew slimmed its `ffmpeg` formula in 2026):
   ```bash
   brew install ffmpeg-full
   ```
   Then add the two paths it prints to `renderer/.env`:
   - `RF_FFMPEG=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg`
   - `RF_FFPROBE=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe`
2. **Google Cloud TTS key.** In [Google Cloud console](https://console.cloud.google.com/):
   - Create a project, then **Billing** → link a billing account.
   - **APIs & Services → Library → "Cloud Text-to-Speech API" → Enable**.
   - **Credentials → Create credentials → API key**, then **Edit**:
     - API restrictions → *Restrict key* → only **Cloud Text-to-Speech API**.
   - Optional but recommended: **Billing → Budgets & alerts**, e.g. a ₩5,000 monthly budget with email alerts.
3. **Configure the renderer.**
   ```bash
   cp renderer/.env.example renderer/.env
   ```
   Then fill in `renderer/.env`:
   - `GOOGLE_TTS_API_KEY=` → the key from step 2.
   - `RF_RENDER_SECRET=` → from Google Sheets menu **릴스 팩토리 → 렌더 키 보기**.

   `renderer/.env` is git-ignored. Never commit it or paste it into chats.
4. **Check (free).** Run `npm run render:check`. It should show ✓ for FFmpeg, the font (Apple SD Gothic Neo), TTS, and the render key.

## Rendering a reel

1. **iPhone:**
   - Approve the storyboard (②). Check each scene line and the CTA keyword.
   - Make sure PRODUCTS `영상 사용 허가 상태` is `허가 완료` (permission obtained) or `자체 제작` (your own footage).
   - Tap **영상 제작 시작**.
2. **Mac:** download the job via **렌더 작업 파일 (Mac)** into `renderer/jobs/`, then run (free):
   ```bash
   npm run render:estimate -- --job renderer/jobs/PRD-001-R01_v1.render-job.json
   ```
   This lists the QC checks, the footage status and the TTS cost.
3. **Footage:** if footage is missing, `npm run render -- --job …` stops with `ASSETS_REQUIRED` and writes `renderer/clips/<릴스ID>/SHOTLIST.md`.
   - Film the real-product shots with your iPhone (9:16, 4K/1080p, 30 fps). Generate HOOK/PROBLEM context shots in Flow if you like.
   - Name the files as in the list.
   - Copy `assets.template.json` to `assets.json` and fill in `source` and `rights`.
4. **Preview and final:**
   ```bash
   npm run render -- --job renderer/jobs/PRD-001-R01_v1.render-job.json --preview   # free local voice
   npm run render -- --job renderer/jobs/PRD-001-R01_v1.render-job.json             # Google TTS
   ```
5. **Review:** upload the final MP4 (not `_PREVIEW`) to Drive, tap **완성 MP4 등록**, and review it on iPhone (③).

Exit codes:

| Code | Meaning |
|---|---|
| 0 | done |
| 2 | approval, budget or script-format gate (no cost) |
| 3 | `ASSETS_REQUIRED` (no cost) |
| 4 | QC failed (file kept as `_QC_FAILED`) |
| 1 | other |

## Sample (PRD-001)

```bash
npm run render:sample                                   # → ASSETS_REQUIRED + SHOTLIST until footage exists
npm run render:sample -- --clips renderer/clips         # with your footage, free preview voice
npm run render:sample -- --clips renderer/clips --tts google   # final voice (GOOGLE_TTS_API_KEY)
```

This runs the real approval flow on an in-memory copy of the Sheet with the PRD-001 storyboard and the keyword `우산`. The sample includes no footage, so it stops with `ASSETS_REQUIRED` and writes the 7-cut shot list until you add real clips.

## Moving to the cloud later

The renderer core does not change. Only the adapters and configuration differ:

| Concern | Mac (now) | Cloud (later, e.g. Cloud Run Job) |
|---|---|---|
| Runtime | `node renderer/cli.js` | `renderer/Dockerfile` (Debian FFmpeg with libass + Noto Sans CJK) |
| TTS auth | `GOOGLE_TTS_API_KEY` | Attached service account (`RF_TTS_AUTH=metadata`, picked automatically on Cloud Run). No key to manage. |
| Jobs, clips, outputs | Local folders | Cloud Storage bucket mounted as a volume (`/mnt/clips`, `/mnt/output`, job file path) |
| Cache + usage ledger | `~/.reels-factory` | `RF_STATE_DIR=/mnt/state` on the mounted bucket, so caching and caps keep working across runs |
| Approval gate | Same signed job + same `apps-script/*.gs` fingerprint code | Same |

Planned follow-ups, kept out of this PR to keep it reviewable:
- a Drive/GCS storage adapter, so you no longer upload manually;
- a signed "register video" call, so the dashboard picks up renders automatically;
- a queue trigger.

## Troubleshooting

| Message | Fix |
|---|---|
| `승인 확인 실패 … 서명이 맞지 않습니다` | `RF_RENDER_SECRET` differs from the Sheet's key, or the job file was edited. Download a new job file. |
| `작업 파일이 만료되었습니다` | Job files are valid for 72 h. Download a new one. |
| `대본 내용이 승인된 버전과 다릅니다` | The script was edited after approval. Re-approve it in the dashboard. |
| `ASSETS_REQUIRED` | Follow `renderer/clips/<릴스ID>/SHOTLIST.md`; fill `assets.json`. |
| `QC 실패 … subtitle…lines` | A scene line is longer than 2 lines; shorten it in the dashboard editor and re-approve. |
| `대본 형식` | The script predates storyboards; use "수정 요청" → Gemini 재생성, then approve again. |
| `ass 필터 (libass)` missing | Install `ffmpeg-full` (see Mac setup). |
| `Google TTS 오류 HTTP 403` | Enable the Text-to-Speech API, link billing, and check the API key restriction. |
| Korean text shows boxes | Set `RF_FONT_NAME` to an installed Korean font, or `RF_FONTS_DIR` to a folder containing one (e.g. Noto Sans KR). |
