/**
 * Pure (React/DOM-free) helper for the student careers surface. A college
 * student sees TWO kinds of postings in one place: their published, in-target
 * college postings (from the tenant list) and the global/individual postings
 * (from the shared paginated list). This merges the two into one list, tagging
 * each item with its source + the college slug so the cards + detail page know
 * which endpoints to call — the reused detail + apply flow is identical once
 * opened; only the LIST source + the `?c=<slug>` seam differ. Mirrors
 * `mergeStudentEssays` (Phase 4c-ii). Unit-tested.
 */
import type { PostingSummary } from "@codeapt/shared";

export type PostingSource = "individual" | "college";

export interface StudentPostingItem extends PostingSummary {
  /** Which surface this posting came from — decides the detail/apply endpoints. */
  source: PostingSource;
  /** The college slug for a college posting (null for individual postings). */
  collegeSlug: string | null;
}

/**
 * Merge the student's college + individual postings into one display list.
 * College postings come FIRST (they're targeted at the student's cohort), then
 * individual postings, each preserving its own order. When the student has no
 * college (individual user), `college` is empty and `collegeSlug` is null.
 */
export function mergeStudentPostings(
  individual: readonly PostingSummary[],
  college: readonly PostingSummary[],
  collegeSlug: string | null,
): StudentPostingItem[] {
  const collegeItems: StudentPostingItem[] = college.map((item) => ({
    ...item,
    source: "college",
    collegeSlug,
  }));
  const individualItems: StudentPostingItem[] = individual.map((item) => ({
    ...item,
    source: "individual",
    collegeSlug: null,
  }));
  return [...collegeItems, ...individualItems];
}
