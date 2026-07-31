/**
 * Idempotent payments seed — coupons exercising the doc's rules. The curriculum
 * seed already ships PAID subjects (data-structures-cpp, system-design-primer),
 * so this only adds coupons. Re-runnable: coupons upsert by `code`.
 *
 *   pnpm --filter @codeapt/api seed:payments
 *
 * Coupons:
 *   LAUNCH20   — 20% off, ₹500 min-order, valid window (now-1d … now+30d)
 *   FLAT100    — ₹100 flat off, no min, active
 *   EXPIRED10  — 10% off but validTo in the past (negative test)
 *   OFFSEASON  — inactive (negative test)
 */
import { CouponDiscountType } from "@codeapt/shared";

import { connectDatabase, disconnectDatabase } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { CouponModel } from "../models/commerce.model.js";

const DAY = 24 * 60 * 60 * 1000;

async function seedPayments(): Promise<void> {
  await connectDatabase();
  try {
    const now = Date.now();
    const coupons = [
      {
        code: "LAUNCH20",
        discountType: CouponDiscountType.PERCENTAGE,
        discountValue: 20, // percent
        active: true,
        validFrom: new Date(now - DAY),
        validTo: new Date(now + 30 * DAY),
        minOrderPaise: 50000, // ₹500
        usageLimit: null,
        perUserLimit: 1,
      },
      {
        code: "FLAT100",
        discountType: CouponDiscountType.FIXED,
        discountValue: 10000, // ₹100 in paise
        active: true,
        minOrderPaise: 0,
        usageLimit: 1000,
        perUserLimit: 2,
      },
      {
        code: "EXPIRED10",
        discountType: CouponDiscountType.PERCENTAGE,
        discountValue: 10,
        active: true,
        validFrom: new Date(now - 60 * DAY),
        validTo: new Date(now - 30 * DAY), // expired
        minOrderPaise: 0,
        perUserLimit: 1,
      },
      {
        code: "OFFSEASON",
        discountType: CouponDiscountType.PERCENTAGE,
        discountValue: 15,
        active: false, // inactive
        minOrderPaise: 0,
        perUserLimit: 1,
      },
    ];

    for (const c of coupons) {
      await CouponModel.findOneAndUpdate(
        { code: c.code },
        {
          $set: {
            discountType: c.discountType,
            discountValue: c.discountValue,
            active: c.active,
            validFrom: c.validFrom ?? null,
            validTo: c.validTo ?? null,
            minOrderPaise: c.minOrderPaise,
            usageLimit: c.usageLimit ?? null,
            perUserLimit: c.perUserLimit,
          },
        },
        { upsert: true, new: true },
      );
    }

    logger.info(
      `Payments seed complete: ${coupons.length} coupons ` +
        `(${coupons.map((c) => c.code).join(", ")})`,
    );
  } finally {
    await disconnectDatabase();
  }
}

seedPayments()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    logger.error({ err }, "seed:payments failed");
    process.exit(1);
  });
