/**
 * Assessment engine tests (supertest + in-memory Mongo). The BullMQ producer is
 * mocked; the worker is simulated by writing ExecutionJob results directly — no
 * live Piston. Covers the attempt lifecycle, MCQ + CODE grading, timer expiry →
 * auto-submit, attempt limits + reset audit, public-link availability + an
 * anonymous attempt, answer sanitization, and an Excel round-trip.
 */
import {
  CodeLanguage,
  EXAM_MAX_WARNINGS,
  ExamQuestionType,
  JobStatus,
  TopicType,
} from "@codeapt/shared";
import type { Express } from "express";
import ExcelJS from "exceljs";
import { Types } from "mongoose";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/execution-queue.js", () => ({
  enqueueCodeJob: vi.fn(async () => undefined),
  closeQueues: vi.fn(async () => undefined),
  knownQueues: [],
}));

import { createApp } from "../src/app.js";
import {
  ExamModel,
  ExamAttemptResetLogModel,
  ExamQuestionModel,
  ExamSectionModel,
  ExamTestCaseModel,
  PublicExamLinkModel,
  StudentExamAttemptModel,
} from "../src/models/assessment.model.js";
import {
  EnrollmentModel,
  ModuleModel,
  SubjectModel,
  TopicModel,
} from "../src/models/curriculum.model.js";
import { ExecutionJobModel } from "../src/models/execution.model.js";

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
  const u = `exam${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Cand ${counter}`,
      rollNumber: `ROLL-${counter}`,
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

/** Build a 2-section exam (MCQ_SINGLE + MCQ_MULTI, then CODE) and enroll `userId`. */
async function makeExam(opts: { enroll?: string } = {}) {
  const subject = await SubjectModel.create({
    name: "Mock",
    slug: `mock-${counter}-${Math.random().toString(36).slice(2, 8)}`,
    price: 0,
  });
  const mod = await ModuleModel.create({
    subject: subject._id,
    name: "M",
    order: 1,
  });
  const topic = await TopicModel.create({
    module: mod._id,
    name: "Exam Topic",
    topicType: TopicType.EXAM,
    order: 1,
  });
  const exam = await ExamModel.create({
    topic: topic._id,
    title: "Sample",
    passPercentage: 40,
    totalMarks: 20,
  });
  const s1 = await ExamSectionModel.create({
    exam: exam._id,
    name: "Aptitude",
    order: 0,
    durationMinutes: 30,
  });
  const s2 = await ExamSectionModel.create({
    exam: exam._id,
    name: "Coding",
    order: 1,
    durationMinutes: 45,
  });
  const qSingle = await ExamQuestionModel.create({
    exam: exam._id,
    section: s1._id,
    questionType: ExamQuestionType.MCQ_SINGLE,
    text: "Binary search complexity?",
    order: 0,
    marks: 5,
    options: ["O(n)", "O(log n)", "O(1)"],
    correctOptions: [1],
  });
  const qMulti = await ExamQuestionModel.create({
    exam: exam._id,
    section: s1._id,
    questionType: ExamQuestionType.MCQ_MULTI,
    text: "Linear structures?",
    order: 1,
    marks: 5,
    options: ["Array", "Tree", "Linked list", "Graph"],
    correctOptions: [0, 2],
  });
  const qCode = await ExamQuestionModel.create({
    exam: exam._id,
    section: s2._id,
    questionType: ExamQuestionType.CODE,
    text: "Greet",
    order: 0,
    marks: 10,
    starterCode: "print('hi')",
    language: CodeLanguage.PYTHON,
  });
  await ExamTestCaseModel.create([
    {
      question: qCode._id,
      inputData: "Ada",
      expectedOutput: "Hello, Ada!",
      isHidden: false,
      order: 0,
    },
    {
      question: qCode._id,
      inputData: "Grace",
      expectedOutput: "Hello, Grace!",
      isHidden: true,
      order: 1,
    },
  ]);
  if (opts.enroll) {
    await EnrollmentModel.create({ user: opts.enroll, subject: subject._id });
  }
  return { exam, s1, s2, qSingle, qMulti, qCode };
}

