/**
 * EVALUATION ONLY (CodeApt Step 31). Extends apps/asr/bench.mjs so the comparison
 * is apples-to-apples across engines: same clips, same warm-up + iteration count,
 * p50/p95/max — PLUS it captures the transcript, the audio duration the engine
 * reports, the realtime factor (duration / p50), and whether word timings are
 * present + in seconds. Writes each transcript to bench/out/<prefix>-<tag>.txt so
 * asr-wer.mjs can score two engines against each other.
 *
 *   node bench/asr-eval.mjs <ENGINE_URL> <PREFIX> <CLIP15_URL> <CLIP45_URL> [runs=10]
 *
 * PREFIX labels the output files, e.g. "whisper", "vosk-small", "vosk-large".
 */
import { mkdir, writeFile } from "node:fs/promises";

const [, , engineUrl, prefix, clip15, clip45, runsArg] = process.argv;
if (!engineUrl || !prefix || !clip15 || !clip45) {
  console.error(
    "usage: node bench/asr-eval.mjs <ENGINE_URL> <PREFIX> <CLIP15_URL> <CLIP45_URL> [runs]",
  );
  process.exit(1);
}
const RUNS = Number(runsArg ?? 10);
const base = engineUrl.replace(/\/$/, "");

function pct(sorted, p) {
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

async function callOnce(audioUrl) {
  const t0 = performance.now();
  const res = await fetch(`${base}/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audio_url: audioUrl, word_timestamps: true, vad_filter: true }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return { ms: performance.now() - t0, body };
}

async function bench(tag, audioUrl) {
  // Warm-up (also the capture run for transcript/duration/timings).
  const warm = await callOnce(audioUrl);
  const b = warm.body;
  const words = b.words ?? [];
  const timingsOk =
    words.length > 0 &&
    typeof words[0].start === "number" &&
    typeof words[0].end === "number";
  await writeFile(`bench/out/${prefix}-${tag}.txt`, (b.transcript ?? "").trim() + "\n");

  const samples = [];
  for (let i = 0; i < RUNS; i++) samples.push((await callOnce(audioUrl)).ms);
  samples.sort((a, x) => a - x);
  const p50 = pct(samples, 50) / 1000;
  const p95 = pct(samples, 95) / 1000;
  const max = samples[samples.length - 1] / 1000;
  const dur = b.duration ?? 0;
  const rt = p50 > 0 ? dur / p50 : 0;
  console.log(
    `[${prefix} ${tag}] dur=${dur.toFixed(2)}s  p50=${p50.toFixed(2)}s  ` +
      `p95=${p95.toFixed(2)}s  max=${max.toFixed(2)}s  realtime=${rt.toFixed(2)}x  ` +
      `words=${words.length}  timings=${timingsOk ? "yes(s)" : "NO"}  (n=${RUNS})`,
  );
  console.log(`    first word: ${words[0] ? JSON.stringify(words[0]) : "—"}`);
}

await mkdir("bench/out", { recursive: true });
console.log(`engine=${base}  runs=${RUNS}`);
await bench("15", clip15);
await bench("45", clip45);
