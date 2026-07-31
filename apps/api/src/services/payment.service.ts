/**
 * Payments service — the order lifecycle + coupon resolution + the verified,
 * idempotent order→enrollment reconciliation.
 *
 * Invariants:
 *  - The client NEVER supplies an amount; price + coupon are always re-resolved
 *    server-side (`resolvePricing`).
 *  - Enrollment is granted ONLY from a verified successful payment (a signed
 *    callback or a verified fetchStatus) — never from a client claim.
 *  - The success transition happens EXACTLY ONCE (atomic findOneAndUpdate from a
 *    non-terminal status), so a duplicate/out-of-order callback cannot
 *    double-enroll or double-count coupon usage.
 *  - On verified success the user ends up enrolled exactly as the Step-4 free
 *    path would leave them (same Enrollment shape + unique-index idempotency).
 */
import { randomUUID } from "node:crypto";

import {
  CouponRejectReason,
  EnrollmentSource,
  PAYMENT_NON_TERMINAL_STATUSES,
  PaymentErrorCode,
  PaymentStatus,
  applyCoupon,
  effectivePricePaise,
  isFree,
  type CreateOrderResponse,
  type MockPayRequest,
  type OrderListResponse,
  type OrderStatusResponse,
  type QuoteResponse,
} from "@codeapt/shared";
import { Types, type HydratedDocument } from "mongoose";

import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import {
  getPaymentGateway,
  PaymentGatewayError,
} from "../lib/payment-gateway/index.js";
import { buildSignedCallback } from "../lib/payment-gateway/mock.js";
import { logger } from "../lib/logger.js";
import {
  CouponModel,
  OrderModel,
  type Coupon,
  type Order,
} from "../models/commerce.model.js";
import {
  EnrollmentModel,
  SubjectModel,
  type Subject,
} from "../models/curriculum.model.js";

type SubjectDoc = HydratedDocument<Subject>;
type CouponDoc = HydratedDocument<Coupon>;

const MONGO_DUPLICATE_KEY = 11000;
function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: number }).code === MONGO_DUPLICATE_KEY
  );
}

// ---------------------------------------------------------------------------
// Shared resolution helpers
// ---------------------------------------------------------------------------

async function requireSubject(subjectId: string): Promise<SubjectDoc> {
  if (!Types.ObjectId.isValid(subjectId)) {
    throw new AppError(
      "Course not found",
      404,
      PaymentErrorCode.SUBJECT_NOT_FOUND,
    );
  }
  const subject = await SubjectModel.findOne({
    _id: subjectId,
    isVisible: true,
  });
  if (!subject) {
    throw new AppError(
      "Course not found",
      404,
      PaymentErrorCode.SUBJECT_NOT_FOUND,
    );
  }
  return subject;
}

async function isEnrolled(
  userId: string,
  subjectId: Types.ObjectId,
): Promise<boolean> {
  return (
    (await EnrollmentModel.exists({ user: userId, subject: subjectId })) !==
    null
  );
}

interface Pricing {
  basePricePaise: number;
  discountPaise: number;
  finalPaise: number;
  couponApplied: boolean;
  couponCode: string | null;
  coupon: CouponDoc | null;
  reason: CouponRejectReason | null;
}

/**
 * Re-resolve price + coupon fully server-side. Pure arithmetic (window /
 * threshold / active) is delegated to the shared `applyCoupon`; the DB-backed
 * global-usage + per-user-limit checks live here.
 */
