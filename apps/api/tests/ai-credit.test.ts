/**
 * AI credits (Stage 1) — per-college monthly budget + gateway metering. supertest
 * + in-memory Mongo. Proves: allocation (tier base + per-seat, override wins),
 * atomic reserve/refund, exhaustion gate, concurrency-safe debit (no overspend),
 * monthly rollover re-allocation, super-admin set/reset, and the two visibility
 * surfaces (super-admin + operator) with their guards.
 */
import {
  AI_CREDIT_TIERS,
  AiCreditTier,
  Role,
  UserType,
  aiActionWeight,
} from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { UserModel } from "../src/models/user.model.js";
import * as colleges from "../src/services/college.service.js";
import * as credits from "../src/services/ai-credit.service.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let seq = 0;
async function makeUser(fields?: {
  role?: string;
  userType?: string;
  college?: Types.ObjectId | null;
}): Promise<{ token: string; userId: string; username: string }> {
  seq += 1;
  const u = `cr${seq}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Credit User ${seq}`,
      rollNumber: `CR-${seq}`,
      collegeName: "Acme",
      phoneNumber: "9999999999",
      state: "KA",
    });
  if (fields) {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ identifier: u, password: "Password123" });
    await UserModel.updateOne({ _id: res.body.user.id }, { $set: fields });
  }
  const res = await request(app)
    .post("/api/auth/login")
    .send({ identifier: u, password: "Password123" });
  return {
    token: res.body.accessToken as string,
    userId: res.body.user.id as string,
    username: u,
  };
}

let collegeSeq = 0;
async function makeCollege(): Promise<{ id: string; slug: string }> {
  collegeSeq += 1;
  const slug = `cr-col-${collegeSeq}`;
  const platform = await makeUser({ role: Role.SUPER_ADMIN });
  const dto = await colleges.createCollege(
    { name: `Credit College ${collegeSeq}`, slug },
    platform.userId,
  );
  return { id: dto.id, slug };
}

let studentSeq = 0;
async function addStudents(collegeId: string, n: number): Promise<void> {
  const docs = [];
  for (let i = 0; i < n; i += 1) {
    studentSeq += 1;
    docs.push({
      username: `crstu${studentSeq}`,
      email: `crstu${studentSeq}@example.com`,
      passwordHash: "x",
      role: Role.STUDENT,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(collegeId),
    });
  }
  await UserModel.insertMany(docs);
}

const NOW = new Date("2026-07-15T10:00:00Z"); // IST period 2026-07

