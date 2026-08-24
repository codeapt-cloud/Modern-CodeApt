/**
 * Backfill `verified: false` onto every existing CodingProfile stat now that the
 * leaderboard ranks only VERIFIED handles.
 *
 *   pnpm --filter @codeapt/api backfill:coding-verified
 *
 * Why this is needed even though the field defaults to false: leaderboard reads
 * use `.lean()`, which returns the raw BSON WITHOUT applying schema defaults — a
 * pre-existing stat has the field ABSENT (undefined), not false. The read-site
 * `?? false` coercions already make an absent field behave as unverified, but we
 * stamp the stored data explicitly so the DB is correct rather than relying on
 * falsiness at every reader (per the Step-17 decision).
 *
 * Policy (approved): mark ALL existing handles unverified. Verification never
 * existed, so no stored handle was ever proven — marking only the obvious
 * duplicates (e.g. two `tourist`, one `Benq`) would falsely imply the rest were
 * checked. Every linked handle becomes self-reported/unranked until a future
 * verification challenge proves ownership.
 *
 * Idempotent + non-destructive: the arrayFilter only touches stats whose
 * `verified` field is MISSING, so a re-run matches nothing new and a
 * (future) genuinely-verified stat is never reset to false.
 */
import { connectDatabase, disconnectDatabase } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { CodingProfileModel } from "../models/coding-profile.model.js";

export interface CodingVerifiedBackfillReport {
  profilesModified: number;
}

export async function runCodingVerifiedBackfill(): Promise<CodingVerifiedBackfillReport> {
  const res = await CodingProfileModel.updateMany(
    { "stats.verified": { $exists: false } },
    { $set: { "stats.$[s].verified": false } },
    { arrayFilters: [{ "s.verified": { $exists: false } }] },
  );
  return { profilesModified: res.modifiedCount ?? 0 };
}

async function main(): Promise<void> {
  await connectDatabase();
  try {
    const report = await runCodingVerifiedBackfill();
    logger.info(
      report,
      "coding-verified backfill complete (all existing handles marked unverified)",
    );
  } finally {
    await disconnectDatabase();
  }
}

const invokedDirectly = process.argv[1]?.includes("backfill-coding-verified");
if (invokedDirectly) {
  main()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      logger.error({ err }, "backfill-coding-verified failed");
      process.exit(1);
    });
}
