/**
 * Pure essay anti-cheat risk heuristic (@codeapt/shared). Deterministic and
 * advisory-only: each signal fires an explanatory reason, the additive score
 * caps at 100, and level buckets are HIGH ≥ 80 / MEDIUM ≥ 50 / else LOW. Empty
 * or partial signals must degrade gracefully to zero/low (never throw).
 */
import { computeEssayRisk } from "@codeapt/shared";
import { describe, expect, it } from "vitest";

describe("computeEssayRisk — empty / benign", () => {
  it("returns zero/low with no reasons for empty signals", () => {
    const r = computeEssayRisk({});
    expect(r.riskScore).toBe(0);
    expect(r.level).toBe("low");
    expect(r.suspicious).toBe(false);
    expect(r.reasons).toEqual([]);
  });

  it("does not flag a long, mostly-typed essay with a small quote", () => {
    const r = computeEssayRisk({
      keystrokes: 2400,
      deletes: 300,
      pasteEvents: 1,
      pastedChars: 80,
      composeSeconds: 1500,
      wordCount: 480,
      characterCount: 2600,
    });
    expect(r.level).toBe("low");
    expect(r.suspicious).toBe(false);
    expect(r.reasons).toEqual([]);
  });
});

describe("computeEssayRisk — each signal fires its reason", () => {
  it("high paste ratio (normalized) with repeated pastes", () => {
    const r = computeEssayRisk({
      keystrokes: 400,
      pasteEvents: 4,
      pastedChars: 600,
      wordCount: 200,
      characterCount: 1000, // 60% pasted
    });
    expect(r.riskScore).toBe(50);
    expect(r.level).toBe("medium");
    expect(r.reasons.some((x) => x.includes("High paste ratio"))).toBe(true);
    expect(r.reasons.some((x) => x.includes("60%"))).toBe(true);
  });

  it("very low typing for a substantial word count", () => {
    const r = computeEssayRisk({
      keystrokes: 5,
      wordCount: 150,
      characterCount: 900,
      pastedChars: 0,
      pasteEvents: 0,
    });
    expect(r.riskScore).toBe(50);
    expect(r.reasons.some((x) => x.includes("Very low typing"))).toBe(true);
  });

  it("abnormally large paste blocks (below the medium bucket on its own)", () => {
    const r = computeEssayRisk({
      keystrokes: 500,
      pasteEvents: 2,
      pastedChars: 800, // ~80 words/paste
      wordCount: 60,
      characterCount: 10000, // ratio tiny → paste-ratio does NOT fire
    });
    expect(r.riskScore).toBe(30);
    expect(r.level).toBe("low");
    expect(r.reasons.some((x) => x.includes("Large paste blocks"))).toBe(true);
  });

  it("supports focus-loss + long-pause signals when present", () => {
    const focus = computeEssayRisk({ focusLossCount: 6 });
    expect(focus.reasons.some((x) => x.includes("focus loss"))).toBe(true);
    const pause = computeEssayRisk({ longestPauseSeconds: 150 });
    expect(pause.reasons.some((x) => x.includes("Long inactive pause"))).toBe(
      true,
    );
  });
});

describe("computeEssayRisk — buckets + cap", () => {
  it("caps the additive score at 100 for a paste-dumped essay", () => {
    const r = computeEssayRisk({
      keystrokes: 5, // low typing (+50)
      wordCount: 150, // >100
      pasteEvents: 4, // repeated pastes
      pastedChars: 1500, // ratio 0.75 (+50), ~75 words/paste (+30)
      characterCount: 2000,
      focusLossCount: 6, // (+25)
      longestPauseSeconds: 150, // (+25)
    });
    expect(r.riskScore).toBe(100); // 180 capped
    expect(r.level).toBe("high");
    expect(r.suspicious).toBe(true);
    expect(r.reasons.length).toBe(5);
  });

  it("classifies MEDIUM at 50 and HIGH at 80", () => {
    // paste-ratio alone → 50 → MEDIUM
    const medium = computeEssayRisk({
      pasteEvents: 4,
      pastedChars: 600,
      characterCount: 1000,
      keystrokes: 400,
      wordCount: 200,
    });
    expect(medium.level).toBe("medium");

    // paste-ratio (50) + large paste blocks (30) → 80 → HIGH
    const high = computeEssayRisk({
      pasteEvents: 4,
      pastedChars: 900, // ratio 0.9 (+50), ~45 words/paste... push over 50
      characterCount: 1000,
      keystrokes: 400,
      wordCount: 200,
    });
    // 900/5/4 = 45 words/paste → NOT > 50, so only paste-ratio fires here.
    expect(high.level).toBe("medium");

    const high2 = computeEssayRisk({
      pasteEvents: 3, // >0 for words-per-paste; but paste-ratio needs >3...
      pastedChars: 1100,
      characterCount: 1200, // ratio 0.916 but pasteEvents 3 not >3 → paste-ratio off
      keystrokes: 5,
      wordCount: 150, // low typing +50, words/paste 1100/5/3≈73 +30 → 80 HIGH
    });
    expect(high2.riskScore).toBe(80);
    expect(high2.level).toBe("high");
  });
});
