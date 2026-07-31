/**
 * AI GOVERNOR (Stage-2) — the pure, DB-free decision core for the GLOBAL free-
 * tier pool. Where Stage-1 stops any ONE college from draining the pool, the
 * governor stops the SUM of all colleges from draining it: it computes the
 * combined headroom left across the enabled providers and, for a call about to
 * be made, decides ALLOW vs SHED with hard reserve floors.
 *
 * It sits at the SAME gateway seam as Stage-1 metering, AFTER the per-college
 * reserve and BEFORE a provider is called (the marked Stage-2 hook point). It is
 * a soft global throttle — the router's own `hasHeadroom` remains the hard
 * per-provider gate; the governor only decides whether to attempt at all.
 *
 * Decision tiers:
 *   - PLATFORM  (no collegeId, e.g. daily-challenge cron): always allowed while
 *     ANY provider has capacity — it may use the platform-reserved slice and is
 *     NEVER shed.
 *   - INTERACTIVE (college grading): a student waiting on a grade is protected —
 *     allowed until combined headroom hits the PLATFORM reserve floor.
 *   - DEFERRABLE (college generation / AI-Build / bulk): shed when headroom is
 *     below `shedThreshold` or would dip into the reserve — the caller degrades
 *     gracefully (try-later) and, when possible, the call is paced via a queue.
 *
 * All percentages are of the COMBINED daily pool (0–100). Pure over snapshots +
 * config; no I/O, so it unit-tests without a network or database.
 */
import type { LlmTaskKind, ProviderLimits, ProviderUsageSnapshot } from "./types.js";

/** The minimum a provider must expose for the governor to reason about it. */
export interface PoolProviderSnapshot {
  limits: ProviderLimits;
  usage: ProviderUsageSnapshot;
}

/** Combined-pool headroom derived from the enabled providers' fresh snapshots. */
export interface PoolHeadroom {
  /** Fraction [0,1] of the combined DAILY pool still free (tighter of req/tok). */
  dayFraction: number;
  /** Fraction [0,1] of the combined MINUTE pool still free (pacing signal). */
  minuteFraction: number;
  /** True when at least one provider is below all of its documented caps. */
  anyCapacity: boolean;
  /** Combined remaining vs limit on the tighter DAILY axis (real counts). */
  combinedDayRemaining: number;
  combinedDayLimit: number;
  /** How many providers contributed a documented limit (0 = unmetered pool). */
  providersWithLimits: number;
}

const clamp01 = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
};

/** True when a provider is below ALL of its documented minute/day caps. */
function providerHasCapacity(p: PoolProviderSnapshot): boolean {
  const { limits, usage } = p;
  if (limits.requestsPerMinute && usage.minute.requests >= limits.requestsPerMinute)
    return false;
  if (limits.requestsPerDay && usage.day.requests >= limits.requestsPerDay)
    return false;
  if (limits.tokensPerMinute && usage.minute.tokens >= limits.tokensPerMinute)
    return false;
  if (limits.tokensPerDay && usage.day.tokens >= limits.tokensPerDay) return false;
  return true;
}

/**
 * Compute combined-pool headroom. Providers WITHOUT a documented limit on an
 * axis contribute nothing to that axis's ratio (we can't meter what isn't
 * capped) but still count toward `anyCapacity`. When no provider documents a
 * daily limit, `dayFraction` is 1 (an unmetered pool is treated as plenty) so
 * the governor never sheds against a pool it cannot measure.
 */
