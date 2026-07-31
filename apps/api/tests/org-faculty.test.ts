/**
 * Org-structure + faculty (Phase 2) — tenant-scoped CRUD, the nesting rule, the
 * delete/children guard, bulk-create, faculty creation + scope/feature gating,
 * role guards, and the HARD cross-tenant isolation boundary. supertest +
 * in-memory Mongo.
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

let counter = 0;
async function makeUser(fields?: {
  role?: string;
  userType?: string;
  college?: Types.ObjectId | null;
}): Promise<{ token: string; userId: string }> {
  counter += 1;
  const u = `orgf${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Org User ${counter}`,
      rollNumber: `ORGF-${counter}`,
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
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function makeCollege(slug: string, createdBy: string): Promise<string> {
  const dto = await colleges.createCollege({ name: slug, slug }, createdBy);
  return dto.id;
}

/** A college with a college_admin; optionally with faculty_management on. */
async function setupCollege(
  slug: string,
  opts: { faculty?: boolean } = {},
): Promise<{ collegeId: string; adminToken: string }> {
  const platform = await makeUser({ role: Role.SUPER_ADMIN });
  const collegeId = await makeCollege(slug, platform.userId);
  if (opts.faculty) {
    await colleges.setEntitlements(collegeId, {
      features: { faculty_management: true },
    });
  }
  const admin = await makeUser({
    role: Role.COLLEGE_ADMIN,
    userType: UserType.COLLEGE,
    college: new Types.ObjectId(collegeId),
  });
  return { collegeId, adminToken: admin.token };
}

const ou = (slug: string) => `/api/c/${slug}/org-units`;

