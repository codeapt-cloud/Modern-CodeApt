/**
 * Coupon admin CRUD (backlog item 1). supertest + in-memory Mongo. Covers
 * create (percentage + fixed subject-scoped), per-type validation, duplicate
 * code, validity-window/usage-limit persistence, active toggle, delete-vs-
 * deactivate semantics (block when orders reference it), and the admin guard.
 */
import { CouponErrorCode } from "@codeapt/shared";
import type { Express } from "express";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { CouponModel, OrderModel } from "../src/models/commerce.model.js";
import request from "supertest";

let app: Express;
beforeAll(() => {
  app = createApp();
});

let counter = 0;
async function registerAndLogin(role?: "admin"): Promise<{
  token: string;
  userId: string;
}> {
  counter += 1;
  const u = `cpn${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Coupon ${counter}`,
      rollNumber: `CPN-${counter}`,
      collegeName: "Acme",
      phoneNumber: "9999999999",
      state: "KA",
    });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ identifier: u, password: "Password123" });
  const userId = res.body.user.id as string;
  if (role === "admin") {
    const { UserModel } = await import("../src/models/user.model.js");
    await UserModel.updateOne({ _id: userId }, { $set: { role: "admin" } });
    const relog = await request(app)
      .post("/api/auth/login")
      .send({ identifier: u, password: "Password123" });
    return { token: relog.body.accessToken as string, userId };
  }
  return { token: res.body.accessToken as string, userId };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const adminToken = async (): Promise<string> =>
  (await registerAndLogin("admin")).token;

async function makeSubject(token: string): Promise<string> {
  counter += 1;
  const res = await request(app)
    .post("/api/admin/subjects")
    .set(auth(token))
    .send({ name: `Coupon Subject ${counter}` });
  return res.body.id as string;
}

describe("coupon admin — CRUD + validation", () => {
  it("creates a percentage coupon and a fixed subject-scoped coupon", async () => {
    const token = await adminToken();
    const subjectId = await makeSubject(token);

    const pct = await request(app)
      .post("/api/admin/coupons")
      .set(auth(token))
      .send({ code: "save20", discountType: "percentage", discountValue: 20 });
    expect(pct.status).toBe(201);
    expect(pct.body.code).toBe("SAVE20"); // stored uppercase
    expect(pct.body.discountType).toBe("percentage");
    expect(pct.body.discountValue).toBe(20);
    expect(pct.body.active).toBe(true);
    expect(pct.body.usedCount).toBe(0);
    expect(pct.body.orderCount).toBe(0);
    expect(pct.body.subjectId).toBeNull();

    const fixed = await request(app)
      .post("/api/admin/coupons")
      .set(auth(token))
      .send({
        code: "FLAT50",
        discountType: "fixed",
        discountValue: 5000, // ₹50 in paise
        subjectId,
        perUserLimit: 2,
        usageLimit: 100,
        minOrderPaise: 10000,
      });
    expect(fixed.status).toBe(201);
    expect(fixed.body.discountType).toBe("fixed");
    expect(fixed.body.discountValue).toBe(5000);
    expect(fixed.body.subjectId).toBe(subjectId);
    expect(fixed.body.subjectName).toBeTruthy();

    const list = await request(app)
      .get("/api/admin/coupons")
      .set(auth(token));
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBe(2);
  });

  it("validates per discount type and rejects a missing code", async () => {
    const token = await adminToken();
    const over = await request(app)
      .post("/api/admin/coupons")
      .set(auth(token))
      .send({ code: "BIG", discountType: "percentage", discountValue: 150 });
    expect(over.status).toBe(400); // percent must be 1–100

    const zeroFixed = await request(app)
      .post("/api/admin/coupons")
      .set(auth(token))
      .send({ code: "ZERO", discountType: "fixed", discountValue: 0 });
    expect(zeroFixed.status).toBe(400); // fixed must be >= 1 paisa

    const noCode = await request(app)
      .post("/api/admin/coupons")
      .set(auth(token))
      .send({ code: "", discountType: "percentage", discountValue: 10 });
    expect(noCode.status).toBe(400);
  });

  it("rejects a duplicate code (case-insensitive) with 409 CODE_TAKEN", async () => {
    const token = await adminToken();
    await request(app)
      .post("/api/admin/coupons")
      .set(auth(token))
      .send({ code: "dup10", discountType: "percentage", discountValue: 10 });
    const clash = await request(app)
      .post("/api/admin/coupons")
      .set(auth(token))
      .send({ code: "DUP10", discountType: "percentage", discountValue: 15 });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe(CouponErrorCode.CODE_TAKEN);
  });

  it("persists the validity window + limits and toggles active", async () => {
    const token = await adminToken();
    const from = "2026-01-01T00:00:00.000Z";
    const to = "2026-12-31T23:59:59.000Z";
    const created = await request(app)
      .post("/api/admin/coupons")
      .set(auth(token))
      .send({
        code: "WINDOW",
        discountType: "percentage",
        discountValue: 25,
        validFrom: from,
        validTo: to,
        usageLimit: 50,
        perUserLimit: 3,
      });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const got = await request(app)
      .get(`/api/admin/coupons/${id}`)
      .set(auth(token));
    expect(got.body.validFrom).toBe(from);
    expect(got.body.validTo).toBe(to);
    expect(got.body.usageLimit).toBe(50);
    expect(got.body.perUserLimit).toBe(3);

    const toggled = await request(app)
      .post(`/api/admin/coupons/${id}/active`)
      .set(auth(token))
      .send({ active: false });
    expect(toggled.status).toBe(200);
    expect(toggled.body.active).toBe(false);
  });

  it("deletes an unused coupon but BLOCKS one with redemption history", async () => {
    const { token, userId } = await registerAndLogin("admin");
    const subjectId = await makeSubject(token);

    // Unused → deletes cleanly.
    const unused = await request(app)
      .post("/api/admin/coupons")
      .set(auth(token))
      .send({ code: "TEMP", discountType: "percentage", discountValue: 5 });
    const delOk = await request(app)
      .delete(`/api/admin/coupons/${unused.body.id}`)
      .set(auth(token));
    expect(delOk.status).toBe(200);

    // Referenced by an order → blocked (retire via deactivate instead).
    const used = await request(app)
      .post("/api/admin/coupons")
      .set(auth(token))
      .send({ code: "USED10", discountType: "percentage", discountValue: 10 });
    counter += 1;
    await OrderModel.create({
      orderId: `ord-${counter}`,
      user: userId,
      subject: subjectId,
      amount: 9000,
      coupon: used.body.id,
      couponCode: "USED10",
      discountAmount: 1000,
      status: "success",
    });
    const blocked = await request(app)
      .delete(`/api/admin/coupons/${used.body.id}`)
      .set(auth(token));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe(CouponErrorCode.DELETE_BLOCKED);
    expect(blocked.body.error.details.blockers.orders).toBe(1);
    // Still present; deactivation is the retire path.
    expect(await CouponModel.findById(used.body.id)).not.toBeNull();
    const deactivated = await request(app)
      .post(`/api/admin/coupons/${used.body.id}/active`)
      .set(auth(token))
      .send({ active: false });
    expect(deactivated.body.active).toBe(false);
  });

  it("rejects a non-admin (403)", async () => {
    const { token } = await registerAndLogin();
    const res = await request(app)
      .get("/api/admin/coupons")
      .set(auth(token));
    expect(res.status).toBe(403);
  });
});
