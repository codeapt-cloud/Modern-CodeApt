/**
 * Exam attempt-management reads (C4) + the exam-question UPDATE fix. supertest +
 * in-memory Mongo. Part A: attempt-counter list, attempts-per-user, reset-log,
 * and reset-writes-an-audit-entry. Part B: the newly added question UPDATE and
 * the relocated /admin/exam-questions create/delete (collision-free namespace).
 */
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import {
  ExamModel,
  ExamQuestionModel,
  ExamSectionModel,
  ExamAttemptCounterModel,
  StudentExamAttemptModel,
} from "../src/models/assessment.model.js";

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
  const u = `eaa${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Exam Attempt ${counter}`,
      rollNumber: `EAA-${counter}`,
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

async function makeExamWithSection(): Promise<{
  examId: Types.ObjectId;
  sectionId: string;
}> {
  const exam = await ExamModel.create({
    topic: new Types.ObjectId(),
    title: "Attempt Mgmt Exam",
    totalMarks: 0,
  });
  const section = await ExamSectionModel.create({
    exam: exam._id,
    name: "S1",
    durationMinutes: 10,
    order: 0,
  });
  return { examId: exam._id, sectionId: section._id.toString() };
}

describe("exam questions — UPDATE fix + relocated namespace", () => {
  it("creates, updates, and deletes a question under /admin/exam-questions", async () => {
    const { token } = await registerAndLogin("admin");
    const { sectionId } = await makeExamWithSection();

    const created = await request(app)
      .post("/api/admin/exam-questions")
      .set(auth(token))
      .send({
        sectionId,
        type: "MCQ_SINGLE",
        text: "Original text",
        marks: 5,
        options: ["a", "b"],
        correctOptions: [0],
      });
    expect(created.status).toBe(201);
    const qId = created.body.id as string;

    const updated = await request(app)
      .patch(`/api/admin/exam-questions/${qId}`)
      .set(auth(token))
      .send({
        sectionId,
        type: "MCQ_SINGLE",
        text: "Edited text",
        marks: 8,
        options: ["a", "b", "c"],
        correctOptions: [2],
      });
    expect(updated.status).toBe(200);
    const doc = await ExamQuestionModel.findById(qId);
    expect(doc?.text).toBe("Edited text");
    expect(doc?.marks).toBe(8);
    expect(doc?.correctOptions).toEqual([2]);

    const del = await request(app)
      .delete(`/api/admin/exam-questions/${qId}`)
      .set(auth(token));
    expect(del.status).toBe(204);
    expect(await ExamQuestionModel.findById(qId)).toBeNull();
  });

  it("404s an update to an unknown question", async () => {
    const { token } = await registerAndLogin("admin");
    const res = await request(app)
      .patch(`/api/admin/exam-questions/${new Types.ObjectId().toString()}`)
      .set(auth(token))
      .send({ sectionId: "x", type: "MCQ_SINGLE", text: "t", options: ["a", "b"], correctOptions: [0] });
    expect(res.status).toBe(404);
  });
});

describe("exam attempt-management reads (C4)", () => {
  it("lists counters, a user's attempts, and the audit log; reset writes a log entry", async () => {
    const { token } = await registerAndLogin("admin");
    const student = await registerAndLogin();
    const uid = new Types.ObjectId(student.userId);
    const exam = await ExamModel.create({
      topic: new Types.ObjectId(),
      title: "Reads Exam",
      totalMarks: 0,
    });

    await ExamAttemptCounterModel.create({
      exam: exam._id,
      user: uid,
      attemptCount: 2,
      maxAttempts: 1,
    });
    await StudentExamAttemptModel.create({
      exam: exam._id,
      user: uid,
      attemptToken: "t-reads",
      status: "graded",
      score: 70,
      passed: true,
      warningsTriggered: 1,
      startedAt: new Date(),
      completedAt: new Date(),
    });

    // Counters
    const counters = await request(app)
      .get(`/api/admin/exams/${exam._id.toString()}/attempt-counters`)
      .set(auth(token));
    expect(counters.status).toBe(200);
    const row = counters.body.items.find(
      (i: { userId: string }) => i.userId === student.userId,
    );
    expect(row.attemptCount).toBe(2);
    expect(row.exhausted).toBe(true);
    expect(row.student).toContain("Exam Attempt");

    // Attempts-per-user
    const attempts = await request(app)
      .get(`/api/admin/exams/${exam._id.toString()}/users/${student.userId}/attempts`)
      .set(auth(token));
    expect(attempts.status).toBe(200);
    expect(attempts.body.counter.attemptCount).toBe(2);
    expect(attempts.body.attempts).toHaveLength(1);
    expect(attempts.body.attempts[0].passed).toBe(true);

    // Audit log starts empty
    const logBefore = await request(app)
      .get(`/api/admin/exams/${exam._id.toString()}/reset-log`)
      .set(auth(token));
    expect(logBefore.body.items).toHaveLength(0);

    // Reset (as the picker does) → writes an audit entry + zeroes the counter
    const reset = await request(app)
      .post(`/api/admin/exams/${exam._id.toString()}/reset-attempts`)
      .set(auth(token))
      .send({ userId: student.userId, reason: "demo reset" });
    expect(reset.status).toBe(200);
    expect(reset.body.attemptCount).toBe(0);

    const logAfter = await request(app)
      .get(`/api/admin/exams/${exam._id.toString()}/reset-log`)
      .set(auth(token));
    expect(logAfter.body.items).toHaveLength(1);
    expect(logAfter.body.items[0].previousCount).toBe(2);
    expect(logAfter.body.items[0].reason).toBe("demo reset");
    expect(logAfter.body.items[0].student).toContain("Exam Attempt");
  });

  it("rejects a non-admin (403)", async () => {
    const { token } = await registerAndLogin();
    const exam = await ExamModel.create({
      topic: new Types.ObjectId(),
      title: "Guard Exam",
      totalMarks: 0,
    });
    const res = await request(app)
      .get(`/api/admin/exams/${exam._id.toString()}/attempt-counters`)
      .set(auth(token));
    expect(res.status).toBe(403);
  });
});
