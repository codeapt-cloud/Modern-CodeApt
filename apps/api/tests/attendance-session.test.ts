/**
 * Attendance SESSIONS + taking attendance (Prompt 2). supertest + in-memory
 * Mongo. Proves: scheduled AND ad-hoc session creation; the roster returns the
 * group's members + their marks (default absent/unmarked); save upserts one
 * record per (session, student) and completes the session; a re-save CORRECTS
 * without duplicating records; two groups hold sessions at the SAME date/time
 * independently; owner/creator/admin authority (a non-owner faculty is denied);
 * the feature gate; and cross-tenant isolation.
 */
import { AttendanceSessionStatus, Role, UserType } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { AttendanceRecordModel } from "../src/models/attendance-session.model.js";
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
}): Promise<{ token: string; userId: string }> {
  seq += 1;
  const u = `ses${seq}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Ses User ${seq}`,
      rollNumber: `SESU-${seq}`,
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
async function setupCollege(opts: { attendance?: boolean } = {}): Promise<{
  collegeId: string;
  slug: string;
  adminToken: string;
}> {
  collegeSeq += 1;
  const slug = `ses-col-${collegeSeq}`;
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

let studentSeq = 0;
async function addStudents(
  collegeId: string,
  unitId: string,
  n: number,
): Promise<{ id: string; roll: string }[]> {
  const docs = [];
  const rolls: string[] = [];
  for (let i = 0; i < n; i += 1) {
    studentSeq += 1;
    const roll = `SR-${studentSeq}`;
    rolls.push(roll);
    docs.push({
      username: `${roll}@x.edu`,
      email: `${roll}@x.edu`,
      passwordHash: "x",
      role: Role.STUDENT,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(collegeId),
      orgUnit: new Types.ObjectId(unitId),
      rollNumber: roll,
    });
  }
  const created = await UserModel.insertMany(docs);
  return created.map((u, i) => ({ id: u._id.toString(), roll: rolls[i]! }));
}

/** A college (attendance on) + a group of `n` students; returns ids/tokens. */
async function setupGroup(
  n: number,
  opts: { ownerId?: string } = {},
): Promise<{
  collegeId: string;
  slug: string;
  adminToken: string;
  groupId: string;
  students: { id: string; roll: string }[];
}> {
  const { collegeId, slug, adminToken } = await setupCollege({ attendance: true });
  const dept = await createUnit(slug, adminToken, { type: "department", name: "CSE" });
  const sectionA = await createUnit(slug, adminToken, {
    type: "section",
    name: "A",
    parentId: dept,
  });
  const students = await addStudents(collegeId, sectionA, n);
  const created = await request(app)
    .post(`/api/c/${slug}/attendance/groups`)
    .set(auth(adminToken))
    .send({
      name: `Group ${collegeSeq}`,
      orgUnitIds: [sectionA],
      facultyOwnerIds: opts.ownerId ? [opts.ownerId] : undefined,
    });
  expect(created.status).toBe(201);
  return { collegeId, slug, adminToken, groupId: created.body.id, students };
}

const sessionsUrl = (slug: string, groupId: string) =>
  `/api/c/${slug}/attendance/groups/${groupId}/sessions`;
const sessionUrl = (slug: string, id: string) =>
  `/api/c/${slug}/attendance/sessions/${id}`;

const AT = "2026-09-01T04:30:00.000Z";

// ---------------------------------------------------------------------------

describe("session creation (scheduled + ad-hoc)", () => {
  it("creates a scheduled session and an ad-hoc 'now' session", async () => {
    const { slug, adminToken, groupId } = await setupGroup(3);

    const scheduled = await request(app)
      .post(sessionsUrl(slug, groupId))
      .set(auth(adminToken))
      .send({ scheduledAt: AT, title: "Week 1" });
    expect(scheduled.status).toBe(201);
    expect(scheduled.body.status).toBe(AttendanceSessionStatus.SCHEDULED);
    expect(scheduled.body.total).toBe(3);
    expect(scheduled.body.recorded).toBe(false);

    const adhoc = await request(app)
      .post(sessionsUrl(slug, groupId))
      .set(auth(adminToken))
      .send({});
    expect(adhoc.status).toBe(201);
    expect(adhoc.body.status).toBe(AttendanceSessionStatus.OPEN);

    const list = await request(app)
      .get(sessionsUrl(slug, groupId))
      .set(auth(adminToken));
    expect(list.body.items).toHaveLength(2);
  });
});

describe("roster + save (upsert, complete, correct)", () => {
  it("returns the roster, saves marks (one record/student), completes, corrects", async () => {
    const { slug, adminToken, groupId, students } = await setupGroup(3);
    const [s1, s2, s3] = students;

    const created = await request(app)
      .post(sessionsUrl(slug, groupId))
      .set(auth(adminToken))
      .send({});
    const sessionId = created.body.id as string;

    // Roster: 3 members, all unmarked (default absent).
    const roster = await request(app)
      .get(sessionUrl(slug, sessionId))
      .set(auth(adminToken));
    expect(roster.status).toBe(200);
    expect(roster.body.entries).toHaveLength(3);
    expect(roster.body.entries.every((e: { marked: boolean }) => !e.marked)).toBe(true);

    // Save: s1 + s2 present (s3 omitted → defaults absent).
    const save = await request(app)
      .put(`${sessionUrl(slug, sessionId)}/attendance`)
      .set(auth(adminToken))
      .send({
        marks: [
          { studentId: s1!.id, status: "present" },
          { studentId: s2!.id, status: "present" },
        ],
      });
    expect(save.status).toBe(200);
    expect(save.body.session.status).toBe(AttendanceSessionStatus.COMPLETED);
    expect(save.body.session.presentCount).toBe(2);
    expect(save.body.session.absentCount).toBe(1);

    // Exactly one record per student (3), no duplicates.
    expect(
      await AttendanceRecordModel.countDocuments({
        session: new Types.ObjectId(sessionId),
      }),
    ).toBe(3);

    // Re-save corrects: everyone absent now.
    const correct = await request(app)
      .put(`${sessionUrl(slug, sessionId)}/attendance`)
      .set(auth(adminToken))
      .send({ marks: [{ studentId: s3!.id, status: "absent" }] });
    expect(correct.status).toBe(200);
    expect(correct.body.session.presentCount).toBe(0);
    expect(
      await AttendanceRecordModel.countDocuments({
        session: new Types.ObjectId(sessionId),
      }),
    ).toBe(3); // still 3 — upsert, not insert
  });
});

describe("simultaneous sessions of different groups", () => {
  it("two groups hold sessions at the same date/time independently", async () => {
    const g1 = await setupGroup(2);
    const g2 = await setupGroup(2);

    const a = await request(app)
      .post(sessionsUrl(g1.slug, g1.groupId))
      .set(auth(g1.adminToken))
      .send({ scheduledAt: AT });
    const b = await request(app)
      .post(sessionsUrl(g2.slug, g2.groupId))
      .set(auth(g2.adminToken))
      .send({ scheduledAt: AT });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    // Each is taken independently — no conflict.
    const saveA = await request(app)
      .put(`${sessionUrl(g1.slug, a.body.id)}/attendance`)
      .set(auth(g1.adminToken))
      .send({ marks: [{ studentId: g1.students[0]!.id, status: "present" }] });
    const saveB = await request(app)
      .put(`${sessionUrl(g2.slug, b.body.id)}/attendance`)
      .set(auth(g2.adminToken))
      .send({ marks: [{ studentId: g2.students[0]!.id, status: "present" }] });
    expect(saveA.body.session.presentCount).toBe(1);
    expect(saveB.body.session.presentCount).toBe(1);
  });
});

describe("owner/scope authority", () => {
  it("only the group's owner/creator/admin may run its sessions", async () => {
    const { collegeId, slug, adminToken, groupId } = await setupGroup(2);

    // A faculty who is NOT an owner/creator of the group.
    const outsider = await makeUser({
      role: Role.FACULTY,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(collegeId),
    });
    const denied = await request(app)
      .get(sessionsUrl(slug, groupId))
      .set(auth(outsider.token));
    expect(denied.status).toBe(404); // indistinguishable from "not found"

    const deniedCreate = await request(app)
      .post(sessionsUrl(slug, groupId))
      .set(auth(outsider.token))
      .send({});
    expect(deniedCreate.status).toBe(404);

    // Admin can, of course.
    const ok = await request(app)
      .post(sessionsUrl(slug, groupId))
      .set(auth(adminToken))
      .send({});
    expect(ok.status).toBe(201);
  });

  it("a named faculty OWNER may run the group's sessions", async () => {
    const grp = await setupGroup(2);
    // A faculty in the group's college, granted ownership via the group update.
    const owner = await makeUser({
      role: Role.FACULTY,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(grp.collegeId),
    });
    const upd = await request(app)
      .patch(`/api/c/${grp.slug}/attendance/groups/${grp.groupId}`)
      .set(auth(grp.adminToken))
      .send({ facultyOwnerIds: [owner.userId] });
    expect(upd.status).toBe(200);

    const created = await request(app)
      .post(sessionsUrl(grp.slug, grp.groupId))
      .set(auth(owner.token))
      .send({});
    expect(created.status).toBe(201);
  });
});

describe("feature gate + tenant isolation", () => {
  it("403s sessions for a college without the attendance feature", async () => {
    const { slug, adminToken } = await setupCollege({ attendance: false });
    const res = await request(app)
      .get(sessionsUrl(slug, new Types.ObjectId().toString()))
      .set(auth(adminToken));
    expect(res.status).toBe(403);
  });

  it("a college cannot read another college's session", async () => {
    const g1 = await setupGroup(2);
    const created = await request(app)
      .post(sessionsUrl(g1.slug, g1.groupId))
      .set(auth(g1.adminToken))
      .send({});
    const sessionId = created.body.id as string;

    const other = await setupCollege({ attendance: true });
    const cross = await request(app)
      .get(sessionUrl(other.slug, sessionId))
      .set(auth(other.adminToken));
    expect(cross.status).toBe(404);
  });
});
