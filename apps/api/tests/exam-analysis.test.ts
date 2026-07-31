/**
 * Exam result ANALYSIS (Phase 5). supertest + in-memory Mongo. Proves: overview
 * / distribution / pass-fail / by-exam-section / question-level correct-rate /
 * by-org-unit / ranked students, all over GRADED attempts only (an in-progress
 * attempt is excluded); the .xlsx (Results + Distribution + Questions) generates;
 * faculty scope + feature-gate + tenant isolation; and the honest empty state.
 *
 * Attempts are inserted directly with a per-question `responseData.breakdown`
 * (exactly what the grader persists) — this is a READ-ONLY analysis test, so it
 * doesn't drive the engine.
 */
import { ExamAttemptStatus, Role, UserType } from "@codeapt/shared";
import ExcelJS from "exceljs";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import {
  ExamModel,
  ExamSectionModel,
  StudentExamAttemptModel,
} from "../src/models/assessment.model.js";
import { ProfileModel, UserModel } from "../src/models/user.model.js";
import * as colleges from "../src/services/college.service.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let seq = 0;
async function makeUser(fields?: {
  role?: string;
  userType?: string;
  college?: Types.ObjectId | null;
}): Promise<{ token: string; userId: string }> {
  seq += 1;
  const u = `xan${seq}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Xan User ${seq}`,
      rollNumber: `XANU-${seq}`,
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

let collegeSeq = 0;
async function setupCollege(opts: { exams?: boolean } = {}) {
  collegeSeq += 1;
  const slug = `xan-col-${collegeSeq}`;
  const platform = await makeUser({ role: Role.SUPER_ADMIN });
  const dto = await colleges.createCollege({ name: slug, slug }, platform.userId);
  if (opts.exams) {
    await colleges.setEntitlements(dto.id, { features: { exams: true } });
  }
  const admin = await makeUser({
    role: Role.COLLEGE_ADMIN,
    userType: UserType.COLLEGE,
    college: new Types.ObjectId(dto.id),
  });
  return { collegeId: dto.id, slug, adminToken: admin.token };
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

let studentSeq = 0;
async function makeStudent(collegeId: string, unitId: string): Promise<string> {
  studentSeq += 1;
  const roll = `XR-${studentSeq}`;
  const user = await UserModel.create({
    username: `${roll}@x.edu`,
    email: `${roll}@x.edu`,
    passwordHash: "x",
    role: Role.STUDENT,
    userType: UserType.COLLEGE,
    college: new Types.ObjectId(collegeId),
    orgUnit: new Types.ObjectId(unitId),
    rollNumber: roll,
  });
  await ProfileModel.create({
    user: user._id,
    fullName: `Student ${studentSeq}`,
    rollNumber: `STU-${user._id.toString()}`,
  });
  return user._id.toString();
}

/**
 * An exams-enabled college, CSE › A, an exam (10 marks, pass 40%) with one
 * section S1 (q1+q2, 5 marks each), and 3 GRADED attempts (100/50/0) + one
 * in-progress attempt (excluded).
 */
async function seedExam() {
  const { collegeId, slug, adminToken } = await setupCollege({ exams: true });
  const dept = await createUnit(slug, adminToken, { type: "department", name: "CSE" });
  const sectionA = await createUnit(slug, adminToken, {
    type: "section",
    name: "A",
    parentId: dept,
  });

  const exam = await ExamModel.create({
    college: new Types.ObjectId(collegeId),
    title: "Midterm",
    totalMarks: 10,
    passPercentage: 40,
    isPublished: true,
    orgUnits: [new Types.ObjectId(sectionA)],
  });
  const section = await ExamSectionModel.create({
    exam: exam._id,
    name: "S1",
    order: 0,
    durationMinutes: 30,
  });
  const q1 = new Types.ObjectId();
  const q2 = new Types.ObjectId();

  const mkAttempt = async (
    unitId: string,
    score: number,
    passed: boolean,
    a1: number,
    a2: number,
    status = ExamAttemptStatus.GRADED,
  ): Promise<string> => {
    const uid = await makeStudent(collegeId, unitId);
    studentSeq += 1;
    await StudentExamAttemptModel.create({
      exam: exam._id,
      college: new Types.ObjectId(collegeId),
      user: new Types.ObjectId(uid),
      attemptToken: `tok-${studentSeq}`,
      status,
      score,
      passed,
      completedAt: new Date(),
      responseData: {
        breakdown: [
          {
            sectionId: section._id.toString(),
            name: "S1",
            score: a1 + a2,
            maxScore: 10,
            questions: [
              { questionId: q1.toString(), text: "Q1", maxMarks: 5, awardedMarks: a1 },
              { questionId: q2.toString(), text: "Q2", maxMarks: 5, awardedMarks: a2 },
            ],
          },
        ],
      },
    });
    return uid;
  };

  await mkAttempt(sectionA, 10, true, 5, 5); // 100%
  await mkAttempt(sectionA, 5, true, 5, 0); // 50%
  await mkAttempt(sectionA, 0, false, 0, 0); // 0%
  await mkAttempt(sectionA, 0, false, 0, 0, ExamAttemptStatus.IN_PROGRESS); // excluded

  return {
    collegeId,
    slug,
    adminToken,
    dept,
    sectionA,
    examId: exam._id.toString(),
  };
}

const analysisUrl = (slug: string, examId: string) =>
  `/api/c/${slug}/exams/${examId}/analysis`;

// ---------------------------------------------------------------------------

describe("exam analysis aggregation (graded only)", () => {
  it("overview / distribution / pass-fail / sections / questions / units / rankings", async () => {
    const sc = await seedExam();
    const res = await request(app)
      .get(analysisUrl(sc.slug, sc.examId))
      .set(auth(sc.adminToken));
    expect(res.status).toBe(200);
    const d = res.body;

    // Overview over 3 graded (the in-progress attempt is excluded).
    expect(d.overview.attempts).toBe(4);
    expect(d.overview.completed).toBe(3);
    expect(d.overview.avgPercent).toBe(50);
    expect(d.overview.passRate).toBe(66.7);
    expect(d.overview.highest).toBe(10);
    expect(d.overview.lowest).toBe(0);
    expect(d.overview.median).toBe(5);

    // Distribution: 0% → band0, 50% → band5, 100% → top band.
    expect(d.distribution[0].count).toBe(1);
    expect(d.distribution[5].count).toBe(1);
    expect(d.distribution[9].count).toBe(1);

    expect(d.passFail).toEqual({ passed: 2, failed: 1 });

    // Exam section S1 average = 15/30 = 50%.
    expect(d.sections[0]).toMatchObject({ name: "S1", avgPercent: 50 });

    // Question-level: q2 (1/3 correct) is harder than q1 (2/3) → listed first.
    expect(d.hasQuestionData).toBe(true);
    expect(d.questions[0]).toMatchObject({ correct: 1, total: 3, correctRate: 33.3 });
    expect(d.questions[1]).toMatchObject({ correct: 2, total: 3, correctRate: 66.7 });

    // Org-unit rollup: section A + dept CSE both 50% avg, 3 students.
    const section = d.units.find((u: { id: string }) => u.id === sc.sectionA);
    const dept = d.units.find((u: { id: string }) => u.id === sc.dept);
    expect(section).toMatchObject({ students: 3, avgPercent: 50, passRate: 66.7 });
    expect(dept).toMatchObject({ students: 3, avgPercent: 50 });

    // Rankings: highest first.
    expect(d.students).toHaveLength(3);
    expect(d.students[0].score).toBe(10);
    expect(d.students[2].score).toBe(0);
  });

  it("empty state: no graded attempts → null rates, no question data", async () => {
    const { collegeId, slug, adminToken } = await setupCollege({ exams: true });
    const exam = await ExamModel.create({
      college: new Types.ObjectId(collegeId),
      title: "Untaken",
      totalMarks: 10,
      passPercentage: 40,
      isPublished: true,
    });
    const res = await request(app)
      .get(analysisUrl(slug, exam._id.toString()))
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.overview.completed).toBe(0);
    expect(res.body.overview.avgPercent).toBeNull();
    expect(res.body.overview.passRate).toBeNull();
    expect(res.body.hasQuestionData).toBe(false);
    expect(res.body.students).toEqual([]);
  });
});

describe("exam analysis Excel export", () => {
  it("generates Results + Distribution + Questions sheets", async () => {
    const sc = await seedExam();
    const res = await request(app)
      .get(`${analysisUrl(sc.slug, sc.examId)}/report`)
      .set(auth(sc.adminToken))
      .buffer(true)
      .parse((response, cb) => {
        const chunks: Buffer[] = [];
        response.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
        response.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"])).toContain("spreadsheetml");

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as Buffer);
    expect(wb.getWorksheet("Results")).toBeDefined();
    expect(wb.getWorksheet("Distribution")).toBeDefined();
    expect(wb.getWorksheet("Questions")).toBeDefined();
    // Rank 1 row = the topper (score 10).
    const results = wb.getWorksheet("Results")!;
    const rank1 = results.getRow(2).values as unknown[];
    expect(rank1).toContain("PASS");
  });
});

describe("scope, feature gate, tenant isolation", () => {
  it("a faculty outside the exam's target scope is denied", async () => {
    const sc = await seedExam();
    // A faculty scoped to a DIFFERENT section than the exam targets (A).
    const otherSection = await createUnit(sc.slug, sc.adminToken, {
      type: "section",
      name: "B",
      parentId: sc.dept,
    });
    const faculty = await makeUser({
      role: Role.FACULTY,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(sc.collegeId),
    });
    await UserModel.updateOne(
      { _id: faculty.userId },
      { $set: { facultyScope: { orgUnits: [new Types.ObjectId(otherSection)] } } },
    );
    const res = await request(app)
      .get(analysisUrl(sc.slug, sc.examId))
      .set(auth(faculty.token));
    expect([403, 404]).toContain(res.status);
  });

  it("403s analysis for a college without the exams feature", async () => {
    const { collegeId, slug, adminToken } = await setupCollege({ exams: false });
    const exam = await ExamModel.create({
      college: new Types.ObjectId(collegeId),
      title: "Gated",
      totalMarks: 10,
      passPercentage: 40,
    });
    const res = await request(app)
      .get(analysisUrl(slug, exam._id.toString()))
      .set(auth(adminToken));
    expect(res.status).toBe(403);
  });

  it("cannot read another college's exam analysis", async () => {
    const sc = await seedExam();
    const other = await setupCollege({ exams: true });
    const res = await request(app)
      .get(analysisUrl(other.slug, sc.examId))
      .set(auth(other.adminToken));
    expect(res.status).toBe(404);
  });
});
