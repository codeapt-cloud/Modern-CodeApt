/**
 * Curriculum admin authoring (4a-i) — structural tree CRUD + reorder + the
 * delete guards. supertest + in-memory Mongo (see setup.ts). Covers Program /
 * Subject / Module create/update/delete/list, slug auto-derive + collision,
 * reorder-by-index, admin-guard, and the block-when-non-empty delete semantics.
 */
import { TopicType } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import {
  EnrollmentModel,
  ModuleModel,
  TopicModel,
} from "../src/models/curriculum.model.js";
import request from "supertest";

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
  const u = `cadm${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Cur Adm ${counter}`,
      rollNumber: `ROLL-${counter}`,
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

async function adminToken(): Promise<string> {
  return (await registerAndLogin("admin")).token;
}

describe("curriculum admin — Program", () => {
  it("creates (auto-derives slug), lists all, gets, updates (slug stable on rename)", async () => {
    const token = await adminToken();

    const created = await request(app)
      .post("/api/admin/programs")
      .set(auth(token))
      .send({ name: "Placement Foundations", description: "core", order: 1 });
    expect(created.status).toBe(201);
    expect(created.body.slug).toBe("placement-foundations");
    expect(created.body.subjectCount).toBe(0);
    const id = created.body.id as string;

    // Hidden program still appears in the ADMIN list.
    await request(app)
      .post("/api/admin/programs")
      .set(auth(token))
      .send({ name: "Hidden One", isVisible: false });
    const list = await request(app)
      .get("/api/admin/programs")
      .set(auth(token));
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBe(2);
    expect(list.body.items.some((p: { isVisible: boolean }) => !p.isVisible)).toBe(
      true,
    );

    const got = await request(app)
      .get(`/api/admin/programs/${id}`)
      .set(auth(token));
    expect(got.body.name).toBe("Placement Foundations");

    // Rename keeps the slug stable.
    const updated = await request(app)
      .patch(`/api/admin/programs/${id}`)
      .set(auth(token))
      .send({ name: "Renamed Program" });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe("Renamed Program");
    expect(updated.body.slug).toBe("placement-foundations");
  });

  it("rejects a duplicate slug with a clean 409 (not a 500)", async () => {
    const token = await adminToken();
    await request(app)
      .post("/api/admin/programs")
      .set(auth(token))
      .send({ name: "Dup", slug: "dup-slug" });
    const clash = await request(app)
      .post("/api/admin/programs")
      .set(auth(token))
      .send({ name: "Other", slug: "dup-slug" });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe("SLUG_TAKEN");
  });

  it("reorder assigns order by array index", async () => {
    const token = await adminToken();
    const a = await request(app).post("/api/admin/programs").set(auth(token)).send({ name: "A" });
    const b = await request(app).post("/api/admin/programs").set(auth(token)).send({ name: "B" });
    const c = await request(app).post("/api/admin/programs").set(auth(token)).send({ name: "C" });
    // Reorder to C, A, B.
    const res = await request(app)
      .post("/api/admin/programs/reorder")
      .set(auth(token))
      .send({ ids: [c.body.id, a.body.id, b.body.id] });
    expect(res.status).toBe(200);
    const byId = new Map(
      res.body.items.map((p: { id: string; order: number }) => [p.id, p.order]),
    );
    expect(byId.get(c.body.id)).toBe(0);
    expect(byId.get(a.body.id)).toBe(1);
    expect(byId.get(b.body.id)).toBe(2);
  });

  it("deletes an empty program, but blocks when it has subjects", async () => {
    const token = await adminToken();
    const program = await request(app)
      .post("/api/admin/programs")
      .set(auth(token))
      .send({ name: "Has Subjects" });
    const pid = program.body.id as string;

    // Attach a subject → delete blocked.
    await request(app)
      .post("/api/admin/subjects")
      .set(auth(token))
      .send({ name: "Child Subject", programId: pid });
    const blocked = await request(app)
      .delete(`/api/admin/programs/${pid}`)
      .set(auth(token));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("DELETE_BLOCKED");
    expect(blocked.body.error.details.blockers.subjects).toBe(1);

    // An empty program deletes cleanly.
    const empty = await request(app)
      .post("/api/admin/programs")
      .set(auth(token))
      .send({ name: "Empty" });
    const del = await request(app)
      .delete(`/api/admin/programs/${empty.body.id}`)
      .set(auth(token));
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(true);
  });

  it("requires admin (403 for a normal user)", async () => {
    const { token } = await registerAndLogin();
    const res = await request(app).get("/api/admin/programs").set(auth(token));
    expect(res.status).toBe(403);
  });
});

