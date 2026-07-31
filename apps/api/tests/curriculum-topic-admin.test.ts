/**
 * Curriculum admin authoring (4a-ii) — the leaf tree: Topic CRUD (all 5 types,
 * discriminated schema), the exam-type linkage (auto-created Exam shell +
 * exam-topic picker), the essay optional-nullable ref, quiz Question/Choice
 * CRUD, topic reorder, and the per-type delete guards (cascade content, block
 * on student data). supertest + in-memory Mongo (see setup.ts).
 */
import { CurriculumErrorCode } from "@codeapt/shared";
import type { Express } from "express";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import {
  ExamModel,
  StudentExamAttemptModel,
} from "../src/models/assessment.model.js";
import {
  ChoiceModel,
  QuestionModel,
  QuizSubmissionModel,
  TopicProgressModel,
} from "../src/models/curriculum.model.js";
import { EssayTopicModel } from "../src/models/essay.model.js";
import request from "supertest";

let app: Express;
beforeAll(() => {
  app = createApp();
});

let counter = 0;
async function registerAndLogin(role?: "admin"): Promise<{
  token: string;
  userId: string;
}> {
  counter += 1;
  const u = `ctop${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Cur Top ${counter}`,
      rollNumber: `TROLL-${counter}`,
      collegeName: "Acme",
      phoneNumber: "9999999999",
      state: "KA",
    });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ identifier: u, password: "Password123" });
  const userId = res.body.user.id as string;
  if (role === "admin") {
    const { UserModel } = await import("../src/models/user.model.js");
    await UserModel.updateOne({ _id: userId }, { $set: { role: "admin" } });
    const relog = await request(app)
      .post("/api/auth/login")
      .send({ identifier: u, password: "Password123" });
    return { token: relog.body.accessToken as string, userId };
  }
  return { token: res.body.accessToken as string, userId };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function adminToken(): Promise<string> {
  return (await registerAndLogin("admin")).token;
}

/** Seed a subject + module through the admin API; returns their ids. */
async function seedModule(
  token: string,
): Promise<{ subjectId: string; moduleId: string }> {
  counter += 1;
  const subj = await request(app)
    .post("/api/admin/subjects")
    .set(auth(token))
    .send({ name: `Subject ${counter}` });
  const subjectId = subj.body.id as string;
  const mod = await request(app)
    .post(`/api/admin/subjects/${subjectId}/modules`)
    .set(auth(token))
    .send({ name: "Module 1" });
  return { subjectId, moduleId: mod.body.id as string };
}

const createTopic = (token: string, moduleId: string, body: unknown) =>
  request(app)
    .post(`/api/admin/modules/${moduleId}/topics`)
    .set(auth(token))
    .send(body);

