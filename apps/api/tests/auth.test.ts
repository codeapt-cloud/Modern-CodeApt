/**
 * Auth & Profile integration tests (supertest + in-memory Mongo).
 * Covers the full matrix from the Step 2 spec.
 */
import { AuthErrorCode, Role } from "@codeapt/shared";
import type { Express } from "express";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { hashPassword } from "../src/lib/password.js";
import { ProfileModel, UserModel } from "../src/models/user.model.js";

let app: Express;

beforeAll(() => {
  app = createApp();
});

const validUser = {
  username: "alice",
  email: "alice@example.com",
  password: "Password123",
  fullName: "Alice Anderson",
  rollNumber: "CS-001",
  collegeName: "Acme Institute",
  phoneNumber: "9999999999",
  state: "Karnataka",
};

function register(overrides: Partial<typeof validUser> = {}) {
  return request(app)
    .post("/api/auth/register")
    .send({ ...validUser, ...overrides });
}

function loginWith(identifier: string, password: string) {
  return request(app).post("/api/auth/login").send({ identifier, password });
}

async function createAdmin(password = "AdminPass123") {
  const user = await UserModel.create({
    username: "rootadmin",
    email: "admin@example.com",
    passwordHash: await hashPassword(password),
    role: Role.ADMIN,
    forcePasswordChange: false,
  });
  await ProfileModel.create({
    user: user._id,
    fullName: "Root Admin",
    rollNumber: "ADMIN-1",
  });
  return user;
}

