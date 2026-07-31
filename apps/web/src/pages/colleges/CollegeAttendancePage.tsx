/**
 * College Attendance (route: /c/:slug/attendance) — Prompt 1: form attendance
 * GROUPS (classes / events) whose membership is the de-duplicated UNION of any
 * mix of org-units, individual students, and an Excel roll-number upload (with a
 * matched/unmatched PREVIEW before confirming). All calls are tenant-scoped +
 * faculty-scoped by the backend; gated by the `attendance` feature. A college
 * admin can toggle whether faculty may form CROSS-CUTTING / Excel groups.
 *
 * Sessions + taking attendance arrive in Prompt 2; this page only forms groups.
 */
import {
  AttendanceGroupKind,
  COLLEGE_ADMIN_ROLES,
  CollegeFeature,
  checkEntitlement,
  type AttendanceGroupSummary,
  type CollegeStudent,
} from "@codeapt/shared";
import {
  CalendarCheck,
  ClipboardList,
  Plus,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ConfirmDeleteDialog } from "../../components/curriculum/admin/ConfirmDeleteDialog.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card } from "../../components/ui/card.js";
import { Checkbox } from "../../components/ui/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Input } from "../../components/ui/input.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { Switch } from "../../components/ui/switch.js";
import { Textarea } from "../../components/ui/textarea.js";
import { useToast } from "../../components/ui/toast.js";
import { api, parseApiError } from "../../lib/api-client.js";
import { flattenTree, orgUnitTypeLabel } from "../../lib/org-structure-ui.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

