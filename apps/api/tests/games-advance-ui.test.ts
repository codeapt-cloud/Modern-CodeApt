/**
 * Repro for the "set won't advance past the first (interactive) game" report.
 *
 * The existing games.test.ts transcripts advance with serve:true (the immediate
 * path) and never past an INTERACTIVE game. This drives the EXACT flow the play
 * UI uses — start(serve:false) → begin → play → advance(serve:false) → begin …
 * — across grid_challenge (interactive) → bubble_math (one-shot), so the server
 * side of the advance is exercised the way the browser exercises it.
 *
 * Conclusion this pins down: the SERVER advance path is correct through the
 * deferred flow AND past an interactive game (test 1). The bug the user hit is
 * (a) a seed misconfig — grid_challenge given maxQuestions:3 makes the server
 * legitimately RE-SERVE grid (test 2) — combined with (b) a client renderer that
 * doesn't reset across items (fixed separately). This file locks the server
 * contract so the fixes can't regress it.
 */
import { Role, UserType } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { GameAttemptModel } from "../src/models/game.model.js";
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
  const u = `gu${n}`;
  await request(app).post("/api/auth/register").send({
    username: u,
    email: `${u}@example.com`,
    password: "Password123",
    fullName: `GU ${n}`,
    rollNumber: `GU-${n}`,
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
): Promise<{ token: string }> {
  const unit = await request(app)
    .post(`/api/c/${slug}/org-units`)
    .set(auth(adminToken))
    .send({ type: "department", name: `D-${email}` });
  const created = await request(app)
    .post(`/api/c/${slug}/students`)
    .set(auth(adminToken))
    .send({ fullName: email, email, rollNumber: email, orgUnitId: unit.body.id });
  await UserModel.updateOne(
    { _id: created.body.id },
    { $set: { forcePasswordChange: false } },
  );
  const login = await request(app)
    .post("/api/auth/login")
    .send({ identifier: email, password: TEMP_PW });
  return { token: login.body.accessToken as string };
}

async function authorSet(
  slug: string,
  adminToken: string,
  games: Array<Record<string, unknown>>,
): Promise<string> {
  const created = await request(app)
    .post(`/api/c/${slug}/game-sets`)
    .set(auth(adminToken))
    .send({
      title: "Advance repro",
      selectionMode: "fixed",
      games,
      orgUnitIds: [],
      maxAttempts: 0,
      instantFeedback: true,
    });
  expect(created.status).toBe(201);
  await request(app)
    .post(`/api/c/${slug}/game-sets/${created.body.id}/publish`)
    .set(auth(adminToken))
    .send({ isPublished: true });
  return created.body.id as string;
}

const engine = (attemptId: string, path: string, token: string) =>
  request(app).post(`/api/game-attempts/${attemptId}/${path}`).set(auth(token));

/** Drive grid_challenge to `done` via the probe channel using the stored answers
 *  (test backdoor, exactly like solveInstance for one-shot games). Returns the
 *  final (resolved) probe response. */
async function driveGrid(
  attemptId: string,
  token: string,
  gameIndex: number,
  itemIndex: number,
): Promise<request.Response> {
  const ga = await GameAttemptModel.findOne({
    parent: new Types.ObjectId(attemptId),
    gameIndex,
  });
  const inst = ga!.served[itemIndex]!.instance as {
    cycles: { isRotation: boolean }[];
    solution: { recallOrder: number[] };
  };
  let last: request.Response | null = null;
  for (let c = 0; c < inst.cycles.length; c += 1) {
    await engine(attemptId, "probe", token).send({
      itemIndex,
      action: { type: "ack" },
    });
    last = await engine(attemptId, "probe", token).send({
      itemIndex,
      action: { type: "symmetry", answer: inst.cycles[c]!.isRotation },
    });
  }
  last = await engine(attemptId, "probe", token).send({
    itemIndex,
    action: { type: "recall", order: inst.solution.recallOrder },
  });
  return last;
}

async function startDeferred(
  slug: string,
  setId: string,
  token: string,
): Promise<request.Response> {
  return request(app)
    .post(`/api/c/${slug}/game-sets/${setId}/attempts`)
    .set(auth(token))
    .send({ serve: false });
}

describe("gaming — advance through the deferred (UI) flow past an interactive game", () => {
  it("start(serve:false) → begin → play grid → advance(serve:false) → begin → bubble → finish", async () => {
    const slug = "gm-adv-ui";
    const { adminToken } = await setupCollege(slug);
    const setId = await authorSet(slug, adminToken, [
      { gameKey: "grid_challenge", durationSeconds: 240, allowSkip: false, startingDifficulty: "easy", maxQuestions: 1 },
      { gameKey: "bubble_math", durationSeconds: 120, allowSkip: true, startingDifficulty: "easy", maxQuestions: 1 },
    ]);
    const student = await addStudent(slug, adminToken, "adv@c.edu");

    // Deferred start: pre-flight info only, no item, clock stopped.
    const start = await startDeferred(slug, setId, student.token);
    expect(start.status).toBe(201);
    expect(start.body.item).toBeNull();
    expect(start.body.firstGame.gameKey).toBe("grid_challenge");
    expect(start.body.totalGames).toBe(2);
    const attemptId = start.body.attemptId as string;

    // Tutorial "Start" → begin serves grid's first (and only) item.
    const begin = await engine(attemptId, "begin", student.token).send();
    expect(begin.status).toBe(200);
    expect(begin.body.item.gameKey).toBe("grid_challenge");
    expect(begin.body.item.gameIndex).toBe(0);

    // Play grid to resolution → the game completes (maxQuestions 1).
    const grid = await driveGrid(attemptId, student.token, 0, begin.body.item.itemIndex);
    expect(grid.body.resolved).toBe(true);
    expect(grid.body.gameComplete).toBe(true);
    expect(grid.body.next).toBeNull();

    // Advance (serve:false) → next game's pre-flight, NO item yet.
    const adv = await engine(attemptId, "advance", student.token).send({ serve: false });
    expect(adv.status).toBe(200);
    expect(adv.body.setComplete).toBe(false);
    expect(adv.body.nextGame.gameKey).toBe("bubble_math");
    expect(adv.body.item).toBeNull();

    // begin the second game → its first item is served.
    const begin2 = await engine(attemptId, "begin", student.token).send();
    expect(begin2.status).toBe(200);
    expect(begin2.body.item.gameKey).toBe("bubble_math");
    expect(begin2.body.item.gameIndex).toBe(1);

    // Solve bubble_math from its stored solution (one-shot answer).
    const ga = await GameAttemptModel.findOne({
      parent: new Types.ObjectId(attemptId),
      gameIndex: 1,
    });
    const inst = ga!.served[begin2.body.item.itemIndex]!.instance as { solution: number[] };
    const ans = await engine(attemptId, "answer", student.token).send({
      itemIndex: begin2.body.item.itemIndex,
      action: "answer",
      submission: { order: inst.solution },
    });
    expect(ans.status).toBe(200);
    expect(ans.body.gameComplete).toBe(true);

    // Advance past the last game → setComplete, then finish.
    const adv2 = await engine(attemptId, "advance", student.token).send({ serve: false });
    expect(adv2.status).toBe(200);
    expect(adv2.body.setComplete).toBe(true);
    expect(adv2.body.item).toBeNull();

    const finish = await engine(attemptId, "finish", student.token).send();
    expect(finish.status).toBe(200);
    expect(finish.body.status).toBe("graded");
    expect(finish.body.games).toHaveLength(2);
  });

  it("maxQuestions:3 on grid_challenge makes the server RE-SERVE grid (the seed misconfig)", async () => {
    const slug = "gm-adv-reserve";
    const { adminToken } = await setupCollege(slug);
    const setId = await authorSet(slug, adminToken, [
      { gameKey: "grid_challenge", durationSeconds: 240, allowSkip: false, startingDifficulty: "easy", maxQuestions: 3 },
    ]);
    const student = await addStudent(slug, adminToken, "res@c.edu");

    const start = await startDeferred(slug, setId, student.token);
    const attemptId = start.body.attemptId as string;
    const begin = await engine(attemptId, "begin", student.token).send();
    const grid = await driveGrid(attemptId, student.token, 0, begin.body.item.itemIndex);

    // One grid puzzle finished, but maxQuestions:3 means the game is NOT complete —
    // the server serves a SECOND grid_challenge item. This is the trap: a single
    // composite grid item is not "3 questions"; the seed must use maxQuestions:1.
    expect(grid.body.resolved).toBe(true);
    expect(grid.body.gameComplete).toBe(false);
    expect(grid.body.next).not.toBeNull();
    expect(grid.body.next.gameKey).toBe("grid_challenge");
  });
});
