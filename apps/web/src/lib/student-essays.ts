/**
 * Pure (React/DOM-free) helper for the student essay surface. A college student
 * sees TWO kinds of essays in one place: their published college essays (from the
 * tenant list) and any individual/enrollment essays (from the shared list). This
 * merges the two into one list, tagging each item with its source + the college
 * slug so the list cards and the writer know which endpoints to call — the
 * reused writer is identical once opened; only the source of the LIST + the topic
 * endpoints differs. Mirrors `mergeStudentExams` (Phase 4b-ii-B). Unit-tested.
 */
import type { EssayPromptSummary } from "@codeapt/shared";

export type EssaySource = "individual" | "college";

export interface StudentEssayItem extends EssayPromptSummary {
  /** Which surface this essay came from — decides the writer endpoints. */
  source: EssaySource;
  /** The college slug for a college essay (null for individual essays). */
  collegeSlug: string | null;
}

/**
 * Merge the student's college + individual essays into one display list. College
 * essays come FIRST (they're assigned to the student's cohort), then individual
 * essays, each preserving its own order. When the student has no college
 * (individual user), `college` is empty and `collegeSlug` is null.
 */
export function mergeStudentEssays(
  individual: readonly EssayPromptSummary[],
  college: readonly EssayPromptSummary[],
  collegeSlug: string | null,
): StudentEssayItem[] {
  const collegeItems: StudentEssayItem[] = college.map((item) => ({
    ...item,
    source: "college",
    collegeSlug,
  }));
  const individualItems: StudentEssayItem[] = individual.map((item) => ({
    ...item,
    source: "individual",
    collegeSlug: null,
  }));
  return [...collegeItems, ...individualItems];
}
