import type { EnrollmentListItem } from "@codeapt/shared";
import {
  BookOpen,
  Briefcase,
  ChevronRight,
  ClipboardCheck,
  Flame,
  PenLine,
} from "lucide-react";
import { Link } from "react-router-dom";

import { CourseThumb } from "../components/course/CourseThumb.js";
import { PageHeader } from "../components/layout/PageHeader.js";
import { Stagger, StaggerItem } from "../components/motion/index.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card } from "../components/ui/card.js";
import { EmptyState } from "../components/ui/empty-state.js";
import { Progress } from "../components/ui/progress.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { api } from "../lib/api-client.js";
import { useQuery } from "../lib/use-query.js";
import { useAuth } from "../providers/AuthProvider.js";

function DailyChallengeCard() {
  const { data, loading } = useQuery(() => api.challenges.today(), []);

  if (loading) return <Skeleton className="h-28 w-full rounded-2xl" />;
  if (!data) return null;

  const status = !data.available
    ? "No challenge today"
    : data.streak.solvedToday
      ? "Solved today — nice!"
      : data.streak.attemptedToday
        ? "Attempted — back tomorrow"
        : "New problem waiting";
  const cta =
    data.available && !data.streak.attemptedToday
      ? "Solve now"
      : "View challenge";

  return (
    <StaggerItem>
      <Link
        to="/challenge"
        className="group block rounded-2xl focus-visible:outline-none focus-visible:shadow-focus"
      >
        <Card className="flex items-center justify-between gap-4 p-5 transition-all duration-base group-hover:-translate-y-0.5 group-hover:shadow-glow">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Flame className="h-7 w-7" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-primary">
                Daily challenge
              </p>
              <p className="font-semibold text-ink">{status}</p>
              <p className="mt-0.5 text-sm text-ink-muted">
                <span className="font-mono text-ink">
                  {data.streak.currentStreak}
                </span>{" "}
                day streak ·{" "}
                <span className="font-mono text-ink">
                  {data.streak.totalScore}
                </span>{" "}
                pts
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
            {cta} <ChevronRight className="h-4 w-4" />
          </span>
        </Card>
      </Link>
    </StaggerItem>
  );
}

function ExamsCard() {
  const { data, loading } = useQuery(() => api.exams.list(), []);
  if (loading) return <Skeleton className="h-28 w-full rounded-2xl" />;
  const items = data?.items ?? [];
  if (items.length === 0) return null;

  const graded = items.filter((e) => e.lastAttempt?.status === "graded");
  const best = graded.reduce<number | null>(
    (m, e) => (e.lastAttempt ? Math.max(m ?? 0, e.lastAttempt.score) : m),
    null,
  );

  return (
    <StaggerItem>
      <Link
        to="/exams"
        className="group block rounded-2xl focus-visible:outline-none focus-visible:shadow-focus"
      >
        <Card className="flex items-center justify-between gap-4 p-5 transition-all duration-base group-hover:-translate-y-0.5 group-hover:shadow-glow">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <ClipboardCheck className="h-7 w-7" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-primary">
                Mock exams
              </p>
              <p className="font-semibold text-ink">
                {items.length} exam{items.length === 1 ? "" : "s"} available
              </p>
              <p className="mt-0.5 text-sm text-ink-muted">
                {best !== null
                  ? `Last best score: ${best}`
                  : "Timed, sectioned practice"}
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
            View exams <ChevronRight className="h-4 w-4" />
          </span>
        </Card>
      </Link>
    </StaggerItem>
  );
}

function EssaysCard() {
  const { data, loading } = useQuery(() => api.essays.list(), []);
  if (loading) return <Skeleton className="h-28 w-full rounded-2xl" />;
  const items = data?.items ?? [];
  if (items.length === 0) return null;

  const graded = items.filter((e) => e.lastAttempt?.status === "completed");
  const best = graded.reduce<number | null>(
    (m, e) =>
      e.lastAttempt?.finalScore != null
        ? Math.max(m ?? 0, e.lastAttempt.finalScore)
        : m,
    null,
  );

  return (
    <StaggerItem>
      <Link
        to="/essays"
        className="group block rounded-2xl focus-visible:outline-none focus-visible:shadow-focus"
      >
        <Card className="flex items-center justify-between gap-4 p-5 transition-all duration-base group-hover:-translate-y-0.5 group-hover:shadow-glow">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <PenLine className="h-7 w-7" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-primary">
                Essays
              </p>
              <p className="font-semibold text-ink">
                {items.length} prompt{items.length === 1 ? "" : "s"} to write
              </p>
              <p className="mt-0.5 text-sm text-ink-muted">
                {best !== null
                  ? `Last best score: ${best.toFixed(1)}/100`
                  : "AI-reviewed writing practice"}
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
            Write now <ChevronRight className="h-4 w-4" />
          </span>
        </Card>
      </Link>
    </StaggerItem>
  );
}

