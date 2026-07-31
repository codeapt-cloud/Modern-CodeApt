/**
 * Super-admin LLM-gateway management + monitoring. Proves the biggest security
 * rule — a provider key is ENCRYPTED at rest and NEVER returned in plaintext
 * (only `keySet`) — plus patch/reorder/trainsOnData, the summary/health shape,
 * the redacted live key-probe (mocked network), and requireSuperAdmin gating.
 */
import { Role, UserType } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { decryptSecret } from "../src/lib/crypto.js";
import { seedAiProviders } from "../src/lib/llm-gateway/seed.js";
import { AiProviderKeyModel } from "../src/models/ai-provider.model.js";
import { UserModel } from "../src/models/user.model.js";
import * as colleges from "../src/services/college.service.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});
afterEach(() => vi.unstubAllGlobals());

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const BASE = "/api/admin/ai-providers";

let counter = 0;
async function makeUser(fields?: {
  role?: string;
  userType?: string;
  college?: Types.ObjectId | null;
}): Promise<{ token: string; userId: string }> {
  counter += 1;
  const u = `aip${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `AIP ${counter}`,
      rollNumber: `AIP-${counter}`,
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

/** Seed the catalog and return the first provider (openai_compat = Groq 8B). */
async function seedAndFirst(token: string) {
  await seedAiProviders();
  const list = await request(app).get(BASE).set(auth(token));
  expect(list.status).toBe(200);
  return list.body.providers[0] as { id: string; kind: string; name: string };
}

const openAiOkFetch = () =>
  vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }], usage: {} }),
    text: async () => "",
  }));

// ---------------------------------------------------------------------------

describe("gating", () => {
  it("403s a non-super-admin", async () => {
    const platform = await makeUser({ role: Role.SUPER_ADMIN });
    const collegeId = await colleges.createCollege({ name: "g", slug: "aip-gate" }, platform.userId);
    const admin = await makeUser({
      role: Role.COLLEGE_ADMIN,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(collegeId.id),
    });
    const res = await request(app).get(BASE).set(auth(admin.token));
    expect(res.status).toBe(403);
  });
});

describe("encryption not configured (graceful)", () => {
  const original = env.ENCRYPTION_KEY;
  afterEach(() => {
    env.ENCRYPTION_KEY = original;
  });

  it("flags summary.encryptionConfigured=false and refuses key saves (400)", async () => {
    const token = await superToken();
    const first = await seedAndFirst(token);
    env.ENCRYPTION_KEY = undefined;

    const list = await request(app).get(BASE).set(auth(token));
    expect(list.body.summary.encryptionConfigured).toBe(false);

    const put = await request(app)
      .put(`${BASE}/${first.id}/key`)
      .set(auth(token))
      .send({ key: "sk-x" });
    expect(put.status).toBe(400);
    expect(put.body.error.code).toBe("ENCRYPTION_NOT_CONFIGURED");
  });
});

describe("list + summary + health shape", () => {
  it("lists seeded providers with keySet=false + a no_key status + summary", async () => {
    const token = await superToken();
    await seedAiProviders();
    const res = await request(app).get(BASE).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.providers.length).toBeGreaterThan(0);
    expect(res.body.summary.encryptionConfigured).toBe(true);
    const p = res.body.providers[0];
    expect(p.keySet).toBe(false);
    // Each seeded provider links to its key-claim console.
    expect(p.keyUrl).toMatch(/^https?:\/\//);
    expect(p.health.status).toBe("no_key");
    expect(p.health.usage).toEqual({
      minute: { requests: 0, tokens: 0 },
      day: { requests: 0, tokens: 0 },
    });
    // No plaintext key field anywhere.
    expect(JSON.stringify(res.body)).not.toContain("keyCiphertext");
    expect(res.body.summary).toMatchObject({
      total: res.body.providers.length,
      keyed: 0,
    });
    // Sorted by priority asc.
    const priorities = res.body.providers.map((x: { priority: number }) => x.priority);
    expect([...priorities]).toEqual([...priorities].sort((a, b) => a - b));
  });
});

describe("key management — encrypted at rest, never echoed", () => {
  it("PUT stores an ENCRYPTED key (keySet only); GET never returns plaintext", async () => {
    const token = await superToken();
    const first = await seedAndFirst(token);
    const SECRET = "sk-live-never-leak-abc123";

    const put = await request(app)
      .put(`${BASE}/${first.id}/key`)
      .set(auth(token))
      .send({ key: SECRET });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ keySet: true });
    expect(JSON.stringify(put.body)).not.toContain(SECRET);

    // Stored ciphertext is NOT the plaintext, but decrypts back to it.
    const keyDoc = await AiProviderKeyModel.findOne({ provider: first.id });
    expect(keyDoc!.keyCiphertext).not.toContain(SECRET);
    expect(decryptSecret(keyDoc!.keyCiphertext)).toBe(SECRET);

    // The list now shows keySet=true + healthy, and never the secret.
    const list = await request(app).get(BASE).set(auth(token));
    const p = list.body.providers.find((x: { id: string }) => x.id === first.id);
    expect(p.keySet).toBe(true);
    expect(p.health.status).toBe("healthy");
    expect(JSON.stringify(list.body)).not.toContain(SECRET);

    // Replacing the key keeps exactly one key doc.
    await request(app).put(`${BASE}/${first.id}/key`).set(auth(token)).send({ key: "sk-second" });
    expect(await AiProviderKeyModel.countDocuments({ provider: first.id })).toBe(1);

    // DELETE removes it → keySet false / no_key.
    const del = await request(app).delete(`${BASE}/${first.id}/key`).set(auth(token));
    expect(del.body).toEqual({ keySet: false });
    const list2 = await request(app).get(BASE).set(auth(token));
    const p2 = list2.body.providers.find((x: { id: string }) => x.id === first.id);
    expect(p2.keySet).toBe(false);
    expect(p2.health.status).toBe("no_key");
  });
});

describe("patch — enable / reorder / trainsOnData / limits", () => {
  it("applies curated edits and reflects them in status + order", async () => {
    const token = await superToken();
    const first = await seedAndFirst(token);

    const patched = await request(app)
      .patch(`${BASE}/${first.id}`)
      .set(auth(token))
      .send({
        enabled: false,
        trainsOnData: true,
        priority: 999,
        limits: { requestsPerDay: 42 },
        model: "gemma-4-26b-a4b-it",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      });
    expect(patched.status).toBe(200);
    expect(patched.body.enabled).toBe(false);
    expect(patched.body.trainsOnData).toBe(true);
    expect(patched.body.priority).toBe(999);
    expect(patched.body.limits.requestsPerDay).toBe(42);
    // Model id is editable so an admin can fix a stale/404 id without a redeploy.
    expect(patched.body.model).toBe("gemma-4-26b-a4b-it");
    expect(patched.body.health.status).toBe("disabled"); // enabled=false wins

    // priority 999 → now sorts LAST.
    const list = await request(app).get(BASE).set(auth(token));
    expect(list.body.providers[list.body.providers.length - 1].id).toBe(first.id);
  });
});

describe("test-probe — redacted, mocked network", () => {
  it("ok when the provider replies 2xx", async () => {
    const token = await superToken();
    const first = await seedAndFirst(token);
    await request(app).put(`${BASE}/${first.id}/key`).set(auth(token)).send({ key: "sk-x" });
    vi.stubGlobal("fetch", openAiOkFetch());

    const res = await request(app).post(`${BASE}/${first.id}/test`).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("reports a redacted error (status only) on a bad key, and no-key case", async () => {
    const token = await superToken();
    const first = await seedAndFirst(token);

    // No key yet → ok:false with a clear message.
    const noKey = await request(app).post(`${BASE}/${first.id}/test`).set(auth(token));
    expect(noKey.body.ok).toBe(false);
    expect(noKey.body.message).toMatch(/no key/i);

    await request(app).put(`${BASE}/${first.id}/key`).set(auth(token)).send({ key: "sk-bad" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        headers: { get: () => null },
        json: async () => ({}),
        text: async () => "invalid api key sk-bad", // body echoes the key…
      })),
    );
    const bad = await request(app).post(`${BASE}/${first.id}/test`).set(auth(token));
    expect(bad.body.ok).toBe(false);
    expect(bad.body.status).toBe(401);
    // …but the probe response must NOT leak the key or the raw body.
    expect(JSON.stringify(bad.body)).not.toContain("sk-bad");
  });
});
