/**
 * College Attendance (route: /c/:slug/attendance) — Prompt 1: form attendance
 * GROUPS (classes / events) whose membership is the de-duplicated UNION of any
 * mix of org-units, individual students, and an Excel roll-number upload (with a
 * matched/unmatched PREVIEW before confirming). Groups are also EDITABLE — rename
 * / re-describe / change kind, add more members (same selection), and remove
 * individual members. All calls are tenant-scoped + faculty-scoped by the
 * backend; gated by the `attendance` feature. A college admin can toggle whether
 * faculty may form CROSS-CUTTING / Excel groups.
 */
import {
  AttendanceGroupKind,
  COLLEGE_ADMIN_ROLES,
  CollegeFeature,
  checkEntitlement,
  type AttendanceGroupSummary,
} from "@codeapt/shared";
import {
  CalendarCheck,
  ClipboardList,
  Pencil,
  Plus,
  Trash2,
  UserMinus,
  Users,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { ConfirmDeleteDialog } from "../../components/curriculum/admin/ConfirmDeleteDialog.js";
import {
  GroupMemberSelector,
  type ExcelPreview,
} from "../../components/colleges/GroupMemberSelector.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
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
import { EmptyState } from "../../components/ui/empty-state.js";
import { Input } from "../../components/ui/input.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { Switch } from "../../components/ui/switch.js";
import { Textarea } from "../../components/ui/textarea.js";
import { useToast } from "../../components/ui/toast.js";
import { api, parseApiError } from "../../lib/api-client.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

function KindSelect({
  kind,
  onChange,
}: {
  kind: AttendanceGroupKind;
  onChange: (k: AttendanceGroupKind) => void;
}) {
  return (
    <select
      value={kind}
      onChange={(e) => onChange(e.target.value as AttendanceGroupKind)}
      className="h-10 w-full rounded-lg border border-subtle bg-surface px-3 text-sm text-ink"
      aria-label="Group kind"
    >
      <option value={AttendanceGroupKind.CLASS}>Class (recurring)</option>
      <option value={AttendanceGroupKind.EVENT}>Event (one-off)</option>
    </select>
  );
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
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<AttendanceGroupKind>(AttendanceGroupKind.CLASS);
  const [unitIds, setUnitIds] = useState<Set<string>>(new Set());
  const [studentIds, setStudentIds] = useState<Set<string>>(new Set());
  const [excel, setExcel] = useState<ExcelPreview | null>(null);
  const [saving, setSaving] = useState(false);

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
              <KindSelect kind={kind} onChange={setKind} />
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

          <GroupMemberSelector
            slug={slug}
            unitIds={unitIds}
            onUnitIdsChange={setUnitIds}
            studentIds={studentIds}
            onStudentIdsChange={setStudentIds}
            excel={excel}
            onExcelChange={setExcel}
          />
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

function EditGroupDialog({
  slug,
  groupId,
  onClose,
  onSaved,
}: {
  slug: string;
  groupId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const groupQuery = useQuery(() => api.attendance.getGroup(slug, groupId), [
    slug,
    groupId,
  ]);
  const group = groupQuery.data;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<AttendanceGroupKind>(AttendanceGroupKind.CLASS);
  const [seeded, setSeeded] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  const [addingMembers, setAddingMembers] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [unitIds, setUnitIds] = useState<Set<string>>(new Set());
  const [studentIds, setStudentIds] = useState<Set<string>>(new Set());
  const [excel, setExcel] = useState<ExcelPreview | null>(null);

  // Seed the metadata fields once the group loads.
  if (group && !seeded) {
    setName(group.name);
    setDescription(group.description ?? "");
    setKind(group.kind as AttendanceGroupKind);
    setSeeded(true);
  }

  const saveMeta = async (): Promise<void> => {
    if (!name.trim()) {
      toast({ variant: "error", title: "Give the group a name" });
      return;
    }
    setSavingMeta(true);
    try {
      // Metadata only (no membership fields) → members are left untouched.
      await api.attendance.updateGroup(slug, groupId, {
        name: name.trim(),
        description: description.trim(),
        kind,
      });
      toast({ variant: "success", title: "Group updated" });
      onSaved();
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setSavingMeta(false);
    }
  };

  const addMembers = async (): Promise<void> => {
    const total = unitIds.size + studentIds.size + (excel?.matchedRolls.length ?? 0);
    if (total === 0) {
      toast({ variant: "error", title: "Select students to add" });
      return;
    }
    setAddingMembers(true);
    try {
      await api.attendance.addMembers(slug, groupId, {
        orgUnitIds: [...unitIds],
        studentIds: [...studentIds],
        excelRollNumbers: excel?.matchedRolls ?? [],
      });
      toast({ variant: "success", title: "Members added" });
      setUnitIds(new Set());
      setStudentIds(new Set());
      setExcel(null);
      groupQuery.refetch();
      onSaved();
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setAddingMembers(false);
    }
  };

  const removeMember = async (studentId: string): Promise<void> => {
    setRemovingId(studentId);
    try {
      await api.attendance.removeMember(slug, groupId, studentId);
      groupQuery.refetch();
      onSaved();
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit attendance group</DialogTitle>
          <DialogDescription>
            Rename or re-describe the group, add more members, or remove
            individual members.
          </DialogDescription>
        </DialogHeader>

        {groupQuery.loading ? (
          <Skeleton className="h-48 w-full rounded-xl" />
        ) : groupQuery.error || !group ? (
          <Alert variant="error">{groupQuery.error ?? "Group not found"}</Alert>
        ) : (
          <div className="space-y-6">
            {/* Metadata */}
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-ink-muted">Name</label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-ink-muted">Kind</label>
                  <KindSelect kind={kind} onChange={setKind} />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-ink-muted">
                  Description (optional)
                </label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </div>
              <Button size="sm" disabled={savingMeta} onClick={() => void saveMeta()}>
                {savingMeta ? "Saving…" : "Save details"}
              </Button>
            </div>

            {/* Current members */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink">
                Current members{" "}
                <Badge variant="neutral">{group.members.length}</Badge>
              </p>
              {group.members.length === 0 ? (
                <p className="text-xs text-ink-muted">No members yet — add some below.</p>
              ) : (
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-subtle p-2">
                  {group.members.map((m) => (
                    <div
                      key={m.studentId}
                      className="flex items-center justify-between gap-2 text-sm text-ink"
                    >
                      <span className="min-w-0 truncate">
                        {m.fullName || m.rollNumber}{" "}
                        <span className="text-xs text-ink-muted">{m.rollNumber}</span>
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={removingId === m.studentId}
                        onClick={() => void removeMember(m.studentId)}
                      >
                        <UserMinus className="h-4 w-4 text-error-fg" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add members */}
            <div className="space-y-3 border-t border-subtle pt-4">
              <p className="text-sm font-semibold text-ink">Add members</p>
              <GroupMemberSelector
                slug={slug}
                unitIds={unitIds}
                onUnitIdsChange={setUnitIds}
                studentIds={studentIds}
                onStudentIdsChange={setStudentIds}
                excel={excel}
                onExcelChange={setExcel}
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={addingMembers}
                onClick={() => void addMembers()}
              >
                {addingMembers ? "Adding…" : "Add selected"}
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Done
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
  const entitled = checkEntitlement(context.entitlements, CollegeFeature.ATTENDANCE);
  const isAdmin = COLLEGE_ADMIN_ROLES.includes(context.membership.role);

  const groupsQuery = useQuery(
    () => (entitled ? api.attendance.listGroups(slug) : Promise.resolve({ items: [] })),
    [slug, entitled],
  );
  const settingsQuery = useQuery(
    () =>
      entitled && isAdmin ? api.attendance.getSettings(slug) : Promise.resolve(null),
    [slug, entitled, isAdmin],
  );

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AttendanceGroupSummary | null>(null);
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
                    onClick={() => navigate(`/c/${slug}/attendance/groups/${g.id}`)}
                  >
                    <ClipboardList className="h-4 w-4" /> Sessions
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(g)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(g)}>
                    <Trash2 className="h-4 w-4 text-error-fg" />
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

      {editing ? (
        <EditGroupDialog
          slug={slug}
          groupId={editing.id}
          onClose={() => setEditing(null)}
          onSaved={() => groupsQuery.refetch()}
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
