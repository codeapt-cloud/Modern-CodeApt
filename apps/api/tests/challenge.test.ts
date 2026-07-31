/**
 * Daily-challenge API tests (supertest + in-memory Mongo). The BullMQ producer
 * is mocked; the worker is simulated by writing the ExecutionJob result
 * directly — no live Piston. Covers MCQ grading + no-double-score, CODE
 * finalize idempotency + solved logic, and leaderboard ordering + own rank.
 */
import {
  CodeLanguage,
  DailyQuestionType,
  JobStatus,
  istDayKey,
  istDayRangeUtc,
} from "@codeapt/shared";
import type { Express } from "express";
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
  DailyQuestionModel,
  DailyTestCaseModel,
  UserStreakModel,
} from "../src/models/challenge.model.js";
import { ExecutionJobModel } from "../src/models/execution.model.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

let counter = 0;
async function registerAndLogin(): Promise<{ token: string; userId: string }> {
  counter += 1;
  const u = `chal${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Player ${counter}`,
      rollNumber: `ROLL-${counter}`,
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

function releaseToday(): Date {
  return istDayRangeUtc(istDayKey(new Date())).start;
}

async function makeMcqToday() {
  return DailyQuestionModel.create({
    questionType: DailyQuestionType.MCQ,
    releaseDate: releaseToday(),
    title: "Complexity",
    description: "Pick one",
    options: ["O(n)", "O(log n)", "O(1)", "O(n^2)"],
    correctOption: 2,
    marks: 5,
  });
}

async function makeCodeToday() {
  const q = await DailyQuestionModel.create({
    questionType: DailyQuestionType.CODE,
    releaseDate: releaseToday(),
    title: "Greet",
    description: "Print Hello, <name>!",
    starterCode: "print('hi')",
    language: CodeLanguage.PYTHON,
    marks: 10,
  });
  await DailyTestCaseModel.create([
    {
      question: q._id,
      inputData: "Ada",
      expectedOutput: "Hello, Ada!",
      isHidden: false,
    },
    {
      question: q._id,
      inputData: "Grace",
      expectedOutput: "Hello, Grace!",
      isHidden: true,
    },
  ]);
  return q;
}

/** Simulate the worker finishing a job. */
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

describe("GET /api/challenges/today", () => {
  it("returns the MCQ without leaking correctOption", async () => {
    await makeMcqToday();
    const { token } = await registerAndLogin();
    const res = await request(app)
      .get("/api/challenges/today")
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.questionType).toBe("MCQ");
    expect(res.body.options).toHaveLength(4);
    expect(res.body).not.toHaveProperty("correctOption");
    expect(res.body.streak.solvedToday).toBe(false);
  });

  it("returns CODE with sample cases only (no hidden cases)", async () => {
    await makeCodeToday();
    const { token } = await registerAndLogin();
    const res = await request(app)
      .get("/api/challenges/today")
      .set(auth(token));
    expect(res.body.questionType).toBe("CODE");
    expect(res.body.sampleCases).toHaveLength(1); // only the visible one
    expect(res.body.sampleCases[0].input).toBe("Ada");
    expect(res.body.starterCode).toContain("print");
  });

  it("empty state when no challenge is released", async () => {
    const { token } = await registerAndLogin();
    const res = await request(app)
      .get("/api/challenges/today")
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.streak.currentStreak).toBe(0);
  });
});

describe("POST submit-mcq", () => {
  it("awards points + advances streak on a correct answer", async () => {
    await makeMcqToday();
    const { token } = await registerAndLogin();
    const res = await request(app)
      .post("/api/challenges/today/submit-mcq")
      .set(auth(token))
      .send({ option: 2 });
    expect(res.status).toBe(200);
    expect(res.body.correct).toBe(true);
    expect(res.body.correctOption).toBe(2);
    expect(res.body.awardedPoints).toBe(5);
    expect(res.body.streak.currentStreak).toBe(1);
    expect(res.body.streak.totalScore).toBe(5);
    expect(res.body.streak.solvedToday).toBe(true);
  });

  it("blocks a second submission (no double scoring)", async () => {
    await makeMcqToday();
    const { token } = await registerAndLogin();
    await request(app)
      .post("/api/challenges/today/submit-mcq")
      .set(auth(token))
      .send({ option: 2 });
    const again = await request(app)
      .post("/api/challenges/today/submit-mcq")
      .set(auth(token))
      .send({ option: 2 });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ALREADY_ATTEMPTED");
  });

  it("records a wrong answer without awarding a streak", async () => {
    await makeMcqToday();
    const { token } = await registerAndLogin();
    const res = await request(app)
      .post("/api/challenges/today/submit-mcq")
      .set(auth(token))
      .send({ option: 0 });
    expect(res.body.correct).toBe(false);
    expect(res.body.awardedPoints).toBe(0);
    expect(res.body.streak.currentStreak).toBe(0);
    expect(res.body.streak.attemptedToday).toBe(true);
    expect(res.body.streak.solvedToday).toBe(false);
  });
});

