/**
 * Curriculum / LMS integration tests (supertest + in-memory Mongo).
 */
import { CurriculumErrorCode, TopicType } from "@codeapt/shared";
import type { Express } from "express";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import {
  ChoiceModel,
  ModuleModel,
  ProgramModel,
  QuestionModel,
  SubjectModel,
  TopicModel,
} from "../src/models/curriculum.model.js";

let app: Express;

beforeAll(() => {
  app = createApp();
});

let userCounter = 0;
async function registerAndLogin(): Promise<string> {
  userCounter += 1;
  const u = `learner${userCounter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: "Learner One",
      rollNumber: `ROLL-${userCounter}`,
      collegeName: "Acme",
      phoneNumber: "9999999999",
      state: "KA",
    });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ identifier: u, password: "Password123" });
  return res.body.accessToken as string;
}

async function makeProgram() {
  // Idempotent: multiple subjects in one test share the same program.
  return ProgramModel.findOneAndUpdate(
    { slug: "foundations" },
    { $set: { name: "Foundations", isVisible: true } },
    { upsert: true, new: true },
  );
}

interface SubjectOpts {
  slug?: string;
  price?: number;
  discountPrice?: number;
  isPopular?: boolean;
  isVisible?: boolean;
}

/** Create a subject with one module and float-ordered topics (1, 3, 2.5). */
async function makeSubject(opts: SubjectOpts = {}) {
  const program = await makeProgram();
  const subject = await SubjectModel.create({
    program: program._id,
    name: "Aptitude",
    slug: opts.slug ?? "aptitude",
    description: "desc",
    price: opts.price ?? 0,
    discountPrice: opts.discountPrice ?? 0,
    isPopular: opts.isPopular ?? false,
    isVisible: opts.isVisible ?? true,
  });
  const module = await ModuleModel.create({
    subject: subject._id,
    name: "Module 1",
    order: 1,
  });
  const t1 = await TopicModel.create({
    module: module._id,
    name: "Intro",
    topicType: TopicType.TEXT,
    order: 1,
    content: "hello",
    isVisible: true,
  });
  const tLast = await TopicModel.create({
    module: module._id,
    name: "Last",
    topicType: TopicType.TEXT,
    order: 3,
    content: "bye",
    isVisible: true,
  });
  const tMid = await TopicModel.create({
    module: module._id,
    name: "Middle (float order)",
    topicType: TopicType.TEXT,
    order: 2.5,
    content: "mid",
    isVisible: true,
  });
  return { subject, module, topics: { t1, tMid, tLast } };
}

/** Create a quiz topic with 2 questions (one multi-answer) + choices. */
async function makeQuizTopic(subjectId: unknown, moduleId: unknown) {
  const topic = await TopicModel.create({
    module: moduleId,
    name: "Quiz",
    topicType: TopicType.QUIZ,
    order: 5,
    isVisible: true,
  });
  const q1 = await QuestionModel.create({
    subject: subjectId,
    topic: topic._id,
    text: "2 + 2 = ?",
    marks: 5,
  });
  const q1Choices = await ChoiceModel.insertMany([
    { question: q1._id, text: "3", isCorrect: false },
    { question: q1._id, text: "4", isCorrect: true },
  ]);
  const q2 = await QuestionModel.create({
    subject: subjectId,
    topic: topic._id,
    text: "Pick the primes",
    marks: 5,
  });
  const q2Choices = await ChoiceModel.insertMany([
    { question: q2._id, text: "2", isCorrect: true },
    { question: q2._id, text: "4", isCorrect: false },
    { question: q2._id, text: "3", isCorrect: true },
  ]);
  return { topic, q1, q1Choices, q2, q2Choices };
}

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("GET /api/catalog", () => {
  it("returns only visible subjects", async () => {
    await makeSubject({ slug: "visible-one", isVisible: true });
    await makeSubject({ slug: "hidden-one", isVisible: false });
    const res = await request(app).get("/api/catalog");
    expect(res.status).toBe(200);
    const slugs = res.body.items.map((i: { slug: string }) => i.slug);
    expect(slugs).toContain("visible-one");
    expect(slugs).not.toContain("hidden-one");
  });

  it("includes counts and marks isEnrolled for the signed-in user", async () => {
    const { subject } = await makeSubject({ slug: "enrolled-sub" });
    const token = await registerAndLogin();
    await request(app)
      .post(`/api/subjects/${subject.slug}/enroll`)
      .set(bearer(token));

    const res = await request(app).get("/api/catalog").set(bearer(token));
    const item = res.body.items.find(
      (i: { slug: string }) => i.slug === "enrolled-sub",
    );
    expect(item.isEnrolled).toBe(true);
    expect(item.moduleCount).toBe(1);
    expect(item.topicCount).toBe(3);

    // Anonymous request never marks enrolled.
    const anon = await request(app).get("/api/catalog");
    const anonItem = anon.body.items.find(
      (i: { slug: string }) => i.slug === "enrolled-sub",
    );
    expect(anonItem.isEnrolled).toBe(false);
  });
});

describe("GET /api/subjects/:slug", () => {
  it("returns the ordered module→topic tree (float order respected)", async () => {
    await makeSubject({ slug: "ordered" });
    const res = await request(app).get("/api/subjects/ordered");
    expect(res.status).toBe(200);
    const topicNames = res.body.modules[0].topics.map(
      (t: { name: string }) => t.name,
    );
    expect(topicNames).toEqual(["Intro", "Middle (float order)", "Last"]);
    // Not enrolled → topics locked.
    expect(
      res.body.modules[0].topics.every(
        (t: { isLocked: boolean }) => t.isLocked,
      ),
    ).toBe(true);
    expect(res.body.enrollment.isEnrolled).toBe(false);
  });

  it("reflects enrollment + progress when authed and enrolled", async () => {
    const { subject } = await makeSubject({ slug: "prog" });
    const token = await registerAndLogin();
    await request(app)
      .post(`/api/subjects/${subject.slug}/enroll`)
      .set(bearer(token));
    const res = await request(app).get("/api/subjects/prog").set(bearer(token));
    expect(res.body.enrollment.isEnrolled).toBe(true);
    expect(
      res.body.modules[0].topics.every(
        (t: { isLocked: boolean }) => t.isLocked,
      ),
    ).toBe(false);
    expect(res.body.progress.totalTopics).toBe(3);
    expect(res.body.progress.percentage).toBe(0);
  });

  it("404s for a missing subject", async () => {
    const res = await request(app).get("/api/subjects/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(CurriculumErrorCode.SUBJECT_NOT_FOUND);
  });
});

describe("enrollment", () => {
  it("free enroll is idempotent", async () => {
    await makeSubject({ slug: "free-course", price: 0 });
    const token = await registerAndLogin();
    const first = await request(app)
      .post("/api/subjects/free-course/enroll")
      .set(bearer(token));
    expect(first.status).toBe(201);
    expect(first.body.result).toBe("ENROLLED");

    const second = await request(app)
      .post("/api/subjects/free-course/enroll")
      .set(bearer(token));
    expect(second.status).toBe(200);
    expect(second.body.result).toBe("ALREADY_ENROLLED");

    const mine = await request(app)
      .get("/api/me/enrollments")
      .set(bearer(token));
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0].subject.slug).toBe("free-course");
  });

  it("paid enroll returns PAYMENT_REQUIRED", async () => {
    await makeSubject({
      slug: "paid-course",
      price: 129900,
      discountPrice: 99900,
    });
    const token = await registerAndLogin();
    const res = await request(app)
      .post("/api/subjects/paid-course/enroll")
      .set(bearer(token));
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe(CurriculumErrorCode.PAYMENT_REQUIRED);
    expect(res.body.error.details.pricePaise).toBe(99900);
  });

  it("requires auth to enroll", async () => {
    await makeSubject({ slug: "auth-course" });
    const res = await request(app).post("/api/subjects/auth-course/enroll");
    expect(res.status).toBe(401);
  });
});

describe("content + quiz guards and grading", () => {
  it("blocks topic content and quiz when not enrolled", async () => {
    const { subject, topics, module } = await makeSubject({ slug: "guarded" });
    const { topic: quiz } = await makeQuizTopic(subject._id, module._id);
    const token = await registerAndLogin();

    const content = await request(app)
      .get(`/api/subjects/guarded/topics/${topics.t1._id.toString()}`)
      .set(bearer(token));
    expect(content.status).toBe(403);
    expect(content.body.error.code).toBe(CurriculumErrorCode.NOT_ENROLLED);

    const quizRes = await request(app)
      .get(`/api/subjects/guarded/topics/${quiz._id.toString()}/quiz`)
      .set(bearer(token));
    expect(quizRes.status).toBe(403);
    expect(quizRes.body.error.code).toBe(CurriculumErrorCode.NOT_ENROLLED);
  });

  it("serves a quiz without leaking correct answers and grades server-side", async () => {
    const { subject, module } = await makeSubject({ slug: "quizzed" });
    const {
      topic: quiz,
      q1,
      q1Choices,
      q2,
      q2Choices,
    } = await makeQuizTopic(subject._id, module._id);
    const token = await registerAndLogin();
    await request(app).post("/api/subjects/quizzed/enroll").set(bearer(token));

    // GET quiz — no isCorrect anywhere.
    const quizGet = await request(app)
      .get(`/api/subjects/quizzed/topics/${quiz._id.toString()}/quiz`)
      .set(bearer(token));
    expect(quizGet.status).toBe(200);
    const raw = JSON.stringify(quizGet.body);
    expect(raw).not.toContain("isCorrect");
    expect(quizGet.body.questions).toHaveLength(2);

    // Submit all-correct answers.
    const correctAnswers = {
      answers: [
        {
          questionId: q1._id.toString(),
          choiceIds: q1Choices
            .filter((c) => c.isCorrect)
            .map((c) => c._id.toString()),
        },
        {
          questionId: q2._id.toString(),
          choiceIds: q2Choices
            .filter((c) => c.isCorrect)
            .map((c) => c._id.toString()),
        },
      ],
    };
    const graded = await request(app)
      .post(`/api/subjects/quizzed/topics/${quiz._id.toString()}/quiz/submit`)
      .set(bearer(token))
      .send(correctAnswers);
    expect(graded.status).toBe(200);
    expect(graded.body.correctCount).toBe(2);
    expect(graded.body.percentage).toBe(100);
    expect(graded.body.score).toBe(10);

    // Submit a wrong multi-answer (partial selection) — not counted correct.
    const wrong = await request(app)
      .post(`/api/subjects/quizzed/topics/${quiz._id.toString()}/quiz/submit`)
      .set(bearer(token))
      .send({
        answers: [
          {
            questionId: q1._id.toString(),
            choiceIds: [q1Choices[0]!._id.toString()],
          },
          {
            questionId: q2._id.toString(),
            choiceIds: [q2Choices[0]!._id.toString()],
          },
        ],
      });
    expect(wrong.body.correctCount).toBe(0);
    expect(wrong.body.percentage).toBe(0);
  });
});

describe("topic completion recomputes progress", () => {
  it("updates progress percentage when a topic is completed", async () => {
    const { topics } = await makeSubject({ slug: "progressed" });
    const token = await registerAndLogin();
    await request(app)
      .post("/api/subjects/progressed/enroll")
      .set(bearer(token));

    const res = await request(app)
      .post(
        `/api/subjects/progressed/topics/${topics.t1._id.toString()}/complete`,
      )
      .set(bearer(token))
      .send({ completed: true });
    expect(res.status).toBe(200);
    expect(res.body.isCompleted).toBe(true);
    // 1 of 3 topics complete → 33%.
    expect(res.body.progress.completedTopics).toBe(1);
    expect(res.body.progress.totalTopics).toBe(3);
    expect(res.body.progress.percentage).toBe(33);

    // Toggle back off → 0%.
    const off = await request(app)
      .post(
        `/api/subjects/progressed/topics/${topics.t1._id.toString()}/complete`,
      )
      .set(bearer(token))
      .send({ completed: false });
    expect(off.body.progress.percentage).toBe(0);
  });
});
