/**
 * Super-admin college_admin provisioning (Phase 4-followup) — POST/GET
 * /admin/colleges/:id/admins. A super_admin designates who runs a college's
 * workspace: creates a User (role=college_admin, userType=college, college=this,
 * forcePasswordChange), with the usual uniqueness guards. supertest + in-memory
 * Mongo.
 */
import { Role, UserType } from "@codeapt/shared";
import type { Express } from "express";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { UserModel } from "../src/models/user.model.js";
import * as colleges from "../src/services/college.service.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

let counter = 0;
async function makeUser(role?: string): Promise<{ token: string; userId: string }> {
  counter += 1;
  const u = `cadm${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Cadm ${counter}`,
      rollNumber: `CADM-${counter}`,
      collegeName: "Acme",
      phoneNumber: "9999999999",
      state: "KA",
    });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ identifier: u, password: "Password123" });
  const userId = res.body.user.id as string;
  if (role) await UserModel.updateOne({ _id: userId }, { $set: { role } });
  return { token: res.body.accessToken as string, userId };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("super-admin college_admin provisioning", () => {
  it("creates a college_admin (role/userType/college/forcePasswordChange), lists it, rejects dupes", async () => {
    const platform = await makeUser(Role.SUPER_ADMIN);
    const college = await colleges.createCollege(
      { name: "Springfield", slug: "springfield" },
      platform.userId,
    );

    const create = await request(app)
      .post(`/api/admin/colleges/${college.id}/admins`)
      .set(auth(platform.token))
      .send({
        fullName: "Dean Skinner",
        username: "skinner",
        email: "skinner@springfield.edu",
        password: "Password123",
      });
    expect(create.status).toBe(201);
    expect(create.body.role).toBe("college_admin");
    expect(create.body.forcePasswordChange).toBe(true);

    // DB shape: userType=college + college=this tenant.
    const user = await UserModel.findById(create.body.id);
    expect(user?.userType).toBe(UserType.COLLEGE);
    expect(user?.college?.toString()).toBe(college.id);

    // Listed for the college.
    const list = await request(app)
      .get(`/api/admin/colleges/${college.id}/admins`)
      .set(auth(platform.token));
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].username).toBe("skinner");

    // Duplicate email → 409.
    const dupe = await request(app)
      .post(`/api/admin/colleges/${college.id}/admins`)
      .set(auth(platform.token))
      .send({
        fullName: "Someone Else",
        username: "other",
        email: "skinner@springfield.edu",
        password: "Password123",
      });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("denies a non-super-admin", async () => {
    const platform = await makeUser(Role.SUPER_ADMIN);
    const college = await colleges.createCollege(
      { name: "Shelbyville", slug: "shelbyville" },
      platform.userId,
    );
    const plain = await makeUser(); // ordinary student
    const res = await request(app)
      .post(`/api/admin/colleges/${college.id}/admins`)
      .set(auth(plain.token))
      .send({
        fullName: "Nope",
        username: "nope",
        email: "nope@shelbyville.edu",
        password: "Password123",
      });
    expect(res.status).toBe(403);
  });
});
