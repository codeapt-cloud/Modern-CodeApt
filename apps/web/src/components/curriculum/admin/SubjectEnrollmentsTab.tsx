/**
 * Manage-enrollments tab for a course (super-admin). A searchable, filterable,
 * paginated roster with per-row + bulk removal, per-learner expiry editing,
 * add-existing-users, roster upload (reused BulkEnrollDialog), and an .xlsx
 * export. College-assigned rows (source "college") are shown but read-only —
 * the server also enforces this, so this surface never silently un-assigns a
 * college's student.
 */
import type { AdminEnrollmentItem, AdminUserListItem } from "@codeapt/shared";
import { Download, Lock, Search, Trash2, UserPlus, Users } from "lucide-react";
import { useState } from "react";

import { api, parseApiError } from "../../../lib/api-client.js";
import { formatExpiry } from "../../../lib/expiry.js";
import { useQuery } from "../../../lib/use-query.js";
import { Alert } from "../../ui/alert.js";
import { Badge } from "../../ui/badge.js";
import { Button } from "../../ui/button.js";
import { Card } from "../../ui/card.js";
import { Checkbox } from "../../ui/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog.js";
import { EmptyState } from "../../ui/empty-state.js";
import { IconButton } from "../../ui/icon-button.js";
import { Input } from "../../ui/input.js";
import { Pagination } from "../../ui/pagination.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select.js";
import { Skeleton } from "../../ui/skeleton.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/table.js";
import { useToast } from "../../ui/toast.js";
import { BulkEnrollDialog } from "./BulkEnrollDialog.js";

const PAGE_SIZE = 25;
const COLLEGE_ANY = "__any__";
type Status = "all" | "active" | "expired";