describe("curriculum admin — Topic create (5 types, discriminated)", () => {
  it("creates a text topic; wrong-type fields are ignored", async () => {
    const token = await adminToken();
    const { moduleId } = await seedModule(token);
    const res = await createTopic(token, moduleId, {
      topicType: "text",
      name: "Intro",
      content: "# Hello",
      // videoId is not a text-topic field → must be ignored, not persisted.
      videoId: "SHOULD_BE_IGNORED",
    });
    expect(res.status).toBe(201);
    expect(res.body.topicType).toBe("text");
    expect(res.body.content).toBe("# Hello");
    expect(res.body.videoId).toBe("");
    // First topic in the module appends at order 0.
    expect(res.body.order).toBe(0);
  });

  it("creates a video topic with videoId + duration", async () => {
    const token = await adminToken();
    const { moduleId } = await seedModule(token);
    const res = await createTopic(token, moduleId, {
      topicType: "video",
      name: "Lecture",
      videoId: "dQw4w9WgXcQ",
      duration: "8 min",
    });
    expect(res.status).toBe(201);
    expect(res.body.videoId).toBe("dQw4w9WgXcQ");
    expect(res.body.duration).toBe("8 min");
  });

  it("creates a quiz topic (questionCount starts at 0)", async () => {
    const token = await adminToken();
    const { moduleId } = await seedModule(token);
    const res = await createTopic(token, moduleId, {
      topicType: "quiz",
      name: "Checkpoint",
    });
    expect(res.status).toBe(201);
    expect(res.body.topicType).toBe("quiz");
    expect(res.body.questionCount).toBe(0);
  });

  it("creates an exam topic and auto-creates its 1:1 Exam shell", async () => {
    const token = await adminToken();
    const { moduleId } = await seedModule(token);
    const res = await createTopic(token, moduleId, {
      topicType: "exam",
      name: "Final Mock",
    });
    expect(res.status).toBe(201);
    expect(res.body.examId).toBeTruthy();
    // The Exam really exists and is 1:1 with the topic.
    const exam = await ExamModel.findById(res.body.examId);
    expect(exam).not.toBeNull();
    expect(exam!.topic.toString()).toBe(res.body.id);
    expect(exam!.title).toBe("Final Mock");
  });

  it("creates an essay topic — with and without a linked prompt", async () => {
    const token = await adminToken();
    const { moduleId } = await seedModule(token);

    // No prompt linked is allowed (null=True, blank=True in the original).
    const bare = await createTopic(token, moduleId, {
      topicType: "essay",
      name: "Open Essay",
    });
    expect(bare.status).toBe(201);
    expect(bare.body.essayTopicId).toBeNull();

    const prompt = await EssayTopicModel.create({ title: "Argue a case" });
    const linked = await createTopic(token, moduleId, {
      topicType: "essay",
      name: "Linked Essay",
      essayTopicId: prompt._id.toString(),
    });
    expect(linked.status).toBe(201);
    expect(linked.body.essayTopicId).toBe(prompt._id.toString());
    expect(linked.body.essayTopicTitle).toBe("Argue a case");
  });

  it("rejects an unknown topicType and a missing name", async () => {
    const token = await adminToken();
    const { moduleId } = await seedModule(token);
    const badType = await createTopic(token, moduleId, {
      topicType: "podcast",
      name: "Nope",
    });
    expect(badType.status).toBe(400);
    const noName = await createTopic(token, moduleId, {
      topicType: "text",
      name: "",
    });
    expect(noName.status).toBe(400);
  });

  it("rejects an essay topic linked to a non-existent prompt (404)", async () => {
    const token = await adminToken();
    const { moduleId } = await seedModule(token);
    const res = await createTopic(token, moduleId, {
      topicType: "essay",
      name: "Dangling",
      essayTopicId: "64b8f0000000000000000000",
    });
    expect(res.status).toBe(404);
  });
});

