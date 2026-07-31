/**
 * Careers API tests (supertest + in-memory Mongo). Covers the student surface
 * (list filtering/pagination, detail, apply success/deadline/idempotency,
 * my-applications isolation), the admin surface (CRUD + publish/close, list
 * applications, status update), the guards (student blocked from admin routes
 * and from mutating status), and student-projection leak checks.
 */
import { CareerErrorCode, JobApplicationStatus, Role } from "@codeapt/shared";
import type { Express } from "express";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { JobModel } from "../src/models/careers.model.js";
import { hashPassword } from "../src/lib/password.js";
import { ProfileModel, UserModel } from "../src/models/user.model.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

let counter = 0;
async function registerStudent(): Promise<{ token: string; userId: string }> {
  counter += 1;
  const u = `cand${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Cand ${counter}`,
      rollNumber: `ROLL-C-${counter}`,
      collegeName: "Acme",
      phoneNumber: "9999999999",
      state: "KA",
    });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ identifier: u, password: "Password123" });
  return {
    token: res.body.accessToken as string,
    userId: res.body.user.id as string,
  };
}

async function loginAdmin(): Promise<string> {
  counter += 1;
  const user = await UserModel.create({
    username: `admin${counter}`,
    email: `admin${counter}@example.com`,
    passwordHash: await hashPassword("AdminPass123"),
    role: Role.ADMIN,
    forcePasswordChange: false,
  });
  await ProfileModel.create({
    user: user._id,
    fullName: "Admin",
    rollNumber: `ADMIN-${counter}`,
  });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ identifier: `admin${counter}`, password: "AdminPass123" });
  return res.body.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const DAY = 86_400_000;

async function createPosting(
  adminToken: string,
  over: Record<string, unknown> = {},
) {
  const res = await request(app)
    .post("/api/admin/careers")
    .set(auth(adminToken))
    .send({
      title: "Software Engineer",
      company: "Acme",
      type: "full_time",
      compensation: "₹12 LPA",
      description: "Build things.",
      requirements: "DSA.",
      deadline: new Date(Date.now() + 30 * DAY).toISOString(),
      isActive: true,
      ...over,
    });
  return res;
}

const APPLICANT = {
  fullName: "Cand One",
  email: "cand@example.com",
  phone: "9998887777",
  resumeUrl: "https://example.com/resume.pdf",
  coverLetter: "I'm keen.",
};

describe("admin posting CRUD + publish/close", () => {
  it("creates, updates, publishes, closes, and deletes a posting", async () => {
    const admin = await loginAdmin();

    const created = await createPosting(admin);
    expect(created.status).toBe(201);
    expect(created.body.isActive).toBe(true);
    expect(created.body.type).toBe("full_time");
    const id = created.body.id;

    const updated = await request(app)
      .patch(`/api/admin/careers/${id}`)
      .set(auth(admin))
      .send({ title: "Senior SDE", company: "Acme", type: "full_time" });
    expect(updated.body.title).toBe("Senior SDE");

    const closed = await request(app)
      .post(`/api/admin/careers/${id}/close`)
      .set(auth(admin));
    expect(closed.body.isActive).toBe(false);

    const published = await request(app)
      .post(`/api/admin/careers/${id}/publish`)
      .set(auth(admin));
    expect(published.body.isActive).toBe(true);

    const del = await request(app)
      .delete(`/api/admin/careers/${id}`)
      .set(auth(admin));
    expect(del.body.deleted).toBe(true);
    expect(await JobModel.countDocuments({ _id: id })).toBe(0);
  });

  it("forbids a student from the admin surface", async () => {
    const { token } = await registerStudent();
    const res = await request(app)
      .post("/api/admin/careers")
      .set(auth(token))
      .send({ title: "X", company: "Y", type: "full_time" });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/careers (list)", () => {
  it("lists only active, not-past-deadline postings and paginates", async () => {
    const admin = await loginAdmin();
    await createPosting(admin, { title: "Open FT", company: "A" });
    await createPosting(admin, {
      title: "Internship",
      company: "B",
      type: "internship",
      deadline: null,
    });
    await createPosting(admin, {
      title: "Closed",
      company: "C",
      deadline: new Date(Date.now() - DAY).toISOString(),
    });
    // Unpublished — never shown to students.
    await createPosting(admin, {
      title: "Draft",
      company: "D",
      isActive: false,
    });

    const { token } = await registerStudent();
    const res = await request(app)
      .get("/api/careers?pageSize=10")
      .set(auth(token));
    expect(res.status).toBe(200);
    const titles = res.body.items.map((i: { title: string }) => i.title);
    expect(titles).toContain("Open FT");
    expect(titles).toContain("Internship");
    expect(titles).not.toContain("Closed"); // past deadline excluded
    expect(titles).not.toContain("Draft"); // unpublished excluded
    expect(res.body.items.every((i: { isOpen: boolean }) => i.isOpen)).toBe(
      true,
    );

    // includeClosed surfaces the past-deadline (still active) one, flagged.
    const withClosed = await request(app)
      .get("/api/careers?includeClosed=true&pageSize=10")
      .set(auth(token));
    const closed = withClosed.body.items.find(
      (i: { title: string }) => i.title === "Closed",
    );
    expect(closed?.isOpen).toBe(false);
  });

  it("exposes applyUrl on the student detail (external vs in-app) so the UI can branch", async () => {
    const admin = await loginAdmin();
    const external = await createPosting(admin, {
      title: "External Role",
      company: "Ext",
      applyUrl: "https://company.example/careers/9",
    });
    const inApp = await createPosting(admin, {
      title: "In-app Role",
      company: "Int",
    });
    const { token } = await registerStudent();

    const ext = await request(app)
      .get(`/api/careers/${external.body.id}`)
      .set(auth(token));
    expect(ext.status).toBe(200);
    expect(ext.body.applyUrl).toBe("https://company.example/careers/9");

    const ia = await request(app)
      .get(`/api/careers/${inApp.body.id}`)
      .set(auth(token));
    expect(ia.body.applyUrl).toBe("");
  });

  it("filters by type", async () => {
    const admin = await loginAdmin();
    await createPosting(admin, { title: "FT role", company: "A" });
    await createPosting(admin, {
      title: "Intern role",
      company: "B",
      type: "internship",
      deadline: null,
    });
    const { token } = await registerStudent();
    const res = await request(app)
      .get("/api/careers?type=internship")
      .set(auth(token));
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].type).toBe("internship");
  });
});