describe("curriculum admin — Subject", () => {
  it("creates with paise prices + program ref, lists with counts, updates", async () => {
    const token = await adminToken();
    const program = await request(app)
      .post("/api/admin/programs")
      .set(auth(token))
      .send({ name: "Prog" });
    const pid = program.body.id as string;

    const created = await request(app)
      .post("/api/admin/subjects")
      .set(auth(token))
      .send({
        name: "Data Structures",
        programId: pid,
        price: 129900,
        discountPrice: 99900,
        isPopular: true,
        image: "https://cdn.example/ds.png",
      });
    expect(created.status).toBe(201);
    expect(created.body.slug).toBe("data-structures");
    expect(created.body.price).toBe(129900);
    expect(created.body.discountPrice).toBe(99900);
    expect(created.body.programId).toBe(pid);
    expect(created.body.programName).toBe("Prog");
    const sid = created.body.id as string;

    const list = await request(app)
      .get("/api/admin/subjects")
      .set(auth(token));
    expect(list.body.items.length).toBe(1);
    expect(list.body.items[0].moduleCount).toBe(0);
    expect(list.body.items[0].enrollmentCount).toBe(0);

    const updated = await request(app)
      .patch(`/api/admin/subjects/${sid}`)
      .set(auth(token))
      .send({ name: "DS in C++", isPopular: false, isVisible: false });
    expect(updated.status).toBe(200);
    expect(updated.body.slug).toBe("data-structures"); // stable
    expect(updated.body.isVisible).toBe(false);
  });

  it("stores validityDays and stays editable with a legacy (non-URL) image", async () => {
    const token = await adminToken();
    // A legacy course whose image is NOT a strict URL must remain saveable.
    const created = await request(app)
      .post("/api/admin/subjects")
      .set(auth(token))
      .send({ name: "Legacy Course", image: "courses/legacy.png", validityDays: 180 });
    expect(created.status).toBe(201);
    expect(created.body.validityDays).toBe(180);
    const sid = created.body.id as string;

    // Editing (e.g. changing validity) round-trips the legacy image without 400.
    const updated = await request(app)
      .patch(`/api/admin/subjects/${sid}`)
      .set(auth(token))
      .send({ name: "Legacy Course", image: "courses/legacy.png", validityDays: 30 });
    expect(updated.status).toBe(200);
    expect(updated.body.validityDays).toBe(30);
  });

  it("recomputes enrollment expiry from each learner's own enrolment date", async () => {
    const token = await adminToken();
    const created = await request(app)
      .post("/api/admin/subjects")
      .set(auth(token))
      .send({ name: "Expiring Course", validityDays: 180 });
    const sid = created.body.id as string;
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    // One enrolled 300 days ago (expired under a 180-day window), one recent.
    await EnrollmentModel.collection.insertMany([
      {
        user: new Types.ObjectId(),
        subject: new Types.ObjectId(sid),
        source: "manual",
        expiresAt: null,
        createdAt: new Date(now - 300 * DAY),
        updatedAt: new Date(now - 300 * DAY),
      },
      {
        user: new Types.ObjectId(),
        subject: new Types.ObjectId(sid),
        source: "manual",
        expiresAt: null,
        createdAt: new Date(now - 10 * DAY),
        updatedAt: new Date(now - 10 * DAY),
      },
    ]);

    const res = await request(app)
      .post(`/api/admin/subjects/${sid}/recompute-expiry`)
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    expect(res.body.expired).toBe(1);

    const rows = await EnrollmentModel.find({ subject: sid })
      .sort({ createdAt: 1 })
      .lean();
    // Old enrolment → expiry already past; recent → still in the future.
    expect(new Date(rows[0]!.expiresAt as Date).getTime()).toBeLessThan(now);
    expect(new Date(rows[1]!.expiresAt as Date).getTime()).toBeGreaterThan(now);

    // The admin "enrolled" count reflects CURRENTLY active only (expired drops).
    const afterExpiry = await request(app)
      .get(`/api/admin/subjects/${sid}`)
      .set(auth(token));
    expect(afterExpiry.body.enrollmentCount).toBe(1);

    // Switching to lifetime (0) and recomputing clears every expiry.
    await request(app)
      .patch(`/api/admin/subjects/${sid}`)
      .set(auth(token))
      .send({ name: "Expiring Course", validityDays: 0 });
    const res2 = await request(app)
      .post(`/api/admin/subjects/${sid}/recompute-expiry`)
      .set(auth(token));
    expect(res2.body.expired).toBe(0);
    const cleared = await EnrollmentModel.find({ subject: sid }).lean();
    expect(cleared.every((r) => r.expiresAt == null)).toBe(true);
  });

  it("rejects an unknown programId with 404", async () => {
    const token = await adminToken();
    const res = await request(app)
      .post("/api/admin/subjects")
      .set(auth(token))
      .send({ name: "Orphan", programId: "6a63742ee286df97a6a0b999" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PROGRAM_NOT_FOUND");
  });

  it("blocks delete when an enrollment exists; blocks when it has a module", async () => {
    const token = await adminToken();
    const { userId } = await registerAndLogin();

    // Subject with an enrollment → blocked.
    const s1 = await request(app)
      .post("/api/admin/subjects")
      .set(auth(token))
      .send({ name: "Enrolled Course" });
    await EnrollmentModel.create({
      user: userId,
      subject: s1.body.id,
      source: "manual",
    });
    const blockedByEnroll = await request(app)
      .delete(`/api/admin/subjects/${s1.body.id}`)
      .set(auth(token));
    expect(blockedByEnroll.status).toBe(409);
    expect(blockedByEnroll.body.error.code).toBe("DELETE_BLOCKED");
    expect(blockedByEnroll.body.error.details.blockers.enrollments).toBe(1);

    // Subject with a module → blocked (protects the whole content tree/exams).
    const s2 = await request(app)
      .post("/api/admin/subjects")
      .set(auth(token))
      .send({ name: "Has Module" });
    await request(app)
      .post(`/api/admin/subjects/${s2.body.id}/modules`)
      .set(auth(token))
      .send({ name: "M1" });
    const blockedByModule = await request(app)
      .delete(`/api/admin/subjects/${s2.body.id}`)
      .set(auth(token));
    expect(blockedByModule.status).toBe(409);
    expect(blockedByModule.body.error.details.blockers.modules).toBe(1);

    // An empty subject with no refs deletes cleanly.
    const s3 = await request(app)
      .post("/api/admin/subjects")
      .set(auth(token))
      .send({ name: "Empty Course" });
    const del = await request(app)
      .delete(`/api/admin/subjects/${s3.body.id}`)
      .set(auth(token));
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(true);
  });
});

describe("curriculum admin — Module", () => {
  it("creates under a subject, lists by subject, updates, reorders by index", async () => {
    const token = await adminToken();
    const subject = await request(app)
      .post("/api/admin/subjects")
      .set(auth(token))
      .send({ name: "Course With Modules" });
    const sid = subject.body.id as string;

    const m1 = await request(app)
      .post(`/api/admin/subjects/${sid}/modules`)
      .set(auth(token))
      .send({ name: "Module 1", order: 0 });
    expect(m1.status).toBe(201);
    expect(m1.body.subjectId).toBe(sid);
    const m2 = await request(app)
      .post(`/api/admin/subjects/${sid}/modules`)
      .set(auth(token))
      .send({ name: "Module 2", order: 1 });

    const list = await request(app)
      .get(`/api/admin/subjects/${sid}/modules`)
      .set(auth(token));
    expect(list.body.items.length).toBe(2);
    expect(list.body.items[0].topicCount).toBe(0);

    const updated = await request(app)
      .patch(`/api/admin/modules/${m1.body.id}`)
      .set(auth(token))
      .send({ name: "Module One", order: 0 });
    expect(updated.body.name).toBe("Module One");

    // Reorder: m2 first, m1 second.
    const reordered = await request(app)
      .post(`/api/admin/subjects/${sid}/modules/reorder`)
      .set(auth(token))
      .send({ ids: [m2.body.id, m1.body.id] });
    expect(reordered.status).toBe(200);
    const byId = new Map(
      reordered.body.items.map((m: { id: string; order: number }) => [
        m.id,
        m.order,
      ]),
    );
    expect(byId.get(m2.body.id)).toBe(0);
    expect(byId.get(m1.body.id)).toBe(1);
  });

  it("deletes an empty module cleanly; blocks a module that has topics", async () => {
    const token = await adminToken();
    const subject = await request(app)
      .post("/api/admin/subjects")
      .set(auth(token))
      .send({ name: "Del Module Course" });
    const sid = subject.body.id as string;

    // Empty module → deletes cleanly.
    const empty = await request(app)
      .post(`/api/admin/subjects/${sid}/modules`)
      .set(auth(token))
      .send({ name: "Empty Module" });
    const delEmpty = await request(app)
      .delete(`/api/admin/modules/${empty.body.id}`)
      .set(auth(token));
    expect(delEmpty.status).toBe(200);
    expect(delEmpty.body.deleted).toBe(true);

    // Module with a topic → blocked (no orphaned topics).
    const withTopic = await request(app)
      .post(`/api/admin/subjects/${sid}/modules`)
      .set(auth(token))
      .send({ name: "Has Topic" });
    await TopicModel.create({
      module: withTopic.body.id,
      name: "A topic",
      topicType: TopicType.TEXT,
      order: 1,
    });
    const blocked = await request(app)
      .delete(`/api/admin/modules/${withTopic.body.id}`)
      .set(auth(token));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("DELETE_BLOCKED");
    expect(blocked.body.error.details.blockers.topics).toBe(1);
    // The module and topic are untouched.
    expect(await ModuleModel.countDocuments({ _id: withTopic.body.id })).toBe(1);
  });
});
