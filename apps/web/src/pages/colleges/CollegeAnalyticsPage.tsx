/**
 * College analytics dashboard (route: /c/:slug/analytics). Three views over the
 * 5a-i tenant + faculty-scoped endpoints — OVERVIEW (headline metrics + honest
 * comparison bars), BY UNIT (department → section rollups), and STUDENTS (a
 * scope-aware picker → per-student profile). Reuses the dashboard's StatCard +
 * motion so it feels like the same product; charts are dependency-free CSS bars
 * (no charting lib is installed — see the guardrail).
 *
 * HONESTY: only real metrics are shown. Courses report ASSIGNMENT COUNTS — the
 * engine tracks no per-enrollment progress — so there is never a fabricated
 * completion/progress bar. Feature-gated (`analytics`); the backend enforces
 * faculty org-unit scope and this UI reflects it (an out-of-scope student profile
 * surfaces the server's denial).
 */
import {
  CollegeFeature,
  checkEntitlement,
  type CollegeAnalyticsUnit,
} from "@codeapt/shared";
import {
  BarChart3,
  BookOpen,
  ClipboardCheck,
  Flame,
  GraduationCap,
  PenLine,
  Search,
  Trophy,
  Users,
} from "lucide-react";
import { useState } from "react";

import { StatCard } from "../../components/colleges/StatCard.js";
import { Reveal } from "../../components/motion/Reveal.js";
import { Stagger, StaggerItem } from "../../components/motion/Stagger.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Card } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Input } from "../../components/ui/input.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs.js";
import { api } from "../../lib/api-client.js";
import { barPercent, childrenOf, departments, maxOf } from "../../lib/analytics-view.js";
import { orgUnitTypeLabel } from "../../lib/org-structure-ui.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

/** A dependency-free horizontal comparison bar (relative to `max`). */
function CompareBar({
  label,
  value,
  max,
  suffix = "",
}: {
  label: string;
  value: number;
  max: number;
  suffix?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate text-ink-secondary">{label}</span>
        <span className="tabular-nums font-medium text-ink">
          {value}
          {suffix}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-sunken">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
          style={{ width: `${barPercent(value, max)}%` }}
        />
      </div>
    </div>
  );
}

// --- Overview ----------------------------------------------------------------

function OverviewTab({ slug }: { slug: string }) {
  const q = useQuery(() => api.collegeAnalytics.overview(slug), [slug]);

  if (q.loading) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (q.error) return <Alert variant="error">{q.error}</Alert>;
  if (!q.data) return null;
  const d = q.data;

  if (d.students === 0) {
    return (
      <EmptyState
        title="No students yet"
        description="Add students (and let them take exams, write essays, or solve the daily challenge) to see analytics here."
        icon={<Users />}
      />
    );
  }

  const partMax = maxOf([
    d.exams.attempts,
    d.essays.submissions,
    d.courses.assignments,
    d.challenges.participants,
  ]);

  return (
    <div className="space-y-6">
      <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StaggerItem>
          <StatCard icon={Users} label="Students in scope" value={d.students} />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            icon={ClipboardCheck}
            label="Exam attempts"
            value={d.exams.attempts}
            hint={`${d.exams.students} students`}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            icon={BarChart3}
            label="Avg exam score"
            value={d.exams.avgScore}
            decimals={1}
            hint="mean of raw marks"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            icon={BarChart3}
            label="Exam pass rate"
            value={d.exams.passRate}
            suffix="%"
            decimals={1}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            icon={PenLine}
            label="Essay submissions"
            value={d.essays.submissions}
            hint={`${d.essays.graded} graded`}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            icon={PenLine}
            label="Avg essay score"
            value={d.essays.avgScore}
            suffix="/100"
            decimals={1}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            icon={BookOpen}
            label="Course assignments"
            value={d.courses.assignments}
            hint="progress not tracked"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            icon={Trophy}
            label="Challenge participants"
            value={d.challenges.participants}
            hint={`avg streak ${d.challenges.avgCurrentStreak}`}
          />
        </StaggerItem>
      </Stagger>

      <Reveal>
        <Card className="space-y-4 p-5">
          <h3 className="text-sm font-semibold text-ink">
            Participation across activities
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <CompareBar label="Exam attempts" value={d.exams.attempts} max={partMax} />
            <CompareBar
              label="Essay submissions"
              value={d.essays.submissions}
              max={partMax}
            />
            <CompareBar
              label="Course assignments"
              value={d.courses.assignments}
              max={partMax}
            />
            <CompareBar
              label="Challenge participants"
              value={d.challenges.participants}
              max={partMax}
            />
          </div>
        </Card>
      </Reveal>
    </div>
  );
}

