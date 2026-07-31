/**
 * College essays (Phase 4c) — tenant-scoped authoring + writing over the REUSED
 * essay engine. Proves: authoring behind the `essays` feature (create → publish),
 * keyword generation tenant-scoped, a college student writing + submitting via the
 * reused engine and being graded by the SAME pipeline (worker simulated), drafts +
 * attempt-cap tenant-scoped, tenant-scoped results; feature-off 403; faculty
 * out-of-scope denial; cross-tenant author/read denial; hard isolation (College A's
 * essay is invisible/inaccessible to College B and to individual users, and an
 * individual essay is unaffected); unpublished/not-targeted essays neither listed
 * nor writable. The existing essay suite (essay.test.ts et al.) proves individual
 * essays are byte-for-byte unchanged. supertest + in-memory Mongo, mirroring
 * college-exams.test.ts.
 */
import { EXAM_MAX_WARNINGS, JobStatus, Role, UserType } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

// The BullMQ producer is mocked (no Redis in tests); grading is simulated by
// writing the grade onto the EssayAttempt directly — exactly as essay.test.ts does.
vi.mock("../src/lib/execution-queue.js", () => ({
  enqueueCodeJob: vi.fn(async () => undefined),
  enqueueEssayGradingJob: vi.fn(async () => undefined),
  closeQueues: vi.fn(async () => undefined),
  knownQueues: [],
  ESSAY_GRADING_JOB_NAME: "grade-essay",
}));

import { createApp } from "../src/app.js";
import { enqueueEssayGradingJob } from "../src/lib/execution-queue.js";
import { EssayAttemptModel } from "../src/models/essay.model.js";
import { UserModel } from "../src/models/user.model.js";
import * as credits from "../src/services/ai-credit.service.js";
import * as colleges from "../src/services/college.service.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

const TEMP_PW = "CodeApt@123"; // env BULK_ENROLL_DEFAULT_PASSWORD default
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const LONG_ESSAY =
  "Climate change is one of the most pressing challenges of our era and it " +
  "demands coordinated action across governments, industry, and individuals " +
  "who together can reduce emissions and build a more sustainable future.";

