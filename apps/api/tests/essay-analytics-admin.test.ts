/**
 * Essay-analytics admin — list/filter + per-attempt detail (item 4-ii, read
 * only). supertest + in-memory Mongo. Risk scoring is now WIRED: the API
 * recomputes an ADVISORY risk assessment server-side from the stored compose
 * signals (riskScoring.wired === true) with human-readable reasons — low/zero
 * for benign signals, higher (with reasons) for paste-heavy / low-typing ones.
 * It never affects the grade.
 */
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import {
  EssayAnalyticsModel,
  EssayAttemptModel,
  EssayTopicModel,
} from "../src/models/essay.model.js";

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
  const u = `ean${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Essay Analyst ${counter}`,
      rollNumber: `EAN-${counter}`,
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

describe("essay-analytics admin — list + filter", () => {
  it("lists attempts and filters by topic and status", async () => {
    const { token } = await registerAndLogin("admin");
    const student = await registerAndLogin();
    const uid = new Types.ObjectId(student.userId);

    const topicA = await EssayTopicModel.create({ title: "Analytics Topic A" });
    const topicB = await EssayTopicModel.create({ title: "Analytics Topic B" });

    const attemptA = await EssayAttemptModel.create({
      user: uid,
      essayTopic: topicA._id,
      attemptNumber: 1,
      status: "GRADED",
      finalScore: 80,
      submittedAt: new Date(),
    });
    await EssayAttemptModel.create({
      user: uid,
      essayTopic: topicB._id,
      attemptNumber: 1,
      status: "SUBMITTED",
      finalScore: 0,
    });
    // Store ONLY the real compose signals (exactly what recordAnalytics writes).
    await EssayAnalyticsModel.create({
      attempt: attemptA._id,
      typingEvents: 120,
      deleteEvents: 15,
      pasteEvents: 3,
      pastedChars: 250,
      composeSeconds: 600,
      finalWordCount: 320,
      finalCharacterCount: 1800,
    });

    const all = await request(app)
      .get("/api/admin/essay-analytics")
      .set(auth(token));
    expect(all.status).toBe(200);
    expect(all.body.total).toBeGreaterThanOrEqual(2);

    const byTopic = await request(app)
      .get("/api/admin/essay-analytics")
      .query({ essayTopic: topicA._id.toString() })
      .set(auth(token));
    expect(byTopic.body.total).toBe(1);
    expect(byTopic.body.items[0].topic).toBe("Analytics Topic A");
    expect(byTopic.body.items[0].hasAnalytics).toBe(true);
    expect(byTopic.body.items[0].pasteEvents).toBe(3);
    expect(byTopic.body.items[0].pastedChars).toBe(250);
    expect(byTopic.body.items[0].student).toContain("Essay Analyst");
    // Benign signals → low advisory risk, computed from the stored signals.
    expect(byTopic.body.items[0].riskLevel).toBe("low");
    expect(byTopic.body.items[0].riskScore).toBe(0);
    expect(byTopic.body.items[0].suspicious).toBe(false);

    const byStatus = await request(app)
      .get("/api/admin/essay-analytics")
      .query({ status: "SUBMITTED" })
      .set(auth(token));
    expect(byStatus.body.items.every((a: { status: string }) => a.status === "SUBMITTED")).toBe(true);
    expect(byStatus.body.items.every((a: { hasAnalytics: boolean }) => !a.hasAnalytics)).toBe(true);
  });
});

