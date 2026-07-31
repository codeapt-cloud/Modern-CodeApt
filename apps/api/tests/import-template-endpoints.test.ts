/**
 * Import-template DOWNLOAD ENDPOINTS — proves every "Download template" endpoint
 * serves a real .xlsx (right Content-Type + attachment), is gated exactly like
 * its upload, and that what it serves round-trips through the REAL parser (an
 * end-to-end drift guard on top of the pure-lib round-trips in
 * import-templates.test.ts). supertest + in-memory Mongo.
 */
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { Role, UserType } from "@codeapt/shared";
import {
  parseCodingWorkbook,
  parseMcqWorkbook,
} from "../src/lib/exam-excel.js";
import { parseChallengeWorkbook } from "../src/lib/challenge-excel.js";
import { parseTopicWorkbook } from "../src/lib/topic-excel.js";
import { parseRosterWorkbook } from "../src/lib/roster-excel.js";
import { UserModel } from "../src/models/user.model.js";
import * as colleges from "../src/services/college.service.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

let counter = 0;
async function makeUser(fields?: {
  role?: string;
  userType?: string;
  college?: Types.ObjectId | null;
}): Promise<{ token: string; userId: string }> {
  counter += 1;
  const u = `tpl${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Tpl User ${counter}`,
      rollNumber: `TPL-${counter}`,
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

async function setupCollege(
  slug: string,
  features: Record<string, boolean>,
): Promise<{ collegeId: string; adminToken: string }> {
  const platform = await makeUser({ role: Role.SUPER_ADMIN });
  const dto = await colleges.createCollege({ name: slug, slug }, platform.userId);
  await colleges.setEntitlements(dto.id, { features });
  const admin = await makeUser({
    role: Role.COLLEGE_ADMIN,
    userType: UserType.COLLEGE,
    college: new Types.ObjectId(dto.id),
  });
  return { collegeId: dto.id, adminToken: admin.token };
}

function expectXlsx(res: request.Response): Buffer {
  expect(res.status).toBe(200);
  expect(String(res.headers["content-type"])).toContain(XLSX);
  expect(String(res.headers["content-disposition"])).toContain("attachment");
  expect(Buffer.isBuffer(res.body)).toBe(true);
  return res.body as Buffer;
}

describe("platform-admin template endpoints (requireAdmin)", () => {
  it("serves parseable xlsx templates for exam / challenge / topics / roster", async () => {
    const admin = await makeUser({ role: Role.SUPER_ADMIN });

    const mcq = await request(app)
      .get("/api/admin/exams/bulk-upload-template?kind=mcq")
      .responseType("blob")
      .set(auth(admin.token));
    const parsedMcq = await parseMcqWorkbook(expectXlsx(mcq));
    expect(parsedMcq.errors).toEqual([]);
    expect(parsedMcq.questions).toHaveLength(2);

    const coding = await request(app)
      .get("/api/admin/exams/bulk-upload-template?kind=coding")
      .responseType("blob")
      .set(auth(admin.token));
    const parsedCoding = await parseCodingWorkbook(expectXlsx(coding));
    expect(parsedCoding.errors).toEqual([]);
    expect(parsedCoding.questions).toHaveLength(1);
    expect(parsedCoding.questions[0].testCases).toHaveLength(2);

    const challenge = await request(app)
      .get("/api/admin/challenges/bulk-import-template")
      .responseType("blob")
      .set(auth(admin.token));
    const parsedCh = await parseChallengeWorkbook(expectXlsx(challenge));
    expect(parsedCh.rows).toHaveLength(2);

    const topics = await request(app)
      .get("/api/admin/topics/import-template")
      .responseType("blob")
      .set(auth(admin.token));
    const parsedTopics = await parseTopicWorkbook(expectXlsx(topics));
    expect(parsedTopics.rows).toHaveLength(2);

    const roster = await request(app)
      .get("/api/admin/enrollments/bulk-upload-template")
      .responseType("blob")
      .set(auth(admin.token));
    const parsedRoster = await parseRosterWorkbook(expectXlsx(roster));
    expect(parsedRoster.rows).toHaveLength(1);
  });

  it("denies a non-admin the platform templates", async () => {
    const student = await makeUser();
    const res = await request(app)
      .get("/api/admin/exams/bulk-upload-template")
      .set(auth(student.token));
    expect(res.status).toBe(403);
  });
});

describe("tenant exam template endpoint (gated like the upload)", () => {
  it("serves the xlsx to a college operator when `exams` is on", async () => {
    const { adminToken } = await setupCollege("tpl-exams", { exams: true });
    const res = await request(app)
      .get("/api/c/tpl-exams/exams/bulk-upload-template?kind=mcq")
      .responseType("blob")
      .set(auth(adminToken));
    const parsed = await parseMcqWorkbook(expectXlsx(res));
    expect(parsed.errors).toEqual([]);
    expect(parsed.questions).toHaveLength(2);
  });

  it("403s when the `exams` feature is off", async () => {
    const { adminToken } = await setupCollege("tpl-noexams", {});
    const res = await request(app)
      .get("/api/c/tpl-noexams/exams/bulk-upload-template?kind=mcq")
      .set(auth(adminToken));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FEATURE_NOT_ENABLED");
  });
});