describe("CODE submit + finalize", () => {
  it("solves on all-pass and is idempotent (no double award)", async () => {
    await makeCodeToday();
    const { token } = await registerAndLogin();
    const submit = await request(app)
      .post("/api/challenges/today/submit-code")
      .set(auth(token))
      .send({ language: "python", source: "print('x')" });
    expect(submit.status).toBe(202);
    const { jobId } = submit.body;

    await completeJob(jobId, 2, 2);

    const fin1 = await request(app)
      .post(`/api/challenges/submissions/${jobId}/finalize`)
      .set(auth(token));
    expect(fin1.status).toBe(200);
    expect(fin1.body.solved).toBe(true);
    expect(fin1.body.awarded).toBe(true);
    expect(fin1.body.awardedPoints).toBe(10);
    expect(fin1.body.streak.currentStreak).toBe(1);
    expect(fin1.body.streak.totalScore).toBe(10);

    // Re-finalize must not double-award.
    const fin2 = await request(app)
      .post(`/api/challenges/submissions/${jobId}/finalize`)
      .set(auth(token));
    expect(fin2.body.awarded).toBe(true);
    expect(fin2.body.streak.totalScore).toBe(10);
  });

  it("does not solve (or award) when not all cases pass", async () => {
    await makeCodeToday();
    const { token } = await registerAndLogin();
    const submit = await request(app)
      .post("/api/challenges/today/submit-code")
      .set(auth(token))
      .send({ language: "python", source: "print('x')" });
    await completeJob(submit.body.jobId, 1, 2);

    const fin = await request(app)
      .post(`/api/challenges/submissions/${submit.body.jobId}/finalize`)
      .set(auth(token));
    expect(fin.body.solved).toBe(false);
    expect(fin.body.awarded).toBe(false);
    expect(fin.body.graded).toEqual({ passedCount: 1, totalCount: 2 });
  });

  it("forbids finalizing another user's job", async () => {
    await makeCodeToday();
    const owner = await registerAndLogin();
    const other = await registerAndLogin();
    const submit = await request(app)
      .post("/api/challenges/today/submit-code")
      .set(auth(owner.token))
      .send({ language: "python", source: "print('x')" });
    await completeJob(submit.body.jobId, 2, 2);

    const res = await request(app)
      .post(`/api/challenges/submissions/${submit.body.jobId}/finalize`)
      .set(auth(other.token));
    expect(res.status).toBe(404);
  });
});

describe("GET leaderboard", () => {
  it("orders by score desc then streak desc and includes own rank", async () => {
    // Three competitors.
    await UserStreakModel.create([
      {
        user: new Types.ObjectId(),
        totalScore: 100,
        currentStreak: 5,
        maxStreak: 5,
      },
      {
        user: new Types.ObjectId(),
        totalScore: 100,
        currentStreak: 9,
        maxStreak: 9,
      },
      {
        user: new Types.ObjectId(),
        totalScore: 40,
        currentStreak: 2,
        maxStreak: 2,
      },
    ]);
    // Caller earns 5 via a correct MCQ.
    await makeMcqToday();
    const { token, userId } = await registerAndLogin();
    await request(app)
      .post("/api/challenges/today/submit-mcq")
      .set(auth(token))
      .send({ option: 2 });

    const res = await request(app)
      .get("/api/challenges/leaderboard")
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
    // Tie at 100 broken by streak desc → 9 before 5.
    expect(res.body.rows[0].totalScore).toBe(100);
    expect(res.body.rows[0].currentStreak).toBe(9);
    expect(res.body.rows[1].currentStreak).toBe(5);
    expect(res.body.rows[2].totalScore).toBe(40);
    expect(res.body.rows[3].totalScore).toBe(5);
    // Caller is last and flagged.
    expect(res.body.me.userId).toBe(userId);
    expect(res.body.me.rank).toBe(4);
    expect(res.body.me.isCurrentUser).toBe(true);
  });
});
