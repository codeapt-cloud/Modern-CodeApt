/**
 * Payments API tests (supertest + in-memory Mongo, mock gateway). Covers quote
 * (coupon accept/reject reasons, free, already-enrolled), order creation
 * (server-side re-price, free/enrolled guards), and the WEBHOOK: verified
 * success → exactly one enrollment + status success + coupon usage counted
 * once; DUPLICATE success → still one; verified failure → no enrollment;
 * bad-signature → rejected. Plus status/list + ownership.
 */
import { CouponDiscountType, PaymentStatus } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import {
  MOCK_SIGNATURE_HEADER,
  buildSignedCallback,
} from "../src/lib/payment-gateway/mock.js";
import { CouponModel, OrderModel } from "../src/models/commerce.model.js";
import {
  EnrollmentModel,
  ProgramModel,
  SubjectModel,
} from "../src/models/curriculum.model.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

let counter = 0;
async function registerAndLogin(): Promise<{ token: string; userId: string }> {
  counter += 1;
  const u = `pay${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Buyer ${counter}`,
      rollNumber: `ROLL-P-${counter}`,
      collegeName: "Acme",
      phoneNumber: "9999999999",
      state: "KA",
    });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ identifier: u, password: "Password123" });
  return {
    token: res.body.accessToken as string,
    userId: res.body.user.id as string,
  };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function makeSubject(
  price: number,
  discountPrice = 0,
): Promise<{ id: string }> {
  const program = await ProgramModel.create({
    name: "Prog",
    slug: `prog-${counter}-${Math.round(performance.now())}`,
  });
  const subject = await SubjectModel.create({
    name: "Paid Course",
    slug: `paid-${counter}-${Math.round(performance.now())}`,
    program: program._id,
    price,
    discountPrice,
    isVisible: true,
  });
  return { id: subject._id.toString() };
}

/** Drive the signature-verified webhook for an order + outcome. */
function fireCallback(orderId: string, outcome: "success" | "failure") {
  const { headers, rawBody } = buildSignedCallback(orderId, outcome);
  return request(app)
    .post("/api/payments/callback")
    .set("Content-Type", "application/json")
    .set(MOCK_SIGNATURE_HEADER, headers[MOCK_SIGNATURE_HEADER] ?? "")
    .send(rawBody);
}

describe("POST /api/payments/quote", () => {
  it("reports a paid subject with no coupon (base == final)", async () => {
    const { id } = await makeSubject(129900, 99900);
    const { token } = await registerAndLogin();
    const res = await request(app)
      .post("/api/payments/quote")
      .set(auth(token))
      .send({ subjectId: id });
    expect(res.status).toBe(200);
    expect(res.body.basePricePaise).toBe(99900); // effective (discountPrice)
    expect(res.body.finalPaise).toBe(99900);
    expect(res.body.isFree).toBe(false);
    expect(res.body.couponApplied).toBe(false);
  });

  it("applies a valid percentage coupon", async () => {
    const { id } = await makeSubject(100000);
    await CouponModel.create({
      code: "SAVE20",
      discountType: CouponDiscountType.PERCENTAGE,
      discountValue: 20,
      active: true,
      minOrderPaise: 50000,
    });
    const { token } = await registerAndLogin();
    const res = await request(app)
      .post("/api/payments/quote")
      .set(auth(token))
      .send({ subjectId: id, couponCode: "save20" });
    expect(res.body.couponApplied).toBe(true);
    expect(res.body.discountPaise).toBe(20000);
    expect(res.body.finalPaise).toBe(80000);
    expect(res.body.couponCode).toBe("SAVE20");
  });

  it("rejects an expired coupon with a reason", async () => {
    const { id } = await makeSubject(100000);
    await CouponModel.create({
      code: "OLD",
      discountType: CouponDiscountType.PERCENTAGE,
      discountValue: 10,
      active: true,
      validTo: new Date(Date.now() - 86_400_000),
    });
    const { token } = await registerAndLogin();
    const res = await request(app)
      .post("/api/payments/quote")
      .set(auth(token))
      .send({ subjectId: id, couponCode: "OLD" });
    expect(res.body.couponApplied).toBe(false);
    expect(res.body.reason).toBe("expired");
    expect(res.body.finalPaise).toBe(100000);
  });

  it("rejects a min-order-not-met coupon", async () => {
    const { id } = await makeSubject(30000);
    await CouponModel.create({
      code: "BIG",
      discountType: CouponDiscountType.PERCENTAGE,
      discountValue: 10,
      active: true,
      minOrderPaise: 50000,
    });
    const { token } = await registerAndLogin();
    const res = await request(app)
      .post("/api/payments/quote")
      .set(auth(token))
      .send({ subjectId: id, couponCode: "BIG" });
    expect(res.body.reason).toBe("min-order-not-met");
  });

  it("reports a free subject", async () => {
    const { id } = await makeSubject(0);
    const { token } = await registerAndLogin();
    const res = await request(app)
      .post("/api/payments/quote")
      .set(auth(token))
      .send({ subjectId: id });
    expect(res.body.isFree).toBe(true);
    expect(res.body.finalPaise).toBe(0);
  });
});

