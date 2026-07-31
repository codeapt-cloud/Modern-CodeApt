/**
 * College students + bulk import (Phase 3) — the model's per-college roll
 * uniqueness, single-add, the validate→preview→commit pipeline (verdicts, no
 * writes on preview, commit safety + idempotency), faculty-scope enforcement,
 * cross-tenant denial, the deleteOrgUnit student-guard, the template CSV, and the
 * pure helpers. supertest + in-memory Mongo. Individual (B2C) flows are untouched.
 */
import {
  collectDescendantUnitIds,
  normalizeUnitKey,
  Role,
  UserType,
  validateStudentImportRow,
} from "@codeapt/shared";
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
  const u = `stu${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Stu User ${counter}`,
      rollNumber: `STUU-${counter}`,
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

/** A college + a college_admin token; optionally with bulk_import enabled. */
async function setupCollege(
  slug: string,
  opts: { bulkImport?: boolean } = {},
): Promise<{ collegeId: string; adminToken: string }> {
  const platform = await makeUser({ role: Role.SUPER_ADMIN });
  const collegeId = await makeCollege(slug, platform.userId);
  if (opts.bulkImport) {
    await colleges.setEntitlements(collegeId, {
      features: { bulk_import: true },
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
const st = (slug: string) => `/api/c/${slug}/students`;

async function createUnit(
  slug: string,
  token: string,
  body: { type: string; name: string; parentId?: string },
): Promise<string> {
  const res = await request(app).post(ou(slug)).set(auth(token)).send(body);
  expect(res.status).toBe(201);
  return res.body.id as string;
}

/** Build CSE › 2026 › {A,B} and return the ids. */
async function seedTree(slug: string, token: string) {
  const dept = await createUnit(slug, token, {
    type: "department",
    name: "CSE",
  });
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

function studentCount(collegeId: string): Promise<number> {
  return UserModel.countDocuments({
    college: new Types.ObjectId(collegeId),
    role: Role.STUDENT,
    userType: UserType.COLLEGE,
  });
}

// ---------------------------------------------------------------------------
// Pure helpers (no DB)
// ---------------------------------------------------------------------------

describe("pure helpers", () => {
  it("validateStudentImportRow flags missing/invalid fields, trims + lowercases", () => {
    const ok = validateStudentImportRow({
      fullName: "  Asha Rao ",
      email: " Asha@College.EDU ",
      rollNumber: " R1 ",
      orgUnit: " CSE / 2026 / A ",
    });
    expect(ok.ok).toBe(true);
    expect(ok.value).toEqual({
      fullName: "Asha Rao",
      email: "asha@college.edu",
      rollNumber: "R1",
      orgUnit: "CSE / 2026 / A",
    });

    const bad = validateStudentImportRow({
      fullName: "",
      email: "not-an-email",
      rollNumber: "",
      orgUnit: "",
    });
    expect(bad.ok).toBe(false);
    expect(bad.errors.length).toBeGreaterThanOrEqual(3);
  });

  it("normalizeUnitKey canonicalizes paths + bare names", () => {
    expect(normalizeUnitKey("CSE / 2026 / A")).toBe("cse / 2026 / a");
    expect(normalizeUnitKey(" cse /2026/ a ")).toBe("cse / 2026 / a");
    expect(normalizeUnitKey("CSE")).toBe("cse");
  });

  it("collectDescendantUnitIds returns assigned + all descendants, ignoring unknowns", () => {
    const units = [
      { id: "d", parentId: null },
      { id: "y", parentId: "d" },
      { id: "a", parentId: "y" },
      { id: "b", parentId: "y" },
      { id: "other", parentId: null },
    ];
    expect(collectDescendantUnitIds(units, ["y"]).sort()).toEqual(
      ["a", "b", "y"].sort(),
    );
    expect(collectDescendantUnitIds(units, ["a"])).toEqual(["a"]);
    expect(collectDescendantUnitIds(units, ["ghost"])).toEqual([]);
    expect(collectDescendantUnitIds(units, ["d"]).sort()).toEqual(
      ["a", "b", "d", "y"].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Model + single-add
// ---------------------------------------------------------------------------

describe("college-student model + single-add", () => {
  it("creates a college student (role/userType/college/orgUnit/forcePasswordChange)", async () => {
    const { collegeId, adminToken } = await setupCollege("stu-add");
    const { a } = await seedTree("stu-add", adminToken);

    const res = await request(app)
      .post(st("stu-add"))
      .set(auth(adminToken))
      .send({
        fullName: "Asha Rao",
        email: "asha@stuadd.edu",
        rollNumber: "R1",
        orgUnitId: a,
      });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe("student");
    expect(res.body.orgUnitId).toBe(a);
    expect(res.body.forcePasswordChange).toBe(true);

    const user = await UserModel.findById(res.body.id);
    expect(user?.userType).toBe("college");
    expect(user?.college?.toString()).toBe(collegeId);
    expect(user?.rollNumber).toBe("R1");
    expect(user?.orgUnit?.toString()).toBe(a);
  });

  it("rejects an org-unit not in the tenant (400)", async () => {
    const { adminToken } = await setupCollege("stu-badunit");
    const foreign = new Types.ObjectId().toString();
    const res = await request(app)
      .post(st("stu-badunit"))
      .set(auth(adminToken))
      .send({
        fullName: "X",
        email: "x@stubadunit.edu",
        rollNumber: "R1",
        orgUnitId: foreign,
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("ORG_UNIT_OUT_OF_SCOPE");
  });

  it("enforces PER-COLLEGE roll uniqueness (shared across colleges OK, dupe within → 409)", async () => {
    const colA = await setupCollege("stu-rollA");
    const colB = await setupCollege("stu-rollB");
    const aUnit = await createUnit("stu-rollA", colA.adminToken, {
      type: "department",
      name: "CSE",
    });
    const bUnit = await createUnit("stu-rollB", colB.adminToken, {
      type: "department",
      name: "CSE",
    });

    const r1 = await request(app)
      .post(st("stu-rollA"))
      .set(auth(colA.adminToken))
      .send({
        fullName: "A1",
        email: "a1@rolla.edu",
        rollNumber: "SHARED",
        orgUnitId: aUnit,
      });
    expect(r1.status).toBe(201);

    // SAME roll in a DIFFERENT college is fine.
    const r2 = await request(app)
      .post(st("stu-rollB"))
      .set(auth(colB.adminToken))
      .send({
        fullName: "B1",
        email: "b1@rollb.edu",
        rollNumber: "SHARED",
        orgUnitId: bUnit,
      });
    expect(r2.status).toBe(201);

    // SAME roll AGAIN in college A → rejected.
    const dup = await request(app)
      .post(st("stu-rollA"))
      .set(auth(colA.adminToken))
      .send({
        fullName: "A2",
        email: "a2@rolla.edu",
        rollNumber: "SHARED",
        orgUnitId: aUnit,
      });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("ROLL_NUMBER_TAKEN");
  });
});

// ---------------------------------------------------------------------------
// Edit details (PATCH)
// ---------------------------------------------------------------------------

describe("edit student details", () => {
  async function addStudent(
    slug: string,
    token: string,
    body: { fullName: string; email: string; rollNumber: string; orgUnitId: string },
  ): Promise<string> {
    const res = await request(app).post(st(slug)).set(auth(token)).send(body);
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  it("updates name / email / roll / org-unit; email also moves the login handle", async () => {
    const { adminToken } = await setupCollege("stu-edit");
    const { a, b } = await seedTree("stu-edit", adminToken);
    const id = await addStudent("stu-edit", adminToken, {
      fullName: "Old Name",
      email: "old@edit.edu",
      rollNumber: "E1",
      orgUnitId: a,
    });

    const res = await request(app)
      .patch(`${st("stu-edit")}/${id}`)
      .set(auth(adminToken))
      .send({
        fullName: "New Name",
        email: "new@edit.edu",
        rollNumber: "E2",
        orgUnitId: b,
      });
    expect(res.status).toBe(200);
    expect(res.body.fullName).toBe("New Name");
    expect(res.body.email).toBe("new@edit.edu");
    expect(res.body.rollNumber).toBe("E2");
    expect(res.body.orgUnitId).toBe(b);

    const user = await UserModel.findById(id);
    // Email doubles as the login handle.
    expect(user?.username).toBe("new@edit.edu");
    expect(user?.orgUnit?.toString()).toBe(b);
  });

  it("rejects an email already taken by another user (409)", async () => {
    const { adminToken } = await setupCollege("stu-edit-dupe");
    const unit = await createUnit("stu-edit-dupe", adminToken, {
      type: "department",
      name: "CSE",
    });
    await addStudent("stu-edit-dupe", adminToken, {
      fullName: "First",
      email: "first@dupe.edu",
      rollNumber: "D1",
      orgUnitId: unit,
    });
    const second = await addStudent("stu-edit-dupe", adminToken, {
      fullName: "Second",
      email: "second@dupe.edu",
      rollNumber: "D2",
      orgUnitId: unit,
    });

    const res = await request(app)
      .patch(`${st("stu-edit-dupe")}/${second}`)
      .set(auth(adminToken))
      .send({ email: "first@dupe.edu" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("rejects a roll number already used in the same college (409)", async () => {
    const { adminToken } = await setupCollege("stu-edit-roll");
    const unit = await createUnit("stu-edit-roll", adminToken, {
      type: "department",
      name: "CSE",
    });
    await addStudent("stu-edit-roll", adminToken, {
      fullName: "A",
      email: "a@roll.edu",
      rollNumber: "RR1",
      orgUnitId: unit,
    });
    const b = await addStudent("stu-edit-roll", adminToken, {
      fullName: "B",
      email: "b@roll.edu",
      rollNumber: "RR2",
      orgUnitId: unit,
    });

    const res = await request(app)
      .patch(`${st("stu-edit-roll")}/${b}`)
      .set(auth(adminToken))
      .send({ rollNumber: "RR1" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ROLL_NUMBER_TAKEN");
  });

  it("faculty may edit in-scope students but not reassign to an out-of-scope unit (403)", async () => {
    const { collegeId, adminToken } = await setupCollege("stu-edit-scope");
    const { a, b } = await seedTree("stu-edit-scope", adminToken);
    const id = await addStudent("stu-edit-scope", adminToken, {
      fullName: "Scoped",
      email: "scoped@es.edu",
      rollNumber: "S1",
      orgUnitId: a,
    });

    const faculty = await makeUser({
      role: Role.FACULTY,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(collegeId),
    });
    await UserModel.updateOne(
      { _id: faculty.userId },
      { $set: { facultyScope: { orgUnits: [new Types.ObjectId(a)] } } },
    );

    // In-scope rename → ok.
    const ok = await request(app)
      .patch(`${st("stu-edit-scope")}/${id}`)
      .set(auth(faculty.token))
      .send({ fullName: "Renamed" });
    expect(ok.status).toBe(200);
    expect(ok.body.fullName).toBe("Renamed");

    // Reassign to section B (out of scope) → 403.
    const bad = await request(app)
      .patch(`${st("stu-edit-scope")}/${id}`)
      .set(auth(faculty.token))
      .send({ orgUnitId: b });
    expect(bad.status).toBe(403);
    expect(bad.body.error.code).toBe("ORG_UNIT_OUT_OF_SCOPE");
  });

  it("reactivates a deactivated student (isActive: true)", async () => {
    const { adminToken } = await setupCollege("stu-reactivate");
    const unit = await createUnit("stu-reactivate", adminToken, {
      type: "department",
      name: "CSE",
    });
    const id = await addStudent("stu-reactivate", adminToken, {
      fullName: "Toggle",
      email: "toggle@react.edu",
      rollNumber: "T1",
      orgUnitId: unit,
    });

    // Deactivate via the DELETE endpoint.
    const off = await request(app)
      .delete(`${st("stu-reactivate")}/${id}`)
      .set(auth(adminToken));
    expect(off.status).toBe(200);
    expect(off.body.isActive).toBe(false);

    // Reactivate via PATCH.
    const on = await request(app)
      .patch(`${st("stu-reactivate")}/${id}`)
      .set(auth(adminToken))
      .send({ isActive: true });
    expect(on.status).toBe(200);
    expect(on.body.isActive).toBe(true);

    const user = await UserModel.findById(id);
    expect(user?.isActive).toBe(true);
  });

  it("denies cross-tenant edit (College A admin → College B student)", async () => {
    const colA = await setupCollege("stu-edit-xa");
    const colB = await setupCollege("stu-edit-xb");
    const unitB = await createUnit("stu-edit-xb", colB.adminToken, {
      type: "department",
      name: "CSE",
    });
    const bStudent = await addStudent("stu-edit-xb", colB.adminToken, {
      fullName: "B Student",
      email: "bs@xb.edu",
      rollNumber: "XB1",
      orgUnitId: unitB,
    });

    const res = await request(app)
      .patch(`${st("stu-edit-xb")}/${bStudent}`)
      .set(auth(colA.adminToken))
      .send({ fullName: "Hacked" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CROSS_TENANT_DENIED");
  });
});

// ---------------------------------------------------------------------------
// Import — preview
// ---------------------------------------------------------------------------

describe("import preview — verdicts, no writes", () => {
  it("flags invalid / unknown-unit / in-file dup / existing dup and summarizes; writes nothing", async () => {
    const { collegeId, adminToken } = await setupCollege("stu-prev", {
      bulkImport: true,
    });
    await seedTree("stu-prev", adminToken);

    // An existing student to trigger existing-dup detection.
    await request(app)
      .post(st("stu-prev"))
      .set(auth(adminToken))
      .send({
        fullName: "Existing",
        email: "existing@prev.edu",
        rollNumber: "EX1",
        orgUnitId: (await request(app).get(ou("stu-prev")).set(auth(adminToken)))
          .body.items[0].children[0].children[0].id, // CSE›2026›A
      });
    const before = await studentCount(collegeId);

    const rows = [
      // ok
      { fullName: "New One", email: "new1@prev.edu", rollNumber: "N1", orgUnit: "CSE / 2026 / A" },
      // invalid (missing email + roll)
      { fullName: "Bad", email: "", rollNumber: "", orgUnit: "CSE / 2026 / A" },
      // unknown org-unit
      { fullName: "Ghost", email: "ghost@prev.edu", rollNumber: "N2", orgUnit: "NOPE / X" },
      // in-file dup email of row 0
      { fullName: "Dup", email: "new1@prev.edu", rollNumber: "N3", orgUnit: "CSE / 2026 / B" },
      // existing dup roll + email
      { fullName: "Ex", email: "existing@prev.edu", rollNumber: "EX1", orgUnit: "CSE / 2026 / A" },
    ];

    const res = await request(app)
      .post(`${st("stu-prev")}/import/preview`)
      .set(auth(adminToken))
      .send({ rows });
    expect(res.status).toBe(200);
    expect(res.body.summary.total).toBe(5);
    expect(res.body.summary.ok).toBe(1);
    expect(res.body.summary.errors).toBe(4);
    expect(res.body.rows[0].status).toBe("ok");
    expect(res.body.rows[0].orgUnitId).toBeTruthy();
    expect(res.body.rows[1].status).toBe("error");
    expect(res.body.rows[2].status).toBe("error");
    expect(res.body.rows[3].status).toBe("error");
    expect(res.body.rows[4].status).toBe("error");

    // Preview must NOT write.
    expect(await studentCount(collegeId)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Import — commit
// ---------------------------------------------------------------------------

describe("import commit — safety + idempotency + feature gate", () => {
  it("creates valid rows, skips invalid/dupes, and is idempotent on re-commit", async () => {
    const { collegeId, adminToken } = await setupCollege("stu-commit", {
      bulkImport: true,
    });
    await seedTree("stu-commit", adminToken);

    const rows = [
      { fullName: "One", email: "one@commit.edu", rollNumber: "C1", orgUnit: "CSE / 2026 / A" },
      { fullName: "Two", email: "two@commit.edu", rollNumber: "C2", orgUnit: "CSE / 2026 / B" },
      { fullName: "BadUnit", email: "bad@commit.edu", rollNumber: "C3", orgUnit: "NOPE" },
      { fullName: "DupInFile", email: "one@commit.edu", rollNumber: "C9", orgUnit: "CSE / 2026 / A" },
    ];

    const first = await request(app)
      .post(`${st("stu-commit")}/import/commit`)
      .set(auth(adminToken))
      .send({ rows });
    expect(first.status).toBe(200);
    expect(first.body.summary.created).toBe(2);
    expect(first.body.summary.skipped).toBe(2); // bad unit + in-file dup
    expect(first.body.summary.failed).toBe(0);
    expect(await studentCount(collegeId)).toBe(2);

    // Re-commit the SAME rows → everything now duplicates → nothing created.
    const second = await request(app)
      .post(`${st("stu-commit")}/import/commit`)
      .set(auth(adminToken))
      .send({ rows });
    expect(second.status).toBe(200);
    expect(second.body.summary.created).toBe(0);
    expect(await studentCount(collegeId)).toBe(2);
  });

  it("403s when bulk_import is OFF", async () => {
    const { adminToken } = await setupCollege("stu-nofeat"); // no bulkImport
    const res = await request(app)
      .post(`${st("stu-nofeat")}/import/preview`)
      .set(auth(adminToken))
      .send({ rows: [{ fullName: "A", email: "a@n.edu", rollNumber: "R", orgUnit: "X" }] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FEATURE_NOT_ENABLED");
  });

  it("returns the template CSV with the exact headers", async () => {
    const { adminToken } = await setupCollege("stu-tmpl", { bulkImport: true });
    const res = await request(app)
      .get(`${st("stu-tmpl")}/import/template`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.text.split(/\r?\n/)[0]).toBe("fullName,email,rollNumber,orgUnit");
  });
});

// ---------------------------------------------------------------------------
// Faculty scope + cross-tenant
// ---------------------------------------------------------------------------

describe("faculty scope + tenant isolation", () => {
  it("faculty sees/creates only in-scope; admin sees all; out-of-scope rejected", async () => {
    const { collegeId, adminToken } = await setupCollege("stu-scope", {
      bulkImport: true,
    });
    const { a, b } = await seedTree("stu-scope", adminToken);

    // A faculty scoped to section A only.
    const faculty = await makeUser({
      role: Role.FACULTY,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(collegeId),
    });
    await UserModel.updateOne(
      { _id: faculty.userId },
      { $set: { facultyScope: { orgUnits: [new Types.ObjectId(a)] } } },
    );

    // Admin adds one student in A and one in B.
    await request(app).post(st("stu-scope")).set(auth(adminToken)).send({
      fullName: "In A",
      email: "ina@scope.edu",
      rollNumber: "A1",
      orgUnitId: a,
    });
    await request(app).post(st("stu-scope")).set(auth(adminToken)).send({
      fullName: "In B",
      email: "inb@scope.edu",
      rollNumber: "B1",
      orgUnitId: b,
    });

    // Faculty list → only the A student.
    const facList = await request(app)
      .get(st("stu-scope"))
      .set(auth(faculty.token));
    expect(facList.status).toBe(200);
    expect(facList.body.items).toHaveLength(1);
    expect(facList.body.items[0].orgUnitId).toBe(a);

    // Admin list → both.
    const admList = await request(app)
      .get(st("stu-scope"))
      .set(auth(adminToken));
    expect(admList.body.items).toHaveLength(2);

    // Faculty adds into A (ok) and into B (out of scope → 403).
    const okAdd = await request(app)
      .post(st("stu-scope"))
      .set(auth(faculty.token))
      .send({ fullName: "Fac A", email: "faca@scope.edu", rollNumber: "A2", orgUnitId: a });
    expect(okAdd.status).toBe(201);
    const badAdd = await request(app)
      .post(st("stu-scope"))
      .set(auth(faculty.token))
      .send({ fullName: "Fac B", email: "facb@scope.edu", rollNumber: "B2", orgUnitId: b });
    expect(badAdd.status).toBe(403);
    expect(badAdd.body.error.code).toBe("ORG_UNIT_OUT_OF_SCOPE");

    // Faculty import into B → that row errors as out-of-scope; commit skips it.
    const prev = await request(app)
      .post(`${st("stu-scope")}/import/preview`)
      .set(auth(faculty.token))
      .send({
        rows: [
          { fullName: "F1", email: "f1@scope.edu", rollNumber: "A3", orgUnit: "CSE / 2026 / A" },
          { fullName: "F2", email: "f2@scope.edu", rollNumber: "B3", orgUnit: "CSE / 2026 / B" },
        ],
      });
    expect(prev.body.summary.ok).toBe(1);
    expect(prev.body.summary.errors).toBe(1);
    expect(prev.body.rows[1].errors.join(" ")).toContain("scope");
  });

  it("denies cross-tenant list + import (College A admin → College B)", async () => {
    const colA = await setupCollege("stu-xa", { bulkImport: true });
    await setupCollege("stu-xb", { bulkImport: true });

    const list = await request(app).get(st("stu-xb")).set(auth(colA.adminToken));
    expect(list.status).toBe(403);
    expect(list.body.error.code).toBe("CROSS_TENANT_DENIED");

    const imp = await request(app)
      .post(`${st("stu-xb")}/import/preview`)
      .set(auth(colA.adminToken))
      .send({ rows: [{ fullName: "X", email: "x@xb.edu", rollNumber: "R", orgUnit: "Y" }] });
    expect(imp.status).toBe(403);
    expect(imp.body.error.code).toBe("CROSS_TENANT_DENIED");
  });
});

// ---------------------------------------------------------------------------
// deleteOrgUnit student-guard (Phase 2a seam, now implemented)
// ---------------------------------------------------------------------------

describe("deleteOrgUnit — student guard", () => {
  it("blocks deleting a unit that has students assigned (409)", async () => {
    const { adminToken } = await setupCollege("stu-del");
    const dept = await createUnit("stu-del", adminToken, {
      type: "department",
      name: "CSE",
    });
    await request(app).post(st("stu-del")).set(auth(adminToken)).send({
      fullName: "S",
      email: "s@del.edu",
      rollNumber: "D1",
      orgUnitId: dept,
    });

    const res = await request(app)
      .delete(`${ou("stu-del")}/${dept}`)
      .set(auth(adminToken));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ORG_UNIT_HAS_STUDENTS");
  });
});