describe("curriculum admin — Topic update / list / reorder", () => {
  it("updates a topic but refuses to change its type", async () => {
    const token = await adminToken();
    const { moduleId } = await seedModule(token);
    const topic = await createTopic(token, moduleId, {
      topicType: "text",
      name: "V1",
      content: "a",
    });
    const id = topic.body.id as string;

    const ok = await request(app)
      .patch(`/api/admin/topics/${id}`)
      .set(auth(token))
      .send({ topicType: "text", name: "V2", content: "b" });
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe("V2");
    expect(ok.body.content).toBe("b");

    const bad = await request(app)
      .patch(`/api/admin/topics/${id}`)
      .set(auth(token))
      .send({ topicType: "video", name: "V2" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe(
      CurriculumErrorCode.TOPIC_TYPE_IMMUTABLE,
    );
  });

  it("relinks and unlinks an essay prompt on update (SET_NULL)", async () => {
    const token = await adminToken();
    const { moduleId } = await seedModule(token);
    const prompt = await EssayTopicModel.create({ title: "Prompt A" });
    const topic = await createTopic(token, moduleId, {
      topicType: "essay",
      name: "E",
      essayTopicId: prompt._id.toString(),
    });
    const id = topic.body.id as string;

    const cleared = await request(app)
      .patch(`/api/admin/topics/${id}`)
      .set(auth(token))
      .send({ topicType: "essay", name: "E", essayTopicId: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.essayTopicId).toBeNull();
  });

  it("lists topics in module order and reorders by array index", async () => {
    const token = await adminToken();
    const { moduleId } = await seedModule(token);
    const a = await createTopic(token, moduleId, {
      topicType: "text",
      name: "A",
    });
    const b = await createTopic(token, moduleId, {
      topicType: "text",
      name: "B",
    });
    const c = await createTopic(token, moduleId, {
      topicType: "text",
      name: "C",
    });

    const list = await request(app)
      .get(`/api/admin/modules/${moduleId}/topics`)
      .set(auth(token));
    expect(list.body.items.map((t: { name: string }) => t.name)).toEqual([
      "A",
      "B",
      "C",
    ]);

    const reordered = await request(app)
      .post(`/api/admin/modules/${moduleId}/topics/reorder`)
      .set(auth(token))
      .send({ ids: [c.body.id, a.body.id, b.body.id] });
    expect(reordered.status).toBe(200);
    expect(
      reordered.body.items.map((t: { name: string }) => t.name),
    ).toEqual(["C", "A", "B"]);
    expect(reordered.body.items.map((t: { order: number }) => t.order)).toEqual(
      [0, 1, 2],
    );
  });
});

describe("curriculum admin — exam-topic picker", () => {
  it("lists exam topics with subject/module labels + examId", async () => {
    const token = await adminToken();
    const { subjectId, moduleId } = await seedModule(token);
    const topic = await createTopic(token, moduleId, {
      topicType: "exam",
      name: "Aptitude Mock",
    });

    const picker = await request(app)
      .get("/api/admin/exam-topics")
      .set(auth(token));
    expect(picker.status).toBe(200);
    const entry = picker.body.items.find(
      (t: { topicId: string }) => t.topicId === topic.body.id,
    );
    expect(entry).toBeDefined();
    expect(entry.examId).toBe(topic.body.examId);
    expect(entry.name).toBe("Aptitude Mock");
    expect(entry.moduleId).toBe(moduleId);
    expect(entry.subjectId).toBe(subjectId);
    expect(entry.subjectName).toBeTruthy();
  });
});

describe("curriculum admin — quiz Question / Choice CRUD", () => {
  async function seedQuizTopic(
    token: string,
  ): Promise<{ moduleId: string; topicId: string }> {
    const { moduleId } = await seedModule(token);
    const topic = await createTopic(token, moduleId, {
      topicType: "quiz",
      name: "Quiz",
    });
    return { moduleId, topicId: topic.body.id as string };
  }

  it("creates, lists, updates (replace choices), and deletes a question", async () => {
    const token = await adminToken();
    const { topicId } = await seedQuizTopic(token);

    const created = await request(app)
      .post(`/api/admin/topics/${topicId}/questions`)
      .set(auth(token))
      .send({
        text: "2 + 2 = ?",
        marks: 2,
        choices: [
          { text: "3", isCorrect: false },
          { text: "4", isCorrect: true },
        ],
      });
    expect(created.status).toBe(201);
    expect(created.body.choices).toHaveLength(2);
    const questionId = created.body.id as string;

    const list = await request(app)
      .get(`/api/admin/topics/${topicId}/questions`)
      .set(auth(token));
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].marks).toBe(2);

    // Update replaces the whole choice set.
    const updated = await request(app)
      .patch(`/api/admin/questions/${questionId}`)
      .set(auth(token))
      .send({
        text: "Pick the primes",
        marks: 3,
        choices: [
          { text: "2", isCorrect: true },
          { text: "3", isCorrect: true },
          { text: "4", isCorrect: false },
        ],
      });
    expect(updated.status).toBe(200);
    expect(updated.body.choices).toHaveLength(3);
    // Old choices are gone (replaced), not accumulated.
    expect(await ChoiceModel.countDocuments({ question: questionId })).toBe(3);

    const del = await request(app)
      .delete(`/api/admin/questions/${questionId}`)
      .set(auth(token));
    expect(del.status).toBe(200);
    expect(await QuestionModel.countDocuments({ topic: topicId })).toBe(0);
    expect(await ChoiceModel.countDocuments({ question: questionId })).toBe(0);
  });

  it("rejects < 2 choices and 0 correct choices", async () => {
    const token = await adminToken();
    const { topicId } = await seedQuizTopic(token);

    const tooFew = await request(app)
      .post(`/api/admin/topics/${topicId}/questions`)
      .set(auth(token))
      .send({ text: "Q", choices: [{ text: "only", isCorrect: true }] });
    expect(tooFew.status).toBe(400);

    const noneCorrect = await request(app)
      .post(`/api/admin/topics/${topicId}/questions`)
      .set(auth(token))
      .send({
        text: "Q",
        choices: [
          { text: "a", isCorrect: false },
          { text: "b", isCorrect: false },
        ],
      });
    expect(noneCorrect.status).toBe(400);
  });

  it("refuses questions on a non-quiz topic (NOT_A_QUIZ)", async () => {
    const token = await adminToken();
    const { moduleId } = await seedModule(token);
    const textTopic = await createTopic(token, moduleId, {
      topicType: "text",
      name: "Text",
    });
    const res = await request(app)
      .post(`/api/admin/topics/${textTopic.body.id}/questions`)
      .set(auth(token))
      .send({
        text: "Q",
        choices: [
          { text: "a", isCorrect: true },
          { text: "b", isCorrect: false },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(CurriculumErrorCode.NOT_A_QUIZ);
  });
});

describe("curriculum admin — Topic delete guards (cascade vs block)", () => {
  const del = (token: string, id: string) =>
    request(app).delete(`/api/admin/topics/${id}`).set(auth(token));

  it("text/video: blocks on progress, else deletes", async () => {
    const { token, userId } = await registerAndLogin("admin");
    const { moduleId } = await seedModule(token);

    const studied = await createTopic(token, moduleId, {
      topicType: "text",
      name: "Studied",
    });
    await TopicProgressModel.create({ user: userId, topic: studied.body.id });
    const blocked = await del(token, studied.body.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe(CurriculumErrorCode.DELETE_BLOCKED);

    const untouched = await createTopic(token, moduleId, {
      topicType: "video",
      name: "Fresh",
      videoId: "x",
    });
    const ok = await del(token, untouched.body.id);
    expect(ok.status).toBe(200);
  });

  it("quiz: cascades questions/choices, but blocks on a submission", async () => {
    const { token, userId } = await registerAndLogin("admin");
    const { subjectId, moduleId } = await seedModule(token);

    // A quiz topic with a question + choices; no student data → cascades.
    const quiz = await createTopic(token, moduleId, {
      topicType: "quiz",
      name: "Q1",
    });
    const q = await request(app)
      .post(`/api/admin/topics/${quiz.body.id}/questions`)
      .set(auth(token))
      .send({
        text: "Q",
        choices: [
          { text: "a", isCorrect: true },
          { text: "b", isCorrect: false },
        ],
      });
    const okDelete = await del(token, quiz.body.id);
    expect(okDelete.status).toBe(200);
    expect(await QuestionModel.countDocuments({ topic: quiz.body.id })).toBe(0);
    expect(await ChoiceModel.countDocuments({ question: q.body.id })).toBe(0);

    // A quiz topic with a QuizSubmission → blocked.
    const graded = await createTopic(token, moduleId, {
      topicType: "quiz",
      name: "Q2",
    });
    await QuizSubmissionModel.create({
      user: userId,
      subject: subjectId,
      topic: graded.body.id,
    });
    const blocked = await del(token, graded.body.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe(CurriculumErrorCode.DELETE_BLOCKED);
  });

  it("exam: cascades the Exam tree, but blocks on a real attempt", async () => {
    const token = await adminToken();
    const { moduleId } = await seedModule(token);

    // No attempts → deleting the topic cascades the linked Exam.
    const clean = await createTopic(token, moduleId, {
      topicType: "exam",
      name: "Mock A",
    });
    const cleanExamId = clean.body.examId as string;
    const okDelete = await del(token, clean.body.id);
    expect(okDelete.status).toBe(200);
    expect(await ExamModel.findById(cleanExamId)).toBeNull();

    // A recorded attempt → blocked (attempt history must survive).
    const taken = await createTopic(token, moduleId, {
      topicType: "exam",
      name: "Mock B",
    });
    await StudentExamAttemptModel.create({
      exam: taken.body.examId,
      attemptToken: "tok-1",
    });
    const blocked = await del(token, taken.body.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe(CurriculumErrorCode.DELETE_BLOCKED);
    // Exam (and the topic) survive the blocked delete.
    expect(await ExamModel.findById(taken.body.examId)).not.toBeNull();
  });

  it("essay: deletes the topic without deleting the shared EssayTopic", async () => {
    const { token, userId } = await registerAndLogin("admin");
    const { moduleId } = await seedModule(token);
    const prompt = await EssayTopicModel.create({ title: "Shared prompt" });

    const linked = await createTopic(token, moduleId, {
      topicType: "essay",
      name: "Essay",
      essayTopicId: prompt._id.toString(),
    });
    const ok = await del(token, linked.body.id);
    expect(ok.status).toBe(200);
    // The shared prompt is never destroyed by a topic delete.
    expect(await EssayTopicModel.findById(prompt._id)).not.toBeNull();

    // But progress on an essay topic blocks the delete.
    const studied = await createTopic(token, moduleId, {
      topicType: "essay",
      name: "Essay 2",
    });
    await TopicProgressModel.create({ user: userId, topic: studied.body.id });
    const blocked = await del(token, studied.body.id);
    expect(blocked.status).toBe(409);
  });
});

describe("curriculum admin — leaf tree guard", () => {
  it("rejects non-admins on a topic route (403)", async () => {
    const admin = await adminToken();
    const { moduleId } = await seedModule(admin);
    const { token: userTok } = await registerAndLogin();
    const res = await createTopic(userTok, moduleId, {
      topicType: "text",
      name: "X",
    });
    expect(res.status).toBe(403);
  });
});
