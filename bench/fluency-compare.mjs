/**
 * EVALUATION ONLY (CodeApt Step 32). Does the audio-ENERGY-envelope fluency path
 * (browser STT, no word timestamps) land close to the WORD-TIMING fluency path
 * (Whisper) on REAL speech — or does it systematically over/under-count pauses?
 *
 * For each clip it:
 *   1. calls the Whisper ASR (/transcribe, word_timestamps) and computes fluency
 *      the WHISPER way from the returned word timings  → fluencyMetrics()
 *   2. decodes the SAME audio to mono float PCM (ffmpeg, normalized to [-1,1] to
 *      match Web Audio's getChannelData) and runs the ENERGY-envelope path over it
 *      → computeRmsEnvelope() + fluencyFromEnvelope()
 *   3. prints both FluencyResults side by side + the deltas.
 *
 *   node bench/fluency-compare.mjs <WHISPER_URL> <CLIP15_URL> <CLIP45_URL>
 *
 * Needs: @codeapt/shared built (pnpm --filter @codeapt/shared build) + ffmpeg on PATH.
 * Nothing in the app imports this; it is disposable like the rest of bench/.
 */
import { spawnSync } from "node:child_process";

// fluencyMetrics (word-timing path) + fluencyFromEnvelope (energy path) are the two
// functions under comparison. computeRmsEnvelope + the frame size are web-only (not
// exported from @codeapt/shared), so they are copied verbatim below.
import { fluencyFromEnvelope, fluencyMetrics } from "../packages/shared/dist/index.js";

// --- verbatim copy of apps/web/src/lib/audio-envelope.ts (web src isn't built to
//     a consumable dist; keep this in lockstep with that file). --------------
const ENVELOPE_FRAME_SECONDS = 0.05;
function computeRmsEnvelope(samples, sampleRate, frameSeconds) {
  if (samples.length === 0 || sampleRate <= 0 || frameSeconds <= 0) return [];
  const frameSize = Math.max(1, Math.floor(sampleRate * frameSeconds));
  const envelope = [];
  for (let start = 0; start < samples.length; start += frameSize) {
    const end = Math.min(samples.length, start + frameSize);
    let sumSq = 0;
    for (let i = start; i < end; i++) {
      const v = samples[i];
      sumSq += v * v;
    }
    const n = end - start;
    envelope.push(n > 0 ? Math.sqrt(sumSq / n) : 0);
  }
  return envelope;
}

const [, , whisperUrl, clip15, clip45] = process.argv;
if (!whisperUrl || !clip15 || !clip45) {
  console.error(
    "usage: node bench/fluency-compare.mjs <WHISPER_URL> <CLIP15_URL> <CLIP45_URL>",
  );
  process.exit(1);
}
const SR = 16000;
const base = whisperUrl.replace(/\/$/, "");

async function whisper(audioUrl) {
  const res = await fetch(`${base}/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audio_url: audioUrl,
      word_timestamps: true,
      vad_filter: true,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json(); // {transcript, words:[{word,start,end}], duration}
}

/** Decode an audio URL to a mono Float32Array in [-1,1] at SR via ffmpeg. */
function decodePcm(audioUrl) {
  const r = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-i", audioUrl,
     "-ac", "1", "-ar", String(SR), "-f", "f32le", "pipe:1"],
    { maxBuffer: 1 << 30 },
  );
  if (r.status !== 0) {
    throw new Error(`ffmpeg failed: ${r.stderr?.toString() ?? r.status}`);
  }
  const buf = r.stdout;
  // Node Buffer → Float32Array (little-endian, 4 bytes/sample).
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
}

function fmt(f) {
  return {
    words: f.wordCount,
    rate: f.speechRate,
    pauses: f.pauseCount,
    longest: f.longestPauseSeconds,
    dur: f.durationSeconds,
  };
}

async function compareClip(tag, audioUrl) {
  const w = await whisper(audioUrl);
  const words = w.words ?? [];
  const whisperFluency = fluencyMetrics(words);

  const samples = decodePcm(audioUrl);
  const envelope = computeRmsEnvelope(samples, SR, ENVELOPE_FRAME_SECONDS);
  const envFluency = fluencyFromEnvelope(
    envelope,
    ENVELOPE_FRAME_SECONDS,
    w.transcript ?? "",
  );

  const wf = fmt(whisperFluency);
  const ef = fmt(envFluency);
  const audibleFrac =
    envelope.length > 0
      ? envelope.filter((v) => v >= 0.02).length / envelope.length
      : 0;

  console.log(`\n=== clip ${tag}  (whisper duration=${(w.duration ?? 0).toFixed(2)}s, ${words.length} words) ===`);
  console.log(`                 whisper(word-timings)   envelope(energy)   delta`);
  console.log(`  speechRate     ${wf.rate.toString().padEnd(22)} ${ef.rate.toString().padEnd(18)} ${(ef.rate - wf.rate).toFixed(2)}`);
  console.log(`  pauseCount     ${String(wf.pauses).padEnd(22)} ${String(ef.pauses).padEnd(18)} ${ef.pauses - wf.pauses}`);
  console.log(`  longestPause   ${wf.longest.toString().padEnd(22)} ${ef.longest.toString().padEnd(18)} ${(ef.longest - wf.longest).toFixed(2)}`);
  console.log(`  durationSecs   ${wf.dur.toString().padEnd(22)} ${ef.dur.toString().padEnd(18)} ${(ef.dur - wf.dur).toFixed(2)}`);
  console.log(`  wordCount      ${wf.words} (timings)              ${ef.words} (transcript)`);
  console.log(`  [envelope: ${envelope.length} frames @ ${ENVELOPE_FRAME_SECONDS}s, ${(audibleFrac * 100).toFixed(1)}% voiced @ rms>=0.02]`);

  // --- Why? The RMS distribution of the envelope. If the LOW percentiles sit
  //     above the threshold, "silence" never registers → 0 pauses. ---
  const sorted = [...envelope].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  console.log(`  rms percentiles: min=${q(0).toFixed(4)} p5=${q(5).toFixed(4)} p10=${q(10).toFixed(4)} p25=${q(25).toFixed(4)} p50=${q(50).toFixed(4)} p90=${q(90).toFixed(4)} max=${q(100).toFixed(4)}`);

  // --- Threshold sweep: which silence threshold reproduces Whisper's pauses?
  //     (min-pause run length held at PAUSE_THRESHOLD_SECONDS=0.5 inside the fn) ---
  console.log(`  threshold sweep (target: whisper pauseCount=${wf.pauses}, longest=${wf.longest}):`);
  for (const th of [0.02, 0.03, 0.05, 0.08, 0.1, 0.15]) {
    const f = fluencyFromEnvelope(envelope, ENVELOPE_FRAME_SECONDS, w.transcript ?? "", {
      silenceThreshold: th,
    });
    const voiced = envelope.filter((v) => v >= th).length / envelope.length;
    console.log(`     th=${th.toFixed(2)}  pauses=${String(f.pauseCount).padEnd(3)} longest=${f.longestPauseSeconds.toString().padEnd(5)} rate=${f.speechRate.toString().padEnd(5)} voiced=${(voiced * 100).toFixed(0)}%`);
  }
}

console.log(`whisper=${base}  SR=${SR}  frame=${ENVELOPE_FRAME_SECONDS}s`);
await compareClip("15", clip15);
await compareClip("45", clip45);
