/**
 * Step 33 — scripted END-TO-END that drives a short interview over the real HTTP
 * surface (stubbed LLM) and PRINTS the transcript: each question, the answer, one
 * adaptive follow-up, and the final scored report. It is a real test (assertions
 * at the end) whose console output is the deliverable transcript.
 */
import { Role, UserType, registerLlmRouter } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { UserModel } from "../src/models/user.model.js";
import * as colleges from "../src/services/college.service.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});
afterEach(() => registerLlmRouter(null));

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const TEMP_PW = "CodeApt@123";
let e2eSeq = 0;
const FLUENCY = {
  wordCount: 46,
  durationSeconds: 21,
  speechRate: 2.2,
  pauseCount: 1,
  longestPauseSeconds: 0.5,
  fillerCount: 1,
  fillerRate: 0.021,
};

// Canned answers keyed by a fragment of the question, so the transcript reads well.
const ANSWERS: Record<string, string> = {
  "hardest problem":
    "We had cascading timeouts under load. I traced it to an unbounded connection pool, added back-pressure and a circuit breaker, and p95 latency dropped from 900ms to 300ms.",
  "measure":
    "I measured it with our OpenTelemetry traces and the latency dashboards, comparing the week before and after the change.",
  "index":
    "An index gives the planner an ordered structure so it can seek instead of scanning every row, turning an O(n) scan into a logarithmic lookup for selective predicates.",
};
function answerFor(q: string): string {
  for (const key of Object.keys(ANSWERS)) if (q.toLowerCase().includes(key)) return ANSWERS[key]!;
  return "I approached it methodically, breaking the problem down and validating each step against real data.";
}

function stubRouter(): void {
  registerLlmRouter(async (_s, _u, policy) => {
    switch (policy?.feature) {
      case "interview_analysis":
        return { skills: ["Node.js", "Postgres", "distributed systems"], experience: "3 years backend", gaps: ["Kubernetes"] };
      case "interview_generation":
        return {
          questions: [
            { category: "behavioural", text: "Tell me about the hardest problem you solved recently." },
            { category: "technical", text: "How does a database index speed up a query?" },
          ],
        };
      case "interview_followup":
        return { followUp: "By how much, and how did you measure the improvement?" };
      case "interview_grading":
        return {
          concept: 84,
          analysis: 80,
          topicKnowledge: 82,
          relevance: 88,
          star: 79,
          feedback: "Strong, concrete answer with a measured outcome.",
        };
      default:
        return null;
    }
  });
}

