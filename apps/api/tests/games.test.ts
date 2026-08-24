/**
 * Gaming engine API tests (Step 2) — supertest + in-memory Mongo. Covers the
 * happy path (1-game AND 4-game sets, the adaptive ladder moving, advance,
 * finish, composite), every anti-cheat invariant, and the assertCanPlayGameSet
 * matrix (cross-tenant / unpublished / cohort-excluded denied, targeted
 * allowed). The last test prints a 4-game transcript. Mirrors college-exams.test.ts.
 */
import {
  EXAM_MAX_WARNINGS,
  GAME_MAX_PROBES_PER_ITEM,
  GAME_MAX_SERVED_ITEMS,
  Role,
  UserType,
  isAnyRotation,
  solveSwitch,
} from "@codeapt/shared";
import type {
  GeoSudoClientView,
  GridClientView,
  SwitchClientView,
} from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import {
  GameAttemptModel,
  GameSetAttemptCounterModel,
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
  const u = `gm${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `GM User ${counter}`,
      rollNumber: `GMU-${counter}`,
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

async function createUnit(
  slug: string,
  token: string,
  name: string,
): Promise<string> {
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

interface GameSpecInput {
  gameKey?: string;
  durationSeconds?: number;
  allowSkip?: boolean;
  startingDifficulty?: string;
  maxQuestions?: number;
}
function probeSpec(over: GameSpecInput = {}): GameSpecInput {
  return {
    gameKey: "_probe",
    durationSeconds: 360,
    allowSkip: true,
    startingDifficulty: "easy",
    maxQuestions: 5,
    ...over,
  };
}

/** Author + publish a college game set; returns its id. */
async function authorPublishedSet(
  slug: string,
  token: string,
  body: {
    games: GameSpecInput[];
    selectionMode?: string;
    pickCount?: number;
    orgUnitIds?: string[];
    maxAttempts?: number;
    instantFeedback?: boolean;
  },
): Promise<string> {
  const created = await request(app)
    .post(`/api/c/${slug}/game-sets`)
    .set(auth(token))
    .send({
      title: "Aptitude Games",
      selectionMode: body.selectionMode ?? "fixed",
      pickCount: body.pickCount,
      games: body.games,
      orgUnitIds: body.orgUnitIds ?? [],
      maxAttempts: body.maxAttempts,
      instantFeedback: body.instantFeedback ?? false,
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

/** The ascending-index order that solves a _probe item (the client computes it
 * from the numbers it can SEE — never from a solution). */
function correctOrder(numbers: number[]): number[] {
  return numbers
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value)
    .map((p) => p.index);
}

describe("gaming — happy path", () => {
  it("plays a 1-game set start → answer → advance(setComplete) → finish", async () => {
    const { adminToken } = await setupCollege("gm-one");
    const dept = await createUnit("gm-one", adminToken, "CSE");
    const setId = await authorPublishedSet("gm-one", adminToken, {
      games: [probeSpec({ maxQuestions: 3 })],
    });
    const student = await addStudent("gm-one", adminToken, "one@c.edu", "R1", dept);

    const start = await request(app)
      .post(`/api/c/gm-one/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    expect(start.status).toBe(201);
    expect(start.body.totalGames).toBe(1);
    const attemptId = start.body.attemptId as string;
    // Anti-cheat: the served view has no solution.
    expect("solution" in start.body.item.view).toBe(false);

    let item = start.body.item;
    let gameComplete = false;
    while (!gameComplete) {
      const ans = await request(app)
        .post(`/api/game-attempts/${attemptId}/answer`)
        .set(auth(student.token))
        .send({
          itemIndex: item.itemIndex,
          action: "answer",
          submission: { order: correctOrder(item.view.numbers) },
        });
      expect(ans.status).toBe(200);
      expect(ans.body.outcome).toBe("correct");
      gameComplete = ans.body.gameComplete;
      if (!gameComplete) item = ans.body.next;
    }

    const advance = await request(app)
      .post(`/api/game-attempts/${attemptId}/advance`)
      .set(auth(student.token));
    expect(advance.status).toBe(200);
    expect(advance.body.setComplete).toBe(true);
    expect(advance.body.item).toBeNull();

    const finish = await request(app)
      .post(`/api/game-attempts/${attemptId}/finish`)
      .set(auth(student.token));
    expect(finish.status).toBe(200);
    expect(finish.body.status).toBe("graded");
    // 3 correct: easy(1) + moderate(2) + hard(3) = 6.
    expect(finish.body.compositeScore).toBe(6);
    expect(finish.body.games).toHaveLength(1);
  });
});

