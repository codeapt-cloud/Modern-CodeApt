/**
 * Step 32 — BROWSER STT engine (tier 1) + Whisper re-score (tier 2) + Communication
 * proctoring termination, API-level. The speech queue is mocked (as in the speech
 * spine suite); the browser path scores INLINE (no worker) so it is fully assertable
 * here. Covers:
 *   - a browser submit scores through the SAME pure scorers, stores the audio, and
 *     records engine=browser on the item; the attempt reaches SCORED with no worker;
 *   - a failed recognition still stores audio + finalizes unscored (re-scorable);
 *   - a WHISPER attempt is unchanged (still enqueues, still QUEUED, score withheld);
 *   - tier-2 re-score (per-attempt) re-enqueues the stored audio, is idempotent, and
 *     stamps rescoredAt; a cohort/bulk re-score fans out;
 *   - three warnings TERMINATE the attempt server-side and commit it SCORED, the
 *     count survives a reload, and a further warning is idempotent;
 *   - the platform default engine is inherited by a new assessment.
 */
import { Role, UserType, scoreReadAloud } from "@codeapt/shared";
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
import {
  SpeakingAssessmentModel,
  SpeakingAttemptModel,
} from "../src/models/speaking.model.js";
import { UserModel } from "../src/models/user.model.js";
import * as colleges from "../src/services/college.service.js";
import {
  createCollegeSpeaking,
  getCollegeSpeaking,
} from "../src/services/speaking.service.js";
import { updatePlatformSettings } from "../src/services/platform-settings.service.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

const TEMP_PW = "CodeApt@123";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
let n = 0;

const REFERENCE = "the quick brown fox jumps over the lazy dog";
const AUDIO = "https://res.cloudinary.com/demo/video/upload/take.webm";
const GOOD_FLUENCY = {
  wordCount: 9,
  durationSeconds: 5,
  speechRate: 2,
  pauseCount: 1,
  longestPauseSeconds: 1,
  fillerCount: 0,
  fillerRate: 0,
};