describe("mock interview — end-to-end transcript", () => {
  it("prints a short interview: questions, answers, a follow-up, and the report", async () => {
    stubRouter();
    // College + student.
    const platform = await makeUser({ role: Role.SUPER_ADMIN });
    const dto = await colleges.createCollege({ name: "e2e", slug: "mi-e2e" }, platform.userId);
    await colleges.setEntitlements(dto.id, { features: { interview: true } });
    await colleges.setEntitlements(dto.id, { subCapabilities: { "interview.interview": true } });
    const admin = await makeUser({ role: Role.COLLEGE_ADMIN, userType: UserType.COLLEGE, college: new Types.ObjectId(dto.id) });
    const unit = await request(app).post(`/api/c/mi-e2e/org-units`).set(auth(admin.token)).send({ type: "department", name: "D" });
    const created = await request(app).post(`/api/c/mi-e2e/students`).set(auth(admin.token)).send({ fullName: "Asha", email: "asha@x.com", rollNumber: "R1", orgUnitId: unit.body.id });
    await UserModel.updateOne({ _id: created.body.id }, { $set: { forcePasswordChange: false } });
    const login = await request(app).post("/api/auth/login").send({ identifier: "asha@x.com", password: TEMP_PW });
    const token = login.body.accessToken as string;

    // Author + publish (cap follow-ups at 1 for a clean single probe).
    const iv = await request(app).post(`/api/c/mi-e2e/interviews`).set(auth(admin.token)).send({
      title: "Backend mock interview",
      role: "Backend Engineer",
      seniority: "mid",
      durationMinutes: 30,
      maxAttempts: 1,
      plan: { behaviouralCount: 1, technicalCount: 1, maxFollowUpsPerAnswer: 1, maxFollowUpsPerSession: 1 },
    });
    const id = iv.body.id as string;
    await request(app).post(`/api/c/mi-e2e/interviews/${id}/publish`).set(auth(admin.token)).send({ isPublished: true });

    const out: string[] = [];
    out.push("════════════════════════════════════════════════════════════");
    out.push("  AI MOCK INTERVIEW — Backend Engineer (mid)");
    out.push("════════════════════════════════════════════════════════════");

    const start = await request(app).post(`/api/c/mi-e2e/interviews/${id}/attempts`).set(auth(token)).send({
      resumeText: "Backend engineer, 3 years on Node.js + Postgres. Led a monolith-to-services migration.",
      jobDescription: "Backend engineer strong in Node, Postgres and distributed systems.",
    });
    const attemptId = start.body.attemptId as string;
    out.push(`  questions ${start.body.aiGenerated ? "generated by the LLM" : "from the fallback bank"}\n`);

    let turnNo = 0;
    for (let i = 0; i < 12; i += 1) {
      const cur = await request(app).get(`/api/c/mi-e2e/interviews/attempts/${attemptId}/current`).set(auth(token));
      if (cur.body.status === "scored" || cur.body.expired || !cur.body.turn) break;
      const t = cur.body.turn;
      turnNo += 1;
      const tag = t.isFollowUp ? "  ↳ FOLLOW-UP" : `  Q${turnNo} [${t.category}]`;
      out.push(`${tag}  ${t.question}`);
      const ans = answerFor(t.question);
      out.push(`     A: ${ans}\n`);
      await request(app)
        .post(`/api/c/mi-e2e/interviews/attempts/${attemptId}/answers/${cur.body.currentIndex}`)
        .set(auth(token))
        .send({ audioUrl: "https://res.cloudinary.com/demo/video/upload/a.webm", transcript: ans, fluency: FLUENCY, latencySeconds: 2 });
    }

    const res = await request(app).get(`/api/c/mi-e2e/interviews/attempts/${attemptId}/result`).set(auth(token));
    const d = res.body.dimensions as Record<string, number | null>;
    out.push("────────────────────────────────────────────────────────────");
    out.push("  REPORT");
    out.push("────────────────────────────────────────────────────────────");
    out.push(`  Overall: ${res.body.overall}/100   (source: ${res.body.source})`);
    out.push(`  speaking=${d.speaking}  vocabulary=${d.vocabulary}  concept=${d.concept}  analysis=${d.analysis}  topicKnowledge=${d.topicKnowledge}`);
    out.push(`  ${res.body.summary}`);
    out.push("  Per-question:");
    for (const q of res.body.perQuestion as Array<Record<string, unknown>>) {
      out.push(`   - ${q.isFollowUp ? "(follow-up) " : ""}${String(q.question).slice(0, 60)}…  ${q.feedback ? `— ${q.feedback}` : ""}`);
    }
    out.push("════════════════════════════════════════════════════════════");
    console.log("\n" + out.join("\n") + "\n");

    expect(res.body.status).toBe("scored");
    expect(res.body.source).toBe("ai_hybrid");
    expect(typeof res.body.overall).toBe("number");
  });

  async function makeUser(fields?: { role?: string; userType?: string; college?: Types.ObjectId | null }): Promise<{ token: string; userId: string }> {
    e2eSeq += 1;
    const u = `e2eusr${e2eSeq}`;
    await request(app).post("/api/auth/register").send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `E2E`,
      rollNumber: `E2E-${u}`,
      collegeName: "Acme",
      phoneNumber: "9999999999",
      state: "KA",
    });
    const res = await request(app).post("/api/auth/login").send({ identifier: u, password: "Password123" });
    const userId = res.body.user.id as string;
    if (fields) await UserModel.updateOne({ _id: userId }, { $set: fields });
    return { token: res.body.accessToken as string, userId };
  }
});