let counter = 0;
async function makeUser(fields?: {
  role?: string;
  userType?: string;
  college?: Types.ObjectId | null;
}): Promise<{ token: string; userId: string }> {
  counter += 1;
  const u = `cs${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `CS User ${counter}`,
      rollNumber: `CSU-${counter}`,
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

/** A college with a college_admin + the `essays` feature on (unless disabled). */
async function setupCollege(
  slug: string,
  features: Record<string, boolean> = { essays: true },
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
  await UserModel.updateOne({ _id: id }, { $set: { forcePasswordChange: false } });
  const login = await request(app)
    .post("/api/auth/login")
    .send({ identifier: email, password: TEMP_PW });
  expect(login.status).toBe(200);
  return { id, token: login.body.accessToken as string };
}

/** Author + publish a college essay topic; returns its id. */
async function authorPublishedEssay(
  slug: string,
  adminToken: string,
  orgUnitIds: string[] = [],
): Promise<string> {
  const created = await request(app)
    .post(`/api/c/${slug}/essay-topics`)
    .set(auth(adminToken))
    .send({
      title: "The Climate Essay",
      description: "Discuss the causes and remedies of climate change.",
      instructions: "Write a structured argument in 150–400 words.",
      minWords: 5,
      semanticKeywords: ["climate", "emissions", "sustainability"],
      orgUnitIds,
    });
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  const published = await request(app)
    .post(`/api/c/${slug}/essay-topics/${id}/publish`)
    .set(auth(adminToken))
    .send({ isPublished: true });
  expect(published.status).toBe(200);
  return id;
}

/** Simulate the grading worker finalizing an attempt (as essay.test.ts does). */
async function simulateGrade(jobId: string, finalScore = 74): Promise<void> {
  await EssayAttemptModel.updateOne(
    { gradingJobId: jobId },
    {
      $set: {
        gradingStatus: JobStatus.COMPLETED,
        finalScore,
        scoreSource: "deterministic_fallback",
        gradedAt: new Date(),
        feedback: "Solid structure and relevance.",
      },
    },
  );
}

describe("College essays — authoring + writing + grading", () => {
  it("author → publish → student writes + is graded → tenant results", async () => {
    const { adminToken } = await setupCollege("essa");
    const dept = await createUnit("essa", adminToken, {
      type: "department",
      name: "CSE",
    });
    const student = await addStudent(
      "essa",
      adminToken,
      "s1@essa.edu",
      "R1",
      dept,
    );
    // College-wide essay (no targeting).
    const essayId = await authorPublishedEssay("essa", adminToken);

    // Student sees it in their tenant list.
    const list = await request(app)
      .get(`/api/c/essa/essays`)
      .set(auth(student.token));
    expect(list.status).toBe(200);
    expect(list.body.items.map((e: { id: string }) => e.id)).toContain(essayId);

    // Detail (no reference keywords leaked).
    const detail = await request(app)
      .get(`/api/c/essa/essays/${essayId}`)
      .set(auth(student.token));
    expect(detail.status).toBe(200);
    expect(detail.body).not.toHaveProperty("semanticKeywords");
    expect(detail.body).not.toHaveProperty("referenceKeywords");

    // Autosave draft round-trips.
    const saved = await request(app)
      .put(`/api/c/essa/essays/${essayId}/draft`)
      .set(auth(student.token))
      .send({ content: "early thoughts on climate" });
    expect(saved.status).toBe(200);
    const gotDraft = await request(app)
      .get(`/api/c/essa/essays/${essayId}/draft`)
      .set(auth(student.token));
    expect(gotDraft.body.draft.content).toBe("early thoughts on climate");

    // Submit → grading job (fast), then simulate the worker + poll the SHARED
    // grading endpoint (authorized by attempt ownership — reused unchanged).
    const submit = await request(app)
      .post(`/api/c/essa/essays/${essayId}/submit`)
      .set(auth(student.token))
      .send({ content: LONG_ESSAY });
    expect(submit.status).toBe(202);
    const jobId = submit.body.jobId as string;
    expect(jobId).toBeTruthy();

    await simulateGrade(jobId, 74);
    const poll = await request(app)
      .get(`/api/essays/submissions/${jobId}`)
      .set(auth(student.token));
    expect(poll.status).toBe(200);
    expect(poll.body.status).toBe("completed");
    expect(poll.body.total).toBe(74);

    // The attempt is tenant-stamped.
    const attempt = await EssayAttemptModel.findOne({ gradingJobId: jobId });
    expect(attempt?.college?.toString()).toBeTruthy();

    // Operator results are tenant-scoped and show the submission.
    const results = await request(app)
      .get(`/api/c/essa/essay-topics/${essayId}/results`)
      .set(auth(adminToken));
    expect(results.status).toBe(200);
    expect(results.body.items).toHaveLength(1);
    expect(results.body.items[0].rollNumber).toBe("R1");
    expect(results.body.items[0].finalScore).toBe(74);
  });

  it("feature off → 403 for authoring and student list", async () => {
    const { adminToken } = await setupCollege("essb", { essays: false });
    const dept = await createUnit("essb", adminToken, {
      type: "department",
      name: "CSE",
    });
    const student = await addStudent("essb", adminToken, "b1@essb.edu", "B1", dept);

    const create = await request(app)
      .post(`/api/c/essb/essay-topics`)
      .set(auth(adminToken))
      .send({ title: "X", description: "d", instructions: "i" });
    expect(create.status).toBe(403);

    const list = await request(app)
      .get(`/api/c/essb/essays`)
      .set(auth(student.token));
    expect(list.status).toBe(403);
  });

  it("keyword generation works tenant-scoped", async () => {
    const { adminToken } = await setupCollege("essk");
    const res = await request(app)
      .post(`/api/c/essk/essay-topics/generate-keywords`)
      .set(auth(adminToken))
      .send({
        title: "Renewable Energy",
        description: "Solar and wind adoption",
        instructions: "",
      });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.keywords)).toBe(true);
    expect(res.body.keywords.length).toBeGreaterThan(0);
    expect(["llm", "deterministic"]).toContain(res.body.source);
  });

  it("faculty may only target org-units within their scope", async () => {
    const { collegeId, adminToken } = await setupCollege("essf");
    const unitA = await createUnit("essf", adminToken, {
      type: "department",
      name: "A",
    });
    const unitB = await createUnit("essf", adminToken, {
      type: "department",
      name: "B",
    });
    // A faculty scoped to unit A only.
    const faculty = await makeUser({
      role: Role.FACULTY,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(collegeId),
    });
    await UserModel.updateOne(
      { _id: faculty.userId },
      { $set: { facultyScope: { orgUnits: [new Types.ObjectId(unitA)] } } },
    );

    // Targeting unit B (out of scope) → denied.
    const denied = await request(app)
      .post(`/api/c/essf/essay-topics`)
      .set(auth(faculty.token))
      .send({
        title: "T",
        description: "d",
        instructions: "i",
        orgUnitIds: [unitB],
      });
    expect(denied.status).toBe(403);

    // Targeting unit A (in scope) → allowed.
    const ok = await request(app)
      .post(`/api/c/essf/essay-topics`)
      .set(auth(faculty.token))
      .send({
        title: "T",
        description: "d",
        instructions: "i",
        orgUnitIds: [unitA],
      });
    expect(ok.status).toBe(201);
  });

  it("hard isolation: College B + individuals cannot see/read College A's essay", async () => {
    const a = await setupCollege("essa1");
    const b = await setupCollege("essb1");
    const essayId = await authorPublishedEssay("essa1", a.adminToken);

    // College B admin: not in B's authoring list, and 404 on read/update/delete.
    const bList = await request(app)
      .get(`/api/c/essb1/essay-topics`)
      .set(auth(b.adminToken));
    expect(bList.status).toBe(200);
    expect(bList.body.items).toHaveLength(0);

    const bRead = await request(app)
      .get(`/api/c/essb1/essay-topics/${essayId}`)
      .set(auth(b.adminToken));
    expect(bRead.status).toBe(404);

    const bDelete = await request(app)
      .delete(`/api/c/essb1/essay-topics/${essayId}`)
      .set(auth(b.adminToken));
    expect(bDelete.status).toBe(404);

    // An individual (B2C) user: college essay never appears in the enrollment
    // list and is not readable via the individual endpoint.
    const indiv = await makeUser();
    const indivList = await request(app)
      .get(`/api/essays`)
      .set(auth(indiv.token));
    expect(indivList.status).toBe(200);
    expect(indivList.body.items.map((e: { id: string }) => e.id)).not.toContain(
      essayId,
    );
    const indivRead = await request(app)
      .get(`/api/essays/${essayId}`)
      .set(auth(indiv.token));
    expect(indivRead.status).toBe(404);
  });

  it("unpublished + not-targeted essays are neither listed nor writable", async () => {
    const { adminToken } = await setupCollege("essu");
    const unitA = await createUnit("essu", adminToken, {
      type: "department",
      name: "A",
    });
    const unitB = await createUnit("essu", adminToken, {
      type: "department",
      name: "B",
    });
    const student = await addStudent("essu", adminToken, "u1@essu.edu", "U1", unitA);

    // Unpublished (draft) essay → not listed, not writable (404).
    const draft = await request(app)
      .post(`/api/c/essu/essay-topics`)
      .set(auth(adminToken))
      .send({ title: "Draft", description: "d", instructions: "i", minWords: 5 });
    const draftId = draft.body.id as string;

    // Published but targeted at unit B (student is in unit A).
    const targetedB = await authorPublishedEssay("essu", adminToken, [unitB]);

    const list = await request(app)
      .get(`/api/c/essu/essays`)
      .set(auth(student.token));
    const ids = list.body.items.map((e: { id: string }) => e.id);
    expect(ids).not.toContain(draftId);
    expect(ids).not.toContain(targetedB);

    // Writing the draft → 404 (unpublished); writing targetedB → 403 (cohort).
    const submitDraft = await request(app)
      .post(`/api/c/essu/essays/${draftId}/submit`)
      .set(auth(student.token))
      .send({ content: LONG_ESSAY });
    expect(submitDraft.status).toBe(404);

    const submitB = await request(app)
      .post(`/api/c/essu/essays/${targetedB}/submit`)
      .set(auth(student.token))
      .send({ content: LONG_ESSAY });
    expect(submitB.status).toBe(403);
  });

  it("attempt cap is enforced tenant-scoped", async () => {
    const { adminToken } = await setupCollege("essc");
    const dept = await createUnit("essc", adminToken, {
      type: "department",
      name: "CSE",
    });
    const student = await addStudent("essc", adminToken, "c1@essc.edu", "C1", dept);
    // maxAttempts = 1 topic.
    const created = await request(app)
      .post(`/api/c/essc/essay-topics`)
      .set(auth(adminToken))
      .send({
        title: "OneShot",
        description: "d",
        instructions: "i",
        minWords: 5,
        maxAttempts: 1,
      });
    const id = created.body.id as string;
    await request(app)
      .post(`/api/c/essc/essay-topics/${id}/publish`)
      .set(auth(adminToken))
      .send({ isPublished: true });

    const first = await request(app)
      .post(`/api/c/essc/essays/${id}/submit`)
      .set(auth(student.token))
      .send({ content: LONG_ESSAY });
    expect(first.status).toBe(202);

    const second = await request(app)
      .post(`/api/c/essc/essays/${id}/submit`)
      .set(auth(student.token))
      .send({ content: LONG_ESSAY });
    expect(second.status).toBe(409); // ATTEMPT_LIMIT_REACHED
  });
});

describe("College essays — AI credits gate essay grading (Stage 1)", () => {
  it("exhausted credits → enqueues deterministic-only (aiEnabled false, collegeId set)", async () => {
    const { collegeId, adminToken } = await setupCollege("crssay");
    // Grant the AI essay-grading entitlement so only CREDITS gate the AI path.
    await colleges.setEntitlements(collegeId, {
      features: { essays: true, ai: true },
      subCapabilities: { "ai.essay_grading": true },
    });
    const dept = await createUnit("crssay", adminToken, {
      type: "department",
      name: "CSE",
    });
    const student = await addStudent(
      "crssay",
      adminToken,
      "cr1@crssay.edu",
      "CR1",
      dept,
    );
    const essayId = await authorPublishedEssay("crssay", adminToken);

    const mock = vi.mocked(enqueueEssayGradingJob);

    // Credits available → AI grading enabled + charged to the college.
    await credits.setCredits(collegeId, { monthlyOverride: 100 }, new Date());
    mock.mockClear();
    const withCredits = await request(app)
      .post(`/api/c/crssay/essays/${essayId}/submit`)
      .set(auth(student.token))
      .send({ content: LONG_ESSAY });
    expect(withCredits.status).toBe(202);
    expect(mock.mock.calls[0]![0]).toMatchObject({
      aiEnabled: true,
      collegeId,
    });

    // Exhaust the budget → the NEXT submit enqueues deterministic-only (the
    // worker won't call any provider), so a capped college can't touch the pool.
    await credits.setCredits(collegeId, { monthlyOverride: 0 }, new Date());
    mock.mockClear();
    const student2 = await addStudent(
      "crssay",
      adminToken,
      "cr2@crssay.edu",
      "CR2",
      dept,
    );
    const exhausted = await request(app)
      .post(`/api/c/crssay/essays/${essayId}/submit`)
      .set(auth(student2.token))
      .send({ content: LONG_ESSAY });
    expect(exhausted.status).toBe(202);
    expect(mock.mock.calls[0]![0]).toMatchObject({
      aiEnabled: false,
      collegeId,
    });
  });
});

describe("College essays — proctoring / integrity (mirrors the exam policy)", () => {
  /** Set up a college + published essay + an enrolled student in one go. */
  async function proctoredSetup(slug: string): Promise<{
    adminToken: string;
    studentToken: string;
    essayId: string;
  }> {
    const { adminToken } = await setupCollege(slug);
    const dept = await createUnit(slug, adminToken, {
      type: "department",
      name: "CSE",
    });
    const student = await addStudent(
      slug,
      adminToken,
      `p1@${slug}.edu`,
      "P1",
      dept,
    );
    const essayId = await authorPublishedEssay(slug, adminToken);
    return { adminToken, studentToken: student.token, essayId };
  }

  it("persists reported warnings + flags and surfaces them on the poll + results", async () => {
    const { adminToken, studentToken, essayId } = await proctoredSetup("prc1");
    const submit = await request(app)
      .post(`/api/c/prc1/essays/${essayId}/submit`)
      .set(auth(studentToken))
      .send({
        content: LONG_ESSAY,
        integrity: {
          warnings: 1,
          autoSubmitted: false,
          flags: ["blocked-paste", "burst-insert"],
        },
      });
    expect(submit.status).toBe(202);
    const jobId = submit.body.jobId as string;

    // Stored on the attempt; isMalpractice derived server-side (flags present).
    const attempt = await EssayAttemptModel.findOne({ gradingJobId: jobId });
    expect(attempt?.warningsTriggered).toBe(1);
    expect(attempt?.integrityFlags).toEqual(["blocked-paste", "burst-insert"]);
    expect(attempt?.isMalpractice).toBe(true); // a flag alone flags for review

    await simulateGrade(jobId, 70);
    const poll = await request(app)
      .get(`/api/essays/submissions/${jobId}`)
      .set(auth(studentToken));
    expect(poll.status).toBe(200);
    expect(poll.body.integrity).toMatchObject({
      warnings: 1,
      isMalpractice: true,
      flags: ["blocked-paste", "burst-insert"],
    });

    // The tenant results row still lands (grading pipeline unaffected).
    const results = await request(app)
      .get(`/api/c/prc1/essay-topics/${essayId}/results`)
      .set(auth(adminToken));
    expect(results.body.items).toHaveLength(1);
  });

  it("flags malpractice once warnings cross EXAM_MAX_WARNINGS (same as exams)", async () => {
    const { studentToken, essayId } = await proctoredSetup("prc2");
    const submit = await request(app)
      .post(`/api/c/prc2/essays/${essayId}/submit`)
      .set(auth(studentToken))
      .send({
        content: LONG_ESSAY,
        integrity: {
          warnings: EXAM_MAX_WARNINGS + 1,
          autoSubmitted: true,
          flags: [],
        },
      });
    expect(submit.status).toBe(202);
    const attempt = await EssayAttemptModel.findOne({
      gradingJobId: submit.body.jobId,
    });
    expect(attempt?.warningsTriggered).toBe(EXAM_MAX_WARNINGS + 1);
    expect(attempt?.isMalpractice).toBe(true);
  });

  it("an auto-submit bypasses the min-word floor (records a flagged, short attempt)", async () => {
    // Two separate students on the same essay, so each submit is attempt #1
    // (avoids the attempt-cap interfering with the two-part assertion).
    const { adminToken, studentToken, essayId } = await proctoredSetup("prc3");
    const dept2 = await createUnit("prc3", adminToken, {
      type: "department",
      name: "X",
    });
    const student2 = await addStudent(
      "prc3",
      adminToken,
      "p2@prc3.edu",
      "P2",
      dept2,
    );
    const tooShort = "too short"; // below the 5-word minimum

    // Without integrity → normal 422 length rejection (unchanged behavior).
    const rejected = await request(app)
      .post(`/api/c/prc3/essays/${essayId}/submit`)
      .set(auth(studentToken))
      .send({ content: tooShort });
    expect(rejected.status).toBe(422); // LENGTH_OUT_OF_RANGE

    // A flagged auto-submit records the short attempt anyway (mirrors an exam
    // force-submit crossing the warning limit).
    const autoSubmit = await request(app)
      .post(`/api/c/prc3/essays/${essayId}/submit`)
      .set(auth(student2.token))
      .send({
        content: tooShort,
        integrity: {
          warnings: EXAM_MAX_WARNINGS + 1,
          autoSubmitted: true,
          flags: [],
        },
      });
    expect(autoSubmit.status).toBe(202); // auto-submit records it despite length
    const attempt = await EssayAttemptModel.findOne({
      gradingJobId: autoSubmit.body.jobId,
    });
    expect(attempt?.isMalpractice).toBe(true);
  });

  it("a submit WITHOUT integrity is clean (no proctoring record surfaced)", async () => {
    const { studentToken, essayId } = await proctoredSetup("prc4");
    const submit = await request(app)
      .post(`/api/c/prc4/essays/${essayId}/submit`)
      .set(auth(studentToken))
      .send({ content: LONG_ESSAY });
    expect(submit.status).toBe(202);
    const jobId = submit.body.jobId as string;
    const attempt = await EssayAttemptModel.findOne({ gradingJobId: jobId });
    expect(attempt?.warningsTriggered).toBe(0);
    expect(attempt?.isMalpractice).toBe(false);
    await simulateGrade(jobId, 80);
    const poll = await request(app)
      .get(`/api/essays/submissions/${jobId}`)
      .set(auth(studentToken));
    // A clean attempt surfaces no integrity block (null).
    expect(poll.body.integrity ?? null).toBeNull();
  });

  it("autosave still works on a proctored essay (draft round-trips before submit)", async () => {
    const { studentToken, essayId } = await proctoredSetup("prc5");
    const saved = await request(app)
      .put(`/api/c/prc5/essays/${essayId}/draft`)
      .set(auth(studentToken))
      .send({ content: "draft while proctored" });
    expect(saved.status).toBe(200);
    const got = await request(app)
      .get(`/api/c/prc5/essays/${essayId}/draft`)
      .set(auth(studentToken));
    expect(got.body.draft.content).toBe("draft while proctored");

    const submit = await request(app)
      .post(`/api/c/prc5/essays/${essayId}/submit`)
      .set(auth(studentToken))
      .send({
        content: LONG_ESSAY,
        integrity: { warnings: 0, autoSubmitted: false, flags: [] },
      });
    expect(submit.status).toBe(202);
  });
});