// --- By org-unit -------------------------------------------------------------

function UnitTable({ units }: { units: CollegeAnalyticsUnit[] }) {
  const scoreMax = maxOf(units.map((u) => u.exams.avgScore));
  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Unit</TableHead>
              <TableHead>Students</TableHead>
              <TableHead>Exam avg</TableHead>
              <TableHead>Pass rate</TableHead>
              <TableHead>Essay avg</TableHead>
              <TableHead>Challenge</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {units.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="text-ink">
                  {u.name}{" "}
                  <Badge variant="neutral">{orgUnitTypeLabel(u.type)}</Badge>
                </TableCell>
                <TableCell className="text-ink-secondary">{u.students}</TableCell>
                <TableCell className="tabular-nums text-ink-secondary">
                  {u.exams.avgScore}
                </TableCell>
                <TableCell className="tabular-nums text-ink-secondary">
                  {u.exams.passRate}%
                </TableCell>
                <TableCell className="tabular-nums text-ink-secondary">
                  {u.essays.avgScore}
                </TableCell>
                <TableCell className="text-ink-secondary">
                  {u.challenges.participants}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="space-y-3 p-5">
        <h3 className="text-sm font-semibold text-ink">Avg exam score by unit</h3>
        <div className="space-y-3">
          {units.map((u) => (
            <CompareBar
              key={u.id}
              label={u.name}
              value={u.exams.avgScore}
              max={scoreMax}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

function ByUnitTab({ slug }: { slug: string }) {
  const q = useQuery(() => api.collegeAnalytics.byOrgUnit(slug), [slug]);
  const units = q.data?.units ?? [];
  const depts = departments(units);
  const [deptId, setDeptId] = useState<string>("");

  if (q.loading) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (q.error) return <Alert variant="error">{q.error}</Alert>;
  if (units.length === 0) {
    return (
      <EmptyState
        title="No units in scope"
        description="Build your academic structure (or ask for a wider scope) to see department and section rollups."
        icon={<BarChart3 />}
      />
    );
  }

  // With departments in scope → drill dept → sections. Otherwise (e.g. a faculty
  // scoped to a section) → a flat comparison of the units they can see.
  if (depts.length === 0) {
    return <UnitTable units={units} />;
  }

  const selected = deptId || (depts[0]?.id ?? "");
  const sections = childrenOf(units, selected);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="text-sm text-ink-muted">Department</span>
        <Select value={selected} onValueChange={setDeptId}>
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

      {sections.length === 0 ? (
        <EmptyState
          title="No sub-units"
          description="This department has no sections yet — its own rollup is shown above once students are assigned."
          icon={<BarChart3 />}
        />
      ) : (
        <UnitTable units={sections} />
      )}
    </div>
  );
}

// --- Students ----------------------------------------------------------------

function StudentProfile({ slug, studentId }: { slug: string; studentId: string }) {
  const q = useQuery(
    () => api.collegeAnalytics.student(slug, studentId),
    [slug, studentId],
  );
  if (q.loading) return <Skeleton className="h-48 w-full rounded-2xl" />;
  if (q.error) return <Alert variant="error">{q.error}</Alert>;
  if (!q.data) return null;
  const s = q.data;

  return (
    <Card className="space-y-5 p-5">
      <div>
        <h3 className="text-lg font-semibold text-ink">{s.name}</h3>
        <p className="font-mono text-xs text-ink-muted">{s.rollNumber || "—"}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-subtle p-4">
          <p className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
            <ClipboardCheck className="h-3.5 w-3.5" /> Exams
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
            {s.exams.attempts}
          </p>
          <p className="text-xs text-ink-muted">
            avg {s.exams.avgScore} · {s.exams.passed} passed
          </p>
        </div>
        <div className="rounded-xl border border-subtle p-4">
          <p className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
            <PenLine className="h-3.5 w-3.5" /> Essays
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
            {s.essays.submissions}
          </p>
          <p className="text-xs text-ink-muted">
            {s.essays.graded} graded · avg {s.essays.avgScore}/100
          </p>
        </div>
        <div className="rounded-xl border border-subtle p-4">
          <p className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
            <BookOpen className="h-3.5 w-3.5" /> Courses
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
            {s.courses.assignments}
          </p>
          <p className="text-xs text-ink-muted">assignments (no progress)</p>
        </div>
        <div className="rounded-xl border border-subtle p-4">
          <p className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
            <Trophy className="h-3.5 w-3.5" /> Challenge
          </p>
          {s.challenge ? (
            <>
              <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
                {s.challenge.totalScore}
              </p>
              <p className="flex items-center gap-1 text-xs text-ink-muted">
                <Flame className="h-3 w-3 text-warning-fg" />
                {s.challenge.currentStreak} · best {s.challenge.maxStreak}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-ink-muted">No activity</p>
          )}
        </div>
      </div>
    </Card>
  );
}

function StudentsTab({ slug }: { slug: string }) {
  const q = useQuery(() => api.collegeStudents.list(slug, {}), [slug]);
  const students = q.data?.items ?? [];
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const filtered = students.filter((s) => {
    const t = `${s.fullName} ${s.rollNumber}`.toLowerCase();
    return t.includes(search.trim().toLowerCase());
  });

  return (
    <div className="grid gap-5 lg:grid-cols-[20rem_1fr]">
      <Card className="flex max-h-[70vh] flex-col p-3">
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <Input
            className="pl-9"
            placeholder="Search students…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {q.loading ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : q.error ? (
          <Alert variant="error">{q.error}</Alert>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-ink-muted">
            {students.length === 0 ? "No students in scope." : "No matches."}
          </p>
        ) : (
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {filtered.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSelected(s.id)}
                  className={
                    "flex w-full flex-col items-start rounded-lg px-3 py-2 text-left transition-colors " +
                    (selected === s.id
                      ? "bg-primary/15 text-primary"
                      : "hover:bg-surface-overlay")
                  }
                >
                  <span className="truncate text-sm font-medium text-ink">
                    {s.fullName}
                  </span>
                  <span className="font-mono text-[11px] text-ink-muted">
                    {s.rollNumber}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {selected ? (
        <StudentProfile slug={slug} studentId={selected} />
      ) : (
        <EmptyState
          title="Pick a student"
          description="Select a student to see their exam, essay, course, and challenge performance."
          icon={<GraduationCap />}
        />
      )}
    </div>
  );
}

// --- Page --------------------------------------------------------------------

export function CollegeAnalyticsPage() {
  const { slug, context } = useCollege();
  const entitled = checkEntitlement(
    context.entitlements,
    CollegeFeature.ANALYTICS,
  );

  if (!entitled) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Analytics"
          description="Cohort performance across exams, essays, courses, and challenges."
        />
        <Card className="mx-auto max-w-lg space-y-3 p-8 text-center">
          <BarChart3 className="mx-auto h-10 w-10 text-ink-muted" />
          <h2 className="text-lg font-semibold text-ink">
            Analytics aren&apos;t enabled
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
        title="Analytics"
        description="How your students are performing across exams, essays, courses, and the daily challenge — over your scope."
      />
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="units">By department</TabsTrigger>
          <TabsTrigger value="students">Students</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab slug={slug} />
        </TabsContent>
        <TabsContent value="units">
          <ByUnitTab slug={slug} />
        </TabsContent>
        <TabsContent value="students">
          <StudentsTab slug={slug} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
