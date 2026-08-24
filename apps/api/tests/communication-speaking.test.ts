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
  SPEAKING_SUBMIT_GRACE_MS,
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
    // Progressive disclosure: start returns ONLY the current item, not a list.
    expect(start.body.items).toBeUndefined();
    expect(start.body.item.referenceText).toBe(REFERENCE);
    expect(start.body.totalItems).toBe(1);
    expect(typeof start.body.expiresAt).toBe("string");

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
    // Item 0 is no longer the current item (disclosure advanced past it), so a
    // re-submit is refused — the no-re-record rule now rides progressive disclosure.
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("NOT_CURRENT_ITEM");
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

  it("C5: the deep-link lookup resumes an in-progress attempt instead of starting a second one", async () => {
    const { collegeId, adminToken } = await setupCollege("sp-resume", {
      speaking: true,
    });
    const student = await addStudent("sp-resume", adminToken, "spr@x.com");
    const assessmentId = await makeAssessment(collegeId, { maxAttempts: 2 });

    // No attempt yet → null (the deep link would then start a fresh one).
    const none = await request(app)
      .get(`/api/c/sp-resume/speaking/${assessmentId}/attempt`)
      .set(auth(student.token));
    expect(none.status).toBe(200);
    expect(none.body.attempt).toBeNull();

    const start = await request(app)
      .post(`/api/c/sp-resume/speaking/${assessmentId}/attempts`)
      .set(auth(student.token));
    expect(start.status).toBe(201);
    const attemptId = start.body.attemptId as string;

    // The lookup RESUMES the same attempt — same id, and it never creates one.
    const cur = await request(app)
      .get(`/api/c/sp-resume/speaking/${assessmentId}/attempt`)
      .set(auth(student.token));
    expect(cur.status).toBe(200);
    expect(cur.body.attempt).not.toBeNull();
    expect(cur.body.attempt.attemptId).toBe(attemptId);
    const count = await SpeakingAttemptModel.countDocuments({
      user: new Types.ObjectId(student.id),
      assessment: new Types.ObjectId(assessmentId),
    });
    expect(count).toBe(1);
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

describe("server-side deadline + bounded submit grace (Step 14 integrity)", () => {
  it("BEYOND the grace: reads and writes are refused, and the slot is freed", async () => {
    const { collegeId, adminToken } = await setupCollege("sp-exp", {
      speaking: true,
    });
    const student = await addStudent("sp-exp", adminToken, "spexp@x.com");
    // maxAttempts 1 — proves an expired attempt does NOT burn the slot.
    const assessmentId = await makeAssessment(collegeId, { maxAttempts: 1 });

    const start = await request(app)
      .post(`/api/c/sp-exp/speaking/${assessmentId}/attempts`)
      .set(auth(student.token));
    const attemptId = start.body.attemptId as string;
    expect(start.body.item).not.toBeNull();

    // Deadline is past even the submit grace — genuinely too late.
    await SpeakingAttemptModel.updateOne(
      { _id: attemptId },
      { $set: { expiresAt: new Date(Date.now() - SPEAKING_SUBMIT_GRACE_MS - 5000) } },
    );

    // READ: current returns expired + no item, and finalizes EXPIRED.
    const current = await request(app)
      .get(`/api/c/sp-exp/speaking/attempts/${attemptId}/current`)
      .set(auth(student.token));
    expect(current.status).toBe(200);
    expect(current.body.expired).toBe(true);
    expect(current.body.item).toBeNull();
    expect(current.body.status).toBe("expired");

    // WRITE: a submit beyond the grace is refused, and the recording is NOT stored.
    const submit = await request(app)
      .post(`/api/c/sp-exp/speaking/attempts/${attemptId}/items/0`)
      .set(auth(student.token))
      .send({ audioUrl: "https://res.cloudinary.com/demo/video/upload/a.webm" });
    expect(submit.status).toBe(409);
    expect(submit.body.error.code).toBe("ATTEMPT_EXPIRED");
    const rejected = await SpeakingAttemptModel.findById(attemptId);
    expect(rejected?.items[0]?.audioUrl ?? "").toBe(""); // not stored

    // The expired attempt did NOT consume the cap — a fresh attempt starts.
    const restart = await request(app)
      .post(`/api/c/sp-exp/speaking/${assessmentId}/attempts`)
      .set(auth(student.token));
    expect(restart.status).toBe(201);
  });

  it("WITHIN the grace: no new item is served, but the in-flight answer is kept", async () => {
    const { collegeId, adminToken } = await setupCollege("sp-late", {
      speaking: true,
    });
    const student = await addStudent("sp-late", adminToken, "splate@x.com");
    const assessmentId = await makeAssessment(collegeId);
    const start = await request(app)
      .post(`/api/c/sp-late/speaking/${assessmentId}/attempts`)
      .set(auth(student.token));
    const attemptId = start.body.attemptId as string;

    // Deadline just passed but well within the grace — the student finished
    // speaking in time and the upload+POST is only now landing.
    await SpeakingAttemptModel.updateOne(
      { _id: attemptId },
      { $set: { expiresAt: new Date(Date.now() - 30_000) } },
    );

    // A READ still grants NO new playing time — it discloses no item.
    const read = await request(app)
      .get(`/api/c/sp-late/speaking/attempts/${attemptId}/current`)
      .set(auth(student.token));
    expect(read.body.expired).toBe(true);
    expect(read.body.item).toBeNull();

    // But the in-flight answer for the item served before the deadline is KEPT.
    const url = "https://res.cloudinary.com/demo/video/upload/late.webm";
    const submit = await request(app)
      .post(`/api/c/sp-late/speaking/attempts/${attemptId}/items/0`)
      .set(auth(student.token))
      .send({ audioUrl: url });
    expect(submit.status).toBe(202);
    expect(submit.body.status).toBe("queued");
    expect(submit.body.current.expired).toBe(true);
    expect(submit.body.current.item).toBeNull(); // still no new prompt
    expect(vi.mocked(enqueueSpeechJob)).toHaveBeenCalled();

    const attempt = await SpeakingAttemptModel.findById(attemptId);
    expect(attempt?.items[0]?.audioUrl).toBe(url); // recording kept
    expect(attempt?.status).toBe("expired");

    // A SECOND grace submit gets no second bite (item already answered).
    const again = await request(app)
      .post(`/api/c/sp-late/speaking/attempts/${attemptId}/items/0`)
      .set(auth(student.token))
      .send({ audioUrl: "https://res.cloudinary.com/demo/video/upload/late2.webm" });
    expect(again.status).toBe(409);
  });
});

describe("operator attempt management (Step 14 integrity)", () => {
  it("lists attempts with status and clears a stuck one", async () => {
    const { collegeId, adminToken } = await setupCollege("sp-ops", {
      speaking: true,
    });
    const student = await addStudent("sp-ops", adminToken, "spops@x.com");
    const assessmentId = await makeAssessment(collegeId);
    const start = await request(app)
      .post(`/api/c/sp-ops/speaking/${assessmentId}/attempts`)
      .set(auth(student.token));
    const attemptId = start.body.attemptId as string;

    // Operator sees the in-progress attempt.
    const list = await request(app)
      .get(`/api/c/sp-ops/speaking/${assessmentId}/attempts`)
      .set(auth(adminToken));
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].status).toBe("in_progress");
    expect(list.body.items[0].attemptId).toBe(attemptId);

    // Operator clears it (visible + clearable, not a permanent stuck row).
    const clear = await request(app)
      .delete(`/api/c/sp-ops/speaking/${assessmentId}/attempts/${attemptId}`)
      .set(auth(adminToken));
    expect(clear.status).toBe(204);

    const after = await request(app)
      .get(`/api/c/sp-ops/speaking/${assessmentId}/attempts`)
      .set(auth(adminToken));
    expect(after.body.items).toHaveLength(0);
  });
});
