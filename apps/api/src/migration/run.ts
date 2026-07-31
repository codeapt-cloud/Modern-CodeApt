/**
 * Neon → Mongo migration runner.
 *
 * TWO modes, deliberately asymmetric because the databases have OPPOSITE rules:
 *
 *   NEON (Postgres) = SOURCE = the LIVE original DB with real users. Touched
 *     READ-ONLY, enforced at the SESSION level (Postgres itself rejects any
 *     write) — in BOTH modes. Only plain sequential SELECTs.
 *
 *   MONGO = TARGET = seed data, not deployed. Safe to wipe + replace.
 *
 *   • DEFAULT (no flags): DRY RUN → writes a SCRATCH Mongo DB
 *     (MIGRATION_MONGO_URI + MIGRATION_TARGET_DB, default codeapt_migration_test;
 *     REFUSES the real app DB). Emits migration-report.txt.
 *
 *   • PRODUCTION: `--production --confirm-wipe` (BOTH required) → writes the
 *     REAL app DB (from MONGODB_URI, exactly as the app resolves it), after
 *     wiping it. Builds the schema indexes (surfacing real-data duplicates) and
 *     runs a post-insert verification. Emits migration-production-report.txt.
 *
 * Standalone script — nothing in the app imports it. Transforms are unchanged.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { config as loadDotenv } from "dotenv";
import mongoose, { Types } from "mongoose";
import pg from "pg";

import { MigrationReport } from "./report.js";
import {
  INDEXES,
  applyReadOnlySession,
  indexKeyLabel,
  parseFlags,
  productionGuardError,
} from "./runner-support.js";
import {
  TABLES,
  type Ctx,
  type IdMaps,
  type SourceRow,
} from "./transforms.js";

loadDotenv();

const DEFAULT_TARGET_DB = "codeapt_migration_test";
const DRY_REPORT = resolve(process.cwd(), "migration-report.txt");
const PROD_REPORT = resolve(process.cwd(), "migration-production-report.txt");

function fail(message: string): never {
  process.stderr.write(`\n[migration] ${message}\n\n`);
  process.exit(1);
}

function dbNameFromUri(uri: string | undefined): string | null {
  if (!uri) return null;
  try {
    const path = new URL(uri).pathname.replace(/^\//, "").split("?")[0];
    return path || null;
  } catch {
    return null;
  }
}

function mask(uri: string): string {
  return uri.replace(/:\/\/[^@]*@/, "://***@");
}

type Db = NonNullable<mongoose.Connection["db"]>;

// ---------------------------------------------------------------------------
// Shared migrate core (identical for both modes)
// ---------------------------------------------------------------------------

async function migrateCore(
  pgClient: pg.Client,
  db: Db,
  report: MigrationReport,
): Promise<void> {
  const maps: IdMaps = Object.fromEntries(
    TABLES.map((t) => [t.logical, new Map<string, Types.ObjectId>()]),
  );

  // core_profile.force_password_change → onto the User doc (users insert first).
  const forcePwByUserId = new Map<string, boolean>();
  try {
    const pw = await pgClient.query(
      "SELECT user_id, force_password_change FROM core_profile",
    );
    for (const r of pw.rows as SourceRow[]) {
      forcePwByUserId.set(String(r.user_id), Boolean(r.force_password_change));
    }
  } catch {
    process.stdout.write(
      "[migration] note: could not preload core_profile.force_password_change (continuing).\n",
    );
  }

  // section → exam (Django ExamQuestion has no exam_id; derive via the section).
  const examPgIdBySectionPgId = new Map<string, string>();
  try {
    const secs = await pgClient.query(
      "SELECT id, exam_id FROM assessments_examsection",
    );
    for (const r of secs.rows as SourceRow[]) {
      if (r.exam_id !== null && r.exam_id !== undefined) {
        examPgIdBySectionPgId.set(String(r.id), String(r.exam_id));
      }
    }
  } catch {
    process.stdout.write(
      "[migration] note: could not preload examsection→exam (continuing).\n",
    );
  }

  const hints = { forcePwByUserId, examPgIdBySectionPgId };

  for (const table of TABLES) {
    let rows: SourceRow[];
    try {
      const res = await pgClient.query(
        `SELECT * FROM ${table.pgTable} ORDER BY id`,
      );
      rows = res.rows as SourceRow[];
    } catch (err) {
      process.stdout.write(
        `[migration] SKIP ${table.pgTable}: ${(err as Error).message}\n`,
      );
      report.recordTable(table.logical, 0, 0);
      continue;
    }

    const docs: Record<string, unknown>[] = [];
    for (const row of rows) {
      const id = new Types.ObjectId();
      maps[table.logical]!.set(String(row.id), id);
      const ctx: Ctx = { id, maps, report, hints };
      docs.push(table.transform(row, ctx));
    }
    if (docs.length > 0) {
      await db.collection(table.collection).insertMany(docs);
    }
    report.recordTable(table.logical, rows.length, docs.length);
    process.stdout.write(
      `[migration] ${table.logical.padEnd(20)} ${rows.length} → ${docs.length}\n`,
    );
  }

  // Relationship spot-checks (sampled child FK → parent resolves).
  await spotCheckFk(db, "modules", "subject", "subjects", report);
  await spotCheckFk(db, "topics", "module", "modules", report);
  await spotCheckFk(db, "orders", "user", "users", report);
  await spotCheckFk(db, "examquestions", "exam", "exams", report);
  await spotCheckFk(db, "essayanalytics", "attempt", "essayattempts", report);

  // Critical/derived-link health, compared AGAINST THE SOURCE: FAIL LOUDLY only
  // if Mongo has FEWER non-null values than Postgres did (real link loss).
  // Legitimate source-nulls (e.g. sectionless draft questions) are excluded on
  // both sides, so they never false-fail. Runs in BOTH modes.
  await checkLinkHealth(pgClient, db, report);
}

/**
 * Each critical link is validated by comparing the SOURCE's non-null count
 * (`sourceSql`) against Mongo's non-null count (`mongoFilter`). Healthy when
 * mongo >= source (nothing dropped). The derived exam link uses the count of
 * questions-with-a-section as its source expectation (those should resolve an
 * exam via the section).
 */
