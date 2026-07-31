/**
 * Ledger READ surfaces (CRUD batch 3a) — read-only admin views. supertest +
 * in-memory Mongo. Covers the Order list (status filter + search), the Order
 * detail (gateway-owned fields present + read-only shape), the user-detail
 * ledger rows (quiz / daily / topic-progress), and the admin guard.
 *
 * These endpoints have NO write verbs — the order lifecycle is owned by the
 * verified payment flow; this only reads the ledger.
 */
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { OrderModel } from "../src/models/commerce.model.js";
import {
  DailyQuestionModel,
  DailySubmissionModel,
} from "../src/models/challenge.model.js";
import {
  QuizSubmissionModel,
  SubjectModel,
  TopicModel,
  TopicProgressModel,
} from "../src/models/curriculum.model.js";
import { UserModel } from "../src/models/user.model.js";

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
  const u = `lr${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Ledger Read ${counter}`,
      rollNumber: `LR-${counter}`,
      collegeName: "Acme",
      phoneNumber: "9999999999",
      state: "KA",
    });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ identifier: u, password: "Password123" });
  const userId = res.body.user.id as string;
  if (role === "admin") {
    await UserModel.updateOne({ _id: userId }, { $set: { role: "admin" } });
    const relog = await request(app)
      .post("/api/auth/login")
      .send({ identifier: u, password: "Password123" });
    return { token: relog.body.accessToken as string, userId };
  }
  return { token: res.body.accessToken as string, userId };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let subjectSeq = 0;
async function makeSubject(name: string): Promise<Types.ObjectId> {
  subjectSeq += 1;
  const s = await SubjectModel.create({
    name,
    slug: `subj-${subjectSeq}-${counter}`,
    price: 50000,
  });
  return s._id;
}

describe("order ledger — list / filter / search", () => {
  it("lists, filters by status, and searches by orderId / transactionId / coupon", async () => {
    const { token } = await registerAndLogin("admin");
    const buyer = await registerAndLogin();
    const uid = new Types.ObjectId(buyer.userId);
    const subject = await makeSubject("Data Structures");

    await OrderModel.create({
      orderId: "ORD-SUCCESS-1",
      transactionId: "TXN-ABC-999",
      user: uid,
      subject,
      amount: 45000,
      couponCode: "WELCOME10",
      discountAmount: 5000,
      status: "success",
    });
    await OrderModel.create({
      orderId: "ORD-FAILED-2",
      user: uid,
      subject,
      amount: 50000,
      status: "failed",
    });

    const all = await request(app).get("/api/admin/orders").set(auth(token));
    expect(all.status).toBe(200);
    expect(all.body.total).toBeGreaterThanOrEqual(2);
    expect(all.body.page).toBe(1);
    // Row carries the resolved student + subject labels + paise amount.
    const successRow = all.body.items.find(
      (o: { orderId: string }) => o.orderId === "ORD-SUCCESS-1",
    );
    expect(successRow.subject).toBe("Data Structures");
    expect(successRow.amount).toBe(45000);
    expect(successRow.couponCode).toBe("WELCOME10");

    const onlyFailed = await request(app)
      .get("/api/admin/orders")
      .query({ status: "failed" })
      .set(auth(token));
    expect(
      onlyFailed.body.items.every(
        (o: { status: string }) => o.status === "failed",
      ),
    ).toBe(true);

    const byTxn = await request(app)
      .get("/api/admin/orders")
      .query({ q: "TXN-ABC" })
      .set(auth(token));
    expect(byTxn.body.total).toBe(1);
    expect(byTxn.body.items[0].orderId).toBe("ORD-SUCCESS-1");

    const byCoupon = await request(app)
      .get("/api/admin/orders")
      .query({ q: "WELCOME10" })
      .set(auth(token));
    expect(byCoupon.body.total).toBe(1);
  });
});