async function completeJob(jobId: string, passed: number, total: number) {
  await ExecutionJobModel.updateOne(
    { jobId },
    {
      $set: {
        status: JobStatus.COMPLETED,
        result: {
          language: "python",
          version: "3.10.0",
          compile: null,
          run: { stdout: "", stderr: "", exitCode: 0, signal: null },
          timedOut: false,
          testResults: [],
          passedCount: passed,
          totalCount: total,
        },
      },
    },
  );
}

// ---------------------------------------------------------------------------

describe("attempt lifecycle + grading", () => {
  it("start → sanitized section (no answers leaked) → save → advance → submit → grade", async () => {
    const { token, userId } = await registerAndLogin();
    const { exam, qSingle, qMulti, qCode } = await makeExam({ enroll: userId });

    // Start.
    const start = await request(app)
      .post(`/api/exams/${exam._id.toString()}/attempts`)
      .set(auth(token));
    expect(start.status).toBe(201);
    const attemptId = start.body.attemptId as string;
    expect(start.body.totalSections).toBe(2);
    expect(start.body.sectionRemainingSeconds).toBeGreaterThan(0);
    // Calculator defaults on, so the runner payload advertises it.
    expect(start.body.calculatorEnabled).toBe(true);
    // Sanitization: no correctOptions anywhere in the section payload.
    expect(JSON.stringify(start.body)).not.toContain("correctOptions");
    const q1 = start.body.questions.find(
      (q: { id: string }) => q.id === qSingle._id.toString(),
    );
    expect(q1.options).toHaveLength(3);
    expect(q1).not.toHaveProperty("correctOptions");

    // Save section-1 answers (MCQ_SINGLE correct, MCQ_MULTI correct set).
    const save = await request(app)
      .post(`/api/attempts/${attemptId}/section/answers`)
      .set(auth(token))
      .send({
        answers: [
          { questionId: qSingle._id.toString(), selectedOptions: [1] },
          { questionId: qMulti._id.toString(), selectedOptions: [2, 0] },
        ],
      });
    expect(save.status).toBe(200);
    expect(save.body.saved).toBe(2);

    // Advance to the coding section.
    const adv = await request(app)
      .post(`/api/attempts/${attemptId}/advance`)
      .set(auth(token));
    expect(adv.status).toBe(200);
    expect(adv.body.sectionIndex).toBe(1);
    const codeView = adv.body.questions[0];
    expect(codeView.starterCode).toContain("print");
    // Model default: no allowedLanguages set → OPEN (empty) in the sanitized view.
    expect(codeView.allowedLanguages).toEqual([]);
    expect(codeView.sampleCases).toHaveLength(1); // only the visible case
    expect(JSON.stringify(adv.body)).not.toContain("Hello, Grace!"); // hidden

    // Save code answer + submit.
    await request(app)
      .post(`/api/attempts/${attemptId}/section/answers`)
      .set(auth(token))
      .send({
        answers: [
          {
            questionId: qCode._id.toString(),
            code: "print('x')",
            language: "python",
          },
        ],
      });
    const submit = await request(app)
      .post(`/api/attempts/${attemptId}/submit`)
      .set(auth(token))
      .send({});
    expect(submit.status).toBe(200);
    // MCQ graded (10), code job pending.
    expect(submit.body.status).toBe("submitted");
    expect(submit.body.gradingPending).toBe(true);

    // Simulate the worker completing the code job (all pass).
    const attempt = await StudentExamAttemptModel.findById(attemptId).lean();
    const jobId = (
      attempt!.responseData as { codeJobs: Record<string, string> }
    ).codeJobs[qCode._id.toString()]!;
    await completeJob(jobId, 2, 2);

    // Finalize.
    const fin = await request(app)
      .post(`/api/attempts/${attemptId}/finalize`)
      .set(auth(token));
    expect(fin.status).toBe(200);
    expect(fin.body.status).toBe("graded");
    expect(fin.body.gradingPending).toBe(false);
    expect(fin.body.score).toBe(20); // 5 + 5 + 10
    expect(fin.body.passed).toBe(true);

    // Idempotent re-finalize.
    const fin2 = await request(app)
      .post(`/api/attempts/${attemptId}/finalize`)
      .set(auth(token));
    expect(fin2.body.score).toBe(20);
    expect(fin2.body.status).toBe("graded");
  });

  it("propagates a disabled calculator into the section view", async () => {
    const { token, userId } = await registerAndLogin();
    const { exam } = await makeExam({ enroll: userId });
    await ExamModel.updateOne(
      { _id: exam._id },
      { $set: { calculatorEnabled: false } },
    );
    const start = await request(app)
      .post(`/api/exams/${exam._id.toString()}/attempts`)
      .set(auth(token));
    expect(start.status).toBe(201);
    expect(start.body.calculatorEnabled).toBe(false);
  });

  it("grades MCQ_SINGLE strictly and MCQ_MULTI by set equality", async () => {
    const { token, userId } = await registerAndLogin();
    const { exam, qSingle, qMulti } = await makeExam({ enroll: userId });
    const start = await request(app)
      .post(`/api/exams/${exam._id.toString()}/attempts`)
      .set(auth(token));
    const attemptId = start.body.attemptId as string;
    // Single WRONG, multi PARTIAL (should score 0 — no partial credit).
    await request(app)
      .post(`/api/attempts/${attemptId}/section/answers`)
      .set(auth(token))
      .send({
        answers: [
          { questionId: qSingle._id.toString(), selectedOptions: [0] },
          { questionId: qMulti._id.toString(), selectedOptions: [0] },
        ],
      });
    // Advance + submit (no code answer → grades immediately).
    await request(app)
      .post(`/api/attempts/${attemptId}/advance`)
      .set(auth(token));
    const submit = await request(app)
      .post(`/api/attempts/${attemptId}/submit`)
      .set(auth(token))
      .send({});
    expect(submit.body.status).toBe("graded");
    expect(submit.body.score).toBe(0);
    expect(submit.body.passed).toBe(false);
  });
});

