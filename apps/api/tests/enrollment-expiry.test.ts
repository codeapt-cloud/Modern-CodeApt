/**
 * Course-access expiry: the pure helpers, the read-side gating (expired
 * enrollments drop out of "my courses" and expose their expiry), and the
 * backfill that stamps `expiresAt` onto pre-existing rows from their original
 * enrollment date (idempotent; lifetime courses untouched).
 */
import { describe, expect, it } from "vitest";
import { Types } from "mongoose";

import {
  computeExpiresAt,
  isEnrollmentActive,
  notExpiredFilter,
} from "../src/lib/enrollment-access.js";
import {
  EnrollmentModel,
  SubjectModel,
} from "../src/models/curriculum.model.js";
import { getMyEnrollments } from "../src/services/curriculum.service.js";
import { runEnrollmentExpiryBackfill } from "../src/scripts/backfill-enrollment-expiry.js";

const DAY = 24 * 60 * 60 * 1000;

describe("enrollment-access helpers", () => {
  it("computeExpiresAt returns null for lifetime and a date for a window", () => {
    expect(computeExpiresAt(0)).toBeNull();
    const from = new Date("2026-01-01T00:00:00.000Z");
    expect(computeExpiresAt(30, from)?.toISOString()).toBe(
      new Date(from.getTime() + 30 * DAY).toISOString(),
    );
  });

  it("isEnrollmentActive treats null as lifetime and past dates as expired", () => {
    expect(isEnrollmentActive({ expiresAt: null })).toBe(true);
    expect(isEnrollmentActive(null)).toBe(false);
    expect(isEnrollmentActive({ expiresAt: new Date(Date.now() + DAY) })).toBe(
      true,
    );
    expect(isEnrollmentActive({ expiresAt: new Date(Date.now() - DAY) })).toBe(
      false,
    );
  });

  it("notExpiredFilter matches lifetime + future, excludes past", () => {
    const f = notExpiredFilter() as { $or: Record<string, unknown>[] };
    expect(f.$or).toHaveLength(2);
    expect(f.$or[0]).toEqual({ expiresAt: null });
  });
});

describe("my-courses gating (expired rows hidden, expiry surfaced)", () => {
  it("returns only active enrollments and exposes expiresAt", async () => {
    const user = new Types.ObjectId();
    const active = await SubjectModel.create({
      name: "Active",
      slug: "active-course",
      isVisible: true,
    });
    const expired = await SubjectModel.create({
      name: "Expired",
      slug: "expired-course",
      isVisible: true,
    });
    const future = new Date(Date.now() + 30 * DAY);
    await EnrollmentModel.create({
      user,
      subject: active._id,
      source: "manual",
      expiresAt: future,
    });
    await EnrollmentModel.create({
      user,
      subject: expired._id,
      source: "manual",
      expiresAt: new Date(Date.now() - DAY),
    });

    const res = await getMyEnrollments(user.toString());
    const slugs = res.items.map((i) => i.subject.slug);
    expect(slugs).toContain("active-course");
    expect(slugs).not.toContain("expired-course");
    const activeItem = res.items.find((i) => i.subject.slug === "active-course");
    expect(activeItem?.expiresAt).toBe(future.toISOString());
  });
});

describe("enrollment-expiry backfill", () => {
  it("stamps expiry from the original enrollment date; leaves lifetime null; idempotent", async () => {
    const paid = await SubjectModel.create({
      name: "Paid",
      slug: "paid-6mo",
      validityDays: 180,
    });
    const lifetime = await SubjectModel.create({
      name: "Lifetime",
      slug: "lifetime-course",
      validityDays: 0,
    });
    const enrolledAt = new Date("2026-01-01T00:00:00.000Z");
    const u1 = new Types.ObjectId();
    const u2 = new Types.ObjectId();
    // Raw inserts (pre-feature rows): no expiresAt, an explicit old createdAt.
    await EnrollmentModel.collection.insertOne({
      user: u1,
      subject: paid._id,
      source: "manual",
      expiresAt: null,
      createdAt: enrolledAt,
      updatedAt: enrolledAt,
    });
    await EnrollmentModel.collection.insertOne({
      user: u2,
      subject: lifetime._id,
      source: "manual",
      expiresAt: null,
      createdAt: enrolledAt,
      updatedAt: enrolledAt,
    });

    const report = await runEnrollmentExpiryBackfill();
    expect(report.enrollmentsStamped).toBe(1);

    const paidRow = await EnrollmentModel.findOne({ subject: paid._id }).lean();
    expect(paidRow?.expiresAt?.toISOString()).toBe(
      new Date(enrolledAt.getTime() + 180 * DAY).toISOString(),
    );
    // Lifetime course stays null (no expiry).
    const lifeRow = await EnrollmentModel.findOne({
      subject: lifetime._id,
    }).lean();
    expect(lifeRow?.expiresAt ?? null).toBeNull();

    // Idempotent — a second run stamps nothing new.
    const second = await runEnrollmentExpiryBackfill();
    expect(second.enrollmentsStamped).toBe(0);
  });
});