describe("order ledger — detail (gateway fields read-only)", () => {
  it("returns the app-owned facts plus a gateway block", async () => {
    const { token } = await registerAndLogin("admin");
    const buyer = await registerAndLogin();
    const subject = await makeSubject("Algorithms");

    const order = await OrderModel.create({
      orderId: "ORD-DETAIL-1",
      transactionId: "TXN-DETAIL-42",
      user: new Types.ObjectId(buyer.userId),
      subject,
      amount: 40000,
      couponCode: "SAVE20",
      discountAmount: 10000,
      status: "success",
    });

    const res = await request(app)
      .get(`/api/admin/orders/${order._id.toString()}`)
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.orderId).toBe("ORD-DETAIL-1");
    expect(res.body.subject).toBe("Algorithms");
    expect(res.body.amount).toBe(40000);
    expect(res.body.discountAmount).toBe(10000);
    expect(res.body.couponCode).toBe("SAVE20");
    expect(res.body.studentEmail).toContain("@example.com");
    // Gateway-owned fields present under the dedicated read-only block.
    expect(res.body.gateway.transactionId).toBe("TXN-DETAIL-42");
    expect(res.body.gateway.status).toBe("success");
  });

  it("serializes missing timestamps as null (migrated data) — no 'Invalid time value' 500", async () => {
    const { token } = await registerAndLogin("admin");
    const buyer = await registerAndLogin();
    const subject = await makeSubject("Legacy Migrated");

    const order = await OrderModel.create({
      orderId: "ORD-NO-TS-1",
      user: new Types.ObjectId(buyer.userId),
      subject,
      amount: 30000,
      status: "success",
    });
    // Simulate a migrated/imported doc that never had Mongoose timestamps.
    // Use the raw driver so Mongoose does not re-apply updatedAt on write.
    await OrderModel.collection.updateOne(
      { _id: order._id },
      { $unset: { createdAt: "", updatedAt: "" } },
    );

    const res = await request(app)
      .get(`/api/admin/orders/${order._id.toString()}`)
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.createdAt).toBeNull();
    expect(res.body.updatedAt).toBeNull();

    // The list view over the same (timestamp-less) order also stays 200.
    const list = await request(app)
      .get("/api/admin/orders")
      .query({ q: "ORD-NO-TS-1" })
      .set(auth(token));
    expect(list.status).toBe(200);
    expect(list.body.items[0].createdAt).toBeNull();
  });

  it("404s an unknown order id", async () => {
    const { token } = await registerAndLogin("admin");
    const res = await request(app)
      .get(`/api/admin/orders/${new Types.ObjectId().toString()}`)
      .set(auth(token));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ORDER_NOT_FOUND");
  });
});

describe("user detail — ledger read rows", () => {
  it("returns quiz / daily / topic-progress rows with resolved labels", async () => {
    const { token } = await registerAndLogin("admin");
    const student = await registerAndLogin();
    const uid = new Types.ObjectId(student.userId);
    const subject = await makeSubject("Databases");
    const topic = await TopicModel.create({
      module: new Types.ObjectId(),
      name: "B-Trees",
      topicType: "quiz",
    });
    const question = await DailyQuestionModel.create({
      questionType: "MCQ",
      releaseDate: new Date("2026-01-15T00:00:00Z"),
      title: "Two Sum",
    });

    await QuizSubmissionModel.create({
      user: uid,
      subject,
      topic: topic._id,
      score: 8,
      totalQuestions: 10,
    });
    await DailySubmissionModel.create({
      user: uid,
      question: question._id,
      isCorrect: true,
      score: 5,
    });
    await TopicProgressModel.create({
      user: uid,
      topic: topic._id,
      isCompleted: true,
      completedAt: new Date(),
    });

    const res = await request(app)
      .get(`/api/admin/users/${student.userId}`)
      .set(auth(token));
    expect(res.status).toBe(200);

    // Counts still reflect the rows …
    expect(res.body.stats.quizSubmissions).toBe(1);
    expect(res.body.stats.dailySubmissions).toBe(1);
    expect(res.body.stats.topicsCompleted).toBe(1);

    // … and the per-row history is now exposed.
    expect(res.body.quizSubmissions[0].subject).toBe("Databases");
    expect(res.body.quizSubmissions[0].topic).toBe("B-Trees");
    expect(res.body.quizSubmissions[0].score).toBe(8);
    expect(res.body.quizSubmissions[0].percentage).toBe(80);

    expect(res.body.dailySubmissions[0].question).toBe("Two Sum");
    expect(res.body.dailySubmissions[0].isCorrect).toBe(true);
    expect(res.body.dailySubmissions[0].releaseDate).not.toBeNull();

    expect(res.body.topicProgress[0].topic).toBe("B-Trees");
    expect(res.body.topicProgress[0].isCompleted).toBe(true);
  });
});

describe("order ledger — guard", () => {
  it("rejects a non-admin (403)", async () => {
    const student = await registerAndLogin();
    const res = await request(app)
      .get("/api/admin/orders")
      .set(auth(student.token));
    expect(res.status).toBe(403);
  });
});
