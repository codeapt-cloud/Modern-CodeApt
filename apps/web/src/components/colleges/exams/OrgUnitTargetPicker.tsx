/**
 * Org-unit targeting picker for a college exam. Multi-selects units from the
 * college's org tree (flattened to readable paths). Empty = the whole college
 * (allowed for college_admin; a faculty member must pick at least one in-scope
 * unit — the backend re-validates scope and 403s out-of-scope targets, which the
 * caller surfaces inline). Controlled: the parent owns the selected id list.
 */
import type { OrgUnitTreeNode, Role } from "@codeapt/shared";
import { Building2 } from "lucide-react";

import { flattenTree, orgUnitTypeLabel } from "../../../lib/org-structure-ui.js";
import { canTarget, toggleTarget } from "../../../lib/exam-targeting.js";
import { Badge } from "../../ui/badge.js";
import { Checkbox } from "../../ui/checkbox.js";

export function OrgUnitTargetPicker({
  tree,
  value,
  onChange,
  role,
}: {
  tree: OrgUnitTreeNode[];
  value: string[];
  onChange: (ids: string[]) => void;
  role: Role;
}) {
  const flat = flattenTree(tree);
  const isAdmin = role === "college_admin" || role === "super_admin";
  const collegeWide = value.length === 0;
  const valid = canTarget(value, isAdmin);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-muted">
          {collegeWide
            ? isAdmin
              ? "No units selected — this exam is available college-wide."
              : "Select the section(s) this exam is for."
            : `${value.length} unit${value.length === 1 ? "" : "s"} targeted.`}
        </p>
        {isAdmin && !collegeWide ? (
          <button
            type="button"
            className="text-xs font-medium text-primary hover:underline"
            onClick={() => onChange([])}
          >
            Clear (college-wide)
          </button>
        ) : null}
      </div>

      {flat.length === 0 ? (
        <p className="rounded-lg border border-subtle bg-surface-base/50 px-3 py-6 text-center text-sm text-ink-muted">
          No org-units yet. Build your academic structure first to target
          specific cohorts{isAdmin ? " (or leave empty for college-wide)" : ""}.
        </p>
      ) : (
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-subtle p-2">
          {isAdmin ? (
            <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-surface-overlay">
              <Checkbox
                checked={collegeWide}
                onCheckedChange={(c) => {
                  if (c === true) onChange([]);
                }}
                aria-label="Target the whole college"
              />
              <span className="flex items-center gap-2 text-sm text-ink">
                <Building2 className="h-4 w-4 text-ink-muted" /> Whole college
              </span>
            </label>
          ) : null}
          {flat.map((u) => (
            <label
              key={u.id}
              className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-surface-overlay"
            >
              <Checkbox
                checked={value.includes(u.id)}
                onCheckedChange={() => onChange(toggleTarget(value, u.id))}
                aria-label={`Target ${u.path}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{u.path}</span>
              </span>
              <Badge variant="neutral">{orgUnitTypeLabel(u.type)}</Badge>
            </label>
          ))}
        </div>
      )}

      {!valid ? (
        <p className="text-xs text-warning-fg">
          Select at least one section to target.
        </p>
      ) : null}
    </div>
  );
}
