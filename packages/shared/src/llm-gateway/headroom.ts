/**
 * Headroom + scoring — pure helpers over a ProviderRuntime's (already
 * window-fresh) usage snapshot vs its documented limits.
 *
 * `hasHeadroom` is a hard gate (a provider at any of its minute/day request or
 * token caps is skipped). `providerScore` is a soft 0..1 preference used to
 * order equal-priority providers: reliability × remaining-request-headroom.
 */
import type { ProviderRuntime } from "./types.js";

/** Fraction of the tighter (minute/day) REQUEST budget still free, in [0,1]. */
export function requestHeadroomFraction(p: ProviderRuntime): number {
  const fractions: number[] = [];
  const { requestsPerMinute, requestsPerDay } = p.limits;
  if (requestsPerMinute && requestsPerMinute > 0) {
    fractions.push(1 - p.usage.minute.requests / requestsPerMinute);
  }
  if (requestsPerDay && requestsPerDay > 0) {
    fractions.push(1 - p.usage.day.requests / requestsPerDay);
  }
  if (fractions.length === 0) return 1; // no documented request limit
  return clamp01(Math.min(...fractions));
}

/** True when the provider is below ALL of its documented request/token caps. */
export function hasHeadroom(p: ProviderRuntime): boolean {
  const { limits, usage } = p;
  if (limits.requestsPerMinute && usage.minute.requests >= limits.requestsPerMinute)
    return false;
  if (limits.requestsPerDay && usage.day.requests >= limits.requestsPerDay)
    return false;
  if (limits.tokensPerMinute && usage.minute.tokens >= limits.tokensPerMinute)
    return false;
  if (limits.tokensPerDay && usage.day.tokens >= limits.tokensPerDay)
    return false;
  return true;
}

/** Soft ordering score in [0,1]: reliability weighted by remaining headroom. */
export function providerScore(p: ProviderRuntime): number {
  return clamp01(p.health.reliability) * requestHeadroomFraction(p);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