async function resolvePricing(
  userId: string,
  subject: SubjectDoc,
  couponCode: string | undefined,
): Promise<Pricing> {
  const basePricePaise = effectivePricePaise(
    subject.price,
    subject.discountPrice,
  );
  const noCoupon: Pricing = {
    basePricePaise,
    discountPaise: 0,
    finalPaise: basePricePaise,
    couponApplied: false,
    couponCode: null,
    coupon: null,
    reason: null,
  };
  if (!couponCode) return noCoupon;

  const code = couponCode.trim().toUpperCase();
  const coupon = await CouponModel.findOne({ code });
  if (!coupon) {
    return { ...noCoupon, reason: CouponRejectReason.NOT_FOUND };
  }

  const applied = applyCoupon(
    basePricePaise,
    {
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      active: coupon.active,
      validFrom: coupon.validFrom,
      validTo: coupon.validTo,
      minOrderPaise: coupon.minOrderPaise,
      subjectId: coupon.subject ? coupon.subject.toString() : null,
    },
    { nowMs: Date.now(), subjectId: subject._id.toString() },
  );
  if (!applied.couponApplied) {
    return { ...noCoupon, reason: applied.reason ?? null };
  }

  // DB-backed usage checks (can't be pure — need counts).
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) {
    return { ...noCoupon, reason: CouponRejectReason.USAGE_EXHAUSTED };
  }
  const perUserUsed = await OrderModel.countDocuments({
    user: userId,
    coupon: coupon._id,
    status: PaymentStatus.SUCCESS,
  });
  if (perUserUsed >= coupon.perUserLimit) {
    return { ...noCoupon, reason: CouponRejectReason.PER_USER_LIMIT };
  }

  return {
    basePricePaise,
    discountPaise: applied.discountPaise,
    finalPaise: applied.finalPaise,
    couponApplied: true,
    couponCode: code,
    coupon,
    reason: null,
  };
}

/** Idempotently grant enrollment — the exact Step-4 shape (source `order`). */
async function grantEnrollment(
  userId: Types.ObjectId,
  subjectId: Types.ObjectId,
  orderId: Types.ObjectId,
): Promise<void> {
  try {
    await EnrollmentModel.create({
      user: userId,
      subject: subjectId,
      source: EnrollmentSource.ORDER,
      order: orderId,
    });
  } catch (err) {
    // Unique (user, subject): already enrolled (free path or a prior callback).
    if (!isDuplicateKeyError(err)) throw err;
  }
}

// ---------------------------------------------------------------------------
// Quote (no side effects)
// ---------------------------------------------------------------------------

export async function quote(
  userId: string,
  input: { subjectId: string; couponCode?: string },
): Promise<QuoteResponse> {
  const subject = await requireSubject(input.subjectId);
  const alreadyEnrolled = await isEnrolled(userId, subject._id);
  const free = isFree(subject.price, subject.discountPrice);
  const pricing = await resolvePricing(userId, subject, input.couponCode);

  return {
    subjectId: subject._id.toString(),
    subjectSlug: subject.slug,
    subjectName: subject.name,
    basePricePaise: pricing.basePricePaise,
    discountPaise: pricing.discountPaise,
    finalPaise: pricing.finalPaise,
    couponApplied: pricing.couponApplied,
    couponCode: pricing.couponCode,
    reason: pricing.reason,
    isFree: free,
    alreadyEnrolled,
  };
}

// ---------------------------------------------------------------------------
// Create order
// ---------------------------------------------------------------------------

export async function createOrder(
  userId: string,
  input: { subjectId: string; couponCode?: string },
): Promise<CreateOrderResponse> {
  const subject = await requireSubject(input.subjectId);

  if (isFree(subject.price, subject.discountPrice)) {
    throw new AppError(
      "This course is free — just enrol, no payment needed",
      400,
      PaymentErrorCode.SUBJECT_FREE,
    );
  }
  if (await isEnrolled(userId, subject._id)) {
    throw new AppError(
      "You already own this course",
      409,
      PaymentErrorCode.ALREADY_ENROLLED,
    );
  }

  const pricing = await resolvePricing(userId, subject, input.couponCode);
  // A supplied-but-rejected coupon is a hard error at checkout (quote is the
  // place to preview); never silently charge full price behind the user's back.
  if (input.couponCode && !pricing.couponApplied) {
    throw new AppError(
      "This coupon can't be applied",
      422,
      PaymentErrorCode.COUPON_REJECTED,
      { reason: pricing.reason },
    );
  }

  const orderId = `ORD-${randomUUID()}`;
  const order = await OrderModel.create({
    orderId,
    user: new Types.ObjectId(userId),
    subject: subject._id,
    amount: pricing.finalPaise,
    discountAmount: pricing.discountPaise,
    coupon: pricing.coupon?._id,
    couponCode: pricing.couponCode ?? undefined,
    status: PaymentStatus.CREATED,
  });

  try {
    const gateway = getPaymentGateway();
    const result = await gateway.createOrder({
      merchantOrderId: orderId,
      amountPaise: pricing.finalPaise,
      redirectUrl: `${env.PAYMENT_REDIRECT_URL}?orderId=${orderId}`,
      callbackUrl: env.PAYMENT_CALLBACK_URL,
      subjectName: subject.name,
    });
    return {
      orderId,
      redirectUrl: result.redirectUrl,
      amountPaise: pricing.finalPaise,
      discountPaise: pricing.discountPaise,
      couponCode: pricing.couponCode,
    };
  } catch (err) {
    // Gateway failed to accept the order — mark it failed so it isn't left dangling.
    await OrderModel.updateOne(
      { _id: order._id, status: PaymentStatus.CREATED },
      { $set: { status: PaymentStatus.FAILED } },
    );
    logger.error({ err, orderId }, "gateway createOrder failed");
    throw new AppError(
      err instanceof PaymentGatewayError
        ? "Payment could not be started, please try again"
        : "Payment could not be started",
      502,
      PaymentErrorCode.GATEWAY_ERROR,
    );
  }
}

