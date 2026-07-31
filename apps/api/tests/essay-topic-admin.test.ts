/**
 * Essay-topic (prompt) admin CRUD (backlog item 2). supertest + in-memory Mongo.
 * Covers create with keywords, per-field validation, update, active toggle, and
 * the reference-safe delete: BLOCK when student attempts exist; else SET_NULL any
 * curriculum Topic.essayTopic link and delete. Plus the closed picker loop — an
 * essay-type curriculum topic can link a real prompt.
 */
import { EssayTopicErrorCode } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { TopicModel } from "../src/models/curriculum.model.js";
import { EssayAttemptModel } from "../src/models/essay.model.js";
import request from "supertest";

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
  const u = `esa${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Essay Adm ${counter}`,
      rollNumber: `ESA-${counter}`,
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

const createTopic = (token: string, body: unknown) =>
  request(app).post("/api/admin/essay-topics").set(auth(token)).send(body);

describe("essay-topic admin — CRUD + validation", () => {
  it("creates a prompt with (deduped) keywords and persists all fields", async () => {
    const token = await adminToken();
    const res = await createTopic(token, {
      title: "Remote work: for or against",
      description: "Take a side and argue it.",
      instructions: "Use concrete examples.",
      difficultyLevel: 2,
      minWords: 200,
      maxWords: 500,
      timeLimitMinutes: 30,
      semanticKeywords: ["productivity", "Productivity", "collaboration"],
    });
    expect(res.status).toBe(201);
    expect(res.body.difficultyLevel).toBe(2);
    expect(res.body.minWords).toBe(200);
    expect(res.body.maxWords).toBe(500);
    expect(res.body.timeLimitMinutes).toBe(30);
    expect(res.body.isActive).toBe(true);
    expect(res.body.semanticKeywords).toEqual(["productivity", "collaboration"]);
    expect(res.body.attemptCount).toBe(0);
    expect(res.body.linkedTopicCount).toBe(0);
  });

  it("defaults maxAttempts to 3 and lets an admin set a custom cap", async () => {
    const token = await adminToken();

    const def = await createTopic(token, { title: "Default attempts" });
    expect(def.status).toBe(201);
    expect(def.body.maxAttempts).toBe(3);

    const custom = await createTopic(token, {
      title: "Custom attempts",
      maxAttempts: 5,
    });
    expect(custom.body.maxAttempts).toBe(5);

    // Update persists a new cap.
    const updated = await request(app)
      .patch(`/api/admin/essay-topics/${custom.body.id}`)
      .set(auth(token))
      .send({ title: "Custom attempts", maxAttempts: 2 });
    expect(updated.body.maxAttempts).toBe(2);
  });

  it("rejects a maxAttempts below 1", async () => {
    const token = await adminToken();
    const res = await createTopic(token, { title: "Bad cap", maxAttempts: 0 });
    expect(res.status).toBe(400);
  });

  it("rejects missing title and maxWords < minWords", async () => {
    const token = await adminToken();
    const noTitle = await createTopic(token, { title: "" });
    expect(noTitle.status).toBe(400);
    const badRange = await createTopic(token, {
      title: "Bad bounds",
      minWords: 500,
      maxWords: 100,
    });
    expect(badRange.status).toBe(400);
  });

  it("updates a prompt and toggles active", async () => {
    const token = await adminToken();
    const created = await createTopic(token, {
      title: "Editable",
      semanticKeywords: ["a"],
    });
    const id = created.body.id as string;

    const updated = await request(app)
      .patch(`/api/admin/essay-topics/${id}`)
      .set(auth(token))
      .send({ title: "Edited", semanticKeywords: ["a", "b"], difficultyLevel: 3 });
    expect(updated.status).toBe(200);
    expect(updated.body.title).toBe("Edited");
    expect(updated.body.semanticKeywords).toEqual(["a", "b"]);
    expect(updated.body.difficultyLevel).toBe(3);

    const toggled = await request(app)
      .post(`/api/admin/essay-topics/${id}/active`)
      .set(auth(token))
      .send({ isActive: false });
    expect(toggled.status).toBe(200);
    expect(toggled.body.isActive).toBe(false);
  });
});

