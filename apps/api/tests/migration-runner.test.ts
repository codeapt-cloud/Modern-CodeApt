/**
 * Migration RUNNER guard/support unit tests — no live DB.
 *
 * Covers the production double-confirm guard, the Postgres READ-ONLY session
 * enforcement (issued before any read, verified), and the index registry shape.
 * The runner's actual DB orchestration is not exercised here (it needs a live
 * Neon + Mongo); the transforms have their own suite.
 */
import { describe, expect, it } from "vitest";

import { MigrationReport } from "../src/migration/report.js";
import {
  INDEXES,
  READ_ONLY_STATEMENTS,
  applyReadOnlySession,
  indexKeyLabel,
  parseFlags,
  productionGuardError,
  type PgLike,
} from "../src/migration/runner-support.js";

describe("production double-confirm guard", () => {
  it("allows the default dry run (no flags)", () => {
    expect(productionGuardError(parseFlags([]))).toBeNull();
    expect(productionGuardError(parseFlags(["--wipe"]))).toBeNull();
  });

  it("requires BOTH --production and --confirm-wipe", () => {
    // --production alone → refuse
    const only = parseFlags(["--production"]);
    expect(only.production).toBe(true);
    expect(only.confirmWipe).toBe(false);
    expect(productionGuardError(only)).toMatch(/confirm-wipe/);

    // both → proceed
    const both = parseFlags(["--production", "--confirm-wipe"]);
    expect(productionGuardError(both)).toBeNull();
  });

  it("does not treat --confirm-wipe alone as production", () => {
    const flags = parseFlags(["--confirm-wipe"]);
    expect(flags.production).toBe(false);
    expect(productionGuardError(flags)).toBeNull(); // stays a dry run
  });
});

describe("Postgres read-only session enforcement", () => {
  /** Records every SQL statement issued; answers SHOW with a chosen value. */
  function fakeClient(readOnlyValue: string): {
    client: PgLike;
    queries: string[];
  } {
    const queries: string[] = [];
    const client: PgLike = {
      query(sql: string) {
        queries.push(sql);
        if (sql.startsWith("SHOW")) {
          return Promise.resolve({
            rows: [{ default_transaction_read_only: readOnlyValue }],
          });
        }
        return Promise.resolve({ rows: [] });
      },
    };
    return { client, queries };
  }

  it("issues the read-only SET statements and verifies them (before any read)", async () => {
    const { client, queries } = fakeClient("on");
    await applyReadOnlySession(client);
    // The two enforcement SETs were issued…
    for (const stmt of READ_ONLY_STATEMENTS) {
      expect(queries).toContain(stmt);
    }
    // …then a verification SHOW, and no table SELECT happened here.
    expect(queries[queries.length - 1]).toMatch(/^SHOW /);
    expect(queries.some((q) => /select \* from/i.test(q))).toBe(false);
  });

  it("throws if read-only could not be verified (so the run aborts before reads)", async () => {
    const { client } = fakeClient("off");
    await expect(applyReadOnlySession(client)).rejects.toThrow(/read-only/i);
  });
});

describe("index registry", () => {
  const spec = (coll: string, key: string) =>
    (INDEXES[coll] ?? []).find((s) => indexKeyLabel(s.keys) === key);

  it("declares the critical unique indexes on the right collections", () => {
    const uniques = (coll: string): string[] =>
      (INDEXES[coll] ?? [])
        .filter((s) => s.options?.unique)
        .map((s) => indexKeyLabel(s.keys));

    expect(uniques("users")).toEqual(
      expect.arrayContaining(["username:1", "email:1"]),
    );
    expect(uniques("enrollments")).toContain("user:1,subject:1");
    expect(uniques("publicexamlinks")).toContain("accessToken:1");
    expect(uniques("dailysubmissions")).toContain("user:1,question:1");
    expect(uniques("essayattempts")).toContain(
      "user:1,essayTopic:1,attemptNumber:1",
    );
    expect(uniques("orders")).toContain("orderId:1");
    expect(uniques("coupons")).toContain("code:1");
    expect(uniques("exams")).toContain("topic:1");
  });

  it("makes email / rollNumber / slug PARTIAL-unique (blanks exempt, real values unique)", () => {
    const email = spec("users", "email:1");
    expect(email?.options?.unique).toBe(true);
    expect(email?.options?.partialFilterExpression).toEqual({ email: { $gt: "" } });

    const roll = spec("profiles", "rollNumber:1");
    expect(roll?.options?.unique).toBe(true);
    expect(roll?.options?.partialFilterExpression).toEqual({
      rollNumber: { $gt: "" },
    });

    const slug = spec("programs", "slug:1");
    expect(slug?.options?.unique).toBe(true);
    expect(slug?.options?.partialFilterExpression).toEqual({ slug: { $gt: "" } });

    // username stays a PLAIN unique index (no blanks in the data).
    expect(spec("users", "username:1")?.options?.partialFilterExpression).toBeUndefined();
  });

  it("carries the partial unique index for logged-in job applications", () => {
    const app = (INDEXES.jobapplications ?? []).find((s) => s.options?.unique);
    expect(app?.keys).toEqual({ job: 1, user: 1 });
    expect(app?.options?.partialFilterExpression).toEqual({
      user: { $exists: true },
    });
  });

  it("only references migrated collections (no runtime-only ones)", () => {
    // ExecutionJob / RefreshSession / ChallengeCodeAttempt are NOT migrated.
    expect(INDEXES.executionjobs).toBeUndefined();
    expect(INDEXES.refreshsessions).toBeUndefined();
  });
});

describe("critical link health (compared vs SOURCE non-null, not zero)", () => {
  it("is healthy when Mongo non-null >= source non-null (no links lost)", () => {
    const report = new MigrationReport();
    report.recordLinkHealth("examquestions.exam", 1296, 1296, "derived via section");
    report.recordLinkHealth("examsections.exam", 115, 115, "sections keep exam");
    expect(report.linksHealthy()).toBe(true);
    expect(report.render()).toContain(
      "[OK ] examquestions.exam: mongo=1296 ≥ source=1296",
    );
    expect(report.render()).not.toContain("LINK(S) LOST");
  });

  it("does NOT fail on legitimate source-nulls (the 11 sectionless questions)", () => {
    const report = new MigrationReport();
    // Source had 1296 non-null sections (11 genuinely null); Mongo matches.
    report.recordLinkHealth("examquestions.section", 1296, 1296, "source-nulls allowed");
    expect(report.linksHealthy()).toBe(true);
    expect(report.render()).toContain("[OK ] examquestions.section: mongo=1296 ≥ source=1296");
  });

  it("fails LOUDLY only when links are LOST vs source (the real regression)", () => {
    const report = new MigrationReport();
    // Source expected 1296 exam links but migration produced 0 (the old bug).
    report.recordLinkHealth("examquestions.exam", 1296, 0, "derived via section");
    expect(report.linksHealthy()).toBe(false);
    const text = report.render();
    expect(text).toContain("[FAIL] examquestions.exam: mongo=0 < source=1296");
    expect(text).toContain("1296 link(s) LOST");
    expect(text).toContain("CRITICAL LINK(S) LOST");
  });
});