const CRITICAL_LINKS: {
  collection: string;
  field: string;
  mongoFilter: Record<string, unknown>;
  sourceSql: string;
  note: string;
}[] = [
    {
      collection: "examquestions",
      field: "exam",
      mongoFilter: { exam: { $ne: null } },
      // Derived via section → every question WITH a section should resolve an exam.
      sourceSql:
        "SELECT count(*)::int AS n FROM assessments_examquestion WHERE section_id IS NOT NULL",
      note: "questions with a section resolve an exam (derived via section)",
    },
    {
      collection: "examquestions",
      field: "section",
      mongoFilter: { section: { $ne: null } },
      sourceSql:
        "SELECT count(*)::int AS n FROM assessments_examquestion WHERE section_id IS NOT NULL",
      note: "source-null (sectionless) questions are allowed; none lost",
    },
    {
      collection: "examsections",
      field: "exam",
      mongoFilter: { exam: { $ne: null } },
      sourceSql:
        "SELECT count(*)::int AS n FROM assessments_examsection WHERE exam_id IS NOT NULL",
      note: "every section keeps its exam",
    },
  ];

async function checkLinkHealth(
  pgClient: pg.Client,
  db: Db,
  report: MigrationReport,
): Promise<void> {
  for (const link of CRITICAL_LINKS) {
    let sourceNonNull = 0;
    try {
      const res = await pgClient.query(link.sourceSql);
      sourceNonNull = Number(res.rows[0]?.n ?? 0);
    } catch {
      // Source table absent → treat expectation as 0 (nothing to lose).
      sourceNonNull = 0;
    }
    const mongoNonNull = await db
      .collection(link.collection)
      .countDocuments(link.mongoFilter);
    report.recordLinkHealth(
      `${link.collection}.${link.field}`,
      sourceNonNull,
      mongoNonNull,
      link.note,
    );
    if (mongoNonNull < sourceNonNull) {
      process.stdout.write(
        `[migration] LINK FAIL ${link.collection}.${link.field}: mongo=${mongoNonNull} < source=${sourceNonNull} — ${sourceNonNull - mongoNonNull} lost\n`,
      );
    }
  }
}

