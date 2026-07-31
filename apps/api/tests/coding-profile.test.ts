/**
 * Coding-profile API tests (supertest + in-memory Mongo). The BullMQ producer is
 * mocked (no Redis). Proves: a student sets/updates/clears their own handles;
 * stats entries are created (status `never`) and returned on GET; refresh
 * enqueues; only a college STUDENT may use the self endpoints (a faculty/admin
 * → 403); own-data-only (two students never see each other's handles); the
 * feature gate (403 without `coding_profiles`); and tenant isolation on the
 * admin refresh (a student of another college → 404).
 */
import { CodingFetchStatus, Role, UserType } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/execution-queue.js", () => ({
  enqueueCodingRefreshJob: vi.fn(async () => undefined),
  closeQueues: vi.fn(async () => undefined),
  knownQueues: [],
}));

import { createApp } from "../src/app.js";
import { enqueueCodingRefreshJob } from "../src/lib/execution-queue.js";
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
  const u = `cp${seq}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `CP User ${seq}`,
      rollNumber: `CPU-${seq}`,
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
async function setupCollege(opts: { coding?: boolean } = {}) {
  collegeSeq += 1;
  const slug = `cp-col-${collegeSeq}`;
  const platform = await makeUser({ role: Role.SUPER_ADMIN });
  const dto = await colleges.createCollege({ name: slug, slug }, platform.userId);
  if (opts.coding) {
    await colleges.setEntitlements(dto.id, { features: { coding_profiles: true } });
  }
  const collegeId = new Types.ObjectId(dto.id);
  const admin = await makeUser({
    role: Role.COLLEGE_ADMIN,
    userType: UserType.COLLEGE,
    college: collegeId,
  });
  const student = await makeUser({
    role: Role.STUDENT,
    userType: UserType.COLLEGE,
    college: collegeId,
  });
  return { collegeId: dto.id, slug, adminToken: admin.token, student };
}

const base = (slug: string) => `/api/c/${slug}/coding-profiles`;

describe("coding-profile handles (self-edit)", () => {
  it("sets, returns on GET, and clears handles (own-data-only)", async () => {
    vi.mocked(enqueueCodingRefreshJob).mockClear();
    const sc = await setupCollege({ coding: true });

    // Empty to start.
    const empty = await request(app)
      .get(`${base(sc.slug)}/me`)
      .set(auth(sc.student.token));
    expect(empty.status).toBe(200);
    expect(empty.body.handles).toEqual({ codeforces: null, leetcode: null, codechef: null });
    expect(empty.body.stats).toEqual([]);

    // Set two handles.
    const set = await request(app)
      .put(`${base(sc.slug)}/me/handles`)
      .set(auth(sc.student.token))
      .send({ codeforces: "tourist", leetcode: "lee215" });
    expect(set.status).toBe(200);
    expect(set.body.handles).toMatchObject({ codeforces: "tourist", leetcode: "lee215", codechef: null });
    expect(set.body.stats).toHaveLength(2);
    expect(set.body.stats.every((s: { status: string }) => s.status === CodingFetchStatus.NEVER)).toBe(true);
    expect(set.body.refreshQueued).toBe(true);
    expect(enqueueCodingRefreshJob).toHaveBeenCalledTimes(1);

    // Clearing leetcode drops its stat; codeforces stays.
    const cleared = await request(app)
      .put(`${base(sc.slug)}/me/handles`)
      .set(auth(sc.student.token))
      .send({ leetcode: "" });
    expect(cleared.status).toBe(200);
    expect(cleared.body.handles).toMatchObject({ codeforces: "tourist", leetcode: null });
    expect(cleared.body.stats).toHaveLength(1);
    expect(cleared.body.stats[0].platform).toBe("codeforces");
  });

  it("keeps a student from seeing another student's handles", async () => {
    const sc = await setupCollege({ coding: true });
    await request(app)
      .put(`${base(sc.slug)}/me/handles`)
      .set(auth(sc.student.token))
      .send({ codeforces: "alpha" });

    const other = await makeUser({
      role: Role.STUDENT,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(sc.collegeId),
    });
    const view = await request(app).get(`${base(sc.slug)}/me`).set(auth(other.token));
    expect(view.status).toBe(200);
    expect(view.body.handles.codeforces).toBeNull(); // its own (empty) profile
  });

  it("403s the self endpoints for a non-student (faculty/admin)", async () => {
    const sc = await setupCollege({ coding: true });
    const res = await request(app)
      .get(`${base(sc.slug)}/me`)
      .set(auth(sc.adminToken));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NOT_A_STUDENT");
  });
});

describe("coding-profile refresh", () => {
  it("student refresh enqueues only when a handle is linked", async () => {
    vi.mocked(enqueueCodingRefreshJob).mockClear();
    const sc = await setupCollege({ coding: true });

    // No handles yet → not queued.
    const none = await request(app)
      .post(`${base(sc.slug)}/me/refresh`)
      .set(auth(sc.student.token));
    expect(none.status).toBe(202);
    expect(none.body.queued).toBe(false);

    await request(app)
      .put(`${base(sc.slug)}/me/handles`)
      .set(auth(sc.student.token))
      .send({ codechef: "gennady" });
    vi.mocked(enqueueCodingRefreshJob).mockClear();

    const yes = await request(app)
      .post(`${base(sc.slug)}/me/refresh`)
      .set(auth(sc.student.token));
    expect(yes.status).toBe(202);
    expect(yes.body.queued).toBe(true);
    expect(enqueueCodingRefreshJob).toHaveBeenCalledTimes(1);
  });

  it("admin can refresh a specific student, but not one from another college", async () => {
    const sc = await setupCollege({ coding: true });
    const ok = await request(app)
      .post(`${base(sc.slug)}/students/${sc.student.userId}/refresh`)
      .set(auth(sc.adminToken));
    expect(ok.status).toBe(202);
    expect(ok.body.queued).toBe(true);

    const other = await setupCollege({ coding: true });
    const cross = await request(app)
      .post(`${base(sc.slug)}/students/${other.student.userId}/refresh`)
      .set(auth(sc.adminToken));
    expect(cross.status).toBe(404);
    expect(cross.body.error.code).toBe("STUDENT_NOT_FOUND");
  });
});

describe("coding-profile feature gate", () => {
  it("403s when the college lacks the coding_profiles feature", async () => {
    const sc = await setupCollege({ coding: false });
    const res = await request(app)
      .get(`${base(sc.slug)}/me`)
      .set(auth(sc.student.token));
    expect(res.status).toBe(403);
  });
});
