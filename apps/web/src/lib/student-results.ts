/**
 * Pure (React/DOM-free) helper for the college student's "My results" view. It
 * DERIVES the student's completed results from the SAME tenant student lists the
 * exams/essays sections already use — no new endpoint, no fabricated data:
 *   - an exam counts once it has a graded last attempt (score + pass/fail),
 *   - an essay counts once its last attempt has a final score.
 * Exams come first (mirrors the list ordering), then essays. Unit-tested.
 */
import type { EssayPromptSummary, ExamListItem } from "@codeapt/shared";

export interface ExamResultRow {
  kind: "exam";
  id: string;
  title: string;
  score: number;
  totalMarks: number;
  passed: boolean;
}

export interface EssayResultRow {
  kind: "essay";
  id: string;
  title: string;
  finalScore: number;
}

export type StudentResultRow = ExamResultRow | EssayResultRow;

export function buildStudentResults(
  exams: readonly ExamListItem[],
  essays: readonly EssayPromptSummary[],
): StudentResultRow[] {
  const examRows: ExamResultRow[] = exams
    .filter((e) => e.lastAttempt && e.lastAttempt.status === "graded")
    .map((e) => ({
      kind: "exam",
      id: e.id,
      title: e.title,
      score: e.lastAttempt!.score,
      totalMarks: e.totalMarks,
      passed: e.lastAttempt!.passed,
    }));
  const essayRows: EssayResultRow[] = essays
    .filter((e) => e.lastAttempt && e.lastAttempt.finalScore != null)
    .map((e) => ({
      kind: "essay",
      id: e.id,
      title: e.title,
      finalScore: e.lastAttempt!.finalScore as number,
    }));
  return [...examRows, ...essayRows];
}
