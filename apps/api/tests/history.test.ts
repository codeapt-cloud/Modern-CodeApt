/**
 * Unified student HISTORY — API tests. Seeds attempts directly on each module's
 * model (the aggregate is a pure read; no queue/worker involved) and asserts the
 * `/c/:slug/history` (tenant) and `/me/history` (B2C) reads. Covers: a unified
 * list across all five modules with normalized scores; the college-vs-B2C surface
 * partition; an exam whose results are hidden is redacted (not a fake 0); a
 * speaking attempt re-scored through Whisper surfaces the authoritative grade
 * with a Whisper marker (Step 32 tier-2 visibility); and the communication
 * composite roll-up derived from the parts' best attempts.
 */
import { Role, UserType } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { ExamModel, StudentExamAttemptModel } from "../src/models/assessment.model.js";
import { CommunicationAssessmentModel } from "../src/models/communication.model.js";
import { EssayAttemptModel, EssayTopicModel } from "../src/models/essay.model.js";
import { GameSetAttemptModel, GameSetModel } from "../src/models/game.model.js";
import {
  SpeakingAssessmentModel,
  SpeakingAttemptModel,
} from "../src/models/speaking.model.js";
import { UserModel } from "../src/models/user.model.js";
import * as colleges from "../src/services/college.service.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

const TEMP_PW = "CodeApt@123";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
let n = 0;

async function makeUser(fields?: {
  role?: string;
  userType?: string;
  college?: Types.ObjectId | null;
}): Promise<{ token: string; userId: string }> {
  n += 1;
  const u = `hist${n}`;
  await request(app).post("/api/auth/register").send({
    username: u,
    email: `${u}@example.com`,
    password: "Password123",
    fullName: `Hist ${n}`,
    rollNumber: `H-${n}`,
    collegeName: "Acme",
    phoneNumber: "9999999999",
    state: "KA",
  });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ identifier: u, password: "Password123" });
  const userId = res.body.user.id as string;
  if (fields) await UserModel.updateOne({ _id: userId }, { $set: fields });
  return { token: res.body.accessToken as string, userId };
}

async function setupCollege(slug: string): Promise<{ collegeId: string; adminToken: string }> {
  const platform = await makeUser({ role: Role.SUPER_ADMIN });
  const dto = await colleges.createCollege({ name: slug, slug }, platform.userId);
  await colleges.setEntitlements(dto.id, { features: { communication: true } });
  const admin = await makeUser({
    role: Role.COLLEGE_ADMIN,
    userType: UserType.COLLEGE,
    college: new Types.ObjectId(dto.id),
  });
  return { collegeId: dto.id, adminToken: admin.token };
}

async function addStudent(
  slug: string,
  adminToken: string,
  email: string,
): Promise<{ id: string; token: string }> {
  const unit = await request(app)
    .post(`/api/c/${slug}/org-units`)
    .set(auth(adminToken))
    .send({ type: "department", name: `D-${email}` });
  const created = await request(app)
    .post(`/api/c/${slug}/students`)
    .set(auth(adminToken))
    .send({ fullName: email, email, rollNumber: email, orgUnitId: unit.body.id });
  const id = created.body.id as string;
  await UserModel.updateOne({ _id: id }, { $set: { forcePasswordChange: false } });
  const login = await request(app)
    .post("/api/auth/login")
    .send({ identifier: email, password: TEMP_PW });
  return { id, token: login.body.accessToken as string };
}

// --- per-module seeders (college = tenant stamp, or null for B2C) ---
async function seedExam(
  userId: string,
  college: string | null,
  opts: { resultsVisible?: boolean; score?: number } = {},
): Promise<string> {
  const exam = await ExamModel.create({
    title: "Aptitude Exam",
    college: college ? new Types.ObjectId(college) : null,
    totalMarks: 100,
    resultsVisible: opts.resultsVisible ?? true,
    isPublished: true,
  });
  await StudentExamAttemptModel.create({
    user: new Types.ObjectId(userId),
    exam: exam._id,
    college: college ? new Types.ObjectId(college) : null,
    attemptToken: `ex-${exam._id.toString()}`,
    status: "graded",
    score: opts.score ?? 70,
    passed: (opts.score ?? 70) >= 40,
    startedAt: new Date("2026-08-20T10:00:00Z"),
    completedAt: new Date("2026-08-20T10:30:00Z"),
  });
  return exam._id.toString();
}

