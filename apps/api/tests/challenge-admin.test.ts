/**
 * Daily-challenge admin CRUD + Excel bulk import (backlog item 3). supertest +
 * in-memory Mongo. Covers create (MCQ + CODE with test cases), validation,
 * update + reschedule, the single-create date conflict, the reference-safe
 * delete (BLOCK when scored submissions exist; else remove with owned children),
 * the bulk import (sequential + explicit-date happy paths), per-row errors +
 * a reported (not silently dropped) date conflict, and the admin guard.
 */
import {
  ChallengeErrorCode,
  DailyChallengeSource,
  registerLlmRouter,
} from "@codeapt/shared";
import ExcelJS from "exceljs";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

// The regenerate endpoint enqueues a worker job — mock the producer so no live
// Redis is needed (mirrors the other queue-touching suites).
vi.mock("../src/lib/execution-queue.js", () => ({
  enqueueCodeJob: vi.fn(async () => undefined),
  enqueueEssayGradingJob: vi.fn(async () => undefined),
  enqueueDailyChallengeJob: vi.fn(async () => undefined),
  closeQueues: vi.fn(async () => undefined),
  knownQueues: [],
  ESSAY_GRADING_JOB_NAME: "grade-essay",
}));

import { createApp } from "../src/app.js";
import { enqueueDailyChallengeJob } from "../src/lib/execution-queue.js";
import {
  DailyQuestionModel,
  DailySubmissionModel,
  DailyTestCaseModel,
} from "../src/models/challenge.model.js";

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
  const u = `cha${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Chal Adm ${counter}`,
      rollNumber: `CHA-${counter}`,
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
const adminToken = async (): Promise<string> =>
  (await registerAndLogin("admin")).token;

const createChallenge = (token: string, body: unknown) =>
  request(app).post("/api/admin/challenges").set(auth(token)).send(body);

/** Build a base64 .xlsx with a "Challenges" sheet from header + row arrays. */
async function workbookBase64(
  header: string[],
  rows: (string | number)[][],
): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Challenges");
  sheet.addRow(header);
  for (const r of rows) sheet.addRow(r);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf).toString("base64");
}

