/**
 * Payments & coupons: Order and Coupon.
 *
 * Money is stored as INTEGER PAISE (minor units) — decimal-safe without
 * Decimal128 handling in app code. For percentage coupons, `discountValue` is
 * a percent (0–100); for fixed coupons it is an amount in paise.
 */
import { Schema, model, type InferSchemaType } from "mongoose";
import {
  PAYMENT_STATUS_VALUES,
  PaymentStatus,
  COUPON_DISCOUNT_TYPE_VALUES,
} from "@codeapt/shared";

// --- Order -------------------------------------------------------------------
const orderSchema = new Schema(
  {
    // Internal id we generate = the gateway's merchantOrderId (X-VERIFY payload).
    orderId: { type: String, required: true, unique: true },
    transactionId: { type: String }, // gateway (PhonePe) transaction id
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    subject: { type: Schema.Types.ObjectId, ref: "Subject", required: true },
    amount: { type: Number, required: true, min: 0 }, // paise, post-discount
    coupon: { type: Schema.Types.ObjectId, ref: "Coupon" },
    couponCode: { type: String },
    discountAmount: { type: Number, default: 0, min: 0 }, // paise
    status: {
      type: String,
      enum: PAYMENT_STATUS_VALUES,
      default: PaymentStatus.CREATED,
    },
  },
  { timestamps: true },
);
orderSchema.index({ user: 1, status: 1 });
orderSchema.index({ transactionId: 1 });
export type Order = InferSchemaType<typeof orderSchema>;
export const OrderModel = model("Order", orderSchema);

// --- Coupon ------------------------------------------------------------------
const couponSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    discountType: {
      type: String,
      enum: COUPON_DISCOUNT_TYPE_VALUES,
      required: true,
    },
    discountValue: { type: Number, required: true, min: 0 },
    active: { type: Boolean, default: true },
    validFrom: { type: Date },
    validTo: { type: Date },
    usageLimit: { type: Number, default: null }, // global cap; null = unlimited
    perUserLimit: { type: Number, default: 1 },
    usedCount: { type: Number, default: 0, min: 0 },
    // Minimum order value (paise) for the coupon to apply. 0 = no threshold.
    // (Additive to the original coupon model to support min-order rules.)
    minOrderPaise: { type: Number, default: 0, min: 0 },
    // Optional scope: coupon only applies to this subject.
    subject: { type: Schema.Types.ObjectId, ref: "Subject" },
  },
  { timestamps: true },
);
couponSchema.index({ active: 1 });
export type Coupon = InferSchemaType<typeof couponSchema>;
export const CouponModel = model("Coupon", couponSchema);
