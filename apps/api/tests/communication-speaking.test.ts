/**
 * Speech spine (Communication Sections A/B) — API tests. The BullMQ producer is
 * mocked; the ASR "worker" is simulated by writing the transcription result (or
 * a failure) onto the SpeakingAttempt item directly, exactly as the essay/exam
 * suites do. Covers: the speaking attempt lifecycle (available → start →
 * submit-item → poll), the access matrix (tenant membership + publish + cohort),
 * the authoring `speaking` sub-capability gate, and that a FAILED transcription
 * finalizes the item (complete:true) rather than hanging.
 */
import {
  Role,
  UserType,
  scoreReadAloud,
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
import { SpeakingAssessmentModel, SpeakingAttemptModel } from "../src/models/speaking.model.js";
import { UserModel } from "../src/models/user.model.js";
import * as colleges from "../src/services/college.service.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

const TEMP_PW = "CodeApt@123";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
let n = 0;

const REFERENCE = "the quick brown fox jumps over the lazy dog";

async function makeUser(fields?: {
  role?: string;
  userType?: string;
  college?: Types.ObjectId | null;
}): Promise<{ token: string; userId: string }> {
  n += 1;
  const u = `sp${n}`;
  await request(app).post("/api/auth/register").send({
    username: u,
    email: `${u}@example.com`,
    password: "Password123",
    fullName: `SP ${n}`,
    rollNumber: `SP-${n}`,
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
  opts: { speaking?: boolean } = {},
): Promise<{ collegeId: string; adminToken: string }> {
  const platform = await makeUser({ role: Role.SUPER_ADMIN });
  const dto = await colleges.createCollege({ name: slug, slug }, platform.userId);
  await colleges.setEntitlements(dto.id, { features: { communication: true } });
  if (opts.speaking) {
    await colleges.setEntitlements(dto.id, {
      subCapabilities: { "communication.speaking": true },
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

async function makeAssessment(
  collegeId: string,
  opts: { published?: boolean; maxAttempts?: number } = {},
): Promise<string> {
  const doc = await SpeakingAssessmentModel.create({
    college: new Types.ObjectId(collegeId),
    topic: null,
    isPublished: opts.published ?? true,
    title: "Read Aloud — pangram",
    description: "Read the sentence aloud clearly.",
    maxAttempts: opts.maxAttempts ?? 2,
    orgUnits: [],
    items: [
      {
        itemType: "read_aloud",
        referenceText: REFERENCE,
        promptText: "Read the sentence on screen.",
        responseWindowSeconds: 30,
        order: 0,
      },
    ],
  });
  return doc._id.toString();
}

/** Simulate the worker writing a transcription result onto the attempt item. */
async function completeItem(
  attemptId: string,
  transcript: string,
): Promise<void> {
  const words = transcript
    .split(/\s+/)
    .filter(Boolean)
    .map((word, i) => ({ word, start: i * 0.5, end: i * 0.5 + 0.4 }));
  const score = scoreReadAloud(REFERENCE, transcript, words);
  await SpeakingAttemptModel.updateOne(
    { _id: attemptId },
    {
      $set: {
        "items.0.transcript": transcript,
        "items.0.wordTimings": words,
        "items.0.subScores": score,
        "items.0.jobStatus": "completed",
        status: "scored",
      },
    },
  );
}

describe("speaking lifecycle — available → start → submit → poll", () => {
  it("runs a read-aloud item end to end and returns word accuracy + fluency", async () => {
    const { collegeId, adminToken } = await setupCollege("sp-life", {
      speaking: true,
    });
    const student = await addStudent("sp-life", adminToken, "splife@x.com");
    const assessmentId = await makeAssessment(collegeId);

    // Available list surfaces the published assessment.
    const avail = await request(app)
      .get("/api/c/sp-life/speaking/available")
      .set(auth(student.token));
    expect(avail.status).toBe(200);
    expect(avail.body.items).toHaveLength(1);
    expect(avail.body.items[0].id).toBe(assessmentId);

    // Start → attempt with one item view (reference text on screen).
    const start = await request(app)
      .post(`/api/c/sp-life/speaking/${assessmentId}/attempts`)
      .set(auth(student.token));
    expect(start.status).toBe(201);
    const attemptId = start.body.attemptId as string;
    expect(start.body.items[0].referenceText).toBe(REFERENCE);

    // Submit the recorded audio URL → queued (async), enqueue called.
    const submit = await request(app)
      .post(`/api/c/sp-life/speaking/attempts/${attemptId}/items/0`)
      .set(auth(student.token))
      .send({ audioUrl: "https://res.cloudinary.com/demo/video/upload/a.webm" });
    expect(submit.status).toBe(202);
    expect(submit.body.status).toBe("queued");
    expect(vi.mocked(enqueueSpeechJob)).toHaveBeenCalledTimes(1);

    // Poll before the worker runs → pending, no score leaked.
    const pending = await request(app)
      .get(`/api/c/sp-life/speaking/attempts/${attemptId}/result`)
      .set(auth(student.token));
    expect(pending.body.items[0].status).toBe("queued");
    expect(pending.body.items[0].score).toBeNull();

    // Simulate the worker: a perfect read → 100% word accuracy + fluency.
    await completeItem(attemptId, REFERENCE);
    const done = await request(app)
      .get(`/api/c/sp-life/speaking/attempts/${attemptId}/result`)
      .set(auth(student.token));
    expect(done.body.complete).toBe(true);
    expect(done.body.items[0].status).toBe("completed");
    expect(done.body.items[0].score.wordAccuracy).toBe(100);
    expect(done.body.items[0].score.fluency.wordCount).toBe(9);
    // No pronunciation dimension exists anywhere on the result.
    expect(JSON.stringify(done.body)).not.toMatch(/pronunciation/i);
  });

  it("refuses a second recording of the same item (no re-record)", async () => {
    const { collegeId, adminToken } = await setupCollege("sp-rerec", {
      speaking: true,
    });
    const student = await addStudent("sp-rerec", adminToken, "sprerec@x.com");
    const assessmentId = await makeAssessment(collegeId);
    const start = await request(app)
      .post(`/api/c/sp-rerec/speaking/${assessmentId}/attempts`)
      .set(auth(student.token));
    const attemptId = start.body.attemptId as string;
    const url = "https://res.cloudinary.com/demo/video/upload/a.webm";
    await request(app)
      .post(`/api/c/sp-rerec/speaking/attempts/${attemptId}/items/0`)
      .set(auth(student.token))
      .send({ audioUrl: url });
    const again = await request(app)
      .post(`/api/c/sp-rerec/speaking/attempts/${attemptId}/items/0`)
      .set(auth(student.token))
      .send({ audioUrl: url });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ITEM_ALREADY_SUBMITTED");
  });
});

describe("failed transcription finalizes (never hangs)", () => {
  it("a failed item reports status=failed and the attempt is complete", async () => {
    const { collegeId, adminToken } = await setupCollege("sp-fail", {
      speaking: true,
    });
    const student = await addStudent("sp-fail", adminToken, "spfail@x.com");
    const assessmentId = await makeAssessment(collegeId);
    const start = await request(app)
      .post(`/api/c/sp-fail/speaking/${assessmentId}/attempts`)
      .set(auth(student.token));
    const attemptId = start.body.attemptId as string;
    await request(app)
      .post(`/api/c/sp-fail/speaking/attempts/${attemptId}/items/0`)
      .set(auth(student.token))
      .send({ audioUrl: "https://res.cloudinary.com/demo/video/upload/a.webm" });

    // Simulate the worker finalizing the item as FAILED (ASR unreachable).
    await SpeakingAttemptModel.updateOne(
      { _id: attemptId },
      {
        $set: {
          "items.0.jobStatus": "failed",
          "items.0.error": "Could not reach the speech service.",
          status: "scored",
        },
      },
    );
    const res = await request(app)
      .get(`/api/c/sp-fail/speaking/attempts/${attemptId}/result`)
      .set(auth(student.token));
    expect(res.body.complete).toBe(true); // finalized, not hanging
    expect(res.body.items[0].status).toBe("failed");
    expect(res.body.items[0].score).toBeNull();
    expect(res.body.items[0].error).toMatch(/speech service/i);
  });
});

describe("access matrix", () => {
  it("a non-member cannot start a tenant assessment (404 hides existence)", async () => {
    const { collegeId, adminToken } = await setupCollege("sp-acc", {
      speaking: true,
    });
    await addStudent("sp-acc", adminToken, "spmember@x.com");
    const assessmentId = await makeAssessment(collegeId);
    // A user with no college membership.
    const outsider = await makeUser();
    const res = await request(app)
      .post(`/api/c/sp-acc/speaking/${assessmentId}/attempts`)
      .set(auth(outsider.token));
    // resolveTenant/feature/membership all lead to a not-authorized/hidden result.
    expect([403, 404]).toContain(res.status);
  });

  it("an unpublished assessment is neither listed nor startable", async () => {
    const { collegeId, adminToken } = await setupCollege("sp-draft", {
      speaking: true,
    });
    const student = await addStudent("sp-draft", adminToken, "spdraft@x.com");
    const assessmentId = await makeAssessment(collegeId, { published: false });
    const avail = await request(app)
      .get("/api/c/sp-draft/speaking/available")
      .set(auth(student.token));
    expect(avail.body.items).toHaveLength(0);
    const start = await request(app)
      .post(`/api/c/sp-draft/speaking/${assessmentId}/attempts`)
      .set(auth(student.token));
    expect(start.status).toBe(404);
  });

  it("enforces the per-assessment attempt cap", async () => {
    const { collegeId, adminToken } = await setupCollege("sp-cap", {
      speaking: true,
    });
    const student = await addStudent("sp-cap", adminToken, "spcap@x.com");
    const assessmentId = await makeAssessment(collegeId, { maxAttempts: 1 });
    const first = await request(app)
      .post(`/api/c/sp-cap/speaking/${assessmentId}/attempts`)
      .set(auth(student.token));
    expect(first.status).toBe(201);
    const second = await request(app)
      .post(`/api/c/sp-cap/speaking/${assessmentId}/attempts`)
      .set(auth(student.token));
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("ATTEMPT_LIMIT_REACHED");
  });
});

describe("authoring — gated on the speaking sub-capability", () => {
  it("403s a create when communication is on but speaking is off", async () => {
    const { adminToken } = await setupCollege("sp-nogate", { speaking: false });
    const res = await request(app)
      .post("/api/c/sp-nogate/speaking")
      .set(auth(adminToken))
      .send({
        title: "No gate",
        items: [{ itemType: "read_aloud", referenceText: "hello world" }],
      });
    expect(res.status).toBe(403);
  });

  it("creates + publishes a read-aloud assessment with the sub-capability", async () => {
    const { adminToken } = await setupCollege("sp-auth", { speaking: true });
    const create = await request(app)
      .post("/api/c/sp-auth/speaking")
      .set(auth(adminToken))
      .send({
        title: "Authored read-aloud",
        items: [
          { itemType: "read_aloud", referenceText: REFERENCE, responseWindowSeconds: 30 },
        ],
      });
    expect(create.status).toBe(201);
    expect(create.body.items).toHaveLength(1);
    const id = create.body.id as string;
    const pub = await request(app)
      .post(`/api/c/sp-auth/speaking/${id}/publish`)
      .set(auth(adminToken))
      .send({ isPublished: true });
    expect(pub.status).toBe(200);
    expect(pub.body.isPublished).toBe(true);
  });
});