function CareersCard() {
  const { data, loading } = useQuery(
    () => api.careers.list({ pageSize: 1 }),
    [],
  );
  if (loading) return <Skeleton className="h-28 w-full rounded-2xl" />;
  const total = data?.total ?? 0;
  if (total === 0) return null;

  return (
    <StaggerItem>
      <Link
        to="/careers"
        className="group block rounded-2xl focus-visible:outline-none focus-visible:shadow-focus"
      >
        <Card className="flex items-center justify-between gap-4 p-5 transition-all duration-base group-hover:-translate-y-0.5 group-hover:shadow-glow">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Briefcase className="h-7 w-7" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-primary">
                Careers
              </p>
              <p className="font-semibold text-ink">
                {total} open{total === 1 ? "ing" : "ings"}
              </p>
              <p className="mt-0.5 text-sm text-ink-muted">
                Jobs, internships & placement drives
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
            Browse <ChevronRight className="h-4 w-4" />
          </span>
        </Card>
      </Link>
    </StaggerItem>
  );
}

function EnrollmentCard({ item }: { item: EnrollmentListItem }) {
  return (
    <Link
      to={`/learn/${item.subject.slug}`}
      className="group block h-full rounded-2xl focus-visible:outline-none focus-visible:shadow-focus"
    >
      <Card className="flex h-full flex-col overflow-hidden transition-all duration-base group-hover:-translate-y-0.5 group-hover:shadow-glow">
        <CourseThumb name={item.subject.name} image={item.subject.image} className="h-24 w-full" />
        <div className="flex flex-1 flex-col gap-3 p-5">
          {item.subject.program ? (
            <span className="text-xs font-medium uppercase tracking-wide text-primary">
              {item.subject.program.name}
            </span>
          ) : null}
          <h3 className="font-semibold text-ink">{item.subject.name}</h3>
          <div className="mt-auto space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-ink-muted">
                {item.progress.completedTopics}/{item.progress.totalTopics}{" "}
                topics
              </span>
              <span className="font-mono text-ink">
                {item.progress.percentage}%
              </span>
            </div>
            <Progress value={item.progress.percentage} />
          </div>
        </div>
      </Card>
    </Link>
  );
}

export function DashboardPage() {
  const { user, profile } = useAuth();
  const name = profile?.fullName ?? user?.username ?? "there";
  const { data, loading } = useQuery(() => api.me.enrollments(), []);

  const items = data?.items ?? [];

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Welcome, ${name}`}
        description="Pick up where you left off, or explore new courses."
        actions={<Badge variant="primary">Student</Badge>}
      />

      <Stagger className="grid gap-4 lg:grid-cols-2">
        <DailyChallengeCard />
        <ExamsCard />
        <EssaysCard />
        <CareersCard />
      </Stagger>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
            <span className="font-mono text-primary" aria-hidden="true">
              {"{"}
            </span>
            Continue learning
            <span className="font-mono text-primary" aria-hidden="true">
              {"}"}
            </span>
          </h2>
          <Button asChild variant="ghost" size="sm">
            <Link to="/courses">
              <BookOpen className="h-4 w-4" /> Browse courses
            </Link>
          </Button>
        </div>

        {loading ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="overflow-hidden">
                <Skeleton className="h-24 w-full rounded-none" />
                <div className="space-y-3 p-5">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-2 w-full" />
                </div>
              </Card>
            ))}
          </div>
        ) : items.length > 0 ? (
          <Stagger className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <StaggerItem key={item.subject.id} className="h-full">
                <EnrollmentCard item={item} />
              </StaggerItem>
            ))}
          </Stagger>
        ) : (
          <EmptyState
            title="No courses yet"
            description="Enrol in a course to start learning. Your progress will show up here."
            icon={<BookOpen />}
            action={
              <Button asChild size="sm">
                <Link to="/courses">Browse courses</Link>
              </Button>
            }
          />
        )}
      </section>
    </div>
  );
}