describe("apply flow", () => {
  it("applies successfully and is idempotent (409 on re-apply, one application)", async () => {
    const admin = await loginAdmin();
    const posting = await createPosting(admin);
    const id = posting.body.id;
    const { token, userId } = await registerStudent();

    const first = await request(app)
      .post(`/api/careers/${id}/apply`)
      .set(auth(token))
      .send(APPLICANT);
    expect(first.status).toBe(201);
    expect(first.body.status).toBe(JobApplicationStatus.SUBMITTED);

    const again = await request(app)
      .post(`/api/careers/${id}/apply`)
      .set(auth(token))
      .send(APPLICANT);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe(CareerErrorCode.ALREADY_APPLIED);

    // Detail reflects the caller's own application.
    const detail = await request(app)
      .get(`/api/careers/${id}`)
      .set(auth(token));
    expect(detail.body.myApplication.status).toBe(
      JobApplicationStatus.SUBMITTED,
    );

    // Exactly one application persisted for this posting.
    const list = await request(app)
      .get(`/api/admin/careers/${id}/applications`)
      .set(auth(admin));
    expect(
      list.body.items.filter((a: { userId: string }) => a.userId === userId),
    ).toHaveLength(1);
  });

  it("rejects applying to a past-deadline posting", async () => {
    const admin = await loginAdmin();
    const posting = await createPosting(admin, {
      deadline: new Date(Date.now() - DAY).toISOString(),
    });
    const { token } = await registerStudent();
    const res = await request(app)
      .post(`/api/careers/${posting.body.id}/apply`)
      .set(auth(token))
      .send(APPLICANT);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe(CareerErrorCode.DEADLINE_PASSED);
  });

  it("rejects applying to an unpublished posting (404)", async () => {
    const admin = await loginAdmin();
    const posting = await createPosting(admin, { isActive: false });
    const { token } = await registerStudent();
    const res = await request(app)
      .post(`/api/careers/${posting.body.id}/apply`)
      .set(auth(token))
      .send(APPLICANT);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(CareerErrorCode.POSTING_NOT_FOUND);
  });
});

describe("my applications isolation", () => {
  it("returns only the caller's applications", async () => {
    const admin = await loginAdmin();
    const posting = await createPosting(admin);
    const id = posting.body.id;

    const a = await registerStudent();
    const b = await registerStudent();
    await request(app)
      .post(`/api/careers/${id}/apply`)
      .set(auth(a.token))
      .send(APPLICANT);
    await request(app)
      .post(`/api/careers/${id}/apply`)
      .set(auth(b.token))
      .send({ ...APPLICANT, email: "b@example.com" });

    const mine = await request(app)
      .get("/api/careers/applications")
      .set(auth(a.token));
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0].posting.id).toBe(id);
    // Student projection carries no applicant contact of others.
    expect(JSON.stringify(mine.body)).not.toContain("b@example.com");
  });
});

describe("admin application review", () => {
  it("lists applications with contact + updates status; student cannot", async () => {
    const admin = await loginAdmin();
    const posting = await createPosting(admin);
    const id = posting.body.id;
    const { token } = await registerStudent();
    const applied = await request(app)
      .post(`/api/careers/${id}/apply`)
      .set(auth(token))
      .send(APPLICANT);
    const appId = applied.body.id;

    const list = await request(app)
      .get(`/api/admin/careers/${id}/applications`)
      .set(auth(admin));
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].email).toBe("cand@example.com"); // admin sees contact
    expect(list.body.items[0].resumeUrl).toContain("resume.pdf");

    const upd = await request(app)
      .patch(`/api/admin/careers/applications/${appId}`)
      .set(auth(admin))
      .send({ status: "SHORTLISTED" });
    expect(upd.body.status).toBe("SHORTLISTED");

    // Student sees the updated status on their own application.
    const mine = await request(app)
      .get("/api/careers/applications")
      .set(auth(token));
    expect(mine.body.items[0].status).toBe("SHORTLISTED");

    // A student may NOT hit the admin status route.
    const forbidden = await request(app)
      .patch(`/api/admin/careers/applications/${appId}`)
      .set(auth(token))
      .send({ status: "HIRED" });
    expect(forbidden.status).toBe(403);
  });

  it("rejects an invalid status value", async () => {
    const admin = await loginAdmin();
    const posting = await createPosting(admin);
    const { token } = await registerStudent();
    const applied = await request(app)
      .post(`/api/careers/${posting.body.id}/apply`)
      .set(auth(token))
      .send(APPLICANT);
    const res = await request(app)
      .patch(`/api/admin/careers/applications/${applied.body.id}`)
      .set(auth(admin))
      .send({ status: "NONSENSE" });
    expect(res.status).toBe(400); // zod validation
  });
});
