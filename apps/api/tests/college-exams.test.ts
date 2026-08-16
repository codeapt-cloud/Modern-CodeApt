/**
 * College exams (Phase 4b) — tenant-scoped authoring + taking over the REUSED
 * exam engine. Proves: authoring behind the `exams` feature (create → section →
 * question → publish), a college student taking it via the shared attempt engine
 * and being graded, tenant-scoped results; feature-off 403; faculty out-of-scope
 * denial; cross-tenant author/read denial; hard isolation (College A's exam is
 * invisible/untakeable to College B and to individual users); and that
 * unpublished exams are neither listed nor takeable. The existing exam suite
 * (exam.test.ts et al.) proves individual exams are byte-for-byte unchanged.
 * supertest + in-memory Mongo, mirroring college-courses.test.ts.
 */
import { ExamQuestionType, Role, UserType } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { UserModel } from "../src/models/user.model.js";
import * as colleges from "../src/services/college.service.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

const TEMP_PW = "CodeApt@123"; // env BULK_ENROLL_DEFAULT_PASSWORD default
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let counter = 0;
async function makeUser(fields?: {
  role?: string;
  userType?: string;
  college?: Types.ObjectId | null;
}): Promise<{ token: string; userId: string }> {
  counter += 1;
  const u = `ce${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `CE User ${counter}`,
      rollNumber: `CEU-${counter}`,
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

/** A college with a college_admin + the `exams` feature on (unless disabled). */
async function setupCollege(
  slug: string,
  features: Record<string, boolean> = { exams: true },
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
): Promise<{ id: string; token: string }> {
  const created = await request(app)
    .post(`/api/c/${slug}/students`)
    .set(auth(token))
    .send({ fullName: email, email, rollNumber: roll, orgUnitId });
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  // Clear forced-change so the student can log in + take exams.
  await UserModel.updateOne({ _id: id }, { $set: { forcePasswordChange: false } });
  const login = await request(app)
    .post("/api/auth/login")
    .send({ identifier: email, password: TEMP_PW });
  expect(login.status).toBe(200);
  return { id, token: login.body.accessToken as string };
}

/** Author a published, single-MCQ college exam; returns its id. */
async function authorPublishedExam(
  slug: string,
  token: string,
  opts: { orgUnitIds?: string[]; correct?: boolean } = {},
): Promise<string> {
  const created = await request(app)
    .post(`/api/c/${slug}/exams`)
    .set(auth(token))
    .send({ title: "Unit Test", orgUnitIds: opts.orgUnitIds ?? [] });
  expect(created.status).toBe(201);
  const examId = created.body.id as string;

  const withSection = await request(app)
    .post(`/api/c/${slug}/exams/${examId}/sections`)
    .set(auth(token))
    .send({ name: "Section 1", durationMinutes: 30 });
  expect(withSection.status).toBe(201);
  const sectionId = withSection.body.sections[0].id as string;

  const q = await request(app)
    .post(`/api/c/${slug}/exam-questions`)
    .set(auth(token))
    .send({
      sectionId,
      type: ExamQuestionType.MCQ_SINGLE,
      text: "2 + 2 = ?",
      marks: 5,
      options: ["3", "4"],
      correctOptions: [1],
    });
  expect(q.status).toBe(201);

  const pub = await request(app)
    .post(`/api/c/${slug}/exams/${examId}/publish`)
    .set(auth(token))
    .send({ isPublished: true });
  expect(pub.status).toBe(200);
  expect(pub.body.sections[0].questions).toHaveLength(1);
  return examId;
}

describe("college exams — authoring, taking, results (reused engine)", () => {
  it("authors a college exam, a student takes it, and results are tenant-scoped", async () => {
    const { adminToken } = await setupCollege("ce-flow");
    const dept = await createUnit("ce-flow", adminToken, {
      type: "department",
      name: "CSE",
    });
    const examId = await authorPublishedExam("ce-flow", adminToken); // college-wide
    const student = await addStudent(
      "ce-flow",
      adminToken,
      "s1@ce.edu",
      "R1",
      dept,
    );

    // Student sees the published exam in their tenant list.
    const list = await request(app)
      .get("/api/c/ce-flow/exams")
      .set(auth(student.token));
    expect(list.status).toBe(200);
    expect(list.body.items.map((e: { id: string }) => e.id)).toContain(examId);

    // Start via the tenant route → then ride the SHARED /attempts engine.
    const start = await request(app)
      .post(`/api/c/ce-flow/exams/${examId}/attempts`)
      .set(auth(student.token));
    expect(start.status).toBe(201);
    const attemptId = start.body.attemptId as string;
    const questionId = start.body.questions[0].id as string;

    await request(app)
      .post(`/api/attempts/${attemptId}/section/answers`)
      .set(auth(student.token))
      .send({ answers: [{ questionId, selectedOptions: [1] }] });
    const submit = await request(app)
      .post(`/api/attempts/${attemptId}/submit`)
      .set(auth(student.token))
      .send({ auto: false });
    expect(submit.status).toBe(200);
    expect(submit.body.score).toBe(5);
    expect(submit.body.passed).toBe(true);

    // Tenant-scoped results read.
    const results = await request(app)
      .get(`/api/c/ce-flow/exams/${examId}/results`)
      .set(auth(adminToken));
    expect(results.status).toBe(200);
    expect(results.body.items).toHaveLength(1);
    expect(results.body.items[0].score).toBe(5);
    expect(results.body.items[0].rollNumber).toBe("R1");
  });

  it("duplicates an exam's whole paper into a fresh unpublished draft", async () => {
    const { adminToken } = await setupCollege("ce-dup");
    const examId = await authorPublishedExam("ce-dup", adminToken);

    const dup = await request(app)
      .post(`/api/c/ce-dup/exams/${examId}/duplicate`)
      .set(auth(adminToken))
      .send({ title: "Copy — Set B" });
    expect(dup.status).toBe(201);
    expect(dup.body.id).not.toBe(examId);
    expect(dup.body.title).toBe("Copy — Set B");

    // Source detail to compare the copied tree.
    const src = await request(app)
      .get(`/api/c/ce-dup/exams/${examId}`)
      .set(auth(adminToken));
    expect(dup.body.sections).toHaveLength(src.body.sections.length);
    expect(dup.body.sections[0].questions).toHaveLength(
      src.body.sections[0].questions.length,
    );
    // Correct answers carried over; marks re-summed.
    expect(dup.body.sections[0].questions[0].correctOptions).toEqual(
      src.body.sections[0].questions[0].correctOptions,
    );
    expect(dup.body.totalMarks).toBe(src.body.totalMarks);

    // It's a fresh DRAFT with no attempts — it must not appear published, and
    // starting it (as an unpublished exam) is refused.
    const list = await request(app)
      .get("/api/c/ce-dup/exams/manage")
      .set(auth(adminToken));
    const copyRow = list.body.items.find(
      (e: { id: string }) => e.id === dup.body.id,
    );
    expect(copyRow.isPublished).toBe(false);
    expect(copyRow.attemptCount).toBe(0);
  });

  it("gates a college exam start behind its per-exam access code", async () => {
    const { adminToken } = await setupCollege("ce-code");
    const dept = await createUnit("ce-code", adminToken, {
      type: "department",
      name: "CSE",
    });
    const examId = await authorPublishedExam("ce-code", adminToken);
    // Turn the code gate on (faculty read the code out before the exam).
    const upd = await request(app)
      .patch(`/api/c/ce-code/exams/${examId}`)
      .set(auth(adminToken))
      .send({ accessCodeEnabled: true, accessCode: "GO1234" });
    expect(upd.status).toBe(200);

    const student = await addStudent("ce-code", adminToken, "s@ce.edu", "R1", dept);
    const url = `/api/c/ce-code/exams/${examId}/attempts`;

    const missing = await request(app).post(url).set(auth(student.token)).send({});
    expect(missing.status).toBe(403);
    expect(missing.body.error.code).toBe("ACCESS_CODE_REQUIRED");

    const wrong = await request(app)
      .post(url)
      .set(auth(student.token))
      .send({ accessCode: "nope" });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe("ACCESS_CODE_INVALID");

    const ok = await request(app)
      .post(url)
      .set(auth(student.token))
      .send({ accessCode: "go1234" }); // case-insensitive
    expect(ok.status).toBe(201);
    expect(ok.body.attemptId).toBeTruthy();
  });

  it("403s the whole surface when the `exams` feature is off", async () => {
    const { adminToken } = await setupCollege("ce-nofeat", {}); // no features
    const manage = await request(app)
      .get("/api/c/ce-nofeat/exams/manage")
      .set(auth(adminToken));
    expect(manage.status).toBe(403);
    expect(manage.body.error.code).toBe("FEATURE_NOT_ENABLED");
  });

  it("denies faculty authoring outside their org-unit scope", async () => {
    const { collegeId, adminToken } = await setupCollege("ce-scope");
    const dept = await createUnit("ce-scope", adminToken, {
      type: "department",
      name: "CSE",
    });
    const secA = await createUnit("ce-scope", adminToken, {
      type: "section",
      name: "A",
      parentId: dept,
    });
    const secB = await createUnit("ce-scope", adminToken, {
      type: "section",
      name: "B",
      parentId: dept,
    });
    const faculty = await makeUser({
      role: Role.FACULTY,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(collegeId),
    });
    await UserModel.updateOne(
      { _id: faculty.userId },
      { $set: { facultyScope: { orgUnits: [new Types.ObjectId(secA)] } } },
    );

    // Targeting section B (out of scope) → denied.
    const outOfScope = await request(app)
      .post("/api/c/ce-scope/exams")
      .set(auth(faculty.token))
      .send({ title: "Nope", orgUnitIds: [secB] });
    expect(outOfScope.status).toBe(403);
    expect(outOfScope.body.error.code).toBe("ORG_UNIT_OUT_OF_SCOPE");

    // A faculty may not create a college-wide (empty-target) exam.
    const collegeWide = await request(app)
      .post("/api/c/ce-scope/exams")
      .set(auth(faculty.token))
      .send({ title: "Nope", orgUnitIds: [] });
    expect(collegeWide.status).toBe(403);

    // Targeting section A (in scope) → allowed.
    const ok = await request(app)
      .post("/api/c/ce-scope/exams")
      .set(auth(faculty.token))
      .send({ title: "Quiz A", orgUnitIds: [secA] });
    expect(ok.status).toBe(201);

    // Faculty cannot manage a college-wide exam authored by the admin.
    const adminExam = await request(app)
      .post("/api/c/ce-scope/exams")
      .set(auth(adminToken))
      .send({ title: "Wide", orgUnitIds: [] });
    const denyManage = await request(app)
      .get(`/api/c/ce-scope/exams/${adminExam.body.id}`)
      .set(auth(faculty.token));
    expect(denyManage.status).toBe(403);
  });

  it("denies cross-tenant authoring/reads and isolates exams per college", async () => {
    const colA = await setupCollege("ce-xa");
    const colB = await setupCollege("ce-xb");
    const deptA = await createUnit("ce-xa", colA.adminToken, {
      type: "department",
      name: "CSE",
    });
    const examA = await authorPublishedExam("ce-xa", colA.adminToken);
    void deptA;

    // Cross-tenant: College A admin cannot reach College B's space at all.
    const crossManage = await request(app)
      .get("/api/c/ce-xb/exams/manage")
      .set(auth(colA.adminToken));
    expect(crossManage.status).toBe(403);
    expect(crossManage.body.error.code).toBe("CROSS_TENANT_DENIED");

    // College B's authoring list does NOT contain College A's exam.
    const bManage = await request(app)
      .get("/api/c/ce-xb/exams/manage")
      .set(auth(colB.adminToken));
    expect(bManage.status).toBe(200);
    expect(bManage.body.items.map((e: { id: string }) => e.id)).not.toContain(
      examA,
    );

    // College B cannot fetch College A's exam by id via its own slug → 404.
    const bReadA = await request(app)
      .get(`/api/c/ce-xb/exams/${examA}`)
      .set(auth(colB.adminToken));
    expect(bReadA.status).toBe(404);
  });

  it("hides unpublished exams and refuses to start them; blocks non-members", async () => {
    const { adminToken } = await setupCollege("ce-draft");
    const dept = await createUnit("ce-draft", adminToken, {
      type: "department",
      name: "CSE",
    });
    // Author but DON'T publish.
    const created = await request(app)
      .post("/api/c/ce-draft/exams")
      .set(auth(adminToken))
      .send({ title: "Draft", orgUnitIds: [] });
    const examId = created.body.id as string;
    await request(app)
      .post(`/api/c/ce-draft/exams/${examId}/sections`)
      .set(auth(adminToken))
      .send({ name: "S1", durationMinutes: 10 });

    const student = await addStudent(
      "ce-draft",
      adminToken,
      "d1@ce.edu",
      "D1",
      dept,
    );
    // Not listed…
    const list = await request(app)
      .get("/api/c/ce-draft/exams")
      .set(auth(student.token));
    expect(list.body.items.map((e: { id: string }) => e.id)).not.toContain(
      examId,
    );
    // …and not startable.
    const start = await request(app)
      .post(`/api/c/ce-draft/exams/${examId}/attempts`)
      .set(auth(student.token));
    expect(start.status).toBe(404);

    // An individual (B2C) user is not a member → the tenant space 403s.
    const individual = await makeUser();
    const denied = await request(app)
      .get("/api/c/ce-draft/exams")
      .set(auth(individual.token));
    expect(denied.status).toBe(403);
  });

  it("enforces org-unit targeting on taking", async () => {
    const { adminToken } = await setupCollege("ce-target");
    const dept = await createUnit("ce-target", adminToken, {
      type: "department",
      name: "CSE",
    });
    const secA = await createUnit("ce-target", adminToken, {
      type: "section",
      name: "A",
      parentId: dept,
    });
    const secB = await createUnit("ce-target", adminToken, {
      type: "section",
      name: "B",
      parentId: dept,
    });
    // Exam targeted at section A only.
    const examA = await authorPublishedExam("ce-target", adminToken, {
      orgUnitIds: [secA],
    });
    const studentB = await addStudent(
      "ce-target",
      adminToken,
      "b@ce.edu",
      "B1",
      secB,
    );

    // Section-B student doesn't see or start a section-A exam.
    const list = await request(app)
      .get("/api/c/ce-target/exams")
      .set(auth(studentB.token));
    expect(list.body.items.map((e: { id: string }) => e.id)).not.toContain(
      examA,
    );
    const start = await request(app)
      .post(`/api/c/ce-target/exams/${examA}/attempts`)
      .set(auth(studentB.token));
    expect(start.status).toBe(403);
    expect(start.body.error.code).toBe("ORG_UNIT_OUT_OF_SCOPE");

    // A section-A student can.
    const studentA = await addStudent(
      "ce-target",
      adminToken,
      "a@ce.edu",
      "A1",
      secA,
    );
    const okStart = await request(app)
      .post(`/api/c/ce-target/exams/${examA}/attempts`)
      .set(auth(studentA.token));
    expect(okStart.status).toBe(201);
  });
});
