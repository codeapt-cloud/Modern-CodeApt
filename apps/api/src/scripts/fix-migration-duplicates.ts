/**
 * Resolve the real-data duplicates the Neon→Mongo migration SURFACES (it never
 * silently drops rows — it builds unique indexes post-insert and reports the
 * E11000 collisions). Two partial-unique indexes can fail on legacy dupes:
 *   • users.email        (unique on non-empty)
 *   • profiles.rollNumber (unique on non-empty)
 *
 *   pnpm --filter @codeapt/api fix:migration-dupes            # DRY RUN (prints, writes nothing)
 *   pnpm --filter @codeapt/api fix:migration-dupes --apply    # resolve + rebuild indexes
 *
 * Resolution (NON-LOSSY + idempotent): within each duplicated value, KEEP the
 * winner (earliest createdAt, then lowest _id) and for every other record move
 * its conflicting value into `_migrated.<field>Duplicate` (so the original is
 * preserved and reversible) then BLANK the live field — a blank falls outside
 * the partial-unique index, so both accounts survive and the constraint is freed.
 * Uses the native driver so the `_migrated` stash isn't stripped by schema strict
 * mode (mirroring how the migration wrote raw). On --apply it then (re)builds the
 * two partial-unique indexes; re-running matches nothing new.
 *
 * Reads MONGODB_URI (the app's own DB) exactly as the app resolves it.
 */
import type { Types } from "mongoose";

import { connectDatabase, disconnectDatabase } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { ProfileModel, UserModel } from "../models/user.model.js";

/** The native driver collection type (derived — avoids a direct `mongodb` dep). */
type RawCollection = typeof UserModel.collection;

interface GroupRow {
  _id: string;
  docs: { id: Types.ObjectId; createdAt?: Date | null }[];
}

interface FieldResolution {
  collection: string;
  field: string;
  value: string;
  keptId: string;
  blankedIds: string[];
}

/** Find every value shared by >1 non-blank document (the E11000 candidates). */
async function findDuplicates(
  coll: RawCollection,
  field: string,
): Promise<GroupRow[]> {
  return coll
    .aggregate<GroupRow>([
      { $match: { [field]: { $gt: "" } } },
      {
        $group: {
          _id: `$${field}`,
          docs: { $push: { id: "$_id", createdAt: "$createdAt" } },
          n: { $sum: 1 },
        },
      },
      { $match: { n: { $gt: 1 } } },
      { $sort: { _id: 1 } },
    ])
    .toArray();
}

/** Winner = earliest createdAt, then lowest _id (deterministic). */
function orderWinnerFirst(docs: GroupRow["docs"]): GroupRow["docs"] {
  return [...docs].sort((a, b) => {
    const at = a.createdAt ? new Date(a.createdAt).getTime() : Number.POSITIVE_INFINITY;
    const bt = b.createdAt ? new Date(b.createdAt).getTime() : Number.POSITIVE_INFINITY;
    if (at !== bt) return at - bt;
    return String(a.id).localeCompare(String(b.id));
  });
}

async function resolveField(
  coll: RawCollection,
  collectionLabel: string,
  field: string,
  apply: boolean,
): Promise<FieldResolution[]> {
  const groups = await findDuplicates(coll, field);
  const resolutions: FieldResolution[] = [];

  for (const g of groups) {
    const ordered = orderWinnerFirst(g.docs);
    const winner = ordered[0]!;
    const losers = ordered.slice(1);
    const stashKey = `_migrated.${field}Duplicate`;

    if (apply) {
      for (const loser of losers) {
        await coll.updateOne(
          { _id: loser.id },
          { $set: { [stashKey]: g._id, [field]: "" } },
        );
      }
    }
    resolutions.push({
      collection: collectionLabel,
      field,
      value: g._id,
      keptId: String(winner.id),
      blankedIds: losers.map((l) => String(l.id)),
    });
  }
  return resolutions;
}

/** (Re)build the two partial-unique indexes. Idempotent; succeeds once dupes are gone. */
async function rebuildIndexes(): Promise<void> {
  await UserModel.collection.createIndex(
    { email: 1 },
    { unique: true, partialFilterExpression: { email: { $gt: "" } } },
  );
  await ProfileModel.collection.createIndex(
    { rollNumber: 1 },
    { unique: true, partialFilterExpression: { rollNumber: { $gt: "" } } },
  );
}

export async function fixMigrationDuplicates(apply: boolean): Promise<FieldResolution[]> {
  const resolutions = [
    ...(await resolveField(UserModel.collection, "users", "email", apply)),
    ...(await resolveField(ProfileModel.collection, "profiles", "rollNumber", apply)),
  ];
  if (apply) await rebuildIndexes();
  return resolutions;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  await connectDatabase();
  try {
    const resolutions = await fixMigrationDuplicates(apply);
    if (resolutions.length === 0) {
      logger.info("No duplicate email / roll numbers found — nothing to fix.");
    } else {
      for (const r of resolutions) {
        logger.info(
          {
            collection: r.collection,
            field: r.field,
            value: r.value,
            kept: r.keptId,
            blanked: r.blankedIds,
          },
          `${apply ? "RESOLVED" : "WOULD RESOLVE"} ${r.collection}.${r.field}="${r.value}" ` +
            `(keep ${r.keptId}, free ${r.blankedIds.length} other(s))`,
        );
      }
    }
    logger.info(
      { apply, groups: resolutions.length },
      apply
        ? "duplicates resolved + partial-unique indexes rebuilt"
        : "DRY RUN — re-run with --apply to resolve + rebuild indexes",
    );
  } finally {
    await disconnectDatabase();
  }
}

const invokedDirectly = process.argv[1]?.includes("fix-migration-duplicates");
if (invokedDirectly) {
  main()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      logger.error({ err }, "fix-migration-duplicates failed");
      process.exit(1);
    });
}
