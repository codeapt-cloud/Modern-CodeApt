/**
 * Communication module (Phase 3, non-speech) — API tests. The BullMQ producer
 * is mocked; the essay/email "worker" is simulated by computing the REAL rubric
 * grade (from @codeapt/shared) and writing it onto the attempt, exactly as
 * essay.test.ts does. Covers:
 *   - an EMAIL topic is authored with promptKind=email and grades end to end,
 *     surfacing the 8 email dimensions under `emailDimensions`;
 *   - an ESSAY topic is byte-identically unaffected (7 dims, no emailDimensions);
 *   - the access gate is the SAME essay enrollment gate (reuse, not reinvent);
 *   - a 34-question grammar exam (5 categories, documented counts) is takeable
 *     end to end through the existing exam engine and scores with per-category
 *     (per-section) subtotals;
 *   - the comprehension audio stimulus surfaces and play events are RECORDED
 *     honestly (counted, never silently blocked).
 */
import {
  EssayScoreSource,
  EssayStatus,
  ExamQuestionType,
  JobStatus,
  TopicType,
  scoreEmailDeterministic,
  scoreDeterministic,
} from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/execution-queue.js", () => ({
  enqueueEssayGradingJob: vi.fn(async () => undefined),
  enqueueCodeJob: vi.fn(async () => undefined),
  closeQueues: vi.fn(async () => undefined),
  knownQueues: [],
  ESSAY_GRADING_JOB_NAME: "grade-essay",
}));

import { createApp } from "../src/app.js";
import {
  ExamModel,
  ExamQuestionModel,
  ExamSectionModel,
} from "../src/models/assessment.model.js";
import {
  EnrollmentModel,
  ModuleModel,
  ProgramModel,
  SubjectModel,
  TopicModel,
} from "../src/models/curriculum.model.js";
import { EssayAttemptModel, EssayTopicModel } from "../src/models/essay.model.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

let counter = 0;
async function registerAndLogin(): Promise<{ token: string; userId: string }> {
  counter += 1;
  const u = `comm${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Comm ${counter}`,
      rollNumber: `ROLL-C-${counter}`,
      collegeName: "Acme",
      phoneNumber: "9999999999",
      state: "KA",
    });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ identifier: u, password: "Password123" });
  return {
    token: res.body.accessToken as string,
    userId: res.body.user.id as string,
  };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const uniq = () => `${counter}-${Math.random().toString(36).slice(2, 8)}`;

const EMAIL_KEYWORDS = ["invoice", "payment", "refund", "resolve", "account"];

/** Create an essay/email topic + curriculum tree; returns ids for enrollment. */
async function makeTopic(
  promptKind: "essay" | "email",
): Promise<{ essayTopicId: string; subjectId: Types.ObjectId }> {
  const program = await ProgramModel.create({ name: "Comm", slug: `p-${uniq()}` });
  const subject = await SubjectModel.create({
    name: "Writing",
    slug: `s-${uniq()}`,
    program: program._id,
    price: 0,
  });
  const mod = await ModuleModel.create({ subject: subject._id, name: "Prompts" });
  const topic = await EssayTopicModel.create({
    title: promptKind === "email" ? "Billing dispute email" : "Tech essay",
    description:
      promptKind === "email"
        ? "Write to billing about a duplicate invoice payment."
        : "Discuss technology in education.",
    instructions: "Write at least 20 words.",
    difficultyLevel: 2,
    promptKind,
    minWords: 20,
    maxWords: 400,
    maxAttempts: 3,
    semanticKeywords: EMAIL_KEYWORDS,
    isActive: true,
  });
  await TopicModel.create({
    module: mod._id,
    name: "Prompt",
    topicType: "essay",
    essayTopic: topic._id,
  });
  return { essayTopicId: topic._id.toString(), subjectId: subject._id };
}

const enroll = (userId: string, subjectId: Types.ObjectId) =>
  EnrollmentModel.create({ user: new Types.ObjectId(userId), subject: subjectId });

