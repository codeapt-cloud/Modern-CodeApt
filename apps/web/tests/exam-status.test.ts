/**
 * Exam launch/attempt state — the SAME derivation drives the Mock Exams page
 * card and the in-course exam launcher (both render <ExamStatusCard> from an
 * `ExamListItem`). Locks: "Start exam" is offered while attempts remain and
 * "Attempt limit reached" once used ≥ limit.
 */
import type { ExamListItem } from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import {
  attemptsLeft,
  examAttempted,
  examCanStart,
} from "../src/lib/exam-status.js";

function item(over: Partial<ExamListItem> = {}): ExamListItem {
  return {
    id: "e1",
    topicId: "t1",
    title: "TCS Test 5",
    totalMarks: 105,
    passPercentage: 40,
    sectionCount: 3,
    questionCount: 40,
    totalDurationMinutes: 90,
    accessCodeEnabled: false,
    attemptsUsed: 0,
    maxAttempts: 1,
    lastAttempt: null,
    ...over,
  };
}

describe("exam launch state (shared by /exams and in-course)", () => {
  it("offers Start when attemptsUsed < limit", () => {
    const fresh = item({ attemptsUsed: 0, maxAttempts: 1 });
    expect(examCanStart(fresh)).toBe(true);
    expect(examAttempted(fresh)).toBe(false); // → "Start exam"
    expect(attemptsLeft(fresh)).toBe(1);
  });

  it("labels a used-but-not-exhausted exam as a Retake, still startable", () => {
    const retake = item({ attemptsUsed: 1, maxAttempts: 3 });
    expect(examCanStart(retake)).toBe(true);
    expect(examAttempted(retake)).toBe(true); // → "Retake"
    expect(attemptsLeft(retake)).toBe(2);
  });

  it("blocks with 'attempt limit reached' when used >= limit", () => {
    expect(examCanStart(item({ attemptsUsed: 1, maxAttempts: 1 }))).toBe(false);
    expect(examCanStart(item({ attemptsUsed: 5, maxAttempts: 3 }))).toBe(false);
  });
});
