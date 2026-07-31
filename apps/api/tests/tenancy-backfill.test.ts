/**
 * Tenancy backfill (Phase 0) — proves the migration is ADDITIVE, correct and
 * IDEMPOTENT: pre-schema users become individual + keep/roll their role
 * (admin→super_admin, student stays student), a second run changes nothing, and
 * no other collection or field is touched.
 */
import { Role, UserType } from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import { SubjectModel } from "../src/models/curriculum.model.js";
import { UserModel } from "../src/models/user.model.js";
import { runTenancyBackfill } from "../src/scripts/backfill-tenancy.js";

/** Insert a raw, pre-schema user (no userType/college) via the driver. */
async function insertLegacyUser(username: string, role: string): Promise<void> {
  await UserModel.collection.insertOne({
    username,
    email: `${username}@legacy.test`,
    passwordHash: "legacy-hash",
    role,
    isActive: true,
    forcePasswordChange: false,
    tokenVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe("tenancy backfill", () => {
  it("defaults legacy users to individual and maps admin → super_admin", async () => {
    await insertLegacyUser("legacyadmin", "admin");
    await insertLegacyUser("legacystudent", "student");

    const report = await runTenancyBackfill();
    expect(report.usersDefaulted).toBe(2);
    expect(report.adminsMappedToSuperAdmin).toBe(1);

    const admin = await UserModel.findOne({ username: "legacyadmin" }).lean();
    if (!admin) throw new Error("admin missing");
    expect(admin.role).toBe(Role.SUPER_ADMIN);
    expect(admin.userType).toBe(UserType.INDIVIDUAL);
    expect(admin.college ?? null).toBeNull();
    // Untouched identity fields.
    expect(admin.email).toBe("legacyadmin@legacy.test");
    expect(admin.passwordHash).toBe("legacy-hash");

    const student = await UserModel.findOne({
      username: "legacystudent",
    }).lean();
    if (!student) throw new Error("student missing");
    expect(student.role).toBe(Role.STUDENT);
    expect(student.userType).toBe(UserType.INDIVIDUAL);
  });

  it("is idempotent — a second run modifies nothing", async () => {
    await insertLegacyUser("leg-admin-2", "admin");
    await insertLegacyUser("leg-student-2", "student");

    const first = await runTenancyBackfill();
    expect(first.usersDefaulted).toBe(2);
    expect(first.adminsMappedToSuperAdmin).toBe(1);

    const second = await runTenancyBackfill();
    expect(second.usersDefaulted).toBe(0);
    expect(second.adminsMappedToSuperAdmin).toBe(0);

    // Data is stable across the second run.
    const admin = await UserModel.findOne({ username: "leg-admin-2" }).lean();
    expect(admin?.role).toBe(Role.SUPER_ADMIN);
    expect(admin?.userType).toBe(UserType.INDIVIDUAL);
  });

  it("does not touch other collections", async () => {
    await SubjectModel.create({ name: "Keep Me", slug: "keep-me", price: 4200 });
    await insertLegacyUser("leg-admin-3", "admin");

    await runTenancyBackfill();

    expect(await SubjectModel.countDocuments()).toBe(1);
    const subject = await SubjectModel.findOne({ slug: "keep-me" }).lean();
    expect(subject?.price).toBe(4200);
  });
});
