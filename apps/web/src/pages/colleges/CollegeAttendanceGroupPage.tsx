/**
 * A group's SESSIONS (route: /c/:slug/attendance/groups/:groupId) — Prompt 2.
 * Lists a group's sessions (upcoming/past + status + present/total), and lets an
 * owner/admin SCHEDULE a session (date+time) or TAKE ATTENDANCE NOW (ad-hoc →
 * opens the marking screen immediately). Opening any session navigates to the
 * take-attendance screen (a completed one re-opens for correction).
 */
import type { AttendanceSession } from "@codeapt/shared";
import { ArrowLeft, CalendarPlus, ClipboardList, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ConfirmDeleteDialog } from "../../components/curriculum/admin/ConfirmDeleteDialog.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card } from "../../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Input } from "../../components/ui/input.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { useToast } from "../../components/ui/toast.js";
import { api, parseApiError } from "../../lib/api-client.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

const STATUS_VARIANT: Record<string, "neutral" | "info" | "success"> = {
  scheduled: "neutral",
  open: "info",
  completed: "success",
};

export function CollegeAttendanceGroupPage() {
  const { slug } = useCollege();
  const { groupId = "" } = useParams();
  const { toast } = useToast();
  const navigate = useNavigate();

  const groupQuery = useQuery(() => api.attendance.getGroup(slug, groupId), [
    slug,
    groupId,
  ]);
  const sessionsQuery = useQuery(
    () => api.attendance.listSessions(slug, groupId),
    [slug, groupId],
  );

  const [scheduling, setScheduling] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [scheduleTitle, setScheduleTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<AttendanceSession | null>(null);

  const group = groupQuery.data;
  const sessions = sessionsQuery.data?.items ?? [];

  const takeNow = async (): Promise<void> => {
    setBusy(true);
    try {
      const session = await api.attendance.createSession(slug, groupId, {});
      navigate(`/c/${slug}/attendance/sessions/${session.id}`);
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
      setBusy(false);
    }
  };

  const schedule = async (): Promise<void> => {
    if (!scheduleAt) {
      toast({ variant: "error", title: "Pick a date and time" });
      return;
    }
    setBusy(true);
    try {
      await api.attendance.createSession(slug, groupId, {
        title: scheduleTitle.trim() || undefined,
        scheduledAt: new Date(scheduleAt).toISOString(),
      });
      toast({ variant: "success", title: "Session scheduled" });
      setScheduling(false);
      setScheduleAt("");
      setScheduleTitle("");
      sessionsQuery.refetch();
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => navigate(`/c/${slug}/attendance`)}
        className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> All groups
      </button>

      <PageHeader
        title={group ? group.name : "Attendance group"}
        description={
          group
            ? `${group.kind === "event" ? "Event" : "Class"} · ${group.memberCount} member${group.memberCount === 1 ? "" : "s"}`
            : "Sessions"
        }
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setScheduling(true)}>
              <CalendarPlus className="h-4 w-4" /> Schedule session
            </Button>
            <Button disabled={busy} onClick={() => void takeNow()}>
              <Play className="h-4 w-4" /> Take attendance now
            </Button>
          </div>
        }
      />

      {sessionsQuery.loading ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : sessionsQuery.error ? (
        <Alert variant="error">{sessionsQuery.error}</Alert>
      ) : sessions.length === 0 ? (
        <EmptyState
          title="No sessions yet"
          description="Schedule a session for later, or take attendance now to record it immediately."
          icon={<ClipboardList />}
          action={
            <Button size="sm" disabled={busy} onClick={() => void takeNow()}>
              <Play className="h-4 w-4" /> Take attendance now
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <Card
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium text-ink">
                    {s.title || new Date(s.scheduledAt).toLocaleString()}
                  </h3>
                  <Badge variant={STATUS_VARIANT[s.status] ?? "neutral"}>
                    {s.status}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {new Date(s.scheduledAt).toLocaleString()}
                  {s.recorded
                    ? ` · ${s.presentCount}/${s.total} present`
                    : ` · ${s.total} on roster`}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    navigate(`/c/${slug}/attendance/sessions/${s.id}`)
                  }
                >
                  {s.recorded ? "Review / correct" : "Take attendance"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleting(s)}>
                  <Trash2 className="h-4 w-4 text-error-fg" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Schedule dialog */}
      <Dialog
        open={scheduling}
        onOpenChange={(o) => {
          if (!o) setScheduling(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule a session</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-ink-muted">
                Date &amp; time
              </label>
              <Input
                type="datetime-local"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
                aria-label="Session date and time"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-ink-muted">
                Title (optional)
              </label>
              <Input
                value={scheduleTitle}
                onChange={(e) => setScheduleTitle(e.target.value)}
                placeholder="e.g. Week 3 lecture"
                aria-label="Session title"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setScheduling(false)}>
              Cancel
            </Button>
            <Button disabled={busy || !scheduleAt} onClick={() => void schedule()}>
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title="Delete this session?"
        noun="session"
        description={
          <>This permanently deletes the session and any recorded marks.</>
        }
        onConfirm={() => api.attendance.deleteSession(slug, deleting!.id)}
        onDeleted={() => {
          toast({ title: "Session deleted" });
          sessionsQuery.refetch();
        }}
      />
    </div>
  );
}
