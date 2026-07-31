/**
 * Attendance module (Prompt 1) — group formation. supertest + in-memory Mongo.
 * Proves: the `attendance` feature gate; org-unit membership resolves to all
 * descendant students (section provenance for section units); the Excel
 * roll-number PREVIEW matches/leaves-unmatched and persists NOTHING; mixed
 * membership (org-unit + individual + Excel of the same student) de-dupes to one;
 * faculty scope is enforced (out-of-scope blocked without the cross-cutting
 * permission, allowed once an admin enables it); admins are unrestricted; the
 * settings endpoint is college_admin-only; and groups are tenant-isolated.
 */
import { Role, UserType } from "@codeapt/shared";
import ExcelJS from "exceljs";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { AttendanceGroupModel } from "../src/models/attendance-group.model.js";
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
  const u = `att${seq}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Att User ${seq}`,
      rollNumber: `ATTU-${seq}`,
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
  const slug = `att-col-${collegeSeq}`;
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

/** CSE › 2026 › {A,B}. */
async function seedTree(slug: string, token: string) {
  const dept = await createUnit(slug, token, { type: "department", name: "CSE" });
  const year = await createUnit(slug, token, {
    type: "year",
    name: "2026",
    parentId: dept,
  });
  const a = await createUnit(slug, token, {
    type: "section",
    name: "A",
    parentId: year,
  });
  const b = await createUnit(slug, token, {
    type: "section",
    name: "B",
    parentId: year,
  });
  return { dept, year, a, b };
}

let studentSeq = 0;
/** Insert college students in a unit; returns [{ id, roll }]. */
async function addStudents(
  collegeId: string,
  unitId: string,
  n: number,
): Promise<{ id: string; roll: string }[]> {
  const docs = [];
  const rolls: string[] = [];
  for (let i = 0; i < n; i += 1) {
    studentSeq += 1;
    const roll = `ATR-${studentSeq}`;
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

async function rollsXlsxBase64(rolls: string[]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Roll Numbers");
  ws.addRow(["roll_number"]);
  rolls.forEach((r) => ws.addRow([r]));
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out).toString("base64");
}

const groups = (slug: string) => `/api/c/${slug}/attendance/groups`;

// ---------------------------------------------------------------------------

describe("attendance feature gate", () => {
  it("403s a college without the attendance feature", async () => {
    const { slug, adminToken } = await setupCollege({ attendance: false });
    const res = await request(app)
      .post(groups(slug))
      .set(auth(adminToken))
      .send({ name: "Nope" });
    expect(res.status).toBe(403);
  });
});

describe("org-unit membership (descendants + provenance)", () => {
  it("resolves all students under a targeted unit + its descendants", async () => {
    const { collegeId, slug, adminToken } = await setupCollege({ attendance: true });
    const { year, a, b } = await seedTree(slug, adminToken);
    await addStudents(collegeId, a, 3);
    await addStudents(collegeId, b, 2);

    // Target the YEAR → all 5 students under A + B (source org_unit).
    const res = await request(app)
      .post(groups(slug))
      .set(auth(adminToken))
      .send({ name: "Whole Year", orgUnitIds: [year] });
    expect(res.status).toBe(201);
    expect(res.body.memberCount).toBe(5);
    expect(res.body.members.every((m: { source: string }) => m.source === "org_unit")).toBe(true);

    // Target SECTION A → 3 students, source `section`, ref = A.
    const res2 = await request(app)
      .post(groups(slug))
      .set(auth(adminToken))
      .send({ name: "Section A", orgUnitIds: [a] });
    expect(res2.status).toBe(201);
    expect(res2.body.memberCount).toBe(3);
    expect(res2.body.members[0].source).toBe("section");
    expect(res2.body.members[0].sourceRef).toBe(a);
  });
});

describe("Excel roll-number preview (matches, no persist)", () => {
  it("matches known rolls, leaves unknowns unmatched, and creates nothing", async () => {
    const { collegeId, slug, adminToken } = await setupCollege({ attendance: true });
    const { a } = await seedTree(slug, adminToken);
    const [s1, s2] = await addStudents(collegeId, a, 2);

    const fileBase64 = await rollsXlsxBase64([s1!.roll, s2!.roll, "GHOST-999"]);
    const res = await request(app)
      .post(`${groups(slug)}/import/preview`)
      .set(auth(adminToken))
      .send({ fileBase64 });
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ total: 3, matched: 2, unmatched: 1 });
    expect(res.body.unmatched).toEqual(["GHOST-999"]);
    expect(res.body.matched.map((m: { rollNumber: string }) => m.rollNumber).sort()).toEqual(
      [s1!.roll, s2!.roll].sort(),
    );

    // Nothing was persisted by the preview.
    expect(
      await AttendanceGroupModel.countDocuments({
        college: new Types.ObjectId(collegeId),
      }),
    ).toBe(0);
  });
});