/** Read a File into a bare base64 string (strips the data: URL prefix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

interface ExcelPreview {
  matchedRolls: string[];
  matchedNames: string[];
  unmatched: string[];
}

function CreateGroupDialog({
  slug,
  onClose,
  onCreated,
}: {
  slug: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const treeQuery = useQuery(() => api.collegeOrgUnits.listTree(slug), [slug]);
  const studentsQuery = useQuery(() => api.collegeStudents.list(slug), [slug]);
  const flat = useMemo(
    () => flattenTree(treeQuery.data?.items ?? []),
    [treeQuery.data],
  );
  const students: CollegeStudent[] = studentsQuery.data?.items ?? [];

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<AttendanceGroupKind>(
    AttendanceGroupKind.CLASS,
  );
  const [unitIds, setUnitIds] = useState<Set<string>>(new Set());
  const [studentIds, setStudentIds] = useState<Set<string>>(new Set());
  const [studentFilter, setStudentFilter] = useState("");
  const [excel, setExcel] = useState<ExcelPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  const toggle = (set: Set<string>, id: string): Set<string> => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const filteredStudents = students.filter((s) => {
    const q = studentFilter.trim().toLowerCase();
    if (!q) return true;
    return (
      s.fullName.toLowerCase().includes(q) ||
      s.rollNumber.toLowerCase().includes(q)
    );
  });

  const runPreview = async (file: File): Promise<void> => {
    setPreviewing(true);
    try {
      const fileBase64 = await fileToBase64(file);
      const res = await api.attendance.importPreview(slug, fileBase64);
      setExcel({
        matchedRolls: res.matched.map((m) => m.rollNumber),
        matchedNames: res.matched.map((m) => m.fullName || m.rollNumber),
        unmatched: res.unmatched,
      });
      toast({
        variant: "success",
        title: `Matched ${res.summary.matched} of ${res.summary.total} roll numbers`,
      });
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setPreviewing(false);
    }
  };

  const totalSelected =
    unitIds.size + studentIds.size + (excel?.matchedRolls.length ?? 0);

  const save = async (): Promise<void> => {
    if (!name.trim()) {
      toast({ variant: "error", title: "Give the group a name" });
      return;
    }
    setSaving(true);
    try {
      await api.attendance.createGroup(slug, {
        name: name.trim(),
        description: description.trim() || undefined,
        kind,
        orgUnitIds: [...unitIds],
        studentIds: [...studentIds],
        excelRollNumbers: excel?.matchedRolls ?? [],
      });
      toast({ variant: "success", title: `Group "${name.trim()}" created` });
      onCreated();
      onClose();
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New attendance group</DialogTitle>
          <DialogDescription>
            Assemble members from org-units, individual students, and/or an Excel
            roll-number upload — in any mix. Duplicates are merged automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Basics */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-ink-muted">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder='e.g. "Being Zero" or "CSE-A"'
                aria-label="Group name"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-ink-muted">Kind</label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as AttendanceGroupKind)}
                className="h-10 w-full rounded-lg border border-subtle bg-surface px-3 text-sm text-ink"
                aria-label="Group kind"
              >
                <option value={AttendanceGroupKind.CLASS}>Class (recurring)</option>
                <option value={AttendanceGroupKind.EVENT}>Event (one-off)</option>
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-muted">
              Description (optional)
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this class / event?"
              rows={2}
            />
          </div>

          {/* 1) Org-units / sections */}
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium text-ink">
              <Users className="h-4 w-4 text-primary" /> Org-units & sections
            </p>
            {flat.length === 0 ? (
              <p className="text-xs text-ink-muted">
                No org-units yet — add them under Academic structure.
              </p>
            ) : (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-subtle p-2">
                {flat.map((u) => (
                  <label
                    key={u.id}
                    className="flex items-center gap-2 text-sm text-ink"
                    style={{ paddingLeft: `${u.depth * 14}px` }}
                  >
                    <Checkbox
                      checked={unitIds.has(u.id)}
                      onCheckedChange={() => setUnitIds((s) => toggle(s, u.id))}
                    />
                    <span className="truncate">{u.name}</span>
                    <Badge variant="neutral">{orgUnitTypeLabel(u.type)}</Badge>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* 2) Individual students */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Individual students</p>
            <Input
              value={studentFilter}
              onChange={(e) => setStudentFilter(e.target.value)}
              placeholder="Filter by name or roll number…"
              aria-label="Filter students"
            />
            {studentsQuery.loading ? (
              <Skeleton className="h-24 w-full rounded-lg" />
            ) : (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-subtle p-2">
                {filteredStudents.length === 0 ? (
                  <p className="p-2 text-xs text-ink-muted">No students match.</p>
                ) : (
                  filteredStudents.slice(0, 200).map((s) => (
                    <label
                      key={s.id}
                      className="flex items-center gap-2 text-sm text-ink"
                    >
                      <Checkbox
                        checked={studentIds.has(s.id)}
                        onCheckedChange={() =>
                          setStudentIds((set) => toggle(set, s.id))
                        }
                      />
                      <span className="truncate">{s.fullName}</span>
                      <span className="text-xs text-ink-muted">
                        {s.rollNumber}
                      </span>
                    </label>
                  ))
                )}
              </div>
            )}
          </div>

          {/* 3) Excel roll-number upload → preview */}
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium text-ink">
              <Upload className="h-4 w-4 text-primary" /> Excel roll numbers
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void api.attendance
                    .template(slug)
                    .then(({ blob, filename }) => {
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = filename;
                      a.click();
                      URL.revokeObjectURL(url);
                    })
                    .catch((err: unknown) =>
                      toast({ variant: "error", title: parseApiError(err).message }),
                    );
                }}
              >
                Download template
              </Button>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-subtle px-3 py-1.5 text-sm text-ink hover:bg-surface-sunken">
                {previewing ? "Reading…" : "Upload .xlsx"}
                <input
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void runPreview(file);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            {excel ? (
              <div className="rounded-lg border border-subtle p-2 text-xs">
                <p className="text-success-fg">
                  {excel.matchedRolls.length} matched
                  {excel.matchedNames.length > 0
                    ? `: ${excel.matchedNames.slice(0, 8).join(", ")}${
                        excel.matchedNames.length > 8 ? "…" : ""
                      }`
                    : ""}
                </p>
                {excel.unmatched.length > 0 ? (
                  <p className="mt-1 text-warning-fg">
                    {excel.unmatched.length} unmatched:{" "}
                    {excel.unmatched.slice(0, 8).join(", ")}
                    {excel.unmatched.length > 8 ? "…" : ""}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <span className="mr-auto self-center text-xs text-ink-muted">
            {totalSelected} source selection{totalSelected === 1 ? "" : "s"} (merged
            + de-duped on save)
          </span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving || !name.trim()} onClick={() => void save()}>
            {saving ? "Creating…" : "Create group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CollegeAttendancePage() {
  const { slug, context } = useCollege();
  const { toast } = useToast();
  const navigate = useNavigate();
  const entitled = checkEntitlement(
    context.entitlements,
    CollegeFeature.ATTENDANCE,
  );
  const isAdmin = COLLEGE_ADMIN_ROLES.includes(context.membership.role);

  const groupsQuery = useQuery(
    () => (entitled ? api.attendance.listGroups(slug) : Promise.resolve({ items: [] })),
    [slug, entitled],
  );
  const settingsQuery = useQuery(
    () =>
      entitled && isAdmin
        ? api.attendance.getSettings(slug)
        : Promise.resolve(null),
    [slug, entitled, isAdmin],
  );

  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<AttendanceGroupSummary | null>(null);
  const [savingSetting, setSavingSetting] = useState(false);

  const groups = groupsQuery.data?.items ?? [];

  const toggleCrossCut = async (value: boolean): Promise<void> => {
    setSavingSetting(true);
    try {
      await api.attendance.setSettings(slug, {
        facultyCanFormCrossCuttingGroups: value,
      });
      toast({ variant: "success", title: "Attendance settings updated" });
      settingsQuery.refetch();
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setSavingSetting(false);
    }
  };

  if (!entitled) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Attendance"
          description="Form classes and events, then track attendance."
        />
        <Card className="mx-auto max-w-lg space-y-3 p-8 text-center">
          <CalendarCheck className="mx-auto h-10 w-10 text-ink-muted" />
          <h2 className="text-lg font-semibold text-ink">
            Attendance isn&apos;t enabled
          </h2>
          <p className="text-sm text-ink-muted">
            This feature isn&apos;t turned on for your college. Contact your
            CodeApt administrator to enable it.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance groups"
        description="A group is a named set of students — a recurring class or a one-off event — built from org-units, sections, individuals, and Excel roll-number uploads, in any mix."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New group
          </Button>
        }
      />

      {settingsQuery.data ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm font-medium text-ink">
              Faculty may form cross-cutting / Excel groups
            </p>
            <p className="text-xs text-ink-muted">
              When on, faculty can add students outside their own org-unit scope
              (including via Excel). When off, they&apos;re confined to their scope.
            </p>
          </div>
          <Switch
            checked={settingsQuery.data.facultyCanFormCrossCuttingGroups}
            disabled={savingSetting}
            onCheckedChange={(v) => void toggleCrossCut(v)}
          />
        </Card>
      ) : null}

      {groupsQuery.loading ? (
        <Skeleton className="h-56 w-full rounded-2xl" />
      ) : groupsQuery.error ? (
        <Alert variant="error">{groupsQuery.error}</Alert>
      ) : groups.length === 0 ? (
        <EmptyState
          title="No attendance groups yet"
          description="Create your first class or event — pick org-units, add individuals, or upload roll numbers."
          icon={<CalendarCheck />}
          action={
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New group
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <Card key={g.id} className="flex flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold text-ink">{g.name}</h3>
                  {g.description ? (
                    <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">
                      {g.description}
                    </p>
                  ) : null}
                </div>
                <Badge variant={g.kind === "event" ? "info" : "neutral"}>
                  {g.kind === "event" ? "Event" : "Class"}
                </Badge>
              </div>
              <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
                  <Users className="h-3.5 w-3.5" /> {g.memberCount} member
                  {g.memberCount === 1 ? "" : "s"}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      navigate(`/c/${slug}/attendance/groups/${g.id}`)
                    }
                  >
                    <ClipboardList className="h-4 w-4" /> Sessions
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(g)}>
                    <Trash2 className="h-4 w-4 text-error-fg" /> Delete
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {creating ? (
        <CreateGroupDialog
          slug={slug}
          onClose={() => setCreating(false)}
          onCreated={() => groupsQuery.refetch()}
        />
      ) : null}

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title="Delete this group?"
        noun="group"
        description={
          <>This permanently deletes “{deleting?.name}” and its membership.</>
        }
        onConfirm={() => api.attendance.deleteGroup(slug, deleting!.id)}
        onDeleted={() => {
          toast({ title: "Group deleted" });
          groupsQuery.refetch();
        }}
      />
    </div>
  );
}
