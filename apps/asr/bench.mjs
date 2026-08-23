/**
 * ASR throughput benchmark. Measures real p50/p95 transcription latency for two
 * clip lengths against a running ASR container — the numbers the queue-
 * concurrency sizing depends on. NOT run in CI (no container there); run it once
 * against the deployed/self-hosted ASR box and paste the numbers into the report.
 *
 *   node apps/asr/bench.mjs <ASR_URL> <CLIP_15S_URL> <CLIP_45S_URL> [runs=20]
 *
 * Example:
 *   node apps/asr/bench.mjs http://localhost:2600 \
 *     https://.../clip15.webm https://.../clip45.webm 20
 */
const [, , asrUrl, clip15, clip45, runsArg] = process.argv;
if (!asrUrl || !clip15 || !clip45) {
  console.error(
    "usage: node bench.mjs <ASR_URL> <CLIP_15S_URL> <CLIP_45S_URL> [runs]",
  );
  process.exit(1);
}
const RUNS = Number(runsArg ?? 20);

function pct(sorted, p) {
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

async function timeOne(audioUrl) {
  const t0 = performance.now();
  const res = await fetch(`${asrUrl.replace(/\/$/, "")}/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audio_url: audioUrl, word_timestamps: true, vad_filter: true }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await res.json();
  return performance.now() - t0;
}

async function bench(label, audioUrl) {
  // one warm-up (model + audio cache), then RUNS timed.
  await timeOne(audioUrl).catch(() => {});
  const samples = [];
  for (let i = 0; i < RUNS; i++) samples.push(await timeOne(audioUrl));
  samples.sort((a, b) => a - b);
  console.log(
    `${label}: p50=${(pct(samples, 50) / 1000).toFixed(2)}s  ` +
      `p95=${(pct(samples, 95) / 1000).toFixed(2)}s  (n=${RUNS})`,
  );
}

await bench("~15s clip", clip15);
await bench("~45s clip", clip45);