describe("section timer", () => {
  it("rejects saves after expiry and auto-submits on submit", async () => {
    const { token, userId } = await registerAndLogin();
    const { exam, qSingle } = await makeExam({ enroll: userId });
    const start = await request(app)
      .post(`/api/exams/${exam._id.toString()}/attempts`)
      .set(auth(token));
    const attemptId = start.body.attemptId as string;

    // Force the section clock into the past.
    await StudentExamAttemptModel.updateOne(
      { _id: attemptId },
      { $set: { sectionStartTime: new Date(Date.now() - 60 * 60 * 1000) } },
    );

    const save = await request(app)
      .post(`/api/attempts/${attemptId}/section/answers`)
      .set(auth(token))
      .send({
        answers: [{ questionId: qSingle._id.toString(), selectedOptions: [1] }],
      });
    expect(save.status).toBe(409);
    expect(save.body.error.code).toBe("SECTION_EXPIRED");

    const submit = await request(app)
      .post(`/api/attempts/${attemptId}/submit`)
      .set(auth(token))
      .send({});
    expect(submit.body.status).toBe("graded");
    expect(submit.body.autoSubmitted).toBe(true);
  });
});

describe("admin exam list", () => {
  it("lists all exams with counts, regardless of enrollment; admin-only", async () => {
    const admin = await registerAndLogin("admin");
    // Two exams, neither enrolled by the admin.
    const { exam: examA } = await makeExam();
    await makeExam();

    const res = await request(app)
      .get("/api/admin/exams")
      .set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(2);
    const a = res.body.items.find(
      (e: { id: string }) => e.id === examA._id.toString(),
    );
    expect(a).toBeDefined();
    expect(a.sectionCount).toBe(2);
    expect(a.questionCount).toBe(3);
    expect(a.title).toBe("Sample");

    // Non-admin is rejected.
    const { token } = await registerAndLogin();
    const forbidden = await request(app)
      .get("/api/admin/exams")
      .set(auth(token));
    expect(forbidden.status).toBe(403);
  });
});