describe("challenge admin — CRUD + validation", () => {
  it("creates an MCQ and a CODE challenge (with test cases) and persists fields", async () => {
    const token = await adminToken();
    const mcq = await createChallenge(token, {
      questionType: "MCQ",
      releaseDate: "2099-01-05",
      title: "Complexity check",
      description: "Average-case hash lookup?",
      marks: 5,
      options: ["O(n)", "O(1)", "O(log n)"],
      correctOption: 1,
    });
    expect(mcq.status).toBe(201);
    expect(mcq.body.questionType).toBe("MCQ");
    expect(mcq.body.releaseDate).toBe("2099-01-05");
    expect(mcq.body.options).toEqual(["O(n)", "O(1)", "O(log n)"]);
    expect(mcq.body.correctOption).toBe(1);

    const code = await createChallenge(token, {
      questionType: "CODE",
      releaseDate: "2099-01-06",
      title: "Echo",
      starterCode: "print(input())",
      language: "python",
      testCases: [
        { input: "Ada", expectedOutput: "Ada", isHidden: false },
        { input: "Bo", expectedOutput: "Bo", isHidden: true },
      ],
    });
    expect(code.status).toBe(201);
    expect(code.body.testCases).toHaveLength(2);
    expect(code.body.testCases[1].isHidden).toBe(true);
    const id = code.body.id as string;
    expect(
      await DailyTestCaseModel.countDocuments({ question: id }),
    ).toBe(2);
  });

  it("rejects bad MCQ (too few options / correct out of range) and bad date", async () => {
    const token = await adminToken();
    const fewOptions = await createChallenge(token, {
      questionType: "MCQ",
      releaseDate: "2099-02-01",
      title: "Bad",
      options: ["only one"],
      correctOption: 0,
    });
    expect(fewOptions.status).toBe(400);

    const outOfRange = await createChallenge(token, {
      questionType: "MCQ",
      releaseDate: "2099-02-02",
      title: "Bad",
      options: ["a", "b"],
      correctOption: 5,
    });
    expect(outOfRange.status).toBe(400);

    const badDate = await createChallenge(token, {
      questionType: "MCQ",
      releaseDate: "05-01-2099",
      title: "Bad",
      options: ["a", "b"],
      correctOption: 0,
    });
    expect(badDate.status).toBe(400);
  });

  it("updates + reschedules a challenge", async () => {
    const token = await adminToken();
    const created = await createChallenge(token, {
      questionType: "MCQ",
      releaseDate: "2099-03-01",
      title: "Editable",
      options: ["a", "b"],
      correctOption: 0,
    });
    const id = created.body.id as string;
    const updated = await request(app)
      .patch(`/api/admin/challenges/${id}`)
      .set(auth(token))
      .send({
        questionType: "MCQ",
        releaseDate: "2099-03-09",
        title: "Edited",
        options: ["a", "b", "c"],
        correctOption: 2,
      });
    expect(updated.status).toBe(200);
    expect(updated.body.title).toBe("Edited");
    expect(updated.body.releaseDate).toBe("2099-03-09");
    expect(updated.body.correctOption).toBe(2);
  });

  it("rejects a second challenge on a taken date (DATE_TAKEN)", async () => {
    const token = await adminToken();
    const first = await createChallenge(token, {
      questionType: "MCQ",
      releaseDate: "2099-04-04",
      title: "First",
      options: ["a", "b"],
      correctOption: 0,
    });
    expect(first.status).toBe(201);
    const clash = await createChallenge(token, {
      questionType: "MCQ",
      releaseDate: "2099-04-04",
      title: "Second",
      options: ["a", "b"],
      correctOption: 0,
    });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe(ChallengeErrorCode.DATE_TAKEN);
  });
});

describe("challenge admin — reference-safe delete", () => {
  it("BLOCKS delete when a scored submission references the question", async () => {
    const { token, userId } = await registerAndLogin("admin");
    const created = await createChallenge(token, {
      questionType: "MCQ",
      releaseDate: "2099-05-05",
      title: "Attempted",
      options: ["a", "b"],
      correctOption: 0,
    });
    const id = created.body.id as string;
    await DailySubmissionModel.create({
      user: new Types.ObjectId(userId),
      question: id,
      isCorrect: true,
      score: 5,
    });
    const blocked = await request(app)
      .delete(`/api/admin/challenges/${id}`)
      .set(auth(token));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe(ChallengeErrorCode.DELETE_BLOCKED);
    expect(blocked.body.error.details.blockers.submissions).toBe(1);
  });

  it("deletes a challenge with no submissions and removes its test cases", async () => {
    const token = await adminToken();
    const created = await createChallenge(token, {
      questionType: "CODE",
      releaseDate: "2099-05-06",
      title: "Removable",
      starterCode: "x",
      language: "python",
      testCases: [{ input: "a", expectedOutput: "a", isHidden: false }],
    });
    const id = created.body.id as string;
    const del = await request(app)
      .delete(`/api/admin/challenges/${id}`)
      .set(auth(token));
    expect(del.status).toBe(200);
    expect(await DailyQuestionModel.findById(id)).toBeNull();
    expect(await DailyTestCaseModel.countDocuments({ question: id })).toBe(0);
  });
});

