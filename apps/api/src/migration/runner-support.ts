/**
 * Runner support: pure/mockable helpers for the migration runner — CLI flag
 * parsing, the production double-confirm guard, the Postgres READ-ONLY session
 * enforcement, and the index registry created on the real collections. No
 * top-level side effects, so these are unit-testable without a live DB.
 */

// ---------------------------------------------------------------------------
// CLI flags + production double-confirm guard
// ---------------------------------------------------------------------------

export interface RunFlags {
  production: boolean;
  confirmWipe: boolean;
  wipe: boolean;
}

export function parseFlags(argv: readonly string[]): RunFlags {
  return {
    production: argv.includes("--production"),
    confirmWipe: argv.includes("--confirm-wipe"),
    wipe: argv.includes("--wipe"),
  };
}

/**
 * Production mode is deliberate: it requires BOTH --production and
 * --confirm-wipe. Returns an error message when the combination is invalid,
 * or null when it's fine (including the default dry-run: no --production).
 */
export function productionGuardError(flags: RunFlags): string | null {
  if (flags.production && !flags.confirmWipe) {
    return (
      "Production mode WIPES and rewrites the REAL app database. Pass BOTH " +
      "--production AND --confirm-wipe to proceed. Refusing — nothing touched."
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Postgres READ-ONLY enforcement (connection-level, not by convention)
// ---------------------------------------------------------------------------

/**
 * Statements that make the session reject ANY write at the Postgres level.
 * Issued right after connecting, BEFORE any table is read.
 */
export const READ_ONLY_STATEMENTS: readonly string[] = [
  "SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY",
  "SET default_transaction_read_only = on",
];

export interface PgLike {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/**
 * Force the Postgres session read-only and VERIFY it took effect. After this,
 * any INSERT/UPDATE/DDL is rejected by Postgres itself. Throws if verification
 * fails, so the caller aborts before touching the source data.
 */
export async function applyReadOnlySession(client: PgLike): Promise<void> {
  for (const stmt of READ_ONLY_STATEMENTS) {
    await client.query(stmt);
  }
  const res = await client.query("SHOW default_transaction_read_only");
  const value = res.rows[0]?.default_transaction_read_only;
  if (value !== "on") {
    throw new Error(
      `Postgres read-only enforcement could not be verified ` +
        `(default_transaction_read_only=${String(value)}). Aborting before any read.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Index registry — created on the real collections post-insert
// ---------------------------------------------------------------------------

export interface IndexSpec {
  keys: Record<string, 1 | -1>;
  options?: {
    unique?: boolean;
    partialFilterExpression?: Record<string, unknown>;
  };
}

/**
 * Every index the rebuild's Mongoose schemas declare on the migrated
 * collections. Raw inserts bypass mongoose, so these must be built explicitly
 * on the real DB after the data lands. Unique indexes are the ones that can
 * fail on real-data duplicates — those failures are surfaced in the report.
 */
export const INDEXES: Record<string, IndexSpec[]> = {
  users: [
    { keys: { username: 1 }, options: { unique: true } },
    // Partial-unique: 14 legacy users legitimately have no email; blanks are a
    // valid state, so uniqueness is enforced only on non-empty values.
    {
      keys: { email: 1 },
      options: { unique: true, partialFilterExpression: { email: { $gt: "" } } },
    },
    { keys: { role: 1 } },
  ],
  profiles: [
    { keys: { user: 1 }, options: { unique: true } },
    // Partial-unique: 23 legacy profiles have no roll number (admin/staff/older
    // accounts); enforce uniqueness only where a real value exists.
    {
      keys: { rollNumber: 1 },
      options: { unique: true, partialFilterExpression: { rollNumber: { $gt: "" } } },
    },
  ],
  programs: [
    // Partial-unique: a legacy program has a blank slug; real slugs stay unique.
    {
      keys: { slug: 1 },
      options: { unique: true, partialFilterExpression: { slug: { $gt: "" } } },
    },
    { keys: { isVisible: 1 } },
  ],
  subjects: [
    { keys: { slug: 1 }, options: { unique: true } },
    { keys: { isVisible: 1, isPopular: 1 } },
    { keys: { program: 1 } },
  ],
  modules: [{ keys: { subject: 1, order: 1 } }],
  topics: [{ keys: { module: 1, order: 1 } }, { keys: { topicType: 1 } }],
  questions: [{ keys: { subject: 1 } }],
  choices: [{ keys: { question: 1 } }],
  enrollments: [{ keys: { user: 1, subject: 1 }, options: { unique: true } }],
  topicprogresses: [{ keys: { user: 1, topic: 1 }, options: { unique: true } }],
  quizsubmissions: [{ keys: { user: 1, subject: 1 } }],
  orders: [
    { keys: { orderId: 1 }, options: { unique: true } },
    { keys: { user: 1, status: 1 } },
    { keys: { transactionId: 1 } },
  ],
  coupons: [
    { keys: { code: 1 }, options: { unique: true } },
    { keys: { active: 1 } },
  ],
  jobs: [{ keys: { isActive: 1, postedAt: -1 } }],
  jobapplications: [
    { keys: { job: 1, email: 1 } },
    { keys: { user: 1 } },
    {
      keys: { job: 1, user: 1 },
      options: { unique: true, partialFilterExpression: { user: { $exists: true } } },
    },
  ],
  // Partial unique index — MUST match the Mongoose schema (assessment.model.ts).
  // Individual/global exams are 1:1 with a Topic (unique); college exams are
  // standalone (topic ABSENT), so uniqueness must NOT apply to them — otherwise
  // a plain `topic_1 unique` treats every topic-less exam as `topic:null` and
  // rejects the 2nd college exam with E11000.
  exams: [
    {
      keys: { topic: 1 },
      options: { unique: true, partialFilterExpression: { topic: { $type: "objectId" } } },
    },
  ],
  examsections: [{ keys: { exam: 1, order: 1 } }],
  examquestions: [{ keys: { exam: 1 } }, { keys: { section: 1, order: 1 } }],
  examtestcases: [{ keys: { question: 1 } }],
  publicexamlinks: [
    { keys: { accessToken: 1 }, options: { unique: true } },
    { keys: { exam: 1 } },
  ],
  examattemptcounters: [{ keys: { user: 1, exam: 1 }, options: { unique: true } }],
  examattemptresetlogs: [{ keys: { user: 1, exam: 1 } }],
  studentexamattempts: [
    { keys: { attemptToken: 1 } },
    { keys: { exam: 1, user: 1 } },
    { keys: { status: 1 } },
    { keys: { publicLink: 1 } },
  ],
  dailyquestions: [{ keys: { releaseDate: 1 }, options: { unique: true } }],
  dailytestcases: [{ keys: { question: 1 } }],
  dailysubmissions: [{ keys: { user: 1, question: 1 }, options: { unique: true } }],
  userstreaks: [
    { keys: { user: 1 }, options: { unique: true } },
    { keys: { totalScore: -1, currentStreak: -1 } },
  ],
  essaytopics: [{ keys: { isActive: 1 } }],
  essayattempts: [
    { keys: { user: 1, essayTopic: 1, attemptNumber: 1 }, options: { unique: true } },
    { keys: { status: 1 } },
  ],
  essayanalytics: [{ keys: { attempt: 1 }, options: { unique: true } }],
  essaydrafts: [{ keys: { attempt: 1, savedAt: -1 } }],
};

/** Human-readable label for an index's key spec (for the report). */
export function indexKeyLabel(keys: Record<string, number>): string {
  return Object.entries(keys)
    .map(([k, v]) => `${k}:${v}`)
    .join(",");
}