describe("attempt limits + reset audit", () => {
  it("blocks a second start and reset re-enables it with an audit row", async () => {
    const admin = await registerAndLogin("admin");
    const { token, userId } = await registerAndLogin();
    const { exam } = await makeExam({ enroll: userId });

    const first = await request(app)
      .post(`/api/exams/${exam._id.toString()}/attempts`)
      .set(auth(token));
    expect(first.status).toBe(201);
    const second = await request(app)
      .post(`/api/exams/${exam._id.toString()}/attempts`)
      .set(auth(token));
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("ATTEMPT_LIMIT_REACHED");

    // Admin reset.
    const reset = await request(app)
      .post(`/api/admin/exams/${exam._id.toString()}/reset-attempts`)
      .set(auth(admin.token))
      .send({ userId, reason: "support request" });
    expect(reset.status).toBe(200);
    expect(reset.body.attemptCount).toBe(0);

    const log = await ExamAttemptResetLogModel.findOne({
      exam: exam._id,
      user: new Types.ObjectId(userId),
    });
    expect(log).not.toBeNull();
    expect(log!.previousCount).toBe(1);

    const third = await request(app)
      .post(`/api/exams/${exam._id.toString()}/attempts`)
      .set(auth(token));
    expect(third.status).toBe(201);
  });
});

