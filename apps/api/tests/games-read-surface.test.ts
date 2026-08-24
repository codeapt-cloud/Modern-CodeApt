/**
 * Step 24 — THE GAMING READ SURFACE. Student result history (G3) + operator
 * visibility (G2). All READ-ONLY over GameSetAttempt / GameAttempt; no play-path
 * change. Covers: the result read (finished attempt's composite + per-game
 * breakdown; refused for another user), the student's own history (in-progress
 * resumable, never a fake 0), the operator attempt list (ABANDONED distinct), the
 * cohort report (one row per cohort student, per-game columns, honesty rules, a
 * NEGATIVE raw per-game score unclamped, best-of retake policy), the .xlsx
 * export, and the access matrix. Mirrors the communication composite cohort test.
 */
import { randomUUID } from "node:crypto";

import {
  GameAttemptStatus,
  GameSetAttemptStatus,
  Role,
  UserType,
} from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import {
  GameAttemptModel,
  GameSetAttemptModel,
} from "../src/models/game.model.js";
import { UserModel } from "../src/models/user.model.js";
import * as colleges from "../src/services/college.service.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

const TEMP_PW = "CodeApt@123";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let counter = 0;
async function makeUser(fields?: {
  role?: string;
  userType?: string;
  college?: Types.ObjectId | null;
}): Promise<{ token: string; userId: string }> {
  counter += 1;
  const u = `gr${counter}`;
  await request(app).post("/api/auth/register").send({
    username: u,
    email: `${u}@example.com`,
    password: "Password123",
    fullName: `GR ${counter}`,
    rollNumber: `GRU-${counter}`,
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
): Promise<{ collegeId: string; adminToken: string }> {
  const platform = await makeUser({ role: Role.SUPER_ADMIN });
  const dto = await colleges.createCollege({ name: slug, slug }, platform.userId);
  await colleges.setEntitlements(dto.id, { features: { gaming: true } });
  const admin = await makeUser({
    role: Role.COLLEGE_ADMIN,
    userType: UserType.COLLEGE,
    college: new Types.ObjectId(dto.id),
  });
  return { collegeId: dto.id, adminToken: admin.token };
}

async function createUnit(slug: string, token: string, name: string): Promise<string> {
  const res = await request(app)
    .post(`/api/c/${slug}/org-units`)
    .set(auth(token))
    .send({ type: "department", name });
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
  return { id, token: login.body.accessToken as string };
}

interface SpecInput {
  gameKey?: string;
  durationSeconds?: number;
  allowSkip?: boolean;
  startingDifficulty?: string;
  maxQuestions?: number;
}
const probeSpec = (over: SpecInput = {}): SpecInput => ({
  gameKey: "_probe",
  durationSeconds: 360,
  allowSkip: true,
  startingDifficulty: "easy",
  maxQuestions: 5,
  ...over,
});

async function authorPublishedSet(
  slug: string,
  token: string,
  games: SpecInput[],
  orgUnitIds: string[] = [],
): Promise<string> {
  const created = await request(app)
    .post(`/api/c/${slug}/game-sets`)
    .set(auth(token))
    .send({
      title: "Aptitude Games",
      selectionMode: "fixed",
      games,
      orgUnitIds,
      maxAttempts: 0, // unlimited — retakes allowed (needed for best-of tests)
      instantFeedback: false,
    });
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  const pub = await request(app)
    .post(`/api/c/${slug}/game-sets/${id}/publish`)
    .set(auth(token))
    .send({ isPublished: true });
  expect(pub.status).toBe(200);
  return id;
}

const correctOrder = (numbers: number[]): number[] =>
  numbers
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value)
    .map((p) => p.index);

/** Seed a parent attempt + its per-game children directly (as the engine leaves
 *  them) — lets us exercise the read surface with exact scores, statuses, and the
 *  NEGATIVE grid_challenge raw that only ever occurs through real play. */
async function seedAttempt(opts: {
  collegeId: string;
  userId: string;
  gameSetId: string;
  status?: GameSetAttemptStatus;
  compositeScore?: number;
  begun?: boolean;
  warnings?: number;
  malpractice?: boolean;
  children: { gameKey: string; gameIndex: number; score: number }[];
  pickedIndices?: number[];
}): Promise<string> {
  const status = opts.status ?? GameSetAttemptStatus.GRADED;
  const sequence = opts.children.map((c) => c.gameKey);
  const pickedIndices = opts.pickedIndices ?? opts.children.map((c) => c.gameIndex);
  const parent = await GameSetAttemptModel.create({
    college: new Types.ObjectId(opts.collegeId),
    user: new Types.ObjectId(opts.userId),
    gameSet: new Types.ObjectId(opts.gameSetId),
    status,
    sequence,
    pickedIndices,
    currentIndex: 0,
    compositeScore: opts.compositeScore ?? 0,
    attemptToken: randomUUID(),
    startedAt: new Date(),
    begunAt: (opts.begun ?? true) ? new Date() : null,
    completedAt: status === GameSetAttemptStatus.GRADED ? new Date() : null,
    warningsTriggered: opts.warnings ?? 0,
    isMalpractice: opts.malpractice ?? false,
    perQuestionTimerSeconds: 0,
    instantFeedback: false,
  });
  for (const c of opts.children) {
    await GameAttemptModel.create({
      parent: parent._id,
      gameIndex: c.gameIndex,
      gameKey: c.gameKey,
      seed: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
      status: GameAttemptStatus.COMPLETE,
      score: c.score,
      questionsServed: 1,
      questionsAttempted: 1,
      questionsCorrect: c.score > 0 ? 1 : 0,
    });
  }
  return parent._id.toString();
}

// ===========================================================================
// G3 — student result read + history
// ===========================================================================

describe("gaming read surface — student result read (G3)", () => {
  it("re-reads a finished attempt's composite + per-game breakdown (owner)", async () => {
    const { adminToken } = await setupCollege("gr-res");
    const dept = await createUnit("gr-res", adminToken, "CSE");
    const setId = await authorPublishedSet("gr-res", adminToken, [
      probeSpec({ maxQuestions: 3 }),
    ]);
    const student = await addStudent("gr-res", adminToken, "r@gr.edu", "R1", dept);

    const start = await request(app)
      .post(`/api/c/gr-res/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    const attemptId = start.body.attemptId as string;
    let item = start.body.item;
    let done = false;
    while (!done) {
      const ans = await request(app)
        .post(`/api/game-attempts/${attemptId}/answer`)
        .set(auth(student.token))
        .send({
          itemIndex: item.itemIndex,
          action: "answer",
          submission: { order: correctOrder(item.view.numbers) },
        });
      done = ans.body.gameComplete;
      if (!done) item = ans.body.next;
    }
    await request(app)
      .post(`/api/game-attempts/${attemptId}/advance`)
      .set(auth(student.token));
    const finish = await request(app)
      .post(`/api/game-attempts/${attemptId}/finish`)
      .set(auth(student.token));
    expect(finish.body.compositeScore).toBe(6);

    // The persisted result read returns the SAME thing after the tab is closed.
    const result = await request(app)
      .get(`/api/game-attempts/${attemptId}/result`)
      .set(auth(student.token));
    expect(result.status).toBe(200);
    expect(result.body.status).toBe("graded");
    expect(result.body.compositeScore).toBe(6);
    expect(result.body.games).toHaveLength(1);
    expect(result.body.games[0].score).toBe(6);
  });

  it("refuses the result read for another user's attempt (403)", async () => {
    const { collegeId, adminToken } = await setupCollege("gr-res2");
    const dept = await createUnit("gr-res2", adminToken, "CSE");
    const owner = await addStudent("gr-res2", adminToken, "o@gr.edu", "R1", dept);
    const other = await addStudent("gr-res2", adminToken, "x@gr.edu", "R2", dept);
    const setId = await authorPublishedSet("gr-res2", adminToken, [probeSpec()]);
    const attemptId = await seedAttempt({
      collegeId,
      userId: owner.id,
      gameSetId: setId,
      compositeScore: 6,
      children: [{ gameKey: "_probe", gameIndex: 0, score: 6 }],
    });

    const denied = await request(app)
      .get(`/api/game-attempts/${attemptId}/result`)
      .set(auth(other.token));
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("NOT_AUTHORIZED");
  });
});

describe("gaming read surface — student attempt history (G3)", () => {
  it("lists the student's own attempts; in-progress is resumable + null score; a never-begun attempt is excluded", async () => {
    const { collegeId, adminToken } = await setupCollege("gr-hist");
    const dept = await createUnit("gr-hist", adminToken, "CSE");
    const student = await addStudent("gr-hist", adminToken, "h@gr.edu", "R1", dept);
    const setId = await authorPublishedSet("gr-hist", adminToken, [probeSpec()]);

    await seedAttempt({
      collegeId,
      userId: student.id,
      gameSetId: setId,
      status: GameSetAttemptStatus.GRADED,
      compositeScore: 9,
      children: [{ gameKey: "_probe", gameIndex: 0, score: 9 }],
    });
    await seedAttempt({
      collegeId,
      userId: student.id,
      gameSetId: setId,
      status: GameSetAttemptStatus.IN_PROGRESS,
      children: [{ gameKey: "_probe", gameIndex: 0, score: 0 }],
    });
    // Never begun (only reached pre-flight) — must NOT appear.
    await seedAttempt({
      collegeId,
      userId: student.id,
      gameSetId: setId,
      status: GameSetAttemptStatus.IN_PROGRESS,
      begun: false,
      children: [],
    });

    const res = await request(app)
      .get(`/api/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    const graded = res.body.items.find((i: { status: string }) => i.status === "graded");
    const inProg = res.body.items.find((i: { status: string }) => i.status === "in_progress");
    expect(graded.compositeScore).toBe(9);
    expect(graded.resumable).toBe(false);
    expect(inProg.compositeScore).toBeNull();
    expect(inProg.resumable).toBe(true);
  });
});

// ===========================================================================
// G2 — operator attempt list + cohort report + export
// ===========================================================================

describe("gaming read surface — operator attempt list (G2)", () => {
  it("lists every begun attempt with status, composite (only when graded), and ABANDONED distinguished", async () => {
    const { collegeId, adminToken } = await setupCollege("gr-att");
    const dept = await createUnit("gr-att", adminToken, "CSE");
    const s1 = await addStudent("gr-att", adminToken, "a1@gr.edu", "R1", dept);
    const s2 = await addStudent("gr-att", adminToken, "a2@gr.edu", "R2", dept);
    const s3 = await addStudent("gr-att", adminToken, "a3@gr.edu", "R3", dept);
    const setId = await authorPublishedSet("gr-att", adminToken, [probeSpec()]);

    await seedAttempt({
      collegeId,
      userId: s1.id,
      gameSetId: setId,
      status: GameSetAttemptStatus.GRADED,
      compositeScore: 7,
      warnings: 2,
      malpractice: true,
      children: [{ gameKey: "_probe", gameIndex: 0, score: 7 }],
    });
    await seedAttempt({
      collegeId,
      userId: s2.id,
      gameSetId: setId,
      status: GameSetAttemptStatus.IN_PROGRESS,
      children: [{ gameKey: "_probe", gameIndex: 0, score: 0 }],
    });
    await seedAttempt({
      collegeId,
      userId: s3.id,
      gameSetId: setId,
      status: GameSetAttemptStatus.ABANDONED,
      children: [{ gameKey: "_probe", gameIndex: 0, score: 3 }],
    });

    const res = await request(app)
      .get(`/api/c/gr-att/game-sets/${setId}/attempts`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3);
    const byStatus = new Map(
      res.body.items.map((i: { status: string }) => [i.status, i]),
    );
    expect(byStatus.get("graded").compositeScore).toBe(7);
    expect(byStatus.get("graded").isMalpractice).toBe(true);
    expect(byStatus.get("graded").warningsTriggered).toBe(2);
    // In-progress + abandoned show NO composite (never a fabricated score).
    expect(byStatus.get("in_progress").compositeScore).toBeNull();
    expect(byStatus.get("abandoned").compositeScore).toBeNull();
    expect(byStatus.has("abandoned")).toBe(true);
  });
});

describe("gaming read surface — cohort report (G2)", () => {
  it("one row per cohort student, per-game columns, honesty rules, NEGATIVE raw unclamped", async () => {
    const { collegeId, adminToken } = await setupCollege("gr-coh");
    const dept = await createUnit("gr-coh", adminToken, "CSE");
    const played = await addStudent("gr-coh", adminToken, "p@gr.edu", "R1", dept);
    const midway = await addStudent("gr-coh", adminToken, "m@gr.edu", "R2", dept);
    const idle = await addStudent("gr-coh", adminToken, "i@gr.edu", "R3", dept);
    // A 2-game set: grid_challenge (can score NEGATIVE) + _probe.
    const setId = await authorPublishedSet("gr-coh", adminToken, [
      { gameKey: "grid_challenge", durationSeconds: 120, maxQuestions: 1 },
      probeSpec(),
    ]);

    // played: graded, grid scored -4 (guessed wildly), probe 3 → composite floored 0.
    await seedAttempt({
      collegeId,
      userId: played.id,
      gameSetId: setId,
      status: GameSetAttemptStatus.GRADED,
      compositeScore: 0, // max(0, -4 + 3)
      children: [
        { gameKey: "grid_challenge", gameIndex: 0, score: -4 },
        { gameKey: "_probe", gameIndex: 1, score: 3 },
      ],
    });
    // midway: only an in-progress attempt.
    await seedAttempt({
      collegeId,
      userId: midway.id,
      gameSetId: setId,
      status: GameSetAttemptStatus.IN_PROGRESS,
      children: [{ gameKey: "grid_challenge", gameIndex: 0, score: 2 }],
    });
    // idle: never played (no attempts at all).

    const res = await request(app)
      .get(`/api/c/gr-coh/game-sets/${setId}/cohort`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.games).toHaveLength(2);
    expect(res.body.rows).toHaveLength(3);

    const row = (uid: string) =>
      res.body.rows.find((r: { userId: string }) => r.userId === uid);

    // played: graded, composite floored 0, but the RAW grid cell is -4 (unclamped)
    // and the probe cell is 3 — a -4 student is distinct from a 0 student.
    const p = row(played.id);
    expect(p.status).toBe("graded");
    expect(p.compositeScore).toBe(0);
    expect(p.attemptCount).toBe(1);
    const gridCell = p.cells.find((c: { gameIndex: number }) => c.gameIndex === 0);
    const probeCell = p.cells.find((c: { gameIndex: number }) => c.gameIndex === 1);
    expect(gridCell.rawScore).toBe(-4);
    expect(gridCell.played).toBe(true);
    expect(probeCell.rawScore).toBe(3);

    // midway: in-progress, NOT a low score — composite null, cells "—".
    const m = row(midway.id);
    expect(m.status).toBe("in_progress");
    expect(m.compositeScore).toBeNull();
    expect(m.cells.every((c: { played: boolean }) => !c.played)).toBe(true);

    // idle: never attempted — null composite, 0 attempts, no fake 0 per game.
    const i = row(idle.id);
    expect(i.status).toBeNull();
    expect(i.compositeScore).toBeNull();
    expect(i.attemptCount).toBe(0);
    expect(i.cells.every((c: { rawScore: number | null }) => c.rawScore === null)).toBe(true);
  });

  it("applies the Step 23 retake policy: BEST composite, with attempt count", async () => {
    const { collegeId, adminToken } = await setupCollege("gr-best");
    const dept = await createUnit("gr-best", adminToken, "CSE");
    const student = await addStudent("gr-best", adminToken, "b@gr.edu", "R1", dept);
    const setId = await authorPublishedSet("gr-best", adminToken, [probeSpec()]);

    await seedAttempt({
      collegeId,
      userId: student.id,
      gameSetId: setId,
      status: GameSetAttemptStatus.GRADED,
      compositeScore: 5,
      children: [{ gameKey: "_probe", gameIndex: 0, score: 5 }],
    });
    await seedAttempt({
      collegeId,
      userId: student.id,
      gameSetId: setId,
      status: GameSetAttemptStatus.GRADED,
      compositeScore: 9, // better, later
      children: [{ gameKey: "_probe", gameIndex: 0, score: 9 }],
    });

    const res = await request(app)
      .get(`/api/c/gr-best/game-sets/${setId}/cohort`)
      .set(auth(adminToken));
    const r = res.body.rows.find((x: { userId: string }) => x.userId === student.id);
    expect(r.compositeScore).toBe(9); // best, not the earlier 5
    expect(r.attemptCount).toBe(2); // but the operator sees 2 attempts
    expect(r.cells[0].rawScore).toBe(9);
  });

  it("streams a real .xlsx with per-game columns", async () => {
    const { collegeId, adminToken } = await setupCollege("gr-xlsx");
    const dept = await createUnit("gr-xlsx", adminToken, "CSE");
    const student = await addStudent("gr-xlsx", adminToken, "e@gr.edu", "R1", dept);
    const setId = await authorPublishedSet("gr-xlsx", adminToken, [probeSpec()]);
    await seedAttempt({
      collegeId,
      userId: student.id,
      gameSetId: setId,
      status: GameSetAttemptStatus.GRADED,
      compositeScore: 4,
      children: [{ gameKey: "_probe", gameIndex: 0, score: 4 }],
    });
    const xlsx = await request(app)
      .get(`/api/c/gr-xlsx/game-sets/${setId}/cohort/export`)
      .set(auth(adminToken));
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers["content-type"]).toContain("spreadsheetml");
    expect(Number(xlsx.headers["content-length"])).toBeGreaterThan(0);
  });
});

describe("gaming read surface — operator access matrix (G2)", () => {
  it("faculty of the college yes; a student no; another college no", async () => {
    const { adminToken } = await setupCollege("gr-acc");
    const dept = await createUnit("gr-acc", adminToken, "CSE");
    const student = await addStudent("gr-acc", adminToken, "s@gr.edu", "R1", dept);
    const setId = await authorPublishedSet("gr-acc", adminToken, [probeSpec()]);

    // Faculty of THIS college — allowed.
    const ok = await request(app)
      .get(`/api/c/gr-acc/game-sets/${setId}/attempts`)
      .set(auth(adminToken));
    expect(ok.status).toBe(200);

    // A student — refused (requireFaculty).
    const asStudent = await request(app)
      .get(`/api/c/gr-acc/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    expect(asStudent.status).toBe(403);

    // Another college's admin hitting this college's set — refused.
    const other = await setupCollege("gr-acc-other");
    const foreign = await request(app)
      .get(`/api/c/gr-acc/game-sets/${setId}/cohort`)
      .set(auth(other.adminToken));
    expect([403, 404]).toContain(foreign.status);
  });
});
