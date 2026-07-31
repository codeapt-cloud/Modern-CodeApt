/**
 * Attendance module — pure, framework-free helpers (no mongoose, no express) the
 * API uses for group membership assembly and that unit-test in isolation.
 *
 * The membership of a group is the de-duplicated UNION of everyone added by any
 * method (org-unit, section, individual, Excel). A student added by more than one
 * method appears ONCE, keeping the FIRST source that introduced them (stable,
 * order-preserving) — so provenance is deterministic regardless of overlap.
 */
import type { AttendanceMemberSource } from "./enums.js";

/** A membership candidate before de-duplication. */
export interface MemberCandidate {
  studentId: string;
  source: AttendanceMemberSource;
  /** Org-unit id for org_unit/section sources; null for individual/excel. */
  sourceRef: string | null;
}

/**
 * De-duplicate membership candidates by studentId, keeping the FIRST occurrence
 * (its source + ref win). Order is preserved. Callers concatenate candidates in
 * their intended precedence (e.g. org-units, then individuals, then Excel) and
 * this collapses overlaps to one membership per student.
 */
export function dedupeMembers(
  candidates: readonly MemberCandidate[],
): MemberCandidate[] {
  const seen = new Set<string>();
  const out: MemberCandidate[] = [];
  for (const c of candidates) {
    if (seen.has(c.studentId)) continue;
    seen.add(c.studentId);
    out.push(c);
  }
  return out;
}

/**
 * Normalize a roll number for matching (trim; drop empties handled by caller).
 * Matching itself is exact against stored `User.rollNumber` — kept as a hook so
 * the preview and the create path normalize identically.
 */
export function normalizeRollNumber(raw: string): string {
  return (raw ?? "").trim();
}

/** De-duplicate + normalize a list of roll numbers, dropping blanks. */
export function uniqueRollNumbers(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const n = normalizeRollNumber(r);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * Tally present/absent over a session's records against the CURRENT roster size
 * (Prompt 2). `total` is the roster; `present` counts present records for members;
 * `absent` is the remainder of the roster (unmarked members count as absent).
 */
export function tallyAttendance(
  statuses: readonly ("present" | "absent")[],
  total: number,
): { present: number; absent: number; total: number } {
  const present = statuses.filter((s) => s === "present").length;
  const safeTotal = Math.max(total, present);
  return { present, absent: Math.max(0, safeTotal - present), total: safeTotal };
}

/**
 * A rounded attendance rate (%) over ACTUALLY-RECORDED sessions, or `null` when
 * there is no data (total === 0) — the HONEST "no data", never a fake 0%. One
 * decimal place. `attended`/`total` are counts of a student's (or cohort's)
 * present marks over their completed-session records.
 */
export function attendanceRate(attended: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((attended / total) * 1000) / 10;
}

/** True when a real rate is strictly below the threshold. `null` (no data) is
 * NOT below — you can't flag a student with no recorded sessions as a defaulter. */
export function isBelowThreshold(
  rate: number | null,
  threshold: number,
): boolean {
  return rate !== null && rate < threshold;
}
