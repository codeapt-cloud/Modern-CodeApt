/**
 * My attendance (student space, route: /c/:slug/attendance for a college student)
 * — the student's OWN attendance: overall % (a clear ring), a per-group
 * breakdown, and a present/absent session history. Read-only, own-data-only
 * (the backend returns only the calling student's data). Feature-gated on
 * `attendance`; honest "no data" state (never a fake 0%).
 */
import { CollegeFeature, checkEntitlement } from "@codeapt/shared";
import { CalendarCheck, Check, X } from "lucide-react";

import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Card } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table.js";
import { api } from "../../lib/api-client.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

/** A CSS conic-gradient attendance ring — the clear at-a-glance visual. */
function AttendanceRing({ rate }: { rate: number | null }) {
  const pct = rate ?? 0;
  const color =
    rate === null
      ? "rgb(var(--color-ink-muted)/0.4)"
      : pct >= 75
        ? "rgb(var(--color-success-500))"
        : pct >= 50
          ? "rgb(var(--color-warning-500))"
          : "rgb(var(--color-error-500))";
  return (
    <div
      className="relative flex h-40 w-40 items-center justify-center rounded-full"
      style={{
        background: `conic-gradient(${color} ${pct * 3.6}deg, rgb(var(--color-surface-sunken)) 0deg)`,
      }}
    >
      <div className="flex h-32 w-32 flex-col items-center justify-center rounded-full bg-surface">
        <span className="text-3xl font-extrabold tabular-nums text-ink">
          {rate === null ? "—" : `${rate}%`}
        </span>
        <span className="text-xs text-ink-muted">attendance</span>
      </div>
    </div>
  );
}

export function CollegeStudentAttendancePage() {
  const { slug, context } = useCollege();
  const entitled = checkEntitlement(
    context.entitlements,
    CollegeFeature.ATTENDANCE,
  );
  const q = useQuery(
    () => (entitled ? api.collegeContext.myAttendance(slug) : Promise.resolve(null)),
    [slug, entitled],
  );

  if (!entitled) {
    return (
      <div className="space-y-6">
        <PageHeader title="My attendance" description="Your attendance record." />
        <Card className="mx-auto max-w-lg space-y-3 p-8 text-center">
          <CalendarCheck className="mx-auto h-10 w-10 text-ink-muted" />
          <h2 className="text-lg font-semibold text-ink">
            Attendance isn&apos;t enabled
          </h2>
          <p className="text-sm text-ink-muted">
            Your college hasn&apos;t enabled attendance.
          </p>
        </Card>
      </div>
    );
  }

  const data = q.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My attendance"
        description="Your attendance across all your classes and events, over the sessions that were actually recorded."
      />

      {q.loading ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : q.error ? (
        <Alert variant="error">{q.error}</Alert>
      ) : !data ? null : data.overall.total === 0 ? (
        <EmptyState
          title="No attendance recorded yet"
          description="Once your classes/events have taken attendance, your percentage and history appear here."
          icon={<CalendarCheck />}
        />
      ) : (
        <>
          {/* Overall ring + tally */}
          <Card className="flex flex-wrap items-center gap-6 p-6">
            <AttendanceRing rate={data.overall.rate} />
            <div className="space-y-1">
              <p className="text-sm text-ink-muted">Overall</p>
              <p className="text-2xl font-bold text-ink">
                {data.overall.attended}
                <span className="text-ink-muted"> / {data.overall.total}</span>{" "}
                <span className="text-base font-normal text-ink-muted">
                  sessions attended
                </span>
              </p>
              <p className="text-xs text-ink-muted">
                across {data.groups.length} group
                {data.groups.length === 1 ? "" : "s"} · over recorded sessions only
              </p>
            </div>
          </Card>

          {/* Per-group breakdown */}
          {data.groups.length > 0 ? (
            <Card className="overflow-hidden">
              <div className="border-b border-subtle p-4">
                <h3 className="text-sm font-semibold text-ink">By group</h3>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Group</TableHead>
                    <TableHead>Attended</TableHead>
                    <TableHead>%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.groups.map((g) => (
                    <TableRow key={g.groupId}>
                      <TableCell className="text-ink">
                        {g.name}{" "}
                        <Badge variant={g.kind === "event" ? "info" : "neutral"}>
                          {g.kind}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums text-ink-secondary">
                        {g.attended} / {g.total}
                      </TableCell>
                      <TableCell className="tabular-nums text-ink-secondary">
                        {g.rate === null ? "—" : `${g.rate}%`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          ) : null}

          {/* Present/absent session history */}
          <Card className="overflow-hidden">
            <div className="border-b border-subtle p-4">
              <h3 className="text-sm font-semibold text-ink">Session history</h3>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Group</TableHead>
                  <TableHead>Session</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.sessions.map((s) => (
                  <TableRow key={s.sessionId}>
                    <TableCell className="text-ink-secondary">
                      {new Date(s.scheduledAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-ink">{s.groupName}</TableCell>
                    <TableCell className="text-ink-secondary">
                      {s.title || "—"}
                    </TableCell>
                    <TableCell>
                      {s.status === "present" ? (
                        <Badge variant="success">
                          <Check className="h-3.5 w-3.5" /> Present
                        </Badge>
                      ) : (
                        <Badge variant="warning">
                          <X className="h-3.5 w-3.5" /> Absent
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