describe("essay-analytics admin — detail (real signals + advisory risk)", () => {
  it("returns the stored signals and a computed low-risk (wired) assessment for benign signals", async () => {
    const { token } = await registerAndLogin("admin");
    const student = await registerAndLogin();
    const uid = new Types.ObjectId(student.userId);
    const topic = await EssayTopicModel.create({ title: "Detail Topic" });
    const attempt = await EssayAttemptModel.create({
      user: uid,
      essayTopic: topic._id,
      attemptNumber: 1,
      status: "GRADED",
      finalScore: 77,
      wordCount: 320,
      characterCount: 1800,
      submittedAt: new Date(),
    });
    await EssayAnalyticsModel.create({
      attempt: attempt._id,
      typingEvents: 200,
      deleteEvents: 25,
      pasteEvents: 5,
      pastedChars: 410,
      composeSeconds: 900,
      finalWordCount: 320,
      finalCharacterCount: 1800,
      // riskScore / suspiciousActivity deliberately NOT set → schema defaults.
    });

    const res = await request(app)
      .get(`/api/admin/essay-analytics/${attempt._id.toString()}`)
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.topic).toBe("Detail Topic");
    expect(res.body.finalScore).toBe(77);
    expect(res.body.hasAnalytics).toBe(true);
    // Real stored signals surface correctly (typingEvents → keystrokes).
    expect(res.body.signals.keystrokes).toBe(200);
    expect(res.body.signals.deletes).toBe(25);
    expect(res.body.signals.pasteEvents).toBe(5);
    expect(res.body.signals.pastedChars).toBe(410);
    expect(res.body.signals.composeSeconds).toBe(900);
    // Advisory scoring is wired; these benign signals produce a clean low risk.
    expect(res.body.riskScoring.wired).toBe(true);
    expect(res.body.riskScoring.riskScore).toBe(0);
    expect(res.body.riskScoring.level).toBe("low");
    expect(res.body.riskScoring.suspiciousActivity).toBe(false);
    expect(res.body.riskScoring.reasons).toEqual([]);
  });

  it("computes an advisory HIGH risk with reasons for paste-heavy, low-typing signals", async () => {
    const { token } = await registerAndLogin("admin");
    const student = await registerAndLogin();
    const topic = await EssayTopicModel.create({ title: "Suspicious Topic" });
    const attempt = await EssayAttemptModel.create({
      user: new Types.ObjectId(student.userId),
      essayTopic: topic._id,
      attemptNumber: 1,
      status: "GRADED",
      finalScore: 90,
      wordCount: 220,
      characterCount: 1300,
      submittedAt: new Date(),
    });
    // Almost no typing, most of the text pasted across several pastes.
    await EssayAnalyticsModel.create({
      attempt: attempt._id,
      typingEvents: 4,
      deleteEvents: 0,
      pasteEvents: 5,
      pastedChars: 1200,
      composeSeconds: 20,
      finalWordCount: 220,
      finalCharacterCount: 1300,
    });

    const res = await request(app)
      .get(`/api/admin/essay-analytics/${attempt._id.toString()}`)
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.riskScoring.wired).toBe(true);
    expect(res.body.riskScoring.riskScore).toBeGreaterThanOrEqual(80);
    expect(res.body.riskScoring.level).toBe("high");
    expect(res.body.riskScoring.suspiciousActivity).toBe(true);
    expect(res.body.riskScoring.reasons.length).toBeGreaterThan(0);
    // The grade is untouched — risk is advisory only.
    expect(res.body.finalScore).toBe(90);
  });

  it("returns null signals for an attempt without analytics", async () => {
    const { token } = await registerAndLogin("admin");
    const student = await registerAndLogin();
    const topic = await EssayTopicModel.create({ title: "No Analytics Topic" });
    const attempt = await EssayAttemptModel.create({
      user: new Types.ObjectId(student.userId),
      essayTopic: topic._id,
      attemptNumber: 1,
      status: "GRADED",
      finalScore: 60,
    });
    const res = await request(app)
      .get(`/api/admin/essay-analytics/${attempt._id.toString()}`)
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.hasAnalytics).toBe(false);
    expect(res.body.signals).toBeNull();
    // Scoring is wired, but with no signals there is nothing to flag.
    expect(res.body.riskScoring.wired).toBe(true);
    expect(res.body.riskScoring.level).toBe("low");
    expect(res.body.riskScoring.reasons).toEqual([]);
  });

  it("404s an unknown attempt id", async () => {
    const { token } = await registerAndLogin("admin");
    const res = await request(app)
      .get(`/api/admin/essay-analytics/${new Types.ObjectId().toString()}`)
      .set(auth(token));
    expect(res.status).toBe(404);
  });
});

describe("essay-analytics admin — guard", () => {
  it("rejects a non-admin (403)", async () => {
    const { token } = await registerAndLogin();
    const res = await request(app)
      .get("/api/admin/essay-analytics")
      .set(auth(token));
    expect(res.status).toBe(403);
  });
});
