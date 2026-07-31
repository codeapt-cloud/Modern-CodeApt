/**
 * Bulk-enroll (4c-ii) — roster Excel → provision students + enroll across
 * subjects, per-row partial success. Builds .xlsx rosters in-memory, base64s
 * them, and hits POST /admin/enrollments/bulk-upload. Covers: provisioning new
 * users (force-change flag + env default password) and enrolling them (source
 * "manual") across multiple subjects; idempotency; existing users enrolled
 * without password/flag changes; missing username/email reported.
 */
import ExcelJS from "exceljs";
import type { Express } from "express";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { verifyPassword } from "../src/lib/password.js";
import { EnrollmentModel } from "../src/models/curriculum.model.js";
import { ProfileModel, UserModel } from "../src/models/user.model.js";
import request from "supertest";

let app: Express;
beforeAll(() => {
  app = createApp();
});

let counter = 0;
async function adminToken(): Promise<string> {
  counter += 1;
  const u = `enradm${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Enr Adm ${counter}`,
      rollNumber: `ENRADM-${counter}`,
      collegeName: "Acme",
      phoneNumber: "9999999999",
      state: "KA",
    });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ identifier: u, password: "Password123" });
  const { UserModel: UM } = await import("../src/models/user.model.js");
  await UM.updateOne({ _id: res.body.user.id }, { $set: { role: "admin" } });
  const relog = await request(app)
    .post("/api/auth/login")
    .send({ identifier: u, password: "Password123" });
  return relog.body.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function makeSubject(token: string): Promise<string> {
  counter += 1;
  const res = await request(app)
    .post("/api/admin/subjects")
    .set(auth(token))
    .send({ name: `Enroll Subject ${counter}` });
  return res.body.id as string;
}

type Row = Record<string, string>;
const HEADERS = [
  "username",
  "email",
  "full_name",
  "college_name",
  "roll_number",
  "phone_number",
  "state",
  "bio",
];
async function roster(rows: Row[]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Roster");
  ws.addRow(HEADERS);
  for (const r of rows) ws.addRow(HEADERS.map((h) => r[h] ?? ""));
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf).toString("base64");
}

const upload = (token: string, subjectIds: string[], fileBase64: string) =>
  request(app)
    .post("/api/admin/enrollments/bulk-upload")
    .set(auth(token))
    .send({ subjectIds, fileBase64 });

