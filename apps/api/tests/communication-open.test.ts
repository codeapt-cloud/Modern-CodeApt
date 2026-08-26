/**
 * Step 29 — OPEN speaking + communication to courses and B2C (server half).
 * Exercises, through the REAL HTTP surface:
 *  - the two new attach mechanics (SPEAKING / COMMUNICATION topics), GAME-pattern
 *    validation (wrong type / already attached / the college+topic combination);
 *  - platform authoring (college:null) CRUD + publish, with composite parts
 *    resolving against college:null artifacts (and rejecting a college artifact);
 *  - the full access matrix for BOTH, all three shapes — including a college
 *    student reaching GRANTED course content WITHOUT the COMMUNICATION feature;
 *  - enrollment-based discovery (GET /speaking, GET /communication);
 *  - a B2C learner taking a course-attached speaking assessment END TO END via
 *    the slug-free engine.
 */
import { Role, TopicType, UserType } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

// The speech pipeline is async (worker); stub the producer so submit resolves.
vi.mock("../src/lib/execution-queue.js", () => ({
  enqueueSpeechJob: vi.fn(async () => undefined),
  closeQueues: vi.fn(async () => undefined),
  knownQueues: [],
}));

import { createApp } from "../src/app.js";
import {
  ExamModel,
  ExamQuestionModel,
} from "../src/models/assessment.model.js";
import {
  EnrollmentModel,
  ModuleModel,
  SubjectModel,
  TopicModel,
} from "../src/models/curriculum.model.js";
import { EssayTopicModel } from "../src/models/essay.model.js";
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
  const u = `co${n}`;
  await request(app).post("/api/auth/register").send({
    username: u,
    email: `${u}@example.com`,
    password: "Password123",
    fullName: `CO ${n}`,
    rollNumber: `CO-${n}`,
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

async function superToken(): Promise<string> {
  return (await makeUser({ role: Role.SUPER_ADMIN })).token;
}

async function setupCollege(
  slug: string,
  opts: { communication?: boolean } = {},
): Promise<{ collegeId: string; adminToken: string }> {
  const platform = await makeUser({ role: Role.SUPER_ADMIN });
  const dto = await colleges.createCollege({ name: slug, slug }, platform.userId);
  if (opts.communication) {
    await colleges.setEntitlements(dto.id, { features: { communication: true } });
    await colleges.setEntitlements(dto.id, {
      subCapabilities: { "communication.speaking": true, "communication.authoring": true },
    });
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

/** A curriculum topic of the given type under a fresh subject/module. */
async function makeTopic(
  topicType: string,
  tag: string,
): Promise<{ subjectId: string; topicId: string }> {
  const subject = await SubjectModel.create({ name: `Sub ${tag}`, slug: `sub-${tag}-${n}` });
  const mod = await ModuleModel.create({ subject: subject._id, name: `Mod ${tag}` });
  const topic = await TopicModel.create({
    module: mod._id,
    name: `${topicType} ${tag}`,
    topicType,
  });
  return { subjectId: subject._id.toString(), topicId: topic._id.toString() };
}

// A read_aloud item needs no audio (its reference shows on screen) — so a paper
// of one read_aloud is publishable without any TTS.
const READ_ALOUD = {
  itemType: "read_aloud",
  referenceText: "The river winds past the old stone bridge.",
  promptText: "Read the sentence aloud.",
  responseWindowSeconds: 30,
};

/** Platform speaking create (college:null). With topicId → course-attached. */
async function adminCreateSpeaking(
  token: string,
  body: { title: string; topicId?: string; items?: unknown[] },
): Promise<string> {
  const res = await request(app)
    .post("/api/admin/speaking")
    .set(auth(token))
    .send({
      title: body.title,
      items: body.items ?? [READ_ALOUD],
      maxAttempts: 0,
      topicId: body.topicId,
    });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function publishSpeaking(token: string, id: string): Promise<void> {
  const res = await request(app)
    .post(`/api/admin/speaking/${id}/publish`)
    .set(auth(token))
    .send({ isPublished: true });
  expect(res.status).toBe(200);
}

const startSpeaking = (id: string, token: string) =>
  request(app).post(`/api/speaking/${id}/attempts`).set(auth(token));

// ===========================================================================
// 1. Attach validation (GAME pattern) — SPEAKING + COMMUNICATION
// ===========================================================================

describe("course attach validation (S29)", () => {
  it("rejects attaching a speaking assessment to a non-SPEAKING topic", async () => {
    const su = await superToken();
    const { topicId } = await makeTopic(TopicType.GAME, "wrongtype");
    const res = await request(app)
      .post("/api/admin/speaking")
      .set(auth(su))
      .send({ title: "X", items: [READ_ALOUD], topicId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("TOPIC_NOT_SPEAKING");
  });

  it("rejects attaching a composite to a non-COMMUNICATION topic", async () => {
    const su = await superToken();
    const { topicId } = await makeTopic(TopicType.SPEAKING, "wrongtype2");
    const res = await request(app)
      .post("/api/admin/communication")
      .set(auth(su))
      .send({ title: "X", parts: [], topicId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("TOPIC_NOT_COMMUNICATION");
  });

  it("rejects a SECOND speaking assessment on the same topic (1:1)", async () => {
    const su = await superToken();
    const { topicId } = await makeTopic(TopicType.SPEAKING, "dup");
    await adminCreateSpeaking(su, { title: "First", topicId });
    const res = await request(app)
      .post("/api/admin/speaking")
      .set(auth(su))
      .send({ title: "Second", items: [READ_ALOUD], topicId });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("TOPIC_ALREADY_ATTACHED");
  });

  it("a college (tenant) speaking create IGNORES a topicId — the college+topic combination can't arise", async () => {
    const { adminToken } = await setupCollege("co-combo", { communication: true });
    const { topicId } = await makeTopic(TopicType.SPEAKING, "combo");
    const res = await request(app)
      .post("/api/c/co-combo/speaking")
      .set(auth(adminToken))
      .send({ title: "Tenant", items: [READ_ALOUD], topicId });
    expect(res.status).toBe(201);
    // Tenant set: topic is null despite the payload — structurally prevented.
    expect(res.body.topicId).toBeNull();
  });
});

// ===========================================================================
// 2. Platform authoring CRUD + publish (college:null), part resolution
// ===========================================================================

describe("platform authoring (college:null) — S29", () => {
  it("speaking: create → get → publish → appears in the platform list; requireAdmin only", async () => {
    const su = await superToken();
    const id = await adminCreateSpeaking(su, { title: "Platform Speaking" });
    const detail = await request(app).get(`/api/admin/speaking/${id}`).set(auth(su));
    expect(detail.status).toBe(200);
    expect(detail.body.topicId).toBeNull();
    await publishSpeaking(su, id);
    const list = await request(app).get("/api/admin/speaking").set(auth(su));
    expect(list.body.items.some((s: { id: string }) => s.id === id)).toBe(true);

    // A non-admin cannot author.
    const b2c = await makeUser();
    expect((await request(app).get("/api/admin/speaking").set(auth(b2c.token))).status).toBe(403);
  });

  it("communication: a platform composite resolves a college:null part and REJECTS a college artifact", async () => {
    const su = await superToken();
    // A platform speaking artifact (college:null, published) to reference.
    const speakingId = await adminCreateSpeaking(su, { title: "Platform Part" });
    await publishSpeaking(su, speakingId);

    const ok = await request(app)
      .post("/api/admin/communication")
      .set(auth(su))
      .send({
        title: "Platform Composite",
        parts: [{ partType: "speaking", ref: speakingId, label: "Speak", weight: 1 }],
      });
    expect(ok.status).toBe(201);
    expect(ok.body.parts[0].valid).toBe(true);
    // Publish succeeds (part exists + is published).
    const pub = await request(app)
      .post(`/api/admin/communication/${ok.body.id}/publish`)
      .set(auth(su))
      .send({ isPublished: true });
    expect(pub.status).toBe(200);
    expect(pub.body.isPublished).toBe(true);

    // A COLLEGE speaking artifact must NOT resolve on the platform surface.
    const { adminToken } = await setupCollege("co-plat-ref", { communication: true });
    const tenant = await request(app)
      .post("/api/c/co-plat-ref/speaking")
      .set(auth(adminToken))
      .send({ title: "Tenant Part", items: [READ_ALOUD] });
    const bad = await request(app)
      .post("/api/admin/communication")
      .set(auth(su))
      .send({
        title: "Bad Composite",
        parts: [{ partType: "speaking", ref: tenant.body.id, label: "X", weight: 1 }],
      });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_PART_REF");
  });
});

// ===========================================================================
// 2b. Per-type / per-scope part READINESS (S30 i.1)
// ===========================================================================

/** A platform (college:null) exam; `withQuestion` decides readiness. */
async function makePlatformExam(withQuestion: boolean): Promise<string> {
  const exam = await ExamModel.create({ college: null, title: `Exam ${n}` });
  if (withQuestion) {
    await ExamQuestionModel.create({
      section: new Types.ObjectId(),
      exam: exam._id,
      questionType: "MCQ_SINGLE",
      text: "Q1",
    });
  }
  return exam._id.toString();
}

/** A platform (college:null) essay topic; readiness = isActive. */
async function makePlatformEssay(isActive: boolean): Promise<string> {
  const t = await EssayTopicModel.create({
    college: null,
    title: `Essay ${n}`,
    isActive,
  });
  return t._id.toString();
}

describe("platform composite part readiness (S30 i.1)", () => {
  it("PUBLISHES a platform composite whose parts are a ready exam AND a ready essay AND a published speaking", async () => {
    const su = await superToken();
    const examId = await makePlatformExam(true); // has a question → ready
    const essayId = await makePlatformEssay(true); // isActive → ready
    const speakingId = await adminCreateSpeaking(su, { title: "Ready Speaking" });
    await publishSpeaking(su, speakingId);

    const create = await request(app)
      .post("/api/admin/communication")
      .set(auth(su))
      .send({
        title: "Full Composite",
        parts: [
          { partType: "exam", ref: examId, label: "Exam", weight: 1 },
          { partType: "essay", ref: essayId, label: "Email", weight: 1 },
          { partType: "speaking", ref: speakingId, label: "Speak", weight: 1 },
        ],
      });
    expect(create.status).toBe(201);
    // The author detail marks every part ready (refPublished).
    expect(create.body.parts.every((p: { refPublished: boolean }) => p.refPublished)).toBe(true);

    const pub = await request(app)
      .post(`/api/admin/communication/${create.body.id}/publish`)
      .set(auth(su))
      .send({ isPublished: true });
    expect(pub.status).toBe(200);
    expect(pub.body.isPublished).toBe(true);
  });

  it("REFUSES to publish when a part of each type is NOT ready", async () => {
    const su = await superToken();
    const attempt = async (partType: string, ref: string): Promise<number> => {
      const c = await request(app)
        .post("/api/admin/communication")
        .set(auth(su))
        .send({ title: `C ${partType}`, parts: [{ partType, ref, label: "P", weight: 1 }] });
      expect(c.status).toBe(201);
      const p = await request(app)
        .post(`/api/admin/communication/${c.body.id}/publish`)
        .set(auth(su))
        .send({ isPublished: true });
      return p.status;
    };

    // Exam with NO questions → not ready.
    expect(await attempt("exam", await makePlatformExam(false))).toBe(400);
    // Essay with isActive:false → not ready.
    expect(await attempt("essay", await makePlatformEssay(false))).toBe(400);
    // Speaking not published → not ready.
    const draftSpeaking = await adminCreateSpeaking(su, { title: "Draft Speak" });
    expect(await attempt("speaking", draftSpeaking)).toBe(400);
  });
});

// ===========================================================================
// 2c. Platform lifecycle end to end (S30 gap #2): create → attach → publish →
//     B2C sees → unpublish → disappears → delete
// ===========================================================================

describe("platform speaking lifecycle (S30)", () => {
  async function enrol(userId: string, subjectId: string): Promise<void> {
    await EnrollmentModel.create({
      user: new Types.ObjectId(userId),
      subject: new Types.ObjectId(subjectId),
      source: "order",
    });
  }
  const unpublish = (id: string, token: string) =>
    request(app)
      .post(`/api/admin/speaking/${id}/publish`)
      .set(auth(token))
      .send({ isPublished: false });
  const del = (id: string, token: string) =>
    request(app).delete(`/api/admin/speaking/${id}`).set(auth(token));
  const seen = async (id: string, token: string): Promise<boolean> => {
    const r = await request(app).get("/api/speaking").set(auth(token));
    return r.body.items.some((s: { id: string }) => s.id === id);
  };

  it("publish reveals to an enrolled B2C learner; unpublish hides; delete needs unpublish first", async () => {
    const su = await superToken();
    const { subjectId, topicId } = await makeTopic(TopicType.SPEAKING, "life");
    const id = await adminCreateSpeaking(su, { title: "Lifecycle", topicId });
    const learner = await makeUser();
    await enrol(learner.userId, subjectId);

    // Draft: not visible.
    expect(await seen(id, learner.token)).toBe(false);
    // Published: visible.
    await publishSpeaking(su, id);
    expect(await seen(id, learner.token)).toBe(true);
    // Delete while published → refused (must unpublish first).
    expect((await del(id, su)).status).toBe(409);
    // Unpublish → disappears from the learner's list.
    expect((await unpublish(id, su)).status).toBe(200);
    expect(await seen(id, learner.token)).toBe(false);
    // Now deletable.
    expect((await del(id, su)).status).toBe(204);
  });

  it("composite: publish reveals, unpublish hides, delete-while-published refused", async () => {
    const su = await superToken();
    const part = await adminCreateSpeaking(su, { title: "P" });
    await publishSpeaking(su, part);
    const { subjectId, topicId } = await makeTopic(TopicType.COMMUNICATION, "clife");
    const create = await request(app)
      .post("/api/admin/communication")
      .set(auth(su))
      .send({
        title: "Composite Lifecycle",
        parts: [{ partType: "speaking", ref: part, label: "S", weight: 1 }],
        topicId,
      });
    const id = create.body.id as string;
    const learner = await makeUser();
    await enrol(learner.userId, subjectId);
    const seenC = async (): Promise<boolean> => {
      const r = await request(app).get("/api/communication").set(auth(learner.token));
      return r.body.items.some((c: { id: string }) => c.id === id);
    };

    expect(await seenC()).toBe(false);
    await request(app)
      .post(`/api/admin/communication/${id}/publish`)
      .set(auth(su))
      .send({ isPublished: true })
      .expect(200);
    expect(await seenC()).toBe(true);
    // Delete while published → refused.
    expect((await request(app).delete(`/api/admin/communication/${id}`).set(auth(su))).status).toBe(409);
    // Unpublish → hidden → deletable.
    await request(app)
      .post(`/api/admin/communication/${id}/publish`)
      .set(auth(su))
      .send({ isPublished: false })
      .expect(200);
    expect(await seenC()).toBe(false);
    expect((await request(app).delete(`/api/admin/communication/${id}`).set(auth(su))).status).toBe(204);
  });
});

// ===========================================================================
// 3. Access matrix — SPEAKING, all three shapes (via the global start route)
// ===========================================================================

describe("speaking access matrix (S29) — all three shapes", () => {
  it("COURSE-ATTACHED: B2C learner enrolled in the subject → ALLOW", async () => {
    const su = await superToken();
    const { subjectId, topicId } = await makeTopic(TopicType.SPEAKING, "b2c");
    const id = await adminCreateSpeaking(su, { title: "Course Speaking", topicId });
    await publishSpeaking(su, id);

    const learner = await makeUser();
    await EnrollmentModel.create({
      user: new Types.ObjectId(learner.userId),
      subject: new Types.ObjectId(subjectId),
      source: "order",
    });
    expect((await startSpeaking(id, learner.token)).status).toBe(201);
  });

  it("COURSE-ATTACHED: student of a GRANTED college → ALLOW, WITHOUT the COMMUNICATION feature", async () => {
    const su = await superToken();
    const { subjectId, topicId } = await makeTopic(TopicType.SPEAKING, "grant");
    const id = await adminCreateSpeaking(su, { title: "Granted Speaking", topicId });
    await publishSpeaking(su, id);

    // College with NO communication feature, but GRANTED the course.
    const { collegeId, adminToken } = await setupCollege("co-grant", { communication: false });
    await colleges.grantCourses(collegeId, [subjectId]);
    const student = await addStudent("co-grant", adminToken, "grant@c.edu");

    // The grant IS the authorization — the feature gates authoring, not this.
    expect((await startSpeaking(id, student.token)).status).toBe(201);
  });

  it("COURSE-ATTACHED: a NON-granted, non-enrolled college student → 404", async () => {
    const su = await superToken();
    const { topicId } = await makeTopic(TopicType.SPEAKING, "nogrant");
    const id = await adminCreateSpeaking(su, { title: "Ungranted", topicId });
    await publishSpeaking(su, id);
    const { adminToken } = await setupCollege("co-nogrant", { communication: true });
    const student = await addStudent("co-nogrant", adminToken, "no@c.edu");
    expect((await startSpeaking(id, student.token)).status).toBe(404);
  });

  it("PLATFORM-INTERNAL: platform admin → ALLOW; anyone else → 404", async () => {
    const su = await superToken();
    const id = await adminCreateSpeaking(su, { title: "Internal Speaking" });
    await publishSpeaking(su, id);
    // The super admin owns platform-internal.
    const suUser = await makeUser({ role: Role.SUPER_ADMIN });
    expect((await startSpeaking(id, suUser.token)).status).toBe(201);
    const b2c = await makeUser();
    expect((await startSpeaking(id, b2c.token)).status).toBe(404);
  });

  it("TENANT (unchanged): a college student of the owning college → ALLOW via the college route", async () => {
    const { adminToken } = await setupCollege("co-tenant", { communication: true });
    const student = await addStudent("co-tenant", adminToken, "t@c.edu");
    const created = await request(app)
      .post("/api/c/co-tenant/speaking")
      .set(auth(adminToken))
      .send({ title: "Tenant Speaking", items: [READ_ALOUD], orgUnitIds: [] });
    await request(app)
      .post(`/api/c/co-tenant/speaking/${created.body.id}/publish`)
      .set(auth(adminToken))
      .send({ isPublished: true });
    const res = await request(app)
      .post(`/api/c/co-tenant/speaking/${created.body.id}/attempts`)
      .set(auth(student.token));
    expect(res.status).toBe(201);
  });
});

// ===========================================================================
// 4. Access matrix — COMMUNICATION composite (course-attached reachability)
// ===========================================================================

describe("communication composite access (S29)", () => {
  it("course-attached composite: enrolled B2C learner can view; a stranger 404s", async () => {
    const su = await superToken();
    const speakingId = await adminCreateSpeaking(su, { title: "CompPart" });
    await publishSpeaking(su, speakingId);
    const { subjectId, topicId } = await makeTopic(TopicType.COMMUNICATION, "comp");
    const create = await request(app)
      .post("/api/admin/communication")
      .set(auth(su))
      .send({
        title: "Course Composite",
        parts: [{ partType: "speaking", ref: speakingId, label: "Speak", weight: 1 }],
        topicId,
      });
    expect(create.status).toBe(201);
    const compId = create.body.id as string;
    await request(app)
      .post(`/api/admin/communication/${compId}/publish`)
      .set(auth(su))
      .send({ isPublished: true });

    const learner = await makeUser();
    await EnrollmentModel.create({
      user: new Types.ObjectId(learner.userId),
      subject: new Types.ObjectId(subjectId),
      source: "order",
    });
    const view = await request(app)
      .get(`/api/communication/${compId}/student`)
      .set(auth(learner.token));
    expect(view.status).toBe(200);

    const stranger = await makeUser();
    expect(
      (await request(app).get(`/api/communication/${compId}/student`).set(auth(stranger.token)))
        .status,
    ).toBe(404);
  });
});

// ===========================================================================
// 5. Discovery + 6. B2C engine end-to-end (speaking)
// ===========================================================================

describe("discovery + B2C engine end to end (S29)", () => {
  it("GET /speaking lists a course-attached assessment for an enrolled learner, who then TAKES it end to end", async () => {
    const su = await superToken();
    const { subjectId, topicId } = await makeTopic(TopicType.SPEAKING, "e2e");
    const id = await adminCreateSpeaking(su, { title: "E2E Speaking", topicId });
    await publishSpeaking(su, id);

    const learner = await makeUser();
    // Before enrollment: not discoverable.
    const before = await request(app).get("/api/speaking").set(auth(learner.token));
    expect(before.body.items.some((s: { id: string }) => s.id === id)).toBe(false);

    await EnrollmentModel.create({
      user: new Types.ObjectId(learner.userId),
      subject: new Types.ObjectId(subjectId),
      source: "order",
    });
    // After enrollment: discoverable, carrying topicId for the learn player.
    const list = await request(app).get("/api/speaking").set(auth(learner.token));
    const found = list.body.items.find((s: { id: string }) => s.id === id);
    expect(found).toBeDefined();
    expect(found.topicId).toBe(topicId);

    // START → CURRENT → SUBMIT → RESULT, all via the slug-free engine.
    const start = await startSpeaking(id, learner.token);
    expect(start.status).toBe(201);
    const attemptId = start.body.attemptId as string;
    expect(start.body.item.itemType).toBe("read_aloud");

    const current = await request(app)
      .get(`/api/speaking/attempts/${attemptId}/current`)
      .set(auth(learner.token));
    expect(current.status).toBe(200);

    const submit = await request(app)
      .post(`/api/speaking/attempts/${attemptId}/items/0`)
      .set(auth(learner.token))
      .send({ audioUrl: "https://cdn/take.webm" });
    expect(submit.status).toBe(202);

    const result = await request(app)
      .get(`/api/speaking/attempts/${attemptId}/result`)
      .set(auth(learner.token));
    expect(result.status).toBe(200);

    // Attempt ownership: a different user cannot read this attempt.
    const intruder = await makeUser();
    expect(
      (await request(app).get(`/api/speaking/attempts/${attemptId}/result`).set(auth(intruder.token)))
        .status,
    ).toBe(403);
  });

  it("A1: an UNPUBLISHED course-attached speaking assessment is NOT discoverable; publishing reveals it", async () => {
    const su = await superToken();
    const { subjectId, topicId } = await makeTopic(TopicType.SPEAKING, "a1s");
    const id = await adminCreateSpeaking(su, { title: "Draft Speaking", topicId });
    const learner = await makeUser();
    await EnrollmentModel.create({
      user: new Types.ObjectId(learner.userId),
      subject: new Types.ObjectId(subjectId),
      source: "order",
    });
    const draft = await request(app).get("/api/speaking").set(auth(learner.token));
    expect(draft.body.items.some((s: { id: string }) => s.id === id)).toBe(false);
    await publishSpeaking(su, id);
    const live = await request(app).get("/api/speaking").set(auth(learner.token));
    expect(live.body.items.some((s: { id: string }) => s.id === id)).toBe(true);
  });

  it("A1: an UNPUBLISHED course-attached composite is NOT discoverable", async () => {
    const su = await superToken();
    const speakingId = await adminCreateSpeaking(su, { title: "P" });
    await publishSpeaking(su, speakingId);
    const { subjectId, topicId } = await makeTopic(TopicType.COMMUNICATION, "a1c");
    const create = await request(app)
      .post("/api/admin/communication")
      .set(auth(su))
      .send({
        title: "Draft Composite",
        parts: [{ partType: "speaking", ref: speakingId, label: "S", weight: 1 }],
        topicId,
      });
    const learner = await makeUser();
    await EnrollmentModel.create({
      user: new Types.ObjectId(learner.userId),
      subject: new Types.ObjectId(subjectId),
      source: "order",
    });
    const draft = await request(app).get("/api/communication").set(auth(learner.token));
    expect(draft.body.items.some((c: { id: string }) => c.id === create.body.id)).toBe(false);
  });

  it("A2: deleting a SPEAKING topic with an assessment attached is REFUSED (409), naming it", async () => {
    const su = await superToken();
    const { topicId } = await makeTopic(TopicType.SPEAKING, "a2s");
    const id = await adminCreateSpeaking(su, { title: "Attached Speaking", topicId });
    const blocked = await request(app).delete(`/api/admin/topics/${topicId}`).set(auth(su));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("DELETE_BLOCKED");
    expect(blocked.body.error.message).toContain("Attached Speaking");
    await request(app).delete(`/api/admin/speaking/${id}`).set(auth(su));
    expect((await request(app).delete(`/api/admin/topics/${topicId}`).set(auth(su))).status).toBe(200);
  });

  it("GET /communication lists a course-attached composite for an enrolled learner", async () => {
    const su = await superToken();
    const speakingId = await adminCreateSpeaking(su, { title: "DiscPart" });
    await publishSpeaking(su, speakingId);
    const { subjectId, topicId } = await makeTopic(TopicType.COMMUNICATION, "disc");
    const create = await request(app)
      .post("/api/admin/communication")
      .set(auth(su))
      .send({
        title: "Disc Composite",
        parts: [{ partType: "speaking", ref: speakingId, label: "Speak", weight: 1 }],
        topicId,
      });
    await request(app)
      .post(`/api/admin/communication/${create.body.id}/publish`)
      .set(auth(su))
      .send({ isPublished: true });

    const learner = await makeUser();
    await EnrollmentModel.create({
      user: new Types.ObjectId(learner.userId),
      subject: new Types.ObjectId(subjectId),
      source: "order",
    });
    const list = await request(app).get("/api/communication").set(auth(learner.token));
    const found = list.body.items.find((c: { id: string }) => c.id === create.body.id);
    expect(found).toBeDefined();
    expect(found.topicId).toBe(topicId);
  });
});
