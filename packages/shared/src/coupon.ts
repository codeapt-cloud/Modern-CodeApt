/**
 * Pure coupon arithmetic + eligibility. No I/O — a deterministic function of
 * the coupon definition, the base price, and a caller-supplied "now". The
 * DB-backed checks (global usage cap, per-user limit) live in the service; the
 * window / threshold / active / subject-scope logic and the discount math are
 * here so they are exhaustively unit-testable.
 *
 * All money is INTEGER PAISE. Percentage discounts round to the nearest paisa;
 * every result is clamped so a discount never exceeds the price and a charge is
 * never negative.
 */
import { CouponRejectReason } from "./constants.js";
import { CouponDiscountType } from "./enums.js";

/** The coupon fields the pure engine reads (a subset of the Mongoose doc). */
export interface CouponRule {
  discountType: CouponDiscountType;
  /** Percent (0–100) for `percentage`; paise for `fixed`. */
  discountValue: number;
  active: boolean;
  validFrom?: Date | null;
  validTo?: Date | null;
  /** Minimum order value (paise) required for the coupon to apply. 0 = none. */
  minOrderPaise?: number;
  /** When set, the coupon only applies to this subject id. */
  subjectId?: string | null;
}

export interface ApplyCouponContext {
  /** Current time in epoch ms (injected so the function stays pure/testable). */
  nowMs: number;
  /** The subject the order is for (checked against the coupon's scope). */
  subjectId?: string;
}

export interface ApplyCouponResult {
  couponApplied: boolean;
  discountPaise: number;
  finalPaise: number;
  reason?: CouponRejectReason;
}

const clampInt = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, Math.round(n)));

/**
 * Compute the raw discount (before clamping) for a coupon against a base price.
 * Percentage rounds to the nearest paisa.
 */
export function rawDiscountPaise(
  basePricePaise: number,
  rule: Pick<CouponRule, "discountType" | "discountValue">,
): number {
  if (rule.discountType === CouponDiscountType.PERCENTAGE) {
    return Math.round((basePricePaise * rule.discountValue) / 100);
  }
  // Fixed: discountValue is already in paise.
  return Math.round(rule.discountValue);
}

/**
 * Apply a coupon to a base price. On rejection returns the base price unchanged
 * with `couponApplied: false` and a structured `reason`; on success returns the
 * clamped discount + final charge.
 */
export function applyCoupon(
  basePricePaise: number,
  rule: CouponRule,
  context: ApplyCouponContext,
): ApplyCouponResult {
  const noDiscount = (reason?: CouponRejectReason): ApplyCouponResult => ({
    couponApplied: false,
    discountPaise: 0,
    finalPaise: Math.max(0, Math.round(basePricePaise)),
    reason,
  });

  if (!rule.active) return noDiscount(CouponRejectReason.INACTIVE);

  if (rule.validFrom && context.nowMs < rule.validFrom.getTime()) {
    return noDiscount(CouponRejectReason.NOT_YET_VALID);
  }
  if (rule.validTo && context.nowMs > rule.validTo.getTime()) {
    return noDiscount(CouponRejectReason.EXPIRED);
  }

  if (
    rule.subjectId &&
    context.subjectId &&
    rule.subjectId !== context.subjectId
  ) {
    return noDiscount(CouponRejectReason.SUBJECT_MISMATCH);
  }

  const minOrder = rule.minOrderPaise ?? 0;
  if (basePricePaise < minOrder) {
    return noDiscount(CouponRejectReason.MIN_ORDER_NOT_MET);
  }

  // Clamp the discount into [0, base] so the final charge is never negative.
  const discountPaise = clampInt(
    rawDiscountPaise(basePricePaise, rule),
    0,
    Math.max(0, Math.round(basePricePaise)),
  );
  const finalPaise = Math.max(0, Math.round(basePricePaise) - discountPaise);
  return { couponApplied: true, discountPaise, finalPaise };
}
