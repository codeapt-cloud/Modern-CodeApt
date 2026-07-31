/**
 * College courses (Phase 4a) — assigning super-admin-granted courses to college
 * students and revoking, all tenant-scoped + `courses`-feature + grant gated +
 * faculty-scoped, REUSING the existing enrollment/player engine. Proves: assign/
 * revoke + idempotency, feature-off + not-granted + cross-tenant + out-of-scope
 * denials, a college student can access an ASSIGNED course via the existing
 * player but not an unassigned one, college students can't self-enroll, and
 * individual (B2C) self-enroll is unchanged. supertest + in-memory Mongo.
 */
import { Role, TopicType, UserType } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import {
  ModuleModel,
  SubjectModel,
  TopicModel,
} from "../src/models/curriculum.model.js";
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
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function makeCollege(slug: string, createdBy: string): Promise<string> {
  const dto = await colleges.createCollege({ name: slug, slug }, createdBy);
  return dto.id;
}

/** A college with a college_admin, the `courses` feature on. */
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
async function seedCourse(): Promise<{
  subjectId: string;
  slug: string;
  topicId: string;
}> {
  courseSeq += 1;
  const slug = `course-${courseSeq}`;
  const subject = await SubjectModel.create({
    name: `Course ${courseSeq}`,
    slug,
    isVisible: true,
    price: 0,
    discountPrice: 0,
  });
  const mod = await ModuleModel.create({
    subject: subject._id,
    name: "Module 1",
    order: 1,
  });
  const topic = await TopicModel.create({
    module: mod._id,
    name: "Topic 1",
    topicType: TopicType.TEXT,
    order: 1,
    isVisible: true,
    content: "hello",
  });
  return {
    subjectId: subject._id.toString(),
    slug,
    topicId: topic._id.toString(),
  };
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

const courses = (slug: string) => `/api/c/${slug}/courses`;

describe("college courses — assign / revoke / list", () => {
  it("assigns (idempotent), counts, lists, and revokes", async () => {
    const { collegeId, adminToken } = await setupCollege("cc-assign");
    const { subjectId } = await seedCourse();
    await colleges.grantCourses(collegeId, [subjectId]);

    const dept = await createUnit("cc-assign", adminToken, {
      type: "department",
      name: "CSE",
    });
    const s1 = await addStudent("cc-assign", adminToken, "s1@cc.edu", "R1", dept);
    const s2 = await addStudent("cc-assign", adminToken, "s2@cc.edu", "R2", dept);

    const assign = await request(app)
      .post(`${courses("cc-assign")}/${subjectId}/assign`)
      .set(auth(adminToken))
      .send({ studentIds: [s1, s2] });
    expect(assign.status).toBe(200);
    expect(assign.body).toMatchObject({ assigned: 2, alreadyAssigned: 0 });

    // Idempotent re-assign.
    const again = await request(app)
      .post(`${courses("cc-assign")}/${subjectId}/assign`)
      .set(auth(adminToken))
      .send({ studentIds: [s1, s2] });
    expect(again.body).toMatchObject({ assigned: 0, alreadyAssigned: 2 });

    // Catalog count + assigned list.
    const catalog = await request(app)
      .get(`${courses("cc-assign")}/catalog`)
      .set(auth(adminToken));
    expect(catalog.status).toBe(200);
    expect(catalog.body.items[0].assignedCount).toBe(2);

    const assigned = await request(app)
      .get(`${courses("cc-assign")}/${subjectId}/students`)
      .set(auth(adminToken));
    expect(assigned.body.items).toHaveLength(2);

    // Revoke one.
    const revoke = await request(app)
      .post(`${courses("cc-assign")}/${subjectId}/revoke`)
      .set(auth(adminToken))
      .send({ studentIds: [s1] });
    expect(revoke.body).toMatchObject({ revoked: 1 });

    const catalog2 = await request(app)
      .get(`${courses("cc-assign")}/catalog`)
      .set(auth(adminToken));
    expect(catalog2.body.items[0].assignedCount).toBe(1);
  });

  it("denies assigning a course NOT granted to the college (403)", async () => {
    const { adminToken } = await setupCollege("cc-notgranted");
    const { subjectId } = await seedCourse(); // seeded but NOT granted
    const dept = await createUnit("cc-notgranted", adminToken, {
      type: "department",
      name: "CSE",
    });
    const s1 = await addStudent(
      "cc-notgranted",
      adminToken,
      "n@cc.edu",
      "R1",
      dept,
    );
    const res = await request(app)
      .post(`${courses("cc-notgranted")}/${subjectId}/assign`)
      .set(auth(adminToken))
      .send({ studentIds: [s1] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("COURSE_NOT_GRANTED");
  });

  it("403s when the `courses` feature is off", async () => {
    // A college WITHOUT the courses feature.
    const platform = await makeUser({ role: Role.SUPER_ADMIN });
    const collegeId = await makeCollege("cc-nofeat", platform.userId);
    const admin = await makeUser({
      role: Role.COLLEGE_ADMIN,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(collegeId),
    });
    const res = await request(app)
      .get(`${courses("cc-nofeat")}/catalog`)
      .set(auth(admin.token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FEATURE_NOT_ENABLED");
  });

  it("denies cross-tenant course management", async () => {
    const colA = await setupCollege("cc-xa");
    await setupCollege("cc-xb");
    const { subjectId } = await seedCourse();
    const res = await request(app)
      .get(`${courses("cc-xb")}/catalog`)
      .set(auth(colA.adminToken));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CROSS_TENANT_DENIED");
    void subjectId;
  });

  it("denies faculty assigning to an out-of-scope student", async () => {
    const { collegeId, adminToken } = await setupCollege("cc-scope");
    const { subjectId } = await seedCourse();
    await colleges.grantCourses(collegeId, [subjectId]);

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
    const inB = await addStudent(
      "cc-scope",
      adminToken,
      "inb@cc.edu",
      "B1",
      secB,
    );

    // Faculty scoped to section A only.
    const faculty = await makeUser({
      role: Role.FACULTY,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(collegeId),
    });
    await UserModel.updateOne(
      { _id: faculty.userId },
      { $set: { facultyScope: { orgUnits: [new Types.ObjectId(secA)] } } },
    );

    const res = await request(app)
      .post(`${courses("cc-scope")}/${subjectId}/assign`)
      .set(auth(faculty.token))
      .send({ studentIds: [inB] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ORG_UNIT_OUT_OF_SCOPE");
  });
});

describe("college student access — reuses the existing player", () => {
  it("can access an ASSIGNED course but not an unassigned one, and cannot self-enroll", async () => {
    const { collegeId, adminToken } = await setupCollege("cc-access");
    const assignedCourse = await seedCourse();
    const otherCourse = await seedCourse();
    await colleges.grantCourses(collegeId, [
      assignedCourse.subjectId,
      otherCourse.subjectId,
    ]);

    const dept = await createUnit("cc-access", adminToken, {
      type: "department",
      name: "CSE",
    });
    const studentId = await addStudent(
      "cc-access",
      adminToken,
      "learner@cc.edu",
      "L1",
      dept,
    );

    // Assign only the first course.
    await request(app)
      .post(`${courses("cc-access")}/${assignedCourse.subjectId}/assign`)
      .set(auth(adminToken))
      .send({ studentIds: [studentId] });

    // Clear the forced-change flag so the student can reach the player, then log
    // in with the shared temp password.
    await UserModel.updateOne(
      { _id: studentId },
      { $set: { forcePasswordChange: false } },
    );
    const login = await request(app)
      .post("/api/auth/login")
      .send({ identifier: "learner@cc.edu", password: TEMP_PW });
    expect(login.status).toBe(200);
    const studentToken = login.body.accessToken as string;

    // Assigned course → the EXISTING player grants access.
    const ok = await request(app)
      .get(
        `/api/subjects/${assignedCourse.slug}/topics/${assignedCourse.topicId}`,
      )
      .set(auth(studentToken));
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe("Topic 1");

    // Granted-but-unassigned course → no enrollment → denied.
    const denied = await request(app)
      .get(`/api/subjects/${otherCourse.slug}/topics/${otherCourse.topicId}`)
      .set(auth(studentToken));
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("NOT_ENROLLED");

    // A college student can never self-enroll from the public catalog.
    const selfEnroll = await request(app)
      .post(`/api/subjects/${otherCourse.slug}/enroll`)
      .set(auth(studentToken));
    expect(selfEnroll.status).toBe(403);
    expect(selfEnroll.body.error.code).toBe("FORBIDDEN");
  });

  it("individual (B2C) self-enroll is unchanged", async () => {
    const free = await seedCourse(); // price 0 → free
    const individual = await makeUser(); // role student, userType individual
    const res = await request(app)
      .post(`/api/subjects/${free.slug}/enroll`)
      .set(auth(individual.token));
    expect([200, 201]).toContain(res.status);
    expect(["ENROLLED", "ALREADY_ENROLLED"]).toContain(res.body.result);
  });
});
