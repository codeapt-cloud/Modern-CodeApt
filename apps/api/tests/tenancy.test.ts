/**
 * Tenant isolation + entitlement/role guards (Phase 0) — the hard security
 * boundary, tested end-to-end via supertest. Proves:
 *  - a college user can resolve ONLY their own tenant (cross-tenant → 403),
 *  - super_admin resolves across tenants; individual users are denied tenancy,
 *  - suspended colleges block college users but not platform admins,
 *  - the entitlement guard gates a feature (off → 403, on → allowed), with
 *    resource (course) grants surfaced, and platform-admin bypass.
 */
import { Role, TenantErrorCode, UserType } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { SubjectModel } from "../src/models/curriculum.model.js";
import { UserModel } from "../src/models/user.model.js";
import * as colleges from "../src/services/college.service.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

let counter = 0;
async function makeUser(fields?: {
  role?: string;
  userType?: string;
  college?: Types.ObjectId | null;
}): Promise<{ token: string; userId: string }> {
  counter += 1;
  const u = `ten${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Tenant User ${counter}`,
      rollNumber: `TEN-${counter}`,
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
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Provision a college via the service; returns its id (ObjectId). */
async function makeCollege(
  slug: string,
  createdBy: string,
): Promise<Types.ObjectId> {
  const dto = await colleges.createCollege({ name: slug, slug }, createdBy);
  return new Types.ObjectId(dto.id);
}

describe("tenant resolution + isolation", () => {
  it("lets a college user resolve their OWN tenant, denies another (cross-tenant)", async () => {
    const platform = await makeUser({ role: Role.SUPER_ADMIN });
    const aId = await makeCollege("a-tech", platform.userId);
    await makeCollege("b-tech", platform.userId);

    const aAdmin = await makeUser({
      role: Role.COLLEGE_ADMIN,
      userType: UserType.COLLEGE,
      college: aId,
    });

    const own = await request(app)
      .get("/api/c/a-tech/context")
      .set(auth(aAdmin.token));
    expect(own.status).toBe(200);
    expect(own.body.college.slug).toBe("a-tech");
    expect(own.body.membership.role).toBe(Role.COLLEGE_ADMIN);
    expect(own.body.membership.userType).toBe(UserType.COLLEGE);

    const other = await request(app)
      .get("/api/c/b-tech/context")
      .set(auth(aAdmin.token));
    expect(other.status).toBe(403);
    expect(other.body.error.code).toBe(TenantErrorCode.CROSS_TENANT_DENIED);
  });

  it("lets super_admin operate across ALL tenants", async () => {
    const platform = await makeUser({ role: Role.SUPER_ADMIN });
    await makeCollege("x-tech", platform.userId);
    await makeCollege("y-tech", platform.userId);

    for (const slug of ["x-tech", "y-tech"]) {
      const res = await request(app)
        .get(`/api/c/${slug}/context`)
        .set(auth(platform.token));
      expect(res.status).toBe(200);
      expect(res.body.college.slug).toBe(slug);
    }
  });

  it("denies an INDIVIDUAL user any tenant (tenancy does not apply to B2C)", async () => {
    const platform = await makeUser({ role: Role.SUPER_ADMIN });
    await makeCollege("ind-tech", platform.userId);
    const individual = await makeUser(); // default student/individual, college null

    const res = await request(app)
      .get("/api/c/ind-tech/context")
      .set(auth(individual.token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(TenantErrorCode.CROSS_TENANT_DENIED);
  });

  it("404s an unknown college slug and 401s an anonymous caller", async () => {
    const platform = await makeUser({ role: Role.SUPER_ADMIN });
    const missing = await request(app)
      .get("/api/c/does-not-exist/context")
      .set(auth(platform.token));
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe(TenantErrorCode.COLLEGE_NOT_FOUND);

    const anon = await request(app).get("/api/c/anything/context");
    expect(anon.status).toBe(401);
  });

  it("blocks a college user from a SUSPENDED college, but not a platform admin", async () => {
    const platform = await makeUser({ role: Role.SUPER_ADMIN });
    const id = await makeCollege("susp-tech", platform.userId);
    await colleges.updateCollege(id.toString(), { status: "suspended" });
    const member = await makeUser({
      role: Role.COLLEGE_ADMIN,
      userType: UserType.COLLEGE,
      college: id,
    });

    const blocked = await request(app)
      .get("/api/c/susp-tech/context")
      .set(auth(member.token));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe(TenantErrorCode.COLLEGE_SUSPENDED);

    const admin = await request(app)
      .get("/api/c/susp-tech/context")
      .set(auth(platform.token));
    expect(admin.status).toBe(200);
  });

  it("lets faculty resolve their own tenant", async () => {
    const platform = await makeUser({ role: Role.SUPER_ADMIN });
    const id = await makeCollege("fac-tech", platform.userId);
    const faculty = await makeUser({
      role: Role.FACULTY,
      userType: UserType.COLLEGE,
      college: id,
    });
    const res = await request(app)
      .get("/api/c/fac-tech/context")
      .set(auth(faculty.token));
    expect(res.status).toBe(200);
    expect(res.body.membership.role).toBe(Role.FACULTY);
  });
});

describe("entitlement guard (feature + resource grants)", () => {
  it("gates a feature: OFF → 403, ON → allowed with granted courses", async () => {
    const platform = await makeUser({ role: Role.SUPER_ADMIN });
    const id = await makeCollege("ent-tech", platform.userId);
    const member = await makeUser({
      role: Role.COLLEGE_ADMIN,
      userType: UserType.COLLEGE,
      college: id,
    });

    // Feature OFF → the guarded /courses route is forbidden.
    const off = await request(app)
      .get("/api/c/ent-tech/courses")
      .set(auth(member.token));
    expect(off.status).toBe(403);
    expect(off.body.error.code).toBe(TenantErrorCode.FEATURE_NOT_ENABLED);

    // Turn the feature ON + grant a course.
    const subject = await SubjectModel.create({
      name: "Operating Systems",
      slug: "os-101",
      price: 0,
    });
    await colleges.setEntitlements(id.toString(), {
      features: { courses: true },
    });
    await colleges.grantCourses(id.toString(), [subject._id.toString()]);

    const on = await request(app)
      .get("/api/c/ent-tech/courses")
      .set(auth(member.token));
    expect(on.status).toBe(200);
    expect(on.body.items).toHaveLength(1);
    expect(on.body.items[0].slug).toBe("os-101");
  });

  it("lets a platform admin BYPASS a disabled feature", async () => {
    const platform = await makeUser({ role: Role.SUPER_ADMIN });
    await makeCollege("bypass-tech", platform.userId);
    // courses feature is OFF, yet the super_admin is not gated.
    const res = await request(app)
      .get("/api/c/bypass-tech/courses")
      .set(auth(platform.token));
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });
});
