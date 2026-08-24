/**
 * Step 22 — the gaming attempt lifecycle: resume, the ABANDONED refund, and the
 * consume-at-begin counter move. Drives the real endpoints (start = resume-or-
 * start, begin, answer, probe, advance, finish, GET /current) exactly as the
 * runner's mount does, and simulates a "refresh" by calling the start path again
 * with a fresh request (the client's attemptId is gone, as it would be after F5).
 */
import { GameSetAttemptStatus, Role, UserType } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { GameAttemptModel, GameSetAttemptModel } from "../src/models/game.model.js";
import { UserModel } from "../src/models/user.model.js";
import * as colleges from "../src/services/college.service.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

const TEMP_PW = "CodeApt@123";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
let n = 0;

async function makeUser(fields?: {
  role?: string;
  userType?: string;
  college?: Types.ObjectId | null;
}): Promise<{ token: string; userId: string }> {
  n += 1;
  const u = `gr${n}`;
  await request(app).post("/api/auth/register").send({
    username: u,
    email: `${u}@example.com`,
    password: "Password123",
    fullName: `GR ${n}`,
    rollNumber: `GR-${n}`,
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

async function setupCollege(slug: string): Promise<{ adminToken: string }> {
  const platform = await makeUser({ role: Role.SUPER_ADMIN });
  const dto = await colleges.createCollege({ name: slug, slug }, platform.userId);
  await colleges.setEntitlements(dto.id, { features: { gaming: true } });
  const admin = await makeUser({
    role: Role.COLLEGE_ADMIN,
    userType: UserType.COLLEGE,
    college: new Types.ObjectId(dto.id),
  });
  return { adminToken: admin.token };
}

async function addStudent(
  slug: string,
  adminToken: string,
  email: string,
): Promise<{ id: string; token: string }> {
  const unit = await request(app)
    .post(`/api/c/${slug}/org-units`)
    .set(auth(adminToken))
    .send({ type: "department", name: `D-${email}` });
  const created = await request(app)
    .post(`/api/c/${slug}/students`)
    .set(auth(adminToken))
    .send({ fullName: email, email, rollNumber: email, orgUnitId: unit.body.id });
  const id = created.body.id as string;
  await UserModel.updateOne({ _id: id }, { $set: { forcePasswordChange: false } });
  const login = await request(app)
    .post("/api/auth/login")
    .send({ identifier: email, password: TEMP_PW });
  return { id, token: login.body.accessToken as string };
}

async function authorSet(
  slug: string,
  adminToken: string,
  games: Array<Record<string, unknown>>,
  maxAttempts: number,
): Promise<string> {
  const created = await request(app)
    .post(`/api/c/${slug}/game-sets`)
    .set(auth(adminToken))
    .send({ title: "Resume repro", selectionMode: "fixed", games, orgUnitIds: [], maxAttempts });
  expect(created.status).toBe(201);
  await request(app)
    .post(`/api/c/${slug}/game-sets/${created.body.id}/publish`)
    .set(auth(adminToken))
    .send({ isPublished: true });
  return created.body.id as string;
}

const startDeferred = (slug: string, setId: string, token: string) =>
  request(app)
    .post(`/api/c/${slug}/game-sets/${setId}/attempts`)
    .set(auth(token))
    .send({ serve: false });
const engine = (attemptId: string, path: string, token: string) =>
  request(app).post(`/api/game-attempts/${attemptId}/${path}`).set(auth(token));

/** The stored one-shot solution for the current item (test backdoor). */
async function oneShotSubmission(
  attemptId: string,
  gameIndex: number,
  itemIndex: number,
): Promise<unknown> {
  const ga = await GameAttemptModel.findOne({
    parent: new Types.ObjectId(attemptId),
    gameIndex,
  });
  const inst = ga!.served[itemIndex]!.instance as { solution: unknown };
  return { order: inst.solution };
}

describe("gaming resume — refresh continues the same attempt", () => {
  it("a refresh mid-item resumes the SAME attempt with a REDUCED clock (never a reset)", async () => {
    const slug = "gr-resume";
    const { adminToken } = await setupCollege(slug);
    const setId = await authorSet(slug, adminToken, [
      { gameKey: "bubble_math", durationSeconds: 120, allowSkip: true, startingDifficulty: "easy", maxQuestions: 3 },
    ], 1);
    const student = await addStudent(slug, adminToken, "r1@c.edu");

    const start = await startDeferred(slug, setId, student.token);
    expect(start.body.resumed).toBe(false);
    expect(start.body.item).toBeNull(); // pre-flight, clock not started
    const attemptId = start.body.attemptId as string;

    const begin = await engine(attemptId, "begin", student.token).send();
    const itemIndex = begin.body.item.itemIndex as number;
    const startRemaining = begin.body.item.remainingSeconds as number;

    // Simulate ~5s of real elapsed play by rewinding the SERVER clock end.
    const child = await GameAttemptModel.findOne({ parent: new Types.ObjectId(attemptId), gameIndex: 0 });
    const originalExpiry = child!.expiresAt.getTime();
    await GameAttemptModel.updateOne(
      { _id: child!._id },
      { $set: { expiresAt: new Date(originalExpiry - 5000) } },
    );

    // "Refresh": the client lost its attemptId — call the start path afresh.
    const resumed = await startDeferred(slug, setId, student.token);
    expect(resumed.status).toBe(200); // resumed, not created
    expect(resumed.body.resumed).toBe(true);
    expect(resumed.body.attemptId).toBe(attemptId); // SAME attempt
    expect(resumed.body.currentIndex).toBe(0);
    expect(resumed.body.item).not.toBeNull();
    expect(resumed.body.item.itemIndex).toBe(itemIndex); // SAME pending item
    // The clock was NOT reset — remaining is strictly less than at start.
    expect(resumed.body.item.remainingSeconds).toBeLessThan(startRemaining);
    // And the server never re-stamped expiresAt.
    const after = await GameAttemptModel.findOne({ _id: child!._id });
    expect(after!.expiresAt.getTime()).toBe(originalExpiry - 5000);
  });

  it("an interactive item resumes with its probeState — a consumed grid highlight is NOT re-revealed", async () => {
    const slug = "gr-grid";
    const { adminToken } = await setupCollege(slug);
    const setId = await authorSet(slug, adminToken, [
      { gameKey: "grid_challenge", durationSeconds: 240, allowSkip: false, startingDifficulty: "easy", maxQuestions: 1 },
    ], 1);
    const student = await addStudent(slug, adminToken, "r2@c.edu");

    const start = await startDeferred(slug, setId, student.token);
    const attemptId = start.body.attemptId as string;
    const begin = await engine(attemptId, "begin", student.token).send();
    const itemIndex = begin.body.item.itemIndex as number;
    expect(begin.body.item.view.phase).toBe("memorize");
    expect(begin.body.item.view.highlight).not.toBeNull();

    // Ack cycle 0 → the highlight is consumed.
    await engine(attemptId, "probe", student.token).send({ itemIndex, action: { type: "ack" } });

    // Refresh via the start path → resumes into the SAME item, symmetry phase,
    // highlight gone (probeState preserved; no one-time exposure re-revealed).
    const resumed = await startDeferred(slug, setId, student.token);
    expect(resumed.body.resumed).toBe(true);
    expect(resumed.body.item.view.phase).toBe("symmetry");
    expect(resumed.body.item.view.highlight).toBeNull();
  });

  it("an ABANDONED attempt does not count toward maxAttempts (refunded)", async () => {
    const slug = "gr-abandon";
    const { adminToken } = await setupCollege(slug);
    const setId = await authorSet(slug, adminToken, [
      { gameKey: "_probe", durationSeconds: 360, allowSkip: true, startingDifficulty: "easy", maxQuestions: 5 },
    ], 1);
    const student = await addStudent(slug, adminToken, "r3@c.edu");

    const start = await startDeferred(slug, setId, student.token);
    const attemptId = start.body.attemptId as string;
    await engine(attemptId, "begin", student.token).send(); // consume it

    // The reaper marks it ABANDONED.
    await GameSetAttemptModel.updateOne(
      { _id: new Types.ObjectId(attemptId) },
      { $set: { status: GameSetAttemptStatus.ABANDONED } },
    );

    // A fresh start is ALLOWED — the abandoned attempt is refunded, not counted.
    const again = await startDeferred(slug, setId, student.token);
    expect(again.status).toBe(201);
    expect(again.body.resumed).toBe(false);
    expect(again.body.attemptId).not.toBe(attemptId);
  });

  it("the counter increments exactly once per attempt even when begin is called repeatedly", async () => {
    const slug = "gr-once";
    const { adminToken } = await setupCollege(slug);
    const setId = await authorSet(slug, adminToken, [
      { gameKey: "_probe", durationSeconds: 360, allowSkip: true, startingDifficulty: "easy", maxQuestions: 5 },
    ], 2);
    const student = await addStudent(slug, adminToken, "r4@c.edu");

    const start = await startDeferred(slug, setId, student.token);
    const attemptId = start.body.attemptId as string;

    // begin ×3 (idempotent).
    for (let i = 0; i < 3; i += 1) {
      const b = await engine(attemptId, "begin", student.token).send();
      expect(b.status).toBe(200);
    }

    // Exactly ONE begun attempt on record → used-count is 1 (of maxAttempts 2).
    const begun = await GameSetAttemptModel.countDocuments({
      _id: new Types.ObjectId(attemptId),
      begunAt: { $ne: null },
    });
    expect(begun).toBe(1);
    const current = await request(app)
      .get(`/api/game-attempts/${attemptId}/current`)
      .set(auth(student.token));
    expect(current.body.attemptsRemaining).toBe(1); // 2 - 1(this) - 0(others)
  });

  it("two CONCURRENT begin calls consume the attempt exactly once and return the SAME item", async () => {
    const slug = "gr-race";
    const { adminToken } = await setupCollege(slug);
    const setId = await authorSet(slug, adminToken, [
      { gameKey: "_probe", durationSeconds: 360, allowSkip: true, startingDifficulty: "easy", maxQuestions: 5 },
    ], 1);
    const student = await addStudent(slug, adminToken, "r6@c.edu");

    const start = await startDeferred(slug, setId, student.token);
    const attemptId = start.body.attemptId as string;

    // Fire two begins at once (double-click / retry / two tabs).
    const [a, b] = await Promise.all([
      engine(attemptId, "begin", student.token).send(),
      engine(attemptId, "begin", student.token).send(),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    // Both return the SAME served item — one child, one clock, one instance.
    expect(a.body.item.gameIndex).toBe(b.body.item.gameIndex);
    expect(a.body.item.itemIndex).toBe(b.body.item.itemIndex);
    expect(a.body.item.view).toEqual(b.body.item.view);

    // Exactly ONE child GameAttempt for game 0 (the unique index blocked a 2nd).
    const children = await GameAttemptModel.countDocuments({
      parent: new Types.ObjectId(attemptId),
      gameIndex: 0,
    });
    expect(children).toBe(1);
    // Consumed exactly once: a single begun document (atomic begunAt stamp).
    const begun = await GameSetAttemptModel.countDocuments({
      _id: new Types.ObjectId(attemptId),
      begunAt: { $ne: null },
    });
    expect(begun).toBe(1);
  });

  it("a not-yet-begun (pre-flight) attempt resumes to the tutorial, not a dead attempt; once reaped, a fresh start is allowed", async () => {
    const slug = "gr-preflight";
    const { adminToken } = await setupCollege(slug);
    const setId = await authorSet(slug, adminToken, [
      { gameKey: "_probe", durationSeconds: 360, allowSkip: true, startingDifficulty: "easy", maxQuestions: 5 },
    ], 1);
    const student = await addStudent(slug, adminToken, "r7@c.edu");

    // Reach pre-flight only — no begin, so no child and begunAt stays null.
    const start = await startDeferred(slug, setId, student.token);
    const attemptId = start.body.attemptId as string;
    expect(start.body.item).toBeNull();
    expect(await GameAttemptModel.countDocuments({ parent: new Types.ObjectId(attemptId) })).toBe(0);

    // Refresh → RESUMES the same pre-flight attempt: item null (→ the runner
    // shows the tutorial), NOT a dead attempt and NOT awaiting advance.
    const resumed = await startDeferred(slug, setId, student.token);
    expect(resumed.body.resumed).toBe(true);
    expect(resumed.body.attemptId).toBe(attemptId);
    expect(resumed.body.item).toBeNull();
    expect(resumed.body.awaitingAdvance).toBe(false);

    // The reaper sweeps the never-begun attempt ABANDONED. Nothing to refund (it
    // was never consumed), and a fresh start is allowed — no lockout.
    await GameSetAttemptModel.updateOne(
      { _id: new Types.ObjectId(attemptId) },
      { $set: { status: GameSetAttemptStatus.ABANDONED } },
    );
    const fresh = await startDeferred(slug, setId, student.token);
    expect(fresh.status).toBe(201);
    expect(fresh.body.resumed).toBe(false);
    expect(fresh.body.attemptId).not.toBe(attemptId);
  });

  it("the actual failure: play one item, refresh, and finish IN THE SAME attempt (maxAttempts:1)", async () => {
    const slug = "gr-e2e";
    const { adminToken } = await setupCollege(slug);
    const setId = await authorSet(slug, adminToken, [
      { gameKey: "bubble_math", durationSeconds: 120, allowSkip: true, startingDifficulty: "easy", maxQuestions: 2 },
    ], 1);
    const student = await addStudent(slug, adminToken, "r5@c.edu");

    const start = await startDeferred(slug, setId, student.token);
    const attemptId = start.body.attemptId as string;
    const begin = await engine(attemptId, "begin", student.token).send();

    // Play the first item.
    const ans1 = await engine(attemptId, "answer", student.token).send({
      itemIndex: begin.body.item.itemIndex,
      action: "answer",
      submission: await oneShotSubmission(attemptId, 0, begin.body.item.itemIndex),
    });
    expect(ans1.body.gameComplete).toBe(false); // maxQuestions 2 → one more

    // REFRESH — resume the same attempt; it hands back the pending 2nd item.
    const resumed = await startDeferred(slug, setId, student.token);
    expect(resumed.status).toBe(200);
    expect(resumed.body.attemptId).toBe(attemptId);
    const pending = resumed.body.item;
    expect(pending).not.toBeNull();

    // Continue to completion in the SAME attempt.
    const ans2 = await engine(attemptId, "answer", student.token).send({
      itemIndex: pending.itemIndex,
      action: "answer",
      submission: await oneShotSubmission(attemptId, 0, pending.itemIndex),
    });
    expect(ans2.body.gameComplete).toBe(true);
    const adv = await engine(attemptId, "advance", student.token).send({ serve: false });
    expect(adv.body.setComplete).toBe(true);
    const finish = await engine(attemptId, "finish", student.token).send();
    expect(finish.status).toBe(200);
    expect(finish.body.status).toBe("graded");
  });
});
