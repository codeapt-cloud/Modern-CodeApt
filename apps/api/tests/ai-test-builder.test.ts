/**
 * AI Test Builder (Prompt 3) — LLM-generated questions inserted into a college
 * exam + mirrored into the Self Bank. Proves:
 *  - the pure coercion (`coerceGeneratedQuestions`) keeps valid MCQ_SINGLE /
 *    MCQ_MULTI / CODE and DROPS malformed items (bad type, no text, too few
 *    options, no/too-many correct indices, blank option) — nothing invalid is
 *    ever inserted;
 *  - with a FAKE generator injected, valid questions are created via the exam
 *    creation path (so they're identical to any other exam question) AND
 *    auto-populated into the college Self Bank (tenant-scoped);
 *  - the no-LLM-key path degrades gracefully (configured:false, created:0) —
 *    env defaults to the `mock` provider, so the live endpoint takes this path;
 *  - the endpoint is feature- (exams), faculty-, and tenant-gated, and a
 *    cross-tenant exam is not found.
 * supertest + in-memory Mongo, mirroring question-bank.test.ts.
 */
import {
  ExamQuestionType,
  Role,
  UserType,
  coerceGeneratedQuestions,
  coerceGeneratedSections,
  registerLlmRouter,
  type AiGenerateQuestionsRequest,
  type CollegeEntitlements,
  type QuestionGenerator,
} from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { encryptSecret } from "../src/lib/crypto.js";
import { installLlmGateway } from "../src/lib/llm-gateway/index.js";
import {
  AiProviderKeyModel,
  AiProviderModel,
} from "../src/models/ai-provider.model.js";
import { UserModel } from "../src/models/user.model.js";
import * as colleges from "../src/services/college.service.js";
import {
  generateFullExam,
  generateQuestionsIntoExam,
} from "../src/services/question-bank.service.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

