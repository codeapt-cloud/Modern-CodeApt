/**
 * Parse an HTTP `Retry-After` header into a delay in milliseconds.
 *
 * Two RFC forms are accepted: delta-seconds (e.g. "120") and an HTTP-date (e.g.
 * "Wed, 21 Oct 2026 07:28:00 GMT"). The result is CLAMPED to [0, 24h] so a
 * hostile or buggy header can never bench a provider longer than a day.
 *
 * Pure: `now` is passed in (no ambient clock) so it's deterministic in tests.
 */

/** Hard ceiling on any Retry-After delay — a hostile header can't exceed this. */
export const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

export function parseRetryAfterMs(
  header: string | null | undefined,
  now: number,
): number | null {
  if (header == null) return null;
  const trimmed = header.trim();
  if (trimmed === "") return null;

  // delta-seconds (a bare non-negative integer).
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds)) return null;
    return clamp(seconds * 1000);
  }

  // HTTP-date.
  const when = Date.parse(trimmed);
  if (Number.isNaN(when)) return null;
  return clamp(when - now);
}

function clamp(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.min(MAX_RETRY_AFTER_MS, Math.round(ms)));
}
