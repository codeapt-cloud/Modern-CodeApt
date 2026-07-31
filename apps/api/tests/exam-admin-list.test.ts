/**
 * /admin/exams list must tolerate imperfect (migrated) data: a question or
 * section whose `exam` FK is null groups under `_id: null` in the count
 * aggregation, which previously crashed the mapping with a 500. This asserts the
 * list returns 200 and simply doesn't attribute the orphaned question.
 */
import { TopicType } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import {
  ExamModel,
  ExamQuestionModel,
  ExamSectionModel,
} from "../src/models/assessment.model.js";
import { TopicModel } from "../src/models/curriculum.model.js";
import { UserModel } from "../src/models/user.model.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

async function adminToken(): Promise<string> {
  const u = "examlist-admin";
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: "Exam List Admin",
      rollNumber: "EL-1",
      collegeName: "Acme",
      phoneNumber: "9999999999",
      state: "KA",
    });
  const login = await request(app)
    .post("/api/auth/login")
    .send({ identifier: u, password: "Password123" });
  await UserModel.updateOne({ _id: login.body.user.id }, { $set: { role: "admin" } });
  const relog = await request(app)
    .post("/api/auth/login")
    .send({ identifier: u, password: "Password123" });
  return relog.body.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("admin exam list — tolerant of null exam FK (migrated data)", () => {
  it("returns 200 (no 500) when a question has a null exam, without attributing it", async () => {
    const token = await adminToken();
    const exam = await ExamModel.create({
      topic: new Types.ObjectId(),
      title: "Legacy Exam",
      totalMarks: 10,
    });
    const section = await ExamSectionModel.create({
      exam: exam._id,
      name: "S1",
      durationMinutes: 10,
      order: 0,
    });
    // A properly-linked question (attributed to the exam).
    await ExamQuestionModel.create({
      exam: exam._id,
      section: section._id,
      questionType: "MCQ_SINGLE",
      text: "linked",
      options: ["a", "b"],
      correctOptions: [0],
      marks: 5,
    });
    // Simulate imperfect migrated data: a question with exam=null. Insert via the
    // raw collection to bypass the required-field validation the app enforces.
    await ExamQuestionModel.collection.insertOne({
      exam: null,
      section: section._id,
      questionType: "MCQ_SINGLE",
      text: "orphaned",
      options: ["a", "b"],
      correctOptions: [0],
      marks: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app).get("/api/admin/exams").set(auth(token));
    expect(res.status).toBe(200); // previously 500 on null-group .toString()
    const row = res.body.items.find(
      (e: { title: string }) => e.title === "Legacy Exam",
    );
    expect(row).toBeTruthy();
    // Only the properly-linked question is counted; the null-exam one is ignored.
    expect(row.questionCount).toBe(1);
    expect(row.sectionCount).toBe(1);
  });

  it("shows the linked topic's name when a migrated exam has the blank-title placeholder", async () => {
    const token = await adminToken();
    // Migrated shape: title fell back to the "Exam" placeholder, but the linked
    // topic carries the real name.
    const topic = await TopicModel.create({
      module: new Types.ObjectId(),
      name: "TCS Test 5",
      topicType: TopicType.EXAM,
      order: 0,
    });
    const exam = await ExamModel.create({
      topic: topic._id,
      title: "Exam",
      totalMarks: 10,
    });

    const res = await request(app).get("/api/admin/exams").set(auth(token));
    expect(res.status).toBe(200);
    const row = res.body.items.find(
      (e: { id: string }) => e.id === exam._id.toString(),
    );
    expect(row).toBeTruthy();
    expect(row.title).toBe("TCS Test 5"); // not the literal "Exam"
  });
});
