/**
 * When a request is rate-limited (429 / code "RATE_LIMITED"), how many seconds
 * the caller should wait before retrying. Reads `details.retryAfterSeconds`
 * from the server, falling back to 60s (the window). Returns null when the
 * error isn't a rate-limit, so callers can branch on it.
 */
export function rateLimitRetrySeconds(err: {
  code?: string;
  status?: number;
  details?: unknown;
}): number | null {
  const isRateLimited = err.code === "RATE_LIMITED" || err.status === 429;
  if (!isRateLimited) return null;
  const d = err.details;
  const raw =
    d && typeof d === "object" && "retryAfterSeconds" in d
      ? Number((d as { retryAfterSeconds?: unknown }).retryAfterSeconds)
      : NaN;
  return Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : 60;
}
