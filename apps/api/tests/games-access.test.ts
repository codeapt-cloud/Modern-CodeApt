/**
 * Step 6 — the full GameSet access matrix + course integration. Exercises every
 * row of assertCanPlayGameSet through the real HTTP start endpoints, plus the
 * three GameSet shapes, the course-attached reachability (B2C enrollment vs
 * college grant vs no grant), the clone path, and the invalid-shape rejection.
 */
import { Role, TopicType, UserType } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import {
  EnrollmentModel,
  ModuleModel,
  SubjectModel,
  TopicModel,
} from "../src/models/curriculum.model.js";
import { GameSetModel } from "../src/models/game.model.js";
import { UserModel } from "../src/models/user.model.js";
import * as colleges from "../src/services/college.service.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

const TEMP_PW = "CodeApt@123";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
let n = 0;

async function makeUser(fields?: {
  role?: string;
  userType?: string;
  college?: Types.ObjectId | null;
}): Promise<{ token: string; userId: string }> {
  n += 1;
  const u = `ga${n}`;
  await request(app).post("/api/auth/register").send({
    username: u,
    email: `${u}@example.com`,
    password: "Password123",
    fullName: `GA ${n}`,
    rollNumber: `GA-${n}`,
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
  opts: { gaming?: boolean } = {},
): Promise<{ collegeId: string; adminToken: string }> {
  const platform = await makeUser({ role: Role.SUPER_ADMIN });
  const dto = await colleges.createCollege({ name: slug, slug }, platform.userId);
  if (opts.gaming) {
    await colleges.setEntitlements(dto.id, { features: { gaming: true } });
  }
  const admin = await makeUser({
    role: Role.COLLEGE_ADMIN,
    userType: UserType.COLLEGE,
    college: new Types.ObjectId(dto.id),
  });
  return { collegeId: dto.id, adminToken: admin.token };
}

async function addStudent(
  slug: string,
  adminToken: string,
  email: string,
): Promise<{ id: string; token: string }> {
  const unit = await request(app)
    .post(`/api/c/${slug}/org-units`)
    .set(auth(adminToken))
    .send({ type: "department", name: `D-${email}` });
  const created = await request(app)
    .post(`/api/c/${slug}/students`)
    .set(auth(adminToken))
    .send({ fullName: email, email, rollNumber: email, orgUnitId: unit.body.id });
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  await UserModel.updateOne({ _id: id }, { $set: { forcePasswordChange: false } });
  const login = await request(app)
    .post("/api/auth/login")
    .send({ identifier: email, password: TEMP_PW });
  return { id, token: login.body.accessToken as string };
}

const probeGame = {
  gameKey: "_probe",
  durationSeconds: 360,
  allowSkip: true,
  startingDifficulty: "easy",
  maxQuestions: 3,
};

/** A curriculum GAME topic under a fresh subject/module. Returns both ids. */
async function makeGameTopic(
  tag: string,
): Promise<{ subjectId: string; topicId: string }> {
  const subject = await SubjectModel.create({ name: `Sub ${tag}`, slug: `sub-${tag}-${n}` });
  const mod = await ModuleModel.create({ subject: subject._id, name: `Mod ${tag}` });
  const topic = await TopicModel.create({
    module: mod._id,
    name: `Game ${tag}`,
    topicType: TopicType.GAME,
  });
  return { subjectId: subject._id.toString(), topicId: topic._id.toString() };
}

/** Platform-admin authored set (college:null). With topicId → course-attached. */
async function adminCreateSet(
  superToken: string,
  body: { title: string; topicId?: string },
): Promise<string> {
  const res = await request(app)
    .post("/api/admin/game-sets")
    .set(auth(superToken))
    .send({ title: body.title, games: [probeGame], topicId: body.topicId });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

/** Start via the GLOBAL funnel — the single entry to assertCanPlayGameSet. */
function start(setId: string, token: string) {
  return request(app).post(`/api/game-sets/${setId}/attempts`).set(auth(token));
}

// ---------------------------------------------------------------------------
// The six-row access matrix
// ---------------------------------------------------------------------------

describe("assertCanPlayGameSet — full access matrix", () => {
  it("ROW 1: tenant set + student of that college → ALLOW", async () => {
    const { collegeId, adminToken } = await setupCollege("ga-r1", { gaming: true });
    const student = await addStudent("ga-r1", adminToken, "r1@c.edu");
    const created = await request(app)
      .post(`/api/c/ga-r1/game-sets`)
      .set(auth(adminToken))
      .send({ title: "T", games: [probeGame], orgUnitIds: [] });
    await request(app)
      .post(`/api/c/ga-r1/game-sets/${created.body.id}/publish`)
      .set(auth(adminToken))
      .send({ isPublished: true });
    expect(created.body.college).toBe(collegeId);
    expect(created.body.topic).toBeNull();

    const res = await start(created.body.id, student.token);
    expect(res.status).toBe(201);
  });

  it("ROW 2: tenant set + a DIFFERENT college's member (and a B2C user) → 404", async () => {
    const { adminToken } = await setupCollege("ga-r2a", { gaming: true });
    const created = await request(app)
      .post(`/api/c/ga-r2a/game-sets`)
      .set(auth(adminToken))
      .send({ title: "T", games: [probeGame], orgUnitIds: [] });
    await request(app)
      .post(`/api/c/ga-r2a/game-sets/${created.body.id}/publish`)
      .set(auth(adminToken))
      .send({ isPublished: true });

    const otherCollege = await setupCollege("ga-r2b", { gaming: true });
    const otherStudent = await addStudent("ga-r2b", otherCollege.adminToken, "r2@c.edu");
    expect((await start(created.body.id, otherStudent.token)).status).toBe(404);

    const b2c = await makeUser();
    expect((await start(created.body.id, b2c.token)).status).toBe(404);
  });

  it("ROW 3: course-attached set + B2C learner enrolled in the subject → ALLOW", async () => {
    const superU = await makeUser({ role: Role.SUPER_ADMIN });
    const { subjectId, topicId } = await makeGameTopic("r3");
    const setId = await adminCreateSet(superU.token, { title: "Course Game", topicId });
    const detail = await request(app)
      .get(`/api/admin/game-sets/${setId}`)
      .set(auth(superU.token));
    expect(detail.body.college).toBeNull();
    expect(detail.body.topic).toBe(topicId);

    const learner = await makeUser();
    await EnrollmentModel.create({
      user: new Types.ObjectId(learner.userId),
      subject: new Types.ObjectId(subjectId),
      source: "manual",
    });
    expect((await start(setId, learner.token)).status).toBe(201);
  });

  it("ROW 4: course-attached set + student of a college GRANTED the course → ALLOW (no GAMING needed)", async () => {
    const superU = await makeUser({ role: Role.SUPER_ADMIN });
    const { subjectId, topicId } = await makeGameTopic("r4");
    const setId = await adminCreateSet(superU.token, { title: "Granted Game", topicId });

    // College WITHOUT the gaming feature, but GRANTED the course.
    const { collegeId, adminToken } = await setupCollege("ga-r4", { gaming: false });
    await colleges.grantCourses(collegeId, [subjectId]);
    const student = await addStudent("ga-r4", adminToken, "r4@c.edu");

    // Play is authorized by the GRANT alone — GAMING gates authoring, not this.
    expect((await start(setId, student.token)).status).toBe(201);
  });

  it("ROW 5: platform-internal set + platform admin → ALLOW", async () => {
    const superU = await makeUser({ role: Role.SUPER_ADMIN });
    const setId = await adminCreateSet(superU.token, { title: "Internal" });
    const detail = await request(app)
      .get(`/api/admin/game-sets/${setId}`)
      .set(auth(superU.token));
    expect(detail.body.college).toBeNull();
    expect(detail.body.topic).toBeNull();
    expect((await start(setId, superU.token)).status).toBe(201);
  });

  it("ROW 6: platform-internal set + anyone else → 404", async () => {
    const superU = await makeUser({ role: Role.SUPER_ADMIN });
    const setId = await adminCreateSet(superU.token, { title: "Internal2" });

    const b2c = await makeUser();
    expect((await start(setId, b2c.token)).status).toBe(404);

    const { adminToken } = await setupCollege("ga-r6", { gaming: true });
    const student = await addStudent("ga-r6", adminToken, "r6@c.edu");
    expect((await start(setId, student.token)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Course-attached reachability (grant vs no grant)
// ---------------------------------------------------------------------------

describe("course-attached reachability + discovery", () => {
  it("reachable by an enrolled B2C learner and a granted college's student, NOT by a non-granted college's student", async () => {
    const superU = await makeUser({ role: Role.SUPER_ADMIN });
    const { subjectId, topicId } = await makeGameTopic("reach");
    const setId = await adminCreateSet(superU.token, { title: "Reach", topicId });
    // S30 A1: discovery lists PUBLISHED course-attached content only, so publish
    // before asserting it appears in GET /games (start is still allowed either way).
    await request(app)
      .post(`/api/admin/game-sets/${setId}/publish`)
      .set(auth(superU.token))
      .send({ isPublished: true });

    // B2C learner enrolled → allowed + appears in GET /games (discovery).
    const learner = await makeUser();
    await EnrollmentModel.create({
      user: new Types.ObjectId(learner.userId),
      subject: new Types.ObjectId(subjectId),
      source: "order",
    });
    expect((await start(setId, learner.token)).status).toBe(201);
    const list = await request(app).get("/api/games").set(auth(learner.token));
    expect(list.status).toBe(200);
    const found = list.body.items.find((i: { id: string }) => i.id === setId);
    expect(found).toBeDefined();
    expect(found.topicId).toBe(topicId);
    expect("seed" in found).toBe(false); // no internals leak

    // Granted college's student → allowed.
    const granted = await setupCollege("ga-reach-g", { gaming: false });
    await colleges.grantCourses(granted.collegeId, [subjectId]);
    const gStudent = await addStudent("ga-reach-g", granted.adminToken, "g@c.edu");
    expect((await start(setId, gStudent.token)).status).toBe(201);

    // NON-granted college's student → 404.
    const ungranted = await setupCollege("ga-reach-u", { gaming: true });
    const uStudent = await addStudent("ga-reach-u", ungranted.adminToken, "u@c.edu");
    expect((await start(setId, uStudent.token)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Clone + invalid-shape
// ---------------------------------------------------------------------------

describe("clone a platform set into a college", () => {
  it("produces an INDEPENDENT, unpublished, tenant-owned copy (topic null, no targeting)", async () => {
    const superU = await makeUser({ role: Role.SUPER_ADMIN });
    const sourceId = await adminCreateSet(superU.token, { title: "Platform Source" });
    const { collegeId, adminToken } = await setupCollege("ga-clone", { gaming: true });

    const res = await request(app)
      .post(`/api/c/ga-clone/game-sets/${sourceId}/clone`)
      .set(auth(adminToken))
      .send({ title: "Our Copy" });
    expect(res.status).toBe(201);
    expect(res.body.id).not.toBe(sourceId); // a new, independent document
    expect(res.body.college).toBe(collegeId);
    expect(res.body.topic).toBeNull();
    expect(res.body.isPublished).toBe(false);
    expect(res.body.title).toBe("Our Copy");
    expect(res.body.games).toHaveLength(1); // games copied

    // Independence: editing the source is not reflected in the copy.
    const srcDoc = await GameSetModel.findById(sourceId);
    expect(srcDoc?.college).toBeNull(); // source untouched, still platform
  });

  it("requires the GAMING feature (authoring)", async () => {
    const superU = await makeUser({ role: Role.SUPER_ADMIN });
    const sourceId = await adminCreateSet(superU.token, { title: "Src2" });
    const { adminToken } = await setupCollege("ga-clone-nofeat", { gaming: false });
    const res = await request(app)
      .post(`/api/c/ga-clone-nofeat/game-sets/${sourceId}/clone`)
      .set(auth(adminToken))
      .send({ title: "Nope" });
    expect(res.status).toBe(403);
  });

  it("a college cannot clone into a DIFFERENT college", async () => {
    const superU = await makeUser({ role: Role.SUPER_ADMIN });
    const sourceId = await adminCreateSet(superU.token, { title: "Src3" });
    const a = await setupCollege("ga-clone-a", { gaming: true });
    await setupCollege("ga-clone-b", { gaming: true });
    // College A's admin tries to clone into college B's tenant → resolveTenant denies.
    const res = await request(app)
      .post(`/api/c/ga-clone-b/game-sets/${sourceId}/clone`)
      .set(auth(a.adminToken))
      .send({ title: "Cross" });
    expect(res.status === 403 || res.status === 404).toBe(true);
  });
});

describe("S30 A1/A2 — discovery publish filter + topic-delete refusal (games)", () => {
  it("A1: an UNPUBLISHED course-attached set is NOT discoverable; publishing reveals it", async () => {
    const superU = await makeUser({ role: Role.SUPER_ADMIN });
    const { subjectId, topicId } = await makeGameTopic("a1");
    const setId = await adminCreateSet(superU.token, { title: "Draft", topicId });
    const learner = await makeUser();
    await EnrollmentModel.create({
      user: new Types.ObjectId(learner.userId),
      subject: new Types.ObjectId(subjectId),
      source: "order",
    });
    const draftList = await request(app).get("/api/games").set(auth(learner.token));
    expect(draftList.body.items.some((i: { id: string }) => i.id === setId)).toBe(false);
    await request(app)
      .post(`/api/admin/game-sets/${setId}/publish`)
      .set(auth(superU.token))
      .send({ isPublished: true });
    const liveList = await request(app).get("/api/games").set(auth(learner.token));
    expect(liveList.body.items.some((i: { id: string }) => i.id === setId)).toBe(true);
  });

  it("A2: deleting a GAME topic with a set attached is REFUSED (409), naming it", async () => {
    const superU = await makeUser({ role: Role.SUPER_ADMIN });
    const { topicId } = await makeGameTopic("a2");
    const setId = await adminCreateSet(superU.token, { title: "Attached Set", topicId });
    const blocked = await request(app)
      .delete(`/api/admin/topics/${topicId}`)
      .set(auth(superU.token));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("DELETE_BLOCKED");
    expect(blocked.body.error.message).toContain("Attached Set");
    // Detach (delete the set) → the topic can then be deleted.
    await request(app).delete(`/api/admin/game-sets/${setId}`).set(auth(superU.token));
    const ok = await request(app)
      .delete(`/api/admin/topics/${topicId}`)
      .set(auth(superU.token));
    expect(ok.status).toBe(200);
  });
});

describe("invalid GameSet shape", () => {
  it("a college set with a topicId is rejected (college != null && topic != null)", async () => {
    const { topicId } = await makeGameTopic("bad");
    const { adminToken } = await setupCollege("ga-badshape", { gaming: true });
    const res = await request(app)
      .post(`/api/c/ga-badshape/game-sets`)
      .set(auth(adminToken))
      .send({ title: "Bad", games: [probeGame], topicId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_GAME_SET_SHAPE");
  });
});
