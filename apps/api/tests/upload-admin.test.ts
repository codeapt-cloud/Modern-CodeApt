/**
 * Signed-upload signature endpoint (image storage). supertest + in-memory Mongo.
 * Asserts the response SHAPE, that the signature is correct (recomputed with
 * node crypto against the returned timestamp), that the api_secret is NEVER in
 * the response, and the admin guard. The real Cloudinary API is never hit — we
 * only exercise the signature the server issues.
 */
import { createHash } from "node:crypto";
import type { Express } from "express";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { UserModel } from "../src/models/user.model.js";

// Mirrors the test creds set in tests/setup.ts.
const SECRET = "test-secret-must-never-leak-xyz";
const API_KEY = "test-api-key-123";

let app: Express;
beforeAll(() => {
  app = createApp();
});

let counter = 0;
async function registerAndLogin(role?: "admin"): Promise<{ token: string }> {
  counter += 1;
  const u = `up${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Upload ${counter}`,
      rollNumber: `UP-${counter}`,
      collegeName: "Acme",
      phoneNumber: "9999999999",
      state: "KA",
    });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ identifier: u, password: "Password123" });
  if (role === "admin") {
    await UserModel.updateOne(
      { _id: res.body.user.id },
      { $set: { role: "admin" } },
    );
    const relog = await request(app)
      .post("/api/auth/login")
      .send({ identifier: u, password: "Password123" });
    return { token: relog.body.accessToken as string };
  }
  return { token: res.body.accessToken as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("upload signature — issue", () => {
  it("returns the public config + a valid signature (no secret)", async () => {
    const { token } = await registerAndLogin("admin");
    const res = await request(app)
      .post("/api/admin/uploads/signature")
      .set(auth(token));
    expect(res.status).toBe(200);

    const { cloudName, apiKey, timestamp, folder, signature } = res.body;
    expect(cloudName).toBe("test-cloud");
    expect(apiKey).toBe(API_KEY);
    expect(folder).toBe("codeapt");
    expect(Number.isInteger(timestamp)).toBe(true);
    expect(signature).toMatch(/^[a-f0-9]{40}$/);

    // The signature is the SHA-1 of the sorted signed params + api_secret.
    const expected = createHash("sha1")
      .update(`folder=${folder}&timestamp=${timestamp}${SECRET}`)
      .digest("hex");
    expect(signature).toBe(expected);
  });

  it("NEVER includes the api_secret anywhere in the response", async () => {
    const { token } = await registerAndLogin("admin");
    const res = await request(app)
      .post("/api/admin/uploads/signature")
      .set(auth(token));
    expect(res.status).toBe(200);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(SECRET);
    expect(res.body.apiSecret).toBeUndefined();
    expect(res.body.api_secret).toBeUndefined();
  });
});

describe("upload signature — guard", () => {
  it("rejects a non-admin (403)", async () => {
    const { token } = await registerAndLogin();
    const res = await request(app)
      .post("/api/admin/uploads/signature")
      .set(auth(token));
    expect(res.status).toBe(403);
  });

  it("rejects an unauthenticated caller (401)", async () => {
    const res = await request(app).post("/api/admin/uploads/signature");
    expect(res.status).toBe(401);
  });
});
