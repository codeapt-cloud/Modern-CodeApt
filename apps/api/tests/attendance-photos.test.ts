/**
 * OPTIONAL session photos (filing/audit). supertest + in-memory Mongo. Proves:
 * add/remove photos on a session (manager authority; a non-owner faculty denied),
 * photos returned on the session GET, view limited to admin + the session's
 * manager, a session with NO photos behaves exactly as before, the feature-scoped
 * upload signature, the feature gate, and tenant isolation.
 */
import { Role, UserType } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { UserModel } from "../src/models/user.model.js";
import * as colleges from "../src/services/college.service.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const PHOTO = "https://res.cloudinary.com/demo/image/upload/v1/codeapt/door.jpg";

let seq = 0;
async function makeUser(fields?: {
  role?: string;
  userType?: string;
  college?: Types.ObjectId | null;
}): Promise<{ token: string; userId: string }> {
  seq += 1;
  const u = `pho${seq}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Pho User ${seq}`,
      rollNumber: `PHOU-${seq}`,
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

let collegeSeq = 0;
async function setupCollege(opts: { attendance?: boolean } = {}) {
  collegeSeq += 1;
  const slug = `pho-col-${collegeSeq}`;
  const platform = await makeUser({ role: Role.SUPER_ADMIN });
  const dto = await colleges.createCollege({ name: slug, slug }, platform.userId);
  if (opts.attendance) {
    await colleges.setEntitlements(dto.id, { features: { attendance: true } });
  }
  const admin = await makeUser({
    role: Role.COLLEGE_ADMIN,
    userType: UserType.COLLEGE,
    college: new Types.ObjectId(dto.id),
  });
  return { collegeId: dto.id, slug, adminToken: admin.token };
}

/** A college (attendance on) + a group + a session; returns ids/tokens. */
async function setupSession() {
  const { collegeId, slug, adminToken } = await setupCollege({ attendance: true });
  const dept = await request(app)
    .post(`/api/c/${slug}/org-units`)
    .set(auth(adminToken))
    .send({ type: "department", name: "CSE" });
  const grp = await request(app)
    .post(`/api/c/${slug}/attendance/groups`)
    .set(auth(adminToken))
    .send({ name: `G${collegeSeq}`, orgUnitIds: [dept.body.id] });
  const groupId = grp.body.id as string;
  const s = await request(app)
    .post(`/api/c/${slug}/attendance/groups/${groupId}/sessions`)
    .set(auth(adminToken))
    .send({});
  return { collegeId, slug, adminToken, groupId, sessionId: s.body.id as string };
}

const sessionUrl = (slug: string, id: string) =>
  `/api/c/${slug}/attendance/sessions/${id}`;

// ---------------------------------------------------------------------------

describe("session photos add / remove / view", () => {
  it("adds, returns on GET, and removes (manager authority)", async () => {
    const sc = await setupSession();

    // A session with NO photos behaves normally.
    const before = await request(app)
      .get(sessionUrl(sc.slug, sc.sessionId))
      .set(auth(sc.adminToken));
    expect(before.status).toBe(200);
    expect(before.body.session.photos).toEqual([]);

    // Add two photos.
    const add = await request(app)
      .post(`${sessionUrl(sc.slug, sc.sessionId)}/photos`)
      .set(auth(sc.adminToken))
      .send({ photos: [{ url: PHOTO, caption: "front door" }, { url: PHOTO }] });
    expect(add.status).toBe(200);
    expect(add.body.photos).toHaveLength(2);
    expect(add.body.photos[0]).toMatchObject({ url: PHOTO, caption: "front door" });
    const photoId = add.body.photos[0].id as string;

    // GET returns them.
    const got = await request(app)
      .get(sessionUrl(sc.slug, sc.sessionId))
      .set(auth(sc.adminToken));
    expect(got.body.session.photos).toHaveLength(2);

    // Remove one.
    const removed = await request(app)
      .delete(`${sessionUrl(sc.slug, sc.sessionId)}/photos/${photoId}`)
      .set(auth(sc.adminToken));
    expect(removed.status).toBe(200);
    expect(removed.body.photos).toHaveLength(1);

    // Removing a non-existent photo → 404.
    const bad = await request(app)
      .delete(`${sessionUrl(sc.slug, sc.sessionId)}/photos/${new Types.ObjectId()}`)
      .set(auth(sc.adminToken));
    expect(bad.status).toBe(404);
  });

  it("taking attendance is unaffected when a session has no photos", async () => {
    const sc = await setupSession();
    const save = await request(app)
      .put(`${sessionUrl(sc.slug, sc.sessionId)}/attendance`)
      .set(auth(sc.adminToken))
      .send({ marks: [] });
    expect(save.status).toBe(200);
    expect(save.body.session.photos).toEqual([]);
    expect(save.body.session.status).toBe("completed");
  });
});

describe("photo authority", () => {
  it("a non-owner faculty cannot add or view a session's photos", async () => {
    const sc = await setupSession();
    await request(app)
      .post(`${sessionUrl(sc.slug, sc.sessionId)}/photos`)
      .set(auth(sc.adminToken))
      .send({ photos: [{ url: PHOTO }] });

    const outsider = await makeUser({
      role: Role.FACULTY,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(sc.collegeId),
    });
    const view = await request(app)
      .get(sessionUrl(sc.slug, sc.sessionId))
      .set(auth(outsider.token));
    expect(view.status).toBe(404); // can't view others' sessions

    const add = await request(app)
      .post(`${sessionUrl(sc.slug, sc.sessionId)}/photos`)
      .set(auth(outsider.token))
      .send({ photos: [{ url: PHOTO }] });
    expect(add.status).toBe(404); // can't add either
  });

  it("a named group owner may add + view photos", async () => {
    const sc = await setupSession();
    const owner = await makeUser({
      role: Role.FACULTY,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(sc.collegeId),
    });
    await request(app)
      .patch(`/api/c/${sc.slug}/attendance/groups/${sc.groupId}`)
      .set(auth(sc.adminToken))
      .send({ facultyOwnerIds: [owner.userId] });

    const add = await request(app)
      .post(`${sessionUrl(sc.slug, sc.sessionId)}/photos`)
      .set(auth(owner.token))
      .send({ photos: [{ url: PHOTO }] });
    expect(add.status).toBe(200);
    expect(add.body.photos).toHaveLength(1);
  });
});

describe("upload signature + gate + tenant", () => {
  it("issues a feature-scoped upload signature to a session manager", async () => {
    const sc = await setupSession();
    const res = await request(app)
      .post(`/api/c/${sc.slug}/attendance/uploads/signature`)
      .set(auth(sc.adminToken));
    expect(res.status).toBe(200);
    expect(typeof res.body.cloudName).toBe("string");
    expect(res.body.signature).toBeTruthy();
    expect(res.body).not.toHaveProperty("apiSecret");
  });

  it("403s photos for a college without the attendance feature", async () => {
    const { slug, adminToken } = await setupCollege({ attendance: false });
    const res = await request(app)
      .post(`/api/c/${slug}/attendance/uploads/signature`)
      .set(auth(adminToken));
    expect(res.status).toBe(403);
  });

  it("cannot add a photo to another college's session", async () => {
    const sc = await setupSession();
    const other = await setupCollege({ attendance: true });
    const res = await request(app)
      .post(`${sessionUrl(other.slug, sc.sessionId)}/photos`)
      .set(auth(other.adminToken))
      .send({ photos: [{ url: PHOTO }] });
    expect(res.status).toBe(404);
  });
});
