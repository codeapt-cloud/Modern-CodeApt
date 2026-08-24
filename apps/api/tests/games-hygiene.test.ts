/**
 * Step 26 hygiene — G7 (finish refuses mid-set; malpractice force-finish still
 * commits), G9 (explain reaches an EARLIER game in the attempt), G10 (a play
 * action before `begin` returns a clear GAME_NOT_BEGUN, not ATTEMPT_NOT_FOUND).
 * Read/lifecycle only — no scoring/ladder/probe/gating change.
 */
import { EXAM_MAX_WARNINGS, Role, UserType } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
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
  const u = `gh${n}`;
  await request(app).post("/api/auth/register").send({
    username: u,
    email: `${u}@example.com`,
    password: "Password123",
    fullName: `GH ${n}`,
    rollNumber: `GH-${n}`,
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
  return res.body.id as string;
}

async function addStudent(
  slug: string,
  token: string,
  email: string,
  orgUnitId: string,
): Promise<{ id: string; token: string }> {
  const created = await request(app)
    .post(`/api/c/${slug}/students`)
    .set(auth(token))
    .send({ fullName: email, email, rollNumber: email, orgUnitId });
  const id = created.body.id as string;
  await UserModel.updateOne({ _id: id }, { $set: { forcePasswordChange: false } });
  const login = await request(app)
    .post("/api/auth/login")
    .send({ identifier: email, password: TEMP_PW });
  return { id, token: login.body.accessToken as string };
}

const probeSpec = (over: Record<string, unknown> = {}) => ({
  gameKey: "_probe",
  durationSeconds: 360,
  allowSkip: true,
  startingDifficulty: "easy",
  maxQuestions: 1,
  ...over,
});

async function authorPublishedSet(
  slug: string,
  token: string,
  games: unknown[],
  extra: Record<string, unknown> = {},
): Promise<string> {
  const created = await request(app)
    .post(`/api/c/${slug}/game-sets`)
    .set(auth(token))
    .send({
      title: "Hygiene Games",
      selectionMode: "fixed",
      games,
      orgUnitIds: [],
      maxAttempts: 0,
      ...extra,
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

// ===========================================================================
// G7 — finish refuses mid-set; force-finish (malpractice) still commits
// ===========================================================================

describe("G7 — finish requires a complete set (force-finish exempt)", () => {
  it("a normal finish mid-set is refused (SET_INCOMPLETE)", async () => {
    const { adminToken } = await setupCollege("gh-fin");
    const dept = await createUnit("gh-fin", adminToken, "CSE");
    const setId = await authorPublishedSet("gh-fin", adminToken, [
      probeSpec(),
      probeSpec(),
    ]);
    const student = await addStudent("gh-fin", adminToken, "f@gh.edu", dept);

    const start = await request(app)
      .post(`/api/c/gh-fin/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    const attemptId = start.body.attemptId as string;

    // Game 0 is in progress (not answered), game 1 untouched → refuse.
    const fin = await request(app)
      .post(`/api/game-attempts/${attemptId}/finish`)
      .set(auth(student.token));
    expect(fin.status).toBe(409);
    expect(fin.body.error.code).toBe("SET_INCOMPLETE");
  });

  it("the malpractice force-finish still commits a partial set", async () => {
    const { adminToken } = await setupCollege("gh-mal");
    const dept = await createUnit("gh-mal", adminToken, "CSE");
    const setId = await authorPublishedSet("gh-mal", adminToken, [
      probeSpec(),
      probeSpec(),
    ]);
    const student = await addStudent("gh-mal", adminToken, "m@gh.edu", dept);
    const start = await request(app)
      .post(`/api/c/gh-mal/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    const attemptId = start.body.attemptId as string;

    // Trip the warning threshold — the last one force-finishes mid-set.
    let last;
    for (let i = 0; i < EXAM_MAX_WARNINGS + 1; i += 1) {
      last = await request(app)
        .post(`/api/game-attempts/${attemptId}/warning`)
        .set(auth(student.token));
    }
    expect(last!.status).toBe(200);
    expect(last!.body.isMalpractice).toBe(true);
    expect(last!.body.autoFinished).toBe(true);

    // The attempt is graded despite being mid-set (force-finish committed it).
    const result = await request(app)
      .get(`/api/game-attempts/${attemptId}/result`)
      .set(auth(student.token));
    expect(result.status).toBe(200);
    expect(result.body.status).toBe("graded");
  });

  it("a normal finish AFTER the set is complete still grades", async () => {
    const { adminToken } = await setupCollege("gh-ok");
    const dept = await createUnit("gh-ok", adminToken, "CSE");
    const setId = await authorPublishedSet("gh-ok", adminToken, [probeSpec()]);
    const student = await addStudent("gh-ok", adminToken, "o@gh.edu", dept);
    const start = await request(app)
      .post(`/api/c/gh-ok/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    const attemptId = start.body.attemptId as string;
    const item = start.body.item;
    await request(app)
      .post(`/api/game-attempts/${attemptId}/answer`)
      .set(auth(student.token))
      .send({
        itemIndex: item.itemIndex,
        action: "answer",
        submission: { order: correctOrder(item.view.numbers) },
      });
    await request(app)
      .post(`/api/game-attempts/${attemptId}/advance`)
      .set(auth(student.token));
    const fin = await request(app)
      .post(`/api/game-attempts/${attemptId}/finish`)
      .set(auth(student.token));
    expect(fin.status).toBe(200);
    expect(fin.body.status).toBe("graded");
  });
});

// ===========================================================================
// G9 — explain reaches an earlier game in the attempt
// ===========================================================================

describe("G9 — explain can reveal an EARLIER game's item", () => {
  it("reveals game 0's item after advancing to game 1", async () => {
    const { adminToken } = await setupCollege("gh-ex");
    const dept = await createUnit("gh-ex", adminToken, "CSE");
    const setId = await authorPublishedSet(
      "gh-ex",
      adminToken,
      [probeSpec(), probeSpec()],
      { instantFeedback: true },
    );
    const student = await addStudent("gh-ex", adminToken, "e@gh.edu", dept);
    const start = await request(app)
      .post(`/api/c/gh-ex/game-sets/${setId}/attempts`)
      .set(auth(student.token));
    const attemptId = start.body.attemptId as string;
    const item0 = start.body.item;

    // Complete game 0 (maxQuestions 1) and advance to game 1.
    await request(app)
      .post(`/api/game-attempts/${attemptId}/answer`)
      .set(auth(student.token))
      .send({
        itemIndex: item0.itemIndex,
        action: "answer",
        submission: { order: correctOrder(item0.view.numbers) },
      });
    await request(app)
      .post(`/api/game-attempts/${attemptId}/advance`)
      .set(auth(student.token));

    // Now on game 1: explain game 0's item 0 (previously 404'd on currentGame).
    const explain = await request(app)
      .post(`/api/game-attempts/${attemptId}/explain`)
      .set(auth(student.token))
      .send({ itemIndex: 0, gameIndex: 0 });
    expect(explain.status).toBe(200);
    expect(explain.body.itemIndex).toBe(0);
    expect(explain.body).toHaveProperty("solution");
  });
});

// ===========================================================================
// G10 — a play action before begin returns GAME_NOT_BEGUN (not 404)
// ===========================================================================

describe("G10 — a serve:false start yields a clear pre-begin error", () => {
  it("answer / advance before begin → 409 GAME_NOT_BEGUN", async () => {
    const { adminToken } = await setupCollege("gh-nb");
    const dept = await createUnit("gh-nb", adminToken, "CSE");
    const setId = await authorPublishedSet("gh-nb", adminToken, [probeSpec()]);
    const student = await addStudent("gh-nb", adminToken, "b@gh.edu", dept);

    const start = await request(app)
      .post(`/api/c/gh-nb/game-sets/${setId}/attempts`)
      .set(auth(student.token))
      .send({ serve: false });
    expect(start.body.item).toBeNull(); // pre-flight, no child served
    const attemptId = start.body.attemptId as string;

    const ans = await request(app)
      .post(`/api/game-attempts/${attemptId}/answer`)
      .set(auth(student.token))
      .send({ itemIndex: 0, action: "answer", submission: { order: [0] } });
    expect(ans.status).toBe(409);
    expect(ans.body.error.code).toBe("GAME_NOT_BEGUN");

    const adv = await request(app)
      .post(`/api/game-attempts/${attemptId}/advance`)
      .set(auth(student.token));
    expect(adv.status).toBe(409);
    expect(adv.body.error.code).toBe("GAME_NOT_BEGUN");
  });
});
