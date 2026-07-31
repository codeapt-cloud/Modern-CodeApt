/**
 * Unit tests for the pure test-case grader + output normalization
 * (@codeapt/shared). No I/O — the worker feeds it (expected, actual) pairs.
 */
import { normalizeOutput, outputsMatch, runTestCases } from "@codeapt/shared";
import { describe, expect, it } from "vitest";

describe("normalizeOutput", () => {
  it("trims trailing whitespace per line and trailing blank lines", () => {
    expect(normalizeOutput("hello   \nworld\t\n\n\n")).toBe("hello\nworld");
  });
  it("normalizes CRLF / CR to LF", () => {
    expect(normalizeOutput("a\r\nb\rc")).toBe("a\nb\nc");
  });
  it("preserves interior blank lines and leading spaces", () => {
    expect(normalizeOutput("a\n\n  b\n")).toBe("a\n\n  b");
  });
});

describe("outputsMatch", () => {
  it("is tolerant of a trailing newline", () => {
    expect(outputsMatch("42", "42\n")).toBe(true);
  });
  it("distinguishes genuinely different output", () => {
    expect(outputsMatch("42", "43")).toBe(false);
  });
});

describe("runTestCases", () => {
  it("computes per-case pass/fail and a passed/total tally", () => {
    const graded = runTestCases([
      { input: "1", expectedOutput: "1", actualOutput: "1\n", stderr: "" },
      { input: "2", expectedOutput: "4", actualOutput: "5", stderr: "" },
      { input: "3", expectedOutput: "9", actualOutput: "9", stderr: "" },
    ]);
    expect(graded.totalCount).toBe(3);
    expect(graded.passedCount).toBe(2);
    expect(graded.results.map((r) => r.passed)).toEqual([true, false, true]);
    expect(graded.results[1]!.index).toBe(1);
  });

  it("handles an empty set", () => {
    const graded = runTestCases([]);
    expect(graded).toEqual({ results: [], passedCount: 0, totalCount: 0 });
  });
});
