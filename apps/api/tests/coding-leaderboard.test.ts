/**
 * Coding leaderboard API tests (supertest + in-memory Mongo). Seeds students in
 * org-units with stored CodingProfiles (no live fetching), then proves:
 * ranking by rating vs solved (desc, deterministic ties), na/stale students are
 * UNRANKED (rank null) not faked, the org-unit (descendant) + attendance-group
 * filters, faculty scope, the .xlsx export, the feature gate, and tenant
 * isolation. The BullMQ producer is mocked (no Redis).
 */
import {
  CodingFetchStatus,
  CodingPlatform,
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
  closeQueues: vi.fn(async () => undefined),
  knownQueues: [],
}));

import { createApp } from "../src/app.js";
import { AttendanceGroupModel } from "../src/models/attendance-group.model.js";
import { CodingProfileModel } from "../src/models/coding-profile.model.js";
import { OrgUnitModel } from "../src/models/org-unit.model.js";
import { ProfileModel, UserModel } from "../src/models/user.model.js";
import * as colleges from "../src/services/college.service.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let seq = 0;
/** A logged-in operator (admin/faculty/super) — needs a real token. */
async function makeAuthed(fields?: {
  role?: string;
  userType?: string;
  college?: Types.ObjectId | null;
  facultyScope?: { orgUnits: Types.ObjectId[] };
}): Promise<{ token: string; userId: string }> {
  seq += 1;
  const u = `lb${seq}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `LB ${seq}`,
      rollNumber: `LB-${seq}`,
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

/** A student is pure data (no token) — created directly for speed + control. */
async function makeStudent(
  collegeId: string,
  orgUnitId: Types.ObjectId | null,
  name: string,
): Promise<string> {
  seq += 1;
  const u = await UserModel.create({
    username: `st${seq}`,
    email: `st${seq}@example.com`,
    passwordHash: "x",
    role: Role.STUDENT,
    userType: UserType.COLLEGE,
    college: new Types.ObjectId(collegeId),
    orgUnit: orgUnitId,
    rollNumber: `R-${seq}`,
    isActive: true,
  });
  await ProfileModel.create({
    user: u._id,
    fullName: name,
    collegeName: "Acme",
    rollNumber: `R-${seq}`,
    phoneNumber: "9999999999",
    state: "KA",
  });
  return u._id.toString();
}

interface StatSeed {
  platform: string;
  handle: string;
  rating?: number | null;
  problemsSolved?: number | null;
  status: string;
  /** Defaults true in seedProfile so ranking tests exercise ranking, not gating. */
  verified?: boolean;
}
async function seedProfile(
  collegeId: string,
  userId: string,
  handles: { codeforces?: string; leetcode?: string; codechef?: string },
  stats: StatSeed[],
): Promise<void> {
  await CodingProfileModel.create({
    college: new Types.ObjectId(collegeId),
    user: new Types.ObjectId(userId),
    handles: {
      codeforces: handles.codeforces ?? "",
      leetcode: handles.leetcode ?? "",
      codechef: handles.codechef ?? "",
    },
    stats: stats.map((s) => ({
      platform: s.platform,
      handle: s.handle,
      rating: s.rating ?? null,
      problemsSolved: s.problemsSolved ?? null,
      status: s.status,
      verified: s.verified ?? true,
      lastFetchedAt: s.status === CodingFetchStatus.OK ? new Date() : null,
    })),
  });
}

let collegeSeq = 0;
async function setupCollege(opts: { coding?: boolean } = {}) {
  collegeSeq += 1;
  const slug = `lb-col-${collegeSeq}`;
  const platform = await makeAuthed({ role: Role.SUPER_ADMIN });
  const dto = await colleges.createCollege({ name: slug, slug }, platform.userId);
  if (opts.coding) {
    await colleges.setEntitlements(dto.id, { features: { coding_profiles: true } });
  }
  const collegeId = new Types.ObjectId(dto.id);
  const admin = await makeAuthed({
    role: Role.COLLEGE_ADMIN,
    userType: UserType.COLLEGE,
    college: collegeId,
  });
  return { collegeId: dto.id, slug, adminToken: admin.token };
}

const cfOk = (rating: number, solved: number): StatSeed => ({
  platform: CodingPlatform.CODEFORCES,
  handle: "h",
  rating,
  problemsSolved: solved,
  status: CodingFetchStatus.OK,
});

const url = (slug: string) => `/api/c/${slug}/coding-leaderboard`;

// ---------------------------------------------------------------------------

describe("coding leaderboard ranking", () => {
  it("ranks by rating desc; na/stale students are unranked (not faked)", async () => {
    const sc = await setupCollege({ coding: true });
    const dept = await OrgUnitModel.create({
      college: new Types.ObjectId(sc.collegeId),
      type: "department",
      name: "CSE",
    });

    const bob = await makeStudent(sc.collegeId, dept._id, "Bob");
    const alice = await makeStudent(sc.collegeId, dept._id, "Alice");
    const carol = await makeStudent(sc.collegeId, dept._id, "Carol");
    const dan = await makeStudent(sc.collegeId, dept._id, "Dan"); // no profile → not a row

    await seedProfile(sc.collegeId, bob, { codeforces: "bob" }, [cfOk(1800, 40)]);
    await seedProfile(sc.collegeId, alice, { codeforces: "alice" }, [cfOk(1500, 100)]);
    // Carol linked but not_found → carries a huge last-known number that must NOT rank.
    await seedProfile(sc.collegeId, carol, { codeforces: "carol" }, [
      { platform: CodingPlatform.CODEFORCES, handle: "carol", rating: 9999, status: CodingFetchStatus.NOT_FOUND },
    ]);
    void dan;

    const res = await request(app)
      .get(url(sc.slug))
      .query({ platform: "codeforces", metric: "rating" })
      .set(auth(sc.adminToken));
    expect(res.status).toBe(200);

    expect(res.body.overview).toMatchObject({
      totalStudents: 4, // all four students in view
      linked: 3, // three have a profile with a handle
      ranked: 2, // only the two OK stats
      unranked: 1, // Carol (not_found)
    });
    const ranked = res.body.rows.filter((r: { rank: number | null }) => r.rank !== null);
    expect(ranked.map((r: { fullName: string }) => r.fullName)).toEqual(["Bob", "Alice"]);
    expect(ranked.map((r: { rank: number }) => r.rank)).toEqual([1, 2]);
    // Carol present but unranked, honest status.
    const carolRow = res.body.rows.find((r: { fullName: string }) => r.fullName === "Carol");
    expect(carolRow.rank).toBeNull();
    expect(carolRow.metricValue).toBeNull();
    expect(carolRow.rankedStatus).toBe("not_found");
  });

  it("an UNVERIFIED handle is unranked even with a real ok rating (anti-fabrication)", async () => {
    const sc = await setupCollege({ coding: true });
    const real = await makeStudent(sc.collegeId, null, "Real");
    const faker = await makeStudent(sc.collegeId, null, "Faker");
    // Real student: verified handle, modest rating → ranked.
    await seedProfile(sc.collegeId, real, { codeforces: "real" }, [cfOk(1500, 50)]);
    // Faker: claims someone else's handle; the fetch succeeds (ok, 3800) but the
    // handle is UNVERIFIED, so it must be listed unranked, never at rank 1.
    await seedProfile(sc.collegeId, faker, { codeforces: "tourist" }, [
      {
        platform: CodingPlatform.CODEFORCES,
        handle: "tourist",
        rating: 3800,
        problemsSolved: 1200,
        status: CodingFetchStatus.OK,
        verified: false,
      },
    ]);

    const res = await request(app)
      .get(url(sc.slug))
      .query({ platform: "codeforces", metric: "rating" })
      .set(auth(sc.adminToken));
    expect(res.status).toBe(200);
    expect(res.body.overview).toMatchObject({ linked: 2, ranked: 1, unranked: 1 });

    const ranked = res.body.rows.filter((r: { rank: number | null }) => r.rank !== null);
    expect(ranked.map((r: { fullName: string }) => r.fullName)).toEqual(["Real"]);
    const fakerRow = res.body.rows.find((r: { fullName: string }) => r.fullName === "Faker");
    expect(fakerRow.rank).toBeNull();
    expect(fakerRow.metricValue).toBeNull();
    // The self-reported flag is surfaced on the chosen-platform stat.
    const cf = fakerRow.stats.find(
      (s: { platform: string }) => s.platform === "codeforces",
    );
    expect(cf.verified).toBe(false);
  });

  it("ranks by problemsSolved when chosen", async () => {
    const sc = await setupCollege({ coding: true });
    const a = await makeStudent(sc.collegeId, null, "Alice");
    const b = await makeStudent(sc.collegeId, null, "Bob");
    await seedProfile(sc.collegeId, a, { codeforces: "a" }, [cfOk(1500, 100)]);
    await seedProfile(sc.collegeId, b, { codeforces: "b" }, [cfOk(1800, 40)]);

    const res = await request(app)
      .get(url(sc.slug))
      .query({ platform: "codeforces", metric: "problemsSolved" })
      .set(auth(sc.adminToken));
    const ranked = res.body.rows.filter((r: { rank: number | null }) => r.rank !== null);
    expect(ranked.map((r: { fullName: string }) => r.fullName)).toEqual(["Alice", "Bob"]); // 100 > 40
  });
});

describe("coding leaderboard filters", () => {
  it("filters by org-unit subtree (descendant math)", async () => {
    const sc = await setupCollege({ coding: true });
    const dept = await OrgUnitModel.create({
      college: new Types.ObjectId(sc.collegeId), type: "department", name: "CSE",
    });
    const secA = await OrgUnitModel.create({
      college: new Types.ObjectId(sc.collegeId), type: "section", name: "A", parent: dept._id,
    });
    const secB = await OrgUnitModel.create({
      college: new Types.ObjectId(sc.collegeId), type: "section", name: "B", parent: dept._id,
    });
    const inA = await makeStudent(sc.collegeId, secA._id, "InA");
    const inB = await makeStudent(sc.collegeId, secB._id, "InB");
    await seedProfile(sc.collegeId, inA, { codeforces: "a" }, [cfOk(1600, 10)]);
    await seedProfile(sc.collegeId, inB, { codeforces: "b" }, [cfOk(1700, 20)]);

    // Filter to department → both sections' students (descendant rollup).
    const deptRes = await request(app)
      .get(url(sc.slug)).query({ platform: "codeforces", metric: "rating", unitId: dept._id.toString() })
      .set(auth(sc.adminToken));
    expect(deptRes.body.overview.totalStudents).toBe(2);

    // Filter to section A → only InA.
    const secRes = await request(app)
      .get(url(sc.slug)).query({ platform: "codeforces", metric: "rating", unitId: secA._id.toString() })
      .set(auth(sc.adminToken));
    expect(secRes.body.overview.totalStudents).toBe(1);
    expect(secRes.body.rows.map((r: { fullName: string }) => r.fullName)).toEqual(["InA"]);
  });

  it("filters by attendance-group membership", async () => {
    const sc = await setupCollege({ coding: true });
    const s1 = await makeStudent(sc.collegeId, null, "One");
    const s2 = await makeStudent(sc.collegeId, null, "Two");
    await seedProfile(sc.collegeId, s1, { codeforces: "1" }, [cfOk(1500, 10)]);
    await seedProfile(sc.collegeId, s2, { codeforces: "2" }, [cfOk(1600, 20)]);

    const group = await AttendanceGroupModel.create({
      college: new Types.ObjectId(sc.collegeId),
      name: "Being Zero",
      members: [{ student: new Types.ObjectId(s1), source: "individual" }],
    });

    const res = await request(app)
      .get(url(sc.slug))
      .query({ platform: "codeforces", metric: "rating", groupId: group._id.toString() })
      .set(auth(sc.adminToken));
    expect(res.body.overview.totalStudents).toBe(1);
    expect(res.body.rows.map((r: { fullName: string }) => r.fullName)).toEqual(["One"]);
  });

  it("a faculty sees only their scoped org-unit", async () => {
    const sc = await setupCollege({ coding: true });
    const secA = await OrgUnitModel.create({
      college: new Types.ObjectId(sc.collegeId), type: "section", name: "A",
    });
    const secB = await OrgUnitModel.create({
      college: new Types.ObjectId(sc.collegeId), type: "section", name: "B",
    });
    const inA = await makeStudent(sc.collegeId, secA._id, "InA");
    const inB = await makeStudent(sc.collegeId, secB._id, "InB");
    await seedProfile(sc.collegeId, inA, { codeforces: "a" }, [cfOk(1600, 10)]);
    await seedProfile(sc.collegeId, inB, { codeforces: "b" }, [cfOk(1700, 20)]);

    const faculty = await makeAuthed({
      role: Role.FACULTY,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(sc.collegeId),
      facultyScope: { orgUnits: [secA._id] },
    });
    const res = await request(app)
      .get(url(sc.slug)).query({ platform: "codeforces", metric: "rating" })
      .set(auth(faculty.token));
    expect(res.status).toBe(200);
    expect(res.body.overview.totalStudents).toBe(1);
    expect(res.body.rows.map((r: { fullName: string }) => r.fullName)).toEqual(["InA"]);
  });
});

describe("coding leaderboard export + gating", () => {
  it("exports a .xlsx with a Leaderboard sheet of ranked rows", async () => {
    const sc = await setupCollege({ coding: true });
    const a = await makeStudent(sc.collegeId, null, "Alice");
    await seedProfile(sc.collegeId, a, { codeforces: "a" }, [cfOk(1500, 100)]);

    const res = await request(app)
      .get(`${url(sc.slug)}/report`)
      .query({ platform: "codeforces", metric: "rating" })
      .set(auth(sc.adminToken))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as Buffer);
    const ws = wb.getWorksheet("Leaderboard");
    expect(ws).toBeTruthy();
    expect(ws!.getRow(1).getCell(1).value).toBe("Rank");
    expect(ws!.getRow(2).getCell(2).value).toBe("Alice"); // first data row
  });

  it("marks an unverified handle's rating in the .xlsx (never presented as measured)", async () => {
    const sc = await setupCollege({ coding: true });
    const faker = await makeStudent(sc.collegeId, null, "Zeta"); // sorts last (unranked)
    await seedProfile(sc.collegeId, faker, { codeforces: "tourist" }, [
      {
        platform: CodingPlatform.CODEFORCES,
        handle: "tourist",
        rating: 3800,
        problemsSolved: 1200,
        status: CodingFetchStatus.OK,
        verified: false,
      },
    ]);

    const res = await request(app)
      .get(`${url(sc.slug)}/report`)
      .query({ platform: "codeforces", metric: "rating" })
      .set(auth(sc.adminToken))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as Buffer);
    const ws = wb.getWorksheet("Leaderboard")!;
    // Zeta's CF rating cell (col 6) is marked, not a bare 3800.
    const zetaRow = ws.getRow(2);
    expect(zetaRow.getCell(2).value).toBe("Zeta");
    expect(String(zetaRow.getCell(6).value)).toBe("3800 *");
  });

  it("403s without the coding_profiles feature", async () => {
    const sc = await setupCollege({ coding: false });
    const res = await request(app)
      .get(url(sc.slug)).query({ platform: "codeforces", metric: "rating" })
      .set(auth(sc.adminToken));
    expect(res.status).toBe(403);
  });

  it("is tenant-isolated (never counts another college's students)", async () => {
    const a = await setupCollege({ coding: true });
    const b = await setupCollege({ coding: true });
    const sa = await makeStudent(a.collegeId, null, "A-student");
    const sb = await makeStudent(b.collegeId, null, "B-student");
    await seedProfile(a.collegeId, sa, { codeforces: "a" }, [cfOk(1500, 10)]);
    await seedProfile(b.collegeId, sb, { codeforces: "b" }, [cfOk(1600, 20)]);

    const res = await request(app)
      .get(url(a.slug)).query({ platform: "codeforces", metric: "rating" })
      .set(auth(a.adminToken));
    expect(res.body.overview.totalStudents).toBe(1);
    expect(res.body.rows.map((r: { fullName: string }) => r.fullName)).toEqual(["A-student"]);
  });
});
