/**
 * Tenant-scoped signed-upload route (POST /c/:collegeSlug/uploads/signature).
 * Mirrors upload-admin.test.ts but for the college authoring surface: a
 * college_admin/faculty of the college gets a signature (so exam-question and
 * posting-logo image uploads work WITHOUT the platform-admin `requireAdmin`
 * gate — the bug that 403'd college users), while a member of another college
 * is denied cross-tenant and an anonymous caller is 401. The platform-admin
 * route is covered — unchanged — by upload-admin.test.ts. Cloudinary itself is
 * never hit; we only assert the signature the server issues. supertest +
 * in-memory Mongo, reusing the college fixtures from college-exams.test.ts.
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

let counter = 0;
async function makeUser(fields?: {
  role?: string;
  userType?: string;
  college?: Types.ObjectId | null;
}): Promise<{ token: string; userId: string }> {
  counter += 1;
  const u = `uc${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `UC User ${counter}`,
      rollNumber: `UCU-${counter}`,
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

/** A college with a freshly-minted college_admin of it. No feature needed. */
async function makeCollegeAdmin(
  slug: string,
): Promise<{ collegeId: string; token: string }> {
  const platform = await makeUser({ role: Role.SUPER_ADMIN });
  const dto = await colleges.createCollege(
    { name: slug, slug },
    platform.userId,
  );
  const admin = await makeUser({
    role: Role.COLLEGE_ADMIN,
    userType: UserType.COLLEGE,
    college: new Types.ObjectId(dto.id),
  });
  return { collegeId: dto.id, token: admin.token };
}

describe("college upload signature — POST /c/:collegeSlug/uploads/signature", () => {
  it("issues a valid signature to a college_admin of that college (no secret)", async () => {
    const { token } = await makeCollegeAdmin("uc-ok");
    const res = await request(app)
      .post("/api/c/uc-ok/uploads/signature")
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.cloudName).toBe("test-cloud");
    expect(res.body.folder).toBe("codeapt");
    expect(Number.isInteger(res.body.timestamp)).toBe(true);
    expect(res.body.signature).toMatch(/^[a-f0-9]{40}$/);
    expect(JSON.stringify(res.body)).not.toContain("test-secret");
  });

  it("denies a member of a DIFFERENT college (cross-tenant)", async () => {
    const other = await makeCollegeAdmin("uc-a");
    await makeCollegeAdmin("uc-b");
    const res = await request(app)
      .post("/api/c/uc-b/uploads/signature")
      .set(auth(other.token));
    // resolveTenant blocks a college user from another tenant (attendance
    // convention): a hard cross-tenant denial.
    expect([403, 404]).toContain(res.status);
  });

  it("rejects an unauthenticated caller (401)", async () => {
    const res = await request(app).post("/api/c/uc-ok/uploads/signature");
    expect(res.status).toBe(401);
  });
});
