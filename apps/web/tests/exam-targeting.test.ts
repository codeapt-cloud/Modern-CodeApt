/**
 * College-exam targeting helpers — the one place the "empty target = college-wide"
 * and "faculty must pick ≥1" rules live, plus the id→readable-path summary the
 * picker and list render. Pure, so unit-tested directly.
 */
import { describe, expect, it } from "vitest";

import type { FlatOrgUnit } from "../src/lib/org-structure-ui.js";
import {
  canTarget,
  summarizeTargets,
  toggleTarget,
} from "../src/lib/exam-targeting.js";

const flat: FlatOrgUnit[] = [
  { id: "u1", name: "CSE", type: "department", depth: 0, path: "CSE" },
  { id: "u2", name: "A", type: "section", depth: 1, path: "CSE / 2026 / A" },
];

describe("summarizeTargets", () => {
  it("empty selection → college-wide, no labels", () => {
    expect(summarizeTargets([], flat)).toEqual({
      collegeWide: true,
      labels: [],
    });
  });

  it("maps ids to their readable paths, preserving order", () => {
    expect(summarizeTargets(["u2", "u1"], flat)).toEqual({
      collegeWide: false,
      labels: ["CSE / 2026 / A", "CSE"],
    });
  });

  it("keeps a placeholder for unknown ids (never silently drops)", () => {
    const r = summarizeTargets(["u1", "gone"], flat);
    expect(r.collegeWide).toBe(false);
    expect(r.labels).toEqual(["CSE", "Unknown unit"]);
  });
});

describe("canTarget", () => {
  it("admin may target anything incl. empty (college-wide)", () => {
    expect(canTarget([], true)).toBe(true);
    expect(canTarget(["u1"], true)).toBe(true);
  });

  it("faculty must pick at least one unit", () => {
    expect(canTarget([], false)).toBe(false);
    expect(canTarget(["u1"], false)).toBe(true);
  });
});

describe("toggleTarget", () => {
  it("adds a missing id (appended) and removes a present one", () => {
    expect(toggleTarget(["u1"], "u2")).toEqual(["u1", "u2"]);
    expect(toggleTarget(["u1", "u2"], "u1")).toEqual(["u2"]);
  });

  it("returns a new array (no mutation)", () => {
    const src = ["u1"];
    const out = toggleTarget(src, "u2");
    expect(out).not.toBe(src);
    expect(src).toEqual(["u1"]);
  });
});