describe("gaming — anti-cheat invariants", () => {
  it("ignores a client-supplied score; the server scores by replay", async () => {
    const { adminToken } = await setupCollege("gm-ac1");
    const dept = await createUnit("gm-ac1", adminToken, "CSE");
    const setId = await authorPublishedSet("gm-ac1", adminToken, {
      games: [probeSpec()],
    });
    const student = await addStudent("gm-ac1", adminToken, "a1@c.edu", "R1", dept);
    const start = await request(app)
      .post(`/api/c/gm-ac1/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    const item = start.body.item;
    const ans = await request(app)
      .post(`/api/game-attempts/${start.body.attemptId}/answer`)
      .set(auth(student.token))
      .send({
        itemIndex: item.itemIndex,
        action: "answer",
        // Correct move, but also a bogus "score" the server must ignore.
        submission: { order: correctOrder(item.view.numbers), score: 9999 },
      });
    expect(ans.status).toBe(200);
    expect(ans.body.outcome).toBe("correct");
    expect(ans.body.marksAwarded).toBe(1); // easy tier, from the ladder — not 9999
    expect(ans.body.gameScore).toBe(1);
  });

  it("rejects an answer after the server clock expired and records it as expired", async () => {
    const { adminToken } = await setupCollege("gm-ac2");
    const dept = await createUnit("gm-ac2", adminToken, "CSE");
    const setId = await authorPublishedSet("gm-ac2", adminToken, {
      games: [probeSpec()],
    });
    const student = await addStudent("gm-ac2", adminToken, "a2@c.edu", "R1", dept);
    const start = await request(app)
      .post(`/api/c/gm-ac2/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    const attemptId = start.body.attemptId as string;
    // Force the (server-authoritative) clock into the past — the client can't do
    // this; it proves the clock is server-set and never trusted from the client.
    await GameAttemptModel.updateOne(
      { parent: new Types.ObjectId(attemptId), gameIndex: 0 },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    const ans = await request(app)
      .post(`/api/game-attempts/${attemptId}/answer`)
      .set(auth(student.token))
      .send({
        itemIndex: start.body.item.itemIndex,
        action: "answer",
        submission: { order: correctOrder(start.body.item.view.numbers) },
      });
    expect(ans.status).toBe(200);
    expect(ans.body.outcome).toBe("expired");
    expect(ans.body.marksAwarded).toBe(0);
    expect(ans.body.gameComplete).toBe(true);
    expect(ans.body.next).toBeNull();
  });

  it("is idempotent — answering the same item twice does not double-count", async () => {
    const { adminToken } = await setupCollege("gm-ac3");
    const dept = await createUnit("gm-ac3", adminToken, "CSE");
    const setId = await authorPublishedSet("gm-ac3", adminToken, {
      games: [probeSpec()],
    });
    const student = await addStudent("gm-ac3", adminToken, "a3@c.edu", "R1", dept);
    const start = await request(app)
      .post(`/api/c/gm-ac3/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    const attemptId = start.body.attemptId as string;
    const body = {
      itemIndex: start.body.item.itemIndex,
      action: "answer",
      submission: { order: correctOrder(start.body.item.view.numbers) },
    };
    const first = await request(app)
      .post(`/api/game-attempts/${attemptId}/answer`)
      .set(auth(student.token))
      .send(body);
    const second = await request(app)
      .post(`/api/game-attempts/${attemptId}/answer`)
      .set(auth(student.token))
      .send(body);
    expect(first.body.outcome).toBe("correct");
    expect(second.body.outcome).toBe("correct"); // stored outcome returned
    expect(second.body.gameScore).toBe(first.body.gameScore); // no double count
    expect(second.body.questionsAttempted).toBe(first.body.questionsAttempted);
  });

  it("rejects an out-of-range item index (items are addressed only on the current game)", async () => {
    const { adminToken } = await setupCollege("gm-ac4");
    const dept = await createUnit("gm-ac4", adminToken, "CSE");
    const setId = await authorPublishedSet("gm-ac4", adminToken, {
      games: [probeSpec()],
    });
    const student = await addStudent("gm-ac4", adminToken, "a4@c.edu", "R1", dept);
    const start = await request(app)
      .post(`/api/c/gm-ac4/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    const ans = await request(app)
      .post(`/api/game-attempts/${start.body.attemptId}/answer`)
      .set(auth(student.token))
      .send({ itemIndex: 999, action: "answer", submission: { order: [] } });
    expect(ans.status).toBe(404);
    expect(ans.body.error.code).toBe("ITEM_NOT_FOUND");
  });

  it("forbids answering another user's attempt", async () => {
    const { adminToken } = await setupCollege("gm-ac5");
    const dept = await createUnit("gm-ac5", adminToken, "CSE");
    const setId = await authorPublishedSet("gm-ac5", adminToken, {
      games: [probeSpec()],
    });
    const owner = await addStudent("gm-ac5", adminToken, "o@c.edu", "R1", dept);
    const other = await addStudent("gm-ac5", adminToken, "x@c.edu", "R2", dept);
    const start = await request(app)
      .post(`/api/c/gm-ac5/game-sets/${setId}/attempts`)
      .set(auth(owner.token));
    const ans = await request(app)
      .post(`/api/game-attempts/${start.body.attemptId}/answer`)
      .set(auth(other.token))
      .send({
        itemIndex: start.body.item.itemIndex,
        action: "answer",
        submission: { order: correctOrder(start.body.item.view.numbers) },
      });
    expect(ans.status).toBe(403);
    expect(ans.body.error.code).toBe("NOT_AUTHORIZED");
  });

  it("captures per-item latency (servedAt → answeredAt), capture-only", async () => {
    const { adminToken } = await setupCollege("gm-ac6");
    const dept = await createUnit("gm-ac6", adminToken, "CSE");
    const setId = await authorPublishedSet("gm-ac6", adminToken, {
      games: [probeSpec()],
    });
    const student = await addStudent("gm-ac6", adminToken, "l@c.edu", "R1", dept);
    const start = await request(app)
      .post(`/api/c/gm-ac6/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    const attemptId = start.body.attemptId as string;
    await request(app)
      .post(`/api/game-attempts/${attemptId}/answer`)
      .set(auth(student.token))
      .send({
        itemIndex: start.body.item.itemIndex,
        action: "answer",
        submission: { order: correctOrder(start.body.item.view.numbers) },
      });
    const ga = await GameAttemptModel.findOne({
      parent: new Types.ObjectId(attemptId),
      gameIndex: 0,
    });
    expect(ga?.served[0]?.latencyMs).not.toBeNull();
    expect(ga?.served[0]?.latencyMs).toBeGreaterThanOrEqual(0);
    // Server never stores a client-supplied score field.
    expect(ga?.served[0]?.marks).toBe(1);
  });
});

describe("gaming — assertCanPlayGameSet matrix", () => {
  it("a College A student cannot start College B's set (404)", async () => {
    const a = await setupCollege("gm-a");
    const deptA = await createUnit("gm-a", a.adminToken, "CSE");
    const b = await setupCollege("gm-b");
    const setB = await authorPublishedSet("gm-b", b.adminToken, {
      games: [probeSpec()],
    });
    const studentA = await addStudent("gm-a", a.adminToken, "sa@a.edu", "RA", deptA);
    const res = await request(app)
      .post(`/api/game-sets/${setB}/attempts`)
      .set(auth(studentA.token));
    expect(res.status).toBe(404);
  });

  it("rejects an UNPUBLISHED set (404)", async () => {
    const { adminToken } = await setupCollege("gm-unpub");
    const dept = await createUnit("gm-unpub", adminToken, "CSE");
    const created = await request(app)
      .post(`/api/c/gm-unpub/game-sets`)
      .set(auth(adminToken))
      .send({ title: "Draft", games: [probeSpec()], selectionMode: "fixed" });
    const student = await addStudent("gm-unpub", adminToken, "u@c.edu", "R1", dept);
    const res = await request(app)
      .post(`/api/c/gm-unpub/game-sets/${created.body.id}/attempts`)
      .set(auth(student.token));
    expect(res.status).toBe(404);
  });

  it("rejects a cohort-excluded student (403) and allows a targeted one (201)", async () => {
    const { adminToken } = await setupCollege("gm-cohort");
    const cse = await createUnit("gm-cohort", adminToken, "CSE");
    const ece = await createUnit("gm-cohort", adminToken, "ECE");
    const setId = await authorPublishedSet("gm-cohort", adminToken, {
      games: [probeSpec()],
      orgUnitIds: [cse],
    });
    const excluded = await addStudent("gm-cohort", adminToken, "e@c.edu", "R1", ece);
    const denied = await request(app)
      .post(`/api/c/gm-cohort/game-sets/${setId}/attempts`)
      .set(auth(excluded.token));
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("ORG_UNIT_OUT_OF_SCOPE");

    const targeted = await addStudent("gm-cohort", adminToken, "t@c.edu", "R2", cse);
    const ok = await request(app)
      .post(`/api/c/gm-cohort/game-sets/${setId}/attempts`)
      .set(auth(targeted.token));
    expect(ok.status).toBe(201);
  });
});

describe("gaming — 4-game e2e transcript", () => {
  it("plays a 4-game set, ladder moving, and prints a transcript", async () => {
    const { adminToken } = await setupCollege("gm-four");
    const dept = await createUnit("gm-four", adminToken, "CSE");
    const setId = await authorPublishedSet("gm-four", adminToken, {
      games: [
        probeSpec({ maxQuestions: 5 }),
        probeSpec({ maxQuestions: 5 }),
        probeSpec({ maxQuestions: 5 }),
        probeSpec({ maxQuestions: 5 }),
      ],
    });
    const student = await addStudent("gm-four", adminToken, "four@c.edu", "R1", dept);

    const start = await request(app)
      .post(`/api/c/gm-four/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    expect(start.status).toBe(201);
    const attemptId = start.body.attemptId as string;
    const lines: string[] = [`sequence=[${start.body.sequence.join(", ")}]`];

    // Deterministic per-game answer pattern → drives the ladder up AND down.
    const pattern = [true, true, true, false, true];
    let item = start.body.item;
    for (let g = 0; g < 4; g += 1) {
      lines.push(`--- game ${g + 1} (${item.gameKey}) ---`);
      let i = 0;
      let complete = false;
      while (!complete) {
        const answerCorrect = pattern[i % pattern.length]!;
        const order = correctOrder(item.view.numbers);
        const submission = {
          order: answerCorrect ? order : [...order].reverse(),
        };
        const ans = await request(app)
          .post(`/api/game-attempts/${attemptId}/answer`)
          .set(auth(student.token))
          .send({ itemIndex: item.itemIndex, action: "answer", submission });
        lines.push(
          `  item ${ans.body.itemIndex} @${ans.body.answeredDifficulty} → ${ans.body.outcome} (+${ans.body.marksAwarded}), gameScore=${ans.body.gameScore}`,
        );
        complete = ans.body.gameComplete;
        if (!complete) item = ans.body.next;
        i += 1;
      }
      const advance = await request(app)
        .post(`/api/game-attempts/${attemptId}/advance`)
        .set(auth(student.token));
      expect(advance.status).toBe(200);
      if (advance.body.setComplete) {
        expect(g).toBe(3); // only the last game completes the set
      } else {
        item = advance.body.item;
      }
    }

    const finish = await request(app)
      .post(`/api/game-attempts/${attemptId}/finish`)
      .set(auth(student.token));
    expect(finish.status).toBe(200);
    expect(finish.body.status).toBe("graded");
    // 4 games × (easy1 + moderate2 + hard3 + wrong0 + moderate2) = 4 × 8 = 32.
    expect(finish.body.compositeScore).toBe(32);
    lines.push(`composite=${finish.body.compositeScore}`);
    lines.push(
      `perGame=[${finish.body.games.map((x: { score: number }) => x.score).join(", ")}]`,
    );

    console.log("\n===== 4-GAME TRANSCRIPT =====\n" + lines.join("\n") + "\n");
  });
});

// ---------------------------------------------------------------------------
// Step 3 — hardening + the two real games
// ---------------------------------------------------------------------------

function gameSpec(gameKey: string, over: GameSpecInput = {}): GameSpecInput {
  return {
    gameKey,
    durationSeconds: 360,
    allowSkip: true,
    startingDifficulty: "easy",
    maxQuestions: 3,
    ...over,
  };
}

/** Deduce the forced blank symbol from a Geo Sudo client view the way a player
 * would (naked-single propagation) — never by reading a solution. */
function deduceGeo(view: GeoSudoClientView): string {
  const n = view.size;
  const work = view.grid.map((row) => [...row]);
  const candidates = (r: number, c: number): string[] => {
    const used = new Set<string>();
    for (let j = 0; j < n; j += 1) if (work[r]![j]) used.add(work[r]![j]!);
    for (let i = 0; i < n; i += 1) if (work[i]![c]) used.add(work[i]![c]!);
    return view.symbols.filter((s) => !used.has(s));
  };
  let progress = true;
  while (progress) {
    progress = false;
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        if (work[i]![j] != null) continue;
        const cand = candidates(i, j);
        if (cand.length === 1) {
          work[i]![j] = cand[0]!;
          progress = true;
        }
      }
    }
  }
  return work[view.blank.row]![view.blank.col]!;
}

describe("gaming — Step 3 hardening", () => {
  it("a malformed submission does not 500 — it scores wrong", async () => {
    const { adminToken } = await setupCollege("gm-mal");
    const dept = await createUnit("gm-mal", adminToken, "CSE");
    const setId = await authorPublishedSet("gm-mal", adminToken, {
      games: [gameSpec("geo_sudo")],
    });
    const student = await addStudent("gm-mal", adminToken, "m@c.edu", "R1", dept);
    const start = await request(app)
      .post(`/api/c/gm-mal/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    const ans = await request(app)
      .post(`/api/game-attempts/${start.body.attemptId}/answer`)
      .set(auth(student.token))
      .send({
        itemIndex: start.body.item.itemIndex,
        action: "answer",
        submission: { symbol: 12345, junk: "x".repeat(9999) },
      });
    expect(ans.status).toBe(200); // NOT 500
    expect(ans.body.outcome).toBe("wrong");
    expect(ans.body.marksAwarded).toBe(0);
  });

  it("the served-item safety cap completes the game", async () => {
    const { adminToken } = await setupCollege("gm-cap");
    const dept = await createUnit("gm-cap", adminToken, "CSE");
    const setId = await authorPublishedSet("gm-cap", adminToken, {
      games: [gameSpec("_probe", { maxQuestions: 0 })], // unlimited by maxQuestions
    });
    const student = await addStudent("gm-cap", adminToken, "c@c.edu", "R1", dept);
    const start = await request(app)
      .post(`/api/c/gm-cap/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    const attemptId = start.body.attemptId as string;

    // Pad served up to the cap with answered dummies (avoids 300 HTTP calls).
    const filler = [];
    for (let i = 1; i < GAME_MAX_SERVED_ITEMS; i += 1) {
      filler.push({
        index: i,
        difficulty: "easy",
        marks: 0,
        instance: { padded: true },
        outcome: "wrong",
        servedAt: new Date(),
        answeredAt: new Date(),
      });
    }
    await GameAttemptModel.updateOne(
      { parent: new Types.ObjectId(attemptId), gameIndex: 0 },
      { $push: { served: { $each: filler } } },
    );

    const ans = await request(app)
      .post(`/api/game-attempts/${attemptId}/answer`)
      .set(auth(student.token))
      .send({
        itemIndex: start.body.item.itemIndex,
        action: "answer",
        submission: { order: correctOrder(start.body.item.view.numbers) },
      });
    expect(ans.status).toBe(200);
    expect(ans.body.gameComplete).toBe(true); // hit GAME_MAX_SERVED_ITEMS
    expect(ans.body.next).toBeNull();
  });

  it("attempt limit blocks a second start; a rejected start does NOT consume an attempt", async () => {
    const { adminToken } = await setupCollege("gm-lim");
    const dept = await createUnit("gm-lim", adminToken, "CSE");
    const setId = await authorPublishedSet("gm-lim", adminToken, {
      games: [gameSpec("_probe")],
      maxAttempts: 1,
    });
    const student = await addStudent("gm-lim", adminToken, "l@c.edu", "R1", dept);

    const first = await request(app)
      .post(`/api/c/gm-lim/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    expect(first.status).toBe(201);
    expect(first.body.attemptsRemaining).toBe(0);

    const second = await request(app)
      .post(`/api/c/gm-lim/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("ATTEMPT_LIMIT_REACHED");

    // Proof it didn't consume: the counter is still 1, not 2.
    const counter = await GameSetAttemptCounterModel.findOne({
      user: new Types.ObjectId(student.id),
      gameSet: new Types.ObjectId(setId),
    });
    expect(counter?.attemptCount).toBe(1);

    // A THIRD rejected start also leaves it at 1.
    await request(app)
      .post(`/api/c/gm-lim/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    const after = await GameSetAttemptCounterModel.findOne({
      user: new Types.ObjectId(student.id),
      gameSet: new Types.ObjectId(setId),
    });
    expect(after?.attemptCount).toBe(1);
  });

  it("refuses a skip on switch_challenge server-side (authoring can't re-enable it)", async () => {
    const { adminToken } = await setupCollege("gm-skip");
    const dept = await createUnit("gm-skip", adminToken, "CSE");
    // Author WITH allowSkip:true — the engine must still forbid it for this key.
    const setId = await authorPublishedSet("gm-skip", adminToken, {
      games: [gameSpec("switch_challenge", { allowSkip: true })],
    });
    const student = await addStudent("gm-skip", adminToken, "s@c.edu", "R1", dept);
    const start = await request(app)
      .post(`/api/c/gm-skip/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    expect(start.body.item.allowSkip).toBe(false); // clamped
    const skip = await request(app)
      .post(`/api/game-attempts/${start.body.attemptId}/answer`)
      .set(auth(student.token))
      .send({ itemIndex: start.body.item.itemIndex, action: "skip" });
    expect(skip.status).toBe(400);
    expect(skip.body.error.code).toBe("SKIP_NOT_ALLOWED");
  });
});

describe("gaming — 2-game e2e transcript (geo_sudo → switch_challenge)", () => {
  it("plays both real games, ladder moving, both submission shapes round-tripping", async () => {
    const { adminToken } = await setupCollege("gm-2real");
    const dept = await createUnit("gm-2real", adminToken, "CSE");
    const setId = await authorPublishedSet("gm-2real", adminToken, {
      games: [
        gameSpec("geo_sudo", { maxQuestions: 3 }),
        gameSpec("switch_challenge", { maxQuestions: 3 }),
      ],
    });
    const student = await addStudent("gm-2real", adminToken, "e@c.edu", "R1", dept);

    const start = await request(app)
      .post(`/api/c/gm-2real/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    expect(start.status).toBe(201);
    const attemptId = start.body.attemptId as string;
    const lines: string[] = [`sequence=[${start.body.sequence.join(", ")}]`];

    let item = start.body.item;
    for (let g = 0; g < 2; g += 1) {
      lines.push(`--- game ${g + 1}: ${item.gameKey} ---`);
      let complete = false;
      while (!complete) {
        let submission: unknown;
        if (item.gameKey === "geo_sudo") {
          submission = { symbol: deduceGeo(item.view as GeoSudoClientView) };
        } else {
          submission = { order: solveSwitch(item.view as SwitchClientView) };
        }
        const ans = await request(app)
          .post(`/api/game-attempts/${attemptId}/answer`)
          .set(auth(student.token))
          .send({ itemIndex: item.itemIndex, action: "answer", submission });
        expect(ans.status).toBe(200);
        lines.push(
          `  item ${ans.body.itemIndex} @${ans.body.answeredDifficulty} → ${ans.body.outcome} (+${ans.body.marksAwarded}), gameScore=${ans.body.gameScore}`,
        );
        complete = ans.body.gameComplete;
        if (!complete) item = ans.body.next;
      }
      const advance = await request(app)
        .post(`/api/game-attempts/${attemptId}/advance`)
        .set(auth(student.token));
      expect(advance.status).toBe(200);
      if (!advance.body.setComplete) item = advance.body.item;
    }

    const finish = await request(app)
      .post(`/api/game-attempts/${attemptId}/finish`)
      .set(auth(student.token));
    expect(finish.status).toBe(200);
    expect(finish.body.status).toBe("graded");
    // Both games cleared through the ladder: easy1+moderate2+hard3 = 6 each.
    expect(finish.body.compositeScore).toBe(12);
    lines.push(`composite=${finish.body.compositeScore}`);
    lines.push(
      `perGame=[${finish.body.games.map((x: { gameKey: string; score: number }) => `${x.gameKey}:${x.score}`).join(", ")}]`,
    );
    console.log("\n===== 2-GAME (REAL) TRANSCRIPT =====\n" + lines.join("\n") + "\n");
  });
});

// ---------------------------------------------------------------------------
// Step 4 — Motion + Inductive endpoints, practice mode, 4-game transcript
// ---------------------------------------------------------------------------

interface MotionInst {
  rows: number;
  cols: number;
  walls: number[];
  blocks: number[];
  ball: number;
  hole: number;
}
/** BFS a stored motion instance to a valid move sequence (any solve; the score
 * only requires reaching the hole). Used to drive a correct motion answer. */
function solveMotionInstance(
  inst: MotionInst,
): Array<{ piece: number; dir: number }> {
  const { rows, cols, hole } = inst;
  const wallSet = new Set(inst.walls);
  const step = (cell: number, dir: number): number | null => {
    const r = Math.floor(cell / cols);
    const c = cell % cols;
    const nr = dir === 0 ? r - 1 : dir === 1 ? r + 1 : r;
    const nc = dir === 2 ? c - 1 : dir === 3 ? c + 1 : c;
    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) return null;
    return nr * cols + nc;
  };
  const key = (ball: number, blocks: number[]): string =>
    `${ball}|${[...blocks].sort((a, b) => a - b).join(",")}`;
  const start = { ball: inst.ball, blocks: [...inst.blocks] };
  if (start.ball === hole) return [];
  const seen = new Set([key(start.ball, start.blocks)]);
  const parent = new Map<
    string,
    { prev: string; move: { piece: number; dir: number } }
  >();
  let frontier = [start];
  while (frontier.length) {
    const next: Array<{ ball: number; blocks: number[] }> = [];
    for (const st of frontier) {
      const occ = new Set<number>([st.ball, ...st.blocks]);
      const pieces = [
        { id: 0, pos: st.ball },
        ...st.blocks.map((pos, i) => ({ id: i + 1, pos })),
      ];
      for (const p of pieces) {
        for (let dir = 0; dir < 4; dir += 1) {
          const t = step(p.pos, dir);
          if (t == null || wallSet.has(t) || occ.has(t)) continue;
          const nb =
            p.id === 0
              ? st.blocks
              : st.blocks.map((b, i) => (i === p.id - 1 ? t : b));
          const ball = p.id === 0 ? t : st.ball;
          const k = key(ball, nb);
          if (seen.has(k)) continue;
          seen.add(k);
          parent.set(k, {
            prev: key(st.ball, st.blocks),
            move: { piece: p.id, dir },
          });
          if (ball === hole) {
            const path: Array<{ piece: number; dir: number }> = [];
            let cur = k;
            while (parent.has(cur)) {
              const e = parent.get(cur)!;
              path.push(e.move);
              cur = e.prev;
            }
            return path.reverse();
          }
          next.push({ ball, blocks: nb });
        }
      }
    }
    frontier = next;
  }
  return [];
}

/** Peek the authoritative stored instance to derive a correct submission for any
 * game (an integration-test convenience — a real player induces/solves it). */
async function correctSubmission(
  attemptId: string,
  item: { gameKey: string; gameIndex: number; itemIndex: number },
): Promise<unknown> {
  const ga = await GameAttemptModel.findOne({
    parent: new Types.ObjectId(attemptId),
    gameIndex: item.gameIndex,
  });
  const inst = ga!.served[item.itemIndex]!.instance as Record<string, unknown>;
  switch (item.gameKey) {
    case "geo_sudo":
      return { symbol: inst.solution };
    case "switch_challenge":
      return { order: inst.solution };
    case "inductive_reasoning":
      return { selected: inst.solution };
    case "bubble_math":
      return { order: inst.solution };
    case "motion_challenge":
      return { moves: solveMotionInstance(inst as unknown as MotionInst) };
    default:
      return {};
  }
}

describe("gaming — Step 4 (motion + inductive + practice)", () => {
  it("motion: an illegal move sequence scores wrong (200, not 500)", async () => {
    const { adminToken } = await setupCollege("gm-motion");
    const dept = await createUnit("gm-motion", adminToken, "CSE");
    const setId = await authorPublishedSet("gm-motion", adminToken, {
      games: [gameSpec("motion_challenge")],
    });
    const student = await addStudent("gm-motion", adminToken, "mo@c.edu", "R1", dept);
    const start = await request(app)
      .post(`/api/c/gm-motion/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    const ans = await request(app)
      .post(`/api/game-attempts/${start.body.attemptId}/answer`)
      .set(auth(student.token))
      .send({
        itemIndex: start.body.item.itemIndex,
        action: "answer",
        submission: { moves: [{ piece: 99, dir: 0 }] }, // no such piece
      });
    expect(ans.status).toBe(200);
    expect(ans.body.outcome).toBe("wrong");
  });

  it("inductive: a one-index submission is wrong, not an error", async () => {
    const { adminToken } = await setupCollege("gm-induct");
    const dept = await createUnit("gm-induct", adminToken, "CSE");
    const setId = await authorPublishedSet("gm-induct", adminToken, {
      games: [gameSpec("inductive_reasoning")],
    });
    const student = await addStudent("gm-induct", adminToken, "in@c.edu", "R1", dept);
    const start = await request(app)
      .post(`/api/c/gm-induct/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    const ans = await request(app)
      .post(`/api/game-attempts/${start.body.attemptId}/answer`)
      .set(auth(student.token))
      .send({
        itemIndex: start.body.item.itemIndex,
        action: "answer",
        submission: { selected: [0] },
      });
    expect(ans.status).toBe(200);
    expect(ans.body.outcome).toBe("wrong");
  });

  it("practice-mode explain: revealed when instantFeedback + answered; refused otherwise", async () => {
    const slug = "gm-prac";
    const { adminToken } = await setupCollege(slug);
    const dept = await createUnit(slug, adminToken, "CSE");
    const student = await addStudent(slug, adminToken, "pr@c.edu", "R1", dept);

    const practiceSet = await authorPublishedSet(slug, adminToken, {
      games: [gameSpec("geo_sudo")],
      instantFeedback: true,
    });
    const s1 = await request(app)
      .post(`/api/c/${slug}/game-sets/${practiceSet}/attempts`)
      .set(auth(student.token));
    const a1 = s1.body.attemptId as string;
    const idx = s1.body.item.itemIndex as number;

    // Refused BEFORE answering.
    const early = await request(app)
      .post(`/api/game-attempts/${a1}/explain`)
      .set(auth(student.token))
      .send({ itemIndex: idx });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("ITEM_NOT_ANSWERED");

    // Answer, then reveal succeeds and carries the solution.
    const sub = await correctSubmission(a1, s1.body.item);
    await request(app)
      .post(`/api/game-attempts/${a1}/answer`)
      .set(auth(student.token))
      .send({ itemIndex: idx, action: "answer", submission: sub });
    const reveal = await request(app)
      .post(`/api/game-attempts/${a1}/explain`)
      .set(auth(student.token))
      .send({ itemIndex: idx });
    expect(reveal.status).toBe(200);
    expect(reveal.body.solution).toBeDefined();
    expect(reveal.body.outcome).toBe("correct");

    // Practice OFF → reveal refused even after answering.
    const plainSet = await authorPublishedSet(slug, adminToken, {
      games: [gameSpec("geo_sudo")],
      instantFeedback: false,
    });
    const s2 = await request(app)
      .post(`/api/c/${slug}/game-sets/${plainSet}/attempts`)
      .set(auth(student.token));
    const a2 = s2.body.attemptId as string;
    const sub2 = await correctSubmission(a2, s2.body.item);
    await request(app)
      .post(`/api/game-attempts/${a2}/answer`)
      .set(auth(student.token))
      .send({ itemIndex: s2.body.item.itemIndex, action: "answer", submission: sub2 });
    const off = await request(app)
      .post(`/api/game-attempts/${a2}/explain`)
      .set(auth(student.token))
      .send({ itemIndex: s2.body.item.itemIndex });
    expect(off.status).toBe(403);
    expect(off.body.error.code).toBe("PRACTICE_MODE_OFF");
  });
});

describe("gaming — the Cognizant four: 4-game e2e transcript", () => {
  it("plays geo_sudo → switch_challenge → motion_challenge → inductive_reasoning through one seam", async () => {
    const slug = "gm-four-real";
    const { adminToken } = await setupCollege(slug);
    const dept = await createUnit(slug, adminToken, "CSE");
    const setId = await authorPublishedSet(slug, adminToken, {
      games: [
        gameSpec("geo_sudo", { maxQuestions: 3 }),
        gameSpec("switch_challenge", { maxQuestions: 3 }),
        gameSpec("motion_challenge", { maxQuestions: 3 }),
        gameSpec("inductive_reasoning", { maxQuestions: 3 }),
      ],
    });
    const student = await addStudent(slug, adminToken, "four@c.edu", "R1", dept);

    const start = await request(app)
      .post(`/api/c/${slug}/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    expect(start.status).toBe(201);
    const attemptId = start.body.attemptId as string;
    const lines: string[] = [`sequence=[${start.body.sequence.join(", ")}]`];

    let item = start.body.item;
    for (let g = 0; g < 4; g += 1) {
      lines.push(`--- game ${g + 1}: ${item.gameKey} ---`);
      let complete = false;
      while (!complete) {
        const submission = await correctSubmission(attemptId, item);
        const ans = await request(app)
          .post(`/api/game-attempts/${attemptId}/answer`)
          .set(auth(student.token))
          .send({ itemIndex: item.itemIndex, action: "answer", submission });
        expect(ans.status).toBe(200);
        lines.push(
          `  item ${ans.body.itemIndex} @${ans.body.answeredDifficulty} → ${ans.body.outcome} (+${ans.body.marksAwarded}) sub=${JSON.stringify(submission).slice(0, 44)}`,
        );
        complete = ans.body.gameComplete;
        if (!complete) item = ans.body.next;
      }
      const advance = await request(app)
        .post(`/api/game-attempts/${attemptId}/advance`)
        .set(auth(student.token));
      expect(advance.status).toBe(200);
      if (!advance.body.setComplete) item = advance.body.item;
    }

    const finish = await request(app)
      .post(`/api/game-attempts/${attemptId}/finish`)
      .set(auth(student.token));
    expect(finish.status).toBe(200);
    expect(finish.body.status).toBe("graded");
    // Each game cleared through the ladder: 1+2+3 = 6 × 4 = 24.
    expect(finish.body.compositeScore).toBe(24);
    lines.push(`composite=${finish.body.compositeScore}`);
    lines.push(
      `perGame=[${finish.body.games.map((x: { gameKey: string; score: number }) => `${x.gameKey}:${x.score}`).join(", ")}]`,
    );
    console.log("\n===== COGNIZANT FOUR TRANSCRIPT =====\n" + lines.join("\n") + "\n");
  });
});

// ---------------------------------------------------------------------------
// Step 5 — Bubble (per-item timer) + Door & Key (interactive probe)
// ---------------------------------------------------------------------------

interface DoorView {
  rows: number;
  cols: number;
  pos: number;
  door: number;
  keys: { cell: number; collected: boolean }[];
  bumped: number[];
  movesUsed: number;
}

/**
 * A VIEW-ONLY door_key solver: it plays purely through the probe API and knows
 * ONLY what the redacted view tells it — current position, key/door positions,
 * and the walls it has bumped so far. It never reads the stored instance. This
 * is the real proof the hidden-information design works: a sensing agent that
 * discovers walls by bumping can still always reach the door.
 *
 * Strategy: model unbumped cells as open, BFS to the nearest needed target
 * (uncollected key, else door), walk the path one probe at a time, and REPLAN
 * whenever a bump (or reset) means the move didn't land where planned. Because
 * the set of KNOWN walls is always a subset of the real walls, the real
 * solution path is never blocked in the model, so a route always exists.
 */
async function senseSolveDoorKey(
  appRef: Express,
  attemptId: string,
  token: string,
  itemIndex: number,
  initialView: DoorView,
): Promise<{ resolved: boolean; outcome: string; next: unknown; gameComplete: boolean; movesUsed: number }> {
  const { rows, cols } = initialView;
  const known = new Set<number>(initialView.bumped);
  let view = initialView;
  const step = (cell: number, dir: number): number | null => {
    const r = Math.floor(cell / cols);
    const c = cell % cols;
    const nr = dir === 0 ? r - 1 : dir === 1 ? r + 1 : r;
    const nc = dir === 2 ? c - 1 : dir === 3 ? c + 1 : c;
    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) return null;
    return nr * cols + nc;
  };
  const planTo = (from: number, target: number): number[] => {
    const seen = new Set<number>([from]);
    const parent = new Map<number, { prev: number; dir: number }>();
    let frontier = [from];
    while (frontier.length) {
      const next: number[] = [];
      for (const cell of frontier) {
        for (let dir = 0; dir < 4; dir += 1) {
          const t = step(cell, dir);
          if (t == null || known.has(t) || seen.has(t)) continue;
          seen.add(t);
          parent.set(t, { prev: cell, dir });
          if (t === target) {
            const path: number[] = [];
            let cur = t;
            while (parent.has(cur)) {
              const e = parent.get(cur)!;
              path.push(e.dir);
              cur = e.prev;
            }
            return path.reverse();
          }
          next.push(t);
        }
      }
      frontier = next;
    }
    return [];
  };

  let last = {
    resolved: false,
    outcome: "",
    next: null as unknown,
    gameComplete: false,
    movesUsed: view.movesUsed,
  };
  for (let guard = 0; guard < 1000; guard += 1) {
    const uncollected = view.keys.find((k) => !k.collected);
    const target = uncollected ? uncollected.cell : view.door;
    const path = planTo(view.pos, target);
    if (path.length === 0) break; // already on target or boxed by known walls
    for (const dir of path) {
      const intended = step(view.pos, dir);
      const res = await request(appRef)
        .post(`/api/game-attempts/${attemptId}/probe`)
        .set(auth(token))
        .send({ itemIndex, action: { dir } });
      expect(res.status).toBe(200);
      const body = res.body as {
        view: DoorView;
        resolved: boolean;
        outcome: string | null;
        next: unknown;
        gameComplete: boolean;
        movesUsed: number;
      };
      view = body.view;
      for (const cell of view.bumped) known.add(cell);
      last = {
        resolved: body.resolved,
        outcome: body.outcome ?? "",
        next: body.next,
        gameComplete: body.gameComplete,
        movesUsed: body.movesUsed,
      };
      if (body.resolved) return last;
      // Bump/reset: the move didn't land where planned — replan from scratch.
      if (view.pos !== intended) break;
    }
  }
  return last;
}

describe("gaming — Step 5: Bubble per-item timer (server-enforced)", () => {
  it("surfaces itemRemainingSeconds and records `expired` after the item deadline", async () => {
    const { adminToken } = await setupCollege("gm-bubble");
    const dept = await createUnit("gm-bubble", adminToken, "CSE");
    const setId = await authorPublishedSet("gm-bubble", adminToken, {
      games: [gameSpec("bubble_math")],
    });
    const student = await addStudent("gm-bubble", adminToken, "bm@c.edu", "R1", dept);
    const start = await request(app)
      .post(`/api/c/gm-bubble/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    expect(start.status).toBe(201);
    // Bubble's intrinsic ~15s per-item timer is surfaced for an honest countdown.
    expect(start.body.item.itemRemainingSeconds).toBeGreaterThan(0);
    expect(start.body.item.itemRemainingSeconds).toBeLessThanOrEqual(15);
    expect(start.body.item.interactive).toBe(false);

    const attemptId = start.body.attemptId as string;
    // Force THIS item's deadline into the past (server-authoritative — the client
    // can't do this). A correct answer arriving after it is still `expired`.
    await GameAttemptModel.updateOne(
      { parent: new Types.ObjectId(attemptId), gameIndex: 0 },
      { $set: { "served.0.itemExpiresAt": new Date(Date.now() - 1000) } },
    );
    const sub = await correctSubmission(attemptId, start.body.item);
    const ans = await request(app)
      .post(`/api/game-attempts/${attemptId}/answer`)
      .set(auth(student.token))
      .send({ itemIndex: start.body.item.itemIndex, action: "answer", submission: sub });
    expect(ans.status).toBe(200);
    expect(ans.body.outcome).toBe("expired"); // per-item timer, not the game clock
    expect(ans.body.marksAwarded).toBe(0);
  });

  it("a game with NO per-item timer reports itemRemainingSeconds = null", async () => {
    const { adminToken } = await setupCollege("gm-noitemtimer");
    const dept = await createUnit("gm-noitemtimer", adminToken, "CSE");
    const setId = await authorPublishedSet("gm-noitemtimer", adminToken, {
      games: [gameSpec("geo_sudo")],
    });
    const student = await addStudent("gm-noitemtimer", adminToken, "ni@c.edu", "R1", dept);
    const start = await request(app)
      .post(`/api/c/gm-noitemtimer/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    expect(start.body.item.itemRemainingSeconds).toBeNull();
  });
});

describe("gaming — Step 5: Door & Key (interactive / hidden walls)", () => {
  it("VIEW-ONLY solver reaches the door playing purely through the probe API", async () => {
    const { adminToken } = await setupCollege("gm-door");
    const dept = await createUnit("gm-door", adminToken, "CSE");
    const setId = await authorPublishedSet("gm-door", adminToken, {
      games: [gameSpec("door_key", { maxQuestions: 1 })],
    });
    const student = await addStudent("gm-door", adminToken, "dk@c.edu", "R1", dept);
    const start = await request(app)
      .post(`/api/c/gm-door/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    expect(start.status).toBe(201);
    const item = start.body.item;
    // The served view is interactive and carries NO walls.
    expect(item.interactive).toBe(true);
    expect("walls" in item.view).toBe(false);
    expect("solution" in item.view).toBe(false);

    const result = await senseSolveDoorKey(
      app,
      start.body.attemptId as string,
      student.token,
      item.itemIndex as number,
      item.view as DoorView,
    );
    expect(result.resolved).toBe(true);
    expect(result.outcome).toBe("correct"); // reached the door with all keys

    // The probe NEVER revealed an unbumped wall: read the instance now (the test
    // may; the SOLVER above never did) and confirm every discovered wall is real.
    const ga = await GameAttemptModel.findOne({
      parent: new Types.ObjectId(start.body.attemptId),
      gameIndex: 0,
    });
    const inst = ga!.served[0]!.instance as { walls: number[] };
    const discovered = (ga!.served[0]!.probeState as { bumped: number[] }).bumped;
    for (const cell of discovered) expect(inst.walls).toContain(cell);
  });

  it("a probe against a ONE-SHOT game errors (NOT_INTERACTIVE)", async () => {
    const { adminToken } = await setupCollege("gm-probe-oneshot");
    const dept = await createUnit("gm-probe-oneshot", adminToken, "CSE");
    const setId = await authorPublishedSet("gm-probe-oneshot", adminToken, {
      games: [gameSpec("geo_sudo")],
    });
    const student = await addStudent("gm-probe-oneshot", adminToken, "po@c.edu", "R1", dept);
    const start = await request(app)
      .post(`/api/c/gm-probe-oneshot/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    const res = await request(app)
      .post(`/api/game-attempts/${start.body.attemptId}/probe`)
      .set(auth(student.token))
      .send({ itemIndex: 0, action: { dir: 0 } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("NOT_INTERACTIVE");
  });

  it("an ANSWER against an interactive game errors (NOT_ONE_SHOT)", async () => {
    const { adminToken } = await setupCollege("gm-answer-interactive");
    const dept = await createUnit("gm-answer-interactive", adminToken, "CSE");
    const setId = await authorPublishedSet("gm-answer-interactive", adminToken, {
      games: [gameSpec("door_key")],
    });
    const student = await addStudent("gm-answer-interactive", adminToken, "ai@c.edu", "R1", dept);
    const start = await request(app)
      .post(`/api/c/gm-answer-interactive/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    const res = await request(app)
      .post(`/api/game-attempts/${start.body.attemptId}/answer`)
      .set(auth(student.token))
      .send({ itemIndex: 0, action: "answer", submission: { dirs: [1, 1, 3] } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("NOT_ONE_SHOT");
  });

  it("the move cap terminates the item (resolves `wrong`)", async () => {
    const { adminToken } = await setupCollege("gm-door-cap");
    const dept = await createUnit("gm-door-cap", adminToken, "CSE");
    const setId = await authorPublishedSet("gm-door-cap", adminToken, {
      games: [gameSpec("door_key", { maxQuestions: 1 })],
    });
    const student = await addStudent("gm-door-cap", adminToken, "dc@c.edu", "R1", dept);
    const start = await request(app)
      .post(`/api/c/gm-door-cap/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    const attemptId = start.body.attemptId as string;
    // Push the item's move count to one below the cap (avoids 500 HTTP calls);
    // the next probe crosses it and resolves the item `wrong`.
    await GameAttemptModel.updateOne(
      { parent: new Types.ObjectId(attemptId), gameIndex: 0 },
      { $set: { "served.0.probeState.moves": GAME_MAX_PROBES_PER_ITEM - 1 } },
    );
    const res = await request(app)
      .post(`/api/game-attempts/${attemptId}/probe`)
      .set(auth(student.token))
      .send({ itemIndex: 0, action: { dir: 0 } });
    expect(res.status).toBe(200);
    expect(res.body.resolved).toBe(true);
    expect(res.body.outcome).toBe("wrong");
    expect(res.body.movesUsed).toBe(GAME_MAX_PROBES_PER_ITEM);
  });

  it("a malformed probe action is rejected (INVALID_PROBE), not a crash", async () => {
    const { adminToken } = await setupCollege("gm-door-bad");
    const dept = await createUnit("gm-door-bad", adminToken, "CSE");
    const setId = await authorPublishedSet("gm-door-bad", adminToken, {
      games: [gameSpec("door_key", { maxQuestions: 1 })],
    });
    const student = await addStudent("gm-door-bad", adminToken, "db@c.edu", "R1", dept);
    const start = await request(app)
      .post(`/api/c/gm-door-bad/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    const res = await request(app)
      .post(`/api/game-attempts/${start.body.attemptId}/probe`)
      .set(auth(student.token))
      .send({ itemIndex: 0, action: { dir: 99 } }); // out of range
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PROBE");
  });
});

describe("gaming — the Accenture two through the seam: 6-game e2e transcript", () => {
  it("plays all six games (four one-shot + bubble + interactive door_key) through one seam", async () => {
    const slug = "gm-six";
    const { adminToken } = await setupCollege(slug);
    const dept = await createUnit(slug, adminToken, "CSE");
    const setId = await authorPublishedSet(slug, adminToken, {
      games: [
        gameSpec("geo_sudo", { maxQuestions: 3 }),
        gameSpec("switch_challenge", { maxQuestions: 3 }),
        gameSpec("motion_challenge", { maxQuestions: 3 }),
        gameSpec("inductive_reasoning", { maxQuestions: 3 }),
        gameSpec("bubble_math", { maxQuestions: 3 }),
        gameSpec("door_key", { maxQuestions: 2 }),
      ],
    });
    const student = await addStudent(slug, adminToken, "six@c.edu", "R1", dept);

    const start = await request(app)
      .post(`/api/c/${slug}/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    expect(start.status).toBe(201);
    const attemptId = start.body.attemptId as string;
    const lines: string[] = [`sequence=[${start.body.sequence.join(", ")}]`];

    let item = start.body.item;
    for (let g = 0; g < 6; g += 1) {
      lines.push(`--- game ${g + 1}: ${item.gameKey} ---`);
      let complete = false;
      while (!complete) {
        if (item.gameKey === "door_key") {
          // INTERACTIVE: play move-by-move via the probe API (view-only solver).
          const result = await senseSolveDoorKey(
            app,
            attemptId,
            student.token,
            item.itemIndex as number,
            item.view as DoorView,
          );
          lines.push(
            `  item ${item.itemIndex} @${item.difficulty} → ${result.outcome} (probed ${result.movesUsed} moves)`,
          );
          complete = result.gameComplete;
          if (!complete && result.next) item = result.next as typeof item;
        } else {
          const submission = await correctSubmission(attemptId, item);
          const ans = await request(app)
            .post(`/api/game-attempts/${attemptId}/answer`)
            .set(auth(student.token))
            .send({ itemIndex: item.itemIndex, action: "answer", submission });
          expect(ans.status).toBe(200);
          lines.push(
            `  item ${ans.body.itemIndex} @${ans.body.answeredDifficulty} → ${ans.body.outcome} (+${ans.body.marksAwarded})`,
          );
          complete = ans.body.gameComplete;
          if (!complete) item = ans.body.next;
        }
      }
      const advance = await request(app)
        .post(`/api/game-attempts/${attemptId}/advance`)
        .set(auth(student.token));
      expect(advance.status).toBe(200);
      if (!advance.body.setComplete) item = advance.body.item;
    }

    const finish = await request(app)
      .post(`/api/game-attempts/${attemptId}/finish`)
      .set(auth(student.token));
    expect(finish.status).toBe(200);
    expect(finish.body.status).toBe("graded");
    lines.push(`composite=${finish.body.compositeScore}`);
    lines.push(
      `perGame=[${finish.body.games.map((x: { gameKey: string; score: number }) => `${x.gameKey}:${x.score}`).join(", ")}]`,
    );
    console.log("\n===== ACCENTURE SIX-GAME TRANSCRIPT =====\n" + lines.join("\n") + "\n");

    // Five one-shot games cleared through the ladder = 1+2+3 = 6 each (30). The
    // interactive door_key resolves `correct` per maze (2 mazes: easy1+mod2 = 3),
    // reached move-by-move via the probe API. Total 33.
    expect(finish.body.compositeScore).toBe(33);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Step 7b Part A — lazy clock (begin), preview fields, expiry-skew, warnings
// ---------------------------------------------------------------------------

describe("gaming — Step 7b/A1: lazy clock via begin (un-gameable)", () => {
  it("serve:false returns pre-flight info with NO item/clock; begin serves + starts the clock", async () => {
    const { adminToken } = await setupCollege("gm-a1");
    const dept = await createUnit("gm-a1", adminToken, "CSE");
    const setId = await authorPublishedSet("gm-a1", adminToken, {
      games: [gameSpec("_probe", { durationSeconds: 200, maxQuestions: 3 })],
    });
    const student = await addStudent("gm-a1", adminToken, "a1@c.edu", "R1", dept);

    // Deferred (UI) start: info only, no serve, clock stopped.
    const start = await request(app)
      .post(`/api/c/gm-a1/game-sets/${setId}/attempts`)
      .set(auth(student.token))
      .send({ serve: false });
    expect(start.status).toBe(201);
    expect(start.body.item).toBeNull();
    expect(start.body.firstGame.gameKey).toBe("_probe");
    // Pre-flight can now read server-authoritative facts BEFORE the clock.
    expect(start.body.firstGame.allowSkip).toBe(true);
    expect(start.body.firstGame.durationSeconds).toBe(200);
    expect(start.body.firstGame.itemSeconds).toBeNull(); // _probe: no per-item timer
    const attemptId = start.body.attemptId as string;

    // No child yet → the clock has not started.
    expect(
      await GameAttemptModel.findOne({
        parent: new Types.ObjectId(attemptId),
        gameIndex: 0,
      }),
    ).toBeNull();

    // begin serves the first item and starts the clock.
    const begin = await request(app)
      .post(`/api/game-attempts/${attemptId}/begin`)
      .set(auth(student.token));
    expect(begin.status).toBe(200);
    expect(begin.body.item.itemIndex).toBe(0);
    const ga1 = await GameAttemptModel.findOne({
      parent: new Types.ObjectId(attemptId),
      gameIndex: 0,
    });
    const firstExpiry = ga1!.expiresAt.getTime();
    expect(firstExpiry).toBeGreaterThan(Date.now());

    // A client CANNOT extend the clock by re-calling begin — it is idempotent
    // and never resets expiresAt or serves an extra item.
    const begin2 = await request(app)
      .post(`/api/game-attempts/${attemptId}/begin`)
      .set(auth(student.token));
    expect(begin2.status).toBe(200);
    const ga2 = await GameAttemptModel.findOne({
      parent: new Types.ObjectId(attemptId),
      gameIndex: 0,
    });
    expect(ga2!.expiresAt.getTime()).toBe(firstExpiry);
    expect(ga2!.served).toHaveLength(1);
  });
});

describe("gaming — Step 7b/A2: list preview fields", () => {
  it("each list item carries per-game durationSeconds + allowSkip (operator-safe)", async () => {
    const { adminToken } = await setupCollege("gm-a2");
    const dept = await createUnit("gm-a2", adminToken, "CSE");
    await authorPublishedSet("gm-a2", adminToken, {
      games: [
        gameSpec("_probe", { durationSeconds: 300, allowSkip: true }),
        gameSpec("switch_challenge", { durationSeconds: 240, allowSkip: true }),
      ],
    });
    const student = await addStudent("gm-a2", adminToken, "a2@c.edu", "R1", dept);
    const res = await request(app)
      .get(`/api/c/gm-a2/game-sets/available`)
      .set(auth(student.token));
    expect(res.status).toBe(200);
    const item = res.body.items[0];
    expect(item.games).toHaveLength(2);
    expect(item.games[0]).toEqual({
      gameKey: "_probe",
      durationSeconds: 300,
      allowSkip: true,
    });
    expect(item.games[1].gameKey).toBe("switch_challenge");
    expect("seed" in item).toBe(false); // no internals leak
  });
});

describe("gaming — Step 7b/A3: expiry-skew never scores a bogus wrong", () => {
  it("action expire with the server clock NOT expired → 409, item stays live (no ladder-down)", async () => {
    const { adminToken } = await setupCollege("gm-a3");
    const dept = await createUnit("gm-a3", adminToken, "CSE");
    // switch_challenge: allowSkip is FALSE — the exact case the {} workaround
    // scored wrong and stepped the ladder DOWN on sub-second skew.
    const setId = await authorPublishedSet("gm-a3", adminToken, {
      games: [gameSpec("switch_challenge", { durationSeconds: 300, maxQuestions: 3 })],
    });
    const student = await addStudent("gm-a3", adminToken, "a3@c.edu", "R1", dept);
    const start = await request(app)
      .post(`/api/c/gm-a3/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    const attemptId = start.body.attemptId as string;
    const item = start.body.item;

    // Client believes its clock hit zero, but the server clock has ~300s left.
    const expire = await request(app)
      .post(`/api/game-attempts/${attemptId}/answer`)
      .set(auth(student.token))
      .send({ itemIndex: item.itemIndex, action: "expire" });
    expect(expire.status).toBe(409);
    expect(expire.body.error.code).toBe("GAME_NOT_EXPIRED");

    // The item is untouched — a correct answer still scores correct (ladder UP),
    // proving no bogus `wrong` was recorded by the false expiry.
    const ans = await request(app)
      .post(`/api/game-attempts/${attemptId}/answer`)
      .set(auth(student.token))
      .send({
        itemIndex: item.itemIndex,
        action: "answer",
        submission: { order: solveSwitch(item.view) },
      });
    expect(ans.status).toBe(200);
    expect(ans.body.outcome).toBe("correct");
    expect(ans.body.answeredDifficulty).toBe("easy");
    expect(ans.body.next.difficulty).toBe("moderate"); // moved UP, not down
  });

  it("action expire with the server clock genuinely past → records expired", async () => {
    const { adminToken } = await setupCollege("gm-a3b");
    const dept = await createUnit("gm-a3b", adminToken, "CSE");
    const setId = await authorPublishedSet("gm-a3b", adminToken, {
      games: [gameSpec("switch_challenge", { maxQuestions: 3 })],
    });
    const student = await addStudent("gm-a3b", adminToken, "a3b@c.edu", "R1", dept);
    const start = await request(app)
      .post(`/api/c/gm-a3b/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    const attemptId = start.body.attemptId as string;
    await GameAttemptModel.updateOne(
      { parent: new Types.ObjectId(attemptId), gameIndex: 0 },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    const expire = await request(app)
      .post(`/api/game-attempts/${attemptId}/answer`)
      .set(auth(student.token))
      .send({ itemIndex: start.body.item.itemIndex, action: "expire" });
    expect(expire.status).toBe(200);
    expect(expire.body.outcome).toBe("expired");
    expect(expire.body.marksAwarded).toBe(0);
  });
});

describe("gaming — Step 7b/A4: proctoring warning endpoint", () => {
  it("counts warnings and force-finishes past the malpractice threshold", async () => {
    const { adminToken } = await setupCollege("gm-a4");
    const dept = await createUnit("gm-a4", adminToken, "CSE");
    const setId = await authorPublishedSet("gm-a4", adminToken, {
      games: [gameSpec("_probe", { maxQuestions: 5 })],
    });
    const student = await addStudent("gm-a4", adminToken, "a4@c.edu", "R1", dept);
    const start = await request(app)
      .post(`/api/c/gm-a4/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    const attemptId = start.body.attemptId as string;

    let last: {
      warningsTriggered: number;
      isMalpractice: boolean;
      autoFinished: boolean;
    } | null = null;
    for (let i = 0; i < EXAM_MAX_WARNINGS + 1; i += 1) {
      const res = await request(app)
        .post(`/api/game-attempts/${attemptId}/warning`)
        .set(auth(student.token));
      expect(res.status).toBe(200);
      last = res.body;
    }
    expect(last!.warningsTriggered).toBe(EXAM_MAX_WARNINGS + 1);
    expect(last!.isMalpractice).toBe(true);
    expect(last!.autoFinished).toBe(true);

    // The attempt is force-finished (graded) and flagged.
    const parent = await GameSetAttemptModel.findById(attemptId);
    expect(parent!.status).toBe("graded");
    expect(parent!.isMalpractice).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Step 18 — Grid Challenge (interactive; +3/-1 override; composite floor)
// ---------------------------------------------------------------------------

/**
 * Play one grid_challenge item END TO END as a real client would — using ONLY the
 * redacted view (record each cycle's highlight while it's live; judge each rotation
 * pair with an independent isAnyRotation over the shown patterns). `mode:"correct"`
 * answers everything right (+12); `mode:"wrong"` negates every judgement + reverses
 * the recall (-4). Returns the resolved probe response body.
 */
async function playGridViaApi(
  attemptId: string,
  token: string,
  firstItem: { itemIndex: number; view: GridClientView },
  mode: "correct" | "wrong",
): Promise<{ marksAwarded: number; gameScore: number; gameComplete: boolean }> {
  const probe = (action: unknown, itemIndex: number) =>
    request(app)
      .post(`/api/game-attempts/${attemptId}/probe`)
      .set(auth(token))
      .send({ itemIndex, action });

  const itemIndex = firstItem.itemIndex;
  let view = firstItem.view;
  const highlights: number[] = [];
  for (let c = 0; c < 3; c += 1) {
    expect(view.phase).toBe("memorize");
    expect(view.highlight).not.toBeNull();
    highlights.push(view.highlight!);
    // Ack the memorise → symmetry. The highlight is gone, the pair (no answer) shows.
    const acked = await probe({ type: "ack" }, itemIndex);
    expect(acked.status).toBe(200);
    const sView = acked.body.view as GridClientView;
    expect(sView.phase).toBe("symmetry");
    expect(sView.highlight).toBeNull();
    expect(sView.pattern).not.toBeNull();
    // Judge the rotation from the shown patterns only (a real player's knowledge).
    const judged = isAnyRotation(sView.pattern!.a, sView.pattern!.b);
    const answer = mode === "correct" ? judged : !judged;
    const sym = await probe({ type: "symmetry", answer }, itemIndex);
    expect(sym.status).toBe(200);
    view = sym.body.view as GridClientView;
  }
  expect(view.phase).toBe("recall");
  const order = mode === "correct" ? highlights : [...highlights].reverse();
  const recall = await probe({ type: "recall", order }, itemIndex);
  expect(recall.status).toBe(200);
  expect(recall.body.resolved).toBe(true);
  return {
    marksAwarded: recall.body.marksAwarded as number,
    gameScore: recall.body.gameScore as number,
    gameComplete: recall.body.gameComplete as boolean,
  };
}

describe("grid_challenge (interactive, +3/-1)", () => {
  it("a view-only client plays a PERFECT level for +12 and the composite reflects it", async () => {
    const { adminToken } = await setupCollege("gm-grid1");
    const unit = await createUnit("gm-grid1", adminToken, "CSE");
    const setId = await authorPublishedSet("gm-grid1", adminToken, {
      games: [gameSpec("grid_challenge", { maxQuestions: 1, allowSkip: false })],
    });
    const student = await addStudent("gm-grid1", adminToken, "grid1@e.test", "GR-1", unit);
    const start = await request(app)
      .post(`/api/c/gm-grid1/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    expect(start.status).toBe(201);
    const attemptId = start.body.attemptId as string;
    // Anti-cheat: the served view never carries the rotation answers.
    expect(JSON.stringify(start.body.item.view)).not.toContain("isRotation");

    const res = await playGridViaApi(attemptId, student.token, start.body.item, "correct");
    expect(res.marksAwarded).toBe(12);
    expect(res.gameScore).toBe(12);
    expect(res.gameComplete).toBe(true);

    await request(app).post(`/api/game-attempts/${attemptId}/advance`).set(auth(student.token));
    const finish = await request(app)
      .post(`/api/game-attempts/${attemptId}/finish`)
      .set(auth(student.token));
    expect(finish.status).toBe(200);
    expect(finish.body.compositeScore).toBe(12);
    expect(finish.body.games[0].score).toBe(12);
  });

  it("a NEGATIVE game score is preserved per-game but the composite FLOORS at zero", async () => {
    const { adminToken } = await setupCollege("gm-grid2");
    const unit = await createUnit("gm-grid2", adminToken, "CSE");
    const setId = await authorPublishedSet("gm-grid2", adminToken, {
      games: [gameSpec("grid_challenge", { maxQuestions: 1, allowSkip: false })],
    });
    const student = await addStudent("gm-grid2", adminToken, "grid2@e.test", "GR-2", unit);
    const start = await request(app)
      .post(`/api/c/gm-grid2/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    const attemptId = start.body.attemptId as string;

    const res = await playGridViaApi(attemptId, student.token, start.body.item, "wrong");
    // Every judgement wrong + a wrong recall = 4 × -1.
    expect(res.marksAwarded).toBe(-4);
    expect(res.gameScore).toBe(-4);

    await request(app).post(`/api/game-attempts/${attemptId}/advance`).set(auth(student.token));
    const finish = await request(app)
      .post(`/api/game-attempts/${attemptId}/finish`)
      .set(auth(student.token));
    expect(finish.status).toBe(200);
    // Composite FLOORS at 0 (never negative), but the per-game raw -4 is preserved
    // so an operator can tell "guessed wildly (-4)" from "attempted nothing (0)".
    expect(finish.body.compositeScore).toBe(0);
    expect(finish.body.games[0].score).toBe(-4);
  });

  it("EXPOSURE cannot be re-requested: resuming (begin) after acking a cycle does NOT re-reveal the highlight", async () => {
    const { adminToken } = await setupCollege("gm-grid3");
    const unit = await createUnit("gm-grid3", adminToken, "CSE");
    const setId = await authorPublishedSet("gm-grid3", adminToken, {
      games: [gameSpec("grid_challenge", { maxQuestions: 1, allowSkip: false })],
    });
    const student = await addStudent("gm-grid3", adminToken, "grid3@e.test", "GR-3", unit);
    const start = await request(app)
      .post(`/api/c/gm-grid3/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    const attemptId = start.body.attemptId as string;
    const itemIndex = start.body.item.itemIndex as number;
    expect((start.body.item.view as GridClientView).highlight).not.toBeNull();

    // Ack cycle 0 → symmetry. The highlight has been consumed.
    const acked = await request(app)
      .post(`/api/game-attempts/${attemptId}/probe`)
      .set(auth(student.token))
      .send({ itemIndex, action: { type: "ack" } });
    expect((acked.body.view as GridClientView).highlight).toBeNull();

    // Resume via begin — the pending item is re-served, and it must NOT re-reveal
    // the cycle-0 highlight (buildItemView projects the CURRENT probe state).
    const resumed = await request(app)
      .post(`/api/game-attempts/${attemptId}/begin`)
      .set(auth(student.token));
    expect(resumed.status).toBe(200);
    const rView = resumed.body.item.view as GridClientView;
    expect(rView.phase).toBe("symmetry");
    expect(rView.highlight).toBeNull();
  });
});
