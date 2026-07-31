/**
 * AI GOVERNOR (Stage-2) — the pure decision core from @codeapt/shared. Proves
 * combined-pool headroom computation and the ALLOW/SHED decision: platform jobs
 * protected (never shed while any capacity), interactive grading protected down
 * to the platform reserve, deferrable college AI shed below the threshold /
 * reserve (hard floors), and the on/off switch.
 */
import {
  AI_GOVERNOR_DEFAULTS,
  computePoolHeadroom,
  governorDecision,
  governorTier,
  type GovernorConfig,
  type PoolProviderSnapshot,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

const CONFIG: GovernorConfig = {
  enabled: true,
  reservePercent: 20,
  platformReservePercent: 10,
  shedThreshold: 30,
};

/** A provider snapshot with a daily request limit and a used amount. */
function prov(requestsPerDay: number, dayRequests: number): PoolProviderSnapshot {
  return {
    limits: { requestsPerDay },
    usage: {
      minute: { requests: 0, tokens: 0 },
      day: { requests: dayRequests, tokens: 0 },
    },
  };
}

describe("computePoolHeadroom", () => {
  it("combines remaining daily capacity across providers", () => {
    const h = computePoolHeadroom([prov(100, 50), prov(100, 30)]);
    // 120 remaining of 200 combined → 60%.
    expect(h.combinedDayRemaining).toBe(120);
    expect(h.combinedDayLimit).toBe(200);
    expect(h.dayFraction).toBeCloseTo(0.6, 5);
    expect(h.anyCapacity).toBe(true);
    expect(h.providersWithLimits).toBe(2);
  });

  it("treats an unmetered pool (no documented limits) as full", () => {
    const h = computePoolHeadroom([
      { limits: {}, usage: { minute: { requests: 5, tokens: 0 }, day: { requests: 9, tokens: 0 } } },
    ]);
    expect(h.dayFraction).toBe(1);
    expect(h.anyCapacity).toBe(true); // no cap → always has capacity
    expect(h.providersWithLimits).toBe(0);
  });

  it("reports no capacity when every provider is at its cap; empty pool = 0", () => {
    const atCap = computePoolHeadroom([prov(100, 100), prov(50, 50)]);
    expect(atCap.anyCapacity).toBe(false);
    expect(atCap.dayFraction).toBe(0);

    const empty = computePoolHeadroom([]);
    expect(empty.anyCapacity).toBe(false);
    expect(empty.dayFraction).toBe(0);
  });

  it("uses the TIGHTER of the request/token axes", () => {
    const h = computePoolHeadroom([
      {
        limits: { requestsPerDay: 100, tokensPerDay: 1000 },
        usage: { minute: { requests: 0, tokens: 0 }, day: { requests: 10, tokens: 900 } },
      },
    ]);
    // requests 90% free, tokens 10% free → tighter (tokens) wins.
    expect(h.dayFraction).toBeCloseTo(0.1, 5);
  });
});

describe("governorTier", () => {
  it("maps platform / grading / generation to their tiers", () => {
    expect(governorTier(true, "generation")).toBe("platform");
    expect(governorTier(false, "grading")).toBe("interactive");
    expect(governorTier(false, "generation")).toBe("deferrable");
  });
});

describe("governorDecision — platform (always protected)", () => {
  it("allows a platform job even at low headroom (into the reserve)", () => {
    const headroom = computePoolHeadroom([prov(100, 95)]); // 5% left
    const d = governorDecision({ headroom, config: CONFIG, isPlatform: true, kind: "generation" });
    expect(d).toMatchObject({ action: "allow", tier: "platform" });
  });

  it("sheds only when the pool is genuinely empty", () => {
    const headroom = computePoolHeadroom([prov(100, 100)]);
    const d = governorDecision({ headroom, config: CONFIG, isPlatform: true, kind: "generation" });
    expect(d).toMatchObject({ action: "shed", reason: "pool_empty" });
  });
});

describe("governorDecision — college interactive grading (protected)", () => {
  it("runs while a deferrable call at the same headroom is shed", () => {
    const headroom = computePoolHeadroom([prov(100, 85)]); // 15% left
    const grading = governorDecision({ headroom, config: CONFIG, isPlatform: false, kind: "grading" });
    const gen = governorDecision({ headroom, config: CONFIG, isPlatform: false, kind: "generation" });
    // 15% > platformReserve(10%) → grading allowed; 15% < shed(30%) → generation shed.
    expect(grading).toMatchObject({ action: "allow", tier: "interactive" });
    expect(gen).toMatchObject({ action: "shed", tier: "deferrable" });
  });

  it("is shed only at the platform-reserve floor", () => {
    const headroom = computePoolHeadroom([prov(100, 92)]); // 8% < 10% floor
    const d = governorDecision({ headroom, config: CONFIG, isPlatform: false, kind: "grading" });
    expect(d).toMatchObject({ action: "shed", reason: "platform_reserve_floor" });
  });
});

describe("governorDecision — college deferrable (reserve + shed floors)", () => {
  it("allows above the shed threshold", () => {
    const headroom = computePoolHeadroom([prov(100, 50)]); // 50%
    const d = governorDecision({ headroom, config: CONFIG, isPlatform: false, kind: "generation" });
    expect(d).toMatchObject({ action: "allow", tier: "deferrable", reason: "headroom_ok" });
  });

  it("sheds below the shed threshold (but above reserve)", () => {
    const headroom = computePoolHeadroom([prov(100, 75)]); // 25% (< 30 shed, > 20 reserve)
    const d = governorDecision({ headroom, config: CONFIG, isPlatform: false, kind: "generation" });
    expect(d).toMatchObject({ action: "shed", reason: "below_shed_threshold" });
  });

  it("sheds (reserve floor) when it would dip into the reserve", () => {
    const headroom = computePoolHeadroom([prov(100, 85)]); // 15% (<= 20 reserve)
    const d = governorDecision({ headroom, config: CONFIG, isPlatform: false, kind: "generation" });
    expect(d).toMatchObject({ action: "shed", reason: "would_dip_into_reserve" });
  });
});

describe("governorDecision — disabled", () => {
  it("allows everything when the governor is off (Stage-1 unchanged)", () => {
    const headroom = computePoolHeadroom([prov(100, 100)]); // empty pool
    const d = governorDecision({
      headroom,
      config: { ...CONFIG, enabled: false },
      isPlatform: false,
      kind: "generation",
    });
    expect(d).toMatchObject({ action: "allow", reason: "governor_disabled" });
  });

  it("ships sensible defaults (on, 20/10/30)", () => {
    expect(AI_GOVERNOR_DEFAULTS.enabled).toBe(true);
    expect(AI_GOVERNOR_DEFAULTS.reservePercent).toBe(20);
    expect(AI_GOVERNOR_DEFAULTS.platformReservePercent).toBe(10);
    expect(AI_GOVERNOR_DEFAULTS.shedThreshold).toBe(30);
  });
});