const GOOD_EMAIL = [
  "Subject: Duplicate invoice payment on my account",
  "",
  "Dear Ms. Sharma,",
  "",
  "Invoice 4821 on my account appears to have been charged twice. I would be",
  "grateful if you could review the duplicate payment and process a refund for",
  "the extra amount.",
  "",
  "Kind regards,",
  "Anita Rao",
].join("\n");

const LONG_ESSAY =
  "Technology has transformed education in profound ways. Students now enjoy " +
  "broad access to digital learning resources, and teachers can personalize " +
  "instruction. Consequently, classrooms are more interactive for learners.";

/** Simulate the worker grading an EMAIL with the REAL email rubric. */
async function completeEmailGrade(jobId: string): Promise<number> {
  const det = scoreEmailDeterministic(GOOD_EMAIL, {
    referenceKeywords: EMAIL_KEYWORDS,
  });
  await EssayAttemptModel.updateOne(
    { gradingJobId: jobId },
    {
      $set: {
        subScores: det.dimensions,
        finalScore: det.total,
        scoreSource: EssayScoreSource.DETERMINISTIC_FALLBACK,
        feedback: "Deterministic email grade.",
        gradingStatus: JobStatus.COMPLETED,
        status: EssayStatus.GRADED,
        gradedAt: new Date(),
      },
    },
  );
  return det.total;
}

/** Simulate the worker grading an ESSAY with the REAL essay rubric. */
async function completeEssayGrade(jobId: string): Promise<number> {
  const det = scoreDeterministic(LONG_ESSAY, { referenceKeywords: EMAIL_KEYWORDS });
  await EssayAttemptModel.updateOne(
    { gradingJobId: jobId },
    {
      $set: {
        subScores: det.dimensions,
        finalScore: det.total,
        scoreSource: EssayScoreSource.DETERMINISTIC_FALLBACK,
        feedback: "Deterministic essay grade.",
        gradingStatus: JobStatus.COMPLETED,
        status: EssayStatus.GRADED,
        gradedAt: new Date(),
      },
    },
  );
  return det.total;
}

// ---------------------------------------------------------------------------
// Email rubric — authoring + end-to-end grade
// ---------------------------------------------------------------------------

describe("email topic — authoring surfaces promptKind", () => {
  it("an admin can author an email topic and it reads back promptKind=email", async () => {
    const { token, userId } = await registerAndLogin();
    const { UserModel } = await import("../src/models/user.model.js");
    await UserModel.updateOne({ _id: userId }, { $set: { role: "admin" } });
    const relog = await request(app)
      .post("/api/auth/login")
      .send({ identifier: `comm${counter}`, password: "Password123" });
    const adminTok = relog.body.accessToken as string;

    const res = await request(app)
      .post("/api/admin/essay-topics")
      .set(auth(adminTok))
      .send({ title: "Scenario email", promptKind: "email" });
    expect(res.status).toBe(201);
    expect(res.body.promptKind).toBe("email");

    // Default (omitted) is essay — existing authoring is unchanged.
    const def = await request(app)
      .post("/api/admin/essay-topics")
      .set(auth(adminTok))
      .send({ title: "Plain essay" });
    expect(def.body.promptKind).toBe("essay");
    // avoid unused var lint
    expect(token).toBeTruthy();
  });
});

describe("email topic — grades end to end", () => {
  it("submit → grade → poll returns the 8 email dimensions (not the essay 7)", async () => {
    const { essayTopicId, subjectId } = await makeTopic("email");
    const { token, userId } = await registerAndLogin();
    await enroll(userId, subjectId);

    const list = await request(app).get("/api/essays").set(auth(token));
    expect(list.body.items[0].promptKind).toBe("email");

    const submit = await request(app)
      .post(`/api/essays/${essayTopicId}/submit`)
      .set(auth(token))
      .send({ content: GOOD_EMAIL });
    expect(submit.status).toBe(202);
    const total = await completeEmailGrade(submit.body.jobId);

    const poll = await request(app)
      .get(`/api/essays/submissions/${submit.body.jobId}`)
      .set(auth(token));
    expect(poll.status).toBe(200);
    expect(poll.body.total).toBeCloseTo(total, 5);
    // Email breakdown present; the essay `dimensions` field is null.
    expect(poll.body.dimensions).toBeNull();
    expect(poll.body.emailDimensions).not.toBeNull();
    expect(Object.keys(poll.body.emailDimensions).sort()).toEqual(
      [
        "content",
        "format",
        "grammar",
        "punctuation",
        "readability",
        "register",
        "spelling",
        "tone",
      ].sort(),
    );
  });
});