describe("POST /api/auth/register", () => {
  it("registers a student and returns user + profile (no tokens)", async () => {
    const res = await register();
    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe("alice");
    expect(res.body.user.role).toBe(Role.STUDENT);
    expect(res.body.profile.rollNumber).toBe("CS-001");
    expect(res.body.profile.avatarUrl).toContain("ui-avatars.com");
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("rejects a duplicate email with a field-level error", async () => {
    await register();
    const res = await register({ username: "alice2", rollNumber: "CS-002" });
    expect(res.status).toBe(409);
    expect(res.body.error.details.fields.email).toBeDefined();
  });

  it("rejects a duplicate rollNumber with a field-level error", async () => {
    await register();
    const res = await register({
      username: "alice3",
      email: "alice3@example.com",
    });
    expect(res.status).toBe(409);
    expect(res.body.error.details.fields.rollNumber).toBeDefined();
  });

  it("rejects a weak password with a validation error", async () => {
    const res = await register({ password: "weak" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /api/auth/login", () => {
  it("logs in by email, sets cookies, returns tokens", async () => {
    await register();
    const res = await loginWith("alice@example.com", "Password123");
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.user.forcePasswordChange).toBe(false);
    const cookies = res.headers["set-cookie"] as unknown as string[];
    expect(cookies.join(";")).toContain("access_token");
    expect(cookies.join(";")).toContain("refresh_token");
  });

  it("logs in by username", async () => {
    await register();
    const res = await loginWith("alice", "Password123");
    expect(res.status).toBe(200);
  });

  it("returns the SAME generic error for wrong password and unknown user", async () => {
    await register();
    const wrongPass = await loginWith("alice@example.com", "WrongPass123");
    const unknown = await loginWith("ghost@example.com", "Password123");
    expect(wrongPass.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrongPass.body.error.code).toBe(AuthErrorCode.INVALID_CREDENTIALS);
    expect(unknown.body.error.code).toBe(AuthErrorCode.INVALID_CREDENTIALS);
    expect(wrongPass.body.error.message).toBe(unknown.body.error.message);
  });
});

describe("GET /api/me", () => {
  it("returns the current user with a Bearer token", async () => {
    await register();
    const { body } = await loginWith("alice", "Password123");
    const res = await request(app)
      .get("/api/me")
      .set("Authorization", `Bearer ${body.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("alice@example.com");
    expect(res.body.profile.fullName).toBe("Alice Anderson");
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(AuthErrorCode.UNAUTHENTICATED);
  });
});

describe("PATCH /api/me", () => {
  it("updates profile fields and email", async () => {
    await register();
    const { body } = await loginWith("alice", "Password123");
    const res = await request(app)
      .patch("/api/me")
      .set("Authorization", `Bearer ${body.accessToken}`)
      .send({ fullName: "Alice B", email: "alice.b@example.com" });
    expect(res.status).toBe(200);
    expect(res.body.profile.fullName).toBe("Alice B");
    expect(res.body.user.email).toBe("alice.b@example.com");
  });

  it("rejects an email already taken by another user", async () => {
    await register();
    await register({
      username: "bob",
      email: "bob@example.com",
      rollNumber: "CS-009",
    });
    const { body } = await loginWith("bob", "Password123");
    const res = await request(app)
      .patch("/api/me")
      .set("Authorization", `Bearer ${body.accessToken}`)
      .send({ email: "alice@example.com" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe(AuthErrorCode.EMAIL_TAKEN);
  });
});

describe("refresh rotation + reuse detection", () => {
  it("rotates tokens and rejects a replayed refresh token", async () => {
    await register();
    const { body: login } = await loginWith("alice", "Password123");
    const r1 = login.refreshToken as string;

    const first = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: r1 });
    expect(first.status).toBe(200);
    const r2 = first.body.refreshToken as string;
    expect(r2).not.toBe(r1);

    // Replaying the old token is detected and kills the session.
    const replay = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: r1 });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe(AuthErrorCode.TOKEN_REUSE_DETECTED);

    // The rotated token is now useless too (session revoked).
    const afterReuse = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: r2 });
    expect(afterReuse.status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("revokes the session so its refresh token stops working", async () => {
    await register();
    const { body } = await loginWith("alice", "Password123");
    const refreshToken = body.refreshToken as string;

    const out = await request(app)
      .post("/api/auth/logout")
      .send({ refreshToken });
    expect(out.status).toBe(200);

    const res = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken });
    expect(res.status).toBe(401);
  });
});

describe("change-password + forced-password-change guard", () => {
  it("blocks protected routes until the password is changed, then clears the flag", async () => {
    await register({
      username: "carol",
      email: "carol@example.com",
      rollNumber: "CS-777",
    });
    await UserModel.updateOne(
      { username: "carol" },
      { forcePasswordChange: true },
    );

    const { body: login } = await loginWith("carol", "Password123");
    expect(login.user.forcePasswordChange).toBe(true);
    const oldAccess = login.accessToken as string;

    // Guard blocks /api/me.
    const blocked = await request(app)
      .get("/api/me")
      .set("Authorization", `Bearer ${oldAccess}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe(AuthErrorCode.FORCE_PASSWORD_CHANGE);

    // change-password is reachable despite the flag.
    const changed = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${oldAccess}`)
      .send({
        currentPassword: "Password123",
        newPassword: "NewPassw0rd",
        confirmPassword: "NewPassw0rd",
      });
    expect(changed.status).toBe(200);
    expect(changed.body.user.forcePasswordChange).toBe(false);

    // New token works; old token is revoked (tokenVersion bumped).
    const ok = await request(app)
      .get("/api/me")
      .set("Authorization", `Bearer ${changed.body.accessToken}`);
    expect(ok.status).toBe(200);

    const revoked = await request(app)
      .get("/api/me")
      .set("Authorization", `Bearer ${oldAccess}`);
    expect(revoked.status).toBe(401);
    expect(revoked.body.error.code).toBe(AuthErrorCode.TOKEN_REVOKED);
  });

  it("rejects change-password when the current password is wrong", async () => {
    await register();
    const { body } = await loginWith("alice", "Password123");
    const res = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${body.accessToken}`)
      .send({
        currentPassword: "WrongPass123",
        newPassword: "NewPassw0rd",
        confirmPassword: "NewPassw0rd",
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(AuthErrorCode.INVALID_CREDENTIALS);
  });
});

describe("role guard (admin-only route)", () => {
  it("allows an admin and rejects a student", async () => {
    await createAdmin();
    const { body: admin } = await loginWith(
      "admin@example.com",
      "AdminPass123",
    );
    const adminRes = await request(app)
      .get("/api/admin/ping")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(adminRes.status).toBe(200);
    expect(adminRes.body.ok).toBe(true);

    await register();
    const { body: student } = await loginWith("alice", "Password123");
    const studentRes = await request(app)
      .get("/api/admin/ping")
      .set("Authorization", `Bearer ${student.accessToken}`);
    expect(studentRes.status).toBe(403);
    expect(studentRes.body.error.code).toBe(AuthErrorCode.FORBIDDEN);
  });
});
