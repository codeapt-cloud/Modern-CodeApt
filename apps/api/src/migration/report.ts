/**
 * Migration validation report (pure accumulator — no I/O).
 *
 * The runner feeds it as it transforms/inserts each table; `render()` produces
 * the human-readable report the runner prints and writes to a file. Keeping it
 * pure makes both the transforms and the report assertable in unit tests
 * without a live database.
 */

export interface TableCount {
  logical: string;
  sourceRows: number;
  insertedDocs: number;
}

export interface EnumFlag {
  table: string;
  field: string;
  sourceValue: string;
  fallback: string;
  count: number;
}

export interface UnresolvedFk {
  table: string;
  field: string;
  count: number;
}

export interface MoneySpot {
  table: string;
  field: string;
  source: string;
  paise: number;
}

export interface RelationshipCheck {
  table: string;
  detail: string;
  ok: boolean;
}

export interface IndexResult {
  collection: string;
  key: string;
  ok: boolean;
  message?: string;
}

export interface CountVerify {
  logical: string;
  pgCount: number;
  mongoCount: number;
}

export interface LinkHealth {
  /** e.g. "examquestions.exam". */
  link: string;
  /** Non-null values the SOURCE (Postgres) had for this link. */
  sourceNonNull: number;
  /** Non-null values that landed in Mongo for this link. */
  mongoNonNull: number;
  /** Healthy when we didn't LOSE links: mongoNonNull >= sourceNonNull. */
  ok: boolean;
  note: string;
}

export class MigrationReport {
  readonly tables: TableCount[] = [];
  readonly enumFlags = new Map<string, EnumFlag>();
  readonly unresolvedFks = new Map<string, UnresolvedFk>();
  readonly preserved = new Map<string, Set<string>>();
  readonly moneySpots: MoneySpot[] = [];
  readonly admins: { username: string; email: string }[] = [];
  readonly relationshipChecks: RelationshipCheck[] = [];
  readonly indexResults: IndexResult[] = [];
  readonly countVerifies: CountVerify[] = [];
  readonly linkHealth: LinkHealth[] = [];
  private readonly moneySpotCap = 5;

  recordTable(logical: string, sourceRows: number, insertedDocs: number): void {
    this.tables.push({ logical, sourceRows, insertedDocs });
  }

  /** An enum value with no target mapping — flagged, never silently dropped. */
  flagEnum(
    table: string,
    field: string,
    sourceValue: string,
    fallback: string,
  ): void {
    const key = `${table}.${field}=${sourceValue}`;
    const existing = this.enumFlags.get(key);
    if (existing) existing.count += 1;
    else
      this.enumFlags.set(key, {
        table,
        field,
        sourceValue,
        fallback,
        count: 1,
      });
  }

  /** A non-null source FK that did not resolve to a migrated parent. */
  flagUnresolvedFk(table: string, field: string): void {
    const key = `${table}.${field}`;
    const existing = this.unresolvedFks.get(key);
    if (existing) existing.count += 1;
    else this.unresolvedFks.set(key, { table, field, count: 1 });
  }

  /** Source columns that had no native target and were stashed in `_migrated`. */
  recordPreserved(table: string, columns: Iterable<string>): void {
    let set = this.preserved.get(table);
    if (!set) {
      set = new Set();
      this.preserved.set(table, set);
    }
    for (const c of columns) set.add(c);
  }

  /** Keep a few money conversions per table for eyeball verification. */
  spotMoney(table: string, field: string, source: string, paise: number): void {
    const seen = this.moneySpots.filter(
      (m) => m.table === table && m.field === field,
    ).length;
    if (seen < this.moneySpotCap) {
      this.moneySpots.push({ table, field, source, paise });
    }
  }

  recordAdmin(username: string, email: string): void {
    this.admins.push({ username, email });
  }

  recordRelationshipCheck(table: string, detail: string, ok: boolean): void {
    this.relationshipChecks.push({ table, detail, ok });
  }

  /** Result of a post-insert index build (unique dups surface here). */
  recordIndex(collection: string, key: string, ok: boolean, message?: string): void {
    this.indexResults.push({ collection, key, ok, message });
  }

  /** Post-insert re-count of the REAL Mongo vs the PG source (production). */
  recordCountVerify(logical: string, pgCount: number, mongoCount: number): void {
    this.countVerifies.push({ logical, pgCount, mongoCount });
  }

  /**
   * Health of a critical/derived FK, compared AGAINST THE SOURCE: healthy when
   * Mongo has at least as many non-null values as Postgres did (no links lost).
   * Legitimate source-nulls (e.g. sectionless draft questions) are excluded on
   * both sides, so they never trigger a failure.
   */
  recordLinkHealth(
    link: string,
    sourceNonNull: number,
    mongoNonNull: number,
    note: string,
  ): void {
    this.linkHealth.push({
      link,
      sourceNonNull,
      mongoNonNull,
      ok: mongoNonNull >= sourceNonNull,
      note,
    });
  }

