/**
 * Pure ranking math for the admin coding leaderboard (Prompt 2). Framework-free
 * (no DB, no zod) so it is trivially unit-testable and reused by both the API
 * service and the Excel builder — mirroring the exam-analysis.ts split.
 *
 * HONESTY RULES (the whole point of the leaderboard being trustworthy):
 *  - Only a REAL `ok` stat with a non-null metric value is RANKED. A student who
 *    linked a handle but whose fetch is `never` / `not_found` / `error` (even if
 *    it carries a last-known number) is UNRANKED — never given a fabricated rank
 *    or a fake 0 that would outrank a genuine low score.
 *  - Ties break by the OTHER metric (desc), then by name (asc) — deterministic.
 */
import { CodingFetchStatus, type CodingMetric, type CodingPlatform } from "./enums.js";

/** The minimal per-platform stat the ranker needs (a subset of the stored one). */
export interface RankableStat {
  platform: CodingPlatform;
  status: CodingFetchStatus;
  rating: number | null;
  problemsSolved: number | null;
}

/** The minimal student shape the ranker needs. */
export interface RankableStudent {
  studentId: string;
  fullName: string;
  stats: RankableStat[];
}

export interface RankedEntry<T> {
  row: T;
  rank: number;
  value: number;
}

export interface RankOutcome<T> {
  ranked: RankedEntry<T>[];
  unranked: T[];
}

function metricValue(stat: RankableStat, metric: CodingMetric): number | null {
  const v = metric === "rating" ? stat.rating : stat.problemsSolved;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** The chosen-platform stat, only if it's a real `ok` reading (else null). */
export function rankedStatFor(
  stats: readonly RankableStat[],
  platform: CodingPlatform,
): RankableStat | null {
  const s = stats.find((x) => x.platform === platform);
  return s && s.status === CodingFetchStatus.OK ? s : null;
}

/** The rankable value for a student on the chosen platform+metric, or null. */
export function rankedValue(
  stats: readonly RankableStat[],
  platform: CodingPlatform,
  metric: CodingMetric,
): number | null {
  const s = rankedStatFor(stats, platform);
  return s ? metricValue(s, metric) : null;
}

/**
 * Split students into a ranked list (desc by the chosen metric, deterministic
 * tie-break) and an unranked list (no real `ok` value for that platform+metric),
 * the latter sorted by name. Ranks are dense 1..n over the ranked set only.
 */
export function rankByMetric<T extends RankableStudent>(
  students: readonly T[],
  platform: CodingPlatform,
  metric: CodingMetric,
): RankOutcome<T> {
  const other: CodingMetric = metric === "rating" ? "problemsSolved" : "rating";

  const scored = students.map((row) => ({
    row,
    value: rankedValue(row.stats, platform, metric),
  }));

  const rankable = scored.filter(
    (x): x is { row: T; value: number } => x.value !== null,
  );
  const unranked = scored
    .filter((x) => x.value === null)
    .map((x) => x.row)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  rankable.sort((a, b) => {
    if (b.value !== a.value) return b.value - a.value;
    const ao = rankedValue(a.row.stats, platform, other) ?? -1;
    const bo = rankedValue(b.row.stats, platform, other) ?? -1;
    if (bo !== ao) return bo - ao;
    return a.row.fullName.localeCompare(b.row.fullName);
  });

  return {
    ranked: rankable.map((x, i) => ({ row: x.row, rank: i + 1, value: x.value })),
    unranked,
  };
}
