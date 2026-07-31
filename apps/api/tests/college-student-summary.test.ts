/**
 * College STUDENT home summary (GET /c/:slug/student/summary) — the counts
 * behind the student dashboard. Proves: a college student may read it (the
 * tenant stack admits students), counts are REAL + tenant/cohort-scoped (a
 * published college-wide posting + a college enrollment are counted; features
 * with no content return 0), entitlement gating zeroes an off feature even when
 * content exists, and cross-tenant reads are denied. supertest + in-memory Mongo,
 * mirroring college-careers.test.ts.
 */
import { EnrollmentSource, PostingType, Role, UserType } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { EnrollmentModel, SubjectModel } from "../src/models/curriculum.model.js";
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
  const u = `css${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `CSS User ${counter}`,
      rollNumber: `CSSU-${counter}`,
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

async function setupCollege(
  slug: string,
  features: Record<string, boolean>,
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
  name: string,
): Promise<string> {
  const res = await request(app)
    .post(`/api/c/${slug}/org-units`)
    .set(auth(token))
    .send({ type: "department", name });
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
  await UserModel.updateOne(
    { _id: id },
    { $set: { forcePasswordChange: false } },
  );
  const login = await request(app)
    .post("/api/auth/login")
    .send({ identifier: email, password: TEMP_PW });
  expect(login.status).toBe(200);
  return { id, token: login.body.accessToken as string };
}

async function publishCollegeWidePosting(
  slug: string,
  token: string,
): Promise<void> {
  const created = await request(app)
    .post(`/api/c/${slug}/postings`)
    .set(auth(token))
    .send({
      title: "Backend Intern",
      company: "Acme Corp",
      type: PostingType.INTERNSHIP,
      orgUnitIds: [],
    });
  expect(created.status).toBe(201);
  const publish = await request(app)
    .post(`/api/c/${slug}/postings/${created.body.id}/publish`)
    .set(auth(token))
    .send({ isPublished: true });
  expect(publish.status).toBe(200);
}

/** Insert a college course enrollment for a student (source=college). */
async function enrollInCollegeCourse(
  collegeId: string,
  studentId: string,
): Promise<void> {
  await EnrollmentModel.create({
    user: new Types.ObjectId(studentId),
    subject: new Types.ObjectId(),
    source: EnrollmentSource.COLLEGE,
    college: new Types.ObjectId(collegeId),
  });
}

const url = (slug: string) => `/api/c/${slug}/student/summary`;
const coursesUrl = (slug: string) => `/api/c/${slug}/student/courses`;

let subjCounter = 0;
async function makeSubject(name: string): Promise<Types.ObjectId> {
  subjCounter += 1;
  const s = await SubjectModel.create({
    name,
    slug: `subj-${subjCounter}-${name.toLowerCase().replace(/\s+/g, "-")}`,
  });
  return s._id;
}

describe("college student summary", () => {
  it("returns real, tenant-scoped counts for the student; empty features are 0", async () => {
    const { collegeId, adminToken } = await setupCollege("css-counts", {
      courses: true,
      exams: true,
      essays: true,
      postings: true,
    });
    const unit = await createUnit("css-counts", adminToken, "CSE");
    const student = await addStudent(
      "css-counts",
      adminToken,
      "asha@css.edu",
      "R1",
      unit,
    );
    await publishCollegeWidePosting("css-counts", adminToken);
    await enrollInCollegeCourse(collegeId, student.id);

    const res = await request(app).get(url("css-counts")).set(auth(student.token));
    expect(res.status).toBe(200);
    // courses + postings have content; exams/essays have none → 0.
    expect(res.body).toEqual({ courses: 1, exams: 0, essays: 0, postings: 1 });
  });

  it("gates by entitlement: an OFF feature is 0 even when content exists", async () => {
    // Courses OFF, postings ON. A stray enrollment must NOT be counted.
    const { collegeId, adminToken } = await setupCollege("css-gate", {
      postings: true,
    });
    const unit = await createUnit("css-gate", adminToken, "CSE");
    const student = await addStudent(
      "css-gate",
      adminToken,
      "b@gate.edu",
      "R2",
      unit,
    );
    await enrollInCollegeCourse(collegeId, student.id);

    const res = await request(app).get(url("css-gate")).set(auth(student.token));
    expect(res.status).toBe(200);
    expect(res.body.courses).toBe(0); // feature off → not counted
    expect(res.body.postings).toBe(0); // on, but no content
  });

  it("denies cross-tenant reads (College A student → College B summary)", async () => {
    const a = await setupCollege("css-xa", { postings: true });
    await setupCollege("css-xb", { postings: true });
    const unitA = await createUnit("css-xa", a.adminToken, "CSE");
    const studentA = await addStudent(
      "css-xa",
      a.adminToken,
      "sa@xa.edu",
      "RA1",
      unitA,
    );

    const res = await request(app).get(url("css-xb")).set(auth(studentA.token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CROSS_TENANT_DENIED");
  });
});

describe("college student courses (My courses)", () => {
  it("returns ONLY this college's assigned courses — never individual enrollments", async () => {
    const { collegeId, adminToken } = await setupCollege("csc-list", {
      courses: true,
    });
    const unit = await createUnit("csc-list", adminToken, "CSE");
    const student = await addStudent(
      "csc-list",
      adminToken,
      "c@list.edu",
      "C1",
      unit,
    );

    const collegeSubject = await makeSubject("College DSA");
    const individualSubject = await makeSubject("Personal Python");
    // A college assignment (tenant + source=college) and a personal enrollment.
    await EnrollmentModel.create({
      user: new Types.ObjectId(student.id),
      subject: collegeSubject,
      source: EnrollmentSource.COLLEGE,
      college: new Types.ObjectId(collegeId),
    });
    await EnrollmentModel.create({
      user: new Types.ObjectId(student.id),
      subject: individualSubject,
      source: EnrollmentSource.ORDER,
      college: null,
    });

    const res = await request(app)
      .get(coursesUrl("csc-list"))
      .set(auth(student.token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].subject.name).toBe("College DSA");
  });

  it("denies cross-tenant reads (College A student → College B courses)", async () => {
    const a = await setupCollege("csc-xa", { courses: true });
    await setupCollege("csc-xb", { courses: true });
    const unitA = await createUnit("csc-xa", a.adminToken, "CSE");
    const studentA = await addStudent(
      "csc-xa",
      a.adminToken,
      "sa@cscxa.edu",
      "CA1",
      unitA,
    );

    const res = await request(app)
      .get(coursesUrl("csc-xb"))
      .set(auth(studentA.token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CROSS_TENANT_DENIED");
  });
});