async function seedEssay(userId: string, college: string | null): Promise<void> {
  const topic = await EssayTopicModel.create({
    title: "Remote work essay",
    college: college ? new Types.ObjectId(college) : null,
  });
  await EssayAttemptModel.create({
    user: new Types.ObjectId(userId),
    essayTopic: topic._id,
    college: college ? new Types.ObjectId(college) : null,
    attemptNumber: 1,
    status: "GRADED",
    gradingStatus: "completed",
    finalScore: 82,
    submittedAt: new Date("2026-08-21T09:00:00Z"),
    gradedAt: new Date("2026-08-21T09:05:00Z"),
  });
}

async function seedGame(userId: string, college: string | null): Promise<void> {
  const set = await GameSetModel.create({
    title: "Logic games",
    college: college ? new Types.ObjectId(college) : null,
    isPublished: true,
  });
  await GameSetAttemptModel.create({
    user: new Types.ObjectId(userId),
    gameSet: set._id,
    college: college ? new Types.ObjectId(college) : null,
    attemptToken: `tok-${n}-${Math.floor(userId.length)}-${set._id.toString()}`,
    status: "graded",
    compositeScore: 64,
    begunAt: new Date("2026-08-22T08:00:00Z"),
    startedAt: new Date("2026-08-22T08:00:00Z"),
    completedAt: new Date("2026-08-22T08:20:00Z"),
  });
}

async function seedSpeaking(
  userId: string,
  college: string | null,
  opts: { engine?: string; rescored?: boolean; wordAccuracy?: number } = {},
): Promise<string> {
  const asm = await SpeakingAssessmentModel.create({
    college: college ? new Types.ObjectId(college) : null,
    topic: null,
    isPublished: true,
    title: "Read Aloud",
    description: "Read aloud.",
    maxAttempts: 2,
    items: [
      {
        itemType: "read_aloud",
        referenceText: "the quick brown fox",
        promptText: "Read it.",
        responseWindowSeconds: 30,
        order: 0,
      },
    ],
  });
  await SpeakingAttemptModel.create({
    user: new Types.ObjectId(userId),
    assessment: asm._id,
    college: college ? new Types.ObjectId(college) : null,
    status: "scored",
    currentIndex: 1,
    items: [
      {
        itemIndex: 0,
        jobStatus: "completed",
        engine: opts.engine ?? "browser",
        audioUrl: "https://res.cloudinary.com/demo/video/upload/a.webm",
        subScores: { wordAccuracy: opts.wordAccuracy ?? 88 },
      },
    ],
    rescoredAt: opts.rescored ? new Date("2026-08-23T12:00:00Z") : null,
    startedAt: new Date("2026-08-23T11:00:00Z"),
    submittedAt: new Date("2026-08-23T11:10:00Z"),
    scoredAt: new Date("2026-08-23T11:10:00Z"),
  });
  return asm._id.toString();
}