function toggle(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function blobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** ISO → datetime-local ("YYYY-MM-DDTHH:mm"), or "" for lifetime/blank. */
function isoToLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function SubjectEnrollmentsTab({ subjectId }: { subjectId: string }) {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [college, setCollege] = useState<string>(COLLEGE_ANY);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [editing, setEditing] = useState<AdminEnrollmentItem | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string[] | null>(null);

  const listQ = useQuery(
    () =>
      api.adminCurriculum.enrollments.list(subjectId, {
        q: q.trim(),
        status,
        ...(college !== COLLEGE_ANY ? { college } : {}),
        page,
        pageSize: PAGE_SIZE,
      }),
    [subjectId, q, status, college, page],
  );
  const collegesQ = useQuery(
    () => api.adminCurriculum.enrollments.colleges(subjectId),
    [subjectId],
  );
  const collegeOptions = collegesQ.data?.colleges ?? [];

  const items = listQ.data?.items ?? [];
  const total = listQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const managed = items.filter((e) => e.managed);
  const allManagedSelected =
    managed.length > 0 && managed.every((e) => selected.has(e.userId));

  const refresh = (): void => {
    setSelected(new Set());
    listQ.refetch();
  };

  const runRemove = async (userIds: string[]): Promise<void> => {
    setBusy(true);
    try {
      const res = await api.adminCurriculum.enrollments.remove(
        subjectId,
        userIds,
      );
      toast({
        variant: "success",
        title: `Removed ${res.removed} enrolment${res.removed === 1 ? "" : "s"}`,
      });
      setConfirmRemove(null);
      refresh();
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setBusy(false);
    }
  };

  const downloadRoster = async (): Promise<void> => {
    setBusy(true);
    try {
      const { blob, filename } =
        await api.adminCurriculum.enrollments.exportRoster(subjectId);
      blobDownload(blob, filename);
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <Input
            className="pl-9"
            placeholder="Search name, email, roll…"
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => {
            setPage(1);
            setStatus(v as Status);
          }}
        >
          <SelectTrigger className="w-full sm:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>
        {collegeOptions.length > 0 ? (
          <Select
            value={college}
            onValueChange={(v) => {
              setPage(1);
              setCollege(v);
            }}
          >
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={COLLEGE_ANY}>All colleges</SelectItem>
              {collegeOptions.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Button variant="secondary" onClick={() => setAddOpen(true)}>
          <UserPlus className="h-4 w-4" /> Add users
        </Button>
        <Button variant="secondary" onClick={() => setRosterOpen(true)}>
          <Users className="h-4 w-4" /> Upload roster
        </Button>
        <Button
          variant="secondary"
          loading={busy}
          onClick={() => void downloadRoster()}
        >
          <Download className="h-4 w-4" /> Download roster
        </Button>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 ? (
        <div className="flex items-center justify-between rounded-xl border border-subtle bg-surface-raised px-4 py-2">
          <span className="text-sm text-ink">{selected.size} selected</span>
          <Button
            variant="destructive"
            size="sm"
            loading={busy}
            onClick={() => setConfirmRemove([...selected])}
          >
            <Trash2 className="h-4 w-4" /> Remove selected
          </Button>
        </div>
      ) : null}

      {listQ.loading ? (
        <Skeleton className="h-72 w-full rounded-2xl" />
      ) : listQ.error ? (
        <Alert variant="error">{listQ.error}</Alert>
      ) : items.length === 0 ? (
        <EmptyState
          title="No enrollments match"
          description="Adjust the search/filter, or add users to this course."
          icon={<Users />}
        />
      ) : (
        <>
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="Select all on this page"
                      checked={allManagedSelected}
                      onCheckedChange={() => {
                        setSelected((prev) => {
                          if (allManagedSelected) {
                            const next = new Set(prev);
                            managed.forEach((e) => next.delete(e.userId));
                            return next;
                          }
                          const next = new Set(prev);
                          managed.forEach((e) => next.add(e.userId));
                          return next;
                        });
                      }}
                    />
                  </TableHead>
                  <TableHead>Learner</TableHead>
                  <TableHead>Roll</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((e) => {
                  const exp = formatExpiry(e.expiresAt);
                  return (
                    <TableRow key={e.enrollmentId}>
                      <TableCell>
                        <Checkbox
                          aria-label={`Select ${e.email}`}
                          checked={selected.has(e.userId)}
                          disabled={!e.managed}
                          onCheckedChange={() =>
                            setSelected((prev) => toggle(prev, e.userId))
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-ink">
                          {e.fullName || "—"}
                        </div>
                        <div className="max-w-[16rem] truncate text-xs text-ink-muted">
                          {e.email}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-ink-secondary">
                        {e.rollNumber || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={e.source === "college" ? "info" : "neutral"}
                        >
                          {e.source}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {!e.active ? (
                          <Badge variant="warning">Expired</Badge>
                        ) : exp ? (
                          <span className="text-xs text-ink-secondary">
                            {exp.text}
                          </span>
                        ) : (
                          <span className="text-xs text-ink-muted">Lifetime</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {e.managed ? (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditing(e)}
                              >
                                Edit expiry
                              </Button>
                              <IconButton
                                aria-label="Remove enrolment"
                                variant="ghost"
                                size="sm"
                                icon={
                                  <Trash2 className="h-4 w-4 text-error-fg" />
                                }
                                onClick={() => setConfirmRemove([e.userId])}
                              />
                            </>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
                              <Lock className="h-3.5 w-3.5" /> College-managed
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
          <div className="flex items-center justify-between">
            <p className="text-xs text-ink-muted">
              {total} enrolment{total === 1 ? "" : "s"}
            </p>
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          </div>
        </>
      )}

      {addOpen ? (
        <AddUsersDialog
          subjectId={subjectId}
          onOpenChange={setAddOpen}
          onDone={refresh}
        />
      ) : null}

      {rosterOpen ? (
        <BulkEnrollDialog
          open
          onOpenChange={setRosterOpen}
          defaultSubjectId={subjectId}
          onDone={refresh}
        />
      ) : null}

      {editing ? (
        <EditExpiryDialog
          subjectId={subjectId}
          enrollment={editing}
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
          onSaved={refresh}
        />
      ) : null}

      <Dialog
        open={confirmRemove !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmRemove(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove enrollments?</DialogTitle>
            <DialogDescription>
              This removes access to the course for{" "}
              {confirmRemove?.length ?? 0} learner
              {confirmRemove?.length === 1 ? "" : "s"}. Their progress and
              results are kept, and they can be re-enrolled later. College-
              assigned enrollments are never affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmRemove(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={busy}
              onClick={() => confirmRemove && void runRemove(confirmRemove)}
            >
              <Trash2 className="h-4 w-4" /> Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Search existing users and enroll the selected ones into the course. */
function AddUsersDialog({
  subjectId,
  onOpenChange,
  onDone,
}: {
  subjectId: string;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const usersQ = useQuery(
    () =>
      q.trim().length >= 2
        ? api.adminUsers.list({ q: q.trim(), page: 1, pageSize: 20 })
        : Promise.resolve({ items: [], total: 0, page: 1, pageSize: 20 }),
    [q],
  );
  const users: AdminUserListItem[] = usersQ.data?.items ?? [];

  const enroll = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await api.adminCurriculum.enrollments.add(subjectId, [
        ...picked,
      ]);
      toast({
        variant: "success",
        title:
          `Enrolled ${res.added} user${res.added === 1 ? "" : "s"}` +
          (res.skipped > 0 ? ` · ${res.skipped} already enrolled` : ""),
      });
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-4rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add existing users</DialogTitle>
          <DialogDescription>
            Search platform users by name, email, or roll number and enroll them
            into this course. Access expiry is stamped from the course&apos;s
            validity.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <Input
            className="pl-9"
            placeholder="Type at least 2 characters…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
        </div>

        <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-subtle p-2">
          {usersQ.loading ? (
            <Skeleton className="h-24 w-full rounded-lg" />
          ) : users.length === 0 ? (
            <p className="p-2 text-xs text-ink-muted">
              {q.trim().length < 2
                ? "Start typing to search users."
                : "No users match."}
            </p>
          ) : (
            users.map((u) => (
              <label
                key={u.id}
                className="flex items-center gap-2 rounded-md p-1.5 text-sm text-ink hover:bg-surface-sunken"
              >
                <Checkbox
                  checked={picked.has(u.id)}
                  onCheckedChange={() => setPicked((p) => toggle(p, u.id))}
                />
                <span className="truncate">{u.fullName || u.username}</span>
                <span className="truncate text-xs text-ink-muted">
                  {u.email}
                </span>
                {u.rollNumber ? (
                  <span className="ml-auto font-mono text-xs text-ink-muted">
                    {u.rollNumber}
                  </span>
                ) : null}
              </label>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={picked.size === 0}
            onClick={() => void enroll()}
          >
            <UserPlus className="h-4 w-4" /> Enroll {picked.size || ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Set or clear one learner's access expiry. */
function EditExpiryDialog({
  subjectId,
  enrollment,
  onOpenChange,
  onSaved,
}: {
  subjectId: string;
  enrollment: AdminEnrollmentItem;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [value, setValue] = useState(isoToLocal(enrollment.expiresAt));
  const [busy, setBusy] = useState(false);

  const save = async (expiresAt: string | null): Promise<void> => {
    setBusy(true);
    try {
      await api.adminCurriculum.enrollments.setExpiry(
        subjectId,
        enrollment.enrollmentId,
        expiresAt,
      );
      toast({ variant: "success", title: "Expiry updated" });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit access expiry</DialogTitle>
          <DialogDescription>
            {enrollment.fullName || enrollment.email}. Set a date, or clear it
            for lifetime access.
          </DialogDescription>
        </DialogHeader>
        <Input
          type="datetime-local"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            loading={busy}
            onClick={() => void save(null)}
          >
            Clear (lifetime)
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              loading={busy}
              disabled={value === ""}
              onClick={() =>
                void save(value ? new Date(value).toISOString() : null)
              }
            >
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
