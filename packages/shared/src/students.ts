/**
 * College-student + bulk-import pure logic (Phase 3) — framework-free helpers the
 * API uses for the import pipeline and faculty-scope resolution, and that are
 * unit-tested in isolation. No mongoose, no express.
 *
 * The import pipeline is PARSE-AGNOSTIC: the UI (Phase 3b) turns an uploaded file
 * OR a pasted table into an array of raw `{ fullName, email, rollNumber, orgUnit }`
 * rows, and the backend validates/previews/commits those rows — it never parses a
 * file format itself. `orgUnit` is a human key: a slash-separated PATH
 * ("CSE / 2026 / A") or a bare unit name when unambiguous, matched (via
 * {@link normalizeUnitKey}) against the college's org tree.
 */

/** The exact column headers the import template + parser expect. */
export const STUDENT_IMPORT_HEADERS = [
  "fullName",
  "email",
  "rollNumber",
  "orgUnit",
] as const;

/** A raw import row as produced by the UI (file or paste) — all strings. */
export interface StudentImportRowInput {
  fullName: string;
  email: string;
  rollNumber: string;
  /** Org-unit path ("CSE / 2026 / A") or a unique bare name. */
  orgUnit: string;
}

/** A validated, trimmed/normalized row. */
export interface NormalizedStudentRow {
  fullName: string;
  email: string;
  rollNumber: string;
  orgUnit: string;
}

export interface StudentRowValidation {
  ok: boolean;
  errors: string[];
  value: NormalizedStudentRow;
}

// A pragmatic email shape check (mirrors zod's email leniency without pulling zod
// into this pure module). Full RFC validation is neither needed nor desirable.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate one raw import row's FIELDS (not its org-unit resolution or
 * duplicates — those need the tenant tree + DB and are done in the service). Pure
 * + deterministic, reused by both preview and commit so their verdicts agree.
 */
export function validateStudentImportRow(
  raw: StudentImportRowInput,
): StudentRowValidation {
  const value: NormalizedStudentRow = {
    fullName: (raw.fullName ?? "").trim(),
    email: (raw.email ?? "").trim().toLowerCase(),
    rollNumber: (raw.rollNumber ?? "").trim(),
    orgUnit: (raw.orgUnit ?? "").trim(),
  };
  const errors: string[] = [];
  if (!value.fullName) errors.push("Full name is required");
  if (!value.email) errors.push("Email is required");
  else if (!EMAIL_RE.test(value.email)) errors.push("Email is not valid");
  if (!value.rollNumber) errors.push("Roll number is required");
  if (!value.orgUnit) errors.push("Org-unit is required");
  return { ok: errors.length === 0, errors, value };
}

/**
 * Canonical key for matching an org-unit reference. Splits on "/", trims each
 * segment, drops empties, joins with " / ", lowercased — so "CSE / 2026 / A",
 * "cse/2026/a" and " CSE /2026/ A " all match, and a bare "CSE" → "cse". The
 * service builds the same key for every unit's full path (and its bare name) to
 * resolve a row's `orgUnit` deterministically.
 */
export function normalizeUnitKey(raw: string): string {
  return (raw ?? "")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" / ")
    .toLowerCase();
}

/** A minimal parent-pointer view of an org-unit (id + its parent, or null). */
export interface UnitParentRef {
  id: string;
  parentId: string | null;
}

/**
 * The full set of unit ids a faculty member's scope covers: their assigned units
 * PLUS every descendant. Pure — operates on flat parent-pointer refs so it needs
 * no tree or mongoose. Stale/unknown assigned ids (not in `units`) are ignored.
 * A college_admin is unrestricted and never uses this (they see the whole tenant).
 */
export function collectDescendantUnitIds(
  units: readonly UnitParentRef[],
  assignedIds: readonly string[],
): string[] {
  const known = new Set(units.map((u) => u.id));
  const childrenOf = new Map<string, string[]>();
  for (const u of units) {
    if (u.parentId) {
      const list = childrenOf.get(u.parentId) ?? [];
      list.push(u.id);
      childrenOf.set(u.parentId, list);
    }
  }

  const result = new Set<string>();
  const queue: string[] = [];
  for (const id of assignedIds) {
    if (known.has(id) && !result.has(id)) {
      result.add(id);
      queue.push(id);
    }
  }
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const child of childrenOf.get(current) ?? []) {
      if (!result.has(child)) {
        result.add(child);
        queue.push(child);
      }
    }
  }
  return [...result];
}
