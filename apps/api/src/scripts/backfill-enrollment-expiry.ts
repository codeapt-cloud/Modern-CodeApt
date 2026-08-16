/**
 * Backfill `expiresAt` onto pre-existing enrollments now that courses carry a
 * `validityDays` window.
 *
 *   pnpm --filter @codeapt/api backfill:enrollment-expiry
 *
 * Policy (confirmed with the product owner): expiry counts FROM THE ORIGINAL
 * enrollment date — `expiresAt = enrollment.createdAt + subject.validityDays`.
 * Enrollments already older than the window get a past `expiresAt` and become
 * hidden/inaccessible immediately (a SOFT state — the row is kept, never
 * deleted, so raising validity or re-enrolling restores access).
 *
 * Only stamps enrollments whose `expiresAt` is still null AND whose subject has
 * a finite validity (`validityDays > 0`); lifetime courses (validityDays 0)
 * are left as null. Idempotent: a re-run matches nothing new because stamped
 * rows are no longer null.
 */
import { connectDatabase, disconnectDatabase } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { EnrollmentModel, SubjectModel } from "../models/curriculum.model.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface EnrollmentExpiryBackfillReport {
  subjectsWithValidity: number;
  enrollmentsStamped: number;
}

export async function runEnrollmentExpiryBackfill(): Promise<EnrollmentExpiryBackfillReport> {
  const subjects = await SubjectModel.find({
    validityDays: { $gt: 0 },
  }).select("_id validityDays");

  let enrollmentsStamped = 0;
  for (const subject of subjects) {
    // Pipeline update so each row's expiry is computed from its own createdAt.
    const res = await EnrollmentModel.updateMany(
      { subject: subject._id, expiresAt: null },
      [
        {
          $set: {
            expiresAt: {
              $add: ["$createdAt", subject.validityDays * DAY_MS],
            },
          },
        },
      ],
    );
    enrollmentsStamped += res.modifiedCount ?? 0;
  }

  return { subjectsWithValidity: subjects.length, enrollmentsStamped };
}

async function main(): Promise<void> {
  await connectDatabase();
  try {
    const report = await runEnrollmentExpiryBackfill();
    logger.info(
      report,
      "enrollment-expiry backfill complete (expiry counted from original enrollment date)",
    );
  } finally {
    await disconnectDatabase();
  }
}

const invokedDirectly = process.argv[1]?.includes("backfill-enrollment-expiry");
if (invokedDirectly) {
  main()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      logger.error({ err }, "backfill-enrollment-expiry failed");
      process.exit(1);
    });
}
