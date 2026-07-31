/**
 * User admin — list/search, per-user detail aggregate, and the per-college
 * performance .xlsx export (item 4-i, read/reporting). supertest + in-memory
 * Mongo. The export response is parsed back with ExcelJS to assert the sheet +
 * header columns are real.
 */
import ExcelJS from "exceljs";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { ExamModel, StudentExamAttemptModel } from "../src/models/assessment.model.js";
import {
  DailySubmissionModel,
  UserStreakModel,
} from "../src/models/challenge.model.js";
import {
  EnrollmentModel,
  TopicProgressModel,
} from "../src/models/curriculum.model.js";
import { EssayAttemptModel, EssayTopicModel } from "../src/models/essay.model.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

let counter = 0;
async function registerStudent(overrides: {
  fullName: string;
  collegeName: string;
}): Promise<{ token: string; userId: string; username: string }> {
  counter += 1;
  const u = `ua${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: overrides.fullName,
      rollNumber: `UA-${counter}`,
      collegeName: overrides.collegeName,
      phoneNumber: "9999999999",
      state: "KA",
    });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ identifier: u, password: "Password123" });
  return {
    token: res.body.accessToken as string,
    userId: res.body.user.id as string,
    username: u,
  };
}

async function makeAdmin(): Promise<string> {
  const { userId, username } = await registerStudent({
    fullName: "Admin Person",
    collegeName: "Staff HQ",
  });
  const { UserModel } = await import("../src/models/user.model.js");
  await UserModel.updateOne({ _id: userId }, { $set: { role: "admin" } });
  const relog = await request(app)
    .post("/api/auth/login")
    .send({ identifier: username, password: "Password123" });
  return relog.body.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** superagent binary parser so res.body is the raw .xlsx Buffer. */
function binaryParser(
  res: { setEncoding: (e: string) => void; on: (e: string, cb: (c?: unknown) => void) => void },
  cb: (err: Error | null, body: Buffer) => void,
): void {
  const chunks: string[] = [];
  res.setEncoding("binary");
  res.on("data", (chunk) => chunks.push(String(chunk)));
  res.on("end", () => cb(null, Buffer.from(chunks.join(""), "binary")));
}

describe("user admin — list / search", () => {
  it("lists, searches, filters by role, and paginates", async () => {
    const token = await makeAdmin();
    await registerStudent({ fullName: "Zephyr Unique", collegeName: "Acme University" });
    await registerStudent({ fullName: "Other Learner", collegeName: "Beta College" });

    const all = await request(app).get("/api/admin/users").set(auth(token));
    expect(all.status).toBe(200);
    expect(all.body.total).toBeGreaterThanOrEqual(3);
    expect(all.body.page).toBe(1);

    const search = await request(app)
      .get("/api/admin/users")
      .query({ q: "Zephyr Unique" })
      .set(auth(token));
    expect(search.body.total).toBe(1);
    expect(search.body.items[0].fullName).toBe("Zephyr Unique");
    expect(search.body.items[0].collegeName).toBe("Acme University");

    const admins = await request(app)
      .get("/api/admin/users")
      .query({ role: "admin" })
      .set(auth(token));
    expect(admins.body.items.every((u: { role: string }) => u.role === "admin")).toBe(true);

    const paged = await request(app)
      .get("/api/admin/users")
      .query({ pageSize: 1, page: 1 })
      .set(auth(token));
    expect(paged.body.items).toHaveLength(1);
    expect(paged.body.pageSize).toBe(1);
  });
});

describe("user admin — detail aggregate", () => {
  it("aggregates enrollments, attempts, streak and progress for one user", async () => {
    const token = await makeAdmin();
    const student = await registerStudent({
      fullName: "Detail Target",
      collegeName: "Acme University",
    });
    const uid = new Types.ObjectId(student.userId);

    const exam = await ExamModel.create({
      topic: new Types.ObjectId(),
      title: "Algorithms Midterm",
      totalMarks: 100,
    });
    await StudentExamAttemptModel.create({
      exam: exam._id,
      user: uid,
      attemptToken: "t-detail",
      status: "graded",
      score: 80,
      passed: true,
      completedAt: new Date(),
    });
    const topic = await EssayTopicModel.create({ title: "Remote work" });
    await EssayAttemptModel.create({
      user: uid,
      essayTopic: topic._id,
      attemptNumber: 1,
      status: "GRADED",
      finalScore: 75,
      submittedAt: new Date(),
    });
    await EnrollmentModel.create({
      user: uid,
      subject: new Types.ObjectId(),
      source: "manual",
    });
    await UserStreakModel.create({
      user: uid,
      currentStreak: 5,
      maxStreak: 7,
      totalScore: 40,
    });
    await TopicProgressModel.create({
      user: uid,
      topic: new Types.ObjectId(),
      isCompleted: true,
    });
    await DailySubmissionModel.create({
      user: uid,
      question: new Types.ObjectId(),
      isCorrect: true,
      score: 5,
    });

    const res = await request(app)
      .get(`/api/admin/users/${student.userId}`)
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.profile.fullName).toBe("Detail Target");
    expect(res.body.stats.enrollments).toBe(1);
    expect(res.body.stats.examAttempts).toBe(1);
    expect(res.body.stats.examsPassed).toBe(1);
    expect(res.body.stats.essayAttempts).toBe(1);
    expect(res.body.stats.topicsCompleted).toBe(1);
    expect(res.body.stats.dailySubmissions).toBe(1);
    expect(res.body.stats.currentStreak).toBe(5);
    expect(res.body.stats.dailyTotalScore).toBe(40);
    expect(res.body.examAttempts[0].exam).toBe("Algorithms Midterm");
    expect(res.body.examAttempts[0].totalMarks).toBe(100);
    expect(res.body.essayAttempts[0].finalScore).toBe(75);
  });

  it("404s an unknown user id", async () => {
    const token = await makeAdmin();
    const res = await request(app)
      .get(`/api/admin/users/${new Types.ObjectId().toString()}`)
      .set(auth(token));
    expect(res.status).toBe(404);
  });
});

describe("user admin — per-college performance export", () => {
  it("returns a valid .xlsx with the expected sheet and header columns", async () => {
    const token = await makeAdmin();
    const student = await registerStudent({
      fullName: "Export Student",
      collegeName: "Export College",
    });
    const uid = new Types.ObjectId(student.userId);
    await EnrollmentModel.create({
      user: uid,
      subject: new Types.ObjectId(),
      source: "order",
    });
    await UserStreakModel.create({
      user: uid,
      currentStreak: 3,
      maxStreak: 4,
      totalScore: 15,
    });

    const res = await request(app)
      .get("/api/admin/users/college-performance.xlsx")
      .set(auth(token))
      .buffer()
      .parse(binaryParser);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
    expect(res.headers["content-disposition"]).toContain("college-performance.xlsx");

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as Buffer);
    const ws = wb.getWorksheet("Performance");
    expect(ws).toBeTruthy();
    const headers = (ws!.getRow(1).values as unknown[]).filter(Boolean);
    expect(headers).toContain("College");
    expect(headers).toContain("Student");
    expect(headers).toContain("Avg Exam %");
    expect(headers).toContain("Current Streak");

    // The seeded student appears with their college.
    let found = false;
    ws!.eachRow((row, n) => {
      if (n === 1) return;
      if (String(row.getCell(2).value) === "Export Student") found = true;
    });
    expect(found).toBe(true);
  });
});

describe("user admin — guard", () => {
  it("rejects a non-admin (403)", async () => {
    const student = await registerStudent({
      fullName: "Not Admin",
      collegeName: "Nowhere",
    });
    const res = await request(app)
      .get("/api/admin/users")
      .set(auth(student.token));
    expect(res.status).toBe(403);
  });
});