// ---------------------------------------------------------------------------
// Reconciliation — the exactly-once terminal transition
// ---------------------------------------------------------------------------

/**
 * Apply a VERIFIED terminal outcome to an order. Atomic + idempotent:
 *  - success: transition non-terminal→success EXACTLY ONCE, then (only on that
 *    first transition) grant enrollment + increment coupon usage.
 *  - failure: transition non-terminal→failed (won't override a success).
 * A duplicate or out-of-order delivery whose update matches nothing is a no-op.
 */
async function applyVerifiedOutcome(
  orderId: string,
  status: "success" | "failed",
  gatewayTxnId: string | null,
): Promise<PaymentStatus> {
  if (status === "failed") {
    await OrderModel.updateOne(
      { orderId, status: { $in: PAYMENT_NON_TERMINAL_STATUSES } },
      { $set: { status: PaymentStatus.FAILED, transactionId: gatewayTxnId } },
    );
    const order = await OrderModel.findOne({ orderId }).select("status");
    return (order?.status as PaymentStatus) ?? PaymentStatus.FAILED;
  }

  const transitioned = await OrderModel.findOneAndUpdate(
    { orderId, status: { $in: PAYMENT_NON_TERMINAL_STATUSES } },
    { $set: { status: PaymentStatus.SUCCESS, transactionId: gatewayTxnId } },
    { new: true },
  );

  if (transitioned) {
    // First (and only) success transition — grant enrollment + count coupon.
    await grantEnrollment(
      transitioned.user,
      transitioned.subject,
      transitioned._id,
    );
    if (transitioned.coupon) {
      await CouponModel.updateOne(
        { _id: transitioned.coupon },
        { $inc: { usedCount: 1 } },
      );
    }
    logger.info(
      { orderId, subject: transitioned.subject.toString() },
      "order succeeded — enrollment granted",
    );
  } else {
    logger.info({ orderId }, "order success callback ignored (already final)");
  }
  return PaymentStatus.SUCCESS;
}

/** Handle a raw gateway webhook: verify signature, then reconcile. */
export async function handleCallback(
  headers: Record<string, string | undefined>,
  rawBody: string,
): Promise<{ ok: boolean; orderId?: string; status?: PaymentStatus }> {
  const gateway = getPaymentGateway();
  const verified = gateway.verifyCallback(headers, rawBody);
  if (!verified) {
    logger.warn("payment callback failed verification — rejected");
    return { ok: false };
  }
  const status = await applyVerifiedOutcome(
    verified.merchantOrderId,
    verified.status,
    verified.gatewayTxnId,
  );
  return { ok: true, orderId: verified.merchantOrderId, status };
}

// ---------------------------------------------------------------------------
// Read (status + list) with optional reconcile-on-read
// ---------------------------------------------------------------------------

