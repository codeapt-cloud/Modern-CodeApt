/**
 * College challenges (Phase 4d) — a tenant-scoped LEADERBOARD over the REUSED
 * daily-challenge engine (no fork: the daily challenge stays global, solved in
 * the shared learner experience). Proves: the college leaderboard shows only THIS
 * college's students, ranked by their daily-challenge standings; hard isolation
 * (College A's board never includes College B's students); feature-off → 403;
 * non-operator (student) → 403. The existing challenge suite (challenge.test.ts,
 * challenge-admin.test.ts) proves the individual/global daily-challenge flow is
 * byte-for-byte unchanged — this phase adds NO model/engine change. supertest +
 * in-memory Mongo, mirroring college-exams.test.ts.
 */
import { Role, UserType } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { UserStreakModel } from "../src/models/challenge.model.js";
import { UserModel } from "../src/models/user.model.js";
import * as colleges from "../src/services/college.service.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

const TEMP_PW = "CodeApt@123";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let counter = 0;
async function makeUser(fields?: {
  role?: string;
  userType?: string;
  college?: Types.ObjectId | null;
}): Promise<{ token: string; userId: string }> {
  counter += 1;
  const u = `cc${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `CC User ${counter}`,
      rollNumber: `CCU-${counter}`,
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

async function makeCollege(slug: string, createdBy: string): Promise<string> {
  const dto = await colleges.createCollege({ name: slug, slug }, createdBy);
  return dto.id;
}

async function setupCollege(
  slug: string,
  features: Record<string, boolean> = { challenges: true },
): Promise<{ collegeId: string; adminToken: string }> {
  const platform = await makeUser({ role: Role.SUPER_ADMIN });
  const collegeId = await makeCollege(slug, platform.userId);
  await colleges.setEntitlements(collegeId, { features });
  const admin = await makeUser({
    role: Role.COLLEGE_ADMIN,
    userType: UserType.COLLEGE,
    college: new Types.ObjectId(collegeId),
  });
  return { collegeId, adminToken: admin.token };
}

async function createUnit(
  slug: string,
  token: string,
  body: { type: string; name: string },
): Promise<string> {
  const res = await request(app)
    .post(`/api/c/${slug}/org-units`)
    .set(auth(token))
    .send(body);
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function addStudent(
  slug: string,
  token: string,
  email: string,
  roll: string,
  orgUnitId: string,
): Promise<{ id: string; token: string }> {
  const created = await request(app)
    .post(`/api/c/${slug}/students`)
    .set(auth(token))
    .send({ fullName: email, email, rollNumber: roll, orgUnitId });
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  await UserModel.updateOne({ _id: id }, { $set: { forcePasswordChange: false } });
  const login = await request(app)
    .post("/api/auth/login")
    .send({ identifier: email, password: TEMP_PW });
  return { id, token: login.body.accessToken as string };
}

/** Give a user a daily-challenge standing (as the engine would after solves). */
async function setStreak(
  userId: string,
  totalScore: number,
  currentStreak = 1,
  maxStreak = currentStreak,
): Promise<void> {
  await UserStreakModel.create({
    user: new Types.ObjectId(userId),
    totalScore,
    currentStreak,
    maxStreak,
  });
}

describe("College challenge leaderboard", () => {
  it("ranks only this college's students by their daily-challenge standing", async () => {
    const { adminToken } = await setupCollege("cca");
    const dept = await createUnit("cca", adminToken, {
      type: "department",
      name: "CSE",
    });
    const s1 = await addStudent("cca", adminToken, "s1@cca.edu", "R1", dept);
    const s2 = await addStudent("cca", adminToken, "s2@cca.edu", "R2", dept);
    await setStreak(s1.id, 30, 3);
    await setStreak(s2.id, 50, 5);

    const res = await request(app)
      .get(`/api/c/cca/challenges/leaderboard`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    // Ordered by totalScore desc → s2 (50) first, s1 (30) second.
    expect(res.body.rows.map((r: { rollNumber: string }) => r.rollNumber)).toEqual(
      ["R2", "R1"],
    );
    expect(res.body.rows[0].rank).toBe(1);
    expect(res.body.rows[0].totalScore).toBe(50);
    expect(res.body.rows[0].currentStreak).toBe(5);
  });

  it("is isolated: College A's board never includes College B's students", async () => {
    const a = await setupCollege("cca1");
    const b = await setupCollege("ccb1");
    const aDept = await createUnit("cca1", a.adminToken, {
      type: "department",
      name: "A",
    });
    const bDept = await createUnit("ccb1", b.adminToken, {
      type: "department",
      name: "B",
    });
    const aStu = await addStudent("cca1", a.adminToken, "a@cca1.edu", "A1", aDept);
    const bStu = await addStudent("ccb1", b.adminToken, "b@ccb1.edu", "B1", bDept);
    await setStreak(aStu.id, 40);
    await setStreak(bStu.id, 90); // higher score, but different college

    const res = await request(app)
      .get(`/api/c/cca1/challenges/leaderboard`)
      .set(auth(a.adminToken));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    const rolls = res.body.rows.map((r: { rollNumber: string }) => r.rollNumber);
    expect(rolls).toEqual(["A1"]);
    expect(rolls).not.toContain("B1");
  });

  it("feature off → 403", async () => {
    const { adminToken } = await setupCollege("ccf", { challenges: false });
    const res = await request(app)
      .get(`/api/c/ccf/challenges/leaderboard`)
      .set(auth(adminToken));
    expect(res.status).toBe(403);
  });

  it("a student (non-operator) cannot read the college leaderboard", async () => {
    const { adminToken } = await setupCollege("ccs");
    const dept = await createUnit("ccs", adminToken, {
      type: "department",
      name: "CSE",
    });
    const student = await addStudent("ccs", adminToken, "s@ccs.edu", "S1", dept);
    const res = await request(app)
      .get(`/api/c/ccs/challenges/leaderboard`)
      .set(auth(student.token));
    expect(res.status).toBe(403);
  });
});
