/**
 * Pure test-case grading — no I/O, no Piston. The worker runs each test case
 * through Piston to produce an `actualOutput`, then hands the (expected, actual)
 * pairs here to compute per-case pass/fail and a passed/total tally.
 *
 * Matches the original executor's forgiving comparison: normalize trailing
 * whitespace on every line and drop trailing blank lines before comparing, so a
 * program that prints a stray final newline still counts as correct.
 */
import type { TestCaseResult } from "./schemas.js";

/**
 * Canonicalize program output for comparison: normalize line endings, strip
 * trailing spaces/tabs from each line, and drop trailing blank lines. Leading
 * and interior content is preserved (significant for many problems).
 */
export function normalizeOutput(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
}

/** Whitespace-tolerant equality used for a single test case. */
export function outputsMatch(expected: string, actual: string): boolean {
  return normalizeOutput(expected) === normalizeOutput(actual);
}

export interface GradedRun {
  readonly results: TestCaseResult[];
  readonly passedCount: number;
  readonly totalCount: number;
}

interface CaseRun {
  readonly input: string;
  readonly expectedOutput: string;
  readonly actualOutput: string;
  readonly stderr: string;
}

/**
 * Grade a set of executed test cases. Proportional scoring is left to the
 * caller (score = passedCount / totalCount); this only decides pass/fail per
 * case and tallies. Pure and fully unit-testable.
 */
export function runTestCases(cases: readonly CaseRun[]): GradedRun {
  const results: TestCaseResult[] = cases.map((c, index) => ({
    index,
    passed: outputsMatch(c.expectedOutput, c.actualOutput),
    input: c.input,
    expectedOutput: c.expectedOutput,
    actualOutput: c.actualOutput,
    stderr: c.stderr,
  }));
  return {
    results,
    passedCount: results.filter((r) => r.passed).length,
    totalCount: results.length,
  };
}
