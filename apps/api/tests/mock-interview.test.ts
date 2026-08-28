/**
 * AI Mock Interview (Step 33) — API tests. The LLM gateway seam is stubbed via
 * `registerLlmRouter` (branching on policy.feature); with no router it returns
 * null and the module degrades. Covers: the full attempt lifecycle with AI; resume
 * intake stubbed AND unavailable (fallback bank, still completes); adaptive
 * follow-up capping; the access matrix across all three tenancy shapes; and the
 * operator cohort report + xlsx. The interview scores INLINE (browser-STT + LLM),
 * so no queue/worker is involved.
 */
import { Role, TopicType, UserType, registerLlmRouter } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import {
  EnrollmentModel,
  ModuleModel,
  SubjectModel,
  TopicModel,
} from "../src/models/curriculum.model.js";
import { CollegeModel } from "../src/models/college.model.js";
import { MockInterviewModel } from "../src/models/mock-interview.model.js";
import { UserModel } from "../src/models/user.model.js";
import * as colleges from "../src/services/college.service.js";

/** Grant a college N mock-interview credits (Step 38 quota). */
async function grantInterviewCredits(collegeId: string, n: number): Promise<void> {
  await CollegeModel.updateOne(
    { _id: new Types.ObjectId(collegeId) },
    { $set: { "credits.interviewCredits": n } },
  );
}

let app: Express;
beforeAll(() => {
  app = createApp();
});
afterEach(() => registerLlmRouter(null));

const TEMP_PW = "CodeApt@123";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
let n = 0;

const FLUENCY = {
  wordCount: 45,
  durationSeconds: 22,
  speechRate: 2,
  pauseCount: 1,
  longestPauseSeconds: 0.6,
  fillerCount: 1,
  fillerRate: 0.022,
};
const ANSWER =
  "I led the migration of our monolith to services, cutting p95 latency by forty percent, measured with our tracing dashboards before and after.";

/** Stub the LLM to return usable JSON per feature (the "AI available" path). */
function goodRouter(): void {
  registerLlmRouter(async (_s, _u, policy) => {
    switch (policy?.feature) {
      case "interview_analysis":
        return { skills: ["node", "react"], experience: "3 years backend", gaps: ["k8s"] };
      case "interview_generation":
        return {
          questions: [
            { category: "behavioural", text: "Tell me about a hard problem you solved." },
            { category: "technical", text: "How does a database index speed a query?" },
          ],
        };
      case "interview_followup":
        return { followUp: "By how much, and how did you measure it?" };
      case "interview_grading":
        return {
          concept: 82,
          analysis: 78,
          topicKnowledge: 80,
          relevance: 85,
          star: 75,
          feedback: "Clear structure; quantify the impact next time.",
        };
      default:
        return null;
    }
  });
}

