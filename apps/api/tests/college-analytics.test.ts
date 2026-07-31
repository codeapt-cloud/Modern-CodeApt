/**
 * College analytics (Phase 5a) — tenant + faculty-scoped READ-ONLY aggregation
 * over the existing Phase 4 data. Proves: correct overview / dept+section
 * rollups / individual profiles (avg score, pass rate, participation counts) from
 * seeded exam/essay/course/challenge data; faculty scope (a section-A faculty
 * sees only A's students in every view, and is denied a B student's profile);
 * feature-off → 403; cross-tenant isolation (College A's numbers exclude College
 * B, and a cross-tenant student profile 404s). No engine changed — this only
 * reads. supertest + in-memory Mongo, mirroring college-exams.test.ts.
 */
import { EnrollmentSource, JobStatus, Role, UserType } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { StudentExamAttemptModel } from "../src/models/assessment.model.js";
import { UserStreakModel } from "../src/models/challenge.model.js";
import { EnrollmentModel } from "../src/models/curriculum.model.js";
import { EssayAttemptModel } from "../src/models/essay.model.js";
import { UserModel } from "../src/models/user.model.js";
import * as colleges from "../src/services/college.service.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const oid = () => new Types.ObjectId();

let counter = 0;
async function makeUser(fields?: {
  role?: string;
  userType?: string;
  college?: Types.ObjectId | null;
}): Promise<{ token: string; userId: string }> {
  counter += 1;
  const u = `an${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `AN User ${counter}`,
      rollNumber: `ANU-${counter}`,
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

async function makeCollege(slug: string, createdBy: string): Promise<string> {
  const dto = await colleges.createCollege({ name: slug, slug }, createdBy);
  return dto.id;
}

async function setupCollege(
  slug: string,
  features: Record<string, boolean> = { analytics: true },
): Promise<{ collegeId: string; adminToken: string }> {
  const platform = await makeUser({ role: Role.SUPER_ADMIN });
  const collegeId = await makeCollege(slug, platform.userId);
  await colleges.setEntitlements(collegeId, { features });
  const admin = await makeUser({
    role: Role.COLLEGE_ADMIN,
    userType: UserType.COLLEGE,
    college: new Types.ObjectId(collegeId),
  });
  return { collegeId, adminToken: admin.token };
}

async function createUnit(
  slug: string,
  token: string,
  body: { type: string; name: string; parentId?: string },
): Promise<string> {
  const res = await request(app)
    .post(`/api/c/${slug}/org-units`)
    .set(auth(token))
    .send(body);
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function addStudent(
  slug: string,
  token: string,
  email: string,
  roll: string,
  orgUnitId: string,
): Promise<string> {
  const created = await request(app)
    .post(`/api/c/${slug}/students`)
    .set(auth(token))
    .send({ fullName: email, email, rollNumber: roll, orgUnitId });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

async function seedExam(
  collegeId: string,
  userId: string,
  score: number,
  passed: boolean,
): Promise<void> {
  await StudentExamAttemptModel.create({
    exam: oid(),
    college: new Types.ObjectId(collegeId),
    user: new Types.ObjectId(userId),
    attemptToken: new Types.ObjectId().toString(),
    score,
    passed,
    completedAt: new Date(),
  });
}

async function seedEssay(
  collegeId: string,
  userId: string,
  finalScore: number,
): Promise<void> {
  await EssayAttemptModel.create({
    essayTopic: oid(),
    college: new Types.ObjectId(collegeId),
    user: new Types.ObjectId(userId),
    attemptNumber: 1,
    finalScore,
    gradingStatus: JobStatus.COMPLETED,
  });
}

async function seedEnrollment(
  collegeId: string,
  userId: string,
): Promise<void> {
  await EnrollmentModel.create({
    user: new Types.ObjectId(userId),
    subject: oid(),
    source: EnrollmentSource.COLLEGE,
    college: new Types.ObjectId(collegeId),
  });
}

async function seedStreak(
  userId: string,
  totalScore: number,
  currentStreak: number,
  maxStreak: number,
): Promise<void> {
  await UserStreakModel.create({
    user: new Types.ObjectId(userId),
    totalScore,
    currentStreak,
    maxStreak,
  });
}

/**
 * A college with a dept D → sections A, B; students sA1/sA2 in A, sB1 in B; and
 * seeded results (documented per the expectations in the correctness test).
 */
async function seedScenario(slug: string) {
  const { collegeId, adminToken } = await setupCollege(slug);
  const dept = await createUnit(slug, adminToken, {
    type: "department",
    name: "D",
  });
  const secA = await createUnit(slug, adminToken, {
    type: "section",
    name: "A",
    parentId: dept,
  });
  const secB = await createUnit(slug, adminToken, {
    type: "section",
    name: "B",
    parentId: dept,
  });
  const sA1 = await addStudent(slug, adminToken, `a1@${slug}.edu`, "A1", secA);
  const sA2 = await addStudent(slug, adminToken, `a2@${slug}.edu`, "A2", secA);
  const sB1 = await addStudent(slug, adminToken, `b1@${slug}.edu`, "B1", secB);

  await seedExam(collegeId, sA1, 80, true);
  await seedExam(collegeId, sA2, 40, false);
  await seedExam(collegeId, sB1, 60, true);
  await seedEssay(collegeId, sA1, 70);
  await seedEssay(collegeId, sB1, 90);
  await seedEnrollment(collegeId, sA1);
  await seedStreak(sA1, 30, 3, 3);

  return { collegeId, adminToken, dept, secA, secB, sA1, sA2, sB1 };
}

describe("College analytics — aggregation correctness", () => {
  it("overview rolls up exams/essays/courses/challenges over the scope", async () => {
    const { adminToken } = await seedScenario("ana");
    const res = await request(app)
      .get(`/api/c/ana/analytics/overview`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.students).toBe(3);
    expect(res.body.exams).toEqual({
      attempts: 3,
      students: 3,
      avgScore: 60,
      passRate: 66.7,
    });
    expect(res.body.essays).toEqual({
      submissions: 2,
      students: 2,
      graded: 2,
      avgScore: 80,
    });
    expect(res.body.courses).toEqual({ assignments: 1, students: 1 });
    expect(res.body.challenges).toEqual({
      participants: 1,
      avgScore: 30,
      avgCurrentStreak: 3,
    });
  });

  it("by-org-unit gives dept + section rollups via descendant math", async () => {
    const { adminToken, dept, secA, secB } = await seedScenario("anb");
    const res = await request(app)
      .get(`/api/c/anb/analytics/by-org-unit`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    const byId = new Map<string, Record<string, unknown>>(
      res.body.units.map((u: { id: string }) => [u.id, u]),
    );

    const d = byId.get(dept)!;
    expect(d.students).toBe(3);
    expect(d.exams).toMatchObject({ attempts: 3, avgScore: 60, passRate: 66.7 });

    const a = byId.get(secA)!;
    expect(a.students).toBe(2);
    expect(a.exams).toMatchObject({ attempts: 2, avgScore: 60, passRate: 50 });
    expect(a.essays).toMatchObject({ submissions: 1, avgScore: 70 });
    expect(a.challenges).toMatchObject({ participants: 1 });

    const b = byId.get(secB)!;
    expect(b.students).toBe(1);
    expect(b.exams).toMatchObject({ attempts: 1, avgScore: 60, passRate: 100 });
    expect(b.essays).toMatchObject({ submissions: 1, avgScore: 90 });
    expect(b.courses).toMatchObject({ assignments: 0 });
  });

  it("individual profile is per-student and correct", async () => {
    const { adminToken, sA1 } = await seedScenario("anc");
    const res = await request(app)
      .get(`/api/c/anc/analytics/students/${sA1}`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.rollNumber).toBe("A1");
    expect(res.body.exams).toEqual({ attempts: 1, avgScore: 80, passed: 1 });
    expect(res.body.essays).toEqual({ submissions: 1, graded: 1, avgScore: 70 });
    expect(res.body.courses).toEqual({ assignments: 1 });
    expect(res.body.challenge).toEqual({
      totalScore: 30,
      currentStreak: 3,
      maxStreak: 3,
    });
  });
});

describe("College analytics — scope, gate, isolation", () => {
  it("faculty sees only their section in every view; a B student profile is denied", async () => {
    const { collegeId, secA, sA1, sB1 } = await seedScenario("and");
    // A faculty scoped to section A only.
    const faculty = await makeUser({
      role: Role.FACULTY,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(collegeId),
    });
    await UserModel.updateOne(
      { _id: faculty.userId },
      { $set: { facultyScope: { orgUnits: [new Types.ObjectId(secA)] } } },
    );

    const overview = await request(app)
      .get(`/api/c/and/analytics/overview`)
      .set(auth(faculty.token));
    expect(overview.status).toBe(200);
    expect(overview.body.students).toBe(2); // sA1 + sA2 only
    expect(overview.body.exams.attempts).toBe(2);
    expect(overview.body.exams.passRate).toBe(50);

    const byUnit = await request(app)
      .get(`/api/c/and/analytics/by-org-unit`)
      .set(auth(faculty.token));
    expect(byUnit.status).toBe(200);
    // Only section A is visible (no dept, no section B).
    expect(byUnit.body.units.map((u: { id: string }) => u.id)).toEqual([secA]);

    // In-scope student → ok; out-of-scope (section B) student → 403.
    const okStudent = await request(app)
      .get(`/api/c/and/analytics/students/${sA1}`)
      .set(auth(faculty.token));
    expect(okStudent.status).toBe(200);
    const deniedStudent = await request(app)
      .get(`/api/c/and/analytics/students/${sB1}`)
      .set(auth(faculty.token));
    expect(deniedStudent.status).toBe(403);
  });

  it("feature off → 403", async () => {
    const { adminToken } = await setupCollege("ane", { analytics: false });
    const res = await request(app)
      .get(`/api/c/ane/analytics/overview`)
      .set(auth(adminToken));
    expect(res.status).toBe(403);
  });

  it("cross-tenant: College A's numbers exclude B, and a B student profile 404s in A", async () => {
    const a = await seedScenario("anf");
    const b = await seedScenario("ang");

    // A's overview is unaffected by B's (seeded) data.
    const overview = await request(app)
      .get(`/api/c/anf/analytics/overview`)
      .set(auth(a.adminToken));
    expect(overview.body.students).toBe(3);
    expect(overview.body.exams.attempts).toBe(3);

    // A cross-tenant student profile is simply not found in A.
    const cross = await request(app)
      .get(`/api/c/anf/analytics/students/${b.sA1}`)
      .set(auth(a.adminToken));
    expect(cross.status).toBe(404);
  });
});