describe("public link (anonymous)", () => {
  it("honors the availability window and runs an anonymous attempt", async () => {
    const { userId } = await registerAndLogin();
    const { exam, qSingle } = await makeExam({ enroll: userId });

    // Inactive link → unavailable.
    const inactive = await PublicExamLinkModel.create({
      exam: exam._id,
      accessToken: "tok-inactive",
      isActive: false,
    });
    const a1 = await request(app).get(
      `/api/public/exams/${inactive.accessToken}`,
    );
    expect(a1.body.available).toBe(false);

    // Future window → unavailable.
    const future = await PublicExamLinkModel.create({
      exam: exam._id,
      accessToken: "tok-future",
      isActive: true,
      startTime: new Date(Date.now() + 60 * 60 * 1000),
    });
    const a2 = await request(app).get(
      `/api/public/exams/${future.accessToken}`,
    );
    expect(a2.body.available).toBe(false);

    // Active → available + anonymous start.
    const active = await PublicExamLinkModel.create({
      exam: exam._id,
      accessToken: "tok-active",
      isActive: true,
    });
    const a3 = await request(app).get(
      `/api/public/exams/${active.accessToken}`,
    );
    expect(a3.body.available).toBe(true);
    expect(a3.body.exam.sectionCount).toBe(2);

    const start = await request(app)
      .post(`/api/public/exams/${active.accessToken}/attempts`)
      .send({ rollNumber: "R-100", collegeName: "Acme Institute" });
    expect(start.status).toBe(201);
    const attemptId = start.body.attemptId as string;
    const attemptToken = start.body.attemptToken as string;
    expect(attemptToken).toBeTruthy();

    // Engine calls require the attempt token (no session).
    const noToken = await request(app).get(
      `/api/attempts/${attemptId}/section`,
    );
    expect(noToken.status).toBe(403);

    const withToken = await request(app)
      .get(`/api/attempts/${attemptId}/section`)
      .set("X-Attempt-Token", attemptToken);
    expect(withToken.status).toBe(200);

    // Anonymous answer + advance + submit.
    await request(app)
      .post(`/api/attempts/${attemptId}/section/answers`)
      .set("X-Attempt-Token", attemptToken)
      .send({
        answers: [{ questionId: qSingle._id.toString(), selectedOptions: [1] }],
      });
    await request(app)
      .post(`/api/attempts/${attemptId}/advance`)
      .set("X-Attempt-Token", attemptToken);
    const submit = await request(app)
      .post(`/api/attempts/${attemptId}/submit`)
      .set("X-Attempt-Token", attemptToken)
      .send({});
    expect(submit.body.status).toBe("graded");
    expect(submit.body.score).toBe(5); // only the single MCQ answered
  });

  it("gates an anonymous start behind the link's access code", async () => {
    const { userId } = await registerAndLogin();
    const { exam } = await makeExam({ enroll: userId });
    const link = await PublicExamLinkModel.create({
      exam: exam._id,
      accessToken: "tok-coded",
      isActive: true,
      accessCodeEnabled: true,
      accessCode: "Tiger24",
    });

    // Availability advertises the gate but never the code itself.
    const avail = await request(app).get(
      `/api/public/exams/${link.accessToken}`,
    );
    expect(avail.body.available).toBe(true);
    expect(avail.body.accessCodeEnabled).toBe(true);
    expect(JSON.stringify(avail.body)).not.toContain("Tiger24");

    const identity = { rollNumber: "R-1", collegeName: "Acme" };

    // Missing code → 403 ACCESS_CODE_REQUIRED.
    const missing = await request(app)
      .post(`/api/public/exams/${link.accessToken}/attempts`)
      .send(identity);
    expect(missing.status).toBe(403);
    expect(missing.body.error.code).toBe("ACCESS_CODE_REQUIRED");

    // Wrong code → 403 ACCESS_CODE_INVALID.
    const wrong = await request(app)
      .post(`/api/public/exams/${link.accessToken}/attempts`)
      .send({ ...identity, accessCode: "nope" });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe("ACCESS_CODE_INVALID");

    // Correct code (case-insensitive + trimmed) → 201.
    const ok = await request(app)
      .post(`/api/public/exams/${link.accessToken}/attempts`)
      .send({ ...identity, accessCode: "  tiger24  " });
    expect(ok.status).toBe(201);
    expect(ok.body.attemptToken).toBeTruthy();
  });
});

describe("per-exam access code (logged-in start)", () => {
  it("rejects missing/wrong codes without burning an attempt, then accepts the right one", async () => {
    const { token, userId } = await registerAndLogin();
    const { exam } = await makeExam({ enroll: userId });
    await ExamModel.updateOne(
      { _id: exam._id },
      { $set: { accessCodeEnabled: true, accessCode: "OPEN99" } },
    );
    const url = `/api/exams/${exam._id.toString()}/attempts`;

    // No code → 403, and (critically) it must NOT consume the single attempt.
    const missing = await request(app).post(url).set(auth(token)).send({});
    expect(missing.status).toBe(403);
    expect(missing.body.error.code).toBe("ACCESS_CODE_REQUIRED");

    const wrong = await request(app)
      .post(url)
      .set(auth(token))
      .send({ accessCode: "WRONG" });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe("ACCESS_CODE_INVALID");

    // Right code still works → the earlier rejections didn't spend the attempt.
    const ok = await request(app)
      .post(url)
      .set(auth(token))
      .send({ accessCode: "open99" });
    expect(ok.status).toBe(201);
    expect(ok.body.attemptId).toBeTruthy();
  });
});

