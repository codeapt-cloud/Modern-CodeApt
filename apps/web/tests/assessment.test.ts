/**
 * Unit tests for the pure assessment grading + timer helpers (@codeapt/shared).
 */
import {
  ExamQuestionType,
  gradeMcq,
  isPassing,
  isSectionExpired,
  proportionalCodeMarks,
  sectionRemainingSeconds,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

describe("gradeMcq", () => {
  it("MCQ_SINGLE is a strict single-index match", () => {
    expect(gradeMcq(ExamQuestionType.MCQ_SINGLE, [1], [1])).toBe(true);
    expect(gradeMcq(ExamQuestionType.MCQ_SINGLE, [0], [1])).toBe(false);
    // Selecting extra options is wrong for single.
    expect(gradeMcq(ExamQuestionType.MCQ_SINGLE, [1, 2], [1])).toBe(false);
  });
  it("MCQ_MULTI is order-independent set equality (no partial credit)", () => {
    expect(gradeMcq(ExamQuestionType.MCQ_MULTI, [2, 0], [0, 2])).toBe(true);
    expect(gradeMcq(ExamQuestionType.MCQ_MULTI, [0], [0, 2])).toBe(false);
    expect(gradeMcq(ExamQuestionType.MCQ_MULTI, [0, 1, 2], [0, 2])).toBe(false);
  });
});

describe("proportionalCodeMarks", () => {
  it("scales marks by passed/total, rounded", () => {
    expect(proportionalCodeMarks(2, 2, 10)).toBe(10);
    expect(proportionalCodeMarks(1, 2, 10)).toBe(5);
    expect(proportionalCodeMarks(1, 3, 10)).toBe(3); // 3.33 → 3
    expect(proportionalCodeMarks(0, 4, 10)).toBe(0);
  });
  it("scores 0 with no test cases", () => {
    expect(proportionalCodeMarks(0, 0, 10)).toBe(0);
  });
});

describe("section timer", () => {
  const start = new Date("2026-07-23T10:00:00Z");
  it("computes remaining seconds and clamps at 0", () => {
    // 30 min section, 10 min elapsed → 1200s left.
    expect(
      sectionRemainingSeconds(start, 30, new Date("2026-07-23T10:10:00Z")),
    ).toBe(1200);
    // Past the deadline → 0.
    expect(
      sectionRemainingSeconds(start, 30, new Date("2026-07-23T11:00:00Z")),
    ).toBe(0);
  });
  it("flags expiry", () => {
    expect(isSectionExpired(start, 30, new Date("2026-07-23T10:29:00Z"))).toBe(
      false,
    );
    expect(isSectionExpired(start, 30, new Date("2026-07-23T10:31:00Z"))).toBe(
      true,
    );
  });
});

describe("isPassing", () => {
  it("applies the pass percentage threshold", () => {
    expect(isPassing(8, 20, 40)).toBe(true); // 40% exactly
    expect(isPassing(7, 20, 40)).toBe(false);
    expect(isPassing(0, 0, 40)).toBe(false);
  });
});
