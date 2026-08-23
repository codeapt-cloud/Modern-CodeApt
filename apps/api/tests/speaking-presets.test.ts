/**
 * Step 12 — a full multi-type speaking assessment, end to end, with a stubbed
 * ASR. The producer is mocked; spoken items are "scored" by simulating the
 * worker write (as the read-aloud suite does), while DICTATION is scored INLINE
 * by the real submit path (no ASR, no queue). Also pins the per-type authoring
 * validation and that non-read_aloud references are WITHHELD from the student.
 */
import {
  Role,
  UserType,
  matchAnswerSet,
  scoreOpenTopicFloor,
  scoreReadAloud,
  scoreStoryRetellFloor,
} from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../src/lib/execution-queue.js", () => ({
  enqueueSpeechJob: vi.fn(async () => undefined),
  closeQueues: vi.fn(async () => undefined),
  knownQueues: [],
}));

import { createApp } from "../src/app.js";
import { enqueueSpeechJob } from "../src/lib/execution-queue.js";
import { SpeakingAttemptModel } from "../src/models/speaking.model.js";
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
  const u = `pp${n}`;
  await request(app).post("/api/auth/register").send({
    username: u,
    email: `${u}@example.com`,
    password: "Password123",
    fullName: `PP ${n}`,
    rollNumber: `PP-${n}`,
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
): Promise<{ collegeId: string; adminToken: string }> {
  const platform = await makeUser({ role: Role.SUPER_ADMIN });
  const dto = await colleges.createCollege({ name: slug, slug }, platform.userId);
  await colleges.setEntitlements(dto.id, { features: { communication: true } });
  await colleges.setEntitlements(dto.id, {
    subCapabilities: { "communication.speaking": true },
  });
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
  const id = created.body.id as string;
  await UserModel.updateOne({ _id: id }, { $set: { forcePasswordChange: false } });
  const login = await request(app)
    .post("/api/auth/login")
    .send({ identifier: email, password: TEMP_PW });
  return { id, token: login.body.accessToken as string };
}

// A compact CTS-style paper: one item from each scoring family.
const READ_REF = "the river winds slowly past the old stone bridge";
const DICT_REF = "the invoice was paid on time";
const RETELL_FACTS = ["5 years to build", "24.5 km long"];
const ITEMS = [
  { itemType: "read_aloud", referenceText: READ_REF, section: "Section A", responseWindowSeconds: 30 },
  {
    itemType: "short_answer",
    promptText: "Would you get water from a bottle or a newspaper?",
    answerSet: ["a bottle", "bottle"],
    section: "Section A",
  },
  { itemType: "dictation", referenceText: DICT_REF, promptText: "Type what you hear.", section: "Section A" },
  {
    itemType: "story_retell",
    promptText: "Retell the story.",
    keyFacts: RETELL_FACTS,
    section: "Section A",
  },
  { itemType: "open_topic", promptText: "Talk about healthy eating.", section: "Section B" },
];

async function authorAndPublish(slug: string, adminToken: string): Promise<string> {
  const create = await request(app)
    .post(`/api/c/${slug}/speaking`)
    .set(auth(adminToken))
    .send({ title: "CTS-style paper", items: ITEMS, maxAttempts: 0 });
  expect(create.status).toBe(201);
  const id = create.body.id as string;
  const pub = await request(app)
    .post(`/api/c/${slug}/speaking/${id}/publish`)
    .set(auth(adminToken))
    .send({ isPublished: true });
  expect(pub.status).toBe(200);
  return id;
}

/** Simulate the worker writing a score for one SPOKEN item. */
async function completeSpokenItem(
  attemptId: string,
  index: number,
  score: unknown,
  transcript: string,
): Promise<void> {
  await SpeakingAttemptModel.updateOne(
    { _id: attemptId },
    {
      $set: {
        [`items.${index}.transcript`]: transcript,
        [`items.${index}.subScores`]: score,
        [`items.${index}.jobStatus`]: "completed",
      },
    },
  );
}

describe("multi-type speaking paper — full lifecycle with stubbed ASR", () => {
  it("authors, withholds references, scores dictation inline, and completes", async () => {
    const { adminToken } = await setupCollege("pp-cts");
    const student = await addStudent("pp-cts", adminToken, "ppcts@x.com");
    const assessmentId = await authorAndPublish("pp-cts", adminToken);

    // Start — PROGRESSIVE DISCLOSURE returns ONLY the current item (index 0),
    // never the whole list. The reference is shown only for read_aloud.
    const start = await request(app)
      .post(`/api/c/pp-cts/speaking/${assessmentId}/attempts`)
      .set(auth(student.token));
    expect(start.status).toBe(201);
    const attemptId = start.body.attemptId as string;
    expect(start.body.items).toBeUndefined(); // no full list
    expect(start.body.totalItems).toBe(5);
    expect(start.body.item.index).toBe(0);
    expect(start.body.item.itemType).toBe("read_aloud");
    expect(start.body.item.referenceText).toBe(READ_REF);

    // Walk the paper IN ORDER; the next prompt is disclosed only after
    // submitting the current one. Collect every disclosed item to prove nothing
    // leaks (no answer keys, no key facts).
    const disclosed: Array<Record<string, unknown>> = [start.body.item];
    const submit = async (
      index: number,
      body: Record<string, unknown>,
    ): Promise<{ status: string; next: Record<string, unknown> | null }> => {
      const res = await request(app)
        .post(`/api/c/pp-cts/speaking/attempts/${attemptId}/items/${index}`)
        .set(auth(student.token))
        .send(body);
      expect(res.status).toBe(202);
      if (res.body.current.item) disclosed.push(res.body.current.item);
      return { status: res.body.status, next: res.body.current.item };
    };

    const s0 = await submit(0, { audioUrl: "https://cdn/a0.webm" });
    expect(s0.status).toBe("queued");
    expect(s0.next?.itemType).toBe("short_answer");
    expect(s0.next?.referenceText).toBe(""); // withheld
    const s1 = await submit(1, { audioUrl: "https://cdn/a1.webm" });
    expect(s1.next?.itemType).toBe("dictation");
    expect(s1.next?.referenceText).toBe(""); // dictation reference hidden
    // DICTATION — scored INLINE (completed synchronously, no queue).
    const s2 = await submit(2, { text: DICT_REF });
    expect(s2.status).toBe("completed");
    expect(s2.next?.itemType).toBe("story_retell");
    const s3 = await submit(3, { audioUrl: "https://cdn/a3.webm" });
    expect(s3.next?.itemType).toBe("open_topic");
    expect(s3.next?.section).toBe("Section B");
    const s4 = await submit(4, { audioUrl: "https://cdn/a4.webm" });
    expect(s4.next).toBeNull(); // finished — no more items disclosed

    // Nothing disclosed to the student ever carried an answer key or key fact.
    for (const v of disclosed) {
      expect(v).not.toHaveProperty("answerSet");
      expect(v).not.toHaveProperty("keyFacts");
      expect(v).not.toHaveProperty("missingWord");
    }
    expect(JSON.stringify(disclosed)).not.toContain("24.5");
    // Only the four spoken items enqueued; dictation did not.
    expect(vi.mocked(enqueueSpeechJob)).toHaveBeenCalledTimes(4);

    // Simulate the worker scoring each spoken item with the real shared scorers.
    const w = READ_REF.split(" ").map((word, i) => ({ word, start: i * 0.5, end: i * 0.5 + 0.4 }));
    await completeSpokenItem(attemptId, 0, scoreReadAloud(READ_REF, READ_REF, w), READ_REF);
    await completeSpokenItem(attemptId, 1, matchAnswerSet("a bottle", ["a bottle", "bottle"]), "a bottle");
    await completeSpokenItem(
      attemptId,
      3,
      scoreStoryRetellFloor(RETELL_FACTS, "it took five years to build and it is 24.5 km long", w),
      "it took five years to build and it is 24.5 km long",
    );
    await completeSpokenItem(attemptId, 4, scoreOpenTopicFloor(w), "healthy eating keeps you strong");
    await SpeakingAttemptModel.updateOne({ _id: attemptId }, { $set: { status: "scored" } });

    // Poll — complete, and each item carries its type-specific score shape.
    const done = await request(app)
      .get(`/api/c/pp-cts/speaking/attempts/${attemptId}/result`)
      .set(auth(student.token));
    expect(done.body.complete).toBe(true);
    const items = done.body.items as Array<{
      index: number;
      itemType: string;
      status: string;
      score: Record<string, unknown> | null;
    }>;
    expect(items.every((i) => i.status === "completed")).toBe(true);
    expect(items[0].score!.wordAccuracy).toBe(100); // read_aloud
    expect(items[1].score!.kind).toBe("answer_set"); // short_answer
    expect(items[1].score!.matched).toBe(true);
    expect(items[2].itemType).toBe("dictation"); // scored inline
    expect(items[2].score!.wordAccuracy).toBe(100);
    expect(items[2].score!.phoneticTolerant).toBe(false);
    expect(items[3].score!.kind).toBe("story_retell");
    expect(items[3].score!.source).toBe("deterministic_floor"); // no AI in test
    expect(items[3].score!.total).toBe(100); // both facts covered, out of 100
    expect(items[4].score!.kind).toBe("open_topic");
    // No pronunciation dimension anywhere.
    expect(JSON.stringify(done.body)).not.toMatch(/pronunciation/i);
  });
});

describe("per-type authoring validation", () => {
  it("rejects a short_answer with no answer set, and a story_retell with no facts", async () => {
    const { adminToken } = await setupCollege("pp-val");
    const bad1 = await request(app)
      .post("/api/c/pp-val/speaking")
      .set(auth(adminToken))
      .send({ title: "bad", items: [{ itemType: "short_answer", promptText: "Q?" }] });
    expect(bad1.status).toBe(400);
    const bad2 = await request(app)
      .post("/api/c/pp-val/speaking")
      .set(auth(adminToken))
      .send({ title: "bad", items: [{ itemType: "story_retell", promptText: "Retell." }] });
    expect(bad2.status).toBe(400);
  });

  it("accepts a well-formed multi-type paper", async () => {
    const { adminToken } = await setupCollege("pp-ok");
    const res = await request(app)
      .post("/api/c/pp-ok/speaking")
      .set(auth(adminToken))
      .send({ title: "ok", items: ITEMS });
    expect(res.status).toBe(201);
    expect(res.body.items).toHaveLength(5);
  });
});
