# Rendering reels (FFmpeg + Google Cloud Text-to-Speech)

The renderer turns an **approved** script into a 1080×1920 MP4. Each MP4 has:

- Korean narration from Google Cloud TTS;
- subtitles synced to the voice;
- a headline for each scene;
- a conspicuous `[광고]` Coupang Partners disclosure for the **whole** video;
- a CTA end card with the post's ManyChat keyword.

It runs on your Mac today. The same code runs in a container (Cloud Run) later, with only configuration changes.

```
Dashboard (approved, "영상 제작 중")
   │ 렌더 작업 파일 (Mac)  ← signed by the Sheet; valid 72 h; contains no links or keys
   ▼
renderer/cli.js
   1. approval gate ── signature · status · approved-script fingerprint · permission · expiry
   2. pre-flight ───── Flow clips present? FFmpeg can burn Korean subtitles?
   3. budget ───────── per-job and monthly character caps (paid voices only)
   4. TTS ──────────── per sentence, cached by content: a sentence is never paid for twice
   5. FFmpeg ───────── scenes → 9:16, ASS overlay, narration mix, loudness −16 LUFS, H.264/AAC
   ▼
renderer/output/<릴스ID>/v<대본버전>-<지문>-final/<릴스ID>_script-v<N>.mp4  +  manifest.json
   │ you upload to Drive → dashboard "완성 MP4 등록" → ③ video review on iPhone
```

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
  - `--preview` renders with the **free local Mac voice (Yuna)** and placeholder visuals, so you can check timing and layout at no cost. The output is watermarked "게시 금지" and named `_PREVIEW`.

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

1. **iPhone (or browser):**
   - Approve the script (②).
   - Make sure PRODUCTS `영상 사용 허가 상태` is `허가 완료`, or `자체 제작` if you only use your own or AI-generated footage.
   - Tap **영상 제작 시작**.
2. **Google Flow (manual):**
   - Generate one clip per scene from the **Google Flow 프롬프트** in the dashboard.
   - Save them as `renderer/clips/<릴스ID>/S1.mp4`, `S2.mp4`, …
   - Clips can be any aspect ratio: they are center-cropped to 9:16, looped or trimmed to fit, and their audio is dropped.
3. **Mac:**
   - In the dashboard, tap **렌더 작업 파일 (Mac)**.
   - Save it as `renderer/jobs/<릴스ID>_v<N>.render-job.json`.
   - Then run:
   ```bash
   npm run render:estimate -- --job renderer/jobs/PRD-001-R01_v1.render-job.json          # free
   npm run render -- --job renderer/jobs/PRD-001-R01_v1.render-job.json --preview         # free, local voice
   npm run render -- --job renderer/jobs/PRD-001-R01_v1.render-job.json                   # final, Google TTS
   ```
4. **Review:**
   - Upload the final MP4 (not `_PREVIEW`) to Google Drive.
   - In the dashboard, tap **완성 MP4 등록** and paste the Drive link.
   - Review on iPhone (③).

`manifest.json` next to each MP4 records:
- the approved fingerprint and script version;
- TTS voice, characters and estimated cost;
- the timeline;
- the clip sources;
- the FFmpeg version;
- the SHA-256 of the output.

## Sample (PRD-001)

```bash
npm run render:sample
```

This runs the real approval flow on an in-memory copy of the Sheet with the PRD-001 fixture script. It then renders a **preview** with the free local voice and placeholder visuals. It needs no Google account and costs $0.

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
| `Flow 클립이 없습니다` | Put `S1.mp4…Sn.mp4` in `renderer/clips/<릴스ID>/`, or use `--preview`. |
| `ass 필터 (libass)` missing | Install `ffmpeg-full` (see Mac setup). |
| `Google TTS 오류 HTTP 403` | Enable the Text-to-Speech API, link billing, and check the API key restriction. |
| Korean text shows boxes | Set `RF_FONT_NAME` to an installed Korean font, or `RF_FONTS_DIR` to a folder containing one (e.g. Noto Sans KR). |
