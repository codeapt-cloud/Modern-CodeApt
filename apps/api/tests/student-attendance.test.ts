/**
 * STUDENT attendance view (own-data-only). supertest + in-memory Mongo. Proves:
 * a student's own % over COMPLETED sessions (scheduled-not-taken excluded), the
 * per-group + present/absent session history, that each student sees ONLY their
 * own data (no id param — the caller's id is authoritative), the no-data→null
 * (not 0%) state, the feature gate, and cross-tenant denial.
 */
import { Role, UserType } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { UserModel } from "../src/models/user.model.js";
import * as colleges from "../src/services/college.service.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let seq = 0;
async function makeUser(fields?: {
  role?: string;
  userType?: string;
  college?: Types.ObjectId | null;
  orgUnit?: Types.ObjectId | null;
  rollNumber?: string;
}): Promise<{ token: string; userId: string }> {
  seq += 1;
  const u = `sat${seq}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Sat User ${seq}`,
      rollNumber: `SATU-${seq}`,
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

let collegeSeq = 0;
async function setupCollege(opts: { attendance?: boolean } = {}) {
  collegeSeq += 1;
  const slug = `sat-col-${collegeSeq}`;
  const platform = await makeUser({ role: Role.SUPER_ADMIN });
  const dto = await colleges.createCollege({ name: slug, slug }, platform.userId);
  if (opts.attendance) {
    await colleges.setEntitlements(dto.id, { features: { attendance: true } });
  }
  const admin = await makeUser({
    role: Role.COLLEGE_ADMIN,
    userType: UserType.COLLEGE,
    college: new Types.ObjectId(dto.id),
  });
  return { collegeId: dto.id, slug, adminToken: admin.token };
}

async function createUnit(
  slug: string,
  token: string,
  body: { type: string; name: string; parentId?: string },
): Promise<string> {
  const res = await request(app)
    .post(`/api/c/${slug}/org-units`)
    .set(auth(token))
    .send(body);
  expect(res.status).toBe(201);
  return res.body.id as string;
}

let rollSeq = 0;
async function makeStudent(
  collegeId: string,
  unitId: string,
): Promise<{ token: string; userId: string }> {
  rollSeq += 1;
  return makeUser({
    role: Role.STUDENT,
    userType: UserType.COLLEGE,
    college: new Types.ObjectId(collegeId),
    orgUnit: new Types.ObjectId(unitId),
    rollNumber: `SAR-${rollSeq}`,
  });
}

const myUrl = (slug: string) => `/api/c/${slug}/student/attendance`;

// ---------------------------------------------------------------------------

describe("student attendance (own data, completed sessions)", () => {
  it("computes overall + per-group + history; each student sees only their own", async () => {
    const { collegeId, slug, adminToken } = await setupCollege({ attendance: true });
    const sectionA = await createUnit(slug, adminToken, {
      type: "section",
      name: "A",
    });
    const a = await makeStudent(collegeId, sectionA);
    const b = await makeStudent(collegeId, sectionA);

    // A group over section A (both students are members).
    const grp = await request(app)
      .post(`/api/c/${slug}/attendance/groups`)
      .set(auth(adminToken))
      .send({ name: "Being Zero", orgUnitIds: [sectionA] });
    expect(grp.status).toBe(201);
    const groupId = grp.body.id as string;

    const takeSession = async (
      at: string,
      present: string[],
    ): Promise<void> => {
      const s = await request(app)
        .post(`/api/c/${slug}/attendance/groups/${groupId}/sessions`)
        .set(auth(adminToken))
        .send({ scheduledAt: at });
      expect(s.status).toBe(201);
      const save = await request(app)
        .put(`/api/c/${slug}/attendance/sessions/${s.body.id}/attendance`)
        .set(auth(adminToken))
        .send({ marks: present.map((id) => ({ studentId: id, status: "present" })) });
      expect(save.status).toBe(200);
    };

    await takeSession("2026-09-01T04:30:00.000Z", [a.userId, b.userId]); // A present, B present
    await takeSession("2026-09-02T04:30:00.000Z", [b.userId]); // A absent, B present
    // A scheduled-but-never-taken session — must NOT count.
    await request(app)
      .post(`/api/c/${slug}/attendance/groups/${groupId}/sessions`)
      .set(auth(adminToken))
      .send({ scheduledAt: "2026-09-03T04:30:00.000Z" });

    // Student A: 1 of 2 → 50%.
    const resA = await request(app).get(myUrl(slug)).set(auth(a.token));
    expect(resA.status).toBe(200);
    expect(resA.body.overall).toEqual({ attended: 1, total: 2, rate: 50 });
    expect(resA.body.groups).toHaveLength(1);
    expect(resA.body.groups[0]).toMatchObject({ attended: 1, total: 2, rate: 50 });
    expect(resA.body.sessions).toHaveLength(2);
    const statuses = resA.body.sessions.map((s: { status: string }) => s.status).sort();
    expect(statuses).toEqual(["absent", "present"]);

    // Student B: 2 of 2 → 100% (their OWN data, not A's).
    const resB = await request(app).get(myUrl(slug)).set(auth(b.token));
    expect(resB.body.overall).toEqual({ attended: 2, total: 2, rate: 100 });
  });

  it("no data → rate null (never a fake 0%)", async () => {
    const { collegeId, slug } = await setupCollege({ attendance: true });
    const sectionA = new Types.ObjectId().toString();
    const loner = await makeStudent(collegeId, sectionA); // in no group
    const res = await request(app).get(myUrl(slug)).set(auth(loner.token));
    expect(res.status).toBe(200);
    expect(res.body.overall).toEqual({ attended: 0, total: 0, rate: null });
    expect(res.body.groups).toEqual([]);
    expect(res.body.sessions).toEqual([]);
  });
});

describe("student attendance guards", () => {
  it("403s when the college lacks the attendance feature", async () => {
    const { collegeId, slug } = await setupCollege({ attendance: false });
    const student = await makeUser({
      role: Role.STUDENT,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(collegeId),
    });
    const res = await request(app).get(myUrl(slug)).set(auth(student.token));
    expect(res.status).toBe(403);
  });

  it("denies a student reading another college's tenant space", async () => {
    const colA = await setupCollege({ attendance: true });
    const studentA = await makeUser({
      role: Role.STUDENT,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(colA.collegeId),
    });
    const colB = await setupCollege({ attendance: true });
    // Student of college A hitting college B's slug → cross-tenant denial.
    const res = await request(app)
      .get(myUrl(colB.slug))
      .set(auth(studentA.token));
    expect(res.status).toBe(403);
  });
});
