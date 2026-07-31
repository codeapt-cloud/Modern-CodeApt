/**
 * Tenancy backfill — makes existing B2C users first-class under the new
 * multi-tenant model, ADDITIVELY and IDEMPOTENTLY, touching nothing else.
 *
 *   pnpm --filter @codeapt/api backfill:tenancy
 *
 * What it does (and ONLY this):
 *   1. Every user that predates the tenancy fields gets userType=individual,
 *      college=null, facultyScope={orgUnits:[]} — i.e. they stay pure B2C.
 *   2. Legacy platform admins (role "admin") are mapped to "super_admin"
 *      (equivalent authority). Students stay students.
 *
 * Idempotent: re-running matches nothing new and cannot corrupt data. No other
 * collection or field is read or written. See docs/MULTI_TENANT_ARCHITECTURE.md.
 */
import { Role, UserType } from "@codeapt/shared";

import { connectDatabase, disconnectDatabase } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { UserModel } from "../models/user.model.js";

export interface TenancyBackfillReport {
  /** Users that received the additive individual/tenancy defaults. */
  usersDefaulted: number;
  /** Legacy `admin` users mapped to `super_admin`. */
  adminsMappedToSuperAdmin: number;
}

/**
 * The core, side-effect-scoped backfill. Assumes a live mongoose connection so
 * it is callable from tests (idempotency is asserted there). Safe to run twice.
 */
export async function runTenancyBackfill(): Promise<TenancyBackfillReport> {
  // 1) Additive defaults for any user predating the tenancy fields. Only
  //    documents WITHOUT userType are touched, so post-schema users (which
  //    already default to individual) and a second run match nothing.
  const defaulted = await UserModel.updateMany(
    { userType: { $exists: false } },
    {
      $set: {
        userType: UserType.INDIVIDUAL,
        college: null,
        facultyScope: { orgUnits: [] },
      },
    },
  );

  // 2) Map legacy platform admins → super_admin (same authority). Idempotent:
  //    once mapped, no document has role "admin" anymore.
  const admins = await UserModel.updateMany(
    { role: Role.ADMIN },
    { $set: { role: Role.SUPER_ADMIN } },
  );

  return {
    usersDefaulted: defaulted.modifiedCount,
    adminsMappedToSuperAdmin: admins.modifiedCount,
  };
}

async function main(): Promise<void> {
  await connectDatabase();
  try {
    const report = await runTenancyBackfill();
    logger.info(
      report,
      "tenancy backfill complete (individual defaults + admin→super_admin)",
    );
  } finally {
    await disconnectDatabase();
  }
}

// Run as a CLI only when invoked directly (not when imported by a test).
const invokedDirectly = process.argv[1]?.includes("backfill-tenancy");
if (invokedDirectly) {
  main()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      logger.error({ err }, "backfill:tenancy failed");
      process.exit(1);
    });
}
