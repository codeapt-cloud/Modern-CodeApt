/**
 * Pure exam-status derivations shared by every surface that shows an exam's
 * take/attempt state — the Mock Exams page card and the in-course exam launcher.
 * Both read the SAME `ExamListItem` (from GET /exams) so "Start exam" vs
 * "Attempt limit reached" is computed identically everywhere.
 */
import type { ExamListItem } from "@codeapt/shared";

type AttemptFields = Pick<ExamListItem, "attemptsUsed" | "maxAttempts">;

/** Attempts remaining before the limit is reached. */
export function attemptsLeft(item: AttemptFields): number {
  return item.maxAttempts - item.attemptsUsed;
}

/** Whether the student may still start (or retake) this exam. */
export function examCanStart(item: AttemptFields): boolean {
  return attemptsLeft(item) > 0;
}

/** Whether at least one attempt has been used (drives "Start" vs "Retake"). */
export function examAttempted(item: Pick<ExamListItem, "attemptsUsed">): boolean {
  return item.attemptsUsed > 0;
}
