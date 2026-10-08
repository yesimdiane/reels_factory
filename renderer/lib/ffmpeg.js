// FFmpeg/FFprobe wrappers. Capability check runs before any paid step.
'use strict';
const { execFile } = require('node:child_process');

function run(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 64 * 1024 * 1024, cwd: opts.cwd }, (err, stdout, stderr) => {
      if (err) {
        const tail = String(stderr || '').split('\n').slice(-15).join('\n');
        reject(new Error(bin + ' 실패 (' + (err.code ?? err.message) + '):\n' + tail));
      } else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** Ensures the FFmpeg build can burn ASS subtitles and encode H.264/AAC. */
async function checkFfmpeg({ ffmpeg, ffprobe }) {
  let filters;
  let encoders;
  try {
    filters = (await run(ffmpeg, ['-hide_banner', '-filters'])).stdout;
    encoders = (await run(ffmpeg, ['-hide_banner', '-encoders'])).stdout;
    await run(ffprobe, ['-version']);
  } catch (e) {
    throw new Error('FFmpeg를 실행할 수 없습니다. Mac: brew install ffmpeg (자막 필터가 없으면 brew install ffmpeg-full 후 RF_FFMPEG/RF_FFPROBE를 그 경로로 설정).\n' + e.message);
  }
  const missing = [];
  if (!/\sass\s/.test(filters)) missing.push('ass 필터 (libass)');
  if (!/\sgradients\s/.test(filters)) missing.push('gradients 필터');
  if (!/libx264/.test(encoders)) missing.push('libx264 인코더');
  if (!/\saac\s/.test(encoders)) missing.push('aac 인코더');
  if (missing.length) {
    throw new Error(
      '이 FFmpeg 빌드에 필요한 기능이 없습니다: ' + missing.join(', ') +
        '\nMac: brew install ffmpeg-full 후 renderer/.env에 RF_FFMPEG=$(brew --prefix ffmpeg-full)/bin/ffmpeg, RF_FFPROBE=$(brew --prefix ffmpeg-full)/bin/ffprobe 설정'
    );
  }
  const version = (await run(ffmpeg, ['-hide_banner', '-version'])).stdout.split('\n')[0];
  return { version };
}

async function probe(ffprobe, file) {
  const { stdout } = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate', '-of', 'json', file]);
  const j = JSON.parse(stdout);
  return { duration: Number(j.format.duration), streams: j.streams };
}

/** Places each narration sentence at its planned start, pads to the full length, normalises loudness. */
async function buildNarrationTrack({ ffmpeg }, plan, outFile, cwd) {
  const args = ['-hide_banner', '-y'];
  plan.voice.forEach((v) => args.push('-i', v.file));
  const parts = plan.voice.map((v, i) => {
    const ms = Math.round(v.start * 1000);
    return `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono,adelay=${ms}:all=1[a${i}]`;
  });
  const mix = plan.voice.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${plan.voice.length}:normalize=0:dropout_transition=0`;
  const filter = parts.concat([mix + `,apad=whole_dur=${plan.total.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[out]`]).join(';');
  args.push('-filter_complex', filter, '-map', '[out]', '-t', plan.total.toFixed(3), '-ac', '1', '-ar', '48000', outFile);
  await run(ffmpeg, args, { cwd });
}

// Muted placeholder colours per scene (previews only).
const PLACEHOLDER_COLORS = [['0x2b3a55', '0x5b6f95'], ['0x3d5a4c', '0x86a789'], ['0x5a3d4c', '0xb08ba0'], ['0x4c4a3d', '0xa59f7a'], ['0x3d4c5a', '0x7aa0a5'], ['0x4a3d5a', '0x9a8bb0']];

/**
 * Composes scenes (real clips, or gradient placeholders in preview), end card, ASS overlay and narration.
 * visuals[i] = { clip: path } | { placeholder: true }.
 */
async function composeVideo({ ffmpeg }, plan, visuals, { assFile, fontsDir, narrationFile, outFile, cwd, crf = 20, preset = 'medium' }) {
  const { width: W, height: H, fps } = plan;
  const args = ['-hide_banner', '-y'];
  plan.scenes.forEach((sc, i) => {
    const d = sc.duration.toFixed(3);
    if (visuals[i].clip) {
      args.push('-stream_loop', '-1', '-t', d, '-i', visuals[i].clip);
    } else {
      const [c0, c1] = PLACEHOLDER_COLORS[i % PLACEHOLDER_COLORS.length];
      args.push('-f', 'lavfi', '-t', d, '-i', `gradients=s=${W}x${H}:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=${W}:y1=${H}:speed=0.008:rate=${fps}`);
    }
  });
  const endIdx = plan.scenes.length;
  args.push('-f', 'lavfi', '-t', (plan.endCard.end - plan.endCard.start).toFixed(3), '-i', `gradients=s=${W}x${H}:c0=0x101418:c1=0x2a2f3a:x0=0:y0=0:x1=0:y1=${H}:rate=${fps}`);
  const audioIdx = endIdx + 1;
  args.push('-i', narrationFile);

  const norm = (i, d) => `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${fps},setsar=1,format=yuv420p,trim=duration=${d},setpts=PTS-STARTPTS[v${i}]`;
  const chains = plan.scenes.map((sc, i) => norm(i, sc.duration.toFixed(3)));
  chains.push(norm(endIdx, (plan.endCard.end - plan.endCard.start).toFixed(3)));
  const concatIn = chains.map((_, i) => `[v${i}]`).join('');
  const assArg = fontsDir ? `ass=${assFile}:fontsdir=${fontsDir.replace(/([:\\'])/g, '\\$1')}` : `ass=${assFile}`;
  chains.push(`${concatIn}concat=n=${chains.length}:v=1:a=0[vc]`, `[vc]${assArg}[vout]`);

  args.push(
    '-filter_complex', chains.join(';'),
    '-map', '[vout]', '-map', `${audioIdx}:a`,
    '-t', plan.total.toFixed(3),
    '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    outFile
  );
  await run(ffmpeg, args, { cwd });
}

module.exports = { run, checkFfmpeg, probe, buildNarrationTrack, composeVideo };
