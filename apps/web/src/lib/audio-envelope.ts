/**
 * PURE RMS-envelope extraction (Step 32). The browser-STT runner decodes the
 * recorded blob with the Web Audio API (AudioContext.decodeAudioData →
 * getChannelData) and passes the samples here to get one amplitude per short
 * frame; that envelope feeds `fluencyFromEnvelope` (@codeapt/shared) to derive
 * fluency WITHOUT word timestamps. Kept pure + DOM-free so it unit-tests on
 * synthetic samples. `frameSeconds` should match the value passed to
 * fluencyFromEnvelope so pauses are measured on the same grid.
 */
export function computeRmsEnvelope(
  samples: Float32Array | readonly number[],
  sampleRate: number,
  frameSeconds: number,
): number[] {
  if (samples.length === 0 || sampleRate <= 0 || frameSeconds <= 0) return [];
  const frameSize = Math.max(1, Math.floor(sampleRate * frameSeconds));
  const envelope: number[] = [];
  for (let start = 0; start < samples.length; start += frameSize) {
    const end = Math.min(samples.length, start + frameSize);
    let sumSq = 0;
    for (let i = start; i < end; i++) {
      const v = samples[i]!;
      sumSq += v * v;
    }
    const n = end - start;
    envelope.push(n > 0 ? Math.sqrt(sumSq / n) : 0);
  }
  return envelope;
}

/** The frame size (seconds) the browser-STT capture uses for its envelope. Short
 *  enough that a 0.5s pause spans several frames, cheap enough for a long clip. */
export const ENVELOPE_FRAME_SECONDS = 0.05;
