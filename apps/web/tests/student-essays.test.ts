/**
 * Student essay merge — proves the college student's writable essays surface is a
 * clean union of their college essays (first) and any individual essays, each
 * tagged with the source + slug the writer needs to pick the right endpoints.
 * Pure, so unit-tested directly. Mirrors student-exams.test.ts.
 */
import type { EssayPromptSummary } from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import { mergeStudentEssays } from "../src/lib/student-essays.js";

function essay(id: string, title: string): EssayPromptSummary {
  return {
    id,
    topicId: "",
    title,
    description: "d",
    difficultyLevel: 1,
    minWords: 0,
    maxWords: 0,
    timeLimitMinutes: 0,
    maxAttempts: 3,
    attemptsUsed: 0,
    lastAttempt: null,
  };
}

describe("mergeStudentEssays", () => {
  it("puts college essays first, then individual, tagging each", () => {
    const merged = mergeStudentEssays(
      [essay("i1", "Individual A")],
      [essay("c1", "College A"), essay("c2", "College B")],
      "ace",
    );
    expect(merged.map((e) => e.id)).toEqual(["c1", "c2", "i1"]);
    expect(merged.map((e) => e.source)).toEqual([
      "college",
      "college",
      "individual",
    ]);
    expect(merged[0].collegeSlug).toBe("ace");
    expect(merged[2].collegeSlug).toBeNull();
  });

  it("individual-only (no college) → flat list, no slugs", () => {
    const merged = mergeStudentEssays([essay("i1", "A"), essay("i2", "B")], [], null);
    expect(merged.map((e) => e.id)).toEqual(["i1", "i2"]);
    expect(merged.every((e) => e.source === "individual")).toBe(true);
    expect(merged.every((e) => e.collegeSlug === null)).toBe(true);
  });

  it("college-only → all tagged college with the slug", () => {
    const merged = mergeStudentEssays([], [essay("c1", "A")], "ace");
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("college");
    expect(merged[0].collegeSlug).toBe("ace");
  });

  it("preserves the source items (does not mutate)", () => {
    const college = [essay("c1", "A")];
    mergeStudentEssays([], college, "ace");
    expect(college[0]).not.toHaveProperty("source");
  });
});
