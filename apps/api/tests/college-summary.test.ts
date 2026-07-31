/**
 * College dashboard summary (GET /c/:slug/summary) — the single aggregate read
 * behind the workspace landing. Proves: correct counts (students, faculty,
 * org-units, granted courses, course assignments) + recent students; faculty
 * scope narrows the student count/list; cross-tenant is denied; and a college
 * STUDENT (a tenant member, but not an operator) is forbidden. supertest +
 * in-memory Mongo, mirroring college-courses.test.ts.
 */
import { Role, UserType } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { SubjectModel } from "../src/models/curriculum.model.js";
import { UserModel } from "../src/models/user.model.js";
import * as colleges from "../src/services/college.service.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

const TEMP_PW = "CodeApt@123"; // env BULK_ENROLL_DEFAULT_PASSWORD default

let counter = 0;
async function makeUser(fields?: {
  role?: string;
  userType?: string;
  college?: Types.ObjectId | null;
}): Promise<{ token: string; userId: string }> {
  counter += 1;
  const u = `cs${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `CS User ${counter}`,
      rollNumber: `CSU-${counter}`,
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

/** A college with a college_admin; the `courses` feature on. */
async function setupCollege(
  slug: string,
): Promise<{ collegeId: string; adminToken: string }> {
  const platform = await makeUser({ role: Role.SUPER_ADMIN });
  const collegeId = await makeCollege(slug, platform.userId);
  await colleges.setEntitlements(collegeId, { features: { courses: true } });
  const admin = await makeUser({
    role: Role.COLLEGE_ADMIN,
    userType: UserType.COLLEGE,
    college: new Types.ObjectId(collegeId),
  });
  return { collegeId, adminToken: admin.token };
}

let courseSeq = 0;
async function seedCourse(): Promise<string> {
  courseSeq += 1;
  const subject = await SubjectModel.create({
    name: `Summary Course ${courseSeq}`,
    slug: `summary-course-${courseSeq}`,
    isVisible: true,
    price: 0,
    discountPrice: 0,
  });
  return subject._id.toString();
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
): Promise<string> {
  const res = await request(app)
    .post(`/api/c/${slug}/students`)
    .set(auth(token))
    .send({ fullName: email, email, rollNumber: roll, orgUnitId });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

const summary = (slug: string) => `/api/c/${slug}/summary`;

describe("college summary — counts + recent students", () => {
  it("returns correct aggregate counts and recent students", async () => {
    const { collegeId, adminToken } = await setupCollege("cs-counts");
    const subjectId = await seedCourse();
    await colleges.grantCourses(collegeId, [subjectId]);

    const dept = await createUnit("cs-counts", adminToken, {
      type: "department",
      name: "CSE",
    });
    const secA = await createUnit("cs-counts", adminToken, {
      type: "section",
      name: "A",
      parentId: dept,
    });
    const s1 = await addStudent("cs-counts", adminToken, "a@cs.edu", "R1", secA);
    const s2 = await addStudent("cs-counts", adminToken, "b@cs.edu", "R2", secA);
    await addStudent("cs-counts", adminToken, "c@cs.edu", "R3", secA);

    // A faculty member (counts toward faculty).
    const fac = await makeUser({
      role: Role.FACULTY,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(collegeId),
    });
    void fac;

    // Assign the granted course to two students → 2 course assignments.
    await request(app)
      .post(`/api/c/cs-counts/courses/${subjectId}/assign`)
      .set(auth(adminToken))
      .send({ studentIds: [s1, s2] });

    const res = await request(app)
      .get(summary("cs-counts"))
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({
      students: 3,
      faculty: 1,
      orgUnits: 2,
      grantedCourses: 1,
      courseAssignments: 2,
    });
    // Recent students: newest-first, capped, and in this tenant.
    expect(res.body.recentStudents.length).toBe(3);
    expect(res.body.recentStudents[0].email).toBe("c@cs.edu");
  });

  it("caps recent students at 5 while the total reflects all", async () => {
    const { adminToken } = await setupCollege("cs-recent");
    const dept = await createUnit("cs-recent", adminToken, {
      type: "department",
      name: "CSE",
    });
    for (let i = 0; i < 7; i += 1) {
      await addStudent("cs-recent", adminToken, `r${i}@cs.edu`, `RR${i}`, dept);
    }
    const res = await request(app)
      .get(summary("cs-recent"))
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.counts.students).toBe(7);
    expect(res.body.recentStudents.length).toBe(5);
  });

  it("narrows the student count/list to a faculty member's scope", async () => {
    const { collegeId, adminToken } = await setupCollege("cs-scope");
    const dept = await createUnit("cs-scope", adminToken, {
      type: "department",
      name: "CSE",
    });
    const secA = await createUnit("cs-scope", adminToken, {
      type: "section",
      name: "A",
      parentId: dept,
    });
    const secB = await createUnit("cs-scope", adminToken, {
      type: "section",
      name: "B",
      parentId: dept,
    });
    await addStudent("cs-scope", adminToken, "ina@cs.edu", "A1", secA);
    await addStudent("cs-scope", adminToken, "inb1@cs.edu", "B1", secB);
    await addStudent("cs-scope", adminToken, "inb2@cs.edu", "B2", secB);

    // Faculty scoped to section B only → sees 2 students, not 3.
    const faculty = await makeUser({
      role: Role.FACULTY,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(collegeId),
    });
    await UserModel.updateOne(
      { _id: faculty.userId },
      { $set: { facultyScope: { orgUnits: [new Types.ObjectId(secB)] } } },
    );

    const res = await request(app)
      .get(summary("cs-scope"))
      .set(auth(faculty.token));
    expect(res.status).toBe(200);
    expect(res.body.counts.students).toBe(2);
    expect(res.body.recentStudents.length).toBe(2);
    // The whole college still has 3 students (admin view).
    const adminRes = await request(app)
      .get(summary("cs-scope"))
      .set(auth(adminToken));
    expect(adminRes.body.counts.students).toBe(3);
  });

  it("denies cross-tenant summary access", async () => {
    const colA = await setupCollege("cs-xa");
    await setupCollege("cs-xb");
    const res = await request(app)
      .get(summary("cs-xb"))
      .set(auth(colA.adminToken));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CROSS_TENANT_DENIED");
  });

  it("forbids a college STUDENT (tenant member, not an operator)", async () => {
    const { collegeId, adminToken } = await setupCollege("cs-student");
    const dept = await createUnit("cs-student", adminToken, {
      type: "department",
      name: "CSE",
    });
    await addStudent("cs-student", adminToken, "learner@cs.edu", "L1", dept);
    void collegeId;

    // Clear the forced-change flag and log in as the student.
    await UserModel.updateOne(
      { email: "learner@cs.edu" },
      { $set: { forcePasswordChange: false } },
    );
    const login = await request(app)
      .post("/api/auth/login")
      .send({ identifier: "learner@cs.edu", password: TEMP_PW });
    expect(login.status).toBe(200);
    const studentToken = login.body.accessToken as string;

    const res = await request(app)
      .get(summary("cs-student"))
      .set(auth(studentToken));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });
});
