/**
 * My-results derivation — proves the student results view counts only COMPLETED
 * work (graded exams / scored essays), drops in-progress or unattempted items,
 * and orders exams before essays. Pure; no network.
 */
import type { EssayPromptSummary, ExamListItem } from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import { buildStudentResults } from "../src/lib/student-results.js";

function exam(over: Partial<ExamListItem> & { id: string }): ExamListItem {
  return {
    id: over.id,
    topicId: "",
    title: over.title ?? `Exam ${over.id}`,
    totalMarks: over.totalMarks ?? 100,
    passPercentage: 40,
    sectionCount: 1,
    questionCount: 10,
    totalDurationMinutes: 60,
    accessCodeEnabled: false,
    attemptsUsed: 1,
    maxAttempts: 1,
    lastAttempt: over.lastAttempt ?? null,
  };
}

function essay(
  over: Partial<EssayPromptSummary> & { id: string },
): EssayPromptSummary {
  return {
    id: over.id,
    topicId: "",
    title: over.title ?? `Essay ${over.id}`,
    description: "",
    difficultyLevel: "medium",
    minWords: 0,
    maxWords: 0,
    timeLimitMinutes: 0,
    maxAttempts: 3,
    attemptsUsed: 1,
    lastAttempt: over.lastAttempt ?? null,
  };
}

describe("buildStudentResults", () => {
  it("includes graded exams + scored essays, drops incomplete, exams first", () => {
    const exams: ExamListItem[] = [
      exam({
        id: "e1",
        title: "Graded",
        totalMarks: 50,
        lastAttempt: { id: "a1", status: "graded", score: 42, passed: true },
      }),
      // in-progress → dropped
      exam({
        id: "e2",
        lastAttempt: { id: "a2", status: "in_progress", score: 0, passed: false },
      }),
      // never attempted → dropped
      exam({ id: "e3" }),
    ];
    const essays: EssayPromptSummary[] = [
      essay({
        id: "s1",
        title: "Written",
        lastAttempt: {
          id: "b1",
          attemptNumber: 1,
          status: "completed",
          finalScore: 88.5,
          source: "ai",
        },
      }),
      // not yet graded (no finalScore) → dropped
      essay({
        id: "s2",
        lastAttempt: {
          id: "b2",
          attemptNumber: 1,
          status: "grading",
          finalScore: null,
          source: null,
        },
      }),
    ];

    const rows = buildStudentResults(exams, essays);
    expect(rows).toHaveLength(2);
    // Exams first, then essays.
    expect(rows[0]).toEqual({
      kind: "exam",
      id: "e1",
      title: "Graded",
      score: 42,
      totalMarks: 50,
      passed: true,
    });
    expect(rows[1]).toEqual({
      kind: "essay",
      id: "s1",
      title: "Written",
      finalScore: 88.5,
    });
  });

  it("returns nothing when there is no completed work", () => {
    expect(buildStudentResults([], [])).toEqual([]);
    expect(buildStudentResults([exam({ id: "x" })], [essay({ id: "y" })])).toEqual(
      [],
    );
  });
});