async function makeUser(fields?: {
  role?: string;
  userType?: string;
  college?: Types.ObjectId | null;
}): Promise<{ token: string; userId: string }> {
  n += 1;
  const u = `mi${n}`;
  await request(app).post("/api/auth/register").send({
    username: u,
    email: `${u}@example.com`,
    password: "Password123",
    fullName: `MI ${n}`,
    rollNumber: `MI-${n}`,
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

async function setupCollege(slug: string): Promise<{ collegeId: string; adminToken: string }> {
  const platform = await makeUser({ role: Role.SUPER_ADMIN });
  const dto = await colleges.createCollege({ name: slug, slug }, platform.userId);
  await colleges.setEntitlements(dto.id, { features: { interview: true } });
  await colleges.setEntitlements(dto.id, { subCapabilities: { "interview.interview": true } });
  await grantInterviewCredits(dto.id, 100); // generous default so start tests pass
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

const PLAN = {
  behaviouralCount: 1,
  technicalCount: 1,
  maxFollowUpsPerAnswer: 1,
  maxFollowUpsPerSession: 4,
};
function upsertBody(over: Record<string, unknown> = {}) {
  return {
    title: "Backend mock interview",
    role: "Backend Engineer",
    seniority: "mid",
    durationMinutes: 30,
    maxAttempts: 2,
    plan: PLAN,
    ...over,
  };
}

/** Create + publish a tenant interview; return its id. */
async function makeCollegeInterview(
  slug: string,
  adminToken: string,
  over: Record<string, unknown> = {},
): Promise<string> {
  const created = await request(app)
    .post(`/api/c/${slug}/interviews`)
    .set(auth(adminToken))
    .send(upsertBody(over));
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  const pub = await request(app)
    .post(`/api/c/${slug}/interviews/${id}/publish`)
    .set(auth(adminToken))
    .send({ isPublished: true });
  expect(pub.status).toBe(200);
  return id;
}

const START_BODY = {
  resumeText:
    "Backend engineer with 3 years on Node.js and Postgres. Led a monolith-to-services migration.",
  jobDescription: "We need a backend engineer strong in Node, Postgres and distributed systems.",
};

/** Run an interview to completion on the college surface; return the result body. */
async function completeCollegeInterview(
  slug: string,
  interviewId: string,
  token: string,
): Promise<{ attemptId: string; followUps: number; result: Record<string, unknown> }> {
  const start = await request(app)
    .post(`/api/c/${slug}/interviews/${interviewId}/attempts`)
    .set(auth(token))
    .send(START_BODY);
  expect(start.status).toBe(201);
  const attemptId = start.body.attemptId as string;

  let followUps = 0;
  for (let i = 0; i < 20; i += 1) {
    const cur = await request(app)
      .get(`/api/c/${slug}/interviews/attempts/${attemptId}/current`)
      .set(auth(token));
    if (cur.body.status === "scored" || cur.body.expired || !cur.body.turn) break;
    const idx = cur.body.currentIndex as number;
    const sub = await request(app)
      .post(`/api/c/${slug}/interviews/attempts/${attemptId}/answers/${idx}`)
      .set(auth(token))
      .send({ audioUrl: "https://res.cloudinary.com/demo/video/upload/a.webm", transcript: ANSWER, fluency: FLUENCY, latencySeconds: 2 });
    expect(sub.status).toBe(202);
    if (sub.body.followUpAdded) followUps += 1;
  }
  const result = await request(app)
    .get(`/api/c/${slug}/interviews/attempts/${attemptId}/result`)
    .set(auth(token));
  return { attemptId, followUps, result: result.body };
}

describe("lifecycle — AI available", () => {
  it("generates questions, scores each answer, and produces an ai_hybrid report", async () => {
    goodRouter();
    const { collegeId: _c, adminToken } = await setupCollege("mi-life");
    void _c;
    const student = await addStudent("mi-life", adminToken, "milife@x.com");
    const id = await makeCollegeInterview("mi-life", adminToken);

    const start = await request(app)
      .post(`/api/c/mi-life/interviews/${id}/attempts`)
      .set(auth(student.token))
      .send(START_BODY);
    expect(start.status).toBe(201);
    expect(start.body.aiGenerated).toBe(true);
    expect(start.body.turn.question).toContain("hard problem");
    expect(start.body.totalTurns).toBe(2); // 2 generated main questions

    const { result, followUps } = await completeCollegeInterview("mi-life", id, student.token);
    expect(followUps).toBeGreaterThan(0); // at least one adaptive probe fired
    expect(result.status).toBe("scored");
    expect(result.complete).toBe(true);
    expect(result.source).toBe("ai_hybrid");
    expect(result.approximate).toBe(true);
    // Every answer graded concept:82 → the aggregated dimension is 82.
    expect((result.dimensions as { concept: number }).concept).toBe(82);
    expect(typeof result.overall).toBe("number");
    // Per-question feedback present + audio stored on answered turns.
    const answered = (result.perQuestion as Array<Record<string, unknown>>).filter((q) => q.answered);
    expect(answered.length).toBeGreaterThan(0);
    expect(answered[0]!.feedback).toBeTruthy();
    expect(answered[0]!.audioUrl).toBeTruthy();
  });
});

describe("degrade — AI unavailable", () => {
  it("falls back to a role-based bank and still completes with a deterministic report", async () => {
    registerLlmRouter(null); // no LLM at all
    const { adminToken } = await setupCollege("mi-degrade");
    const student = await addStudent("mi-degrade", adminToken, "mideg@x.com");
    const id = await makeCollegeInterview("mi-degrade", adminToken);

    const start = await request(app)
      .post(`/api/c/mi-degrade/interviews/${id}/attempts`)
      .set(auth(student.token))
      .send(START_BODY);
    expect(start.status).toBe(201);
    expect(start.body.aiGenerated).toBe(false); // fallback bank
    expect(start.body.totalTurns).toBe(2); // behavioural + technical fallback

    const { result, followUps } = await completeCollegeInterview("mi-degrade", id, student.token);
    expect(followUps).toBe(0); // no LLM → no follow-ups
    expect(result.status).toBe("scored");
    expect(result.source).toBe("deterministic_floor");
    expect(result.approximate).toBe(false);
    const dims = result.dimensions as Record<string, number | null>;
    expect(dims.speaking).toBeGreaterThan(0);
    expect(dims.vocabulary).toBeGreaterThan(0);
    expect(dims.concept).toBeNull(); // AI dimensions reweighted out
    expect(typeof result.overall).toBe("number"); // still a real score
  });
});

describe("interview credits (Step 38 — 1 credit = 1 interview started)", () => {
  it("blocks the start with NO_CREDITS when the college has none; status reflects it", async () => {
    goodRouter();
    const { collegeId, adminToken } = await setupCollege("mi-cred0");
    await grantInterviewCredits(collegeId, 0);
    const student = await addStudent("mi-cred0", adminToken, "c0@x.com");
    const id = await makeCollegeInterview("mi-cred0", adminToken);

    const res = await request(app)
      .post(`/api/c/mi-cred0/interviews/${id}/attempts`)
      .set(auth(student.token))
      .send(START_BODY);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NO_CREDITS");

    const st = await request(app)
      .get(`/api/c/mi-cred0/interviews/credits`)
      .set(auth(adminToken));
    expect(st.status).toBe(200);
    expect(st.body).toMatchObject({ granted: 0, used: 0, remaining: 0 });
  });

  it("allows exactly the granted number of interviews, then blocks (used counts each start)", async () => {
    goodRouter();
    const { collegeId, adminToken } = await setupCollege("mi-cred2");
    await grantInterviewCredits(collegeId, 2);
    const student = await addStudent("mi-cred2", adminToken, "c2@x.com");
    // maxAttempts 0 = unlimited per-user, so the COLLEGE credit is the only cap.
    const id = await makeCollegeInterview("mi-cred2", adminToken, { maxAttempts: 0 });

    const start = () =>
      request(app)
        .post(`/api/c/mi-cred2/interviews/${id}/attempts`)
        .set(auth(student.token))
        .send(START_BODY);

    expect((await start()).status).toBe(201); // 1st
    expect((await start()).status).toBe(201); // 2nd
    const third = await start();
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe("NO_CREDITS");

    const st = await request(app)
      .get(`/api/c/mi-cred2/interviews/credits`)
      .set(auth(adminToken));
    expect(st.body).toMatchObject({ granted: 2, used: 2, remaining: 0 });
  });

  it("the credits readout endpoint is operator-only (a student can't read it)", async () => {
    goodRouter();
    const { adminToken } = await setupCollege("mi-credr");
    const student = await addStudent("mi-credr", adminToken, "cr@x.com");
    const res = await request(app)
      .get(`/api/c/mi-credr/interviews/credits`)
      .set(auth(student.token));
    expect(res.status).toBe(403);
  });
});

describe("adaptive follow-up capping", () => {
  it("never exceeds the per-session cap even when the LLM always offers a probe", async () => {
    goodRouter();
    const { adminToken } = await setupCollege("mi-cap");
    const student = await addStudent("mi-cap", adminToken, "micap@x.com");
    const id = await makeCollegeInterview("mi-cap", adminToken, {
      plan: { ...PLAN, maxFollowUpsPerAnswer: 1, maxFollowUpsPerSession: 1 },
    });
    const { followUps } = await completeCollegeInterview("mi-cap", id, student.token);
    expect(followUps).toBe(1); // session cap honoured despite an always-on probe
  });
});

describe("access matrix — the three shapes", () => {
  it("TENANT: a member starts; an outsider 404s", async () => {
    goodRouter();
    const { adminToken } = await setupCollege("mi-acc");
    const student = await addStudent("mi-acc", adminToken, "miacc@x.com");
    const id = await makeCollegeInterview("mi-acc", adminToken);
    const ok = await request(app)
      .post(`/api/c/mi-acc/interviews/${id}/attempts`)
      .set(auth(student.token))
      .send(START_BODY);
    expect(ok.status).toBe(201);

    // A different college's student cannot see it (open route → access matrix 404).
    const outsider = await makeUser();
    const denied = await request(app)
      .post(`/api/interviews/${id}/attempts`)
      .set(auth(outsider.token))
      .send(START_BODY);
    expect(denied.status).toBe(404);
  });

  it("COURSE-ATTACHED: reachable by a B2C learner via enrollment, NO feature flag", async () => {
    goodRouter();
    const platform = await makeUser({ role: Role.SUPER_ADMIN });
    const subject = await SubjectModel.create({ name: "Interviews", slug: `iv-${n}-${Date.now()}` });
    const mod = await ModuleModel.create({ subject: subject._id, name: "Practice", order: 0 });
    const topic = await TopicModel.create({
      module: mod._id,
      name: "Mock interview",
      topicType: TopicType.MOCK_INTERVIEW,
      order: 0,
    });
    // Platform admin authors a course-attached interview + publishes it.
    const created = await request(app)
      .post(`/api/admin/interviews`)
      .set(auth(platform.token))
      .send(upsertBody({ topicId: topic._id.toString() }));
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    await request(app)
      .post(`/api/admin/interviews/${id}/publish`)
      .set(auth(platform.token))
      .send({ isPublished: true });

    const learner = await makeUser();
    // Not enrolled → 404.
    const denied = await request(app)
      .post(`/api/interviews/${id}/attempts`)
      .set(auth(learner.token))
      .send(START_BODY);
    expect(denied.status).toBe(404);
    // Enroll → reachable, no feature flag anywhere.
    await EnrollmentModel.create({ user: new Types.ObjectId(learner.userId), subject: subject._id });
    const ok = await request(app)
      .post(`/api/interviews/${id}/attempts`)
      .set(auth(learner.token))
      .send(START_BODY);
    expect(ok.status).toBe(201);
  });

  it("PLATFORM-INTERNAL: only a platform admin can start", async () => {
    goodRouter();
    const platform = await makeUser({ role: Role.SUPER_ADMIN });
    const created = await request(app)
      .post(`/api/admin/interviews`)
      .set(auth(platform.token))
      .send(upsertBody());
    const id = created.body.id as string;
    await request(app)
      .post(`/api/admin/interviews/${id}/publish`)
      .set(auth(platform.token))
      .send({ isPublished: true });

    const outsider = await makeUser();
    const denied = await request(app)
      .post(`/api/interviews/${id}/attempts`)
      .set(auth(outsider.token))
      .send(START_BODY);
    expect(denied.status).toBe(404);
    const ok = await request(app)
      .post(`/api/interviews/${id}/attempts`)
      .set(auth(platform.token))
      .send(START_BODY);
    expect(ok.status).toBe(201);
  });
});

describe("attempt cap + operator cohort report", () => {
  it("enforces the cap and reports the cohort with an xlsx export", async () => {
    goodRouter();
    const { adminToken } = await setupCollege("mi-cohort");
    const id = await makeCollegeInterview("mi-cohort", adminToken, { maxAttempts: 1 });
    const s1 = await addStudent("mi-cohort", adminToken, "mic1@x.com");
    const s2 = await addStudent("mi-cohort", adminToken, "mic2@x.com");
    await completeCollegeInterview("mi-cohort", id, s1.token);
    await completeCollegeInterview("mi-cohort", id, s2.token);

    // Cap = 1 → a second start is refused.
    const again = await request(app)
      .post(`/api/c/mi-cohort/interviews/${id}/attempts`)
      .set(auth(s1.token))
      .send(START_BODY);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ATTEMPT_LIMIT_REACHED");

    const cohort = await request(app)
      .get(`/api/c/mi-cohort/interviews/${id}/cohort`)
      .set(auth(adminToken));
    expect(cohort.status).toBe(200);
    expect(cohort.body.rows).toHaveLength(2);
    expect(typeof cohort.body.rows[0].bestOverall).toBe("number");

    const xlsx = await request(app)
      .get(`/api/c/mi-cohort/interviews/${id}/cohort/export`)
      .set(auth(adminToken));
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers["content-type"]).toContain("spreadsheetml");
  });
});

describe("publish gate", () => {
  it("refuses to publish an interview with no questions", async () => {
    const { adminToken } = await setupCollege("mi-pub");
    const created = await request(app)
      .post(`/api/c/mi-pub/interviews`)
      .set(auth(adminToken))
      .send(upsertBody({ plan: { behaviouralCount: 0, technicalCount: 0, maxFollowUpsPerAnswer: 0, maxFollowUpsPerSession: 0 }, seedQuestions: [] }));
    const id = created.body.id as string;
    const pub = await request(app)
      .post(`/api/c/mi-pub/interviews/${id}/publish`)
      .set(auth(adminToken))
      .send({ isPublished: true });
    expect(pub.status).toBe(409);
    expect(pub.body.error.code).toBe("NOT_PUBLISHABLE");
    // Housekeeping — the model exists (silences unused import warnings on some setups).
    expect(await MockInterviewModel.findById(id)).not.toBeNull();
  });
});
