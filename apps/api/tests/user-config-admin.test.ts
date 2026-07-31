/**
 * CRUD Batch 2 — user CONFIG mutations. supertest + in-memory Mongo.
 * activate/deactivate (+ self-guard), role change (+ self-guard), profile edit
 * (+ duplicate-roll), unenroll (progress preserved), the LAST_ADMIN guard (tested
 * at the service level — the controller's caller is always an active admin, so
 * it's unreachable via HTTP), the hard-exceptions (no passwordHash/tokenVersion
 * exposed or editable), and the admin guard.
 */
import { Role } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import {
  EnrollmentModel,
  TopicProgressModel,
} from "../src/models/curriculum.model.js";
import { UserModel } from "../src/models/user.model.js";
import * as userAdmin from "../src/services/user-admin.service.js";

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
  const u = `uc${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `User Config ${counter}`,
      rollNumber: `UC-${counter}`,
      collegeName: "Acme",
      phoneNumber: "9999999999",
      state: "KA",
    });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ identifier: u, password: "Password123" });
  const userId = res.body.user.id as string;
  if (role === "admin") {
    await UserModel.updateOne({ _id: userId }, { $set: { role: "admin" } });
    const relog = await request(app)
      .post("/api/auth/login")
      .send({ identifier: u, password: "Password123" });
    return { token: relog.body.accessToken as string, userId };
  }
  return { token: res.body.accessToken as string, userId };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("user config — activate / deactivate", () => {
  it("deactivates then reactivates a student", async () => {
    const { token } = await registerAndLogin("admin");
    const student = await registerAndLogin();
    const off = await request(app)
      .post(`/api/admin/users/${student.userId}/active`)
      .set(auth(token))
      .send({ isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.isActive).toBe(false);

    const on = await request(app)
      .post(`/api/admin/users/${student.userId}/active`)
      .set(auth(token))
      .send({ isActive: true });
    expect(on.body.isActive).toBe(true);
  });

  it("blocks self-deactivate and self-role-change", async () => {
    const { token, userId } = await registerAndLogin("admin");
    const selfOff = await request(app)
      .post(`/api/admin/users/${userId}/active`)
      .set(auth(token))
      .send({ isActive: false });
    expect(selfOff.status).toBe(400);
    expect(selfOff.body.error.code).toBe("SELF_ACTION_FORBIDDEN");

    const selfRole = await request(app)
      .post(`/api/admin/users/${userId}/role`)
      .set(auth(token))
      .send({ role: "student" });
    expect(selfRole.status).toBe(400);
    expect(selfRole.body.error.code).toBe("SELF_ACTION_FORBIDDEN");
  });
});

describe("user config — role change", () => {
  it("promotes a student to admin and back", async () => {
    const { token } = await registerAndLogin("admin");
    const student = await registerAndLogin();
    const up = await request(app)
      .post(`/api/admin/users/${student.userId}/role`)
      .set(auth(token))
      .send({ role: "admin" });
    expect(up.status).toBe(200);
    expect(up.body.role).toBe("admin");

    const down = await request(app)
      .post(`/api/admin/users/${student.userId}/role`)
      .set(auth(token))
      .send({ role: "student" });
    expect(down.body.role).toBe("student");
  });
});

describe("user config — profile edit", () => {
  it("edits editable fields and rejects a duplicate roll number", async () => {
    const { token } = await registerAndLogin("admin");
    const s1 = await registerAndLogin();
    const s2 = await registerAndLogin();

    const s2Detail = await request(app)
      .get(`/api/admin/users/${s2.userId}`)
      .set(auth(token));
    const s2Roll = s2Detail.body.profile.rollNumber as string;

    const ok = await request(app)
      .patch(`/api/admin/users/${s1.userId}/profile`)
      .set(auth(token))
      .send({
        fullName: "Renamed Student",
        collegeName: "New College",
        rollNumber: "UNIQUE-ROLL-1",
        phoneNumber: "8888888888",
        state: "TN",
        bio: "hi",
      });
    expect(ok.status).toBe(200);
    expect(ok.body.profile.fullName).toBe("Renamed Student");
    expect(ok.body.profile.collegeName).toBe("New College");

    const dup = await request(app)
      .patch(`/api/admin/users/${s1.userId}/profile`)
      .set(auth(token))
      .send({ fullName: "Renamed Student", rollNumber: s2Roll });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("ROLL_TAKEN");
  });

  it("does not expose passwordHash or tokenVersion on the detail", async () => {
    const { token } = await registerAndLogin("admin");
    const student = await registerAndLogin();
    const res = await request(app)
      .get(`/api/admin/users/${student.userId}`)
      .set(auth(token));
    expect(res.body.passwordHash).toBeUndefined();
    expect(res.body.tokenVersion).toBeUndefined();
    expect(res.body.profile.passwordHash).toBeUndefined();
  });
});

describe("user config — unenroll (progress preserved)", () => {
  it("removes the enrollment but keeps topic progress", async () => {
    const { token } = await registerAndLogin("admin");
    const student = await registerAndLogin();
    const uid = new Types.ObjectId(student.userId);
    const subjectId = new Types.ObjectId();
    await EnrollmentModel.create({
      user: uid,
      subject: subjectId,
      source: "manual",
    });
    await TopicProgressModel.create({
      user: uid,
      topic: new Types.ObjectId(),
      isCompleted: true,
    });

    const detail = await request(app)
      .get(`/api/admin/users/${student.userId}`)
      .set(auth(token));
    const enrollmentId = detail.body.enrollments[0].id as string;

    const res = await request(app)
      .delete(`/api/admin/users/${student.userId}/enrollments/${enrollmentId}`)
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.stats.enrollments).toBe(0);
    // Enrollment gone …
    expect(await EnrollmentModel.countDocuments({ user: uid })).toBe(0);
    // … but learning history preserved.
    expect(await TopicProgressModel.countDocuments({ user: uid })).toBe(1);
  });
});

describe("user config — last-admin guard (service level)", () => {
  it("blocks deactivating / demoting the last active admin", async () => {
    // Clean DB per test → this admin is the only one.
    const lone = await registerAndLogin("admin");
    const actor = new Types.ObjectId().toString(); // not the target → self-check passes
    await expect(
      userAdmin.setUserActive(actor, lone.userId, false),
    ).rejects.toMatchObject({ code: "LAST_ADMIN" });
    await expect(
      userAdmin.setUserRole(actor, lone.userId, Role.STUDENT),
    ).rejects.toMatchObject({ code: "LAST_ADMIN" });
  });
});

describe("user config — guard", () => {
  it("rejects a non-admin (403)", async () => {
    const student = await registerAndLogin();
    const res = await request(app)
      .post(`/api/admin/users/${student.userId}/active`)
      .set(auth(student.token))
      .send({ isActive: false });
    expect(res.status).toBe(403);
  });
});