describe("challenge admin — Excel bulk import (auto-scheduling)", () => {
  it("schedules rows sequentially from a start date", async () => {
    const token = await adminToken();
    const fileBase64 = await workbookBase64(
      ["type", "title", "options", "correct"],
      [
        ["mcq", "Seq A", "a|b|c", 1],
        ["mcq", "Seq B", "x|y", 2],
        ["mcq", "Seq C", "p|q", 1],
      ],
    );
    const res = await request(app)
      .post("/api/admin/challenges/bulk-import")
      .set(auth(token))
      .send({ fileBase64, startDate: "2100-01-01" });
    expect(res.status).toBe(200);
    expect(res.body.scheduled).toBe(3);
    expect(res.body.errors).toHaveLength(0);
    const days = await DailyQuestionModel.find({
      title: { $in: ["Seq A", "Seq B", "Seq C"] },
    });
    expect(days).toHaveLength(3);
  });

  it("schedules rows on explicit per-row dates", async () => {
    const token = await adminToken();
    const fileBase64 = await workbookBase64(
      ["type", "date", "title", "options", "correct"],
      [
        ["mcq", "2100-02-01", "Exp A", "a|b", 1],
        ["mcq", "2100-02-15", "Exp B", "a|b", 2],
      ],
    );
    const res = await request(app)
      .post("/api/admin/challenges/bulk-import")
      .set(auth(token))
      .send({ fileBase64 });
    expect(res.status).toBe(200);
    expect(res.body.scheduled).toBe(2);
    expect(res.body.errors).toHaveLength(0);
  });

  it("reports per-row errors (bad row) and a date conflict without aborting", async () => {
    const token = await adminToken();
    // Pre-occupy 2100-03-02 so an explicit row conflicts.
    await createChallenge(token, {
      questionType: "MCQ",
      releaseDate: "2100-03-02",
      title: "Occupant",
      options: ["a", "b"],
      correctOption: 0,
    });
    const fileBase64 = await workbookBase64(
      ["type", "date", "title", "options", "correct"],
      [
        ["mcq", "2100-03-01", "Good", "a|b", 1], // ok
        ["mcq", "2100-03-02", "Conflicts", "a|b", 1], // date taken
        ["mcq", "not-a-date", "Bad date", "a|b", 1], // invalid date
        ["mcq", "2100-03-05", "No options", "", ""], // fails MCQ validation
      ],
    );
    const res = await request(app)
      .post("/api/admin/challenges/bulk-import")
      .set(auth(token))
      .send({ fileBase64 });
    expect(res.status).toBe(200);
    expect(res.body.scheduled).toBe(1); // only "Good"
    const messages = (res.body.errors as { row: number; message: string }[])
      .map((e) => e.message)
      .join(" | ");
    expect(res.body.errors).toHaveLength(3);
    expect(messages).toMatch(/already scheduled/i); // conflict reported, not dropped
    expect(messages).toMatch(/date/i);
  });
});