describe("warnings", () => {
  async function startAttempt(): Promise<{ token: string; attemptId: string }> {
    const { token, userId } = await registerAndLogin();
    const { exam } = await makeExam({ enroll: userId });
    const start = await request(app)
      .post(`/api/exams/${exam._id.toString()}/attempts`)
      .set(auth(token));
    return { token, attemptId: start.body.attemptId as string };
  }
  const warn = (attemptId: string, token: string) =>
    request(app).post(`/api/attempts/${attemptId}/warning`).set(auth(token));

  it("stays active below the limit (no auto-submit)", async () => {
    const { token, attemptId } = await startAttempt();
    // EXAM_MAX_WARNINGS = 2 → warnings 1 and 2 are allowed, not malpractice.
    for (let i = 0; i < EXAM_MAX_WARNINGS; i++) {
      const res = await warn(attemptId, token);
      expect(res.body.isMalpractice).toBe(false);
      expect(res.body.autoSubmitted).toBe(false);
    }
    // The attempt is still in progress — the section endpoint still serves it.
    const section = await request(app)
      .get(`/api/attempts/${attemptId}/section`)
      .set(auth(token));
    expect(section.status).toBe(200);
    expect(section.body.status).toBe("in_progress");
  });

  it("auto-submits (auto + malpractice, terminal) when warnings cross the limit", async () => {
    const { token, attemptId } = await startAttempt();
    let last;
    for (let i = 0; i < EXAM_MAX_WARNINGS + 1; i++) {
      last = await warn(attemptId, token);
    }
    // The crossing warning flags malpractice AND reports the force-submit.
    expect(last!.body.warningsTriggered).toBe(EXAM_MAX_WARNINGS + 1);
    expect(last!.body.isMalpractice).toBe(true);
    expect(last!.body.autoSubmitted).toBe(true);

    // The attempt is terminal via the existing pipeline, with both flags set.
    const result = await request(app)
      .get(`/api/attempts/${attemptId}/result`)
      .set(auth(token));
    expect(result.status).toBe(200);
    expect(result.body.status).toBe("graded");
    expect(result.body.autoSubmitted).toBe(true);
    expect(result.body.isMalpractice).toBe(true);
  });
});

describe("mark for review", () => {
  it("persists marked-for-review across reload (within the section)", async () => {
    const { token, userId } = await registerAndLogin();
    const { exam, qMulti } = await makeExam({ enroll: userId });
    const start = await request(app)
      .post(`/api/exams/${exam._id.toString()}/attempts`)
      .set(auth(token));
    const attemptId = start.body.attemptId as string;
    // Nothing marked initially.
    expect(start.body.markedForReview).toEqual([]);

    // Flag a question in the CURRENT section (no answer change needed).
    const flag = await request(app)
      .post(`/api/attempts/${attemptId}/section/answers`)
      .set(auth(token))
      .send({ answers: [], markedForReview: [qMulti._id.toString()] });
    expect(flag.status).toBe(200);

    // Reload the section (simulates a refresh) → the flag survived.
    const view = await request(app)
      .get(`/api/attempts/${attemptId}/section`)
      .set(auth(token));
    expect(view.status).toBe(200);
    expect(view.body.markedForReview).toEqual([qMulti._id.toString()]);
  });
});

