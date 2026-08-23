/**
 * Step 8 — AI set-builder + authoring safety. Covers: the AI builder returns a
 * usable draft from a stubbed LLM; rejects a hallucinated gameKey; clamps an
 * out-of-range duration and a bad pickCount; degrades cleanly on a null LLM
 * return and when no router is configured; is credit-metered (feature+collegeId
 * in the policy); is gated on gaming.ai_build for colleges; `source` is set on
 * AI drafts and never affects play; publish-safety + draft-only delete.
 */
import { Role, UserType, registerLlmRouter } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { UserModel } from "../src/models/user.model.js";
import * as colleges from "../src/services/college.service.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});
afterEach(() => registerLlmRouter(null));

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
let n = 0;

async function makeUser(fields?: {
  role?: string;
  userType?: string;
  college?: Types.ObjectId | null;
}): Promise<{ token: string; userId: string }> {
  n += 1;
  const u = `au${n}`;
  await request(app).post("/api/auth/register").send({
    username: u,
    email: `${u}@example.com`,
    password: "Password123",
    fullName: `AU ${n}`,
    rollNumber: `AU-${n}`,
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

async function superToken(): Promise<string> {
  return (await makeUser({ role: Role.SUPER_ADMIN })).token;
}

async function setupCollege(
  slug: string,
  opts: { gaming?: boolean; aiBuild?: boolean } = {},
): Promise<{ collegeId: string; adminToken: string }> {
  const platform = await makeUser({ role: Role.SUPER_ADMIN });
  const dto = await colleges.createCollege({ name: slug, slug }, platform.userId);
  if (opts.gaming) {
    await colleges.setEntitlements(dto.id, { features: { gaming: true } });
  }
  if (opts.aiBuild) {
    await colleges.setEntitlements(dto.id, {
      subCapabilities: { "gaming.ai_build": true },
    });
  }
  const admin = await makeUser({
    role: Role.COLLEGE_ADMIN,
    userType: UserType.COLLEGE,
    college: new Types.ObjectId(dto.id),
  });
  return { collegeId: dto.id, adminToken: admin.token };
}

/** A well-formed model config the fake LLM returns by default. */
const GOOD_JSON = {
  title: "AI Warm-up",
  description: "A quick set.",
  games: [
    { gameKey: "geo_sudo", durationSeconds: 240, startingDifficulty: "easy", allowSkip: true, maxQuestions: 3 },
    { gameKey: "bubble_math", durationSeconds: 180, startingDifficulty: "moderate", allowSkip: true, maxQuestions: 5 },
  ],
  selectionMode: "fixed",
  perQuestionTimerSeconds: 0,
  instantFeedback: false,
  maxAttempts: 1,
};

describe("AI set-builder — draft generation + validation", () => {
  it("returns a usable, source=ai_drafted draft from a stubbed LLM (platform)", async () => {
    registerLlmRouter(async () => GOOD_JSON);
    const res = await request(app)
      .post("/api/admin/game-sets/ai-build")
      .set(auth(await superToken()))
      .send({ brief: "a warm-up" });
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.draft).not.toBeNull();
    expect(res.body.draft.games).toHaveLength(2);
    expect(res.body.draft.source).toBe("ai_drafted");
    expect(res.body.draft.games[0].gameKey).toBe("geo_sudo");
  });

  it("REJECTS a hallucinated gameKey (drops it) and keeps valid games", async () => {
    registerLlmRouter(async () => ({
      ...GOOD_JSON,
      games: [
        { gameKey: "not_a_real_game", durationSeconds: 200, startingDifficulty: "easy", allowSkip: true, maxQuestions: 3 },
        { gameKey: "_probe", durationSeconds: 200, startingDifficulty: "easy", allowSkip: true, maxQuestions: 3 },
        { gameKey: "geo_sudo", durationSeconds: 200, startingDifficulty: "easy", allowSkip: true, maxQuestions: 3 },
      ],
    }));
    const res = await request(app)
      .post("/api/admin/game-sets/ai-build")
      .set(auth(await superToken()))
      .send({ brief: "x" });
    expect(res.status).toBe(200);
    // Only geo_sudo survives; the bogus key and the devOnly _probe are dropped.
    expect(res.body.draft.games).toHaveLength(1);
    expect(res.body.draft.games[0].gameKey).toBe("geo_sudo");
  });

  it("CLAMPS an out-of-range duration and a pickCount exceeding the pool", async () => {
    registerLlmRouter(async () => ({
      ...GOOD_JSON,
      games: [
        { gameKey: "geo_sudo", durationSeconds: 99999, startingDifficulty: "easy", allowSkip: true, maxQuestions: 3 },
        { gameKey: "bubble_math", durationSeconds: 180, startingDifficulty: "easy", allowSkip: true, maxQuestions: 3 },
      ],
      selectionMode: "random_n_of_pool",
      pickCount: 99,
    }));
    const res = await request(app)
      .post("/api/admin/game-sets/ai-build")
      .set(auth(await superToken()))
      .send({ brief: "x" });
    expect(res.status).toBe(200);
    expect(res.body.draft.games[0].durationSeconds).toBe(3600); // clamped to max
    expect(res.body.draft.pickCount).toBe(2); // clamped to pool size
  });

  it("returns draft:null (configured:true) when the model returns nothing usable", async () => {
    registerLlmRouter(async () => null);
    const res = await request(app)
      .post("/api/admin/game-sets/ai-build")
      .set(auth(await superToken()))
      .send({ brief: "x" });
    expect(res.body).toEqual({ configured: true, draft: null });
  });

  it("returns configured:false when no LLM router is installed", async () => {
    registerLlmRouter(null);
    const res = await request(app)
      .post("/api/admin/game-sets/ai-build")
      .set(auth(await superToken()))
      .send({ brief: "x" });
    expect(res.body).toEqual({ configured: false, draft: null });
  });

  it("is credit-metered: college build carries feature=game_build + collegeId in the policy", async () => {
    let seen: { feature?: string; collegeId?: string } | undefined;
    registerLlmRouter(async (_s, _u, policy) => {
      seen = policy as { feature?: string; collegeId?: string };
      return GOOD_JSON;
    });
    const { collegeId, adminToken } = await setupCollege("au-meter", {
      gaming: true,
      aiBuild: true,
    });
    const res = await request(app)
      .post("/api/c/au-meter/game-sets/ai-build")
      .set(auth(adminToken))
      .send({ brief: "x" });
    expect(res.status).toBe(200);
    expect(seen?.feature).toBe("game_build");
    expect(seen?.collegeId).toBe(collegeId);

    // Platform build is not college-metered (no collegeId in the policy).
    seen = undefined;
    await request(app)
      .post("/api/admin/game-sets/ai-build")
      .set(auth(await superToken()))
      .send({ brief: "x" });
    expect(seen?.feature).toBe("game_build");
    expect(seen?.collegeId).toBeUndefined();
  });

  it("is gated on gaming.ai_build for colleges (403 without the sub-capability)", async () => {
    registerLlmRouter(async () => GOOD_JSON);
    // Gaming ON but ai_build sub-cap OFF → the route gate rejects.
    const { adminToken } = await setupCollege("au-nogate", { gaming: true });
    const res = await request(app)
      .post("/api/c/au-nogate/game-sets/ai-build")
      .set(auth(adminToken))
      .send({ brief: "x" });
    expect(res.status).toBe(403);
  });
});

describe("authoring safety — source, publish, delete", () => {
  async function createAdminSet(
    token: string,
    body: Record<string, unknown>,
  ): Promise<string> {
    const res = await request(app)
      .post("/api/admin/game-sets")
      .set(auth(token))
      .send(body);
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  it("persists source=ai_drafted and it does NOT gate play", async () => {
    const token = await superToken();
    const id = await createAdminSet(token, {
      title: "Drafted",
      games: [{ gameKey: "_probe", durationSeconds: 360, maxQuestions: 3 }],
      selectionMode: "fixed",
      source: "ai_drafted",
    });
    const detail = await request(app)
      .get(`/api/admin/game-sets/${id}`)
      .set(auth(token));
    expect(detail.body.source).toBe("ai_drafted");
    await request(app)
      .post(`/api/admin/game-sets/${id}/publish`)
      .set(auth(token))
      .send({ isPublished: true });
    // A platform admin can still start it — source played no part in access.
    const start = await request(app)
      .post(`/api/game-sets/${id}/attempts`)
      .set(auth(token))
      .send({ serve: true });
    expect(start.status).toBe(201);
  });

  it("refuses to publish a random_n_of_pool set whose pickCount exceeds the pool", async () => {
    const token = await superToken();
    // Create fixed (valid), then update to random with pickCount > pool.
    const id = await createAdminSet(token, {
      title: "Bad random",
      games: [{ gameKey: "_probe", durationSeconds: 360, maxQuestions: 3 }],
      selectionMode: "fixed",
    });
    // Force the invalid shape server-side via update (schema allows it per-field).
    await request(app)
      .patch(`/api/admin/game-sets/${id}`)
      .set(auth(token))
      .send({ selectionMode: "random_n_of_pool", pickCount: 5 });
    const pub = await request(app)
      .post(`/api/admin/game-sets/${id}/publish`)
      .set(auth(token))
      .send({ isPublished: true });
    expect(pub.status).toBe(400);
    expect(pub.body.error.code).toBe("GAME_SET_NOT_PUBLISHABLE");
  });

  it("deletes a draft but refuses to delete a published set", async () => {
    const token = await superToken();
    const id = await createAdminSet(token, {
      title: "Deletable",
      games: [{ gameKey: "_probe", durationSeconds: 360, maxQuestions: 3 }],
      selectionMode: "fixed",
    });
    await request(app)
      .post(`/api/admin/game-sets/${id}/publish`)
      .set(auth(token))
      .send({ isPublished: true });
    const denied = await request(app)
      .delete(`/api/admin/game-sets/${id}`)
      .set(auth(token));
    expect(denied.status).toBe(409);

    await request(app)
      .post(`/api/admin/game-sets/${id}/publish`)
      .set(auth(token))
      .send({ isPublished: false });
    const ok = await request(app)
      .delete(`/api/admin/game-sets/${id}`)
      .set(auth(token));
    expect(ok.status).toBe(204);
  });
});
