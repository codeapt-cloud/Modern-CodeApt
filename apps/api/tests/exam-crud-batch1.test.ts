/**
 * CRUD Batch 1 — the five AUTHORING gaps. supertest + in-memory Mongo.
 * Exam delete (clean cascade AND blocked-by-attempts), section update, test-case
 * update, public-link delete, and the now reference-safe Job delete (blocked
 * when applications exist; clean when none). Plus an admin-guard check.
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
  ExamTestCaseModel,
  PublicExamLinkModel,
  StudentExamAttemptModel,
} from "../src/models/assessment.model.js";
import { JobApplicationModel, JobModel } from "../src/models/careers.model.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

let counter = 0;
async function registerAndLogin(role?: "admin"): Promise<{ token: string }> {
  counter += 1;
  const u = `b1u${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Batch1 ${counter}`,
      rollNumber: `B1-${counter}`,
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
    return { token: relog.body.accessToken as string };
  }
  return { token: res.body.accessToken as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function makeExam() {
  const exam = await ExamModel.create({
    topic: new Types.ObjectId(),
    title: "Batch1 Exam",
    totalMarks: 0,
  });
  const section = await ExamSectionModel.create({
    exam: exam._id,
    name: "S1",
    durationMinutes: 10,
    order: 0,
  });
  return { exam, section };
}

describe("gap 1 — exam delete (reference-safe)", () => {
  it("cascades sections/questions/test-cases/public-links when no attempts", async () => {
    const { token } = await registerAndLogin("admin");
    const { exam, section } = await makeExam();
    const q = await ExamQuestionModel.create({
      exam: exam._id,
      section: section._id,
      questionType: "CODE",
      text: "code",
      starterCode: "x",
      language: "python",
      marks: 5,
    });
    await ExamTestCaseModel.create({
      question: q._id,
      inputData: "a",
      expectedOutput: "a",
    });
    await PublicExamLinkModel.create({
      exam: exam._id,
      accessToken: `tok-${counter}`,
    });

    const res = await request(app)
      .delete(`/api/admin/exams/${exam._id.toString()}`)
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(await ExamModel.findById(exam._id)).toBeNull();
    expect(await ExamSectionModel.countDocuments({ exam: exam._id })).toBe(0);
    expect(await ExamQuestionModel.countDocuments({ exam: exam._id })).toBe(0);
    expect(await ExamTestCaseModel.countDocuments({ question: q._id })).toBe(0);
    expect(await PublicExamLinkModel.countDocuments({ exam: exam._id })).toBe(0);
  });

  it("BLOCKS delete when student attempts exist", async () => {
    const { token } = await registerAndLogin("admin");
    const { exam } = await makeExam();
    await StudentExamAttemptModel.create({
      exam: exam._id,
      user: new Types.ObjectId(),
      attemptToken: `att-${counter}`,
      status: "graded",
      score: 10,
    });
    const res = await request(app)
      .delete(`/api/admin/exams/${exam._id.toString()}`)
      .set(auth(token));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DELETE_BLOCKED");
    expect(res.body.error.details.blockers.attempts).toBe(1);
    // The exam survived the blocked delete.
    expect(await ExamModel.findById(exam._id)).not.toBeNull();
  });
});

describe("gaps 2 & 3 — section + test-case update", () => {
  it("updates a section's name / duration / order / description", async () => {
    const { token } = await registerAndLogin("admin");
    const { section } = await makeExam();
    const res = await request(app)
      .patch(`/api/admin/sections/${section._id.toString()}`)
      .set(auth(token))
      .send({
        name: "Renamed",
        order: 3,
        durationMinutes: 45,
        description: "updated",
      });
    expect(res.status).toBe(200);
    const doc = await ExamSectionModel.findById(section._id);
    expect(doc?.name).toBe("Renamed");
    expect(doc?.durationMinutes).toBe(45);
    expect(doc?.order).toBe(3);
    expect(doc?.description).toBe("updated");
  });

  it("updates a test case's input / expected / hidden", async () => {
    const { token } = await registerAndLogin("admin");
    const { exam, section } = await makeExam();
    const q = await ExamQuestionModel.create({
      exam: exam._id,
      section: section._id,
      questionType: "CODE",
      text: "code",
      marks: 5,
    });
    const tc = await ExamTestCaseModel.create({
      question: q._id,
      inputData: "old",
      expectedOutput: "old",
      isHidden: false,
    });
    const res = await request(app)
      .patch(`/api/admin/test-cases/${tc._id.toString()}`)
      .set(auth(token))
      .send({ input: "new", expectedOutput: "NEW", isHidden: true, order: 1 });
    expect(res.status).toBe(200);
    const doc = await ExamTestCaseModel.findById(tc._id);
    expect(doc?.inputData).toBe("new");
    expect(doc?.expectedOutput).toBe("NEW");
    expect(doc?.isHidden).toBe(true);
  });
});

describe("gap 4 — public-link delete", () => {
  it("revokes (deletes) a public link", async () => {
    const { token } = await registerAndLogin("admin");
    const { exam } = await makeExam();
    const link = await PublicExamLinkModel.create({
      exam: exam._id,
      accessToken: `revoke-${counter}`,
    });
    const res = await request(app)
      .delete(`/api/admin/public-links/${link._id.toString()}`)
      .set(auth(token));
    expect(res.status).toBe(204);
    expect(await PublicExamLinkModel.findById(link._id)).toBeNull();
  });
});

describe("gap 5 — Job delete is now reference-safe", () => {
  it("BLOCKS delete when applications exist (close instead)", async () => {
    const { token } = await registerAndLogin("admin");
    const job = await JobModel.create({ title: "Blocked Job", company: "Acme" });
    await JobApplicationModel.create({
      job: job._id,
      fullName: "Applicant",
      email: `a${counter}@example.com`,
    });
    const res = await request(app)
      .delete(`/api/admin/careers/${job._id.toString()}`)
      .set(auth(token));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DELETE_BLOCKED");
    expect(res.body.error.details.blockers.applications).toBe(1);
    // Job AND its application survived — history preserved.
    expect(await JobModel.findById(job._id)).not.toBeNull();
    expect(await JobApplicationModel.countDocuments({ job: job._id })).toBe(1);
  });

  it("deletes a posting with no applications", async () => {
    const { token } = await registerAndLogin("admin");
    const job = await JobModel.create({ title: "Empty Job", company: "Acme" });
    const res = await request(app)
      .delete(`/api/admin/careers/${job._id.toString()}`)
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(await JobModel.findById(job._id)).toBeNull();
  });
});

describe("guard", () => {
  it("rejects a non-admin exam delete (403)", async () => {
    const { token } = await registerAndLogin();
    const { exam } = await makeExam();
    const res = await request(app)
      .delete(`/api/admin/exams/${exam._id.toString()}`)
      .set(auth(token));
    expect(res.status).toBe(403);
  });
});