describe("POST /api/payments/orders", () => {
  it("re-resolves the price server-side and returns a redirect + orderId", async () => {
    const { id } = await makeSubject(100000);
    const { token } = await registerAndLogin();
    const res = await request(app)
      .post("/api/payments/orders")
      .set(auth(token))
      .send({ subjectId: id, amountPaise: 1 }); // bogus client amount is ignored
    expect(res.status).toBe(201);
    expect(res.body.amountPaise).toBe(100000); // server price, not client's 1
    expect(typeof res.body.orderId).toBe("string");
    expect(res.body.redirectUrl).toContain(res.body.orderId);

    const order = await OrderModel.findOne({ orderId: res.body.orderId });
    expect(order?.amount).toBe(100000);
    expect(order?.status).toBe(PaymentStatus.CREATED);
  });

  it("refuses a free subject", async () => {
    const { id } = await makeSubject(0);
    const { token } = await registerAndLogin();
    const res = await request(app)
      .post("/api/payments/orders")
      .set(auth(token))
      .send({ subjectId: id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SUBJECT_FREE");
  });

  it("refuses when already enrolled", async () => {
    const { id } = await makeSubject(100000);
    const { token, userId } = await registerAndLogin();
    await EnrollmentModel.create({
      user: new Types.ObjectId(userId),
      subject: new Types.ObjectId(id),
    });
    const res = await request(app)
      .post("/api/payments/orders")
      .set(auth(token))
      .send({ subjectId: id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ALREADY_ENROLLED");
  });

  it("rejects a supplied-but-invalid coupon at checkout", async () => {
    const { id } = await makeSubject(100000);
    const { token } = await registerAndLogin();
    const res = await request(app)
      .post("/api/payments/orders")
      .set(auth(token))
      .send({ subjectId: id, couponCode: "NOPE" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("COUPON_REJECTED");
  });
});

describe("webhook /api/payments/callback", () => {
  async function createOrderWithCoupon(): Promise<{
    token: string;
    userId: string;
    subjectId: string;
    orderId: string;
  }> {
    const { id } = await makeSubject(100000);
    await CouponModel.create({
      code: "TWENTY",
      discountType: CouponDiscountType.PERCENTAGE,
      discountValue: 20,
      active: true,
      usageLimit: 100,
      perUserLimit: 1,
    });
    const { token, userId } = await registerAndLogin();
    const created = await request(app)
      .post("/api/payments/orders")
      .set(auth(token))
      .send({ subjectId: id, couponCode: "TWENTY" });
    return { token, userId, subjectId: id, orderId: created.body.orderId };
  }

  it("verified success → one enrollment + status success + coupon used once", async () => {
    const { userId, subjectId, orderId } = await createOrderWithCoupon();

    const cb = await fireCallback(orderId, "success");
    expect(cb.status).toBe(200);

    const order = await OrderModel.findOne({ orderId });
    expect(order?.status).toBe(PaymentStatus.SUCCESS);
    expect(order?.transactionId).toBe(`MOCKTXN-${orderId}`);

    const enrollCount = await EnrollmentModel.countDocuments({
      user: userId,
      subject: subjectId,
    });
    expect(enrollCount).toBe(1);

    const coupon = await CouponModel.findOne({ code: "TWENTY" });
    expect(coupon?.usedCount).toBe(1);
  });

  it("DUPLICATE success callback does not double-enroll or double-count", async () => {
    const { userId, subjectId, orderId } = await createOrderWithCoupon();

    await fireCallback(orderId, "success");
    await fireCallback(orderId, "success"); // duplicate delivery
    await fireCallback(orderId, "success"); // and again

    expect(
      await EnrollmentModel.countDocuments({
        user: userId,
        subject: subjectId,
      }),
    ).toBe(1);
    const coupon = await CouponModel.findOne({ code: "TWENTY" });
    expect(coupon?.usedCount).toBe(1);
  });

  it("out-of-order failure after success does not revoke enrollment", async () => {
    const { userId, subjectId, orderId } = await createOrderWithCoupon();
    await fireCallback(orderId, "success");
    await fireCallback(orderId, "failure"); // late/stray failure

    const order = await OrderModel.findOne({ orderId });
    expect(order?.status).toBe(PaymentStatus.SUCCESS);
    expect(
      await EnrollmentModel.countDocuments({
        user: userId,
        subject: subjectId,
      }),
    ).toBe(1);
  });

  it("verified failure → failed, no enrollment", async () => {
    const { id } = await makeSubject(100000);
    const { token, userId } = await registerAndLogin();
    const created = await request(app)
      .post("/api/payments/orders")
      .set(auth(token))
      .send({ subjectId: id });
    const { orderId } = created.body;

    await fireCallback(orderId, "failure");

    const order = await OrderModel.findOne({ orderId });
    expect(order?.status).toBe(PaymentStatus.FAILED);
    expect(
      await EnrollmentModel.countDocuments({
        user: userId,
        subject: new Types.ObjectId(id),
      }),
    ).toBe(0);
  });

  it("bad signature → rejected (400), no enrollment", async () => {
    const { id } = await makeSubject(100000);
    const { token, userId } = await registerAndLogin();
    const created = await request(app)
      .post("/api/payments/orders")
      .set(auth(token))
      .send({ subjectId: id });
    const { orderId } = created.body;

    const { rawBody } = buildSignedCallback(orderId, "success");
    const res = await request(app)
      .post("/api/payments/callback")
      .set("Content-Type", "application/json")
      .set(MOCK_SIGNATURE_HEADER, "not-a-valid-signature")
      .send(rawBody);
    expect(res.status).toBe(400);

    const order = await OrderModel.findOne({ orderId });
    expect(order?.status).toBe(PaymentStatus.CREATED); // untouched
    expect(
      await EnrollmentModel.countDocuments({
        user: userId,
        subject: new Types.ObjectId(id),
      }),
    ).toBe(0);
  });
});

describe("order status + list + ownership", () => {
  it("returns status with enrollment flag, and lists the user's orders", async () => {
    const { id } = await makeSubject(100000);
    const { token } = await registerAndLogin();
    const created = await request(app)
      .post("/api/payments/orders")
      .set(auth(token))
      .send({ subjectId: id });
    const { orderId } = created.body;

    const before = await request(app)
      .get(`/api/payments/orders/${orderId}`)
      .set(auth(token));
    expect(before.body.enrolled).toBe(false);
    expect(before.body.status).toBe(PaymentStatus.CREATED);

    await fireCallback(orderId, "success");
    const after = await request(app)
      .get(`/api/payments/orders/${orderId}`)
      .set(auth(token));
    expect(after.body.status).toBe(PaymentStatus.SUCCESS);
    expect(after.body.enrolled).toBe(true);

    const list = await request(app)
      .get("/api/payments/orders")
      .set(auth(token));
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].orderId).toBe(orderId);
  });

  it("forbids reading another user's order", async () => {
    const { id } = await makeSubject(100000);
    const owner = await registerAndLogin();
    const created = await request(app)
      .post("/api/payments/orders")
      .set(auth(owner.token))
      .send({ subjectId: id });
    const other = await registerAndLogin();
    const res = await request(app)
      .get(`/api/payments/orders/${created.body.orderId}`)
      .set(auth(other.token));
    expect(res.status).toBe(403);
  });

  it("mock/pay drives a verified success end-to-end", async () => {
    const { id } = await makeSubject(100000);
    const { token, userId } = await registerAndLogin();
    const created = await request(app)
      .post("/api/payments/orders")
      .set(auth(token))
      .send({ subjectId: id });
    const res = await request(app)
      .post("/api/payments/mock/pay")
      .set(auth(token))
      .send({ orderId: created.body.orderId, outcome: "success" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe(PaymentStatus.SUCCESS);
    expect(res.body.enrolled).toBe(true);
    expect(
      await EnrollmentModel.countDocuments({
        user: userId,
        subject: new Types.ObjectId(id),
      }),
    ).toBe(1);
  });
});
