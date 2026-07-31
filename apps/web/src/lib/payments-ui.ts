/**
 * Pure helpers for the checkout UI — coupon reject-reason copy, the Pay-enable
 * gate, and terminal-status detection. No I/O, no React; unit-tested. The
 * server owns pricing, coupon validity, and the order lifecycle; these only
 * drive presentation + the client-side affordances.
 */
import {
  CouponRejectReason,
  PaymentStatus,
  formatINR,
  type PaymentStatus as PaymentStatusT,
  type QuoteResponse,
} from "@codeapt/shared";

/** Map a structured coupon rejection to friendly, user-facing copy. */
export function couponRejectCopy(
  reason: CouponRejectReason,
  minOrderPaise?: number,
): string {
  switch (reason) {
    case CouponRejectReason.EXPIRED:
      return "This coupon has expired";
    case CouponRejectReason.NOT_YET_VALID:
      return "This coupon isn't active yet";
    case CouponRejectReason.MIN_ORDER_NOT_MET:
      return minOrderPaise && minOrderPaise > 0
        ? `Minimum order ${formatINR(minOrderPaise)} not met`
        : "Your order doesn't meet this coupon's minimum";
    case CouponRejectReason.SUBJECT_MISMATCH:
      return "This coupon doesn't apply to this course";
    case CouponRejectReason.USAGE_EXHAUSTED:
    case CouponRejectReason.PER_USER_LIMIT:
      return "This coupon has already been used";
    case CouponRejectReason.INACTIVE:
    case CouponRejectReason.NOT_FOUND:
    default:
      return "This coupon isn't valid";
  }
}

/**
 * Whether "Pay" should be enabled.
 *  - free / already-enrolled subjects can never be paid for.
 *  - with a coupon typed in, require a preview that ACCEPTED it (avoids the
 *    server's hard 422 at order creation).
 *  - with no coupon, Pay is enabled (order creation re-prices the base).
 */
export function shouldEnablePay(params: {
  couponEntered: boolean;
  quote: QuoteResponse | null;
}): boolean {
  const { couponEntered, quote } = params;
  if (quote && (quote.isFree || quote.alreadyEnrolled)) return false;
  if (!couponEntered) return true;
  return quote?.couponApplied === true;
}

/** Terminal order states — polling stops here. */
export function isTerminalStatus(status: PaymentStatusT): boolean {
  return (
    status === PaymentStatus.SUCCESS ||
    status === PaymentStatus.FAILED ||
    status === PaymentStatus.EXPIRED
  );
}
