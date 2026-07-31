/**
 * Pure careers helpers. No I/O — deterministic functions of stored posting
 * state + an injected "now", so the open/closed logic is unit-testable and
 * identical on the API and the web client.
 *
 * The source had no eligibility rules (CGPA/branch/batch); the only gates are
 * the `isActive` flag and an optional application `deadline`.
 */
import { CareerErrorCode } from "./constants.js";

export interface PostingGateState {
  isActive: boolean;
  /** Application deadline (epoch ms), or null when the posting never closes. */
  deadlineMs: number | null;
}

export type PostingOpenReason = Extract<
  CareerErrorCode,
  "POSTING_CLOSED" | "DEADLINE_PASSED"
>;

export interface PostingOpenResult {
  isOpen: boolean;
  reason: PostingOpenReason | null;
}

/**
 * Whether a posting currently accepts applications. Inactive → POSTING_CLOSED;
 * past its deadline → DEADLINE_PASSED; otherwise open.
 */
export function postingOpenState(
  posting: PostingGateState,
  nowMs: number,
): PostingOpenResult {
  if (!posting.isActive) {
    return { isOpen: false, reason: CareerErrorCode.POSTING_CLOSED };
  }
  if (posting.deadlineMs !== null && nowMs > posting.deadlineMs) {
    return { isOpen: false, reason: CareerErrorCode.DEADLINE_PASSED };
  }
  return { isOpen: true, reason: null };
}

/** Convenience boolean form of {@link postingOpenState}. */
export function isPostingOpen(
  posting: PostingGateState,
  nowMs: number,
): boolean {
  return postingOpenState(posting, nowMs).isOpen;
}
