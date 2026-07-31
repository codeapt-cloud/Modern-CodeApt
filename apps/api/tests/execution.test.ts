/**
 * Execution API tests (supertest + in-memory Mongo). The BullMQ producer is
 * mocked, so no live Redis/Piston is needed: we assert the fast submit path
 * (job row + jobId returned) and the ownership-enforced status read.
 */
import type { Express } from "express";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Mock the queue producer BEFORE the app/service imports it.
vi.mock("../src/lib/execution-queue.js", () => ({
  enqueueCodeJob: vi.fn(async () => undefined),
  closeQueues: vi.fn(async () => undefined),
  knownQueues: [],
}));

import { createApp } from "../src/app.js";
import { enqueueCodeJob } from "../src/lib/execution-queue.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

let counter = 0;
async function registerAndLogin(): Promise<string> {
  counter += 1;
  const u = `coder${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: "Coder",
      rollNumber: `ROLL-${counter}`,
      collegeName: "Acme",
      phoneNumber: "9999999999",
      state: "KA",
    });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ identifier: u, password: "Password123" });
  return res.body.accessToken as string;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("POST /api/execute", () => {
  it("creates a queued job and returns a jobId fast", async () => {
    const token = await registerAndLogin();
    const started = Date.now();
    const res = await request(app)
      .post("/api/execute")
      .set(auth(token))
      .send({ language: "python", source: "print('hi')" });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe("queued");
    expect(typeof res.body.jobId).toBe("string");
    // Submit must not block on execution.
    expect(Date.now() - started).toBeLessThan(1000);
    expect(enqueueCodeJob).toHaveBeenCalled();
  });

  it("rejects an empty source (validation)", async () => {
    const token = await registerAndLogin();
    const res = await request(app)
      .post("/api/execute")
      .set(auth(token))
      .send({ language: "python", source: "" });
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await request(app)
      .post("/api/execute")
      .send({ language: "python", source: "print(1)" });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/execute/:jobId", () => {
  it("returns the job status for its owner", async () => {
    const token = await registerAndLogin();
    const submit = await request(app)
      .post("/api/execute")
      .set(auth(token))
      .send({ language: "javascript", source: "console.log(1)" });
    const { jobId } = submit.body;

    const res = await request(app)
      .get(`/api/execute/${jobId}`)
      .set(auth(token));

    expect(res.status).toBe(200);
    expect(res.body.jobId).toBe(jobId);
    expect(res.body.status).toBe("queued");
    expect(res.body.result).toBeNull();
  });

  it("forbids reading another user's job", async () => {
    const owner = await registerAndLogin();
    const other = await registerAndLogin();
    const submit = await request(app)
      .post("/api/execute")
      .set(auth(owner))
      .send({ language: "python", source: "print(1)" });

    const res = await request(app)
      .get(`/api/execute/${submit.body.jobId}`)
      .set(auth(other));
    expect(res.status).toBe(403);
  });

  it("404s an unknown job", async () => {
    const token = await registerAndLogin();
    const res = await request(app)
      .get("/api/execute/does-not-exist")
      .set(auth(token));
    expect(res.status).toBe(404);
  });
});
