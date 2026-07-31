/**
 * Pure (React/DOM-free) helpers for the college org-structure builder. Child-type
 * options and validation are driven entirely by the SHARED nesting rule
 * (ORG_UNIT_ALLOWED_CHILDREN / canNestUnder) + OrgUnitType — never a hardcoded
 * duplicate — so a change to the rule flows here automatically. Unit-tested in
 * isolation (apps/web/tests/org-structure-ui.test.ts).
 */
import {
  ORG_UNIT_ALLOWED_CHILDREN,
  ORG_UNIT_TYPE_VALUES,
  type OrgUnitTreeNode,
  type OrgUnitType,
} from "@codeapt/shared";

/**
 * The org-unit types that may be created directly under `parentType`. At the
 * root (parentType = null) any type is allowed; under a parent, only the shared
 * rule's permitted children. Returns a fresh array (safe to render/sort).
 */
export function validChildTypes(
  parentType: OrgUnitType | null,
): OrgUnitType[] {
  if (parentType === null) return [...ORG_UNIT_TYPE_VALUES];
  return [...ORG_UNIT_ALLOWED_CHILDREN[parentType]];
}

/** True when a child of `childType` may be added under `parentType` (root = any). */
export function canAddChildType(
  parentType: OrgUnitType | null,
  childType: OrgUnitType,
): boolean {
  return validChildTypes(parentType).includes(childType);
}

/**
 * Parse a pasted/typed blob of names into a clean list: split on commas AND
 * newlines (and tabs — pasting from a spreadsheet column/row), trim each, drop
 * empties, and de-duplicate EXACTLY (first occurrence wins, order preserved).
 * The backend also skips duplicates, but cleaning here gives instant feedback
 * and an accurate "about to create N" count.
 */
export function parsePastedNames(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(/[\n,\t]+/)) {
    const name = piece.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** A tree node flattened with its depth and human-readable path (for pickers). */
export interface FlatOrgUnit {
  id: string;
  name: string;
  type: OrgUnitType;
  depth: number;
  /** "CSE / 2026 / A" — the ancestor chain including this node. */
  path: string;
}

/**
 * Depth-first flatten of the org tree into an ordered list, each entry carrying
 * its depth and slash-joined path. Used by the faculty scope multi-select and to
 * resolve a faculty member's assigned unit ids back to readable labels.
 */
export function flattenTree(nodes: OrgUnitTreeNode[]): FlatOrgUnit[] {
  const out: FlatOrgUnit[] = [];
  const walk = (list: OrgUnitTreeNode[], depth: number, prefix: string) => {
    for (const node of list) {
      const path = prefix ? `${prefix} / ${node.name}` : node.name;
      out.push({
        id: node.id,
        name: node.name,
        type: node.type,
        depth,
        path,
      });
      if (node.children.length > 0) walk(node.children, depth + 1, path);
    }
  };
  walk(nodes, 0, "");
  return out;
}

/** Total number of units in a tree (for summaries / empty checks). */
export function countUnits(nodes: OrgUnitTreeNode[]): number {
  return nodes.reduce((n, node) => n + 1 + countUnits(node.children), 0);
}

/** One column of the Miller-columns (Finder-style) navigator. */
export interface StructureColumn {
  /** The unit whose children this column lists; null for the root column. */
  parentId: string | null;
  parentType: OrgUnitType | null;
  parentName: string | null;
  /** The units shown in this column (children of `parentId`). */
  units: OrgUnitTreeNode[];
  /** The unit selected IN THIS column (drives the next column), or null. */
  selectedId: string | null;
}

/**
 * Derive the column stack from the tree + a selection path (root→leaf unit ids).
 * Column 0 is the root units; each selected id reveals the next column of that
 * unit's children — including an empty column for a selected leaf (so its
 * add-zone / "nothing nests" hint can render). The path is followed only as far
 * as it resolves against the CURRENT tree, so a stale id (after a delete/refetch)
 * simply truncates the stack instead of erroring. Pure + unit-tested.
 */
export function buildColumns(
  tree: OrgUnitTreeNode[],
  path: readonly string[],
): StructureColumn[] {
  const columns: StructureColumn[] = [];
  let units = tree;
  let parentId: string | null = null;
  let parentType: OrgUnitType | null = null;
  let parentName: string | null = null;

  for (let depth = 0; ; depth += 1) {
    const wanted = path[depth] ?? null;
    const selNode = wanted
      ? units.find((u) => u.id === wanted)
      : undefined;
    columns.push({
      parentId,
      parentType,
      parentName,
      units,
      selectedId: selNode ? selNode.id : null,
    });
    if (!selNode) break;
    units = selNode.children;
    parentId = selNode.id;
    parentType = selNode.type;
    parentName = selNode.name;
  }
  return columns;
}

const TYPE_LABELS: Record<OrgUnitType, string> = {
  department: "Department",
  year: "Year",
  section: "Section",
  semester: "Semester",
};

/** "department" → "Department" (singular, title-cased). */
export function orgUnitTypeLabel(type: OrgUnitType): string {
  return TYPE_LABELS[type];
}
