/**
 * Pure composite-scoring unit tests (Step 21) — the honesty invariants of
 * computeComposite / communicationBand / speakingOverallPercent, exercised in
 * isolation from the API. The cardinal rule under test: an untaken part is
 * ABSENT from the mean (never a zero), so a partial assessment reports a running
 * subtotal + `partial`, not a deceptively low score.
 */
import {
  communicationBand,
  computeComposite,
  speakingOverallPercent,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

describe("communicationBand", () => {
  it("bands against the default 50 / 60 thresholds", () => {
    expect(communicationBand(60)).toBe("distinction");
    expect(communicationBand(59.9)).toBe("pass");
    expect(communicationBand(50)).toBe("pass");
    expect(communicationBand(49.9)).toBe("fail");
  });
  it("honors authored thresholds", () => {
    expect(communicationBand(70, 65, 80)).toBe("pass");
    expect(communicationBand(80, 65, 80)).toBe("distinction");
  });
});

describe("computeComposite — weights + partial honesty", () => {
  it("weights the mean over scored parts", () => {
    const r = computeComposite([
      { weight: 1, percent: 80 },
      { weight: 3, percent: 60 },
    ]);
    expect(r.compositePercent).toBe(65); // (80 + 180) / 4
    expect(r.partial).toBe(false);
    expect(r.band).toBe("distinction");
    expect(r.scoredCount).toBe(2);
  });

  it("a missing part is ABSENT, not a zero — the composite stays a subtotal", () => {
    const r = computeComposite([
      { weight: 1, percent: 80 },
      { weight: 1, percent: null }, // not taken
    ]);
    expect(r.compositePercent).toBe(80); // NOT 40
    expect(r.partial).toBe(true);
    expect(r.band).toBe(null); // can't pass/fail an unfinished paper
    expect(r.scoredCount).toBe(1);
    expect(r.totalCount).toBe(2);
    expect(r.scoredWeight).toBe(1);
    expect(r.totalWeight).toBe(2);
  });

  it("nothing scored → null percent + null band (never 0)", () => {
    const r = computeComposite([
      { weight: 1, percent: null },
      { weight: 2, percent: null },
    ]);
    expect(r.compositePercent).toBe(null);
    expect(r.band).toBe(null);
    expect(r.partial).toBe(true);
  });

  it("an empty assessment is neither partial nor scored", () => {
    const r = computeComposite([]);
    expect(r.compositePercent).toBe(null);
    expect(r.partial).toBe(false);
    expect(r.totalCount).toBe(0);
  });

  it("a non-positive weight contributes nothing but doesn't break the mean", () => {
    const r = computeComposite([
      { weight: 0, percent: 100 },
      { weight: 2, percent: 50 },
    ]);
    expect(r.compositePercent).toBe(50); // the zero-weight 100 is ignored
  });
});

describe("speakingOverallPercent — duck-typed over stored sub-scores", () => {
  it("averages the read-aloud family (wordAccuracy) and keyed variants", () => {
    expect(
      speakingOverallPercent([
        { wordAccuracy: 90 }, // read-aloud family (no `kind`)
        { kind: "answer_set", score: 70 },
        { kind: "open_topic", total: 50 },
      ]),
    ).toBe(70);
  });
  it("ignores unscored items; null when nothing is scored", () => {
    expect(speakingOverallPercent([null, undefined, {}])).toBe(null);
    expect(speakingOverallPercent([{ wordAccuracy: 80 }, null])).toBe(80);
  });
});
