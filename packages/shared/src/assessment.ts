/**
 * Pure assessment grading + section-timer math. No I/O — deterministic
 * functions of the stored state, exhaustively unit-testable. The service layer
 * supplies the persisted values (answers, correctOptions, test results, and the
 * section start time).
 */
import { ExamQuestionType } from "./enums.js";

/**
 * Grade an MCQ answer. MCQ_SINGLE is a strict single-index match; MCQ_MULTI is
 * set-equality (order-independent, no partial credit). Returns whole marks or 0.
 */
export function gradeMcq(
  type: (typeof ExamQuestionType)[keyof typeof ExamQuestionType],
  selected: readonly number[],
  correct: readonly number[],
): boolean {
  const sel = [...new Set(selected)].sort((a, b) => a - b);
  const cor = [...new Set(correct)].sort((a, b) => a - b);
  if (type === ExamQuestionType.MCQ_SINGLE) {
    return sel.length === 1 && cor.length >= 1 && sel[0] === cor[0];
  }
  // MCQ_MULTI — exact set equality.
  return sel.length === cor.length && sel.every((v, i) => v === cor[i]);
}

/**
 * Proportional CODE marks: (passed / total) × marks, rounded to the nearest
 * integer. No test cases (total 0) scores 0.
 */
export function proportionalCodeMarks(
  passed: number,
  total: number,
  marks: number,
): number {
  if (total <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, passed / total));
  return Math.round(ratio * marks);
}

/**
 * Server-authoritative remaining seconds for a section: durationMinutes from
 * sectionStartTime, clamped at 0. `now` is injected so callers stay testable.
 */
export function sectionRemainingSeconds(
  sectionStartTime: Date,
  durationMinutes: number,
  now: Date,
): number {
  const elapsedMs = now.getTime() - sectionStartTime.getTime();
  const remainingMs = durationMinutes * 60_000 - elapsedMs;
  return Math.max(0, Math.floor(remainingMs / 1000));
}

/** Whether the section clock has run out (remaining === 0). */
export function isSectionExpired(
  sectionStartTime: Date,
  durationMinutes: number,
  now: Date,
): boolean {
  return sectionRemainingSeconds(sectionStartTime, durationMinutes, now) <= 0;
}

/** Apply the pass threshold: score/total ≥ passPercentage. */
export function isPassing(
  score: number,
  totalMarks: number,
  passPercentage: number,
): boolean {
  if (totalMarks <= 0) return false;
  return (score / totalMarks) * 100 >= passPercentage;
}