describe("Excel round-trip", () => {
  it("imports separate MCQ + coding single-sheet workbooks (inline test cases)", async () => {
    const admin = await registerAndLogin("admin");
    const { exam } = await makeExam();
    const examId = exam._id.toString();

    // --- MCQ workbook (flat, MCQ-only) ---
    const mcqWb = new ExcelJS.Workbook();
    const mcqWs = mcqWb.addWorksheet("MCQ Questions");
    mcqWs.addRow([
      "section",
      "sectionDuration",
      "order",
      "text",
      "marks",
      "option1",
      "option2",
      "option3",
      "option4",
      "option5",
      "correctOptions",
    ]);
    mcqWs.addRow([
      "Verbal",
      20,
      0,
      "Synonym of fast?",
      5,
      "slow",
      "quick",
      "late",
      "",
      "",
      "2",
    ]);
    const mcqBase64 = Buffer.from(await mcqWb.xlsx.writeBuffer()).toString(
      "base64",
    );

    const mcqUpload = await request(app)
      .post(`/api/admin/exams/${examId}/bulk-upload`)
      .set(auth(admin.token))
      .send({ fileBase64: mcqBase64, kind: "mcq" });
    expect(mcqUpload.status).toBe(200);
    expect(mcqUpload.body.createdSections).toBe(1);
    expect(mcqUpload.body.createdQuestions).toBe(1);
    expect(mcqUpload.body.createdTestCases).toBe(0);
    expect(mcqUpload.body.errors).toHaveLength(0);

    // --- Coding workbook (flat, INLINE test cases) ---
    const codeWb = new ExcelJS.Workbook();
    const codeWs = codeWb.addWorksheet("Coding Questions");
    codeWs.addRow([
      "section",
      "sectionDuration",
      "order",
      "text",
      "marks",
      "starterCode",
      "language",
      "allowedLanguages",
      "input1",
      "expected1",
      "hidden1",
      "input2",
      "expected2",
      "hidden2",
    ]);
    codeWs.addRow([
      "Verbal", // same section name → find-or-create reuses it (no new section)
      20,
      1,
      "Greet",
      10,
      "print('hi')",
      "python",
      "java", // single language → LOCKED to java
      "Ada",
      "Hello, Ada!",
      "false",
      "Bo",
      "Hello, Bo!",
      "true",
    ]);
    const codeBase64 = Buffer.from(await codeWb.xlsx.writeBuffer()).toString(
      "base64",
    );

    const codeUpload = await request(app)
      .post(`/api/admin/exams/${examId}/bulk-upload`)
      .set(auth(admin.token))
      .send({ fileBase64: codeBase64, kind: "coding" });
    expect(codeUpload.status).toBe(200);
    expect(codeUpload.body.createdSections).toBe(0); // "Verbal" already exists
    expect(codeUpload.body.createdQuestions).toBe(1);
    expect(codeUpload.body.createdTestCases).toBe(2);
    expect(codeUpload.body.errors).toHaveLength(0);

    // Admin detail: one "Verbal" section with both questions.
    const detail = await request(app)
      .get(`/api/admin/exams/${examId}`)
      .set(auth(admin.token));
    const verbal = detail.body.sections.find(
      (s: { name: string }) => s.name === "Verbal",
    );
    expect(verbal.questions).toHaveLength(2);
    const single = verbal.questions.find(
      (q: { type: string }) => q.type === "MCQ_SINGLE",
    );
    expect(single.correctOptions).toEqual([1]); // "2" 1-based → 0-based [1]
    expect(single.allowedLanguages).toEqual([]); // MCQ → open

    const codeQ = verbal.questions.find(
      (q: { type: string }) => q.type === "CODE",
    );
    expect(codeQ.allowedLanguages).toEqual(["java"]); // single lang → LOCKED
  });

  it("exports a results workbook that parses back", async () => {
    const admin = await registerAndLogin("admin");
    const { token, userId } = await registerAndLogin();
    const { exam, qSingle } = await makeExam({ enroll: userId });
    const start = await request(app)
      .post(`/api/exams/${exam._id.toString()}/attempts`)
      .set(auth(token));
    const attemptId = start.body.attemptId as string;
    await request(app)
      .post(`/api/attempts/${attemptId}/section/answers`)
      .set(auth(token))
      .send({
        answers: [{ questionId: qSingle._id.toString(), selectedOptions: [1] }],
      });
    await request(app)
      .post(`/api/attempts/${attemptId}/advance`)
      .set(auth(token));
    await request(app)
      .post(`/api/attempts/${attemptId}/submit`)
      .set(auth(token))
      .send({});

    const res = await request(app)
      .get(`/api/admin/exams/${exam._id.toString()}/results.xlsx`)
      .set(auth(admin.token))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as Buffer);
    const ws = wb.getWorksheet("Results")!;
    // Header + at least one candidate row.
    expect(ws.rowCount).toBeGreaterThanOrEqual(2);
    const header = ws.getRow(1).values as unknown[];
    expect(header).toContain("Total");
    expect(header).toContain("Passed");
  });
});