async function toOrderStatus(
  order: HydratedDocument<Order>,
): Promise<OrderStatusResponse> {
  const subject = await SubjectModel.findById(order.subject).select(
    "slug name",
  );
  const enrolled = await isEnrolled(order.user.toString(), order.subject);
  return {
    orderId: order.orderId,
    status: order.status as PaymentStatus,
    amountPaise: order.amount,
    discountPaise: order.discountAmount,
    couponCode: order.couponCode ?? null,
    transactionId: order.transactionId ?? null,
    subject: {
      id: order.subject.toString(),
      slug: subject?.slug ?? "",
      name: subject?.name ?? "",
    },
    enrolled,
    createdAt: (order.createdAt ?? new Date()).toISOString(),
  };
}

export async function getOrder(
  userId: string,
  orderId: string,
): Promise<OrderStatusResponse> {
  const order = await OrderModel.findOne({ orderId });
  if (!order) {
    throw new AppError(
      "Order not found",
      404,
      PaymentErrorCode.ORDER_NOT_FOUND,
    );
  }
  if (order.user.toString() !== userId) {
    throw new AppError(
      "You do not own this order",
      403,
      PaymentErrorCode.NOT_AUTHORIZED,
    );
  }

  // Reconcile-on-read: if still non-terminal, ask the gateway for the truth.
  // (The mock returns `pending` — it has no server state, so the signed webhook
  // remains the source of truth in mock mode; real PhonePe resolves here.)
  if (PAYMENT_NON_TERMINAL_STATUSES.includes(order.status as PaymentStatus)) {
    try {
      const gateway = getPaymentGateway();
      const remote = await gateway.fetchStatus(orderId);
      if (
        remote.status === PaymentStatus.SUCCESS ||
        remote.status === PaymentStatus.FAILED
      ) {
        await applyVerifiedOutcome(
          orderId,
          remote.status === PaymentStatus.SUCCESS ? "success" : "failed",
          remote.gatewayTxnId,
        );
        const fresh = await OrderModel.findOne({ orderId });
        if (fresh) return toOrderStatus(fresh);
      }
    } catch (err) {
      // Reconcile is best-effort; fall through to the stored status.
      logger.warn({ err, orderId }, "reconcile-on-read failed");
    }
  }
  return toOrderStatus(order);
}

export async function listOrders(userId: string): Promise<OrderListResponse> {
  const orders = await OrderModel.find({ user: userId }).sort({
    createdAt: -1,
  });
  const subjectIds = [...new Set(orders.map((o) => o.subject.toString()))];
  const subjects = await SubjectModel.find({
    _id: { $in: subjectIds },
  }).select("slug name");
  const byId = new Map(subjects.map((s) => [s._id.toString(), s]));

  return {
    items: orders.map((o) => {
      const s = byId.get(o.subject.toString());
      return {
        orderId: o.orderId,
        status: o.status as PaymentStatus,
        amountPaise: o.amount,
        discountPaise: o.discountAmount,
        couponCode: o.couponCode ?? null,
        subjectSlug: s?.slug ?? "",
        subjectName: s?.name ?? "",
        createdAt: (o.createdAt ?? new Date()).toISOString(),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Mock-only: drive a verified success/failure callback (Part 2 / tests)
// ---------------------------------------------------------------------------

export async function mockPay(
  userId: string,
  input: MockPayRequest,
): Promise<OrderStatusResponse> {
  if (env.PAYMENT_GATEWAY !== "mock") {
    throw new AppError(
      "Mock payment is disabled",
      400,
      PaymentErrorCode.MOCK_DISABLED,
    );
  }
  const order = await OrderModel.findOne({ orderId: input.orderId });
  if (!order) {
    throw new AppError(
      "Order not found",
      404,
      PaymentErrorCode.ORDER_NOT_FOUND,
    );
  }
  if (order.user.toString() !== userId) {
    throw new AppError(
      "You do not own this order",
      403,
      PaymentErrorCode.NOT_AUTHORIZED,
    );
  }
  // Produce a validly-signed callback and drive it through the SAME verified
  // webhook path — so the mock exercises signature verification too.
  const { headers, rawBody } = buildSignedCallback(
    input.orderId,
    input.outcome,
  );
  await handleCallback(headers, rawBody);

  const fresh = await OrderModel.findOne({ orderId: input.orderId });
  return toOrderStatus(fresh ?? order);
}
