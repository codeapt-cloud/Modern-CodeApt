/**
 * AI GOVERNOR (Stage-2) endpoints + live status. supertest + in-memory Mongo.
 * Proves: super-admin can read + tune the config (others 403), the config is
 * persisted + merged over defaults, and the live view derives REAL combined-pool
 * headroom + shedding state from provider health counters — shedding ACTIVE when
 * the pool is low, healthy when it isn't.
 *
 * The paced-queue producer is mocked (no Redis in tests).
 */
import { Role } from "@codeapt/shared";
import type { Express } from "express";
import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../src/lib/execution-queue.js", () => ({
  enqueueCodeJob: vi.fn(async () => undefined),
  enqueueEssayGradingJob: vi.fn(async () => undefined),
  enqueuePacedAiJob: vi.fn(async () => undefined),
  getPacedQueueDepth: vi.fn(async () => 3),
  closeQueues: vi.fn(async () => undefined),
  knownQueues: [],
  ESSAY_GRADING_JOB_NAME: "grade-essay",
}));

import { createApp } from "../src/app.js";
import { encryptSecret } from "../src/lib/crypto.js";
import { utcDayWindowStart } from "../src/lib/llm-gateway/windows.js";
import {
  AiProviderHealthModel,
  AiProviderKeyModel,
  AiProviderModel,
} from "../src/models/ai-provider.model.js";
import { UserModel } from "../src/models/user.model.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let seq = 0;
async function makeUser(role?: string): Promise<string> {
  seq += 1;
  const u = `gov${seq}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Gov User ${seq}`,
      rollNumber: `GOV-${seq}`,
      collegeName: "Acme",
      phoneNumber: "9999999999",
      state: "KA",
    });
  if (role) {
    const login = await request(app)
      .post("/api/auth/login")
      .send({ identifier: u, password: "Password123" });
    await UserModel.updateOne({ _id: login.body.user.id }, { $set: { role } });
  }
  const res = await request(app)
    .post("/api/auth/login")
    .send({ identifier: u, password: "Password123" });
  return res.body.accessToken as string;
}

/** Seed one enabled+keyed provider with a daily request limit + current usage. */
async function seedProvider(requestsPerDay: number, dayRequests: number): Promise<void> {
  const p = await AiProviderModel.create({
    name: `Prov ${seq}-${dayRequests}`,
    kind: "openai_compat",
    baseUrl: "https://prov.test/v1",
    model: "m",
    enabled: true,
    priority: 10,
    capability: "fast",
    limits: { requestsPerDay },
  });
  await AiProviderKeyModel.create({
    provider: p._id,
    keyCiphertext: encryptSecret("sk-x"),
    enabled: true,
  });
  await AiProviderHealthModel.create({
    provider: p._id,
    dayWindowStart: utcDayWindowStart(Date.now()),
    dayRequests,
  });
}

describe("AI governor config + guards", () => {
  it("super-admin reads defaults then persists a tuning change; others 403", async () => {
    const superAdmin = await makeUser(Role.SUPER_ADMIN);

    const get = await request(app)
      .get("/api/admin/ai-governor")
      .set(auth(superAdmin));
    expect(get.status).toBe(200);
    // Ships the shared defaults (on, 20/10/30).
    expect(get.body.config).toMatchObject({
      enabled: true,
      reservePercent: 20,
      platformReservePercent: 10,
      shedThreshold: 30,
    });
    expect(get.body.pacedMaxPerMinute).toBeGreaterThan(0);
    expect(get.body.pacedQueueDepth).toBe(3); // from the mocked producer

    const put = await request(app)
      .put("/api/admin/ai-governor")
      .set(auth(superAdmin))
      .send({ reservePercent: 25, shedThreshold: 40, enabled: true });
    expect(put.status).toBe(200);
    expect(put.body.config).toMatchObject({ reservePercent: 25, shedThreshold: 40 });

    // Persisted across a fresh read.
    const get2 = await request(app)
      .get("/api/admin/ai-governor")
      .set(auth(superAdmin));
    expect(get2.body.config).toMatchObject({ reservePercent: 25, shedThreshold: 40 });

    // A plain student may not touch the governor endpoint.
    const student = await makeUser();
    const denied = await request(app)
      .get("/api/admin/ai-governor")
      .set(auth(student));
    expect(denied.status).toBe(403);
  });

  it("rejects a platform reserve above the reserve", async () => {
    const superAdmin = await makeUser(Role.SUPER_ADMIN);
    const bad = await request(app)
      .put("/api/admin/ai-governor")
      .set(auth(superAdmin))
      .send({ reservePercent: 20, platformReservePercent: 50 });
    expect(bad.status).toBe(400);
  });
});

describe("AI governor live status (real headroom)", () => {
  it("reports shedding ACTIVE when the combined pool is low", async () => {
    const superAdmin = await makeUser(Role.SUPER_ADMIN);
    // 90 of 100 daily requests used → 10% headroom (< 30% shed threshold).
    await seedProvider(100, 90);

    const res = await request(app)
      .get("/api/admin/ai-governor")
      .set(auth(superAdmin));
    expect(res.status).toBe(200);
    expect(res.body.providerCount).toBe(1);
    expect(res.body.headroom.anyCapacity).toBe(true);
    expect(res.body.headroom.dayFraction).toBeCloseTo(0.1, 5);
    expect(res.body.sheddingActive).toBe(true);
  });

  it("reports healthy (no shedding) when the pool has ample headroom", async () => {
    const superAdmin = await makeUser(Role.SUPER_ADMIN);
    await seedProvider(100, 10); // 90% headroom

    const res = await request(app)
      .get("/api/admin/ai-governor")
      .set(auth(superAdmin));
    expect(res.body.headroom.dayFraction).toBeCloseTo(0.9, 5);
    expect(res.body.sheddingActive).toBe(false);
  });
});
