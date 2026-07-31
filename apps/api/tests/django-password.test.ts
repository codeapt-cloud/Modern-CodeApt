/**
 * Django password-hash verification + transparent upgrade (migration support).
 *
 * Unit: verifyDjangoPassword against genuine `pbkdf2_sha256` hashes generated
 * here with node:crypto (a real round-trip), plus malformed-input hardening.
 * Integration: a user whose stored hash is a Django hash logs in with the
 * correct password and is transparently upgraded to argon2; wrong password
 * fails; a native-hash user still logs in (no regression).
 */
import { pbkdf2Sync } from "node:crypto";
import type { Express } from "express";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import {
  isDjangoPasswordHash,
  verifyDjangoPassword,
} from "../src/lib/django-password.js";
import { UserModel } from "../src/models/user.model.js";

/** Build a genuine Django-format hash (pbkdf2_sha256) for a password. */
function makeDjangoHash(
  password: string,
  salt = "abcdefghij123456",
  iterations = 100_000,
): string {
  const dk = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  return `pbkdf2_sha256$${iterations}$${salt}$${dk.toString("base64")}`;
}

describe("verifyDjangoPassword — unit", () => {
  it("returns true for the correct password, false for a wrong one", () => {
    const encoded = makeDjangoHash("CorrectHorse1");
    expect(verifyDjangoPassword("CorrectHorse1", encoded)).toBe(true);
    expect(verifyDjangoPassword("wrong-password", encoded)).toBe(false);
  });

  it("respects the stored iteration count (a hash from other iters won't match)", () => {
    const encoded = makeDjangoHash("SamePass9", "saltsaltsalt1234", 120_000);
    // Same password + salt but a different iteration count → different key.
    const other = makeDjangoHash("SamePass9", "saltsaltsalt1234", 100_000);
    expect(verifyDjangoPassword("SamePass9", encoded)).toBe(true);
    expect(encoded).not.toBe(other);
  });

  it("handles non-ASCII passwords (utf-8, as Django stores)", () => {
    const encoded = makeDjangoHash("pàsswörd-☕-123");
    expect(verifyDjangoPassword("pàsswörd-☕-123", encoded)).toBe(true);
    expect(verifyDjangoPassword("passwverd-123", encoded)).toBe(false);
  });

  it("returns false (never throws) for malformed / unknown-algo input", () => {
    const good = makeDjangoHash("x");
    const cases = [
      "", // empty
      "not-a-hash",
      "pbkdf2_sha256$100000$onlythreeparts", // missing hash segment
      "pbkdf2_sha256$100000$salt$", // empty hash
      "pbkdf2_sha256$notanumber$salt$aGVsbG8=", // non-numeric iterations
      "pbkdf2_sha256$0$salt$aGVsbG8=", // zero iterations
      "pbkdf2_sha1$100000$salt$aGVsbG8=", // unsupported Django algo → closed
      "bcrypt_sha256$100000$salt$aGVsbG8=", // unsupported Django algo → closed
      "$argon2id$v=19$m=65536,t=3,p=4$abc$def", // native argon2, not Django
      good.replace("pbkdf2_sha256", "pbkdf2_SHA256"), // wrong-case algo
    ];
    for (const c of cases) {
      expect(() => verifyDjangoPassword("x", c)).not.toThrow();
      expect(verifyDjangoPassword("x", c)).toBe(false);
    }
  });

  it("detects the Django prefix for routing", () => {
    expect(isDjangoPasswordHash(makeDjangoHash("y"))).toBe(true);
    expect(isDjangoPasswordHash("$argon2id$v=19$...")).toBe(false);
    expect(isDjangoPasswordHash("")).toBe(false);
  });
});

let app: Express;
beforeAll(() => {
  app = createApp();
});

let counter = 0;
async function register(password: string): Promise<{ username: string; userId: string }> {
  counter += 1;
  const username = `dj${counter}`;
  const res = await request(app)
    .post("/api/auth/register")
    .send({
      username,
      email: `${username}@example.com`,
      password,
      fullName: `Django User ${counter}`,
      rollNumber: `DJ-${counter}`,
      collegeName: "Acme",
      phoneNumber: "9999999999",
      state: "KA",
    });
  if (!res.body?.user?.id) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { username, userId: res.body.user.id as string };
}

describe("login — Django hash verification + transparent upgrade", () => {
  it("logs in a Django-hashed user and upgrades the stored hash to argon2", async () => {
    const djangoPassword = "MigratedPass123";
    const { username, userId } = await register("Throwaway123");
    // Simulate a migrated user: overwrite the native hash with a Django one.
    await UserModel.updateOne(
      { _id: userId },
      { passwordHash: makeDjangoHash(djangoPassword) },
    );

    const before = await UserModel.findById(userId).lean<{ passwordHash: string }>();
    expect(before!.passwordHash.startsWith("pbkdf2_sha256$")).toBe(true);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ identifier: username, password: djangoPassword });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();

    // Transparent upgrade: the stored hash is now the native argon2 format.
    const after = await UserModel.findById(userId).lean<{ passwordHash: string }>();
    expect(after!.passwordHash.startsWith("$argon2")).toBe(true);
    expect(after!.passwordHash.startsWith("pbkdf2_sha256$")).toBe(false);

    // And a subsequent login (now via the native path) still succeeds.
    const again = await request(app)
      .post("/api/auth/login")
      .send({ identifier: username, password: djangoPassword });
    expect(again.status).toBe(200);
  });

  it("rejects a wrong password against a Django hash (and does not upgrade)", async () => {
    const { username, userId } = await register("Throwaway123");
    const django = makeDjangoHash("TheRealPassword1");
    await UserModel.updateOne({ _id: userId }, { passwordHash: django });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ identifier: username, password: "not-the-password" });
    expect(res.status).toBe(401);

    const stored = await UserModel.findById(userId).lean<{ passwordHash: string }>();
    expect(stored!.passwordHash).toBe(django); // untouched
  });

  it("still logs in a native (argon2) user — no regression", async () => {
    const { username, userId } = await register("NativePass123");
    const stored = await UserModel.findById(userId).lean<{ passwordHash: string }>();
    expect(stored!.passwordHash.startsWith("$argon2")).toBe(true);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ identifier: username, password: "NativePass123" });
    expect(res.status).toBe(200);

    const after = await UserModel.findById(userId).lean<{ passwordHash: string }>();
    expect(after!.passwordHash).toBe(stored!.passwordHash); // unchanged
  });
});
