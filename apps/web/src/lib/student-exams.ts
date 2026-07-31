/**
 * Pure (React/DOM-free) helper for the student exam surface. A college student
 * sees TWO kinds of exams in one place: their published college exams (from the
 * tenant list) and any individual/enrollment exams (from the shared list). This
 * merges the two into one list, tagging each item with its source + the college
 * slug so the list cards and the runner know which START endpoint to call — the
 * shared /attempts/* runner is identical once an attempt exists, so only the
 * source of the LIST + START differs. Unit-tested in isolation.
 */
import type { ExamListItem } from "@codeapt/shared";

export type ExamSource = "individual" | "college";

export interface StudentExamItem extends ExamListItem {
  /** Which surface this exam came from — decides the start endpoint. */
  source: ExamSource;
  /** The college slug for a college exam (null for individual exams). */
  collegeSlug: string | null;
}

/**
 * Merge the student's college + individual exams into one display list. College
 * exams come FIRST (they're the ones assigned to the student's cohort), then
 * individual exams, each preserving its own order. When the student has no
 * college (individual user), `college` is empty and `collegeSlug` is null.
 */
export function mergeStudentExams(
  individual: readonly ExamListItem[],
  college: readonly ExamListItem[],
  collegeSlug: string | null,
): StudentExamItem[] {
  const collegeItems: StudentExamItem[] = college.map((item) => ({
    ...item,
    source: "college",
    collegeSlug,
  }));
  const individualItems: StudentExamItem[] = individual.map((item) => ({
    ...item,
    source: "individual",
    collegeSlug: null,
  }));
  return [...collegeItems, ...individualItems];
}