  /** True when no critical link lost values relative to the source. */
  linksHealthy(): boolean {
    return this.linkHealth.every((l) => l.ok);
  }

  /** True when every table's inserted count equals its source-row count. */
  countsMatch(): boolean {
    return this.tables.every((t) => t.sourceRows === t.insertedDocs);
  }

  render(): string {
    const L: string[] = [];
    const h = (s: string): void => {
      L.push("", `== ${s} ==`);
    };

    L.push("CodeApt Neon → Mongo migration — DRY-RUN validation report");
    L.push("(reads Postgres read-only; writes a scratch Mongo DB only)");

    h("Row counts (source vs inserted — must match)");
    for (const t of this.tables) {
      const flag = t.sourceRows === t.insertedDocs ? "OK " : "MISMATCH";
      L.push(
        `  [${flag}] ${t.logical.padEnd(20)} source=${t.sourceRows}  inserted=${t.insertedDocs}`,
      );
    }
    L.push(
      this.countsMatch()
        ? "  → all tables balanced."
        : "  → COUNT MISMATCH — investigate before any real run.",
    );

    h("Relationship spot-checks (child FK → parent resolves)");
    if (this.relationshipChecks.length === 0) {
      L.push("  (none run)");
    } else {
      for (const c of this.relationshipChecks) {
        L.push(`  [${c.ok ? "OK " : "BAD"}] ${c.table}: ${c.detail}`);
      }
    }

    h("Critical link health (Mongo non-null vs SOURCE non-null — no links lost)");
    if (this.linkHealth.length === 0) {
      L.push("  (none run)");
    } else {
      for (const l of this.linkHealth) {
        L.push(
          l.ok
            ? `  [OK ] ${l.link}: mongo=${l.mongoNonNull} ≥ source=${l.sourceNonNull} (${l.note})`
            : `  [FAIL] ${l.link}: mongo=${l.mongoNonNull} < source=${l.sourceNonNull} — ${l.sourceNonNull - l.mongoNonNull} link(s) LOST — ${l.note}`,
        );
      }
      if (!this.linksHealthy()) {
        L.push(
          "  → CRITICAL LINK(S) LOST — a link present in the source is null in " +
            "Mongo. DO NOT treat this run as good; investigate the transform. " +
            "(Legitimate source-nulls are excluded, so this is real link loss.)",
        );
      }
    }

    h("Unresolved FKs (non-null source FK with no migrated parent)");
    if (this.unresolvedFks.size === 0) {
      L.push("  none — every non-null FK resolved.");
    } else {
      for (const u of this.unresolvedFks.values()) {
        L.push(`  ${u.table}.${u.field}: ${u.count} row(s) → set null`);
      }
    }

    h("Money spot-checks (source → integer paise)");
    if (this.moneySpots.length === 0) {
      L.push("  (none)");
    } else {
      for (const m of this.moneySpots) {
        L.push(`  ${m.table}.${m.field}: ${m.source} → ${m.paise} paise`);
      }
    }

    h("Flagged enum values (no target mapping)");
    if (this.enumFlags.size === 0) {
      L.push("  none — every enum value mapped.");
    } else {
      for (const f of this.enumFlags.values()) {
        L.push(
          `  ${f.table}.${f.field}: "${f.sourceValue}" (${f.count}×) → fallback "${f.fallback}"`,
        );
      }
    }

    if (this.countVerifies.length > 0) {
      h("Post-insert count verification (PG source vs REAL Mongo)");
      for (const c of this.countVerifies) {
        const ok = c.pgCount === c.mongoCount;
        L.push(
          `  [${ok ? "OK " : "MISMATCH"}] ${c.logical.padEnd(20)} pg=${c.pgCount}  mongo=${c.mongoCount}`,
        );
      }
    }

    if (this.indexResults.length > 0) {
      h("Index build results");
      for (const i of this.indexResults) {
        L.push(
          i.ok
            ? `  [OK ] ${i.collection}.${i.key}`
            : `  [FAIL] ${i.collection}.${i.key} — ${i.message ?? "unknown error"}`,
        );
      }
      const failed = this.indexResults.filter((i) => !i.ok);
      if (failed.length > 0) {
        L.push(
          `  → ${failed.length} index build(s) FAILED (likely a real-data duplicate — investigate).`,
        );
      }
    }

    h("Admin users (role=admin — eyeball this list)");
    if (this.admins.length === 0) {
      L.push("  none");
    } else {
      for (const a of this.admins) L.push(`  ${a.username} <${a.email}>`);
    }

    h("Preserved (unmapped) source columns → stashed under `_migrated`");
    if (this.preserved.size === 0) {
      L.push("  none");
    } else {
      for (const [table, cols] of this.preserved) {
        L.push(`  ${table}: ${[...cols].sort().join(", ")}`);
      }
    }

    return L.join("\n");
  }
}