describe("essay-topic admin — reference-safe delete + picker loop", () => {
  it("BLOCKS delete when a student attempt references the prompt", async () => {
    const { token, userId } = await registerAndLogin("admin");
    const created = await createTopic(token, { title: "Attempted prompt" });
    const id = created.body.id as string;
    await EssayAttemptModel.create({
      user: new Types.ObjectId(userId),
      essayTopic: id,
      attemptNumber: 1,
    });
    const blocked = await request(app)
      .delete(`/api/admin/essay-topics/${id}`)
      .set(auth(token));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe(EssayTopicErrorCode.DELETE_BLOCKED);
    expect(blocked.body.error.details.blockers.attempts).toBe(1);
  });

  it("links to a curriculum essay topic, then SET_NULLs it on delete", async () => {
    const token = await adminToken();
    // A prompt to link.
    const prompt = await createTopic(token, { title: "Linkable prompt" });
    const promptId = prompt.body.id as string;

    // Build a subject → module → essay-type topic linking the prompt.
    counter += 1;
    const subject = await request(app)
      .post("/api/admin/subjects")
      .set(auth(token))
      .send({ name: `Essay Link Subj ${counter}` });
    const module = await request(app)
      .post(`/api/admin/subjects/${subject.body.id}/modules`)
      .set(auth(token))
      .send({ name: "M1" });
    const topic = await request(app)
      .post(`/api/admin/modules/${module.body.id}/topics`)
      .set(auth(token))
      .send({ topicType: "essay", name: "Reflection", essayTopicId: promptId });
    expect(topic.status).toBe(201);
    expect(topic.body.essayTopicId).toBe(promptId);

    // The prompt reports it is linked by 1 curriculum topic.
    const got = await request(app)
      .get(`/api/admin/essay-topics/${promptId}`)
      .set(auth(token));
    expect(got.body.linkedTopicCount).toBe(1);

    // Delete the prompt → allowed (no attempts) → curriculum link SET_NULL.
    const del = await request(app)
      .delete(`/api/admin/essay-topics/${promptId}`)
      .set(auth(token));
    expect(del.status).toBe(200);
    const after = await TopicModel.findById(topic.body.id);
    expect(after).not.toBeNull();
    expect(after!.essayTopic ?? null).toBeNull();
  });

  it("rejects a non-admin (403)", async () => {
    const { token } = await registerAndLogin();
    const res = await request(app)
      .get("/api/admin/essay-topics")
      .set(auth(token));
    expect(res.status).toBe(403);
  });
});

describe("essay-topic admin — keyword generation (POST generate-keywords)", () => {
  const origProvider = env.ESSAY_AI_PROVIDER;
  const origUrl = env.ESSAY_LLM_URL;
  const origKey = env.ESSAY_LLM_API_KEY;

  afterEach(() => {
    env.ESSAY_AI_PROVIDER = origProvider;
    env.ESSAY_LLM_URL = origUrl;
    env.ESSAY_LLM_API_KEY = origKey;
    vi.unstubAllGlobals();
  });

  const mockChat = (content: string) =>
    vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({ choices: [{ message: { content } }] }),
        }) as unknown as Response,
    );

  const TOPIC = {
    title: "Does remote work improve productivity?",
    description: "Argue for or against remote work and its effect on teams.",
    instructions: "Use concrete examples about collaboration and flexibility.",
  };

  it("LLM success → parsed keywords + source 'llm'", async () => {
    const token = await adminToken();
    env.ESSAY_AI_PROVIDER = "llm";
    env.ESSAY_LLM_URL = "https://llm.test/v1";
    env.ESSAY_LLM_API_KEY = "sk-test";
    vi.stubGlobal(
      "fetch",
      mockChat(
        '{"keywords":["remote work","productivity","collaboration","flexibility"]}',
      ),
    );

    const res = await request(app)
      .post("/api/admin/essay-topics/generate-keywords")
      .set(auth(token))
      .send(TOPIC);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("llm");
    expect(res.body.keywords).toContain("remote work");
    expect(res.body.keywords).toContain("productivity");
  });

  it("LLM malformed → deterministic fallback (source 'deterministic', non-empty)", async () => {
    const token = await adminToken();
    env.ESSAY_AI_PROVIDER = "llm";
    env.ESSAY_LLM_URL = "https://llm.test/v1";
    env.ESSAY_LLM_API_KEY = "sk-test";
    vi.stubGlobal("fetch", mockChat("sorry, I cannot comply"));

    const res = await request(app)
      .post("/api/admin/essay-topics/generate-keywords")
      .set(auth(token))
      .send(TOPIC);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("deterministic");
    expect(res.body.keywords.length).toBeGreaterThan(0);
  });

  it("provider unset → deterministic (no network call)", async () => {
    const token = await adminToken();
    env.ESSAY_AI_PROVIDER = "mock";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app)
      .post("/api/admin/essay-topics/generate-keywords")
      .set(auth(token))
      .send(TOPIC);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("deterministic");
    expect(res.body.keywords.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a non-admin (403)", async () => {
    const { token } = await registerAndLogin();
    const res = await request(app)
      .post("/api/admin/essay-topics/generate-keywords")
      .set(auth(token))
      .send(TOPIC);
    expect(res.status).toBe(403);
  });

  it("validates the body (missing title → 400)", async () => {
    const token = await adminToken();
    const res = await request(app)
      .post("/api/admin/essay-topics/generate-keywords")
      .set(auth(token))
      .send({ description: "no title" });
    expect(res.status).toBe(400);
  });
});
