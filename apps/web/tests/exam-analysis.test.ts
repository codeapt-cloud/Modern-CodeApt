/**
 * Exam-analysis pure helpers (from @codeapt/shared): the fair rate (null on no
 * data), the median, and the score-distribution band bucketing.
 */
import {
  EXAM_ANALYSIS_BANDS,
  buildScoreBands,
  median,
  ratePercent,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

describe("ratePercent", () => {
  it("rounds to 1dp and returns null on no data", () => {
    expect(ratePercent(2, 3)).toBe(66.7);
    expect(ratePercent(1, 2)).toBe(50);
    expect(ratePercent(0, 0)).toBeNull();
  });
});

describe("median", () => {
  it("odd/even/empty", () => {
    expect(median([0, 5, 10])).toBe(5);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("buildScoreBands", () => {
  it("buckets percentages into deciles; 100 lands in the top band", () => {
    const bands = buildScoreBands([0, 50, 100, 95]);
    expect(bands).toHaveLength(EXAM_ANALYSIS_BANDS);
    expect(bands[0]!.count).toBe(1); // 0 → 0–10
    expect(bands[5]!.count).toBe(1); // 50 → 50–60
    expect(bands[9]!.count).toBe(2); // 95 + 100 → 90–100 (top inclusive)
    expect(bands[9]!.label).toBe("90–100");
  });
  it("clamps out-of-range and sums to the input count", () => {
    const bands = buildScoreBands([-10, 120, 50]);
    expect(bands.reduce((s, b) => s + b.count, 0)).toBe(3);
  });
});