describe("org-units — CRUD, nesting, tree", () => {
  it("creates a dept → year → section tree and returns it nested", async () => {
    const { adminToken } = await setupCollege("ou-tree");
    const dept = await request(app)
      .post(ou("ou-tree"))
      .set(auth(adminToken))
      .send({ type: "department", name: "CSE" });
    expect(dept.status).toBe(201);
    expect(dept.body.parentId).toBeNull();

    const year = await request(app)
      .post(ou("ou-tree"))
      .set(auth(adminToken))
      .send({ type: "year", name: "2026", parentId: dept.body.id });
    expect(year.status).toBe(201);

    const section = await request(app)
      .post(ou("ou-tree"))
      .set(auth(adminToken))
      .send({ type: "section", name: "A", parentId: year.body.id });
    expect(section.status).toBe(201);

    const tree = await request(app).get(ou("ou-tree")).set(auth(adminToken));
    expect(tree.status).toBe(200);
    expect(tree.body.items).toHaveLength(1);
    expect(tree.body.items[0].name).toBe("CSE");
    expect(tree.body.items[0].children[0].name).toBe("2026");
    expect(tree.body.items[0].children[0].children[0].name).toBe("A");
  });

  it("rejects invalid parent→child nesting and duplicate sibling names", async () => {
    const { adminToken } = await setupCollege("ou-rules");
    const section = await request(app)
      .post(ou("ou-rules"))
      .set(auth(adminToken))
      .send({ type: "section", name: "S1" });
    // department under a section is not allowed.
    const bad = await request(app)
      .post(ou("ou-rules"))
      .set(auth(adminToken))
      .send({ type: "department", name: "X", parentId: section.body.id });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("ORG_UNIT_INVALID_PARENT");

    await request(app)
      .post(ou("ou-rules"))
      .set(auth(adminToken))
      .send({ type: "department", name: "DUP" });
    const dupe = await request(app)
      .post(ou("ou-rules"))
      .set(auth(adminToken))
      .send({ type: "department", name: "DUP" });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error.code).toBe("ORG_UNIT_NAME_TAKEN");
  });

  it("updates (rename + re-parent) and rejects a cycle", async () => {
    const { adminToken } = await setupCollege("ou-upd");
    const dept = await request(app)
      .post(ou("ou-upd"))
      .set(auth(adminToken))
      .send({ type: "department", name: "ECE" });
    const section = await request(app)
      .post(ou("ou-upd"))
      .set(auth(adminToken))
      .send({ type: "section", name: "B", parentId: dept.body.id });

    const renamed = await request(app)
      .patch(`${ou("ou-upd")}/${section.body.id}`)
      .set(auth(adminToken))
      .send({ name: "B1" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe("B1");

    // Cycle: make the department a child of its own descendant section.
    const cycle = await request(app)
      .patch(`${ou("ou-upd")}/${dept.body.id}`)
      .set(auth(adminToken))
      .send({ parentId: section.body.id });
    expect(cycle.status).toBe(400);
    expect(cycle.body.error.code).toBe("ORG_UNIT_CYCLE");
  });

  it("blocks deleting a unit with children; allows deleting a leaf", async () => {
    const { adminToken } = await setupCollege("ou-del");
    const dept = await request(app)
      .post(ou("ou-del"))
      .set(auth(adminToken))
      .send({ type: "department", name: "MECH" });
    const child = await request(app)
      .post(ou("ou-del"))
      .set(auth(adminToken))
      .send({ type: "year", name: "Y1", parentId: dept.body.id });

    const blocked = await request(app)
      .delete(`${ou("ou-del")}/${dept.body.id}`)
      .set(auth(adminToken));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("ORG_UNIT_HAS_CHILDREN");

    const leaf = await request(app)
      .delete(`${ou("ou-del")}/${child.body.id}`)
      .set(auth(adminToken));
    expect(leaf.status).toBe(200);
  });

  it("bulk-creates siblings and skips exact-duplicate names (idempotent-ish)", async () => {
    const { adminToken } = await setupCollege("ou-bulk");
    const dept = await request(app)
      .post(ou("ou-bulk"))
      .set(auth(adminToken))
      .send({ type: "department", name: "IT" });

    const first = await request(app)
      .post(`${ou("ou-bulk")}/bulk`)
      .set(auth(adminToken))
      .send({ type: "section", parentId: dept.body.id, names: ["A", "B", "C", "A"] });
    expect(first.status).toBe(201);
    expect(first.body.created.map((u: { name: string }) => u.name)).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(first.body.skipped).toContain("A");

    // Re-running skips everything already there.
    const second = await request(app)
      .post(`${ou("ou-bulk")}/bulk`)
      .set(auth(adminToken))
      .send({ type: "section", parentId: dept.body.id, names: ["A", "B", "C"] });
    expect(second.body.created).toHaveLength(0);
    expect(second.body.skipped.sort()).toEqual(["A", "B", "C"]);
  });
});

describe("org-units — tenant isolation", () => {
  it("denies a college_admin acting on ANOTHER college's structure", async () => {
    const a = await setupCollege("iso-a");
    await setupCollege("iso-b");

    // A's admin is not a member of B → resolveTenant rejects hard.
    const read = await request(app).get(ou("iso-b")).set(auth(a.adminToken));
    expect(read.status).toBe(403);
    expect(read.body.error.code).toBe("CROSS_TENANT_DENIED");

    const write = await request(app)
      .post(ou("iso-b"))
      .set(auth(a.adminToken))
      .send({ type: "department", name: "Intruder" });
    expect(write.status).toBe(403);
  });

  it("rejects a foreign unit id used as a parent (scope can't see it)", async () => {
    const a = await setupCollege("iso-pa");
    const b = await setupCollege("iso-pb");
    const bDept = await request(app)
      .post(ou("iso-pb"))
      .set(auth(b.adminToken))
      .send({ type: "department", name: "BDept" });

    // A's admin, on A's tenant, references B's unit as a parent → invalid.
    const res = await request(app)
      .post(ou("iso-pa"))
      .set(auth(a.adminToken))
      .send({ type: "year", name: "Y", parentId: bDept.body.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("ORG_UNIT_INVALID_PARENT");
  });
});

const fac = (slug: string) => `/api/c/${slug}/faculty`;

describe("faculty — feature gating + creation + scope", () => {
  it("403s when faculty_management is OFF, allows when ON", async () => {
    const off = await setupCollege("fac-off");
    const denied = await request(app)
      .get(fac("fac-off"))
      .set(auth(off.adminToken));
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("FEATURE_NOT_ENABLED");

    const on = await setupCollege("fac-on", { faculty: true });
    const ok = await request(app).get(fac("fac-on")).set(auth(on.adminToken));
    expect(ok.status).toBe(200);
  });

  it("creates a faculty user (role/userType/college/forcePasswordChange + scope)", async () => {
    const { collegeId, adminToken } = await setupCollege("fac-create", {
      faculty: true,
    });
    const unit = await request(app)
      .post(ou("fac-create"))
      .set(auth(adminToken))
      .send({ type: "department", name: "CSE" });

    const created = await request(app)
      .post(fac("fac-create"))
      .set(auth(adminToken))
      .send({
        fullName: "Dr. Ada",
        username: "dr_ada",
        email: "ada@college.edu",
        password: "Password123",
        orgUnitIds: [unit.body.id],
      });
    expect(created.status).toBe(201);
    expect(created.body.role).toBe(Role.FACULTY);
    expect(created.body.forcePasswordChange).toBe(true);
    expect(created.body.orgUnitIds).toEqual([unit.body.id]);

    const user = await UserModel.findById(created.body.id).lean();
    if (!user) throw new Error("faculty user missing");
    expect(user.role).toBe(Role.FACULTY);
    expect(user.userType).toBe(UserType.COLLEGE);
    expect(user.college?.toString()).toBe(collegeId);
    expect(user.forcePasswordChange).toBe(true);
  });

  it("rejects a scope that references a foreign / unknown unit", async () => {
    const a = await setupCollege("fac-scope-a", { faculty: true });
    const b = await setupCollege("fac-scope-b", { faculty: true });
    const bUnit = await request(app)
      .post(ou("fac-scope-b"))
      .set(auth(b.adminToken))
      .send({ type: "department", name: "BOnly" });

    const res = await request(app)
      .post(fac("fac-scope-a"))
      .set(auth(a.adminToken))
      .send({
        fullName: "X",
        username: "foreign_scope",
        email: "x@college.edu",
        password: "Password123",
        orgUnitIds: [bUnit.body.id],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("FACULTY_SCOPE_INVALID");
  });

  it("lists, updates scope, and deactivates faculty (tenant-scoped)", async () => {
    const { adminToken } = await setupCollege("fac-crud", { faculty: true });
    const unit = await request(app)
      .post(ou("fac-crud"))
      .set(auth(adminToken))
      .send({ type: "department", name: "EEE" });
    const created = await request(app)
      .post(fac("fac-crud"))
      .set(auth(adminToken))
      .send({
        fullName: "Prof. Grace",
        username: "grace_h",
        email: "grace@college.edu",
        password: "Password123",
      });
    expect(created.body.orgUnitIds).toEqual([]);

    const list = await request(app).get(fac("fac-crud")).set(auth(adminToken));
    expect(list.body.items).toHaveLength(1);

    const updated = await request(app)
      .patch(`${fac("fac-crud")}/${created.body.id}`)
      .set(auth(adminToken))
      .send({ orgUnitIds: [unit.body.id] });
    expect(updated.body.orgUnitIds).toEqual([unit.body.id]);

    const deactivated = await request(app)
      .delete(`${fac("fac-crud")}/${created.body.id}`)
      .set(auth(adminToken));
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.isActive).toBe(false);
  });

  it("rejects a duplicate username / email (409)", async () => {
    const { adminToken } = await setupCollege("fac-dupe", { faculty: true });
    const body = {
      fullName: "Dup",
      username: "dupe_user",
      email: "dupe@college.edu",
      password: "Password123",
    };
    expect(
      (await request(app).post(fac("fac-dupe")).set(auth(adminToken)).send(body))
        .status,
    ).toBe(201);
    const again = await request(app)
      .post(fac("fac-dupe"))
      .set(auth(adminToken))
      .send(body);
    expect(again.status).toBe(409);
  });
});

describe("role guards", () => {
  it("faculty can read the tree but cannot write structure or manage faculty", async () => {
    const { collegeId } = await setupCollege("guard-fac", { faculty: true });
    const facultyUser = await makeUser({
      role: Role.FACULTY,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(collegeId),
    });

    const read = await request(app)
      .get(ou("guard-fac"))
      .set(auth(facultyUser.token));
    expect(read.status).toBe(200);

    const write = await request(app)
      .post(ou("guard-fac"))
      .set(auth(facultyUser.token))
      .send({ type: "department", name: "Nope" });
    expect(write.status).toBe(403);

    const manage = await request(app)
      .get(fac("guard-fac"))
      .set(auth(facultyUser.token));
    expect(manage.status).toBe(403);
  });

  it("denies an individual (B2C) user any tenant access", async () => {
    await setupCollege("guard-ind");
    const individual = await makeUser(); // student / individual, college null
    const res = await request(app)
      .get(ou("guard-ind"))
      .set(auth(individual.token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CROSS_TENANT_DENIED");
  });
});

describe("GET /me/college — self college membership (routing spine)", () => {
  it("returns the caller's college for a college user, null for individuals", async () => {
    const { collegeId } = await setupCollege("me-college");
    // A college user of this tenant.
    const collegeUser = await makeUser({
      role: Role.COLLEGE_ADMIN,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(collegeId),
    });
    const mine = await request(app)
      .get("/api/me/college")
      .set(auth(collegeUser.token));
    expect(mine.status).toBe(200);
    expect(mine.body.college).not.toBeNull();
    expect(mine.body.college.slug).toBe("me-college");
    expect(mine.body.college.id).toBe(collegeId);
    expect(mine.body.college.status).toBe("active");

    // An individual (B2C) user has no college.
    const individual = await makeUser();
    const none = await request(app)
      .get("/api/me/college")
      .set(auth(individual.token));
    expect(none.status).toBe(200);
    expect(none.body.college).toBeNull();
  });
});
