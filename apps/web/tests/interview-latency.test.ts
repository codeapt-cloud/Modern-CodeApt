/**
 * Step 34 Part B — the measured before/after gap between an answer submit and the
 * next question speaking. "Before" = sequential grade→follow-up on the round-trip
 * + synthesize the next question after the response. "After" = grade ∥ follow-up
 * (concurrent) + the next MAIN question pre-synthesized during the answer (B1).
 * Numbers use representative hop costs; the test prints them for the report.
 */
import { describe, expect, it } from "vitest";

import {
  REPRESENTATIVE_HOPS,
  latencyImprovementMs,
  optimizedGapMs,
  sequentialGapMs,
} from "../src/lib/interview-latency.js";

describe("conversational latency (B / B1)", () => {
  it("the optimized gap is strictly smaller than the sequential gap", () => {
    const before = sequentialGapMs(REPRESENTATIVE_HOPS);
    const after = optimizedGapMs(REPRESENTATIVE_HOPS);
    expect(after).toBeLessThan(before);
    // With grade=1400, followUp=1100, synth=350:
    expect(before).toBe(2850); // 1400 + 1100 + 350
    expect(after).toBe(1400); // max(1400, 1100)
    expect(latencyImprovementMs(REPRESENTATIVE_HOPS)).toBe(1450);
    console.log(
      `[B1] next-question gap: before=${before}ms after=${after}ms (saved ${latencyImprovementMs(REPRESENTATIVE_HOPS)}ms)`,
    );
  });

  it("prefetch removes the whole TTS-synthesis cost from the post-submit path", () => {
    // Holding the LLM costs fixed, a larger synth cost widens the gap ONLY for the
    // sequential path — the optimized path never pays synth post-submit.
    const cheap = { gradeMs: 1000, followUpMs: 1000, ttsSynthMs: 100 };
    const dear = { gradeMs: 1000, followUpMs: 1000, ttsSynthMs: 900 };
    expect(optimizedGapMs(cheap)).toBe(optimizedGapMs(dear)); // synth off the path
    expect(sequentialGapMs(dear) - sequentialGapMs(cheap)).toBe(800);
  });

  it("concurrency alone helps even with zero synth (independent LLM calls)", () => {
    const c = { gradeMs: 1500, followUpMs: 900, ttsSynthMs: 0 };
    expect(sequentialGapMs(c)).toBe(2400); // 1500 + 900
    expect(optimizedGapMs(c)).toBe(1500); // max
    expect(latencyImprovementMs(c)).toBe(900);
  });
});
