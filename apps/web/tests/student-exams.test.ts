/**
 * Student exam merge — proves the college student's takeable exams surface is a
 * clean union of their college exams (first) and any individual exams, each
 * tagged with the source + slug the runner needs to pick the right START
 * endpoint. Pure, so unit-tested directly.
 */
import type { ExamListItem } from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import { mergeStudentExams } from "../src/lib/student-exams.js";

function exam(id: string, title: string): ExamListItem {
  return {
    id,
    topicId: "",
    title,
    totalMarks: 100,
    passPercentage: 40,
    sectionCount: 1,
    questionCount: 5,
    totalDurationMinutes: 30,
    attemptsUsed: 0,
    maxAttempts: 1,
    lastAttempt: null,
  };
}

describe("mergeStudentExams", () => {
  it("puts college exams first, then individual, tagging each", () => {
    const merged = mergeStudentExams(
      [exam("i1", "Individual A")],
      [exam("c1", "College A"), exam("c2", "College B")],
      "ace",
    );
    expect(merged.map((e) => e.id)).toEqual(["c1", "c2", "i1"]);
    expect(merged.map((e) => e.source)).toEqual([
      "college",
      "college",
      "individual",
    ]);
    // College exams carry the slug; individual ones don't.
    expect(merged[0].collegeSlug).toBe("ace");
    expect(merged[2].collegeSlug).toBeNull();
  });

  it("individual-only (no college) → flat list, no slugs", () => {
    const merged = mergeStudentExams([exam("i1", "A"), exam("i2", "B")], [], null);
    expect(merged.map((e) => e.id)).toEqual(["i1", "i2"]);
    expect(merged.every((e) => e.source === "individual")).toBe(true);
    expect(merged.every((e) => e.collegeSlug === null)).toBe(true);
  });

  it("college-only → all tagged college with the slug", () => {
    const merged = mergeStudentExams([], [exam("c1", "A")], "ace");
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("college");
    expect(merged[0].collegeSlug).toBe("ace");
  });

  it("preserves the source items (does not mutate)", () => {
    const college = [exam("c1", "A")];
    mergeStudentExams([], college, "ace");
    expect(college[0]).not.toHaveProperty("source");
  });
});
