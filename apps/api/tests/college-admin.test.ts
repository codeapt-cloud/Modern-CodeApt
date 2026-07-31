/**
 * College provisioning + entitlement control (Phase 0). supertest + in-memory
 * Mongo. Proves the super_admin control plane: create (with unique slug),
 * update status, toggle FEATURE + SUB-CAPABILITY entitlements, grant/revoke
 * master-catalog courses, input validation, and the role guard.
 */
import { Role, TenantErrorCode, UserType } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { SubjectModel } from "../src/models/curriculum.model.js";
import { UserModel } from "../src/models/user.model.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

let counter = 0;
/**
 * Register + log in, then apply any tenancy fields. Since requireAuth reads the
 * user fresh from the DB on every request, the initial token stays valid and
 * picks up the updated role/college/userType — no re-login needed.
 */
async function makeUser(fields?: {
  role?: string;
  userType?: string;
  college?: Types.ObjectId | null;
}): Promise<{ token: string; userId: string }> {
  counter += 1;
  const u = `col${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `College User ${counter}`,
      rollNumber: `COL-${counter}`,
      collegeName: "Acme",
      phoneNumber: "9999999999",
      state: "KA",
    });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ identifier: u, password: "Password123" });
  const userId = res.body.user.id as string;
  if (fields) {
    await UserModel.updateOne({ _id: userId }, { $set: fields });
  }
  return { token: res.body.accessToken as string, userId };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const superToken = async (): Promise<string> =>
  (await makeUser({ role: Role.SUPER_ADMIN })).token;

let subjectSeq = 0;
async function makeSubject(name: string): Promise<string> {
  subjectSeq += 1;
  const s = await SubjectModel.create({
    name,
    slug: `subj-${subjectSeq}`,
    price: 50000,
  });
  return s._id.toString();
}

const create = (token: string, body: unknown) =>
  request(app).post("/api/admin/colleges").set(auth(token)).send(body);

describe("college provisioning (super_admin)", () => {
  it("creates a college with empty entitlements and a unique slug", async () => {
    const token = await superToken();
    const res = await create(token, {
      name: "Springfield Institute of Technology",
      slug: "springfield-tech",
      contactEmail: "admin@springfield.edu",
    });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe("springfield-tech");
    expect(res.body.status).toBe("active");
    expect(res.body.createdBy).not.toBeNull();
    // Nothing granted by default.
    expect(res.body.entitlements.features).toEqual({});
    expect(res.body.entitlements.subCapabilities).toEqual({});
    expect(res.body.entitlements.grantedCourses).toEqual([]);
  });

  it("rejects a duplicate slug (409)", async () => {
    const token = await superToken();
    await create(token, { name: "First", slug: "dupe-slug" });
    const again = await create(token, { name: "Second", slug: "dupe-slug" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe(TenantErrorCode.COLLEGE_SLUG_TAKEN);
  });

  it("rejects an invalid slug and a missing name (400)", async () => {
    const token = await superToken();
    expect((await create(token, { name: "X", slug: "Bad Slug!" })).status).toBe(
      400,
    );
    expect((await create(token, { slug: "no-name" })).status).toBe(400);
  });

  it("lists, gets, and updates a college (status + name)", async () => {
    const token = await superToken();
    const created = await create(token, { name: "Editable", slug: "editable" });
    const id = created.body.id as string;

    const list = await request(app)
      .get("/api/admin/colleges")
      .set(auth(token));
    expect(list.status).toBe(200);
    expect(list.body.items.some((c: { id: string }) => c.id === id)).toBe(true);

    const got = await request(app)
      .get(`/api/admin/colleges/${id}`)
      .set(auth(token));
    expect(got.body.slug).toBe("editable");

    const updated = await request(app)
      .patch(`/api/admin/colleges/${id}`)
      .set(auth(token))
      .send({ status: "suspended", name: "Renamed" });
    expect(updated.status).toBe(200);
    expect(updated.body.status).toBe("suspended");
    expect(updated.body.name).toBe("Renamed");
  });

  it("404s an unknown / invalid college id", async () => {
    const token = await superToken();
    const bad = await request(app)
      .get("/api/admin/colleges/not-an-id")
      .set(auth(token));
    expect(bad.status).toBe(404);
    const missing = await request(app)
      .get(`/api/admin/colleges/${new Types.ObjectId().toString()}`)
      .set(auth(token));
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe(TenantErrorCode.COLLEGE_NOT_FOUND);
  });
});

describe("college entitlements (super_admin)", () => {
  it("toggles FEATURE and SUB-CAPABILITY entitlements (add + remove)", async () => {
    const token = await superToken();
    const id = (await create(token, { name: "Ent", slug: "ent" })).body
      .id as string;

    const on = await request(app)
      .put(`/api/admin/colleges/${id}/entitlements`)
      .set(auth(token))
      .send({
        features: { exams: true, essays: true },
        subCapabilities: { "exams.public_links": true },
      });
    expect(on.status).toBe(200);
    expect(on.body.entitlements.features.exams).toBe(true);
    expect(on.body.entitlements.features.essays).toBe(true);
    expect(on.body.entitlements.subCapabilities["exams.public_links"]).toBe(
      true,
    );

    // Revoke a feature + a sub-capability.
    const off = await request(app)
      .put(`/api/admin/colleges/${id}/entitlements`)
      .set(auth(token))
      .send({
        features: { essays: false },
        subCapabilities: { "exams.public_links": false },
      });
    expect(off.body.entitlements.features.essays).toBe(false);
    expect(off.body.entitlements.subCapabilities["exams.public_links"]).toBe(
      false,
    );
  });

  it("rejects an unknown sub-capability key (400)", async () => {
    const token = await superToken();
    const id = (await create(token, { name: "Bad", slug: "bad-subcap" })).body
      .id as string;
    const res = await request(app)
      .put(`/api/admin/colleges/${id}/entitlements`)
      .set(auth(token))
      .send({ subCapabilities: { "exams.nonexistent": true } });
    expect(res.status).toBe(400);
  });

  it("grants and revokes master-catalog courses; rejects unknown ids", async () => {
    const token = await superToken();
    const id = (await create(token, { name: "Courses", slug: "courses-col" }))
      .body.id as string;
    const subjectA = await makeSubject("Data Structures");
    const subjectB = await makeSubject("Algorithms");

    const granted = await request(app)
      .post(`/api/admin/colleges/${id}/courses`)
      .set(auth(token))
      .send({ courseIds: [subjectA, subjectB] });
    expect(granted.status).toBe(200);
    expect(granted.body.entitlements.grantedCourses).toContain(subjectA);
    expect(granted.body.entitlements.grantedCourses).toContain(subjectB);

    // Idempotent re-grant does not duplicate.
    const again = await request(app)
      .post(`/api/admin/colleges/${id}/courses`)
      .set(auth(token))
      .send({ courseIds: [subjectA] });
    expect(
      again.body.entitlements.grantedCourses.filter(
        (c: string) => c === subjectA,
      ).length,
    ).toBe(1);

    const unknown = await request(app)
      .post(`/api/admin/colleges/${id}/courses`)
      .set(auth(token))
      .send({ courseIds: [new Types.ObjectId().toString()] });
    expect(unknown.status).toBe(400);

    const revoked = await request(app)
      .delete(`/api/admin/colleges/${id}/courses`)
      .set(auth(token))
      .send({ courseIds: [subjectA] });
    expect(revoked.body.entitlements.grantedCourses).not.toContain(subjectA);
    expect(revoked.body.entitlements.grantedCourses).toContain(subjectB);
  });
});

describe("college provisioning — role guard", () => {
  it("rejects a plain student (403)", async () => {
    const { token } = await makeUser(); // default student/individual
    const res = await create(token, { name: "Nope", slug: "nope" });
    expect(res.status).toBe(403);
  });

  it("rejects a college_admin (not a platform admin) (403)", async () => {
    const { token } = await makeUser({
      role: Role.COLLEGE_ADMIN,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(),
    });
    const res = await create(token, { name: "Nope", slug: "nope2" });
    expect(res.status).toBe(403);
  });

  it("accepts a legacy admin (maps to platform-admin authority)", async () => {
    const { token } = await makeUser({ role: Role.ADMIN });
    const res = await create(token, { name: "Legacy OK", slug: "legacy-ok" });
    expect(res.status).toBe(201);
  });
});

describe("login branding + public branding endpoint", () => {
  it("saves branding (super_admin) and serves ONLY public fields by slug", async () => {
    const token = await superToken();
    const id = (await create(token, { name: "Brandy College", slug: "brandy" }))
      .body.id as string;

    const patched = await request(app)
      .patch(`/api/admin/colleges/${id}`)
      .set(auth(token))
      .send({
        branding: {
          logoUrl: "https://cdn.example/logo.png",
          displayName: "Brandy",
          welcomeText: "Welcome, Brandy students!",
          brandColor: "#123456",
        },
      });
    expect(patched.status).toBe(200);
    expect(patched.body.branding).toMatchObject({
      logoUrl: "https://cdn.example/logo.png",
      displayName: "Brandy",
      welcomeText: "Welcome, Brandy students!",
      brandColor: "#123456",
    });

    // PUBLIC endpoint (NO auth) returns exactly the public branding — nothing else.
    const pub = await request(app).get("/api/public/colleges/brandy/branding");
    expect(pub.status).toBe(200);
    expect(pub.body).toEqual({
      slug: "brandy",
      displayName: "Brandy",
      logoUrl: "https://cdn.example/logo.png",
      welcomeText: "Welcome, Brandy students!",
      brandColor: "#123456",
    });
    expect(Object.keys(pub.body).sort()).toEqual([
      "brandColor",
      "displayName",
      "logoUrl",
      "slug",
      "welcomeText",
    ]);
    // No sensitive data leaks through the public endpoint.
    expect(pub.body.entitlements).toBeUndefined();
    expect(pub.body.contactEmail).toBeUndefined();
    expect(pub.body.id).toBeUndefined();
  });

  it("public branding falls back to the college name when displayName is unset", async () => {
    const token = await superToken();
    await create(token, { name: "Nakedbrand Institute", slug: "nakedbrand" });
    const pub = await request(app).get(
      "/api/public/colleges/nakedbrand/branding",
    );
    expect(pub.status).toBe(200);
    expect(pub.body.displayName).toBe("Nakedbrand Institute"); // resolved from name
    expect(pub.body.logoUrl).toBe("");
    expect(pub.body.brandColor).toBe("");
  });

  it("404s an unknown slug (no auth)", async () => {
    const res = await request(app).get(
      "/api/public/colleges/no-such-college/branding",
    );
    expect(res.status).toBe(404);
  });

  it("branding save is super-admin gated (a college admin is 403)", async () => {
    const token = await superToken();
    const id = (await create(token, { name: "Gated", slug: "gated-brand" })).body
      .id as string;
    const admin = await makeUser({
      role: Role.COLLEGE_ADMIN,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(id),
    });
    const res = await request(app)
      .patch(`/api/admin/colleges/${id}`)
      .set(auth(admin.token))
      .send({ branding: { displayName: "Hax" } });
    expect(res.status).toBe(403);
  });
});
