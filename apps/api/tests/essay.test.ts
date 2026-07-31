/**
 * Essay API tests (supertest + in-memory Mongo). The BullMQ producer is mocked;
 * the worker is simulated by writing the grade onto the EssayAttempt directly.
 * Covers: student projections omit reference keywords, browse via enrollment,
 * submit → job (fast) with length validation, grading-status poll for BOTH
 * ai_hybrid and deterministic_fallback shapes, poll idempotency, and ownership.
 */
import {
  EssayScoreSource,
  EssayStatus,
  JobStatus,
  coerceEssayAiFeedback,
  registerLlmRouter,
} from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import request from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/execution-queue.js", () => ({
  enqueueCodeJob: vi.fn(async () => undefined),
  enqueueEssayGradingJob: vi.fn(async () => undefined),
  closeQueues: vi.fn(async () => undefined),
  knownQueues: [],
  ESSAY_GRADING_JOB_NAME: "grade-essay",
}));

import { createApp } from "../src/app.js";
import { encryptSecret } from "../src/lib/crypto.js";
import { installLlmGateway } from "../src/lib/llm-gateway/index.js";
import { enqueueEssayGradingJob } from "../src/lib/execution-queue.js";
import {
  AiProviderKeyModel,
  AiProviderModel,
} from "../src/models/ai-provider.model.js";
import {
  EnrollmentModel,
  ModuleModel,
  ProgramModel,
  SubjectModel,
  TopicModel,
} from "../src/models/curriculum.model.js";
import {
  EssayAnalyticsModel,
  EssayAttemptModel,
  EssayDraftModel,
  EssayTopicModel,
} from "../src/models/essay.model.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

let counter = 0;
async function registerAndLogin(): Promise<{ token: string; userId: string }> {
  counter += 1;
  const u = `essay${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Writer ${counter}`,
      rollNumber: `ROLL-E-${counter}`,
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

const KEYWORDS = ["technology", "education", "students", "learning"];

/** Create the essay-topic curriculum tree; returns ids for enrollment + access. */
async function makeEssayTopic(
  opts: { maxAttempts?: number } = {},
): Promise<{
  essayTopicId: string;
  subjectId: Types.ObjectId;
}> {
  const program = await ProgramModel.create({
    name: "Comm",
    slug: `comm-${counter}-${Math.round(performance.now())}`,
  });
  const subject = await SubjectModel.create({
    name: "Writing",
    slug: `writing-${counter}-${Math.round(performance.now())}`,
    program: program._id,
    price: 0,
  });
  const mod = await ModuleModel.create({
    subject: subject._id,
    name: "Prompts",
  });
  const essayTopic = await EssayTopicModel.create({
    title: "Technology in Education",
    description: "Discuss technology's impact on education.",
    instructions: "Write at least 20 words.",
    difficultyLevel: 2,
    minWords: 20,
    maxWords: 400,
    maxAttempts: opts.maxAttempts ?? 3,
    semanticKeywords: KEYWORDS,
    isActive: true,
  });
  await TopicModel.create({
    module: mod._id,
    name: "Tech Essay",
    topicType: "essay",
    essayTopic: essayTopic._id,
  });
  return { essayTopicId: essayTopic._id.toString(), subjectId: subject._id };
}

async function enroll(userId: string, subjectId: Types.ObjectId) {
  await EnrollmentModel.create({
    user: new Types.ObjectId(userId),
    subject: subjectId,
  });
}

const LONG_ESSAY =
  "Technology has transformed education in profound ways. Students now enjoy " +
  "broad access to digital learning resources, and teachers can personalize " +
  "instruction. Consequently, classrooms have become more interactive and " +
  "engaging for learners everywhere.";

/** Simulate the worker finalizing a grade onto the attempt. */
async function completeGrade(
  jobId: string,
  source: EssayScoreSource,
  finalScore = 72.5,
) {
  await EssayAttemptModel.updateOne(
    { gradingJobId: jobId },
    {
      $set: {
        subScores: {
          grammar: 90,
          spelling: 100,
          punctuation: 80,
          readability: 60,
          vocabulary: 75,
          structure: 70,
          relevance: 65,
        },
        finalScore,
        scoreSource: source,
        feedback: "Nicely done.",
        gradingStatus: JobStatus.COMPLETED,
        status: EssayStatus.GRADED,
        gradedAt: new Date(),
      },
    },
  );
}

describe("GET /api/essays", () => {
  it("lists enrolled prompts WITHOUT leaking reference keywords", async () => {
    const { essayTopicId, subjectId } = await makeEssayTopic();
    const { token, userId } = await registerAndLogin();
    await enroll(userId, subjectId);

    const res = await request(app).get("/api/essays").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    const item = res.body.items[0];
    expect(item.id).toBe(essayTopicId);
    expect(item.title).toBe("Technology in Education");
    expect(item.minWords).toBe(20);
    // Student projection must NOT contain reference keywords / rubric.
    expect(item).not.toHaveProperty("semanticKeywords");
    expect(item).not.toHaveProperty("referenceKeywords");
    // Reference-only keywords (absent from the title/description) never leak.
    expect(JSON.stringify(item)).not.toContain("students");
    expect(JSON.stringify(item)).not.toContain("learning");
  });

  it("is empty for a user with no enrollment", async () => {
    await makeEssayTopic();
    const { token } = await registerAndLogin();
    const res = await request(app).get("/api/essays").set(auth(token));
    expect(res.body.items).toHaveLength(0);
  });
});

describe("GET /api/essays/:id", () => {
  it("returns detail with instructions but no reference keywords", async () => {
    const { essayTopicId, subjectId } = await makeEssayTopic();
    const { token, userId } = await registerAndLogin();
    await enroll(userId, subjectId);

    const res = await request(app)
      .get(`/api/essays/${essayTopicId}`)
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.instructions).toContain("20 words");
    expect(res.body).not.toHaveProperty("semanticKeywords");
    expect(res.body).not.toHaveProperty("referenceKeywords");
  });

  it("404s a prompt the user is not enrolled for", async () => {
    const { essayTopicId } = await makeEssayTopic();
    const { token } = await registerAndLogin();
    const res = await request(app)
      .get(`/api/essays/${essayTopicId}`)
      .set(auth(token));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ESSAY_NOT_FOUND");
  });
});

