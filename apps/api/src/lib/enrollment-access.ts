/**
 * Course-access expiry helpers. An enrollment grants access until `expiresAt`
 * (null = lifetime). Expiry is a SOFT state — the row is kept, never deleted —
 * so access is reversible (raise the course's validity, re-enroll, or re-buy)
 * and history is preserved. Everywhere access is decided (content gate, "my
 * courses" list, catalog badge, payment "already enrolled") filters on this.
 */

/**
 * Mongo fragment matching enrollments that have NOT expired: those with no
 * expiry, or an expiry still in the future. Spread into a find/exists filter.
 */
export function notExpiredFilter(now: Date = new Date()): Record<string, unknown> {
  return { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] };
}

/** Whether an enrollment doc is currently active (not past its expiry). */
export function isEnrollmentActive(
  enrollment: { expiresAt?: Date | null } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!enrollment) return false;
  return enrollment.expiresAt == null || enrollment.expiresAt > now;
}

/**
 * The access-end date for a fresh enrollment: `from + validityDays`, or null
 * when the course grants lifetime access (validityDays <= 0).
 */
export function computeExpiresAt(
  validityDays: number,
  from: Date = new Date(),
): Date | null {
  if (!validityDays || validityDays <= 0) return null;
  return new Date(from.getTime() + validityDays * 24 * 60 * 60 * 1000);
}