describe("challenge admin — auto-generation provenance + regenerate", () => {
  it("surfaces provenance (source/generatedAt) in the list + detail", async () => {
    const token = await adminToken();
    // A manually created challenge defaults to source 'manual'.
    const manual = await createChallenge(token, {
      questionType: "CODE",
      releaseDate: "2099-03-01",
      title: "Manual one",
      starterCode: "",
      language: "python",
      testCases: [{ input: "1", expectedOutput: "1", isHidden: false }],
    });
    expect(manual.status).toBe(201);
    expect(manual.body.source).toBe(DailyChallengeSource.MANUAL);

    // An auto-generated (AI) challenge written directly, as the worker would.
    const gen = new Date("2099-03-02T00:00:00Z");
    await DailyQuestionModel.create({
      questionType: "CODE",
      releaseDate: new Date("2099-03-01T18:30:00Z"), // IST 2099-03-02 midnight
      title: "AI one",
      description: "auto",
      starterCode: "",
      language: "python",
      marks: 5,
      source: DailyChallengeSource.AI,
      generatedAt: gen,
      validationNote: "reference solution passed all 3 test cases",
    });

    const list = await request(app)
      .get("/api/admin/challenges")
      .set(auth(token));
    expect(list.status).toBe(200);
    const aiRow = list.body.items.find(
      (r: { title: string }) => r.title === "AI one",
    );
    expect(aiRow.source).toBe(DailyChallengeSource.AI);
    expect(aiRow.generatedAt).toBe(gen.toISOString());
    const manualRow = list.body.items.find(
      (r: { title: string }) => r.title === "Manual one",
    );
    expect(manualRow.source).toBe(DailyChallengeSource.MANUAL);
    expect(manualRow.generatedAt).toBeNull();

    const detail = await request(app)
      .get(`/api/admin/challenges/${aiRow.id}`)
      .set(auth(token));
    expect(detail.body.source).toBe(DailyChallengeSource.AI);
    expect(detail.body.validationNote).toContain("passed all 3");
  });

  it("regenerate enqueues a worker job for the day (force) and returns 202", async () => {
    const token = await adminToken();
    const mock = vi.mocked(enqueueDailyChallengeJob);
    mock.mockClear();
    const res = await request(app)
      .post("/api/admin/challenges/regenerate")
      .set(auth(token))
      .send({ releaseDate: "2099-04-15" });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ queued: true, releaseDate: "2099-04-15" });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0]![0]).toEqual({
      dayKey: "2099-04-15",
      force: true,
    });
  });

  it("regenerate is admin-guarded (403 for a non-admin)", async () => {
    const { token } = await registerAndLogin();
    const res = await request(app)
      .post("/api/admin/challenges/regenerate")
      .set(auth(token))
      .send({ releaseDate: "2099-04-16" });
    expect(res.status).toBe(403);
  });

  it("ai-build is graceful when no AI provider is configured", async () => {
    const token = await adminToken();
    const res = await request(app)
      .post("/api/admin/challenges/ai-build")
      .set(auth(token))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false, draft: null });
  });

  it("ai-build returns a mapped CODE draft when the gateway is available", async () => {
    // Install a fake gateway router that returns a valid challenge JSON.
    registerLlmRouter(async () => ({
      title: "Sum a list",
      statement: "Read integers and print their sum.",
      starterCode: "nums = list(map(int, input().split()))\n",
      language: "python",
      referenceSolution: "print(sum(map(int, input().split())))",
      difficulty: "easy",
      testCases: [
        { input: "1 2 3", expectedOutput: "6", isHidden: false },
        { input: "10 20", expectedOutput: "30", isHidden: false },
        { input: "5", expectedOutput: "5", isHidden: true },
      ],
    }));

    const token = await adminToken();
    const res = await request(app)
      .post("/api/admin/challenges/ai-build")
      .set(auth(token))
      .send({ topic: "arrays" });
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.draft.title).toBe("Sum a list");
    expect(res.body.draft.language).toBe("python");
    expect(res.body.draft.referenceSolution).toContain("sum");
    expect(res.body.draft.testCases).toHaveLength(3);
    expect(res.body.draft.testCases[2].isHidden).toBe(true);
  });

  it("ai-build can produce an MCQ draft when asked", async () => {
    registerLlmRouter(async () => ({
      questionType: "MCQ",
      title: "Constant-time lookup",
      statement: "Which is O(1) on average?",
      difficulty: "easy",
      options: ["Array index", "Linear search", "Bubble sort"],
      correctOption: 0,
    }));

    const token = await adminToken();
    const res = await request(app)
      .post("/api/admin/challenges/ai-build")
      .set(auth(token))
      .send({ questionType: "MCQ", topic: "complexity" });
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.draft.questionType).toBe("MCQ");
    expect(res.body.draft.options).toHaveLength(3);
    expect(res.body.draft.correctOption).toBe(0);
    expect(res.body.draft.testCases).toHaveLength(0);
  });
});

describe("challenge admin — guard", () => {
  it("rejects a non-admin (403)", async () => {
    const { token } = await registerAndLogin();
    const res = await request(app)
      .get("/api/admin/challenges")
      .set(auth(token));
    expect(res.status).toBe(403);
  });
});