describe("essay topic — byte-identically unaffected", () => {
  it("an essay grade poll still returns the 7 dims and NO emailDimensions key", async () => {
    const { essayTopicId, subjectId } = await makeTopic("essay");
    const { token, userId } = await registerAndLogin();
    await enroll(userId, subjectId);

    const submit = await request(app)
      .post(`/api/essays/${essayTopicId}/submit`)
      .set(auth(token))
      .send({ content: LONG_ESSAY });
    const total = await completeEssayGrade(submit.body.jobId);

    const poll = await request(app)
      .get(`/api/essays/submissions/${submit.body.jobId}`)
      .set(auth(token));
    expect(poll.body.total).toBeCloseTo(total, 5);
    expect(Object.keys(poll.body.dimensions).sort()).toEqual(
      [
        "grammar",
        "punctuation",
        "readability",
        "relevance",
        "spelling",
        "structure",
        "vocabulary",
      ].sort(),
    );
    // The additive email field never appears on an essay response.
    expect(poll.body).not.toHaveProperty("emailDimensions");
  });
});

describe("access gate — reused from essays, not reinvented", () => {
  it("an email topic obeys the SAME enrollment gate (404 when not enrolled)", async () => {
    const { essayTopicId } = await makeTopic("email");
    const { token } = await registerAndLogin(); // NOT enrolled
    const res = await request(app)
      .post(`/api/essays/${essayTopicId}/submit`)
      .set(auth(token))
      .send({ content: GOOD_EMAIL });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ESSAY_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// Grammar — the 34-question paper on the existing exam engine (no new engine)
// ---------------------------------------------------------------------------

const GRAMMAR_CATEGORIES: [string, number][] = [
  ["Verb Form", 8],
  ["Tense", 8],
  ["Articles", 6],
  ["Prepositions", 6],
  ["Active/Passive Voice", 6],
];

describe("grammar paper — takeable end to end on the exam engine", () => {
  it("34 MCQs across 5 category sections score with per-category subtotals", async () => {
    const { token, userId } = await registerAndLogin();
    const subject = await SubjectModel.create({
      name: "Grammar",
      slug: `g-${uniq()}`,
      price: 0,
    });
    const mod = await ModuleModel.create({ subject: subject._id, name: "G" });
    const topic = await TopicModel.create({
      module: mod._id,
      name: "Grammar Paper",
      topicType: TopicType.EXAM,
    });
    const exam = await ExamModel.create({
      topic: topic._id,
      title: "Section C — Grammar",
      passPercentage: 40,
    });

    let totalQuestions = 0;
    const answers: Record<string, { section: string; qs: string[] }> = {};
    for (let i = 0; i < GRAMMAR_CATEGORIES.length; i++) {
      const [name, count] = GRAMMAR_CATEGORIES[i]!;
      const section = await ExamSectionModel.create({
        exam: exam._id,
        name,
        order: i,
        durationMinutes: 15,
      });
      const qids: string[] = [];
      for (let q = 0; q < count; q++) {
        const doc = await ExamQuestionModel.create({
          exam: exam._id,
          section: section._id,
          questionType: ExamQuestionType.MCQ_SINGLE,
          text: `${name} Q${q + 1}: choose the correct option.`,
          order: q,
          marks: 1,
          options: ["wrong", "correct", "also wrong"],
          correctOptions: [1],
        });
        qids.push(doc._id.toString());
      }
      answers[section._id.toString()] = { section: name, qs: qids };
      totalQuestions += count;
    }
    expect(totalQuestions).toBe(34);
    await ExamModel.updateOne({ _id: exam._id }, { $set: { totalMarks: 34 } });
    await EnrollmentModel.create({ user: userId, subject: subject._id });

    // Take it: start on section 0, answer every question, advance, submit.
    const start = await request(app)
      .post(`/api/exams/${exam._id.toString()}/attempts`)
      .set(auth(token));
    expect(start.status).toBe(201);
    const attemptId = start.body.attemptId as string;
    expect(start.body.totalSections).toBe(5);

    const sectionIds = Object.keys(answers);
    for (let i = 0; i < sectionIds.length; i++) {
      const { qs } = answers[sectionIds[i]!]!;
      const save = await request(app)
        .post(`/api/attempts/${attemptId}/section/answers`)
        .set(auth(token))
        .send({
          answers: qs.map((questionId) => ({ questionId, selectedOptions: [1] })),
        });
      expect(save.status).toBe(200);
      if (i < sectionIds.length - 1) {
        await request(app)
          .post(`/api/attempts/${attemptId}/advance`)
          .set(auth(token));
      }
    }

    const submit = await request(app)
      .post(`/api/attempts/${attemptId}/submit`)
      .set(auth(token))
      .send({});
    expect(submit.status).toBe(200);
    // Every answer correct → full marks, and five per-category subtotals.
    expect(submit.body.score).toBe(34);
    expect(submit.body.sections).toHaveLength(5);
    for (const s of submit.body.sections) {
      expect(s.score).toBe(s.maxScore);
    }
    const names = submit.body.sections.map((s: { name: string }) => s.name).sort();
    expect(names).toEqual(GRAMMAR_CATEGORIES.map(([n]) => n).sort());
  });
});

// ---------------------------------------------------------------------------
// Comprehension — audio stimulus + honest play recording
// ---------------------------------------------------------------------------

describe("comprehension — audio stimulus surfaces + plays are recorded honestly", () => {
  it("exposes the section stimulus and counts every play (never silently blocks)", async () => {
    const { token, userId } = await registerAndLogin();
    const subject = await SubjectModel.create({
      name: "Listening",
      slug: `l-${uniq()}`,
      price: 0,
    });
    const mod = await ModuleModel.create({ subject: subject._id, name: "L" });
    const topic = await TopicModel.create({
      module: mod._id,
      name: "Comprehension",
      topicType: TopicType.EXAM,
    });
    const exam = await ExamModel.create({
      topic: topic._id,
      title: "Section D — Comprehension",
      passPercentage: 40,
      totalMarks: 5,
    });
    const section = await ExamSectionModel.create({
      exam: exam._id,
      name: "Passage 1",
      order: 0,
      durationMinutes: 10,
      stimulusAudioUrl: "https://res.cloudinary.com/demo/video/upload/passage.mp3",
      stimulusPlayLimit: 1,
    });
    await ExamQuestionModel.create({
      exam: exam._id,
      section: section._id,
      questionType: ExamQuestionType.MCQ_SINGLE,
      text: "What did the speaker recommend?",
      order: 0,
      marks: 5,
      options: ["A", "B", "C"],
      correctOptions: [0],
    });
    await EnrollmentModel.create({ user: userId, subject: subject._id });

    const start = await request(app)
      .post(`/api/exams/${exam._id.toString()}/attempts`)
      .set(auth(token));
    const attemptId = start.body.attemptId as string;
    expect(start.body.section.stimulusAudioUrl).toContain("passage.mp3");
    expect(start.body.section.stimulusPlayLimit).toBe(1);
    expect(start.body.section.stimulusPlaysUsed).toBe(0);

    const sectionId = start.body.section.id as string;
    const play1 = await request(app)
      .post(`/api/attempts/${attemptId}/sections/${sectionId}/stimulus-play`)
      .set(auth(token));
    expect(play1.status).toBe(200);
    expect(play1.body.playsUsed).toBe(1);
    expect(play1.body.exhausted).toBe(true);

    // A second play past the limit is RECORDED (honest), not pretended-blocked.
    const play2 = await request(app)
      .post(`/api/attempts/${attemptId}/sections/${sectionId}/stimulus-play`)
      .set(auth(token));
    expect(play2.body.playsUsed).toBe(2);
    expect(play2.body.exhausted).toBe(true);

    // The recorded count is reflected back on the section view.
    const view = await request(app)
      .get(`/api/attempts/${attemptId}/section`)
      .set(auth(token));
    expect(view.body.section.stimulusPlaysUsed).toBe(2);
  });
});
