/**
 * Pure (React/DOM-free) view helpers for the analytics dashboard (Phase 5a-ii).
 * They shape the flat 5a-i by-org-unit rollup list into dept→section navigation
 * and compute bar widths for the lightweight (no-dependency) comparison bars.
 * Kept pure so the shaping is unit-tested and the page stays declarative.
 */
import type { CollegeAnalyticsUnit } from "@codeapt/shared";

/** The department-level units (roots of the rollup tree), in returned order. */
export function departments(
  units: readonly CollegeAnalyticsUnit[],
): CollegeAnalyticsUnit[] {
  return units.filter((u) => u.type === "department");
}

/** The direct children of a unit (e.g. a department's sections/years). */
export function childrenOf(
  units: readonly CollegeAnalyticsUnit[],
  parentId: string,
): CollegeAnalyticsUnit[] {
  return units.filter((u) => u.parentId === parentId);
}

/** Look up one unit by id. */
export function unitById(
  units: readonly CollegeAnalyticsUnit[],
  id: string,
): CollegeAnalyticsUnit | undefined {
  return units.find((u) => u.id === id);
}

/**
 * A value's width as a 0-100 percentage of `max`, for a comparison bar. Returns
 * 0 when max is 0 (no data) and clamps to [0,100]. `max` is the largest value in
 * the compared set (so bars are relative), NOT a fabricated ceiling.
 */
export function barPercent(value: number, max: number): number {
  if (max <= 0) return 0;
  const p = (value / max) * 100;
  return Math.max(0, Math.min(100, Math.round(p * 10) / 10));
}

/** The max of a numeric list (0 for empty) — the scale for a bar comparison. */
export function maxOf(values: readonly number[]): number {
  return values.reduce((m, v) => (v > m ? v : m), 0);
}
