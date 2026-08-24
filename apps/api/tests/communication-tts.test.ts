/**
 * Step 19 Part A — authoring-time TTS endpoint (POST /c/:slug/speaking/tts). The
 * server-side Piper call (asr-tts) and the Cloudinary upload are MOCKED at their
 * module boundary (the real Piper container + Cloudinary run only in deployment,
 * exactly like faster-whisper is mocked in the worker suite). Asserts: auth +
 * entitlement gating, that a FIXED voice id/version is recorded on the item, and
 * that a generated clip is INDISTINGUISHABLE downstream from an uploaded one (the
 * student view carries only promptAudioUrl — no voice fields).
 */
import { Role, UserType } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

import type * as AsrTtsModule from "../src/lib/asr-tts.js";
import type * as CloudinaryModule from "../src/lib/cloudinary.js";

vi.mock("../src/lib/execution-queue.js", () => ({
  enqueueSpeechJob: vi.fn(async () => undefined),
  closeQueues: vi.fn(async () => undefined),
  knownQueues: [],
}));

// The two external boundaries — mocked so the wiring is testable without a Piper
// container or real Cloudinary. synthesizePrompt returns a fixed voice; the
// server-side upload returns a canned hosted URL.
vi.mock("../src/lib/asr-tts.js", async (importOriginal) => {
  const actual = await importOriginal<typeof AsrTtsModule>();
  return {
    ...actual,
    synthesizePrompt: vi.fn(async () => ({
      bytes: actual.cannedSilentWav(),
      voiceId: "en_US-amy-medium",
      voiceVersion: "piper-voices-v1.0.0/amy-medium",
    })),
  };
});
vi.mock("../src/lib/cloudinary.js", async (importOriginal) => {
  const actual = await importOriginal<typeof CloudinaryModule>();
  return {
    ...actual,
    uploadBufferToCloudinary: vi.fn(async () => "https://cdn.test/tts/prompt.wav"),
  };
});

