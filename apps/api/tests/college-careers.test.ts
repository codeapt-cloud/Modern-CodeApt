/**
 * College postings (Phase 5b) — tenant-scoped authoring + the student
 * browse/apply flow over the REUSED careers engine. Proves: authoring behind
 * the `postings` feature (create → publish), a college student browsing +
 * applying via the reused apply, tenant-scoped applications review + status
 * update; feature-off 403; faculty out-of-scope denial; cross-tenant
 * author/read denial; hard isolation (College A's posting is
 * invisible/unapplyable to College B, to individual users, AND absent from the
 * global /careers feed); and that unpublished / out-of-target postings are
 * neither listed nor applyable. The existing careers suite (careers.test.ts)
 * proves individual/global postings are byte-for-byte unchanged.
 * supertest + in-memory Mongo, mirroring college-exams.test.ts.
 */
import { PostingType, Role, UserType } from "@codeapt/shared";
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

const TEMP_PW = "CodeApt@123"; // env BULK_ENROLL_DEFAULT_PASSWORD default
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let counter = 0;
async function makeUser(fields?: {
  role?: string;
  userType?: string;
  college?: Types.ObjectId | null;
}): Promise<{ token: string; userId: string }> {
  counter += 1;
  const u = `cc${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `CC User ${counter}`,
      rollNumber: `CCU-${counter}`,
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

async function makeCollege(slug: string, createdBy: string): Promise<string> {
  const dto = await colleges.createCollege({ name: slug, slug }, createdBy);
  return dto.id;
}

/** A college with a college_admin + the `postings` feature on (unless disabled). */
async function setupCollege(
  slug: string,
  features: Record<string, boolean> = { postings: true },
): Promise<{ collegeId: string; adminToken: string }> {
  const platform = await makeUser({ role: Role.SUPER_ADMIN });
  const collegeId = await makeCollege(slug, platform.userId);
  await colleges.setEntitlements(collegeId, { features });
  const admin = await makeUser({
    role: Role.COLLEGE_ADMIN,
    userType: UserType.COLLEGE,
    college: new Types.ObjectId(collegeId),
  });
  return { collegeId, adminToken: admin.token };
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

async function addStudent(
  slug: string,
  token: string,
  email: string,
  roll: string,
  orgUnitId: string,
): Promise<{ id: string; token: string }> {
  const created = await request(app)
    .post(`/api/c/${slug}/students`)
    .set(auth(token))
    .send({ fullName: email, email, rollNumber: roll, orgUnitId });
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  await UserModel.updateOne({ _id: id }, { $set: { forcePasswordChange: false } });
  const login = await request(app)
    .post("/api/auth/login")
    .send({ identifier: email, password: TEMP_PW });
  expect(login.status).toBe(200);
  return { id, token: login.body.accessToken as string };
}

/** Author + publish an in-app-apply college posting; returns its id. */
async function authorPublishedPosting(
  slug: string,
  token: string,
  opts: { orgUnitIds?: string[]; title?: string } = {},
): Promise<string> {
  const created = await request(app)
    .post(`/api/c/${slug}/postings`)
    .set(auth(token))
    .send({
      title: opts.title ?? "Backend Intern",
      company: "Acme Corp",
      type: PostingType.INTERNSHIP,
      orgUnitIds: opts.orgUnitIds ?? [],
    });
  expect(created.status).toBe(201);
  const postingId = created.body.id as string;
  const pub = await request(app)
    .post(`/api/c/${slug}/postings/${postingId}/publish`)
    .set(auth(token))
    .send({ isPublished: true });
  expect(pub.status).toBe(200);
  expect(pub.body.isPublished).toBe(true);
  return postingId;
}

describe("college postings — authoring, browse/apply, applications (reused engine)", () => {
  it("authors + publishes a posting, a student applies, and the operator reviews applicants", async () => {
    const { adminToken } = await setupCollege("cc-flow");
    const dept = await createUnit("cc-flow", adminToken, {
      type: "department",
      name: "CSE",
    });
    const postingId = await authorPublishedPosting("cc-flow", adminToken); // college-wide
    const student = await addStudent("cc-flow", adminToken, "s1@cc.edu", "R1", dept);

    // Student sees the published posting on their tenant careers surface.
    const list = await request(app)
      .get("/api/c/cc-flow/careers")
      .set(auth(student.token));
    expect(list.status).toBe(200);
    expect(list.body.items.map((p: { id: string }) => p.id)).toContain(postingId);

    // Detail loads, then the student applies via the reused apply flow.
    const detail = await request(app)
      .get(`/api/c/cc-flow/careers/${postingId}`)
      .set(auth(student.token));
    expect(detail.status).toBe(200);
    expect(detail.body.myApplication).toBeNull();

    const apply = await request(app)
      .post(`/api/c/cc-flow/careers/${postingId}/apply`)
      .set(auth(student.token))
      .send({ fullName: "Student One", email: "s1@cc.edu" });
    expect(apply.status).toBe(201);

    // Re-apply is idempotent (409 ALREADY_APPLIED via the reused unique index).
    const again = await request(app)
      .post(`/api/c/cc-flow/careers/${postingId}/apply`)
      .set(auth(student.token))
      .send({ fullName: "Student One", email: "s1@cc.edu" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ALREADY_APPLIED");

    // Operator sees the applicant (tenant-scoped) + can update status.
    const apps = await request(app)
      .get(`/api/c/cc-flow/postings/${postingId}/applications`)
      .set(auth(adminToken));
    expect(apps.status).toBe(200);
    expect(apps.body.items).toHaveLength(1);
    expect(apps.body.items[0].email).toBe("s1@cc.edu");
    const appId = apps.body.items[0].id as string;

    const status = await request(app)
      .patch(`/api/c/cc-flow/posting-applications/${appId}`)
      .set(auth(adminToken))
      .send({ status: "SHORTLISTED" });
    expect(status.status).toBe(200);
    expect(status.body.status).toBe("SHORTLISTED");

    // The authoring list reflects the application count + lifecycle.
    const manage = await request(app)
      .get("/api/c/cc-flow/postings")
      .set(auth(adminToken));
    const row = manage.body.items.find((p: { id: string }) => p.id === postingId);
    expect(row.applicationCount).toBe(1);
    expect(row.isPublished).toBe(true);
  });

  it("403s the whole surface when the `postings` feature is off", async () => {
    const { adminToken } = await setupCollege("cc-nofeat", {});
    const manage = await request(app)
      .get("/api/c/cc-nofeat/postings")
      .set(auth(adminToken));
    expect(manage.status).toBe(403);
    expect(manage.body.error.code).toBe("FEATURE_NOT_ENABLED");
  });

  it("denies faculty authoring/managing outside their org-unit scope", async () => {
    const { collegeId, adminToken } = await setupCollege("cc-scope");
    const dept = await createUnit("cc-scope", adminToken, {
      type: "department",
      name: "CSE",
    });
    const secA = await createUnit("cc-scope", adminToken, {
      type: "section",
      name: "A",
      parentId: dept,
    });
    const secB = await createUnit("cc-scope", adminToken, {
      type: "section",
      name: "B",
      parentId: dept,
    });
    const faculty = await makeUser({
      role: Role.FACULTY,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(collegeId),
    });
    await UserModel.updateOne(
      { _id: faculty.userId },
      { $set: { facultyScope: { orgUnits: [new Types.ObjectId(secA)] } } },
    );

    // Targeting section B (out of scope) → denied.
    const outOfScope = await request(app)
      .post("/api/c/cc-scope/postings")
      .set(auth(faculty.token))
      .send({ title: "Nope", company: "X", type: PostingType.FULL_TIME, orgUnitIds: [secB] });
    expect(outOfScope.status).toBe(403);
    expect(outOfScope.body.error.code).toBe("ORG_UNIT_OUT_OF_SCOPE");

    // A faculty may not create a college-wide (empty-target) posting.
    const collegeWide = await request(app)
      .post("/api/c/cc-scope/postings")
      .set(auth(faculty.token))
      .send({ title: "Nope", company: "X", type: PostingType.FULL_TIME, orgUnitIds: [] });
    expect(collegeWide.status).toBe(403);

    // Targeting section A (in scope) → allowed.
    const ok = await request(app)
      .post("/api/c/cc-scope/postings")
      .set(auth(faculty.token))
      .send({ title: "Role A", company: "X", type: PostingType.FULL_TIME, orgUnitIds: [secA] });
    expect(ok.status).toBe(201);

    // Faculty cannot manage a college-wide posting authored by the admin.
    const adminPosting = await request(app)
      .post("/api/c/cc-scope/postings")
      .set(auth(adminToken))
      .send({ title: "Wide", company: "X", type: PostingType.FULL_TIME, orgUnitIds: [] });
    const denyManage = await request(app)
      .get(`/api/c/cc-scope/postings/${adminPosting.body.id}`)
      .set(auth(faculty.token));
    expect(denyManage.status).toBe(403);
  });

  it("denies cross-tenant authoring/reads and isolates postings per college", async () => {
    const colA = await setupCollege("cc-xa");
    const colB = await setupCollege("cc-xb");
    const postingA = await authorPublishedPosting("cc-xa", colA.adminToken);

    // Cross-tenant: College A admin cannot reach College B's space at all.
    const crossManage = await request(app)
      .get("/api/c/cc-xb/postings")
      .set(auth(colA.adminToken));
    expect(crossManage.status).toBe(403);
    expect(crossManage.body.error.code).toBe("CROSS_TENANT_DENIED");

    // College B's authoring list does NOT contain College A's posting.
    const bManage = await request(app)
      .get("/api/c/cc-xb/postings")
      .set(auth(colB.adminToken));
    expect(bManage.status).toBe(200);
    expect(bManage.body.items.map((p: { id: string }) => p.id)).not.toContain(postingA);

    // College B cannot fetch College A's posting by id via its own slug → 404.
    const bReadA = await request(app)
      .get(`/api/c/cc-xb/postings/${postingA}`)
      .set(auth(colB.adminToken));
    expect(bReadA.status).toBe(404);

    // A College B student can neither see nor apply to College A's posting.
    const deptB = await createUnit("cc-xb", colB.adminToken, {
      type: "department",
      name: "ECE",
    });
    const bStudent = await addStudent("cc-xb", colB.adminToken, "b@xb.edu", "B1", deptB);
    const bList = await request(app)
      .get("/api/c/cc-xb/careers")
      .set(auth(bStudent.token));
    expect(bList.body.items.map((p: { id: string }) => p.id)).not.toContain(postingA);
    // The posting id isn't reachable via B's student route either → 404.
    const bApply = await request(app)
      .post(`/api/c/cc-xb/careers/${postingA}/apply`)
      .set(auth(bStudent.token))
      .send({ fullName: "B", email: "b@xb.edu" });
    expect(bApply.status).toBe(404);
  });

  it("keeps college postings out of the global feed + blocks individual apply", async () => {
    const { adminToken } = await setupCollege("cc-global");
    const postingId = await authorPublishedPosting("cc-global", adminToken);

    // An individual (B2C) user's global careers feed must NOT contain it…
    const individual = await makeUser();
    const feed = await request(app)
      .get("/api/careers")
      .set(auth(individual.token));
    expect(feed.status).toBe(200);
    expect(feed.body.items.map((p: { id: string }) => p.id)).not.toContain(postingId);

    // …and the individual can't open or apply to it by id (404, not found).
    const openById = await request(app)
      .get(`/api/careers/${postingId}`)
      .set(auth(individual.token));
    expect(openById.status).toBe(404);
    const applyById = await request(app)
      .post(`/api/careers/${postingId}/apply`)
      .set(auth(individual.token))
      .send({ fullName: "Indie", email: individual.userId + "@x.com" });
    expect(applyById.status).toBe(404);

    // The individual is not a member → the tenant space 403s.
    const denied = await request(app)
      .get("/api/c/cc-global/careers")
      .set(auth(individual.token));
    expect(denied.status).toBe(403);
  });

  it("hides unpublished + out-of-target postings from students", async () => {
    const { adminToken } = await setupCollege("cc-draft");
    const dept = await createUnit("cc-draft", adminToken, {
      type: "department",
      name: "CSE",
    });
    const secA = await createUnit("cc-draft", adminToken, {
      type: "section",
      name: "A",
      parentId: dept,
    });
    const secB = await createUnit("cc-draft", adminToken, {
      type: "section",
      name: "B",
      parentId: dept,
    });

    // A draft (unpublished) posting.
    const draft = await request(app)
      .post("/api/c/cc-draft/postings")
      .set(auth(adminToken))
      .send({ title: "Draft", company: "X", type: PostingType.FULL_TIME, orgUnitIds: [] });
    const draftId = draft.body.id as string;
    // A published posting targeted only at section A.
    const targetedA = await authorPublishedPosting("cc-draft", adminToken, {
      orgUnitIds: [secA],
      title: "Only A",
    });

    const studentB = await addStudent("cc-draft", adminToken, "b@cc.edu", "B1", secB);
    const list = await request(app)
      .get("/api/c/cc-draft/careers")
      .set(auth(studentB.token));
    const ids = list.body.items.map((p: { id: string }) => p.id);
    expect(ids).not.toContain(draftId); // unpublished hidden
    expect(ids).not.toContain(targetedA); // out-of-target hidden

    // Section-B student can't apply to the section-A posting → 403 out-of-scope.
    const apply = await request(app)
      .post(`/api/c/cc-draft/careers/${targetedA}/apply`)
      .set(auth(studentB.token))
      .send({ fullName: "B", email: "b@cc.edu" });
    expect(apply.status).toBe(403);
    expect(apply.body.error.code).toBe("ORG_UNIT_OUT_OF_SCOPE");

    // …and can't apply to the draft (unpublished → 404).
    const applyDraft = await request(app)
      .post(`/api/c/cc-draft/careers/${draftId}/apply`)
      .set(auth(studentB.token))
      .send({ fullName: "B", email: "b@cc.edu" });
    expect(applyDraft.status).toBe(404);
  });
});
