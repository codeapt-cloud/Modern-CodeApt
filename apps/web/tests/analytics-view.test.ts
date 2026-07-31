/**
 * Analytics view helpers (Phase 5a-ii) — the pure shaping the dashboard uses to
 * turn the flat 5a-i by-org-unit rollup into dept→section navigation + bar
 * widths. No React/DOM.
 */
import type { CollegeAnalyticsUnit } from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import {
  barPercent,
  childrenOf,
  departments,
  maxOf,
  unitById,
} from "../src/lib/analytics-view.js";

const empty = { attempts: 0, students: 0, avgScore: 0, passRate: 0 };
function unit(
  id: string,
  type: CollegeAnalyticsUnit["type"],
  parentId: string | null,
  examAvg = 0,
): CollegeAnalyticsUnit {
  return {
    id,
    name: id.toUpperCase(),
    type,
    parentId,
    students: 0,
    exams: { ...empty, avgScore: examAvg },
    essays: { submissions: 0, students: 0, graded: 0, avgScore: 0 },
    courses: { assignments: 0, students: 0 },
    challenges: { participants: 0, avgScore: 0, avgCurrentStreak: 0 },
  };
}

const units: CollegeAnalyticsUnit[] = [
  unit("d", "department", null, 60),
  unit("a", "section", "d", 80),
  unit("b", "section", "d", 40),
  unit("d2", "department", null, 0),
];

describe("departments / childrenOf / unitById", () => {
  it("departments = the department-typed units", () => {
    expect(departments(units).map((u) => u.id)).toEqual(["d", "d2"]);
  });
  it("childrenOf = direct children by parentId", () => {
    expect(childrenOf(units, "d").map((u) => u.id)).toEqual(["a", "b"]);
    expect(childrenOf(units, "d2")).toEqual([]);
  });
  it("unitById finds or returns undefined", () => {
    expect(unitById(units, "a")?.name).toBe("A");
    expect(unitById(units, "nope")).toBeUndefined();
  });
});

describe("barPercent / maxOf", () => {
  it("maxOf is the max (0 for empty)", () => {
    expect(maxOf([80, 40, 60])).toBe(80);
    expect(maxOf([])).toBe(0);
  });
  it("barPercent is value/max*100, 0 when max 0, clamped", () => {
    expect(barPercent(40, 80)).toBe(50);
    expect(barPercent(80, 80)).toBe(100);
    expect(barPercent(5, 0)).toBe(0);
    expect(barPercent(200, 80)).toBe(100);
  });
});
