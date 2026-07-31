/**
 * Pure analytics rollup math (Phase 5a) — the one unit-tested place for the
 * avg / pass-rate / distinct-count logic the analytics service rolls up. No DB.
 */
import { describe, expect, it } from "vitest";

import {
  aggregateChallenges,
  aggregateCourses,
  aggregateEssays,
  aggregateExams,
  mean,
  pct,
  round,
} from "../src/lib/analytics-rollup.js";

describe("round / mean / pct", () => {
  it("round to dp", () => {
    expect(round(66.6666, 1)).toBe(66.7);
    expect(round(80, 2)).toBe(80);
  });
  it("mean is 0 for empty, else rounded", () => {
    expect(mean([])).toBe(0);
    expect(mean([80, 40, 60])).toBe(60);
    expect(mean([1, 2])).toBe(1.5);
  });
  it("pct is 0 when denominator 0, else 0-100", () => {
    expect(pct(0, 0)).toBe(0);
    expect(pct(2, 3)).toBe(66.7);
    expect(pct(1, 2)).toBe(50);
  });
});

describe("aggregateExams", () => {
  it("counts attempts + distinct students, mean score, pass rate", () => {
    const m = aggregateExams([
      { userId: "a", score: 80, passed: true },
      { userId: "a", score: 40, passed: false },
      { userId: "b", score: 60, passed: true },
    ]);
    expect(m).toEqual({ attempts: 3, students: 2, avgScore: 60, passRate: 66.7 });
  });
  it("empty → zeros", () => {
    expect(aggregateExams([])).toEqual({
      attempts: 0,
      students: 0,
      avgScore: 0,
      passRate: 0,
    });
  });
});

describe("aggregateEssays", () => {
  it("avg is over GRADED only", () => {
    const m = aggregateEssays([
      { userId: "a", finalScore: 70, graded: true },
      { userId: "b", finalScore: 90, graded: true },
      { userId: "c", finalScore: 0, graded: false },
    ]);
    expect(m).toEqual({ submissions: 3, students: 3, graded: 2, avgScore: 80 });
  });
});

describe("aggregateCourses / aggregateChallenges", () => {
  it("courses = assignment + distinct student counts", () => {
    expect(aggregateCourses([{ userId: "a" }, { userId: "a" }, { userId: "b" }])).toEqual(
      { assignments: 3, students: 2 },
    );
  });
  it("challenges = participants + avg score + avg streak", () => {
    const m = aggregateChallenges([
      { userId: "a", totalScore: 30, currentStreak: 3, maxStreak: 5 },
      { userId: "b", totalScore: 10, currentStreak: 1, maxStreak: 2 },
    ]);
    expect(m).toEqual({ participants: 2, avgScore: 20, avgCurrentStreak: 2 });
  });
});