export function computePoolHeadroom(
  providers: readonly PoolProviderSnapshot[],
): PoolHeadroom {
  let dayReqRem = 0;
  let dayReqLim = 0;
  let dayTokRem = 0;
  let dayTokLim = 0;
  let minReqRem = 0;
  let minReqLim = 0;
  let minTokRem = 0;
  let minTokLim = 0;
  let providersWithLimits = 0;
  let anyCapacity = false;

  for (const p of providers) {
    const { limits, usage } = p;
    let hasLimit = false;
    if (limits.requestsPerDay && limits.requestsPerDay > 0) {
      dayReqLim += limits.requestsPerDay;
      dayReqRem += Math.max(0, limits.requestsPerDay - usage.day.requests);
      hasLimit = true;
    }
    if (limits.tokensPerDay && limits.tokensPerDay > 0) {
      dayTokLim += limits.tokensPerDay;
      dayTokRem += Math.max(0, limits.tokensPerDay - usage.day.tokens);
      hasLimit = true;
    }
    if (limits.requestsPerMinute && limits.requestsPerMinute > 0) {
      minReqLim += limits.requestsPerMinute;
      minReqRem += Math.max(0, limits.requestsPerMinute - usage.minute.requests);
      hasLimit = true;
    }
    if (limits.tokensPerMinute && limits.tokensPerMinute > 0) {
      minTokLim += limits.tokensPerMinute;
      minTokRem += Math.max(0, limits.tokensPerMinute - usage.minute.tokens);
      hasLimit = true;
    }
    if (hasLimit) providersWithLimits += 1;
    if (providerHasCapacity(p)) anyCapacity = true;
  }

  // No providers at all → no pool → no headroom (distinct from providers that
  // simply document no limits, which are treated as unmetered/full below).
  if (providers.length === 0) {
    return {
      dayFraction: 0,
      minuteFraction: 0,
      anyCapacity: false,
      combinedDayRemaining: 0,
      combinedDayLimit: 0,
      providersWithLimits: 0,
    };
  }

  const dayReqFrac = dayReqLim > 0 ? dayReqRem / dayReqLim : 1;
  const dayTokFrac = dayTokLim > 0 ? dayTokRem / dayTokLim : 1;
  const minReqFrac = minReqLim > 0 ? minReqRem / minReqLim : 1;
  const minTokFrac = minTokLim > 0 ? minTokRem / minTokLim : 1;

  // Tighter axis wins (matches the per-provider hard gate).
  const useDayReq = dayReqLim > 0 && dayReqFrac <= dayTokFrac;
  return {
    dayFraction: clamp01(Math.min(dayReqFrac, dayTokFrac)),
    minuteFraction: clamp01(Math.min(minReqFrac, minTokFrac)),
    anyCapacity,
    combinedDayRemaining: useDayReq ? dayReqRem : dayTokRem,
    combinedDayLimit: useDayReq ? dayReqLim : dayTokLim,
    providersWithLimits,
  };
}

/** Governor tuning (percentages of the combined daily pool, 0–100). */
export interface GovernorConfig {
  enabled: boolean;
  reservePercent: number;
  platformReservePercent: number;
  shedThreshold: number;
}

export type GovernorTier = "platform" | "interactive" | "deferrable";
export type GovernorAction = "allow" | "shed";

export interface GovernorDecision {
  action: GovernorAction;
  tier: GovernorTier;
  /** Machine-readable reason (also drives the "why" shown to operators). */
  reason: string;
}

export interface GovernorDecisionInput {
  headroom: PoolHeadroom;
  config: GovernorConfig;
  /** True when the call has NO collegeId (platform-initiated, e.g. cron). */
  isPlatform: boolean;
  /** Task kind — grading is interactive/protected; generation is deferrable. */
  kind: LlmTaskKind;
}

/** The tier a call belongs to (platform / interactive / deferrable). */
export function governorTier(isPlatform: boolean, kind: LlmTaskKind): GovernorTier {
  if (isPlatform) return "platform";
  return kind === "grading" ? "interactive" : "deferrable";
}

/**
 * The core decision. Hard floors: college DEFERRABLE AI may not consume into
 * the reserve; college INTERACTIVE grading may not consume into the PLATFORM
 * reserve; platform jobs are never shed while any capacity exists.
 */
export function governorDecision(input: GovernorDecisionInput): GovernorDecision {
  const { headroom, config, isPlatform, kind } = input;
  const tier = governorTier(isPlatform, kind);

  // Governor off → Stage-1 behaviour is unchanged (allow; router still gates).
  if (!config.enabled) return { action: "allow", tier, reason: "governor_disabled" };

  const reserve = clamp01(config.reservePercent / 100);
  const platformReserve = clamp01(config.platformReservePercent / 100);
  const shed = clamp01(config.shedThreshold / 100);
  const day = headroom.dayFraction;

  // Genuinely empty pool → nothing can run (graceful null everywhere).
  if (!headroom.anyCapacity) return { action: "shed", tier, reason: "pool_empty" };

  if (tier === "platform") {
    // Always allowed while any provider has capacity (may use the reserve).
    return { action: "allow", tier, reason: "platform_protected" };
  }

  if (tier === "interactive") {
    // Grading is protected — shed only when down to the platform reserve floor.
    if (day <= platformReserve) {
      return { action: "shed", tier, reason: "platform_reserve_floor" };
    }
    return { action: "allow", tier, reason: "interactive_protected" };
  }

  // Deferrable college generation: shed below the shed threshold or when it
  // would dip into the reserve (whichever floor is higher).
  const floor = Math.max(reserve, shed);
  if (day < floor) {
    return {
      action: "shed",
      tier,
      reason: day <= reserve ? "would_dip_into_reserve" : "below_shed_threshold",
    };
  }
  return { action: "allow", tier, reason: "headroom_ok" };
}