describe("mixed membership de-dupes", () => {
  it("a student added via org-unit + individual + Excel counts once", async () => {
    const { collegeId, slug, adminToken } = await setupCollege({ attendance: true });
    const { a } = await seedTree(slug, adminToken);
    const [s1] = await addStudents(collegeId, a, 1);

    const res = await request(app)
      .post(groups(slug))
      .set(auth(adminToken))
      .send({
        name: "Overlap",
        orgUnitIds: [a],
        studentIds: [s1!.id],
        excelRollNumbers: [s1!.roll],
      });
    expect(res.status).toBe(201);
    expect(res.body.memberCount).toBe(1);
  });
});

describe("faculty scope + the cross-cutting permission", () => {
  it("blocks out-of-scope targets without the permission, allows with it", async () => {
    const { collegeId, slug, adminToken } = await setupCollege({ attendance: true });
    const { a, b } = await seedTree(slug, adminToken);
    await addStudents(collegeId, a, 1);
    await addStudents(collegeId, b, 1);

    const faculty = await makeUser({
      role: Role.FACULTY,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(collegeId),
    });
    await UserModel.updateOne(
      { _id: faculty.userId },
      { $set: { facultyScope: { orgUnits: [new Types.ObjectId(a)] } } },
    );

    // In-scope (section A) → allowed even without the permission.
    const inScope = await request(app)
      .post(groups(slug))
      .set(auth(faculty.token))
      .send({ name: "Fac A", orgUnitIds: [a] });
    expect(inScope.status).toBe(201);

    // Out-of-scope (section B) → 403 without the permission.
    const blocked = await request(app)
      .post(groups(slug))
      .set(auth(faculty.token))
      .send({ name: "Fac B", orgUnitIds: [b] });
    expect(blocked.status).toBe(403);

    // Admin turns ON the cross-cutting permission.
    const set = await request(app)
      .put(`/api/c/${slug}/attendance/settings`)
      .set(auth(adminToken))
      .send({ facultyCanFormCrossCuttingGroups: true });
    expect(set.status).toBe(200);
    expect(set.body.facultyCanFormCrossCuttingGroups).toBe(true);

    // Now the same out-of-scope group succeeds.
    const allowed = await request(app)
      .post(groups(slug))
      .set(auth(faculty.token))
      .send({ name: "Fac B2", orgUnitIds: [b] });
    expect(allowed.status).toBe(201);
  });

  it("admin is unrestricted; settings endpoint is college_admin-only", async () => {
    const { collegeId, slug, adminToken } = await setupCollege({ attendance: true });
    const { b } = await seedTree(slug, adminToken);
    await addStudents(collegeId, b, 2);

    // Admin targets any unit freely.
    const res = await request(app)
      .post(groups(slug))
      .set(auth(adminToken))
      .send({ name: "Admin Group", orgUnitIds: [b] });
    expect(res.status).toBe(201);
    expect(res.body.memberCount).toBe(2);

    // A scoped faculty may NOT change the cross-cutting setting.
    const faculty = await makeUser({
      role: Role.FACULTY,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(collegeId),
    });
    const denied = await request(app)
      .put(`/api/c/${slug}/attendance/settings`)
      .set(auth(faculty.token))
      .send({ facultyCanFormCrossCuttingGroups: true });
    expect(denied.status).toBe(403);
  });
});

describe("tenant isolation", () => {
  it("a college cannot read another college's group", async () => {
    const colA = await setupCollege({ attendance: true });
    const treeA = await seedTree(colA.slug, colA.adminToken);
    await addStudents(colA.collegeId, treeA.a, 1);
    const created = await request(app)
      .post(groups(colA.slug))
      .set(auth(colA.adminToken))
      .send({ name: "A-Only", orgUnitIds: [treeA.a] });
    expect(created.status).toBe(201);
    const groupId = created.body.id as string;

    const colB = await setupCollege({ attendance: true });
    const cross = await request(app)
      .get(`${groups(colB.slug)}/${groupId}`)
      .set(auth(colB.adminToken));
    expect(cross.status).toBe(404);
  });
});
