/**
 * Unit tests for the pure checkout helpers: the CouponRejectReason → friendly
 * copy mapper, the Pay-enable gate given a quote, and terminal-status
 * detection.
 */
import {
  CouponRejectReason,
  PaymentStatus,
  type QuoteResponse,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import {
  couponRejectCopy,
  isTerminalStatus,
  shouldEnablePay,
} from "../src/lib/payments-ui.js";

function quote(over: Partial<QuoteResponse> = {}): QuoteResponse {
  return {
    subjectId: "s1",
    subjectSlug: "course",
    subjectName: "Course",
    basePricePaise: 99900,
    discountPaise: 0,
    finalPaise: 99900,
    couponApplied: false,
    couponCode: null,
    reason: null,
    isFree: false,
    alreadyEnrolled: false,
    ...over,
  };
}

describe("couponRejectCopy", () => {
  it("maps each reason to friendly copy", () => {
    expect(couponRejectCopy(CouponRejectReason.EXPIRED)).toMatch(/expired/i);
    expect(couponRejectCopy(CouponRejectReason.NOT_YET_VALID)).toMatch(
      /active yet/i,
    );
    expect(couponRejectCopy(CouponRejectReason.SUBJECT_MISMATCH)).toMatch(
      /doesn.t apply/i,
    );
    expect(couponRejectCopy(CouponRejectReason.USAGE_EXHAUSTED)).toMatch(
      /already been used/i,
    );
    expect(couponRejectCopy(CouponRejectReason.PER_USER_LIMIT)).toMatch(
      /already been used/i,
    );
    expect(couponRejectCopy(CouponRejectReason.INACTIVE)).toMatch(
      /isn.t valid/i,
    );
    expect(couponRejectCopy(CouponRejectReason.NOT_FOUND)).toMatch(
      /isn.t valid/i,
    );
  });
  it("min-order copy uses the threshold when provided", () => {
    expect(
      couponRejectCopy(CouponRejectReason.MIN_ORDER_NOT_MET, 50000),
    ).toMatch(/₹500/);
    // Without a threshold, falls back to a generic message.
    expect(couponRejectCopy(CouponRejectReason.MIN_ORDER_NOT_MET)).toMatch(
      /minimum/i,
    );
  });
});

describe("shouldEnablePay", () => {
  it("no coupon entered → enabled", () => {
    expect(shouldEnablePay({ couponEntered: false, quote: quote() })).toBe(
      true,
    );
  });
  it("no coupon + no quote yet → enabled (order re-prices base)", () => {
    expect(shouldEnablePay({ couponEntered: false, quote: null })).toBe(true);
  });
  it("coupon entered + accepted → enabled", () => {
    expect(
      shouldEnablePay({
        couponEntered: true,
        quote: quote({ couponApplied: true, discountPaise: 20000 }),
      }),
    ).toBe(true);
  });
  it("coupon entered + rejected → disabled", () => {
    expect(
      shouldEnablePay({
        couponEntered: true,
        quote: quote({
          couponApplied: false,
          reason: CouponRejectReason.EXPIRED,
        }),
      }),
    ).toBe(false);
  });
  it("free or already-enrolled subject → disabled", () => {
    expect(
      shouldEnablePay({ couponEntered: false, quote: quote({ isFree: true }) }),
    ).toBe(false);
    expect(
      shouldEnablePay({
        couponEntered: false,
        quote: quote({ alreadyEnrolled: true }),
      }),
    ).toBe(false);
  });
});

describe("isTerminalStatus", () => {
  it("success / failed / expired are terminal", () => {
    expect(isTerminalStatus(PaymentStatus.SUCCESS)).toBe(true);
    expect(isTerminalStatus(PaymentStatus.FAILED)).toBe(true);
    expect(isTerminalStatus(PaymentStatus.EXPIRED)).toBe(true);
  });
  it("created / pending are not terminal", () => {
    expect(isTerminalStatus(PaymentStatus.CREATED)).toBe(false);
    expect(isTerminalStatus(PaymentStatus.PENDING)).toBe(false);
  });
});
