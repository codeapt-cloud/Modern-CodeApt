/**
 * Take attendance (route: /c/:slug/attendance/sessions/:sessionId) — Prompt 2.
 * Loads the session roster, lets an owner/admin mark each student PRESENT/ABSENT
 * (a "Mark all present" bulk toggle + per-student toggles), shows a live
 * present/absent/total tally, and saves the FINAL set (records upserted, session
 * completed). A completed session re-opens here for correction and re-save.
 * Fast for a big roster: client-side search + scroll.
 */
import {
  AttendanceRecordStatus,
  type AttendanceRosterEntry,
} from "@codeapt/shared";
import { ArrowLeft, Check, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card } from "../../components/ui/card.js";
import { Input } from "../../components/ui/input.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { Switch } from "../../components/ui/switch.js";
import { useToast } from "../../components/ui/toast.js";
import { api, parseApiError } from "../../lib/api-client.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

type Status = AttendanceRecordStatus;

export function CollegeTakeAttendancePage() {
  const { slug } = useCollege();
  const { sessionId = "" } = useParams();
  const { toast } = useToast();
  const navigate = useNavigate();

  const rosterQuery = useQuery(() => api.attendance.getSession(slug, sessionId), [
    slug,
    sessionId,
  ]);

  const [marks, setMarks] = useState<Record<string, Status>>({});
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);

  // Seed local marks from the roster once it loads (unmarked default to absent).
  useEffect(() => {
    const entries = rosterQuery.data?.entries;
    if (!entries) return;
    const seed: Record<string, Status> = {};
    for (const e of entries) seed[e.studentId] = e.status;
    setMarks(seed);
  }, [rosterQuery.data]);

  const entries: AttendanceRosterEntry[] = useMemo(
    () => rosterQuery.data?.entries ?? [],
    [rosterQuery.data],
  );
  const session = rosterQuery.data?.session;

  const present = Object.values(marks).filter(
    (s) => s === AttendanceRecordStatus.PRESENT,
  ).length;
  const total = entries.length;
  const absent = total - present;
  const allPresent = total > 0 && present === total;

  const setAll = (status: Status): void => {
    const next: Record<string, Status> = {};
    for (const e of entries) next[e.studentId] = status;
    setMarks(next);
  };

  const toggle = (studentId: string): void => {
    setMarks((prev) => ({
      ...prev,
      [studentId]:
        prev[studentId] === AttendanceRecordStatus.PRESENT
          ? AttendanceRecordStatus.ABSENT
          : AttendanceRecordStatus.PRESENT,
    }));
  };

  const filtered = entries.filter((e) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return (
      e.fullName.toLowerCase().includes(q) ||
      e.rollNumber.toLowerCase().includes(q)
    );
  });

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await api.attendance.saveAttendance(slug, sessionId, {
        marks: entries.map((e) => ({
          studentId: e.studentId,
          status: marks[e.studentId] ?? AttendanceRecordStatus.ABSENT,
        })),
      });
      toast({ variant: "success", title: `Saved — ${present}/${total} present` });
      if (session) navigate(`/c/${slug}/attendance/groups/${session.groupId}`);
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setSaving(false);
    }
  };

  if (rosterQuery.loading) {
    return <Skeleton className="h-72 w-full rounded-2xl" />;
  }
  if (rosterQuery.error || !session) {
    return <Alert variant="error">{rosterQuery.error ?? "Session not found"}</Alert>;
  }

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => navigate(`/c/${slug}/attendance/groups/${session.groupId}`)}
        className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> {session.groupName}
      </button>

      <PageHeader
        title={session.title || "Take attendance"}
        description={new Date(session.scheduledAt).toLocaleString()}
        actions={
          <Button loading={saving} onClick={() => void save()}>
            <Save className="h-4 w-4" /> Save
          </Button>
        }
      />

      {/* Tally + bulk controls */}
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3 text-sm">
          <Badge variant="success">{present} present</Badge>
          <Badge variant="warning">{absent} absent</Badge>
          <span className="text-ink-muted">of {total}</span>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <Switch
            checked={allPresent}
            onCheckedChange={(v) =>
              setAll(v ? AttendanceRecordStatus.PRESENT : AttendanceRecordStatus.ABSENT)
            }
          />
          Mark all present
        </label>
      </Card>

      <Input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search by name or roll number…"
        aria-label="Search roster"
      />

      {total === 0 ? (
        <Alert variant="info">
          This group has no members yet. Add members to the group, then take
          attendance.
        </Alert>
      ) : (
        <div className="space-y-1">
          {filtered.map((e) => {
            const isPresent = marks[e.studentId] === AttendanceRecordStatus.PRESENT;
            return (
              <Card
                key={e.studentId}
                className="flex items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {e.fullName || e.rollNumber}
                  </p>
                  <p className="text-xs text-ink-muted">{e.rollNumber}</p>
                </div>
                <button
                  type="button"
                  onClick={() => toggle(e.studentId)}
                  className={
                    "inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium " +
                    (isPresent
                      ? "bg-success-subtle text-success-fg"
                      : "bg-warning-subtle text-warning-fg")
                  }
                  aria-pressed={isPresent}
                >
                  {isPresent ? (
                    <>
                      <Check className="h-4 w-4" /> Present
                    </>
                  ) : (
                    <>
                      <X className="h-4 w-4" /> Absent
                    </>
                  )}
                </button>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
