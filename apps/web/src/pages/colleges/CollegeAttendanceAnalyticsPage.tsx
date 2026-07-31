/**
 * Attendance analytics + Excel reports (route: /c/:slug/attendance/analytics) —
 * Prompt 3. Read-only rollups over COMPLETED sessions: an OVERVIEW, BY GROUP,
 * BY DEPARTMENT→SECTION (drillable), and BY STUDENT with defaulter flagging +
 * search/sort, plus Download controls (a group register grid + a summary/
 * defaulters workbook). Reuses the 5a dashboard's StatCard + CSS comparison bars
 * + Tabs/Table. Honest: a null rate renders "—" (no data), never a fake 0%.
 */
import {
  CollegeFeature,
  checkEntitlement,
  type AttendanceUnitStat,
} from "@codeapt/shared";
import {
  AlertTriangle,
  BarChart3,
  CalendarCheck,
  Download,
  Percent,
  Search,
  Users,
} from "lucide-react";
import { useState } from "react";

import { StatCard } from "../../components/colleges/StatCard.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Input } from "../../components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs.js";
import { useToast } from "../../components/ui/toast.js";
import { api, parseApiError } from "../../lib/api-client.js";
import { barPercent } from "../../lib/analytics-view.js";
import { orgUnitTypeLabel } from "../../lib/org-structure-ui.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

const showRate = (r: number | null): string => (r === null ? "—" : `${r}%`);

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function RateBar({ label, rate }: { label: string; rate: number | null }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate text-ink-secondary">{label}</span>
        <span className="tabular-nums font-medium text-ink">{showRate(rate)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-sunken">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
          style={{ width: `${barPercent(rate ?? 0, 100)}%` }}
        />
      </div>
    </div>
  );
}

