/**
 * College org-structure builder (route: /c/:slug/structure) — a MILLER-COLUMNS
 * navigator (macOS-Finder style). Columns run left→right: column 0 lists the root
 * units, selecting a unit reveals the next column of its children, and a
 * breadcrumb above tracks the path (CSE › 2026 › A). Each column has a persistent,
 * prominent ADD ZONE at its foot — single (name + Enter) OR paste-many
 * (comma/newline separated → bulk-create, showing created/skipped) — so creation
 * is a first-class action at every level. Child-type options come only from the
 * shared canNestUnder rule (validChildTypes). Rows support inline rename and
 * delete (the has-children block is surfaced, and pre-empted client-side).
 *
 * The server response is the source of truth: every mutation refetches; actions
 * disable while mutating. Responsive: columns scroll horizontally on wide screens
 * and snap to a single-column drill-down (with a Back affordance) on mobile.
 * college_admins get write actions; faculty see a read-only navigator.
 *
 * Backend, api-client, shared rules and the faculty page are UNCHANGED — this is a
 * pure UI rebuild. Mutation logic + pure helpers are reused as-is.
 */
import {
  COLLEGE_ADMIN_ROLES,
  OrgUnitType,
  type BulkCreateOrgUnitsInput,
  type CreateOrgUnitInput,
  type OrgUnitTreeNode,
} from "@codeapt/shared";
import { useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ChevronRight,
  FolderTree,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { Card } from "../../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { IconButton } from "../../components/ui/icon-button.js";
import { Input } from "../../components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { Textarea } from "../../components/ui/textarea.js";
import { useToast } from "../../components/ui/toast.js";
import { cn } from "../../lib/cn.js";
import { api, parseApiError } from "../../lib/api-client.js";
import {
  buildColumns,
  countUnits,
  orgUnitTypeLabel,
  parsePastedNames,
  validChildTypes,
  type StructureColumn,
} from "../../lib/org-structure-ui.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

// --- Shared mutation actions, threaded to the columns ------------------------

interface StructureActions {
  canWrite: boolean;
  busy: boolean;
  create: (input: CreateOrgUnitInput) => Promise<boolean>;
  bulkCreate: (input: BulkCreateOrgUnitsInput) => Promise<boolean>;
  rename: (id: string, name: string) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
}

/** Gentle per-type color-coding (dot + selected-row accent). */
const TYPE_DOT: Record<OrgUnitType, string> = {
  department: "bg-primary",
  year: "bg-info",
  section: "bg-success",
  semester: "bg-warning",
};

// --- Column add-zone: always-visible, compact single / paste-many creator ----

function ColumnAddZone({
  parentId,
  parentType,
  actions,
}: {
  parentId: string | null;
  parentType: OrgUnitType | null;
  actions: StructureActions;
}) {
  const options = validChildTypes(parentType);
  const defaultType = options[0] ?? OrgUnitType.DEPARTMENT;
  const [mode, setMode] = useState<"single" | "paste">("single");
  const [type, setType] = useState<OrgUnitType>(defaultType);
  const [name, setName] = useState("");
  const [blob, setBlob] = useState("");

  if (!actions.canWrite || options.length === 0) return null;

  const label = orgUnitTypeLabel(type).toLowerCase();
  const pasted = parsePastedNames(blob);

  const submitSingle = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const ok = await actions.create({ type, name: trimmed, parentId });
    if (ok) setName("");
  };
  const submitBulk = async () => {
    if (pasted.length === 0) return;
    const ok = await actions.bulkCreate({ type, parentId, names: pasted });
    if (ok) setBlob("");
  };

  return (
    <div className="shrink-0 space-y-2 border-t border-subtle bg-surface-base/40 p-2.5">
      <div className="flex items-center gap-2">
        {options.length > 1 ? (
          <Select value={type} onValueChange={(v) => setType(v as OrgUnitType)}>
            <SelectTrigger className="h-7 min-w-0 flex-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((t) => (
                <SelectItem key={t} value={t}>
                  {orgUnitTypeLabel(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 truncate text-xs font-medium text-ink-secondary">
            <span
              className={cn("h-2 w-2 shrink-0 rounded-full", TYPE_DOT[type])}
              aria-hidden="true"
            />
            Add {label}
          </span>
        )}
        <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-subtle text-[11px]">
          <button
            type="button"
            className={cn(
              "px-2 py-1 font-medium transition-colors",
              mode === "single"
                ? "bg-primary/15 text-primary"
                : "text-ink-muted hover:text-ink",
            )}
            onClick={() => setMode("single")}
          >
            Single
          </button>
          <button
            type="button"
            className={cn(
              "px-2 py-1 font-medium transition-colors",
              mode === "paste"
                ? "bg-primary/15 text-primary"
                : "text-ink-muted hover:text-ink",
            )}
            onClick={() => setMode("paste")}
          >
            Paste
          </button>
        </div>
      </div>

      {mode === "single" ? (
        <div className="flex items-center gap-1.5">
          <Input
            className="h-8"
            placeholder={`New ${label} name`}
            aria-label={`New ${label} name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submitSingle();
              }
            }}
          />
          <IconButton
            aria-label={`Add ${label}`}
            size="sm"
            icon={<Plus className="h-4 w-4" />}
            disabled={!name.trim() || actions.busy}
            onClick={() => void submitSingle()}
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          <Textarea
            className="min-h-16 text-sm"
            placeholder={"Paste names — one per line or comma-separated\ne.g. CSE, ECE, MECH"}
            aria-label="Paste multiple names"
            value={blob}
            onChange={(e) => setBlob(e.target.value)}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-ink-muted">
              {pasted.length === 0
                ? "No names yet"
                : `${pasted.length} ${label}${pasted.length === 1 ? "" : "s"}`}
            </span>
            <Button
              size="sm"
              loading={actions.busy}
              disabled={pasted.length === 0}
              onClick={() => void submitBulk()}
            >
              Create {pasted.length || ""}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- A selectable unit row within a column -----------------------------------

function UnitRow({
  node,
  selected,
  actions,
  onSelect,
}: {
  node: OrgUnitTreeNode;
  selected: boolean;
  actions: StructureActions;
  onSelect: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(node.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const hasChildren = node.children.length > 0;

  const saveRename = async () => {
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === node.name) {
      setRenaming(false);
      setDraftName(node.name);
      return;
    }
    const ok = await actions.rename(node.id, trimmed);
    if (ok) setRenaming(false);
  };

  if (renaming) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-surface-raised p-1.5">
        <span
          className={cn("h-2 w-2 shrink-0 rounded-full", TYPE_DOT[node.type])}
          aria-hidden="true"
        />
        <Input
          autoFocus
          className="h-7"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void saveRename();
            } else if (e.key === "Escape") {
              setRenaming(false);
              setDraftName(node.name);
            }
          }}
        />
        <IconButton
          aria-label="Save name"
          size="sm"
          variant="ghost"
          icon={<span className="text-xs font-semibold text-primary">OK</span>}
          disabled={actions.busy}
          onClick={() => void saveRename()}
        />
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
        "focus-visible:outline-none focus-visible:shadow-focus",
        selected
          ? "bg-primary/10 text-primary"
          : "text-ink hover:bg-surface-overlay",
      )}
    >
      <span
        className={cn("h-2 w-2 shrink-0 rounded-full", TYPE_DOT[node.type])}
        aria-hidden="true"
      />
      <span className="flex-1 truncate text-sm font-medium">{node.name}</span>

      {actions.canWrite ? (
        <span
          className={cn(
            "flex items-center gap-0.5 transition-opacity",
            selected
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
          )}
        >
          <IconButton
            aria-label={`Rename ${node.name}`}
            variant="ghost"
            size="sm"
            icon={<Pencil className="h-3.5 w-3.5" />}
            onClick={(e) => {
              e.stopPropagation();
              setDraftName(node.name);
              setRenaming(true);
            }}
          />
          <IconButton
            aria-label={`Delete ${node.name}`}
            variant="ghost"
            size="sm"
            icon={<Trash2 className="h-3.5 w-3.5 text-error-fg" />}
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDelete(true);
            }}
          />
        </span>
      ) : null}

      {hasChildren ? (
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0",
            selected ? "text-primary" : "text-ink-muted",
          )}
          aria-hidden="true"
        />
      ) : (
        <span className="w-4 shrink-0" aria-hidden="true" />
      )}

      {/* Delete confirmation */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent
          className="max-w-md"
          onClick={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>Delete “{node.name}”?</DialogTitle>
            <DialogDescription>
              {hasChildren
                ? "This unit still has child units. Remove or move them first — a non-empty unit can't be deleted."
                : "This removes the unit permanently. This can't be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={hasChildren || actions.busy}
              loading={actions.busy}
              onClick={async () => {
                const ok = await actions.remove(node.id);
                if (ok) setConfirmDelete(false);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- One column -------------------------------------------------------------

function ColumnView({
  column,
  index,
  actions,
  onSelect,
}: {
  column: StructureColumn;
  index: number;
  actions: StructureActions;
  onSelect: (colIndex: number, id: string) => void;
}) {
  const canHaveChildren = validChildTypes(column.parentType).length > 0;
  const isRoot = column.parentId === null;
  const headerLabel = isRoot
    ? "Top level"
    : column.parentName ?? "Units";

  return (
    <div className="flex h-full w-72 shrink-0 snap-start flex-col border-r border-subtle last:border-r-0 sm:w-64">
      <div className="flex shrink-0 items-center gap-2 border-b border-subtle px-3 py-2">
        {!isRoot && column.parentType ? (
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              TYPE_DOT[column.parentType],
            )}
            aria-hidden="true"
          />
        ) : null}
        <span className="truncate text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {headerLabel}
        </span>
      </div>

      <div className="flex-1 space-y-0.5 overflow-y-auto p-1.5">
        {column.units.length === 0 ? (
          <div className="px-2 py-6 text-center">
            {canHaveChildren ? (
              <p className="text-xs text-ink-muted">
                {isRoot
                  ? "No units yet. Add your first below."
                  : "Empty. Add units below."}
              </p>
            ) : (
              <p className="text-xs text-ink-muted">
                Nothing nests under a{" "}
                {column.parentType
                  ? orgUnitTypeLabel(column.parentType).toLowerCase()
                  : "unit"}
                .
              </p>
            )}
          </div>
        ) : (
          column.units.map((node) => (
            <UnitRow
              key={node.id}
              node={node}
              selected={column.selectedId === node.id}
              actions={actions}
              onSelect={() => onSelect(index, node.id)}
            />
          ))
        )}
      </div>

      <ColumnAddZone
        parentId={column.parentId}
        parentType={column.parentType}
        actions={actions}
      />
    </div>
  );
}

// --- Page --------------------------------------------------------------------

export function CollegeStructurePage() {
  const { slug, context } = useCollege();
  const { toast } = useToast();
  const reduced = useReducedMotion();
  const { data, loading, error, refetch } = useQuery(
    () => api.collegeOrgUnits.listTree(slug),
    [slug],
  );

  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState<string[]>([]);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const canWrite = COLLEGE_ADMIN_ROLES.includes(context.membership.role);
  const tree = data?.items ?? [];
  const columns = buildColumns(tree, path);
  const total = countUnits(tree);

  // Reveal the newest column (keep the deepest visible; on mobile this is the
  // single active column). Respects reduced-motion.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) {
      el.scrollTo({
        left: el.scrollWidth,
        behavior: reduced ? "auto" : "smooth",
      });
    }
  }, [columns.length, reduced]);

  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    try {
      await fn();
      refetch();
      return true;
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const actions: StructureActions = {
    canWrite,
    busy,
    create: (input) =>
      run(async () => {
        await api.collegeOrgUnits.create(slug, input);
        toast({ variant: "success", title: `${input.name} added` });
      }),
    bulkCreate: (input) =>
      run(async () => {
        const res = await api.collegeOrgUnits.bulkCreate(slug, input);
        toast({
          variant: "success",
          title: `${res.created.length} created${
            res.skipped.length
              ? `, ${res.skipped.length} skipped (already existed)`
              : ""
          }`,
        });
      }),
    rename: (id, name) =>
      run(async () => {
        await api.collegeOrgUnits.update(slug, id, { name });
        toast({ variant: "success", title: "Renamed" });
      }),
    remove: (id) =>
      run(async () => {
        await api.collegeOrgUnits.remove(slug, id);
        toast({ variant: "success", title: "Unit deleted" });
      }),
  };

  const select = (colIndex: number, id: string) =>
    setPath((p) => [...p.slice(0, colIndex), id]);
  const back = () => setPath((p) => p.slice(0, -1));

  // Breadcrumb = the selected node in each column that has a selection.
  const crumbs = columns
    .map((c) =>
      c.selectedId ? c.units.find((u) => u.id === c.selectedId) : undefined,
    )
    .filter((n): n is OrgUnitTreeNode => Boolean(n));

  return (
    <div className="space-y-6">
      <PageHeader
        title="College structure"
        description={
          canWrite
            ? "Navigate and build your academic tree column by column. Select a unit to drill in; use the add-zone at the foot of any column to create one — or paste many at once."
            : "Browse your college's academic structure."
        }
      />

      {loading ? (
        <Skeleton className="h-[30rem] w-full rounded-2xl" />
      ) : error ? (
        <Alert variant="error">{error}</Alert>
      ) : (
        <Card className="overflow-hidden p-0">
          {/* Breadcrumb + count bar */}
          <div className="flex items-center justify-between gap-3 border-b border-subtle px-4 py-2.5">
            <nav
              aria-label="Structure path"
              className="flex min-w-0 items-center gap-1 text-sm"
            >
              <button
                type="button"
                onClick={() => setPath([])}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-medium transition-colors hover:bg-surface-overlay",
                  crumbs.length === 0 ? "text-ink" : "text-ink-secondary",
                )}
              >
                <FolderTree className="h-4 w-4 text-primary" />
                <span className="max-w-[10rem] truncate">
                  {context.college.name}
                </span>
              </button>
              {crumbs.map((node, i) => (
                <span key={node.id} className="flex min-w-0 items-center gap-1">
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-muted" />
                  <button
                    type="button"
                    onClick={() => setPath(path.slice(0, i + 1))}
                    className={cn(
                      "max-w-[9rem] truncate rounded-md px-1.5 py-0.5 transition-colors hover:bg-surface-overlay",
                      i === crumbs.length - 1
                        ? "font-medium text-ink"
                        : "text-ink-secondary",
                    )}
                  >
                    {node.name}
                  </button>
                </span>
              ))}
            </nav>

            <div className="flex shrink-0 items-center gap-2">
              {path.length > 0 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="sm:hidden"
                  onClick={back}
                >
                  <ArrowLeft className="h-4 w-4" /> Back
                </Button>
              ) : null}
              <span className="hidden text-xs text-ink-muted sm:inline">
                {total} unit{total === 1 ? "" : "s"}
              </span>
            </div>
          </div>

          {/* Columns */}
          <div
            ref={scrollerRef}
            className="flex h-[26rem] snap-x snap-mandatory overflow-x-auto sm:h-[30rem] sm:snap-none"
          >
            {columns.map((column, i) => (
              <ColumnView
                key={column.parentId ?? "__root__"}
                column={column}
                index={i}
                actions={actions}
                onSelect={select}
              />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