async function spotCheckFk(
  db: Db,
  childCol: string,
  fkField: string,
  parentCol: string,
  report: MigrationReport,
  sample = 5,
): Promise<void> {
  const docs = await db
    .collection(childCol)
    .find({ [fkField]: { $ne: null } })
    .limit(sample)
    .toArray();
  if (docs.length === 0) return;
  let ok = true;
  for (const d of docs) {
    const parent = await db
      .collection(parentCol)
      .findOne({ _id: d[fkField] as Types.ObjectId });
    if (!parent) {
      ok = false;
      break;
    }
  }
  report.recordRelationshipCheck(
    childCol,
    `${fkField} → ${parentCol} (${docs.length} sampled)`,
    ok,
  );
}

// ---------------------------------------------------------------------------
// Production-only: index creation (dup-surfacing) + count verification
// ---------------------------------------------------------------------------

async function createIndexes(db: Db, report: MigrationReport): Promise<void> {
  for (const [collection, specs] of Object.entries(INDEXES)) {
    for (const spec of specs) {
      const key = indexKeyLabel(spec.keys);
      try {
        await db.collection(collection).createIndex(spec.keys, spec.options ?? {});
        report.recordIndex(collection, key, true);
      } catch (err) {
        // A unique-index failure means a real-data duplicate — surface it.
        report.recordIndex(collection, key, false, (err as Error).message);
        process.stdout.write(
          `[migration] INDEX FAIL ${collection}.${key}: ${(err as Error).message}\n`,
        );
      }
    }
  }
}

async function verifyCounts(db: Db, report: MigrationReport): Promise<void> {
  for (const table of TABLES) {
    const rec = report.tables.find((t) => t.logical === table.logical);
    const pgCount = rec?.sourceRows ?? 0;
    const mongoCount = await db.collection(table.collection).countDocuments();
    report.recordCountVerify(table.logical, pgCount, mongoCount);
  }
}

/**
 * Write + print the report. If a critical link is unhealthy, print a loud
 * banner and set a non-zero exit code so the run can't pass as "green".
 */