describe("admin bulk-enroll", () => {
  it("provisions new students (force-change + env password) and enrolls them across subjects", async () => {
    const token = await adminToken();
    const s1 = await makeSubject(token);
    const s2 = await makeSubject(token);
    const uq = `${Date.now()}`.slice(-6);
    const fileBase64 = await roster([
      {
        username: `alice${uq}`,
        email: `alice${uq}@example.com`,
        full_name: "Alice A",
        roll_number: `R-${uq}-1`,
      },
      {
        username: `bob${uq}`,
        email: `bob${uq}@example.com`,
        full_name: "Bob B",
        roll_number: `R-${uq}-2`,
      },
    ]);
    const res = await upload(token, [s1, s2], fileBase64);
    expect(res.status).toBe(200);
    expect(res.body.createdUsers).toBe(2);
    expect(res.body.enrolledCount).toBe(4); // 2 students × 2 subjects
    expect(res.body.errors).toEqual([]);

    // The provisioned user is forced to reset + holds the env default password.
    const alice = await UserModel.findOne({ username: `alice${uq}` });
    expect(alice?.forcePasswordChange).toBe(true);
    expect(alice?.role).toBe("student");
    expect(
      await verifyPassword(
        alice!.passwordHash,
        env.BULK_ENROLL_DEFAULT_PASSWORD,
      ),
    ).toBe(true);
    // A profile was created with the roster data.
    const profile = await ProfileModel.findOne({ user: alice!._id });
    expect(profile?.fullName).toBe("Alice A");
    // Enrollments are source "manual".
    const enrollments = await EnrollmentModel.find({ user: alice!._id });
    expect(enrollments.length).toBe(2);
    expect(enrollments.every((e) => e.source === "manual")).toBe(true);
  });

  it("is idempotent — re-running creates no duplicate users or enrollments", async () => {
    const token = await adminToken();
    const s1 = await makeSubject(token);
    const uq = `${Date.now()}`.slice(-6);
    const fileBase64 = await roster([
      {
        username: `carol${uq}`,
        email: `carol${uq}@example.com`,
        full_name: "Carol",
        roll_number: `R-${uq}-c`,
      },
    ]);
    const first = await upload(token, [s1], fileBase64);
    expect(first.body.createdUsers).toBe(1);
    expect(first.body.enrolledCount).toBe(1);

    const second = await upload(token, [s1], fileBase64);
    expect(second.body.createdUsers).toBe(0); // reused
    expect(second.body.enrolledCount).toBe(0); // already enrolled
    expect(second.body.errors).toEqual([]);

    const carol = await UserModel.findOne({ username: `carol${uq}` });
    expect(await EnrollmentModel.countDocuments({ user: carol!._id })).toBe(1);
  });

  it("enrolls an EXISTING user without changing their password or flag", async () => {
    const token = await adminToken();
    const s1 = await makeSubject(token);
    // Register a normal student (forcePasswordChange stays false, own password).
    const uq = `${Date.now()}`.slice(-6);
    const uname = `existing${uq}`;
    await request(app)
      .post("/api/auth/register")
      .send({
        username: uname,
        email: `${uname}@example.com`,
        password: "MyOwnPass123",
        fullName: "Existing User",
        rollNumber: `EXR-${uq}`,
        collegeName: "Acme",
        phoneNumber: "9999999999",
        state: "KA",
      });

    const fileBase64 = await roster([
      { username: uname, email: `${uname}@example.com`, full_name: "Existing User" },
    ]);
    const res = await upload(token, [s1], fileBase64);
    expect(res.body.createdUsers).toBe(0);
    expect(res.body.enrolledCount).toBe(1);

    const user = await UserModel.findOne({ username: uname });
    expect(user?.forcePasswordChange).toBe(false); // untouched
    // Their original password still works (not overwritten).
    expect(await verifyPassword(user!.passwordHash, "MyOwnPass123")).toBe(true);
  });

  it("reports rows missing username or email (partial success)", async () => {
    const token = await adminToken();
    const s1 = await makeSubject(token);
    const uq = `${Date.now()}`.slice(-6);
    const fileBase64 = await roster([
      {
        username: `dave${uq}`,
        email: `dave${uq}@example.com`,
        full_name: "Dave",
        roll_number: `R-${uq}-d`,
      }, // row 2 ✓
      { username: "", email: `noname${uq}@example.com`, full_name: "No Name" }, // row 3 ✗
      { username: `noemail${uq}`, email: "", full_name: "No Email" }, // row 4 ✗
      {
        username: `erin${uq}`,
        email: `erin${uq}@example.com`,
        full_name: "Erin",
      }, // row 5 ✗ new user, missing roll_number
    ]);
    const res = await upload(token, [s1], fileBase64);
    expect(res.body.createdUsers).toBe(1); // only dave
    expect(res.body.enrolledCount).toBe(1);
    const rows = res.body.errors.map((e: { row: number }) => e.row).sort();
    expect(rows).toEqual([3, 4, 5]);
  });

  it("rejects a non-admin (403)", async () => {
    const token = await adminToken();
    const s1 = await makeSubject(token);
    counter += 1;
    const u = `enrplain${counter}`;
    await request(app)
      .post("/api/auth/register")
      .send({
        username: u,
        email: `${u}@example.com`,
        password: "Password123",
        fullName: "Plain",
        rollNumber: `ENRPLAIN-${counter}`,
        collegeName: "Acme",
        phoneNumber: "9999999999",
        state: "KA",
      });
    const login = await request(app)
      .post("/api/auth/login")
      .send({ identifier: u, password: "Password123" });
    const fileBase64 = await roster([
      { username: "x", email: "x@example.com", full_name: "X", roll_number: "RX" },
    ]);
    const res = await request(app)
      .post("/api/admin/enrollments/bulk-upload")
      .set(auth(login.body.accessToken as string))
      .send({ subjectIds: [s1], fileBase64 });
    expect(res.status).toBe(403);
  });
});