describe("unified history — college surface", () => {
  it("returns one date-sorted list across exam / speaking / essay / game with normalized scores", async () => {
    const { collegeId, adminToken } = await setupCollege("hist-all");
    const student = await addStudent("hist-all", adminToken, "histall@x.com");
    await seedExam(student.id, collegeId, { score: 70 });
    await seedEssay(student.id, collegeId);
    await seedGame(student.id, collegeId);
    await seedSpeaking(student.id, collegeId, { wordAccuracy: 88 });

    const res = await request(app)
      .get("/api/c/hist-all/history")
      .set(auth(student.token));
    expect(res.status).toBe(200);
    const entries = res.body.entries as Array<Record<string, unknown>>;
    const byModule = Object.fromEntries(entries.map((e) => [e.module, e]));
    expect(byModule.exam!.scorePercent).toBe(70);
    expect(byModule.exam!.passed).toBe(true);
    expect(byModule.essay!.scorePercent).toBe(82);
    expect(byModule.game!.scorePercent).toBe(64);
    expect(byModule.speaking!.scorePercent).toBe(88);
    for (const e of entries) expect(e.status).toBe("graded");

    // Newest completion first (speaking 08-23 > game 08-22 > essay 08-21 > exam 08-20).
    const order = entries.map((e) => e.module);
    expect(order.indexOf("speaking")).toBeLessThan(order.indexOf("game"));
    expect(order.indexOf("game")).toBeLessThan(order.indexOf("essay"));
    expect(order.indexOf("essay")).toBeLessThan(order.indexOf("exam"));
  });

  it("redacts an exam whose results are hidden (never a fake 0)", async () => {
    const { collegeId, adminToken } = await setupCollege("hist-hidden");
    const student = await addStudent("hist-hidden", adminToken, "histhide@x.com");
    await seedExam(student.id, collegeId, { resultsVisible: false, score: 90 });

    const res = await request(app)
      .get("/api/c/hist-hidden/history")
      .set(auth(student.token));
    const exam = (res.body.entries as Array<Record<string, unknown>>).find(
      (e) => e.module === "exam",
    )!;
    expect(exam.status).toBe("graded");
    expect(exam.scorePercent).toBeNull();
    expect(exam.scoreLabel).toBe("Result hidden");
    expect(exam.passed).toBeNull();
  });

  it("shows a Whisper-re-scored speaking attempt with the authoritative grade + marker", async () => {
    const { collegeId, adminToken } = await setupCollege("hist-whisper");
    const student = await addStudent("hist-whisper", adminToken, "histw@x.com");
    await seedSpeaking(student.id, collegeId, {
      engine: "whisper",
      rescored: true,
      wordAccuracy: 91,
    });

    const res = await request(app)
      .get("/api/c/hist-whisper/history")
      .set(auth(student.token));
    const sp = (res.body.entries as Array<Record<string, unknown>>).find(
      (e) => e.module === "speaking",
    )!;
    expect(sp.scorePercent).toBe(91);
    expect(sp.engine).toBe("whisper");
    expect(sp.rescored).toBe(true);
    expect(String(sp.scoreLabel)).toContain("Whisper");
  });

  it("rolls up a communication composite from the parts' best attempts", async () => {
    const { collegeId, adminToken } = await setupCollege("hist-comm");
    const student = await addStudent("hist-comm", adminToken, "histc@x.com");
    const speakingRef = await seedSpeaking(student.id, collegeId, { wordAccuracy: 80 });
    await CommunicationAssessmentModel.create({
      college: new Types.ObjectId(collegeId),
      title: "Placement Communication",
      passPercentage: 50,
      distinctionPercentage: 75,
      parts: [
        {
          order: 0,
          partType: "speaking",
          ref: new Types.ObjectId(speakingRef),
          label: "Speaking",
          weight: 1,
        },
      ],
    });

    const res = await request(app)
      .get("/api/c/hist-comm/history")
      .set(auth(student.token));
    const comm = (res.body.entries as Array<Record<string, unknown>>).find(
      (e) => e.module === "communication",
    );
    expect(comm).toBeTruthy();
    // Single scored part (80) → composite 80, band "distinction" (>=75).
    expect(comm!.scorePercent).toBe(80);
    expect(comm!.band).toBe("distinction");
  });
});

describe("surface partition — college vs B2C never bleed", () => {
  it("the tenant read shows college attempts; /me/history shows only non-college attempts", async () => {
    const { collegeId, adminToken } = await setupCollege("hist-split");
    const student = await addStudent("hist-split", adminToken, "hsplit@x.com");
    // One attempt stamped with the college, one with no college (B2C).
    await seedSpeaking(student.id, collegeId, { wordAccuracy: 70 });
    await seedSpeaking(student.id, null, { wordAccuracy: 60 });

    const tenant = await request(app)
      .get("/api/c/hist-split/history")
      .set(auth(student.token));
    const tenantSpeaking = (tenant.body.entries as Array<Record<string, unknown>>).filter(
      (e) => e.module === "speaking",
    );
    expect(tenantSpeaking).toHaveLength(1);
    expect(tenantSpeaking[0]!.scorePercent).toBe(70);

    const b2c = await request(app).get("/api/me/history").set(auth(student.token));
    const b2cSpeaking = (b2c.body.entries as Array<Record<string, unknown>>).filter(
      (e) => e.module === "speaking",
    );
    expect(b2cSpeaking).toHaveLength(1);
    expect(b2cSpeaking[0]!.scorePercent).toBe(60);
  });
});