import { createApp } from "../src/app.js";
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
  const u = `tts${n}`;
  await request(app).post("/api/auth/register").send({
    username: u,
    email: `${u}@example.com`,
    password: "Password123",
    fullName: `TTS ${n}`,
    rollNumber: `TTS-${n}`,
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
  opts: { communication?: boolean; speaking?: boolean } = {},
): Promise<{ collegeId: string; adminToken: string }> {
  const platform = await makeUser({ role: Role.SUPER_ADMIN });
  const dto = await colleges.createCollege({ name: slug, slug }, platform.userId);
  if (opts.communication ?? true) {
    await colleges.setEntitlements(dto.id, { features: { communication: true } });
  }
  if (opts.speaking ?? true) {
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
): Promise<{ id: string; token: string; orgUnitId: string }> {
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
  return { id, token: login.body.accessToken as string, orgUnitId: unit.body.id };
}

const ttsUrl = (slug: string) => `/api/c/${slug}/speaking/tts`;

describe("speaking TTS endpoint — gating", () => {
  it("a FACULTY on a fully-entitled college gets a hosted clip + a pinned voice", async () => {
    const sc = await setupCollege("tts-ok");
    const res = await request(app)
      .post(ttsUrl("tts-ok"))
      .set(auth(sc.adminToken))
      .send({ text: "Read the following sentence aloud." });
    expect(res.status).toBe(200);
    expect(res.body.audioUrl).toBe("https://cdn.test/tts/prompt.wav");
    expect(res.body.voiceId).toBe("en_US-amy-medium");
    expect(res.body.voiceVersion).toBe("piper-voices-v1.0.0/amy-medium");
  });

  it("a STUDENT (not faculty) is refused (403)", async () => {
    const sc = await setupCollege("tts-student");
    const student = await addStudent("tts-student", sc.adminToken, "s@tts.test");
    const res = await request(app)
      .post(ttsUrl("tts-student"))
      .set(auth(student.token))
      .send({ text: "hello" });
    expect(res.status).toBe(403);
  });

  it("a college WITHOUT the communication feature is refused (403)", async () => {
    const sc = await setupCollege("tts-nofeat", { communication: false, speaking: false });
    const res = await request(app)
      .post(ttsUrl("tts-nofeat"))
      .set(auth(sc.adminToken))
      .send({ text: "hello" });
    expect(res.status).toBe(403);
  });

  it("a college WITHOUT the speaking sub-capability is refused (403)", async () => {
    const sc = await setupCollege("tts-nosub", { communication: true, speaking: false });
    const res = await request(app)
      .post(ttsUrl("tts-nosub"))
      .set(auth(sc.adminToken))
      .send({ text: "hello" });
    expect(res.status).toBe(403);
  });

  it("rejects empty text (400)", async () => {
    const sc = await setupCollege("tts-empty");
    const res = await request(app)
      .post(ttsUrl("tts-empty"))
      .set(auth(sc.adminToken))
      .send({ text: "   " });
    expect(res.status).toBe(400);
  });
});

describe("speaking TTS — voice pinned + indistinguishable downstream", () => {
  it("records the voice on the item (author sees it), but the student view carries only the URL", async () => {
    const sc = await setupCollege("tts-flow");
    const student = await addStudent("tts-flow", sc.adminToken, "learner@tts.test");

    // 1. Generate a clip.
    const tts = await request(app)
      .post(ttsUrl("tts-flow"))
      .set(auth(sc.adminToken))
      .send({ text: "Repeat: the bright red fox." });
    expect(tts.status).toBe(200);

    // 2. Author an assessment whose repeat item pins the generated clip + voice.
    const created = await request(app)
      .post(`/api/c/tts-flow/speaking`)
      .set(auth(sc.adminToken))
      .send({
        title: "TTS repeat paper",
        items: [
          {
            itemType: "repeat",
            referenceText: "the bright red fox",
            promptAudioUrl: tts.body.audioUrl,
            promptAudioVoiceId: tts.body.voiceId,
            promptAudioVoiceVersion: tts.body.voiceVersion,
            responseWindowSeconds: 20,
          },
        ],
      });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    // 3. Author DETAIL surfaces the provenance (voice id/version recorded).
    const detail = await request(app)
      .get(`/api/c/tts-flow/speaking/${id}`)
      .set(auth(sc.adminToken));
    expect(detail.body.items[0].promptAudioUrl).toBe(tts.body.audioUrl);
    expect(detail.body.items[0].promptAudioVoiceId).toBe("en_US-amy-medium");
    expect(detail.body.items[0].promptAudioVoiceVersion).toBe(
      "piper-voices-v1.0.0/amy-medium",
    );

    // 4. Publish, then the STUDENT view carries the URL but NO voice fields — a
    //    generated clip is indistinguishable downstream from an uploaded one.
    await request(app)
      .post(`/api/c/tts-flow/speaking/${id}/publish`)
      .set(auth(sc.adminToken))
      .send({ isPublished: true });
    const start = await request(app)
      .post(`/api/c/tts-flow/speaking/${id}/attempts`)
      .set(auth(student.token));
    expect(start.status).toBe(201);
    const item = start.body.item;
    expect(item.promptAudioUrl).toBe(tts.body.audioUrl);
    expect("promptAudioVoiceId" in item).toBe(false);
    expect("promptAudioVoiceVersion" in item).toBe(false);
  });

  it("STIMULUS audio has the same voice pinning, and its text + voice are withheld from the student view", async () => {
    const sc = await setupCollege("tts-stim");
    const student = await addStudent("tts-stim", sc.adminToken, "s2@tts.test");
    const tts = await request(app)
      .post(ttsUrl("tts-stim"))
      .set(auth(sc.adminToken))
      .send({ text: "Two friends plan to meet at the library after lunch." });
    expect(tts.status).toBe(200);

    const created = await request(app)
      .post(`/api/c/tts-stim/speaking`)
      .set(auth(sc.adminToken))
      .send({
        title: "TTS stimulus paper",
        items: [
          {
            itemType: "conversation",
            promptText: "Where do they plan to meet?",
            answerSet: ["the library", "library"],
            stimulusAudioUrl: tts.body.audioUrl,
            stimulusText: "Two friends plan to meet at the library after lunch.",
            stimulusAudioVoiceId: tts.body.voiceId,
            stimulusAudioVoiceVersion: tts.body.voiceVersion,
            responseWindowSeconds: 20,
          },
        ],
      });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    // Author DETAIL records the stimulus source text + pinned voice.
    const detail = await request(app)
      .get(`/api/c/tts-stim/speaking/${id}`)
      .set(auth(sc.adminToken));
    expect(detail.body.items[0].stimulusAudioUrl).toBe(tts.body.audioUrl);
    expect(detail.body.items[0].stimulusText).toContain("library");
    expect(detail.body.items[0].stimulusAudioVoiceId).toBe("en_US-amy-medium");

    // Student VIEW: hears the stimulus (URL) but never SEES its text or the voice.
    await request(app)
      .post(`/api/c/tts-stim/speaking/${id}/publish`)
      .set(auth(sc.adminToken))
      .send({ isPublished: true });
    const start = await request(app)
      .post(`/api/c/tts-stim/speaking/${id}/attempts`)
      .set(auth(student.token));
    const item = start.body.item;
    expect(item.stimulusAudioUrl).toBe(tts.body.audioUrl);
    expect("stimulusText" in item).toBe(false);
    expect("stimulusAudioVoiceId" in item).toBe(false);
  });
});