async function makeUser(fields?: {
  role?: string;
  userType?: string;
  college?: Types.ObjectId | null;
}): Promise<{ token: string; userId: string }> {
  n += 1;
  const u = `bs${n}`;
  await request(app).post("/api/auth/register").send({
    username: u,
    email: `${u}@example.com`,
    password: "Password123",
    fullName: `BS ${n}`,
    rollNumber: `BS-${n}`,
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
): Promise<{ collegeId: string; adminToken: string; adminUserId: string }> {
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
  return { collegeId: dto.id, adminToken: admin.token, adminUserId: admin.userId };
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

async function makeAssessment(
  collegeId: string,
  engine: "whisper" | "browser",
): Promise<string> {
  const doc = await SpeakingAssessmentModel.create({
    college: new Types.ObjectId(collegeId),
    topic: null,
    isPublished: true,
    speechEngine: engine,
    title: `Read Aloud — ${engine}`,
    description: "Read the sentence aloud clearly.",
    maxAttempts: 2,
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

async function startAttempt(
  slug: string,
  assessmentId: string,
  token: string,
): Promise<string> {
  const res = await request(app)
    .post(`/api/c/${slug}/speaking/${assessmentId}/attempts`)
    .set(auth(token));
  expect(res.status).toBe(201);
  return res.body.attemptId as string;
}

describe("browser engine — tier 1 (inline scoring)", () => {
  it("scores the Web Speech transcript through the SAME scorers, stores audio, records engine", async () => {
    const { collegeId, adminToken } = await setupCollege("bs-inline");
    const student = await addStudent("bs-inline", adminToken, "bsinline@x.com");
    const assessmentId = await makeAssessment(collegeId, "browser");
    const attemptId = await startAttempt("bs-inline", assessmentId, student.token);

    vi.mocked(enqueueSpeechJob).mockClear();
    const submit = await request(app)
      .post(`/api/c/bs-inline/speaking/attempts/${attemptId}/items/0`)
      .set(auth(student.token))
      .send({ audioUrl: AUDIO, transcript: REFERENCE, fluency: GOOD_FLUENCY });
    expect(submit.status).toBe(202);
    // Scored inline → completed, and NO queue job was enqueued.
    expect(submit.body.status).toBe("completed");
    expect(vi.mocked(enqueueSpeechJob)).not.toHaveBeenCalled();

    const result = await request(app)
      .get(`/api/c/bs-inline/speaking/attempts/${attemptId}/result`)
      .set(auth(student.token));
    expect(result.body.complete).toBe(true);
    const item = result.body.items[0];
    expect(item.engine).toBe("browser");
    expect(item.audioUrl).toBe(AUDIO); // audio stored on the browser path too
    // Identical to a direct scoreReadAloud on the same transcript (no new logic).
    const expected = scoreReadAloud(REFERENCE, REFERENCE, []);
    expect(item.score.wordAccuracy).toBe(expected.wordAccuracy);
    expect(item.score.wordAccuracy).toBe(100);

    // The attempt is fully scored with no worker in the loop.
    const attempt = await SpeakingAttemptModel.findById(attemptId).lean();
    expect(attempt!.status).toBe("scored");
  });

  it("a failed recognition still stores audio + finalizes UNSCORED (re-scorable)", async () => {
    const { collegeId, adminToken } = await setupCollege("bs-fail");
    const student = await addStudent("bs-fail", adminToken, "bsfail@x.com");
    const assessmentId = await makeAssessment(collegeId, "browser");
    const attemptId = await startAttempt("bs-fail", assessmentId, student.token);

    const submit = await request(app)
      .post(`/api/c/bs-fail/speaking/attempts/${attemptId}/items/0`)
      .set(auth(student.token))
      .send({ audioUrl: AUDIO, transcript: "", recognitionFailed: true });
    expect(submit.status).toBe(202);

    const result = await request(app)
      .get(`/api/c/bs-fail/speaking/attempts/${attemptId}/result`)
      .set(auth(student.token));
    const item = result.body.items[0];
    expect(item.engine).toBe("browser");
    expect(item.audioUrl).toBe(AUDIO); // audio kept for tier-2
    expect(item.score).toBeNull(); // NOT scored as a real 0
    expect(item.status).toBe("completed"); // finalized, does not hang
    expect(result.body.complete).toBe(true);
  });
});

describe("whisper engine — unchanged", () => {
  it("still enqueues an async job, stays queued, and withholds the score", async () => {
    const { collegeId, adminToken } = await setupCollege("bs-whisper");
    const student = await addStudent("bs-whisper", adminToken, "bswhisper@x.com");
    const assessmentId = await makeAssessment(collegeId, "whisper");
    const attemptId = await startAttempt("bs-whisper", assessmentId, student.token);

    vi.mocked(enqueueSpeechJob).mockClear();
    const submit = await request(app)
      .post(`/api/c/bs-whisper/speaking/attempts/${attemptId}/items/0`)
      .set(auth(student.token))
      .send({ audioUrl: AUDIO });
    expect(submit.status).toBe(202);
    expect(submit.body.status).toBe("queued"); // async, exactly as before
    expect(vi.mocked(enqueueSpeechJob)).toHaveBeenCalledTimes(1);

    const result = await request(app)
      .get(`/api/c/bs-whisper/speaking/attempts/${attemptId}/result`)
      .set(auth(student.token));
    expect(result.body.items[0].status).toBe("queued");
    expect(result.body.items[0].score).toBeNull();
    expect(result.body.items[0].engine).toBe("whisper");
  });
});

describe("tier 2 — re-score through Whisper", () => {
  async function browserAttemptScored(
    slug: string,
    email: string,
  ): Promise<{ collegeId: string; adminToken: string; assessmentId: string; attemptId: string }> {
    const { collegeId, adminToken } = await setupCollege(slug);
    const student = await addStudent(slug, adminToken, email);
    const assessmentId = await makeAssessment(collegeId, "browser");
    const attemptId = await startAttempt(slug, assessmentId, student.token);
    await request(app)
      .post(`/api/c/${slug}/speaking/attempts/${attemptId}/items/0`)
      .set(auth(student.token))
      .send({ audioUrl: AUDIO, transcript: REFERENCE, fluency: GOOD_FLUENCY });
    return { collegeId, adminToken, assessmentId, attemptId };
  }

  it("per-attempt re-score re-enqueues the stored audio, stamps rescoredAt, is idempotent", async () => {
    const { adminToken, assessmentId, attemptId } = await browserAttemptScored(
      "bs-rescore",
      "bsrescore@x.com",
    );

    vi.mocked(enqueueSpeechJob).mockClear();
    const r1 = await request(app)
      .post(
        `/api/c/bs-rescore/speaking/${assessmentId}/attempts/${attemptId}/rescore`,
      )
      .set(auth(adminToken));
    expect(r1.status).toBe(202);
    expect(r1.body.itemsQueued).toBe(1);
    expect(vi.mocked(enqueueSpeechJob)).toHaveBeenCalledTimes(1);
    // Re-enqueued the STORED audio (the whole point of tier 2 — no retest).
    expect(vi.mocked(enqueueSpeechJob).mock.calls[0]![0].audioUrl).toBe(AUDIO);

    const afterOne = await SpeakingAttemptModel.findById(attemptId).lean();
    expect(afterOne!.rescoredAt).toBeTruthy();
    expect(afterOne!.status).toBe("submitted"); // worker will roll it up
    expect(afterOne!.items[0]!.jobStatus).toBe("queued"); // reset for overwrite

    // Idempotent: running again simply re-queues once more.
    vi.mocked(enqueueSpeechJob).mockClear();
    const r2 = await request(app)
      .post(
        `/api/c/bs-rescore/speaking/${assessmentId}/attempts/${attemptId}/rescore`,
      )
      .set(auth(adminToken));
    expect(r2.status).toBe(202);
    expect(r2.body.itemsQueued).toBe(1);
    expect(vi.mocked(enqueueSpeechJob)).toHaveBeenCalledTimes(1);
  });

  it("cohort re-score fans out over every attempt on the assessment", async () => {
    const { collegeId, adminToken } = await setupCollege("bs-cohort");
    const assessmentId = await makeAssessment(collegeId, "browser");
    const s1 = await addStudent("bs-cohort", adminToken, "bsc1@x.com");
    const s2 = await addStudent("bs-cohort", adminToken, "bsc2@x.com");
    for (const s of [s1, s2]) {
      const attemptId = await startAttempt("bs-cohort", assessmentId, s.token);
      await request(app)
        .post(`/api/c/bs-cohort/speaking/attempts/${attemptId}/items/0`)
        .set(auth(s.token))
        .send({ audioUrl: AUDIO, transcript: REFERENCE, fluency: GOOD_FLUENCY });
    }

    vi.mocked(enqueueSpeechJob).mockClear();
    const res = await request(app)
      .post(`/api/c/bs-cohort/speaking/${assessmentId}/rescore-cohort`)
      .set(auth(adminToken));
    expect(res.status).toBe(202);
    expect(res.body.requeued).toBe(2);
    expect(res.body.itemsQueued).toBe(2);
    expect(vi.mocked(enqueueSpeechJob)).toHaveBeenCalledTimes(2);
  });
});

describe("Communication proctoring — three warnings terminate", () => {
  it("terminates + commits SCORED server-side, count survives reload, further warning idempotent", async () => {
    const { collegeId, adminToken } = await setupCollege("bs-warn");
    const student = await addStudent("bs-warn", adminToken, "bswarn@x.com");
    const assessmentId = await makeAssessment(collegeId, "whisper");
    const attemptId = await startAttempt("bs-warn", assessmentId, student.token);

    const warn = () =>
      request(app)
        .post(`/api/c/bs-warn/speaking/attempts/${attemptId}/warning`)
        .set(auth(student.token));

    const w1 = await warn();
    expect(w1.body).toEqual({ warnings: 1, terminated: false });
    const w2 = await warn();
    expect(w2.body).toEqual({ warnings: 2, terminated: false });
    const w3 = await warn();
    expect(w3.body).toEqual({ warnings: 3, terminated: true });

    // Server-side termination is authoritative — not a client flag. A page refresh
    // (a fresh read) still sees warnings=3 and a terminated, SCORED attempt.
    const persisted = await SpeakingAttemptModel.findById(attemptId).lean();
    expect(persisted!.warnings).toBe(3);
    expect(persisted!.terminated).toBe(true);
    expect(persisted!.status).toBe("scored");

    // A fourth warning after termination is idempotent (no count inflation).
    const w4 = await warn();
    expect(w4.body).toEqual({ warnings: 3, terminated: true });
  });
});

describe("platform default engine", () => {
  it("a new assessment inherits the platform default when the author omits the engine", async () => {
    const { collegeId } = await setupCollege("bs-default");
    await updatePlatformSettings({ defaultSpeechEngine: "browser" });

    const created = await createCollegeSpeaking(collegeId, {
      title: "Inherits default",
      description: "",
      items: [],
      maxAttempts: 1,
    });
    const detail = await getCollegeSpeaking(collegeId, created.id);
    expect(detail.speechEngine).toBe("browser");

    // Restore the platform default so other suites see whisper.
    await updatePlatformSettings({ defaultSpeechEngine: "whisper" });
  });
});
