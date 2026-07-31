/**
 * AI credit model (pure, from @codeapt/shared): the monthly allocation formula
 * (tier base + per-seat, with an explicit override winning), the action weights,
 * the IST monthly period key/bounds, and remaining-credits clamping.
 */
import {
  AI_CREDIT_TIERS,
  AiCreditTier,
  aiActionWeight,
  aiCreditPeriodBounds,
  aiCreditPeriodKey,
  aiCreditsRemaining,
  computeAiCreditAllocation,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

describe("AI credit allocation", () => {
  it("free tier = base + students × per-seat", () => {
    const t = AI_CREDIT_TIERS[AiCreditTier.FREE];
    expect(
      computeAiCreditAllocation({ tier: "free", studentCount: 10 }),
    ).toBe(t.baseCredits + 10 * t.perSeatCredits);
  });

  it("standard/premium tiers use their own base + per-seat", () => {
    const s = AI_CREDIT_TIERS[AiCreditTier.STANDARD];
    expect(
      computeAiCreditAllocation({ tier: "standard", studentCount: 4 }),
    ).toBe(s.baseCredits + 4 * s.perSeatCredits);
    const p = AI_CREDIT_TIERS[AiCreditTier.PREMIUM];
    expect(
      computeAiCreditAllocation({ tier: "premium", studentCount: 0 }),
    ).toBe(p.baseCredits);
  });

  it("an explicit override wins over the tier formula", () => {
    expect(
      computeAiCreditAllocation({
        tier: "premium",
        monthlyOverride: 42,
        studentCount: 100,
      }),
    ).toBe(42);
    // override 0 is a valid (zero-budget) override, not "unset".
    expect(
      computeAiCreditAllocation({ monthlyOverride: 0, studentCount: 50 }),
    ).toBe(0);
  });

  it("defaults defensively (unknown tier → free; negative seats → 0)", () => {
    const free = AI_CREDIT_TIERS[AiCreditTier.FREE];
    expect(computeAiCreditAllocation({ tier: "bogus", studentCount: 3 })).toBe(
      free.baseCredits + 3 * free.perSeatCredits,
    );
    expect(computeAiCreditAllocation({ studentCount: -5 })).toBe(
      free.baseCredits,
    );
  });
});

describe("AI action weights", () => {
  it("weights known features and defaults unknown ones to 1", () => {
    expect(aiActionWeight("grading")).toBe(1);
    expect(aiActionWeight("keywords")).toBe(1);
    expect(aiActionWeight("ai_build")).toBeGreaterThan(1);
    expect(aiActionWeight("something_new")).toBe(1);
    expect(aiActionWeight(undefined)).toBe(1);
  });
});

describe("AI credit period (monthly, IST)", () => {
  it("keys an instant to its IST month", () => {
    expect(aiCreditPeriodKey(new Date("2026-07-15T10:00:00Z"))).toBe("2026-07");
  });

  it("respects the IST boundary at month end (UTC late-July → IST August)", () => {
    // 2026-07-31 19:00 UTC = 2026-08-01 00:30 IST → the August period.
    expect(aiCreditPeriodKey(new Date("2026-07-31T19:00:00Z"))).toBe("2026-08");
  });

  it("bounds enclose the period and abut the next", () => {
    const { start, end } = aiCreditPeriodBounds("2026-07");
    expect(aiCreditPeriodKey(start)).toBe("2026-07");
    // end is the first instant of the next period (exclusive).
    expect(aiCreditPeriodKey(end)).toBe("2026-08");
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });
});

describe("remaining credits", () => {
  it("never goes negative", () => {
    expect(aiCreditsRemaining(100, 30)).toBe(70);
    expect(aiCreditsRemaining(100, 250)).toBe(0);
  });
});
