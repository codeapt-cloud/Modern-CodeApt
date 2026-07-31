/**
 * Pure (DB-free) rollup math for college analytics (Phase 5a). The service does
 * the tenant + faculty-scoped reads, then hands the raw rows here to be
 * aggregated into the metric shapes the DTOs expose. Keeping the math pure means
 * the "avg / pass-rate / distinct-count" logic is one unit-tested place, and the
 * service stays a thin data-fetch layer. Every metric is computed ONLY from real
 * fields — no fabricated progress/completion.
 */
import type {
  AnalyticsChallengeMetric,
  AnalyticsCourseMetric,
  AnalyticsEssayMetric,
  AnalyticsExamMetric,
} from "@codeapt/shared";

/** Round to `dp` decimal places (banker-free, deterministic). */
export function round(value: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

/** Mean of a list, 0 for empty, rounded to `dp` places. */
export function mean(values: readonly number[], dp = 2): number {
  if (values.length === 0) return 0;
  return round(values.reduce((s, v) => s + v, 0) / values.length, dp);
}

/** `numerator / denominator` as a 0-100 percentage; 0 when denominator is 0. */
export function pct(numerator: number, denominator: number, dp = 1): number {
  if (denominator === 0) return 0;
  return round((numerator / denominator) * 100, dp);
}

/** Distinct count of a string key across rows. */
export function distinctCount(keys: readonly string[]): number {
  return new Set(keys).size;
}

export interface ExamRow {
  userId: string;
  score: number;
  passed: boolean;
}
export function aggregateExams(rows: readonly ExamRow[]): AnalyticsExamMetric {
  const attempts = rows.length;
  const passedCount = rows.filter((r) => r.passed).length;
  return {
    attempts,
    students: distinctCount(rows.map((r) => r.userId)),
    avgScore: mean(rows.map((r) => r.score)),
    passRate: pct(passedCount, attempts),
  };
}

export interface EssayRow {
  userId: string;
  finalScore: number;
  graded: boolean;
}
export function aggregateEssays(rows: readonly EssayRow[]): AnalyticsEssayMetric {
  const graded = rows.filter((r) => r.graded);
  return {
    submissions: rows.length,
    students: distinctCount(rows.map((r) => r.userId)),
    graded: graded.length,
    avgScore: mean(graded.map((r) => r.finalScore)),
  };
}

export interface CourseRow {
  userId: string;
}
export function aggregateCourses(
  rows: readonly CourseRow[],
): AnalyticsCourseMetric {
  return {
    assignments: rows.length,
    students: distinctCount(rows.map((r) => r.userId)),
  };
}

export interface StreakRow {
  userId: string;
  totalScore: number;
  currentStreak: number;
  maxStreak: number;
}
export function aggregateChallenges(
  rows: readonly StreakRow[],
): AnalyticsChallengeMetric {
  return {
    participants: rows.length,
    avgScore: mean(rows.map((r) => r.totalScore)),
    avgCurrentStreak: mean(rows.map((r) => r.currentStreak)),
  };
}
