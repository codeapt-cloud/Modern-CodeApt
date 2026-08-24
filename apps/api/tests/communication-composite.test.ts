/**
 * Step 21 — the CommunicationAssessment composite. A CONTAINER over the existing
 * exam / essay / speaking engines: it READS their attempts (seeded here directly
 * on the engine models, exactly as the runners would leave them) and never
 * writes to them. Covers the DoD: the access matrix, API-enforced gating (a
 * locked part cannot be launched — not just hidden in the UI), weighted
 * composite scoring, a PARTIAL composite marked partial rather than scored low,
 * a deleted/unpublished part failing safe + visibly, and the one-row-per-student
 * cohort export.
 */
import { randomUUID } from "node:crypto";

import {
  EssayStatus,
  ExamAttemptStatus,
  JobStatus,
  Role,
  SpeakingAttemptStatus,
  UserType,
} from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { ExamModel, StudentExamAttemptModel } from "../src/models/assessment.model.js";
import { EssayAttemptModel, EssayTopicModel } from "../src/models/essay.model.js";
import { SpeakingAssessmentModel, SpeakingAttemptModel } from "../src/models/speaking.model.js";
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
  const u = `cc${n}`;
  await request(app).post("/api/auth/register").send({
    username: u,
    email: `${u}@example.com`,
    password: "Password123",
    fullName: `CC ${n}`,
    rollNumber: `CC-${n}`,
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

async function setupCollege(
  slug: string,
  opts: { communication?: boolean; authoring?: boolean } = {},
): Promise<{ collegeId: string; adminToken: string }> {
  const platform = await makeUser({ role: Role.SUPER_ADMIN });
  const dto = await colleges.createCollege({ name: slug, slug }, platform.userId);
  if (opts.communication ?? true) {
    await colleges.setEntitlements(dto.id, { features: { communication: true } });
  }
  if (opts.authoring ?? true) {
    await colleges.setEntitlements(dto.id, {
      subCapabilities: { "communication.authoring": true },
    });
  }
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
): Promise<{ id: string; token: string; orgUnitId: string }> {
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
  return { id, token: login.body.accessToken as string, orgUnitId: unit.body.id };
}

// --- Engine artifact + attempt seeding (as the runners would leave them) -----

async function makeExam(
  collegeId: string,
  totalMarks = 10,
): Promise<string> {
  const e = await ExamModel.create({
    college: new Types.ObjectId(collegeId),
    title: `Exam ${randomUUID().slice(0, 6)}`,
    isPublished: true,
    totalMarks,
  });
  return e._id.toString();
}
async function makeEssay(collegeId: string): Promise<string> {
  const t = await EssayTopicModel.create({
    college: new Types.ObjectId(collegeId),
    title: `Essay ${randomUUID().slice(0, 6)}`,
    isPublished: true,
  });
  return t._id.toString();
}
async function makeSpeaking(collegeId: string): Promise<string> {
  const s = await SpeakingAssessmentModel.create({
    college: new Types.ObjectId(collegeId),
    title: `Speaking ${randomUUID().slice(0, 6)}`,
    isPublished: true,
    items: [{ itemType: "read_aloud", referenceText: "hello", responseWindowSeconds: 30 }],
  });
  return s._id.toString();
}

async function submitExamAttempt(examId: string, userId: string, score: number): Promise<void> {
  await StudentExamAttemptModel.create({
    exam: new Types.ObjectId(examId),
    user: new Types.ObjectId(userId),
    attemptToken: randomUUID(),
    status: ExamAttemptStatus.SUBMITTED,
    score,
  });
}
async function submitEssayAttempt(
  topicId: string,
  userId: string,
  finalScore: number,
  attemptNumber = 1,
): Promise<void> {
  await EssayAttemptModel.create({
    essayTopic: new Types.ObjectId(topicId),
    user: new Types.ObjectId(userId),
    attemptNumber,
    status: EssayStatus.GRADED,
    gradingStatus: JobStatus.COMPLETED,
    finalScore,
    scoreSource: "ai_hybrid",
  });
}
async function submitSpeakingAttempt(asmId: string, userId: string, wordAccuracy: number): Promise<void> {
  await SpeakingAttemptModel.create({
    assessment: new Types.ObjectId(asmId),
    user: new Types.ObjectId(userId),
    status: SpeakingAttemptStatus.SCORED,
    items: [{ itemIndex: 0, subScores: { wordAccuracy } }],
  });
}

// --- Step 23 C2: retake-in-flight seeders (as the engines would leave them) ---

/** A fresh exam retake the student has STARTED but not submitted. */
async function startExamRetake(examId: string, userId: string): Promise<void> {
  await StudentExamAttemptModel.create({
    exam: new Types.ObjectId(examId),
    user: new Types.ObjectId(userId),
    attemptToken: randomUUID(),
    status: ExamAttemptStatus.IN_PROGRESS,
    score: 0,
  });
}
/** An essay retake submitted but still awaiting grading (no finalScore). */
async function submitPendingEssayAttempt(
  topicId: string,
  userId: string,
  attemptNumber: number,
): Promise<void> {
  await EssayAttemptModel.create({
    essayTopic: new Types.ObjectId(topicId),
    user: new Types.ObjectId(userId),
    attemptNumber,
    status: EssayStatus.SUBMITTED,
    gradingStatus: JobStatus.PROCESSING,
    finalScore: 0,
  });
}
/** A speaking retake the reaper marked EXPIRED with nothing scored. */
async function expireSpeakingAttempt(asmId: string, userId: string): Promise<void> {
  await SpeakingAttemptModel.create({
    assessment: new Types.ObjectId(asmId),
    user: new Types.ObjectId(userId),
    status: SpeakingAttemptStatus.EXPIRED,
    items: [],
  });
}

const base = (slug: string) => `/api/c/${slug}/communication/assessments`;

/** Compose + publish a composite via the authoring endpoints; returns its id. */
async function compose(
  slug: string,
  adminToken: string,
  parts: unknown[],
  extra: Record<string, unknown> = {},
): Promise<string> {
  const created = await request(app)
    .post(base(slug))
    .set(auth(adminToken))
    .send({ title: "CTS composite", parts, ...extra });
  expect(created.status).toBe(201);
  return created.body.id as string;
}
async function publish(slug: string, adminToken: string, id: string): Promise<number> {
  const res = await request(app)
    .post(`${base(slug)}/${id}/publish`)
    .set(auth(adminToken))
    .send({ isPublished: true });
  return res.status;
}

// ===========================================================================

describe("communication composite — authoring validation", () => {
  it("rejects a part that references another college's artifact (INVALID_PART_REF)", async () => {
    const a = await setupCollege("cc-tenant-a");
    const b = await setupCollege("cc-tenant-b");
    const foreignExam = await makeExam(b.collegeId); // belongs to B
    const res = await request(app)
      .post(base("cc-tenant-a"))
      .set(auth(a.adminToken))
      .send({
        title: "bad",
        parts: [{ partType: "exam", ref: foreignExam, label: "X" }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PART_REF");
  });

  it("refuses to publish while a referenced part is unpublished", async () => {
    const sc = await setupCollege("cc-pub-guard");
    const exam = await makeExam(sc.collegeId);
    await ExamModel.updateOne({ _id: exam }, { $set: { isPublished: false } });
    const id = await compose("cc-pub-guard", sc.adminToken, [
      { partType: "exam", ref: exam, label: "Grammar" },
    ]);
    const res = await request(app)
      .post(`${base("cc-pub-guard")}/${id}/publish`)
      .set(auth(sc.adminToken))
      .send({ isPublished: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("NOT_PUBLISHABLE");
  });
});

describe("communication composite — access matrix", () => {
  it("a cohort student sees the composite; another college 404s; out-of-cohort 403s", async () => {
    const sc = await setupCollege("cc-access");
    const exam = await makeExam(sc.collegeId);
    const inCohort = await addStudent("cc-access", sc.adminToken, "in@cc.test");
    const outCohort = await addStudent("cc-access", sc.adminToken, "out@cc.test");

    const id = await compose(
      "cc-access",
      sc.adminToken,
      [{ partType: "exam", ref: exam, label: "Grammar" }],
      { orgUnitIds: [inCohort.orgUnitId] },
    );
    expect(await publish("cc-access", sc.adminToken, id)).toBe(200);

    const ok = await request(app)
      .get(`${base("cc-access")}/${id}/student`)
      .set(auth(inCohort.token));
    expect(ok.status).toBe(200);
    expect(ok.body.parts).toHaveLength(1);

    const denied = await request(app)
      .get(`${base("cc-access")}/${id}/student`)
      .set(auth(outCohort.token));
    expect(denied.status).toBe(403);

    // A student in a DIFFERENT college can't even resolve it (404).
    const other = await setupCollege("cc-other");
    const stranger = await addStudent("cc-other", other.adminToken, "s@other.test");
    const foreign = await request(app)
      .get(`${base("cc-access")}/${id}/student`)
      .set(auth(stranger.token));
    expect(foreign.status).toBe(403);
  });

  it("an unpublished composite 404s for a student", async () => {
    const sc = await setupCollege("cc-unpub");
    const exam = await makeExam(sc.collegeId);
    const student = await addStudent("cc-unpub", sc.adminToken, "s@unpub.test");
    const id = await compose("cc-unpub", sc.adminToken, [
      { partType: "exam", ref: exam, label: "Grammar" },
    ]);
    const res = await request(app)
      .get(`${base("cc-unpub")}/${id}/student`)
      .set(auth(student.token));
    expect(res.status).toBe(404);
  });
});

describe("communication composite — gating (enforced by API)", () => {
  it("a requiresPrevious part cannot be launched until the previous part is complete", async () => {
    const sc = await setupCollege("cc-gate");
    const exam = await makeExam(sc.collegeId);
    const essay = await makeEssay(sc.collegeId);
    const student = await addStudent("cc-gate", sc.adminToken, "s@gate.test");
    const id = await compose("cc-gate", sc.adminToken, [
      { partType: "exam", ref: exam, label: "Grammar", requiresPrevious: false },
      { partType: "essay", ref: essay, label: "Email", requiresPrevious: true },
    ]);
    expect(await publish("cc-gate", sc.adminToken, id)).toBe(200);

    // Part 0 is open; part 1 is LOCKED until part 0 is complete.
    const view1 = await request(app)
      .get(`${base("cc-gate")}/${id}/student`)
      .set(auth(student.token));
    expect(view1.body.parts[1].status).toBe("locked");

    const lockedLaunch = await request(app)
      .post(`${base("cc-gate")}/${id}/parts/1/launch`)
      .set(auth(student.token));
    expect(lockedLaunch.status).toBe(403);
    expect(lockedLaunch.body.error.code).toBe("PART_LOCKED");

    // Part 0 is launchable now.
    const openLaunch = await request(app)
      .post(`${base("cc-gate")}/${id}/parts/0/launch`)
      .set(auth(student.token));
    expect(openLaunch.status).toBe(200);
    expect(openLaunch.body.ref).toBe(exam);

    // Complete part 0 (as the exam runner would) → part 1 unlocks.
    await submitExamAttempt(exam, student.id, 8);
    const view2 = await request(app)
      .get(`${base("cc-gate")}/${id}/student`)
      .set(auth(student.token));
    expect(view2.body.parts[0].status).toBe("complete");
    expect(view2.body.parts[1].status).toBe("available");
    const nowOpen = await request(app)
      .post(`${base("cc-gate")}/${id}/parts/1/launch`)
      .set(auth(student.token));
    expect(nowOpen.status).toBe(200);
    expect(nowOpen.body.ref).toBe(essay);
  });

  it("an availableFrom in the future locks the part until then", async () => {
    const sc = await setupCollege("cc-date");
    const exam = await makeExam(sc.collegeId);
    const student = await addStudent("cc-date", sc.adminToken, "s@date.test");
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const id = await compose("cc-date", sc.adminToken, [
      { partType: "exam", ref: exam, label: "Round 2", availableFrom: future },
    ]);
    expect(await publish("cc-date", sc.adminToken, id)).toBe(200);
    const launch = await request(app)
      .post(`${base("cc-date")}/${id}/parts/0/launch`)
      .set(auth(student.token));
    expect(launch.status).toBe(403);
    expect(launch.body.error.code).toBe("PART_LOCKED");
  });
});

describe("communication composite — scoring", () => {
  it("combines per-part percents by weight into one banded composite", async () => {
    const sc = await setupCollege("cc-score");
    const exam = await makeExam(sc.collegeId, 10);
    const essay = await makeEssay(sc.collegeId);
    const student = await addStudent("cc-score", sc.adminToken, "s@score.test");
    const id = await compose("cc-score", sc.adminToken, [
      { partType: "exam", ref: exam, label: "Grammar", weight: 1 },
      { partType: "essay", ref: essay, label: "Email", weight: 3 },
    ]);
    expect(await publish("cc-score", sc.adminToken, id)).toBe(200);

    await submitExamAttempt(exam, student.id, 8); // 8/10 = 80%
    await submitEssayAttempt(essay, student.id, 60); // finalScore 60

    const res = await request(app)
      .get(`${base("cc-score")}/${id}/student`)
      .set(auth(student.token));
    // (1*80 + 3*60) / (1+3) = 65
    expect(res.body.composite.compositePercent).toBe(65);
    expect(res.body.composite.partial).toBe(false);
    expect(res.body.composite.band).toBe("distinction"); // ≥ 60
    // The essay part carries the AI-influenced (approximate) badge.
    expect(res.body.parts[1].approximate).toBe(true);
  });

  it("a PARTIAL composite is marked partial, not dragged to a low score", async () => {
    const sc = await setupCollege("cc-partial");
    const exam = await makeExam(sc.collegeId, 10);
    const essay = await makeEssay(sc.collegeId);
    const student = await addStudent("cc-partial", sc.adminToken, "s@partial.test");
    const id = await compose("cc-partial", sc.adminToken, [
      { partType: "exam", ref: exam, label: "Grammar", weight: 1 },
      { partType: "essay", ref: essay, label: "Email", weight: 1 },
    ]);
    expect(await publish("cc-partial", sc.adminToken, id)).toBe(200);

    await submitExamAttempt(exam, student.id, 8); // only the exam is done → 80%
    const res = await request(app)
      .get(`${base("cc-partial")}/${id}/student`)
      .set(auth(student.token));
    expect(res.body.composite.partial).toBe(true);
    expect(res.body.composite.band).toBe(null); // can't pass/fail an unfinished paper
    expect(res.body.composite.compositePercent).toBe(80); // NOT 40 (avg with a fake 0)
    expect(res.body.composite.scoredCount).toBe(1);
    expect(res.body.composite.totalCount).toBe(2);
    expect(res.body.parts[1].percent).toBe(null); // untaken part is absent, not 0
  });
});

describe("communication composite — a part removed mid-flight fails safe", () => {
  it("marks a deleted part unavailable (visibly), keeps other parts, and refuses its launch", async () => {
    const sc = await setupCollege("cc-del");
    const exam = await makeExam(sc.collegeId);
    const speaking = await makeSpeaking(sc.collegeId);
    const student = await addStudent("cc-del", sc.adminToken, "s@del.test");
    const id = await compose("cc-del", sc.adminToken, [
      { partType: "exam", ref: exam, label: "Grammar" },
      { partType: "speaking", ref: speaking, label: "Speaking" },
    ]);
    expect(await publish("cc-del", sc.adminToken, id)).toBe(200);

    // The operator deletes the underlying exam out from under the composite.
    await ExamModel.deleteOne({ _id: exam });

    const res = await request(app)
      .get(`${base("cc-del")}/${id}/student`)
      .set(auth(student.token));
    expect(res.status).toBe(200); // no crash
    expect(res.body.parts[0].status).toBe("unavailable");
    expect(res.body.parts[0].reason).toMatch(/removed/i);
    expect(res.body.parts[1].status).toBe("available"); // the other part is fine
    expect(res.body.composite.partial).toBe(true);

    const launch = await request(app)
      .post(`${base("cc-del")}/${id}/parts/0/launch`)
      .set(auth(student.token));
    expect(launch.status).toBe(403);
    expect(launch.body.error.code).toBe("PART_LOCKED");
  });
});

describe("communication composite — cohort export", () => {
  it("produces one row per student across all parts", async () => {
    const sc = await setupCollege("cc-cohort");
    const exam = await makeExam(sc.collegeId, 10);
    const speaking = await makeSpeaking(sc.collegeId);
    const s1 = await addStudent("cc-cohort", sc.adminToken, "a@cohort.test");
    const s2 = await addStudent("cc-cohort", sc.adminToken, "b@cohort.test");
    const s3 = await addStudent("cc-cohort", sc.adminToken, "c@cohort.test");

    const id = await compose("cc-cohort", sc.adminToken, [
      { partType: "exam", ref: exam, label: "Grammar" },
      { partType: "speaking", ref: speaking, label: "Speaking" },
    ]);
    expect(await publish("cc-cohort", sc.adminToken, id)).toBe(200);

    // One student finished part 1, another finished both, a third did nothing.
    await submitExamAttempt(exam, s1.id, 7);
    await submitExamAttempt(exam, s2.id, 9);
    await submitSpeakingAttempt(speaking, s2.id, 90);

    const report = await request(app)
      .get(`${base("cc-cohort")}/${id}/cohort`)
      .set(auth(sc.adminToken));
    expect(report.status).toBe(200);
    expect(report.body.parts).toHaveLength(2);
    // Exactly one row per cohort student, each spanning both parts.
    expect(report.body.rows).toHaveLength(3);
    for (const row of report.body.rows) {
      expect(row.cells).toHaveLength(2);
    }
    // The student who did nothing is present with a null composite, not a 0.
    const idle = report.body.rows.find((r: { userId: string }) => r.userId === s3.id);
    expect(idle.composite.compositePercent).toBe(null);
    expect(idle.composite.partial).toBe(true);

    // The Excel export streams a real xlsx (one sheet, one row per student).
    const xlsx = await request(app)
      .get(`${base("cc-cohort")}/${id}/cohort/export`)
      .set(auth(sc.adminToken));
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers["content-type"]).toContain("spreadsheetml");
    expect(Number(xlsx.headers["content-length"])).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Step 23 C2 — retake policy: BEST scored attempt; an in-flight retake never
// removes a completed score, and a partial composite is not manufactured.
// ===========================================================================

describe("communication composite — retake policy (best of, never erased)", () => {
  it("THE REPORTED SCENARIO: score 82%, start a retake → composite is UNCHANGED", async () => {
    const sc = await setupCollege("cc-retake-82");
    const exam = await makeExam(sc.collegeId, 100);
    const student = await addStudent("cc-retake-82", sc.adminToken, "s@r82.test");
    const id = await compose("cc-retake-82", sc.adminToken, [
      { partType: "exam", ref: exam, label: "Grammar" },
    ]);
    expect(await publish("cc-retake-82", sc.adminToken, id)).toBe(200);

    await submitExamAttempt(exam, student.id, 82); // 82/100 = 82%
    const before = await request(app)
      .get(`${base("cc-retake-82")}/${id}/student`)
      .set(auth(student.token));
    expect(before.body.composite.compositePercent).toBe(82);
    expect(before.body.composite.partial).toBe(false);
    expect(before.body.composite.band).toBe("distinction");
    expect(before.body.parts[0].status).toBe("complete");

    // Merely STARTING a retake must not touch the recorded result.
    await startExamRetake(exam, student.id);
    const after = await request(app)
      .get(`${base("cc-retake-82")}/${id}/student`)
      .set(auth(student.token));
    expect(after.body.composite.compositePercent).toBe(82); // unchanged
    expect(after.body.composite.partial).toBe(false); // NOT flipped to partial
    expect(after.body.composite.band).toBe("distinction");
    // The part still shows its score, flagged that a retake is under way.
    expect(after.body.parts[0].status).toBe("complete");
    expect(after.body.parts[0].percent).toBe(82);
    expect(after.body.parts[0].attemptCount).toBe(2);
    expect(after.body.parts[0].retakeInProgress).toBe(true);
  });

  it("reports the BEST scored attempt for exam, essay AND speaking", async () => {
    const sc = await setupCollege("cc-best");
    const exam = await makeExam(sc.collegeId, 100);
    const essay = await makeEssay(sc.collegeId);
    const speaking = await makeSpeaking(sc.collegeId);
    const student = await addStudent("cc-best", sc.adminToken, "s@best.test");
    const id = await compose("cc-best", sc.adminToken, [
      { partType: "exam", ref: exam, label: "Grammar", weight: 1 },
      { partType: "essay", ref: essay, label: "Email", weight: 1 },
      { partType: "speaking", ref: speaking, label: "Speaking", weight: 1 },
    ]);
    expect(await publish("cc-best", sc.adminToken, id)).toBe(200);

    // Two attempts each; the LOWER one is the more recent (createdAt/attemptNumber
    // ordering must NOT win — best does).
    await submitExamAttempt(exam, student.id, 90); // best
    await submitExamAttempt(exam, student.id, 60); // later, lower
    await submitEssayAttempt(essay, student.id, 70, 1); // best
    await submitEssayAttempt(essay, student.id, 55, 2); // later, lower
    await submitSpeakingAttempt(speaking, student.id, 80); // best
    await submitSpeakingAttempt(speaking, student.id, 50); // later, lower

    const res = await request(app)
      .get(`${base("cc-best")}/${id}/student`)
      .set(auth(student.token));
    expect(res.body.parts[0].percent).toBe(90);
    expect(res.body.parts[1].percent).toBe(70);
    expect(res.body.parts[2].percent).toBe(80);
    // (90 + 70 + 80) / 3 = 80
    expect(res.body.composite.compositePercent).toBe(80);
    expect(res.body.composite.partial).toBe(false);
    for (const p of res.body.parts) expect(p.attemptCount).toBe(2);
  });

  it("an essay retake still awaiting grading keeps the prior graded score", async () => {
    const sc = await setupCollege("cc-essay-pending");
    const essay = await makeEssay(sc.collegeId);
    const student = await addStudent("cc-essay-pending", sc.adminToken, "s@ep.test");
    const id = await compose("cc-essay-pending", sc.adminToken, [
      { partType: "essay", ref: essay, label: "Email" },
    ]);
    expect(await publish("cc-essay-pending", sc.adminToken, id)).toBe(200);

    await submitEssayAttempt(essay, student.id, 72, 1); // graded 72
    await submitPendingEssayAttempt(essay, student.id, 2); // retake, awaiting grade

    const res = await request(app)
      .get(`${base("cc-essay-pending")}/${id}/student`)
      .set(auth(student.token));
    expect(res.body.parts[0].percent).toBe(72); // not nulled by the pending retake
    expect(res.body.parts[0].status).toBe("complete");
    expect(res.body.parts[0].retakeInProgress).toBe(true);
    expect(res.body.composite.compositePercent).toBe(72);
    expect(res.body.composite.partial).toBe(false);
  });

  it("an abandoned/EXPIRED speaking retake does NOT erase a previously scored attempt", async () => {
    const sc = await setupCollege("cc-spk-expired");
    const speaking = await makeSpeaking(sc.collegeId);
    const student = await addStudent("cc-spk-expired", sc.adminToken, "s@se.test");
    const id = await compose("cc-spk-expired", sc.adminToken, [
      { partType: "speaking", ref: speaking, label: "Speaking" },
    ]);
    expect(await publish("cc-spk-expired", sc.adminToken, id)).toBe(200);

    await submitSpeakingAttempt(speaking, student.id, 80); // scored 80
    await expireSpeakingAttempt(speaking, student.id); // reaper-expired, null score

    const res = await request(app)
      .get(`${base("cc-spk-expired")}/${id}/student`)
      .set(auth(student.token));
    expect(res.body.parts[0].percent).toBe(80); // survives
    expect(res.body.parts[0].status).toBe("complete");
    // The expired attempt is TERMINAL — not a retake "in progress".
    expect(res.body.parts[0].retakeInProgress).toBe(false);
    expect(res.body.composite.compositePercent).toBe(80);
    expect(res.body.composite.partial).toBe(false);
  });

  it("an in-progress retake on a gated part does NOT re-lock the part behind it", async () => {
    const sc = await setupCollege("cc-regate");
    const exam = await makeExam(sc.collegeId, 100);
    const essay = await makeEssay(sc.collegeId);
    const student = await addStudent("cc-regate", sc.adminToken, "s@rg.test");
    const id = await compose("cc-regate", sc.adminToken, [
      { partType: "exam", ref: exam, label: "Grammar", requiresPrevious: false },
      { partType: "essay", ref: essay, label: "Email", requiresPrevious: true },
    ]);
    expect(await publish("cc-regate", sc.adminToken, id)).toBe(200);

    await submitExamAttempt(exam, student.id, 70); // completes part 0 → part 1 unlocks
    await startExamRetake(exam, student.id); // retake part 0

    const res = await request(app)
      .get(`${base("cc-regate")}/${id}/student`)
      .set(auth(student.token));
    expect(res.body.parts[0].status).toBe("complete"); // stays complete
    expect(res.body.parts[0].retakeInProgress).toBe(true);
    expect(res.body.parts[1].status).toBe("available"); // NOT re-locked
    const launch = await request(app)
      .post(`${base("cc-regate")}/${id}/parts/1/launch`)
      .set(auth(student.token));
    expect(launch.status).toBe(200);
  });
});
