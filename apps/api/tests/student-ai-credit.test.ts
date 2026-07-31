/**
 * Per-student AI credit distribution tests (supertest + in-memory Mongo). Proves:
 * allocate via org-unit / individual / Excel-preview; over-allocation rejected
 * (Σ ≤ pool); SET-semantics (re-allocate sets, reducing frees distributable);
 * the seam primitives (reserve on success, exhausted → gated, no allocation → no
 * AI, refund restores, concurrency-safe, NO double-charge of the pool);
 * resolveStudentMeterId honors the opt-in flag (Stage-1 fallback when off);
 * monthly reset (period-scoped, no rollover); admin + student visibility;
 * feature gate + tenant isolation. The BullMQ producer is mocked.
 */
import {
  aiCreditPeriodBounds,
  aiCreditPeriodKey,
  Role,
  UserType,
} from "@codeapt/shared";
import type { Express } from "express";
import ExcelJS from "exceljs";
import { Types } from "mongoose";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/execution-queue.js", () => ({
  enqueueCodingRefreshJob: vi.fn(async () => undefined),
  enqueueEssayGradingJob: vi.fn(async () => undefined),
  closeQueues: vi.fn(async () => undefined),
  knownQueues: [],
}));

import { createApp } from "../src/app.js";
import { AiCreditLedgerModel } from "../src/models/ai-credit.model.js";
import { ProfileModel, UserModel } from "../src/models/user.model.js";
import { OrgUnitModel } from "../src/models/org-unit.model.js";
import { StudentAiCreditLedgerModel } from "../src/models/student-ai-credit.model.js";
import * as colleges from "../src/services/college.service.js";
import {
  refundStudentCredits,
  reserveStudentCredits,
  resolveStudentMeterId,
} from "../src/services/student-ai-credit.service.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let seq = 0;
async function makeAuthed(fields?: {
  role?: string;
  userType?: string;
  college?: Types.ObjectId | null;
}): Promise<{ token: string; userId: string }> {
  seq += 1;
  const u = `ac${seq}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `AC ${seq}`,
      rollNumber: `AC-${seq}`,
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

async function makeStudent(
  collegeId: string,
  orgUnitId: Types.ObjectId | null,
  name: string,
  roll: string,
): Promise<string> {
  seq += 1;
  const u = await UserModel.create({
    username: `stu${seq}`,
    email: `stu${seq}@example.com`,
    passwordHash: "x",
    role: Role.STUDENT,
    userType: UserType.COLLEGE,
    college: new Types.ObjectId(collegeId),
    orgUnit: orgUnitId,
    rollNumber: roll,
    isActive: true,
  });
  await ProfileModel.create({
    user: u._id,
    fullName: name,
    collegeName: "Acme",
    rollNumber: roll,
    phoneNumber: "9999999999",
    state: "KA",
  });
  return u._id.toString();
}

/** Seed the college pool ledger for the current period with a known cap. */
async function seedPool(collegeId: string, allocated: number): Promise<void> {
  const periodKey = aiCreditPeriodKey(new Date());
  const { start, end } = aiCreditPeriodBounds(periodKey);
  await AiCreditLedgerModel.create({
    college: new Types.ObjectId(collegeId),
    periodKey,
    allocated,
    consumed: 0,
    byFeature: {},
    periodStart: start,
    periodEnd: end,
  });
}

let collegeSeq = 0;
async function setupCollege(opts: { ai?: boolean; pool?: number; enabled?: boolean } = {}) {
  collegeSeq += 1;
  const slug = `ac-col-${collegeSeq}`;
  const platform = await makeAuthed({ role: Role.SUPER_ADMIN });
  const dto = await colleges.createCollege({ name: slug, slug }, platform.userId);
  if (opts.ai) await colleges.setEntitlements(dto.id, { features: { ai: true } });
  if (opts.pool !== undefined) await seedPool(dto.id, opts.pool);
  const collegeId = new Types.ObjectId(dto.id);
  const admin = await makeAuthed({
    role: Role.COLLEGE_ADMIN,
    userType: UserType.COLLEGE,
    college: collegeId,
  });
  const sc = { collegeId: dto.id, slug, adminToken: admin.token };
  if (opts.enabled) {
    await request(app)
      .put(`/api/c/${slug}/ai-credits/distribution/settings`)
      .set(auth(admin.token))
      .send({ enabled: true });
  }
  return sc;
}

const distUrl = (slug: string) => `/api/c/${slug}/ai-credits/distribution`;

// ---------------------------------------------------------------------------

describe("allocation (selection methods + guards)", () => {
  it("allocates by org-unit, SET-semantics, over-allocation guard, and reducing frees pool", async () => {
    const sc = await setupCollege({ ai: true, pool: 1000, enabled: true });
    const dept = await OrgUnitModel.create({
      college: new Types.ObjectId(sc.collegeId), type: "department", name: "CSE",
    });
    const a = await makeStudent(sc.collegeId, dept._id, "Alice", "R1");
    const b = await makeStudent(sc.collegeId, dept._id, "Bob", "R2");

    // Allocate 100 to the whole dept (both students).
    const r1 = await request(app)
      .post(`${distUrl(sc.slug)}/allocate`)
      .set(auth(sc.adminToken))
      .send({ orgUnitIds: [dept._id.toString()], amount: 100 });
    expect(r1.status).toBe(200);
    expect(r1.body.allocatedToStudents).toBe(200);
    expect(r1.body.distributable).toBe(800);
    expect(r1.body.students).toHaveLength(2);

    // SET (not add): re-allocate Alice to 300 individually.
    const r2 = await request(app)
      .post(`${distUrl(sc.slug)}/allocate`)
      .set(auth(sc.adminToken))
      .send({ studentIds: [a], amount: 300 });
    expect(r2.body.allocatedToStudents).toBe(400); // 300 + 100, not 300+100+100
    const alice = r2.body.students.find((s: { studentId: string }) => s.studentId === a);
    expect(alice.allocated).toBe(300);

    // Over-allocation: 900 each × 2 = 1800 > 1000 → rejected.
    const over = await request(app)
      .post(`${distUrl(sc.slug)}/allocate`)
      .set(auth(sc.adminToken))
      .send({ orgUnitIds: [dept._id.toString()], amount: 900 });
    expect(over.status).toBe(400);
    expect(over.body.error.code).toBe("OVER_ALLOCATION");
    expect(over.body.error.details.distributable).toBe(1000);

    // Reducing Alice to 0 frees her allocation back to distributable.
    const r3 = await request(app)
      .post(`${distUrl(sc.slug)}/allocate`)
      .set(auth(sc.adminToken))
      .send({ studentIds: [a], amount: 0 });
    expect(r3.body.allocatedToStudents).toBe(100); // only Bob's 100 remains
    expect(r3.body.distributable).toBe(900);
    void b;
  });

  it("allocates via Excel roll-number preview (matched/unmatched, persists on confirm)", async () => {
    const sc = await setupCollege({ ai: true, pool: 500, enabled: true });
    const a = await makeStudent(sc.collegeId, null, "Alice", "ROLL-A");
    await makeStudent(sc.collegeId, null, "Bob", "ROLL-B");

    // Build a roll-number workbook (one real, one bogus).
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Roll Numbers");
    ws.addRow(["roll_number"]);
    ws.addRow(["ROLL-A"]);
    ws.addRow(["NOPE-999"]);
    const base64 = Buffer.from(await wb.xlsx.writeBuffer()).toString("base64");

    const prev = await request(app)
      .post(`${distUrl(sc.slug)}/preview`)
      .set(auth(sc.adminToken))
      .send({ fileBase64: base64 });
    expect(prev.status).toBe(200);
    expect(prev.body.summary).toMatchObject({ total: 2, matched: 1, unmatched: 1 });
    expect(prev.body.unmatched).toEqual(["NOPE-999"]);
    const matchedIds = prev.body.matched.map((m: { studentId: string }) => m.studentId);
    expect(matchedIds).toEqual([a]);

    // Confirm: allocate to the matched ids.
    const alloc = await request(app)
      .post(`${distUrl(sc.slug)}/allocate`)
      .set(auth(sc.adminToken))
      .send({ studentIds: matchedIds, amount: 50 });
    expect(alloc.body.allocatedToStudents).toBe(50);
    expect(alloc.body.students).toHaveLength(1);
  });
});

describe("seam metering primitives (keyed by student)", () => {
  it("reserves on success, gates when exhausted / unallocated, refunds, and never touches the pool", async () => {
    const sc = await setupCollege({ ai: true, pool: 1000, enabled: true });
    const s = await makeStudent(sc.collegeId, null, "S", "RS");
    await request(app)
      .post(`${distUrl(sc.slug)}/allocate`)
      .set(auth(sc.adminToken))
      .send({ studentIds: [s], amount: 2 });

    const now = new Date();
    // Two reserves succeed (allocated 2, weight 1 each), the third is gated.
    expect(await reserveStudentCredits(sc.collegeId, s, "grading", now)).toBe(true);
    expect(await reserveStudentCredits(sc.collegeId, s, "grading", now)).toBe(true);
    expect(await reserveStudentCredits(sc.collegeId, s, "grading", now)).toBe(false);

    // The college POOL ledger was NOT touched by student spend (no double-charge).
    const pool = await AiCreditLedgerModel.findOne({
      college: new Types.ObjectId(sc.collegeId),
      periodKey: aiCreditPeriodKey(now),
    });
    expect(pool?.consumed).toBe(0);

    // Refund restores one → a reserve succeeds again.
    await refundStudentCredits(sc.collegeId, s, "grading", now);
    expect(await reserveStudentCredits(sc.collegeId, s, "grading", now)).toBe(true);

    // A student with NO allocation → reserve fails (no AI).
    const none = await makeStudent(sc.collegeId, null, "None", "RN");
    expect(await reserveStudentCredits(sc.collegeId, none, "grading", now)).toBe(false);
  });

  it("concurrency-safe: parallel reserves never exceed the allocation", async () => {
    const sc = await setupCollege({ ai: true, pool: 1000, enabled: true });
    const s = await makeStudent(sc.collegeId, null, "C", "RC");
    await request(app)
      .post(`${distUrl(sc.slug)}/allocate`)
      .set(auth(sc.adminToken))
      .send({ studentIds: [s], amount: 3 });

    const now = new Date();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => reserveStudentCredits(sc.collegeId, s, "grading", now)),
    );
    expect(results.filter(Boolean)).toHaveLength(3); // exactly the allocation
    const row = await StudentAiCreditLedgerModel.findOne({
      college: new Types.ObjectId(sc.collegeId),
      student: new Types.ObjectId(s),
      periodKey: aiCreditPeriodKey(now),
    });
    expect(row?.consumed).toBe(3);
  });

  it("resolveStudentMeterId returns the id only when the college opted in", async () => {
    const off = await setupCollege({ ai: true, pool: 100, enabled: false });
    const s1 = await makeStudent(off.collegeId, null, "X", "RX");
    // Mode off → undefined (seam falls back to Stage-1 college metering, unchanged).
    expect(await resolveStudentMeterId(off.collegeId, s1)).toBeUndefined();

    const on = await setupCollege({ ai: true, pool: 100, enabled: true });
    const s2 = await makeStudent(on.collegeId, null, "Y", "RY");
    expect(await resolveStudentMeterId(on.collegeId, s2)).toBe(s2);
  });
});

describe("reset + visibility + gating", () => {
  it("is period-scoped: a different month shows no allocations (no rollover)", async () => {
    const sc = await setupCollege({ ai: true, pool: 1000, enabled: true });
    const s = await makeStudent(sc.collegeId, null, "S", "RS");
    await request(app)
      .post(`${distUrl(sc.slug)}/allocate`)
      .set(auth(sc.adminToken))
      .send({ studentIds: [s], amount: 100 });

    // Current period → allocated 100. Next period → the ledger row doesn't exist.
    const nextMonthKey = aiCreditPeriodKey(new Date());
    const [y, m] = nextMonthKey.split("-").map(Number);
    const future = new Date(Date.UTC((m ?? 1) === 12 ? (y ?? 1970) + 1 : y ?? 1970, (m ?? 1) % 12, 15));
    const row = await StudentAiCreditLedgerModel.findOne({
      college: new Types.ObjectId(sc.collegeId),
      student: new Types.ObjectId(s),
      periodKey: aiCreditPeriodKey(future),
    });
    expect(row).toBeNull(); // nothing carried into the next period
  });

  it("a student sees their own allocation; unallocated → honest zero", async () => {
    const sc = await setupCollege({ ai: true, pool: 1000, enabled: true });
    const student = await makeAuthed({
      role: Role.STUDENT,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(sc.collegeId),
    });
    // Before allocation.
    const before = await request(app)
      .get(`/api/c/${sc.slug}/student/ai-credits`)
      .set(auth(student.token));
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ enabled: true, allocated: null, remaining: 0 });

    await request(app)
      .post(`${distUrl(sc.slug)}/allocate`)
      .set(auth(sc.adminToken))
      .send({ studentIds: [student.userId], amount: 40 });

    const after = await request(app)
      .get(`/api/c/${sc.slug}/student/ai-credits`)
      .set(auth(student.token));
    expect(after.body).toMatchObject({ allocated: 40, consumed: 0, remaining: 40 });
  });

  it("403s the admin distribution without the AI feature", async () => {
    const sc = await setupCollege({ ai: false, pool: 100 });
    const res = await request(app).get(distUrl(sc.slug)).set(auth(sc.adminToken));
    expect(res.status).toBe(403);
  });

  it("is tenant-isolated (an admin can't allocate to another college's student)", async () => {
    const a = await setupCollege({ ai: true, pool: 1000, enabled: true });
    const b = await setupCollege({ ai: true, pool: 1000, enabled: true });
    const bStudent = await makeStudent(b.collegeId, null, "B", "RB");

    const res = await request(app)
      .post(`${distUrl(a.slug)}/allocate`)
      .set(auth(a.adminToken))
      .send({ studentIds: [bStudent], amount: 10 });
    // The foreign student is not found within college A's tenant scope.
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("STUDENT_NOT_FOUND");
  });
});
