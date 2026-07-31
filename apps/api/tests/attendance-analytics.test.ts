/**
 * Attendance ANALYTICS + Excel reports (Prompt 3). supertest + in-memory Mongo.
 * Proves: aggregation over COMPLETED sessions only (a scheduled-but-never-taken
 * session is excluded); overview / by-group / by-org-unit / by-student rates
 * (fair denominator); defaulter threshold flagging (+ a no-data student is never
 * flagged); the register .xlsx grid shape (students × sessions + totals) and the
 * summary .xlsx sheets; per-group scope (a non-owner faculty sees nothing); the
 * feature gate; and cross-tenant isolation.
 */
import { Role, UserType } from "@codeapt/shared";
import ExcelJS from "exceljs";
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
}): Promise<{ token: string; userId: string }> {
  seq += 1;
  const u = `ana${seq}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Ana User ${seq}`,
      rollNumber: `ANAU-${seq}`,
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
  const slug = `ana-col-${collegeSeq}`;
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
async function addStudents(collegeId: string, unitId: string, n: number) {
  const docs = [];
  const rolls: string[] = [];
  for (let i = 0; i < n; i += 1) {
    studentSeq += 1;
    const roll = `AR-${studentSeq}`;
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

/**
 * A college with attendance on, CSE › A, 3 students, one group over A, and two
 * COMPLETED sessions (present 2/3 then 1/3) plus one SCHEDULED-not-taken session.
 * Overall = 3 present / 6 marks = 50%.
 */
async function seedScenario() {
  const { collegeId, slug, adminToken } = await setupCollege({ attendance: true });
  const dept = await createUnit(slug, adminToken, { type: "department", name: "CSE" });
  const sectionA = await createUnit(slug, adminToken, {
    type: "section",
    name: "A",
    parentId: dept,
  });
  const [s1, s2, s3] = await addStudents(collegeId, sectionA, 3);

  const grp = await request(app)
    .post(`/api/c/${slug}/attendance/groups`)
    .set(auth(adminToken))
    .send({ name: "Being Zero", orgUnitIds: [sectionA] });
  expect(grp.status).toBe(201);
  const groupId = grp.body.id as string;

  const mkSession = async (at: string): Promise<string> => {
    const res = await request(app)
      .post(`/api/c/${slug}/attendance/groups/${groupId}/sessions`)
      .set(auth(adminToken))
      .send({ scheduledAt: at });
    expect(res.status).toBe(201);
    return res.body.id as string;
  };
  const save = async (id: string, present: string[]): Promise<void> => {
    const res = await request(app)
      .put(`/api/c/${slug}/attendance/sessions/${id}/attendance`)
      .set(auth(adminToken))
      .send({ marks: present.map((sid) => ({ studentId: sid, status: "present" })) });
    expect(res.status).toBe(200);
  };

  const sess1 = await mkSession("2026-09-01T04:30:00.000Z");
  await save(sess1, [s1!.id, s2!.id]); // 2/3
  const sess2 = await mkSession("2026-09-02T04:30:00.000Z");
  await save(sess2, [s1!.id]); // 1/3
  await mkSession("2026-09-03T04:30:00.000Z"); // scheduled, never taken

  return { collegeId, slug, adminToken, dept, sectionA, groupId, s1, s2, s3 };
}

const analyticsUrl = (slug: string) => `/api/c/${slug}/attendance/analytics`;

// ---------------------------------------------------------------------------

describe("aggregation over completed sessions", () => {
  it("overview / by-group / by-unit / by-student rates (scheduled excluded)", async () => {
    const sc = await seedScenario();
    const res = await request(app)
      .get(analyticsUrl(sc.slug))
      .set(auth(sc.adminToken));
    expect(res.status).toBe(200);
    const d = res.body;

    // Overview: 2 completed sessions (the 3rd scheduled one excluded), 50% overall.
    expect(d.overview.sessionsHeld).toBe(2);
    expect(d.overview.totalMarks).toBe(6);
    expect(d.overview.present).toBe(3);
    expect(d.overview.overallRate).toBe(50);
    expect(d.overview.studentsTracked).toBe(3);
    expect(d.overview.belowThreshold).toBe(2); // s2 (50%) + s3 (0%)

    // By group.
    const g = d.groups.find((x: { groupId: string }) => x.groupId === sc.groupId);
    expect(g).toMatchObject({ sessionsHeld: 2, memberCount: 3, rate: 50 });

    // By org-unit: section A + dept CSE both roll up to 50%.
    const section = d.units.find((u: { id: string }) => u.id === sc.sectionA);
    const dept = d.units.find((u: { id: string }) => u.id === sc.dept);
    expect(section).toMatchObject({ rate: 50, students: 3 });
    expect(dept).toMatchObject({ rate: 50, students: 3 });

    // By student: s1 100, s2 50, s3 0.
    const byId = new Map(
      d.students.map((s: { studentId: string }) => [s.studentId, s]),
    );
    expect(byId.get(sc.s1!.id)).toMatchObject({ rate: 100, below: false });
    expect(byId.get(sc.s2!.id)).toMatchObject({ rate: 50, below: true });
    expect(byId.get(sc.s3!.id)).toMatchObject({ rate: 0, below: true });
  });

  it("a member with no completed sessions shows no data (null), never flagged", async () => {
    const sc = await seedScenario();
    // A brand-new member added AFTER the sessions were taken → no records.
    const [fresh] = await addStudents(sc.collegeId, sc.sectionA, 1);
    await request(app)
      .post(`/api/c/${sc.slug}/attendance/groups/${sc.groupId}/members`)
      .set(auth(sc.adminToken))
      .send({ studentIds: [fresh!.id] });

    const res = await request(app)
      .get(analyticsUrl(sc.slug))
      .set(auth(sc.adminToken));
    const stat = res.body.students.find(
      (s: { studentId: string }) => s.studentId === fresh!.id,
    );
    expect(stat).toMatchObject({ total: 0, rate: null, below: false });
    // studentsTracked still 3 (the fresh one has no data).
    expect(res.body.overview.studentsTracked).toBe(3);
  });

  it("honors a custom threshold", async () => {
    const sc = await seedScenario();
    const res = await request(app)
      .get(analyticsUrl(sc.slug))
      .query({ threshold: 60 })
      .set(auth(sc.adminToken));
    // At 60%: s2 (50) + s3 (0) below; s1 (100) ok → 2. At 40% only s3 → but here 60.
    expect(res.body.overview.threshold).toBe(60);
    expect(res.body.overview.belowThreshold).toBe(2);

    const res40 = await request(app)
      .get(analyticsUrl(sc.slug))
      .query({ threshold: 40 })
      .set(auth(sc.adminToken));
    expect(res40.body.overview.belowThreshold).toBe(1); // only s3 (0%)
  });
});

describe("Excel reports", () => {
  it("register .xlsx: students × completed sessions grid + totals", async () => {
    const sc = await seedScenario();
    const res = await request(app)
      .get(`${analyticsUrl(sc.slug)}/report/register`)
      .query({ groupId: sc.groupId })
      .set(auth(sc.adminToken))
      .buffer(true)
      .parse((response, cb) => {
        const chunks: Buffer[] = [];
        response.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
        response.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"])).toContain("spreadsheetml");

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as Buffer);
    const ws = wb.getWorksheet("Register")!;
    const header = (ws.getRow(1).values as unknown[]).filter((v) => v != null);
    // Roll, Student, 2 session cols, Present, Total, % → 6 label columns.
    expect(header).toContain("Present");
    expect(header).toContain("Total");
    expect(header).toContain("%");
    // s1's row → P, P, 2, 2, 100%.
    let s1Row: ExcelJS.Row | undefined;
    ws.eachRow((row) => {
      if (String(row.getCell(1).value) === sc.s1!.roll) s1Row = row;
    });
    expect(s1Row).toBeDefined();
    const cells = (s1Row!.values as unknown[]).map((v) => String(v ?? ""));
    expect(cells).toContain("100%");
    expect(cells.filter((c) => c === "P")).toHaveLength(2);
  });

  it("summary .xlsx: Students + Defaulters + Groups sheets", async () => {
    const sc = await seedScenario();
    const res = await request(app)
      .get(`${analyticsUrl(sc.slug)}/report/summary`)
      .set(auth(sc.adminToken))
      .buffer(true)
      .parse((response, cb) => {
        const chunks: Buffer[] = [];
        response.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
        response.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as Buffer);
    expect(wb.getWorksheet("Students")).toBeDefined();
    expect(wb.getWorksheet("Groups")).toBeDefined();
    const defaulters = wb.worksheets.find((w) => w.name.startsWith("Defaulters"));
    expect(defaulters).toBeDefined();
    // 3 students + header = 4 rows on the Students sheet.
    expect(wb.getWorksheet("Students")!.rowCount).toBe(4);
  });
});

describe("scope, feature gate, tenant isolation", () => {
  it("a non-owner faculty sees none of the admin's groups", async () => {
    const sc = await seedScenario();
    const outsider = await makeUser({
      role: Role.FACULTY,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(sc.collegeId),
    });
    const res = await request(app)
      .get(analyticsUrl(sc.slug))
      .set(auth(outsider.token));
    expect(res.status).toBe(200);
    expect(res.body.overview.groups).toBe(0);
    expect(res.body.overview.sessionsHeld).toBe(0);
  });

  it("403s analytics for a college without the attendance feature", async () => {
    const { slug, adminToken } = await setupCollege({ attendance: false });
    const res = await request(app).get(analyticsUrl(slug)).set(auth(adminToken));
    expect(res.status).toBe(403);
  });

  it("cannot pull another college's register", async () => {
    const sc = await seedScenario();
    const other = await setupCollege({ attendance: true });
    const res = await request(app)
      .get(`${analyticsUrl(other.slug)}/report/register`)
      .query({ groupId: sc.groupId })
      .set(auth(other.adminToken));
    expect(res.status).toBe(404);
  });
});