describe("POST /api/essays/:id/submit", () => {
  it("rejects an essay shorter than the prompt minimum", async () => {
    const { essayTopicId, subjectId } = await makeEssayTopic();
    const { token, userId } = await registerAndLogin();
    await enroll(userId, subjectId);

    const res = await request(app)
      .post(`/api/essays/${essayTopicId}/submit`)
      .set(auth(token))
      .send({ content: "too short" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("LENGTH_OUT_OF_RANGE");
  });

  it("accepts a valid essay and returns a queued job fast", async () => {
    const { essayTopicId, subjectId } = await makeEssayTopic();
    const { token, userId } = await registerAndLogin();
    await enroll(userId, subjectId);

    const enqueueMock = vi.mocked(enqueueEssayGradingJob);
    enqueueMock.mockClear();

    const res = await request(app)
      .post(`/api/essays/${essayTopicId}/submit`)
      .set(auth(token))
      .send({ content: LONG_ESSAY });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe(JobStatus.QUEUED);
    expect(typeof res.body.jobId).toBe("string");

    // Individual essays (no college) are ungated → AI grading permitted.
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock.mock.calls[0]![0]).toMatchObject({ aiEnabled: true });

    // Poll before the worker runs → still pending, no scores leaked.
    const pending = await request(app)
      .get(`/api/essays/submissions/${res.body.jobId}`)
      .set(auth(token));
    expect(pending.body.gradingPending).toBe(true);
    expect(pending.body.total).toBeNull();
    expect(pending.body.dimensions).toBeNull();
  });
});

describe("per-topic attempt cap", () => {
  it("surfaces maxAttempts + attemptsUsed on list and detail", async () => {
    const { essayTopicId, subjectId } = await makeEssayTopic({ maxAttempts: 2 });
    const { token, userId } = await registerAndLogin();
    await enroll(userId, subjectId);

    const list = await request(app).get("/api/essays").set(auth(token));
    expect(list.body.items[0].maxAttempts).toBe(2);
    expect(list.body.items[0].attemptsUsed).toBe(0);

    const detail = await request(app)
      .get(`/api/essays/${essayTopicId}`)
      .set(auth(token));
    expect(detail.body.maxAttempts).toBe(2);
    expect(detail.body.attemptsUsed).toBe(0);
  });

  it("allows submissions below the cap and increments attemptsUsed", async () => {
    const { essayTopicId, subjectId } = await makeEssayTopic({ maxAttempts: 2 });
    const { token, userId } = await registerAndLogin();
    await enroll(userId, subjectId);

    const first = await request(app)
      .post(`/api/essays/${essayTopicId}/submit`)
      .set(auth(token))
      .send({ content: LONG_ESSAY });
    expect(first.status).toBe(202);

    const detail = await request(app)
      .get(`/api/essays/${essayTopicId}`)
      .set(auth(token));
    expect(detail.body.attemptsUsed).toBe(1);
  });

  it("rejects a submission once the cap is reached (409)", async () => {
    const { essayTopicId, subjectId } = await makeEssayTopic({ maxAttempts: 2 });
    const { token, userId } = await registerAndLogin();
    await enroll(userId, subjectId);

    await request(app)
      .post(`/api/essays/${essayTopicId}/submit`)
      .set(auth(token))
      .send({ content: LONG_ESSAY });
    await request(app)
      .post(`/api/essays/${essayTopicId}/submit`)
      .set(auth(token))
      .send({ content: LONG_ESSAY });

    // Third submission — over the cap of 2.
    const third = await request(app)
      .post(`/api/essays/${essayTopicId}/submit`)
      .set(auth(token))
      .send({ content: LONG_ESSAY });
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe("ATTEMPT_LIMIT_REACHED");

    // No extra attempt was created.
    const count = await EssayAttemptModel.countDocuments({
      user: new Types.ObjectId(userId),
    });
    expect(count).toBe(2);
  });

  it("defaults the cap to 3 when a topic sets none", async () => {
    // Build a topic WITHOUT specifying maxAttempts → schema default applies.
    const program = await ProgramModel.create({
      name: "D",
      slug: `d-${counter}-${Math.round(performance.now())}`,
    });
    const subject = await SubjectModel.create({
      name: "DW",
      slug: `dw-${counter}-${Math.round(performance.now())}`,
      program: program._id,
      price: 0,
    });
    const mod = await ModuleModel.create({ subject: subject._id, name: "M" });
    const topic = await EssayTopicModel.create({
      title: "Default cap",
      minWords: 20,
      maxWords: 400,
      isActive: true,
    });
    await TopicModel.create({
      module: mod._id,
      name: "T",
      topicType: "essay",
      essayTopic: topic._id,
    });
    const { token, userId } = await registerAndLogin();
    await enroll(userId, subject._id);

    const detail = await request(app)
      .get(`/api/essays/${topic._id.toString()}`)
      .set(auth(token));
    expect(detail.body.maxAttempts).toBe(3);
  });
});

describe("grading result shapes", () => {
  it("reports the ai_hybrid shape once graded (idempotent poll)", async () => {
    const { essayTopicId, subjectId } = await makeEssayTopic();
    const { token, userId } = await registerAndLogin();
    await enroll(userId, subjectId);
    const submit = await request(app)
      .post(`/api/essays/${essayTopicId}/submit`)
      .set(auth(token))
      .send({ content: LONG_ESSAY });
    const { jobId } = submit.body;

    await completeGrade(jobId, EssayScoreSource.AI_HYBRID, 80.25);

    const r1 = await request(app)
      .get(`/api/essays/submissions/${jobId}`)
      .set(auth(token));
    expect(r1.status).toBe(200);
    expect(r1.body.status).toBe("completed");
    expect(r1.body.gradingPending).toBe(false);
    expect(r1.body.source).toBe("ai_hybrid");
    expect(r1.body.total).toBe(80.25);
    expect(r1.body.dimensions.vocabulary).toBe(75);
    expect(r1.body.feedback).toBe("Nicely done.");

    // Re-poll is idempotent — identical result.
    const r2 = await request(app)
      .get(`/api/essays/submissions/${jobId}`)
      .set(auth(token));
    expect(r2.body).toEqual(r1.body);
  });

  it("reports the deterministic_fallback shape", async () => {
    const { essayTopicId, subjectId } = await makeEssayTopic();
    const { token, userId } = await registerAndLogin();
    await enroll(userId, subjectId);
    const submit = await request(app)
      .post(`/api/essays/${essayTopicId}/submit`)
      .set(auth(token))
      .send({ content: LONG_ESSAY });

    await completeGrade(
      submit.body.jobId,
      EssayScoreSource.DETERMINISTIC_FALLBACK,
      55,
    );

    const res = await request(app)
      .get(`/api/essays/submissions/${submit.body.jobId}`)
      .set(auth(token));
    expect(res.body.source).toBe("deterministic_fallback");
    expect(res.body.total).toBe(55);
  });

  it("forbids polling another user's submission", async () => {
    const { essayTopicId, subjectId } = await makeEssayTopic();
    const owner = await registerAndLogin();
    await enroll(owner.userId, subjectId);
    const submit = await request(app)
      .post(`/api/essays/${essayTopicId}/submit`)
      .set(auth(owner.token))
      .send({ content: LONG_ESSAY });

    const other = await registerAndLogin();
    const res = await request(app)
      .get(`/api/essays/submissions/${submit.body.jobId}`)
      .set(auth(other.token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NOT_AUTHORIZED");
  });
});

describe("GET /api/essays/:id/submissions", () => {
  it("returns attempt history newest-first with resubmission", async () => {
    const { essayTopicId, subjectId } = await makeEssayTopic();
    const { token, userId } = await registerAndLogin();
    await enroll(userId, subjectId);

    const first = await request(app)
      .post(`/api/essays/${essayTopicId}/submit`)
      .set(auth(token))
      .send({ content: LONG_ESSAY });
    await completeGrade(first.body.jobId, EssayScoreSource.AI_HYBRID, 70);

    // Resubmission allowed → second attempt.
    await request(app)
      .post(`/api/essays/${essayTopicId}/submit`)
      .set(auth(token))
      .send({ content: LONG_ESSAY + " Additionally, access keeps expanding." });

    const res = await request(app)
      .get(`/api/essays/${essayTopicId}/submissions`)
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    // Newest first.
    expect(res.body.items[0].attemptNumber).toBe(2);
    expect(res.body.items[1].attemptNumber).toBe(1);
    expect(res.body.items[1].finalScore).toBe(70);
  });
});

describe("essay draft autosave + recovery (PUT/GET /api/essays/:id/draft)", () => {
  it("saves a snapshot and recovers the latest content", async () => {
    const { essayTopicId, subjectId } = await makeEssayTopic();
    const { token, userId } = await registerAndLogin();
    await enroll(userId, subjectId);

    const save = await request(app)
      .put(`/api/essays/${essayTopicId}/draft`)
      .set(auth(token))
      .send({ content: "My rough first pass on technology." });
    expect(save.status).toBe(200);
    expect(typeof save.body.savedAt).toBe("string");
    expect(save.body.wordCount).toBe(6); // server recomputes the count

    const recover = await request(app)
      .get(`/api/essays/${essayTopicId}/draft`)
      .set(auth(token));
    expect(recover.status).toBe(200);
    expect(recover.body.draft.content).toBe(
      "My rough first pass on technology.",
    );
    expect(recover.body.draft.wordCount).toBe(6);

    // Autosaving does NOT create/consume an attempt.
    const attempts = await EssayAttemptModel.countDocuments({
      user: new Types.ObjectId(userId),
    });
    expect(attempts).toBe(0);
  });

  it("returns null when there is no draft to recover", async () => {
    const { essayTopicId, subjectId } = await makeEssayTopic();
    const { token, userId } = await registerAndLogin();
    await enroll(userId, subjectId);

    const res = await request(app)
      .get(`/api/essays/${essayTopicId}/draft`)
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.draft).toBeNull();
  });

  it("caps retained snapshots at the latest 10 per (user, topic)", async () => {
    const { essayTopicId, subjectId } = await makeEssayTopic();
    const { token, userId } = await registerAndLogin();
    await enroll(userId, subjectId);

    for (let i = 1; i <= 13; i += 1) {
      await request(app)
        .put(`/api/essays/${essayTopicId}/draft`)
        .set(auth(token))
        .send({ content: `draft revision number ${i}` });
    }

    const count = await EssayDraftModel.countDocuments({
      user: new Types.ObjectId(userId),
    });
    expect(count).toBe(10); // older snapshots pruned

    // The most recent revision is what recovery returns.
    const recover = await request(app)
      .get(`/api/essays/${essayTopicId}/draft`)
      .set(auth(token));
    expect(recover.body.draft.content).toBe("draft revision number 13");
  });

  it("suppresses recovery once the student submits after the draft", async () => {
    const { essayTopicId, subjectId } = await makeEssayTopic();
    const { token, userId } = await registerAndLogin();
    await enroll(userId, subjectId);

    await request(app)
      .put(`/api/essays/${essayTopicId}/draft`)
      .set(auth(token))
      .send({ content: "half-written thoughts" });

    // Submitting commits the essay; the pre-submit draft must not resurface.
    await request(app)
      .post(`/api/essays/${essayTopicId}/submit`)
      .set(auth(token))
      .send({ content: LONG_ESSAY });

    const stale = await request(app)
      .get(`/api/essays/${essayTopicId}/draft`)
      .set(auth(token));
    expect(stale.body.draft).toBeNull();

    // A NEW draft started afterwards ("write another") IS recoverable again.
    await request(app)
      .put(`/api/essays/${essayTopicId}/draft`)
      .set(auth(token))
      .send({ content: "starting a fresh revision" });
    const fresh = await request(app)
      .get(`/api/essays/${essayTopicId}/draft`)
      .set(auth(token));
    expect(fresh.body.draft.content).toBe("starting a fresh revision");
  });

  it("404s saving a draft to a prompt the user cannot access", async () => {
    const { essayTopicId } = await makeEssayTopic();
    const { token } = await registerAndLogin(); // not enrolled
    const res = await request(app)
      .put(`/api/essays/${essayTopicId}/draft`)
      .set(auth(token))
      .send({ content: "should be rejected" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ESSAY_NOT_FOUND");
  });

  it("keeps drafts private per user", async () => {
    const { essayTopicId, subjectId } = await makeEssayTopic();
    const owner = await registerAndLogin();
    await enroll(owner.userId, subjectId);
    await request(app)
      .put(`/api/essays/${essayTopicId}/draft`)
      .set(auth(owner.token))
      .send({ content: "owner's private draft" });

    const other = await registerAndLogin();
    await enroll(other.userId, subjectId);
    const res = await request(app)
      .get(`/api/essays/${essayTopicId}/draft`)
      .set(auth(other.token));
    // Another enrolled user sees only their own (absent) draft.
    expect(res.body.draft).toBeNull();
  });
});

describe("POST /api/essays/submissions/:jobId/analytics (additive, optional)", () => {
  const ANALYTICS = {
    keystrokes: 320,
    deletes: 24,
    pasteCount: 1,
    pastedChars: 15,
    composeSeconds: 240,
    wordCount: 42,
    characterCount: 265,
  };

  it("persists analytics (204) without changing the grade", async () => {
    const { essayTopicId, subjectId } = await makeEssayTopic();
    const { token, userId } = await registerAndLogin();
    await enroll(userId, subjectId);
    const submit = await request(app)
      .post(`/api/essays/${essayTopicId}/submit`)
      .set(auth(token))
      .send({ content: LONG_ESSAY });
    const { jobId } = submit.body;

    // Worker finishes grading.
    await completeGrade(jobId, EssayScoreSource.AI_HYBRID, 77.5);
    const before = await request(app)
      .get(`/api/essays/submissions/${jobId}`)
      .set(auth(token));

    // Post analytics AFTER grading — must not alter anything about the grade.
    const res = await request(app)
      .post(`/api/essays/submissions/${jobId}/analytics`)
      .set(auth(token))
      .send(ANALYTICS);
    expect(res.status).toBe(204);

    const after = await request(app)
      .get(`/api/essays/submissions/${jobId}`)
      .set(auth(token));
    expect(after.body).toEqual(before.body); // grade is byte-for-byte identical

    // The analytics sidecar was written (1-to-1 with the attempt).
    const analytics = await EssayAnalyticsModel.findOne({
      attempt: new Types.ObjectId(before.body.submissionId as string),
    });
    expect(analytics).not.toBeNull();
    expect(analytics?.typingEvents).toBe(320);
    expect(analytics?.pasteEvents).toBe(1);
    expect(analytics?.pastedChars).toBe(15);
    expect(analytics?.composeSeconds).toBe(240);
  });

  it("is fully optional — a submission grades identically with no analytics", async () => {
    const { essayTopicId, subjectId } = await makeEssayTopic();
    const { token, userId } = await registerAndLogin();
    await enroll(userId, subjectId);
    const submit = await request(app)
      .post(`/api/essays/${essayTopicId}/submit`)
      .set(auth(token))
      .send({ content: LONG_ESSAY });
    await completeGrade(submit.body.jobId, EssayScoreSource.AI_HYBRID, 77.5);

    const res = await request(app)
      .get(`/api/essays/submissions/${submit.body.jobId}`)
      .set(auth(token));
    expect(res.body.total).toBe(77.5); // identical grade, analytics never sent
    const analytics = await EssayAnalyticsModel.findOne({
      attempt: new Types.ObjectId(res.body.submissionId as string),
    });
    expect(analytics).toBeNull();
  });

  it("upserts (a second post replaces, staying 1-to-1)", async () => {
    const { essayTopicId, subjectId } = await makeEssayTopic();
    const { token, userId } = await registerAndLogin();
    await enroll(userId, subjectId);
    const submit = await request(app)
      .post(`/api/essays/${essayTopicId}/submit`)
      .set(auth(token))
      .send({ content: LONG_ESSAY });
    const { jobId, submissionId } = {
      jobId: submit.body.jobId as string,
      submissionId: (
        await request(app)
          .get(`/api/essays/submissions/${submit.body.jobId}`)
          .set(auth(token))
      ).body.submissionId as string,
    };

    await request(app)
      .post(`/api/essays/submissions/${jobId}/analytics`)
      .set(auth(token))
      .send(ANALYTICS);
    await request(app)
      .post(`/api/essays/submissions/${jobId}/analytics`)
      .set(auth(token))
      .send({ ...ANALYTICS, keystrokes: 999 });

    const docs = await EssayAnalyticsModel.find({
      attempt: new Types.ObjectId(submissionId),
    });
    expect(docs).toHaveLength(1);
    expect(docs[0]?.typingEvents).toBe(999);
  });

  it("computes + persists an advisory risk score on analytics submit (grade untouched)", async () => {
    const { essayTopicId, subjectId } = await makeEssayTopic();
    const { token, userId } = await registerAndLogin();
    await enroll(userId, subjectId);
    const submit = await request(app)
      .post(`/api/essays/${essayTopicId}/submit`)
      .set(auth(token))
      .send({ content: LONG_ESSAY });
    const { jobId } = submit.body;
    await completeGrade(jobId, EssayScoreSource.AI_HYBRID, 88);

    const before = await request(app)
      .get(`/api/essays/submissions/${jobId}`)
      .set(auth(token));

    // Paste-heavy, low-typing signals → high advisory risk.
    const res = await request(app)
      .post(`/api/essays/submissions/${jobId}/analytics`)
      .set(auth(token))
      .send({
        keystrokes: 3,
        deletes: 0,
        pasteCount: 5,
        pastedChars: 1200,
        composeSeconds: 20,
        wordCount: 220,
        characterCount: 1300,
      });
    expect(res.status).toBe(204);

    const analytics = await EssayAnalyticsModel.findOne({
      attempt: new Types.ObjectId(before.body.submissionId as string),
    });
    expect(analytics).not.toBeNull();
    expect(analytics?.riskScore).toBeGreaterThanOrEqual(80);
    expect(analytics?.riskLevel).toBe("high");
    expect(analytics?.suspiciousActivity).toBe(true);
    expect((analytics?.riskReasons?.length ?? 0)).toBeGreaterThan(0);

    // Advisory only — the grade is byte-for-byte unchanged.
    const after = await request(app)
      .get(`/api/essays/submissions/${jobId}`)
      .set(auth(token));
    expect(after.body).toEqual(before.body);
  });

  it("forbids posting analytics for another user's submission", async () => {
    const { essayTopicId, subjectId } = await makeEssayTopic();
    const owner = await registerAndLogin();
    await enroll(owner.userId, subjectId);
    const submit = await request(app)
      .post(`/api/essays/${essayTopicId}/submit`)
      .set(auth(owner.token))
      .send({ content: LONG_ESSAY });

    const other = await registerAndLogin();
    const res = await request(app)
      .post(`/api/essays/submissions/${submit.body.jobId}/analytics`)
      .set(auth(other.token))
      .send(ANALYTICS);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NOT_AUTHORIZED");
  });
});

describe("coerceEssayAiFeedback (defensive)", () => {
  it("clamps scores, trims lists, and keeps a usable response", () => {
    const fb = coerceEssayAiFeedback({
      scores: { vocabulary: 250, structure: -5, relevance: 80.6, overall: 70 },
      pros: ["  clear thesis  ", "", 42, "good flow"],
      cons: ["repetitive"],
      improvements: ["vary sentence length"],
      summary: "  Solid effort.  ",
    });
    expect(fb).not.toBeNull();
    expect(fb!.scores).toEqual({ vocabulary: 100, structure: 0, relevance: 81, overall: 70 });
    expect(fb!.pros).toEqual(["clear thesis", "good flow"]); // blanks/non-strings dropped
    expect(fb!.summary).toBe("Solid effort.");
  });
  it("returns null when there is nothing usable / not an object", () => {
    expect(coerceEssayAiFeedback({ scores: {}, pros: [], cons: [], improvements: [], summary: "" })).toBeNull();
    expect(coerceEssayAiFeedback("nope")).toBeNull();
    expect(coerceEssayAiFeedback(null)).toBeNull();
  });
});

describe("POST /api/essays/submissions/:jobId/ai-feedback", () => {
  afterEach(() => {
    registerLlmRouter(null);
    vi.unstubAllGlobals();
  });

  const aiFetch = (content: string) =>
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 20, completion_tokens: 40 },
      }),
      text: async () => "",
    }));

  async function submitAndGrade(): Promise<{ token: string; jobId: string }> {
    const { essayTopicId, subjectId } = await makeEssayTopic();
    const { token, userId } = await registerAndLogin();
    await enroll(userId, subjectId);
    const submit = await request(app)
      .post(`/api/essays/${essayTopicId}/submit`)
      .set(auth(token))
      .send({ content: LONG_ESSAY });
    await completeGrade(submit.body.jobId, EssayScoreSource.DETERMINISTIC_FALLBACK);
    return { token, jobId: submit.body.jobId as string };
  }

  it("returns AI scoring + pros/cons/improvements via the gateway", async () => {
    const { token, jobId } = await submitAndGrade();
    const provider = await AiProviderModel.create({
      name: "Essay FB Provider",
      kind: "openai_compat",
      baseUrl: "https://fb.test/v1",
      model: "m",
      enabled: true,
      priority: 10,
      capability: "capable",
    });
    await AiProviderKeyModel.create({
      provider: provider._id,
      keyCiphertext: encryptSecret("sk-fb"),
      enabled: true,
    });
    installLlmGateway();
    vi.stubGlobal(
      "fetch",
      aiFetch(
        JSON.stringify({
          scores: { vocabulary: 80, structure: 75, relevance: 70, overall: 76 },
          pros: ["Clear thesis", "Good use of examples"],
          cons: ["Some repetition"],
          improvements: ["Vary sentence openings", "Tighten the conclusion"],
          summary: "A solid, well-structured response.",
        }),
      ),
    );

    const res = await request(app)
      .post(`/api/essays/submissions/${jobId}/ai-feedback`)
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.feedback.pros).toContain("Clear thesis");
    expect(res.body.feedback.improvements.length).toBe(2);
    expect(res.body.feedback.scores.overall).toBe(76);
  });

  it("is graceful (configured:false) when AI isn't set up", async () => {
    const { token, jobId } = await submitAndGrade();
    // No gateway installed, no provider → not configured.
    const res = await request(app)
      .post(`/api/essays/submissions/${jobId}/ai-feedback`)
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false, feedback: null });
  });

  it("403s a non-owner", async () => {
    const { jobId } = await submitAndGrade();
    const other = await registerAndLogin();
    const res = await request(app)
      .post(`/api/essays/submissions/${jobId}/ai-feedback`)
      .set(auth(other.token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NOT_AUTHORIZED");
  });
});
