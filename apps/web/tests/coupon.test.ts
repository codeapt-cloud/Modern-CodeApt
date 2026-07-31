/**
 * Unit tests for the pure coupon engine (@codeapt/shared): percentage & flat
 * discounts, min-order threshold, validity window, active flag, subject scope,
 * clamping to [0, base], and rounding boundaries. All money is integer paise.
 */
import {
  CouponDiscountType,
  CouponRejectReason,
  applyCoupon,
  rawDiscountPaise,
  type CouponRule,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

const NOW = Date.UTC(2026, 0, 15); // fixed "now" for deterministic windows
const ctx = { nowMs: NOW };

function pct(value: number, over: Partial<CouponRule> = {}): CouponRule {
  return {
    discountType: CouponDiscountType.PERCENTAGE,
    discountValue: value,
    active: true,
    ...over,
  };
}
function flat(paise: number, over: Partial<CouponRule> = {}): CouponRule {
  return {
    discountType: CouponDiscountType.FIXED,
    discountValue: paise,
    active: true,
    ...over,
  };
}

describe("rawDiscountPaise", () => {
  it("percentage rounds to the nearest paisa", () => {
    // 33% of 100 = 33
    expect(rawDiscountPaise(100, pct(33))).toBe(33);
    // 10% of 99999 = 9999.9 -> 10000
    expect(rawDiscountPaise(99999, pct(10))).toBe(10000);
    // 12.5% of 100 = 12.5 -> 13 (round half up)
    expect(rawDiscountPaise(100, pct(12.5))).toBe(13);
  });
  it("fixed is the paise amount", () => {
    expect(rawDiscountPaise(100000, flat(10000))).toBe(10000);
  });
});

describe("applyCoupon — success", () => {
  it("percentage discount + final", () => {
    const r = applyCoupon(100000, pct(20), ctx); // ₹1000, 20% off
    expect(r.couponApplied).toBe(true);
    expect(r.discountPaise).toBe(20000);
    expect(r.finalPaise).toBe(80000);
    expect(r.reason).toBeUndefined();
  });
  it("flat discount + final", () => {
    const r = applyCoupon(100000, flat(10000), ctx);
    expect(r.discountPaise).toBe(10000);
    expect(r.finalPaise).toBe(90000);
  });
  it("meets an exact min-order threshold (inclusive)", () => {
    const r = applyCoupon(50000, pct(10, { minOrderPaise: 50000 }), ctx);
    expect(r.couponApplied).toBe(true);
    expect(r.finalPaise).toBe(45000);
  });
  it("applies within the validity window", () => {
    const r = applyCoupon(
      100000,
      pct(10, {
        validFrom: new Date(NOW - 1000),
        validTo: new Date(NOW + 1000),
      }),
      ctx,
    );
    expect(r.couponApplied).toBe(true);
  });
  it("applies when the subject scope matches", () => {
    const r = applyCoupon(100000, pct(10, { subjectId: "s1" }), {
      nowMs: NOW,
      subjectId: "s1",
    });
    expect(r.couponApplied).toBe(true);
  });
});

describe("applyCoupon — clamping", () => {
  it("never discounts below 0 (flat larger than price)", () => {
    const r = applyCoupon(5000, flat(999999), ctx);
    expect(r.discountPaise).toBe(5000);
    expect(r.finalPaise).toBe(0);
  });
  it("100% coupon zeroes the charge, not below", () => {
    const r = applyCoupon(12345, pct(100), ctx);
    expect(r.discountPaise).toBe(12345);
    expect(r.finalPaise).toBe(0);
  });
  it("a free base stays free", () => {
    const r = applyCoupon(0, pct(50), ctx);
    expect(r.discountPaise).toBe(0);
    expect(r.finalPaise).toBe(0);
  });
});

describe("applyCoupon — rejection reasons", () => {
  it("inactive", () => {
    const r = applyCoupon(100000, pct(20, { active: false }), ctx);
    expect(r.couponApplied).toBe(false);
    expect(r.reason).toBe(CouponRejectReason.INACTIVE);
    expect(r.finalPaise).toBe(100000);
    expect(r.discountPaise).toBe(0);
  });
  it("not-yet-valid", () => {
    const r = applyCoupon(
      100000,
      pct(20, { validFrom: new Date(NOW + 10_000) }),
      ctx,
    );
    expect(r.reason).toBe(CouponRejectReason.NOT_YET_VALID);
  });
  it("expired", () => {
    const r = applyCoupon(
      100000,
      pct(20, { validTo: new Date(NOW - 10_000) }),
      ctx,
    );
    expect(r.reason).toBe(CouponRejectReason.EXPIRED);
  });
  it("min-order not met", () => {
    const r = applyCoupon(49999, pct(20, { minOrderPaise: 50000 }), ctx);
    expect(r.reason).toBe(CouponRejectReason.MIN_ORDER_NOT_MET);
    expect(r.finalPaise).toBe(49999);
  });
  it("subject mismatch", () => {
    const r = applyCoupon(100000, pct(20, { subjectId: "s1" }), {
      nowMs: NOW,
      subjectId: "s2",
    });
    expect(r.reason).toBe(CouponRejectReason.SUBJECT_MISMATCH);
  });
});
