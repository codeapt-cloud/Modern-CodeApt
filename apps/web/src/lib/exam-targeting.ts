/**
 * Pure (React/DOM-free) helpers for college-exam org-unit targeting. A college
 * exam targets either the WHOLE college (empty target) or a set of specific
 * org-units. These helpers turn a selected-id list into readable chips and
 * answer whether a target selection is valid for the acting role, so both the
 * targeting picker and the exam list render targeting consistently and the rule
 * lives in one unit-tested place.
 *
 * Role rule (mirrors the backend): a college_admin may target any units OR none
 * (empty = college-wide); a faculty member MUST target at least one unit within
 * their scope. Scope membership itself is enforced server-side (the client tree
 * shows all units), so `canTarget` only encodes the "faculty needs ≥1" rule.
 */
import type { FlatOrgUnit } from "./org-structure-ui.js";

export interface TargetSummary {
  /** True when no specific units are targeted → the whole college. */
  collegeWide: boolean;
  /** Human-readable path labels for each targeted unit (empty when college-wide). */
  labels: string[];
}

/**
 * Describe a target selection for display. Unknown ids (e.g. a unit deleted
 * after the exam was authored) fall back to a stable placeholder rather than
 * being dropped, so the count never silently shrinks.
 */
export function summarizeTargets(
  orgUnitIds: readonly string[],
  flat: readonly FlatOrgUnit[],
): TargetSummary {
  if (orgUnitIds.length === 0) return { collegeWide: true, labels: [] };
  const pathById = new Map(flat.map((u) => [u.id, u.path]));
  return {
    collegeWide: false,
    labels: orgUnitIds.map((id) => pathById.get(id) ?? "Unknown unit"),
  };
}

/**
 * Whether `orgUnitIds` is a valid target for the acting role. A college_admin
 * may leave it empty (college-wide); a faculty member must pick at least one.
 */
export function canTarget(
  orgUnitIds: readonly string[],
  isAdmin: boolean,
): boolean {
  return isAdmin || orgUnitIds.length > 0;
}

/** Toggle one unit id in a selection, returning a NEW array (stable order). */
export function toggleTarget(
  orgUnitIds: readonly string[],
  id: string,
): string[] {
  return orgUnitIds.includes(id)
    ? orgUnitIds.filter((x) => x !== id)
    : [...orgUnitIds, id];
}