export function CollegeAttendanceAnalyticsPage() {
  const { slug, context } = useCollege();
  const { toast } = useToast();
  const entitled = checkEntitlement(
    context.entitlements,
    CollegeFeature.ATTENDANCE,
  );

  const [threshold, setThreshold] = useState(75);
  const q = useQuery(
    () => (entitled ? api.attendance.analytics(slug, threshold) : Promise.resolve(null)),
    [slug, entitled, threshold],
  );

  const [studentSearch, setStudentSearch] = useState("");
  const [deptId, setDeptId] = useState("");
  const [registerGroupId, setRegisterGroupId] = useState("");
  const [downloading, setDownloading] = useState(false);

  const download = async (
    fn: () => Promise<{ blob: Blob; filename: string }>,
  ): Promise<void> => {
    setDownloading(true);
    try {
      const { blob, filename } = await fn();
      downloadBlob(blob, filename);
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setDownloading(false);
    }
  };

  if (!entitled) {
    return (
      <div className="space-y-6">
        <PageHeader title="Attendance reports" description="Attendance analytics + Excel reports." />
        <Card className="mx-auto max-w-lg space-y-3 p-8 text-center">
          <BarChart3 className="mx-auto h-10 w-10 text-ink-muted" />
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

  const data = q.data;
  const groups = data?.groups ?? [];
  const units = data?.units ?? [];
  const students = data?.students ?? [];
  const depts = units.filter((u) => u.type === "department");
  const selectedDept = deptId || (depts[0]?.id ?? "");
  const sections: AttendanceUnitStat[] = selectedDept
    ? units.filter((u) => u.parentId === selectedDept)
    : [];
  const filteredStudents = students.filter((s) => {
    const t = `${s.name} ${s.rollNumber}`.toLowerCase();
    return t.includes(studentSearch.trim().toLowerCase());
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance reports"
        description="Attendance rates over recorded (completed) sessions — by group, section, and student — plus downloadable Excel reports."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={registerGroupId}
              onValueChange={setRegisterGroupId}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Group register…" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.groupId} value={g.groupId}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="secondary"
              disabled={downloading || !registerGroupId}
              onClick={() =>
                void download(() =>
                  api.attendance.registerReport(slug, registerGroupId),
                )
              }
            >
              <Download className="h-4 w-4" /> Register
            </Button>
            <Button
              disabled={downloading}
              onClick={() =>
                void download(() =>
                  api.attendance.summaryReport(slug, { threshold }),
                )
              }
            >
              <Download className="h-4 w-4" /> Summary
            </Button>
          </div>
        }
      />

      {q.loading ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : q.error ? (
        <Alert variant="error">{q.error}</Alert>
      ) : !data ? null : data.overview.sessionsHeld === 0 ? (
        <EmptyState
          title="No attendance recorded yet"
          description="Once sessions are taken (completed), attendance rates and reports appear here."
          icon={<CalendarCheck />}
        />
      ) : (
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="groups">By group</TabsTrigger>
            <TabsTrigger value="sections">By section</TabsTrigger>
            <TabsTrigger value="students">Students</TabsTrigger>
          </TabsList>

          {/* Overview */}
          <TabsContent value="overview">
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  icon={Percent}
                  label="Overall attendance"
                  value={data.overview.overallRate ?? 0}
                  suffix="%"
                  decimals={1}
                  hint={`${data.overview.present}/${data.overview.totalMarks} marks`}
                />
                <StatCard
                  icon={CalendarCheck}
                  label="Sessions held"
                  value={data.overview.sessionsHeld}
                  hint={`${data.overview.groups} groups`}
                />
                <StatCard
                  icon={Users}
                  label="Students tracked"
                  value={data.overview.studentsTracked}
                />
                <StatCard
                  icon={AlertTriangle}
                  label={`Below ${data.overview.threshold}%`}
                  value={data.overview.belowThreshold}
                  hint="defaulters"
                />
              </div>
              <Card className="space-y-3 p-5">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-ink-muted">Defaulter threshold</span>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value) || 0)}
                    className="w-24"
                    aria-label="Defaulter threshold percent"
                  />
                  <span className="text-xs text-ink-muted">
                    students below this % are flagged
                  </span>
                </div>
              </Card>
            </div>
          </TabsContent>

          {/* By group */}
          <TabsContent value="groups">
            <div className="space-y-5">
              <Card className="overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Group</TableHead>
                      <TableHead>Members</TableHead>
                      <TableHead>Sessions</TableHead>
                      <TableHead>Attendance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.map((g) => (
                      <TableRow key={g.groupId}>
                        <TableCell className="text-ink">
                          {g.name}{" "}
                          <Badge variant={g.kind === "event" ? "info" : "neutral"}>
                            {g.kind}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-ink-secondary">
                          {g.memberCount}
                        </TableCell>
                        <TableCell className="text-ink-secondary">
                          {g.sessionsHeld}
                        </TableCell>
                        <TableCell className="tabular-nums text-ink-secondary">
                          {showRate(g.rate)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
              <Card className="space-y-3 p-5">
                <h3 className="text-sm font-semibold text-ink">Attendance by group</h3>
                <div className="space-y-3">
                  {groups.map((g) => (
                    <RateBar key={g.groupId} label={g.name} rate={g.rate} />
                  ))}
                </div>
              </Card>
            </div>
          </TabsContent>

          {/* By section (dept → sections) */}
          <TabsContent value="sections">
            {depts.length === 0 ? (
              <EmptyState
                title="No departments"
                description="Build your academic structure (departments → sections) to see org-unit rollups."
                icon={<BarChart3 />}
              />
            ) : (
              <div className="space-y-5">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-ink-muted">Department</span>
                  <Select value={selectedDept} onValueChange={setDeptId}>
                    <SelectTrigger className="w-64">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {depts.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Card className="overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Unit</TableHead>
                        <TableHead>Students</TableHead>
                        <TableHead>Attendance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...units.filter((u) => u.id === selectedDept), ...sections].map(
                        (u) => (
                          <TableRow key={u.id}>
                            <TableCell className="text-ink">
                              {u.name}{" "}
                              <Badge variant="neutral">
                                {orgUnitTypeLabel(
                                  u.type as Parameters<typeof orgUnitTypeLabel>[0],
                                )}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-ink-secondary">
                              {u.students}
                            </TableCell>
                            <TableCell className="tabular-nums text-ink-secondary">
                              {showRate(u.rate)}
                            </TableCell>
                          </TableRow>
                        ),
                      )}
                    </TableBody>
                  </Table>
                </Card>
              </div>
            )}
          </TabsContent>

          {/* Students + defaulters */}
          <TabsContent value="students">
            <div className="space-y-4">
              <div className="relative max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                <Input
                  className="pl-9"
                  placeholder="Search students…"
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                />
              </div>
              <Card className="overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Student</TableHead>
                      <TableHead>Roll</TableHead>
                      <TableHead>Attended</TableHead>
                      <TableHead>%</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredStudents.map((s) => (
                      <TableRow key={s.studentId}>
                        <TableCell className="text-ink">{s.name || "—"}</TableCell>
                        <TableCell className="font-mono text-xs text-ink-muted">
                          {s.rollNumber || "—"}
                        </TableCell>
                        <TableCell className="tabular-nums text-ink-secondary">
                          {s.attended}/{s.total}
                        </TableCell>
                        <TableCell className="tabular-nums text-ink-secondary">
                          {showRate(s.rate)}
                        </TableCell>
                        <TableCell>
                          {s.total === 0 ? (
                            <Badge variant="neutral">No data</Badge>
                          ) : s.below ? (
                            <Badge variant="warning">Below</Badge>
                          ) : (
                            <Badge variant="success">OK</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
