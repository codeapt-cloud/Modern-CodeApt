/**
 * Assign-students dialog for a college course (Phase 4a). Lists the college's
 * students (filterable by org-unit, reusing the roster), each with a checkbox
 * reflecting whether they're currently assigned this course. Toggling a row
 * assigns/revokes that student immediately; a "Assign all shown" bulk action
 * covers a whole org-unit filter. All calls are tenant-scoped + faculty-scoped by
 * the backend. On close the parent refreshes assignment counts.
 */
import type { OrgUnitTreeNode } from "@codeapt/shared";
import { useState } from "react";

import { api, parseApiError } from "../../lib/api-client.js";
import { flattenTree, orgUnitTypeLabel } from "../../lib/org-structure-ui.js";
import { useQuery } from "../../lib/use-query.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Checkbox } from "../ui/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.js";
import { Skeleton } from "../ui/skeleton.js";
import { useToast } from "../ui/toast.js";

const ALL = "__all__";

export interface AssignStudentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  course: { id: string; name: string };
  tree: OrgUnitTreeNode[];
  /** Called on close so the caller can refresh assignment counts. */
  onChanged: () => void;
}

export function AssignStudentsDialog({
  open,
  onOpenChange,
  slug,
  course,
  tree,
  onChanged,
}: AssignStudentsDialogProps) {
  const { toast } = useToast();
  const flat = flattenTree(tree);
  const unitById = new Map(flat.map((u) => [u.id, u]));

  const [orgUnitFilter, setOrgUnitFilter] = useState<string>(ALL);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const studentsQuery = useQuery(
    () =>
      api.collegeStudents.list(
        slug,
        orgUnitFilter === ALL ? {} : { orgUnitId: orgUnitFilter },
      ),
    [slug, orgUnitFilter],
  );
  // The assigned set is loaded once (all assigned students for the course).
  useQuery(async () => {
    const res = await api.collegeCourses.assignedStudents(slug, course.id);
    setAssigned(new Set(res.items.map((s) => s.id)));
    return res;
  }, [slug, course.id]);

  const students = studentsQuery.data?.items ?? [];

  const close = () => {
    if (dirty) onChanged();
    onOpenChange(false);
  };

  async function toggle(studentId: string, next: boolean) {
    setBusyId(studentId);
    try {
      if (next) await api.collegeCourses.assign(slug, course.id, [studentId]);
      else await api.collegeCourses.revoke(slug, course.id, [studentId]);
      setAssigned((prev) => {
        const s = new Set(prev);
        if (next) s.add(studentId);
        else s.delete(studentId);
        return s;
      });
      setDirty(true);
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setBusyId(null);
    }
  }

  async function assignAllShown() {
    const toAssign = students
      .filter((s) => !assigned.has(s.id))
      .map((s) => s.id);
    if (toAssign.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await api.collegeCourses.assign(slug, course.id, toAssign);
      setAssigned((prev) => {
        const s = new Set(prev);
        toAssign.forEach((id) => s.add(id));
        return s;
      });
      setDirty(true);
      toast({
        variant: "success",
        title: `Assigned ${res.assigned}${
          res.alreadyAssigned ? `, ${res.alreadyAssigned} already had it` : ""
        }`,
      });
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setBulkBusy(false);
    }
  }

  const shownUnassigned = students.filter((s) => !assigned.has(s.id)).length;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assign “{course.name}”</DialogTitle>
          <DialogDescription>
            Tick a student to assign this course; untick to revoke. Assigned
            students learn it through the normal course player.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {flat.length > 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-ink-muted">Org-unit</span>
              <Select value={orgUnitFilter} onValueChange={setOrgUnitFilter}>
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All units</SelectItem>
                  {flat.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.path}{" "}
                      <span className="text-ink-muted">
                        ({orgUnitTypeLabel(u.type)})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {studentsQuery.loading ? (
            <Skeleton className="h-48 w-full rounded-xl" />
          ) : studentsQuery.error ? (
            <Alert variant="error">{studentsQuery.error}</Alert>
          ) : students.length === 0 ? (
            <p className="rounded-lg border border-subtle bg-surface-base/50 px-3 py-6 text-center text-sm text-ink-muted">
              No students {orgUnitFilter === ALL ? "yet" : "in this unit"}.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs text-ink-muted">
                  {assigned.size} assigned overall
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={bulkBusy}
                  disabled={shownUnassigned === 0}
                  onClick={() => void assignAllShown()}
                >
                  Assign all shown ({shownUnassigned})
                </Button>
              </div>
              <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-subtle p-2">
                {students.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-surface-overlay"
                  >
                    <Checkbox
                      checked={assigned.has(s.id)}
                      disabled={busyId === s.id}
                      onCheckedChange={(v) => void toggle(s.id, v === true)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">
                        {s.fullName}
                      </span>
                      <span className="block truncate text-[11px] text-ink-muted">
                        {s.rollNumber} ·{" "}
                        {s.orgUnitId
                          ? (unitById.get(s.orgUnitId)?.path ?? "—")
                          : "—"}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button onClick={close}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
