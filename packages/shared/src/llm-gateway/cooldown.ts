/**
 * Cooldown math — turns a provider failure into a `cooldownUntil` epoch-ms.
 *
 * Precedence: an explicit Retry-After always wins (already clamped to 24h). Else
 * a DAILY/quota rate-limit benches the provider until the next UTC midnight (its
 * documented daily window resets there); a per-minute burst benches ~1 minute; a
 * transient error benches ~30s; a fatal error (bad key / bad request) benches
 * ~10 min so we stop hammering a broken provider but still retry it later.
 *
 * Pure: `now` is passed in. Every result is bounded by [now, now+24h].
 */
import { MAX_RETRY_AFTER_MS } from "./retry-after.js";
import type { ProviderHttpError } from "./types.js";

export const MINUTE_COOLDOWN_MS = 60 * 1000;
export const TRANSIENT_COOLDOWN_MS = 30 * 1000;
export const FATAL_COOLDOWN_MS = 10 * 60 * 1000;

/** Epoch ms of the next UTC 00:00 strictly after `now`. */
export function nextUtcDayResetMs(now: number): number {
  const d = new Date(now);
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
}

/** Compute `cooldownUntil` (epoch ms) for a provider error. */
export function cooldownUntilFor(err: ProviderHttpError, now: number): number {
  if (err.retryAfterMs != null) {
    return now + Math.min(err.retryAfterMs, MAX_RETRY_AFTER_MS);
  }
  let delta: number;
  switch (err.classification) {
    case "rate_limit":
      delta = err.daily ? nextUtcDayResetMs(now) - now : MINUTE_COOLDOWN_MS;
      break;
    case "transient":
      delta = TRANSIENT_COOLDOWN_MS;
      break;
    case "fatal":
    default:
      delta = FATAL_COOLDOWN_MS;
      break;
  }
  return now + Math.max(0, Math.min(delta, MAX_RETRY_AFTER_MS));
}
