/**
 * Pure org-structure UI helpers — the valid-child-types rule (driven by the
 * shared canNestUnder / ORG_UNIT_ALLOWED_CHILDREN), pasted-name parsing, and tree
 * flattening. No React/DOM.
 */
import type { OrgUnitTreeNode } from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import {
  buildColumns,
  canAddChildType,
  countUnits,
  flattenTree,
  orgUnitTypeLabel,
  parsePastedNames,
  validChildTypes,
} from "../src/lib/org-structure-ui.js";

const leaf = (
  id: string,
  type: OrgUnitTreeNode["type"],
  name: string,
  children: OrgUnitTreeNode[] = [],
): OrgUnitTreeNode => ({ id, type, name, parentId: null, order: 0, children });

describe("validChildTypes — driven by the shared nesting rule", () => {
  it("allows ANY type at the root (parent = null)", () => {
    expect(validChildTypes(null).sort()).toEqual(
      ["department", "section", "semester", "year"].sort(),
    );
  });

  it("mirrors ORG_UNIT_ALLOWED_CHILDREN under a parent", () => {
    expect(validChildTypes("department")).toEqual([
      "year",
      "section",
      "semester",
    ]);
    expect(validChildTypes("year")).toEqual(["section", "semester"]);
    expect(validChildTypes("section")).toEqual(["semester"]);
    expect(validChildTypes("semester")).toEqual([]);
  });

  it("returns a fresh array (mutating it never corrupts the shared rule)", () => {
    const a = validChildTypes("department");
    a.push("department");
    expect(validChildTypes("department")).toEqual([
      "year",
      "section",
      "semester",
    ]);
  });

  it("canAddChildType matches the rule (root = any)", () => {
    expect(canAddChildType(null, "department")).toBe(true);
    expect(canAddChildType("department", "year")).toBe(true);
    expect(canAddChildType("department", "department")).toBe(false);
    expect(canAddChildType("section", "department")).toBe(false);
    expect(canAddChildType("semester", "section")).toBe(false);
  });
});

describe("parsePastedNames", () => {
  it("splits on commas, newlines and tabs", () => {
    expect(parsePastedNames("CSE, ECE, MECH")).toEqual(["CSE", "ECE", "MECH"]);
    expect(parsePastedNames("A\nB\nC")).toEqual(["A", "B", "C"]);
    expect(parsePastedNames("A, B\nC\tD")).toEqual(["A", "B", "C", "D"]);
  });

  it("trims each name and drops empties", () => {
    expect(parsePastedNames("  A ,, B ,   ")).toEqual(["A", "B"]);
    expect(parsePastedNames("\n\n")).toEqual([]);
    expect(parsePastedNames("")).toEqual([]);
  });

  it("de-duplicates exactly, first occurrence wins, order preserved", () => {
    expect(parsePastedNames("A, A, B, A, C")).toEqual(["A", "B", "C"]);
    // Case-sensitive: distinct casing is kept (matches the backend's exact match).
    expect(parsePastedNames("A, a")).toEqual(["A", "a"]);
  });
});

describe("flattenTree + countUnits", () => {
  const tree: OrgUnitTreeNode[] = [
    {
      id: "d1",
      type: "department",
      name: "CSE",
      parentId: null,
      order: 0,
      children: [
        {
          id: "y1",
          type: "year",
          name: "2026",
          parentId: "d1",
          order: 0,
          children: [
            {
              id: "s1",
              type: "section",
              name: "A",
              parentId: "y1",
              order: 0,
              children: [],
            },
          ],
        },
      ],
    },
    {
      id: "d2",
      type: "department",
      name: "ECE",
      parentId: null,
      order: 1,
      children: [],
    },
  ];

  it("depth-first flattens with depth + slash path", () => {
    const flat = flattenTree(tree);
    expect(flat.map((u) => u.id)).toEqual(["d1", "y1", "s1", "d2"]);
    expect(flat.map((u) => u.depth)).toEqual([0, 1, 2, 0]);
    expect(flat.find((u) => u.id === "s1")?.path).toBe("CSE / 2026 / A");
    expect(flat.find((u) => u.id === "d2")?.path).toBe("ECE");
  });

  it("counts every unit in the tree", () => {
    expect(countUnits(tree)).toBe(4);
    expect(countUnits([])).toBe(0);
  });
});

describe("orgUnitTypeLabel", () => {
  it("title-cases the singular type", () => {
    expect(orgUnitTypeLabel("department")).toBe("Department");
    expect(orgUnitTypeLabel("semester")).toBe("Semester");
  });
});

describe("buildColumns — Miller-columns stack from a selection path", () => {
  // CSE → 2026 → A ; ECE (leaf, no children)
  const tree: OrgUnitTreeNode[] = [
    leaf("d1", "department", "CSE", [
      leaf("y1", "year", "2026", [leaf("s1", "section", "A")]),
    ]),
    leaf("d2", "department", "ECE"),
  ];

  it("empty path → just the root column, nothing selected", () => {
    const cols = buildColumns(tree, []);
    expect(cols).toHaveLength(1);
    expect(cols[0]).toMatchObject({
      parentId: null,
      parentType: null,
      parentName: null,
      selectedId: null,
    });
    expect(cols[0]?.units.map((u) => u.id)).toEqual(["d1", "d2"]);
  });

  it("selecting a unit with children reveals its children column", () => {
    const cols = buildColumns(tree, ["d1"]);
    expect(cols).toHaveLength(2);
    expect(cols[0]?.selectedId).toBe("d1");
    expect(cols[1]).toMatchObject({
      parentId: "d1",
      parentType: "department",
      parentName: "CSE",
      selectedId: null,
    });
    expect(cols[1]?.units.map((u) => u.id)).toEqual(["y1"]);
  });

  it("follows a deep path (department → year → section)", () => {
    const cols = buildColumns(tree, ["d1", "y1"]);
    expect(cols).toHaveLength(3);
    expect(cols.map((c) => c.selectedId)).toEqual(["d1", "y1", null]);
    expect(cols[2]?.units.map((u) => u.id)).toEqual(["s1"]);
    expect(cols[2]?.parentType).toBe("year");
  });

  it("a selected LEAF still gets an (empty) child column for its add-zone", () => {
    const cols = buildColumns(tree, ["d2"]);
    expect(cols).toHaveLength(2);
    expect(cols[1]).toMatchObject({
      parentId: "d2",
      parentType: "department",
      units: [],
      selectedId: null,
    });
  });

  it("truncates a stale path id (after a delete/refetch) instead of erroring", () => {
    const cols = buildColumns(tree, ["d1", "gone"]);
    expect(cols).toHaveLength(2);
    expect(cols[1]?.selectedId).toBeNull();
    const missing = buildColumns(tree, ["nope"]);
    expect(missing).toHaveLength(1);
    expect(missing[0]?.selectedId).toBeNull();
  });
});