// Never let an installed gateway router or a stubbed fetch leak into other
// tests (which expect the no-gateway "not configured" path).
afterEach(() => {
  registerLlmRouter(null);
  vi.unstubAllGlobals();
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const ALL_TYPES = [
  ExamQuestionType.MCQ_SINGLE,
  ExamQuestionType.MCQ_MULTI,
  ExamQuestionType.CODE,
];

let counter = 0;
async function makeUser(fields?: {
  role?: string;
  userType?: string;
  college?: Types.ObjectId | null;
}): Promise<{ token: string; userId: string }> {
  counter += 1;
  const u = `ai${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `AI User ${counter}`,
      rollNumber: `AIU-${counter}`,
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
  features: Record<string, boolean> = { exams: true, question_banks: true, ai: true },
  subCapabilities: Record<string, boolean> = { "ai.question_generation": true },
): Promise<{ collegeId: string; adminToken: string }> {
  const platform = await makeUser({ role: Role.SUPER_ADMIN });
  const college = await colleges.createCollege({ name: slug, slug }, platform.userId);
  await colleges.setEntitlements(college.id, { features, subCapabilities });
  const admin = await makeUser({
    role: Role.COLLEGE_ADMIN,
    userType: UserType.COLLEGE,
    college: new Types.ObjectId(college.id),
  });
  return { collegeId: college.id, adminToken: admin.token };
}

async function makeExamWithSection(slug: string, token: string) {
  const exam = await request(app)
    .post(`/api/c/${slug}/exams`)
    .set(auth(token))
    .send({ title: "AI Target", orgUnitIds: [] });
  expect(exam.status).toBe(201);
  const withSection = await request(app)
    .post(`/api/c/${slug}/exams/${exam.body.id}/sections`)
    .set(auth(token))
    .send({ name: "Aptitude", durationMinutes: 30 });
  expect(withSection.status).toBe(201);
  return {
    examId: exam.body.id as string,
    sectionId: withSection.body.sections[0].id as string,
  };
}

// A permissive entitlements object — the service ignores it (gating is enforced
// at the route), so tenancy of the direct-call tests rests on collegeId alone.
const ENTITLEMENTS = {
  features: {},
  subCapabilities: {},
} as unknown as CollegeEntitlements;

const AI_URL = (slug: string) => `/api/c/${slug}/question-banks/ai-generate`;

// ---------------------------------------------------------------------------
// Pure coercion
// ---------------------------------------------------------------------------

describe("coerceGeneratedQuestions (LLM output → real question shape)", () => {
  it("keeps valid MCQ_SINGLE / MCQ_MULTI / CODE and drops malformed items", () => {
    const raw = [
      // valid MCQ_SINGLE
      {
        questionType: "MCQ_SINGLE",
        text: "2 + 2 = ?",
        marks: 4,
        options: ["3", "4", "5"],
        correctOptions: [1],
      },
      // valid MCQ_MULTI (two correct)
      {
        questionType: "MCQ_MULTI",
        text: "Pick the even numbers",
        options: ["2", "3", "4"],
        correctOptions: [0, 2],
      },
      // valid CODE with advisory test cases
      {
        questionType: "CODE",
        text: "Sum two ints",
        starterCode: "# code",
        language: "python",
        testCases: [{ input: "2 3", expectedOutput: "5" }],
      },
      // malformed: unknown type
      { questionType: "TRUE_FALSE", text: "T/F?" },
      // malformed: empty text
      { questionType: "MCQ_SINGLE", text: "  ", options: ["a", "b"], correctOptions: [0] },
      // malformed: too few options
      { questionType: "MCQ_SINGLE", text: "one option", options: ["a"], correctOptions: [0] },
      // malformed: no correct option
      { questionType: "MCQ_MULTI", text: "no answer", options: ["a", "b"], correctOptions: [] },
      // malformed: MCQ_SINGLE with two correct
      { questionType: "MCQ_SINGLE", text: "two answers", options: ["a", "b"], correctOptions: [0, 1] },
      // malformed: blank option would shift indices
      { questionType: "MCQ_SINGLE", text: "blank opt", options: ["a", "", "c"], correctOptions: [2] },
    ];
    const { questions, skipped } = coerceGeneratedQuestions(raw, ALL_TYPES, 20);
    expect(questions.map((q) => q.type)).toEqual([
      "MCQ_SINGLE",
      "MCQ_MULTI",
      "CODE",
    ]);
    expect(skipped).toBe(6);
    const code = questions[2]!;
    expect(code.testCases).toEqual([
      { input: "2 3", expectedOutput: "5", isHidden: false, order: 0 },
    ]);
  });

  it("drops a type the faculty did not request", () => {
    const raw = [
      { questionType: "CODE", text: "code q", language: "python", testCases: [] },
      { questionType: "MCQ_SINGLE", text: "mcq q", options: ["a", "b"], correctOptions: [0] },
    ];
    const { questions, skipped } = coerceGeneratedQuestions(
      raw,
      [ExamQuestionType.MCQ_SINGLE],
      20,
    );
    expect(questions).toHaveLength(1);
    expect(questions[0]!.type).toBe("MCQ_SINGLE");
    expect(skipped).toBe(1);
  });

  it("caps the survivors at the requested count", () => {
    const raw = Array.from({ length: 5 }, (_, i) => ({
      questionType: "MCQ_SINGLE",
      text: `q${i}`,
      options: ["a", "b"],
      correctOptions: [0],
    }));
    const { questions, skipped } = coerceGeneratedQuestions(raw, ALL_TYPES, 3);
    expect(questions).toHaveLength(3);
    expect(skipped).toBe(2);
  });
});

describe("coerceGeneratedSections (full-exam LLM output → sections)", () => {
  it("keeps valid sections, fills blanks, drops empties, caps counts", () => {
    const raw = [
      {
        name: "Aptitude",
        durationMinutes: 20,
        questions: [
          { questionType: "MCQ_SINGLE", text: "a1", options: ["a", "b"], correctOptions: [0] },
          { questionType: "MCQ_SINGLE", text: "bad", options: ["only"], correctOptions: [0] }, // dropped
        ],
      },
      {
        name: "", // blank → fallback name
        durationMinutes: 0, // → default duration
        questions: [
          { questionType: "CODE", text: "code", starterCode: "x", language: "python", testCases: [] },
        ],
      },
      {
        name: "Empty",
        questions: [
          { questionType: "MCQ_SINGLE", text: "", options: ["a", "b"], correctOptions: [0] }, // invalid
        ],
      }, // no valid questions → whole section dropped
    ];
    const { sections, skipped } = coerceGeneratedSections(raw, ALL_TYPES, {
      maxSections: 8,
      maxPerSection: 20,
    });
    expect(sections).toHaveLength(2);
    expect(sections[0]!.name).toBe("Aptitude");
    expect(sections[0]!.durationMinutes).toBe(20);
    expect(sections[0]!.questions).toHaveLength(1);
    expect(sections[1]!.name).toBe("Section 2"); // blank → fallback
    expect(sections[1]!.durationMinutes).toBe(30); // 0 → default
    expect(skipped).toBeGreaterThanOrEqual(1);
  });

  it("caps the number of sections and questions per section", () => {
    const raw = Array.from({ length: 5 }, (_, i) => ({
      name: `S${i}`,
      questions: Array.from({ length: 4 }, (_, j) => ({
        questionType: "MCQ_SINGLE",
        text: `q${i}-${j}`,
        options: ["a", "b"],
        correctOptions: [0],
      })),
    }));
    const { sections } = coerceGeneratedSections(raw, ALL_TYPES, {
      maxSections: 2,
      maxPerSection: 2,
    });
    expect(sections).toHaveLength(2);
    expect(sections.every((s) => s.questions.length === 2)).toBe(true);
  });

  it("non-array / empty input → no sections (never throws)", () => {
    expect(coerceGeneratedSections(null, ALL_TYPES).sections).toHaveLength(0);
    expect(coerceGeneratedSections(undefined, ALL_TYPES).sections).toHaveLength(0);
    expect(coerceGeneratedSections([], ALL_TYPES).sections).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Insert + self-bank populate (fake generator injected)
// ---------------------------------------------------------------------------

describe("generateQuestionsIntoExam (insert + self-bank)", () => {
  it("inserts valid questions into the exam and mirrors them into the Self Bank", async () => {
    const c = await setupCollege("ai-insert");
    const { examId, sectionId } = await makeExamWithSection("ai-insert", c.adminToken);

    const fake: QuestionGenerator = async () => ({
      configured: true,
      raw: [
        {
          questionType: "MCQ_SINGLE",
          text: "AI MCQ one",
          options: ["a", "b", "c"],
          correctOptions: [2],
          marks: 3,
        },
        {
          questionType: "CODE",
          text: "AI code one",
          starterCode: "# go",
          language: "python",
          testCases: [{ input: "1", expectedOutput: "1", isHidden: true }],
        },
        // malformed → skipped, never inserted
        { questionType: "MCQ_SINGLE", text: "bad", options: ["only"], correctOptions: [0] },
      ],
    });

    const req: AiGenerateQuestionsRequest = {
      examId,
      sectionId,
      description: "A short aptitude + coding test.",
      questionTypes: ALL_TYPES,
      count: 10,
      difficulty: "easy",
    };
    const res = await generateQuestionsIntoExam(c.collegeId, ENTITLEMENTS, req, fake);
    expect(res.configured).toBe(true);
    expect(res.created).toBe(2);
    expect(res.skipped).toBe(1);
    expect(res.warnings.length).toBeGreaterThan(0);

    // The exam now holds the two real questions (CODE keeps its test case).
    const detail = await request(app)
      .get(`/api/c/ai-insert/exams/${examId}`)
      .set(auth(c.adminToken));
    expect(detail.status).toBe(200);
    const qs = detail.body.sections.find((s: { id: string }) => s.id === sectionId).questions;
    expect(qs).toHaveLength(2);
    const mcq = qs.find((q: { type: string }) => q.type === "MCQ_SINGLE");
    expect(mcq.options).toEqual(["a", "b", "c"]);
    expect(mcq.correctOptions).toEqual([2]);
    const code = qs.find((q: { type: string }) => q.type === "CODE");
    expect(code.testCases).toHaveLength(1);
    expect(code.testCases[0].isHidden).toBe(true);

    // Self Bank now mirrors the two generated questions (category = section name).
    const self = await request(app)
      .get("/api/c/ai-insert/question-banks")
      .set(auth(c.adminToken))
      .query({ scope: "college", pageSize: 100 });
    expect(self.status).toBe(200);
    expect(self.body.items).toHaveLength(2);
    expect(
      self.body.items.every(
        (q: { scope: string; category: string }) =>
          q.scope === "college" && q.category === "Aptitude",
      ),
    ).toBe(true);
  });

  it("returns the graceful no-key state when the LLM is not configured", async () => {
    const c = await setupCollege("ai-nokey");
    const { examId, sectionId } = await makeExamWithSection("ai-nokey", c.adminToken);
    const notConfigured: QuestionGenerator = async () => ({
      configured: false,
      raw: [],
    });
    const res = await generateQuestionsIntoExam(
      c.collegeId,
      ENTITLEMENTS,
      {
        examId,
        sectionId,
        description: "anything",
        questionTypes: ALL_TYPES,
        count: 5,
        difficulty: "medium",
      },
      notConfigured,
    );
    expect(res).toMatchObject({ configured: false, created: 0, skipped: 0 });
    expect(res.warnings[0]).toMatch(/configured/i);
  });

  it("is CONFIGURED via the installed gateway (no legacy env vars needed)", async () => {
    // Regression: AI Build used to gate on ESSAY_LLM_* env vars, so it reported
    // "not configured" whenever the multi-provider gateway (keys in the DB) was
    // the only thing set up. With the gateway installed it must generate.
    const c = await setupCollege("ai-gw");
    const { examId, sectionId } = await makeExamWithSection("ai-gw", c.adminToken);

    const provider = await AiProviderModel.create({
      name: "GW Test Provider",
      kind: "openai_compat",
      baseUrl: "https://gw.test/v1",
      model: "test-model",
      enabled: true,
      priority: 10,
      capability: "capable",
    });
    await AiProviderKeyModel.create({
      provider: provider._id,
      keyCiphertext: encryptSecret("sk-gw"),
      enabled: true,
    });
    installLlmGateway(); // arms only because the api test env sets ENCRYPTION_KEY

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  questions: [
                    {
                      questionType: "MCQ_SINGLE",
                      text: "Gateway-generated Q",
                      options: ["a", "b"],
                      correctOptions: [1],
                      marks: 2,
                    },
                  ],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 5 },
        }),
        text: async () => "",
      })),
    );

    // No injected generator → exercises the REAL makeDefaultGenerator path.
    const res = await generateQuestionsIntoExam(c.collegeId, ENTITLEMENTS, {
      examId,
      sectionId,
      description: "Gateway path",
      questionTypes: ALL_TYPES,
      count: 3,
      difficulty: "easy",
    });
    expect(res.configured).toBe(true);
    expect(res.created).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Full-Exam AI Build — creates sections + questions (fake generator injected)
// ---------------------------------------------------------------------------

describe("generateFullExam (creates sections + questions)", () => {
  const fullExamGen =
    (sections: unknown): (() => Promise<{ configured: boolean; rawSections: unknown }>) =>
    async () => ({ configured: true, rawSections: sections });

  it("creates the sections, inserts questions, and mirrors to the Self Bank", async () => {
    const c = await setupCollege("ai-full");
    const exam = await request(app)
      .post("/api/c/ai-full/exams")
      .set(auth(c.adminToken))
      .send({ title: "Full", orgUnitIds: [] });
    expect(exam.status).toBe(201);
    const examId = exam.body.id as string;

    const res = await generateFullExam(
      c.collegeId,
      ENTITLEMENTS,
      {
        examId,
        description: "a full placement exam",
        questionTypes: ALL_TYPES,
        sectionCount: 4,
        questionsPerSection: 5,
        difficulty: "easy",
      },
      fullExamGen([
        {
          name: "Aptitude",
          durationMinutes: 25,
          questions: [
            { questionType: "MCQ_SINGLE", text: "Full A1", options: ["a", "b", "c"], correctOptions: [1], marks: 2 },
          ],
        },
        {
          name: "Coding",
          durationMinutes: 40,
          questions: [
            {
              questionType: "CODE",
              text: "Full code",
              starterCode: "# go",
              language: "python",
              testCases: [{ input: "1", expectedOutput: "1", isHidden: true }],
            },
          ],
        },
      ]),
    );
    expect(res).toMatchObject({ configured: true, sectionsCreated: 2, created: 2 });

    const detail = await request(app)
      .get(`/api/c/ai-full/exams/${examId}`)
      .set(auth(c.adminToken));
    expect(detail.status).toBe(200);
    expect(detail.body.sections).toHaveLength(2);
    const apt = detail.body.sections.find((s: { name: string }) => s.name === "Aptitude");
    expect(apt.durationMinutes).toBe(25);
    expect(apt.questions).toHaveLength(1);
    const coding = detail.body.sections.find((s: { name: string }) => s.name === "Coding");
    expect(coding.questions[0].testCases).toHaveLength(1);

    const self = await request(app)
      .get("/api/c/ai-full/question-banks")
      .set(auth(c.adminToken))
      .query({ scope: "college", pageSize: 100 });
    expect(self.body.items).toHaveLength(2);
  });

  it("APPENDS after existing sections (never clobbers manual work)", async () => {
    const c = await setupCollege("ai-full-append");
    const { examId } = await makeExamWithSection("ai-full-append", c.adminToken); // 1 existing section
    const res = await generateFullExam(
      c.collegeId,
      ENTITLEMENTS,
      {
        examId,
        description: "add a round",
        questionTypes: ALL_TYPES,
        sectionCount: 2,
        questionsPerSection: 3,
        difficulty: "medium",
      },
      fullExamGen([
        {
          name: "AI Section",
          questions: [
            { questionType: "MCQ_SINGLE", text: "x", options: ["a", "b"], correctOptions: [0] },
          ],
        },
      ]),
    );
    expect(res.sectionsCreated).toBe(1);
    const detail = await request(app)
      .get(`/api/c/ai-full-append/exams/${examId}`)
      .set(auth(c.adminToken));
    expect(detail.body.sections).toHaveLength(2); // existing + 1 new
    expect(detail.body.sections[1].name).toBe("AI Section");
  });

  it("returns the graceful no-key state when the LLM is not configured", async () => {
    const c = await setupCollege("ai-full-nokey");
    const exam = await request(app)
      .post("/api/c/ai-full-nokey/exams")
      .set(auth(c.adminToken))
      .send({ title: "F", orgUnitIds: [] });
    const res = await generateFullExam(
      c.collegeId,
      ENTITLEMENTS,
      {
        examId: exam.body.id as string,
        description: "x",
        questionTypes: ALL_TYPES,
        sectionCount: 2,
        questionsPerSection: 3,
        difficulty: "medium",
      },
      async () => ({ configured: false, rawSections: [] }),
    );
    expect(res).toMatchObject({ configured: false, sectionsCreated: 0, created: 0 });
    expect(res.warnings[0]).toMatch(/configured/i);
  });

  it("403s the full-exam endpoint without `ai.question_generation`", async () => {
    const c = await setupCollege("ai-full-noai", { exams: true, ai: false }, {});
    const res = await request(app)
      .post("/api/c/ai-full-noai/question-banks/ai-generate-exam")
      .set(auth(c.adminToken))
      .send({
        examId: new Types.ObjectId().toString(),
        description: "x",
        questionTypes: ALL_TYPES,
        sectionCount: 2,
        questionsPerSection: 3,
        difficulty: "medium",
      });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Endpoint gating + graceful degrade (real generator; env provider = mock)
// ---------------------------------------------------------------------------

describe("ai-generate endpoint (feature / faculty / tenant gating)", () => {
  it("degrades gracefully over HTTP when no LLM key is configured", async () => {
    const c = await setupCollege("ai-http-nokey");
    const { examId, sectionId } = await makeExamWithSection("ai-http-nokey", c.adminToken);
    const res = await request(app)
      .post(AI_URL("ai-http-nokey"))
      .set(auth(c.adminToken))
      .send({
        examId,
        sectionId,
        description: "A test about arrays.",
        questionTypes: ALL_TYPES,
        count: 5,
        difficulty: "medium",
      });
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.created).toBe(0);
    expect(res.body.warnings[0]).toMatch(/configured/i);
  });

  it("403s a college without the `exams` feature", async () => {
    const c = await setupCollege("ai-nofeat", { question_banks: true }); // no exams
    const res = await request(app)
      .post(AI_URL("ai-nofeat"))
      .set(auth(c.adminToken))
      .send({
        examId: new Types.ObjectId().toString(),
        sectionId: new Types.ObjectId().toString(),
        description: "x",
        questionTypes: ALL_TYPES,
        count: 3,
        difficulty: "medium",
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FEATURE_NOT_ENABLED");
  });

  it("403s a college without the `ai.question_generation` sub-capability", async () => {
    // exams on, but the per-college AI toggle is off.
    const c = await setupCollege("ai-nogen", { exams: true, ai: false }, {});
    const res = await request(app)
      .post(AI_URL("ai-nogen"))
      .set(auth(c.adminToken))
      .send({
        examId: new Types.ObjectId().toString(),
        sectionId: new Types.ObjectId().toString(),
        description: "x",
        questionTypes: ALL_TYPES,
        count: 3,
        difficulty: "medium",
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FEATURE_NOT_ENABLED"); // `ai` feature off
  });

  it("403s a non-faculty college student", async () => {
    const c = await setupCollege("ai-student");
    const student = await makeUser({
      role: Role.STUDENT,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(c.collegeId),
    });
    const res = await request(app)
      .post(AI_URL("ai-student"))
      .set(auth(student.token))
      .send({
        examId: new Types.ObjectId().toString(),
        sectionId: new Types.ObjectId().toString(),
        description: "x",
        questionTypes: ALL_TYPES,
        count: 3,
        difficulty: "medium",
      });
    expect(res.status).toBe(403);
  });

  it("404s a cross-tenant exam", async () => {
    const a = await setupCollege("ai-x-a");
    const b = await setupCollege("ai-x-b");
    const target = await makeExamWithSection("ai-x-b", b.adminToken);
    // College A faculty targets College B's exam → not found (tenant isolation).
    const res = await request(app)
      .post(AI_URL("ai-x-a"))
      .set(auth(a.adminToken))
      .send({
        examId: target.examId,
        sectionId: target.sectionId,
        description: "x",
        questionTypes: ALL_TYPES,
        count: 3,
        difficulty: "medium",
      });
    expect(res.status).toBe(404);
  });
});
