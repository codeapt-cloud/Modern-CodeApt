/**
 * Rolling-window helpers shared by provider-source (reading fresh usage) and
 * persist (resetting + incrementing counters). Minute buckets are floored to the
 * minute; day buckets to UTC midnight (matching how free tiers document daily
 * quotas). Pure over an injected `now`.
 */
export function minuteWindowStart(now: number): number {
  return Math.floor(now / 60_000) * 60_000;
}

export function utcDayWindowStart(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
}