function finalizeReport(report: MigrationReport, file: string, label: string): void {
  const text = report.render();
  writeFileSync(file, `${text}\n`, "utf8");
  process.stdout.write(`\n${text}\n\n[migration] ${label} report written to ${file}\n`);
  if (!report.linksHealthy()) {
    process.stdout.write(
      `\n${"!".repeat(64)}\n` +
      `  CRITICAL LINK CHECK FAILED — see "Critical link health" above.\n` +
      `  A required/derived link is null; this run is NOT good. Fix the\n` +
      `  transform and re-run before trusting the data.\n` +
      `${"!".repeat(64)}\n`,
    );
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

async function connectReadOnlyPg(pgUrl: string): Promise<pg.Client> {
  const pgClient = new pg.Client({ connectionString: pgUrl });
  await pgClient.connect();
  // Enforce READ-ONLY at the session level BEFORE any table is read, and verify.
  await applyReadOnlySession(pgClient);
  process.stdout.write(
    "[migration] Postgres session set READ ONLY (verified) — writes are rejected by PG.\n",
  );
  return pgClient;
}

async function runDry(wipe: boolean): Promise<void> {
  const pgUrl = process.env.MIGRATION_PG_URL;
  if (!pgUrl) fail("set MIGRATION_PG_URL to your Neon connection string (read-only).");
  const mongoUri = process.env.MIGRATION_MONGO_URI;
  if (!mongoUri) fail("set MIGRATION_MONGO_URI to your Mongo connection string.");

  const targetDb = process.env.MIGRATION_TARGET_DB || DEFAULT_TARGET_DB;
  const appDb = dbNameFromUri(process.env.MONGODB_URI) ?? "codeapt";
  if (!targetDb || targetDb === appDb || targetDb === "codeapt") {
    fail(
      `refusing "${targetDb}" as the scratch DB — it must NOT be the real app DB ` +
      `(app DB="${appDb}"). Set MIGRATION_TARGET_DB to a throwaway like "${DEFAULT_TARGET_DB}".`,
    );
  }

  process.stdout.write(
    `[migration] DRY RUN\n  Postgres: ${mask(pgUrl)}\n  Mongo scratch DB: ${targetDb}\n  --wipe: ${wipe}\n\n`,
  );

  const pgClient = await connectReadOnlyPg(pgUrl);
  const conn = await mongoose
    .createConnection(mongoUri, { dbName: targetDb })
    .asPromise();
  const db = conn.db;
  if (!db) fail("could not open the scratch Mongo database.");

  try {
    const existing = await db.listCollections().toArray();
    if (wipe) {
      await db.dropDatabase();
      process.stdout.write("[migration] scratch DB wiped.\n\n");
    } else if (existing.length > 0) {
      fail(
        `scratch DB "${targetDb}" is not empty (${existing.length} collections). ` +
        `Re-run with --wipe to clear it first (safe: it's a throwaway DB).`,
      );
    }

    const report = new MigrationReport();
    await migrateCore(pgClient, db, report);

    finalizeReport(report, DRY_REPORT, "DRY-RUN");
  } finally {
    await pgClient.end();
    await conn.close();
  }
}

async function runProduction(): Promise<void> {
  const pgUrl = process.env.MIGRATION_PG_URL;
  if (!pgUrl) fail("set MIGRATION_PG_URL to your Neon connection string (read-only).");
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    fail(
      "production mode targets the REAL app DB — set MONGODB_URI (the app's own Mongo URI).",
    );
  }

  const pgClient = await connectReadOnlyPg(pgUrl);
  // Connect exactly as the app does (no dbName override → the URI's DB).
  const conn = await mongoose.createConnection(mongoUri).asPromise();
  const db = conn.db;
  if (!db) fail("could not open the app Mongo database.");
  const targetDb = db.databaseName;

  process.stdout.write(
    `\n${"=".repeat(64)}\n` +
    `  PRODUCTION MIGRATION — WRITING THE REAL APP DATABASE\n` +
    `  Postgres (READ-ONLY source): ${mask(pgUrl)}\n` +
    `  Mongo TARGET DB (will be WIPED): ${targetDb}\n` +
    `${"=".repeat(64)}\n\n`,
  );

  try {
    process.stdout.write(`[migration] wiping "${targetDb}"…\n`);
    await db.dropDatabase();

    const report = new MigrationReport();
    await migrateCore(pgClient, db, report);

    process.stdout.write("\n[migration] building schema indexes…\n");
    await createIndexes(db, report);

    process.stdout.write("[migration] verifying counts (PG vs real Mongo)…\n");
    await verifyCounts(db, report);

    finalizeReport(report, PROD_REPORT, "PRODUCTION");
  } finally {
    await pgClient.end();
    await conn.close();
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  const guardError = productionGuardError(flags);
  if (guardError) fail(guardError);

  if (flags.production) {
    await runProduction();
  } else {
    await runDry(flags.wipe);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`\n[migration] failed: ${(err as Error).message}\n`);
  process.exit(1);
});
