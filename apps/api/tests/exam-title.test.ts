/**
 * Exam display-title resolution — migrated exams have a blank title that fell
 * back to the "Exam" placeholder, so the display name must come from the linked
 * topic's name instead. This locks the pure precedence: real title > topic name
 * > placeholder (verified without a DB).
 */
import { describe, expect, it } from "vitest";

import {
  EXAM_TITLE_PLACEHOLDER,
  resolveExamTitle,
} from "../src/lib/exam-title.js";

describe("resolveExamTitle", () => {
  it("prefers a real exam title over the topic name", () => {
    expect(resolveExamTitle("Midterm", "TCS Test 5")).toBe("Midterm");
  });

  it("falls back to the topic name when the title is the placeholder", () => {
    // The migrated case: title === "Exam" but the topic carries the real name.
    expect(resolveExamTitle(EXAM_TITLE_PLACEHOLDER, "TCS Test 5")).toBe(
      "TCS Test 5",
    );
  });

  it("falls back to the topic name when the title is blank/whitespace", () => {
    expect(resolveExamTitle("", "TCS Test 2")).toBe("TCS Test 2");
    expect(resolveExamTitle("   ", "TCS Test 2")).toBe("TCS Test 2");
    expect(resolveExamTitle(null, "TCS Test 2")).toBe("TCS Test 2");
  });

  it("uses the placeholder only when both title and topic name are empty", () => {
    expect(resolveExamTitle("Exam", "")).toBe(EXAM_TITLE_PLACEHOLDER);
    expect(resolveExamTitle("", null)).toBe(EXAM_TITLE_PLACEHOLDER);
    expect(resolveExamTitle(undefined, undefined)).toBe(EXAM_TITLE_PLACEHOLDER);
  });

  it("trims a resolved topic name", () => {
    expect(resolveExamTitle("Exam", "  TCS Test 5  ")).toBe("TCS Test 5");
  });
});