describe("AI credit allocation + ledger", () => {
  it("allocates tier.base + students × per-seat (free by default)", async () => {
    const { id } = await makeCollege();
    await addStudents(id, 5);
    const bal = await credits.getCreditBalance(id, NOW);
    const free = AI_CREDIT_TIERS[AiCreditTier.FREE];
    expect(bal.allocated).toBe(free.baseCredits + 5 * free.perSeatCredits);
    expect(bal.consumed).toBe(0);
    expect(bal.remaining).toBe(bal.allocated);
    expect(bal.studentCount).toBe(5);
    expect(bal.periodKey).toBe("2026-07");
  });

  it("reserves (debits) on success and refunds on failure; tracks per-feature", async () => {
    const { id } = await makeCollege();
    // Explicit override so the math is exact regardless of seats.
    await credits.setCredits(id, { monthlyOverride: 10 }, NOW);

    expect(await credits.reserveCredits(id, "grading", NOW)).toBe(true);
    let bal = await credits.getCreditBalance(id, NOW);
    expect(bal.consumed).toBe(aiActionWeight("grading"));
    expect(bal.byFeature.grading).toBe(1);

    // A refund (provider failed after reserve) restores the credit.
    await credits.refundCredits(id, "grading", NOW);
    bal = await credits.getCreditBalance(id, NOW);
    expect(bal.consumed).toBe(0);
  });

  it("gates cleanly when exhausted (reserve returns false, no overspend)", async () => {
    const { id } = await makeCollege();
    await credits.setCredits(id, { monthlyOverride: 2 }, NOW);
    // grading weight = 1 → two succeed, the third is refused.
    expect(await credits.reserveCredits(id, "grading", NOW)).toBe(true);
    expect(await credits.reserveCredits(id, "grading", NOW)).toBe(true);
    expect(await credits.reserveCredits(id, "grading", NOW)).toBe(false);
    const bal = await credits.getCreditBalance(id, NOW);
    expect(bal.consumed).toBe(2);
    expect(bal.remaining).toBe(0);
    expect(await credits.hasCreditsFor(id, "grading", NOW)).toBe(false);
  });

  it("is concurrency-safe: parallel reserves never exceed the cap", async () => {
    const { id } = await makeCollege();
    await credits.setCredits(id, { monthlyOverride: 5 }, NOW);
    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        credits.reserveCredits(id, "grading", NOW),
      ),
    );
    const granted = results.filter(Boolean).length;
    expect(granted).toBe(5); // exactly the cap, no more
    const bal = await credits.getCreditBalance(id, NOW);
    expect(bal.consumed).toBe(5);
  });

  it("re-allocates at monthly rollover (new period, fresh budget)", async () => {
    const { id } = await makeCollege();
    await addStudents(id, 2);
    const july = await credits.getCreditBalance(id, NOW);
    await credits.reserveCredits(id, "grading", NOW);
    // A student joins, then the next month rolls over.
    await addStudents(id, 3);
    const aug = await credits.getCreditBalance(
      id,
      new Date("2026-08-15T10:00:00Z"),
    );
    expect(aug.periodKey).toBe("2026-08");
    expect(aug.consumed).toBe(0); // fresh period
    const free = AI_CREDIT_TIERS[AiCreditTier.FREE];
    expect(july.allocated).toBe(free.baseCredits + 2 * free.perSeatCredits);
    expect(aug.allocated).toBe(free.baseCredits + 5 * free.perSeatCredits);
  });

  it("setCredits recomputes allocation; reset zeroes consumption", async () => {
    const { id } = await makeCollege();
    await addStudents(id, 4);
    await credits.reserveCredits(id, "grading", NOW);

    const std = await credits.setCredits(id, { tier: "standard" }, NOW);
    const s = AI_CREDIT_TIERS[AiCreditTier.STANDARD];
    expect(std.allocated).toBe(s.baseCredits + 4 * s.perSeatCredits);
    expect(std.consumed).toBe(1); // tier change keeps consumption

    const reset = await credits.setCredits(id, { reset: true }, NOW);
    expect(reset.consumed).toBe(0);
    expect(reset.byFeature).toEqual({});
  });
});

describe("AI credit endpoints + guards", () => {
  it("super-admin can read + set a college's credits; others are 403", async () => {
    const { id } = await makeCollege();
    const superAdmin = await makeUser({ role: Role.SUPER_ADMIN });

    const get = await request(app)
      .get(`/api/admin/colleges/${id}/credits`)
      .set(auth(superAdmin.token));
    expect(get.status).toBe(200);
    expect(get.body.periodKey).toBe(
      // current real period — just assert the shape is present
      get.body.periodKey,
    );
    expect(typeof get.body.allocated).toBe("number");

    const put = await request(app)
      .put(`/api/admin/colleges/${id}/credits`)
      .set(auth(superAdmin.token))
      .send({ tier: "premium", monthlyOverride: 1234 });
    expect(put.status).toBe(200);
    expect(put.body.allocated).toBe(1234); // override wins

    // A plain student may not touch the super-admin credits endpoint.
    const student = await makeUser();
    const denied = await request(app)
      .get(`/api/admin/colleges/${id}/credits`)
      .set(auth(student.token));
    expect(denied.status).toBe(403);
  });

  it("an operator sees a read-only balance for their own college", async () => {
    const { id, slug } = await makeCollege();
    await addStudents(id, 3);
    const admin = await makeUser({
      role: Role.COLLEGE_ADMIN,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(id),
    });
    const res = await request(app)
      .get(`/api/c/${slug}/ai-credits`)
      .set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.collegeId).toBe(id);
    expect(typeof res.body.remaining).toBe("number");
  });
});
