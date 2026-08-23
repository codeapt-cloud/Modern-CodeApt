/**
 * College STUDENT dashboard (route: /c/:slug/home and the /c/:slug index for a
 * student) — the consumption home a college student lands on after login. It
 * mirrors the operator dashboard's shell/motion language (aurora hero, springy
 * count-up stat cards, tilt/spotlight tiles) but is CONSUME, not manage:
 *   1. An aurora hero with the college identity + the student's name/role.
 *   2. Live STAT CARDS — real assigned/available counts from the single
 *      /c/:slug/student/summary read (courses, exams, essays, postings). Only
 *      entitled features get a card; every number is real, graceful 0s.
 *   3. "Your sections" TILES from the shared student nav catalog (entitlement-
 *      aware: available → link, not-enabled → shown but locked). Each links to
 *      its section; the detailed views are re-homed here in part (ii).
 *
 * Nothing here manages the college — a student sees only their own surfaces, and
 * every count is tenant- + cohort-scoped server-side. No operator sections.
 */
import { CollegeFeature, checkEntitlement } from "@codeapt/shared";
import {
  ArrowRight,
  Award,
  BookOpen,
  Gamepad2,
  MessagesSquare,
  Briefcase,
  Code2,
  Building2,
  ClipboardCheck,
  GraduationCap,
  Lock,
  PenLine,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";

import { StatCard } from "../../components/colleges/StatCard.js";
import { Reveal } from "../../components/motion/Reveal.js";
import { SpotlightTilt } from "../../components/motion/SpotlightTilt.js";
import { Stagger, StaggerItem } from "../../components/motion/Stagger.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Card } from "../../components/ui/card.js";
import { api } from "../../lib/api-client.js";
import { cn } from "../../lib/cn.js";
import {
  resolveStudentSections,
  sectionHref,
  type CollegeNavIcon,
  type ResolvedSection,
} from "../../lib/college-nav.js";
import { springSoft, springUp, staggerContainerFast } from "../../lib/motion.js";
import { roleLabel } from "../../lib/role-label.js";
import { useQuery } from "../../lib/use-query.js";
import { useAuth } from "../../providers/AuthProvider.js";
import { useCollege } from "./college-context.js";

const ICON: Record<CollegeNavIcon, LucideIcon> = {
  dashboard: Sparkles,
  structure: Building2,
  faculty: GraduationCap,
  students: GraduationCap,
  import: BookOpen,
  courses: BookOpen,
  exams: ClipboardCheck,
  essays: PenLine,
  challenges: Award,
  jobs: Briefcase,
  analytics: Award,
  attendance: ClipboardCheck,
  coding: Code2,
  gaming: Gamepad2,
  communication: MessagesSquare,
  results: Award,
};

function TileBody({ section }: { section: ResolvedSection }) {
  const Icon = ICON[section.icon];
  const available = section.status === "available";
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-xl transition-colors duration-base ease-out",
            available
              ? "bg-gradient-to-br from-primary/25 to-primary/5 text-primary ring-1 ring-inset ring-primary/20 shadow-[0_0_20px_-8px_rgb(var(--color-primary-500)/0.8)] group-hover:from-primary/35 group-hover:to-primary/10"
              : "bg-surface-overlay text-ink-muted",
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        {available ? (
          <ArrowRight className="h-4 w-4 text-ink-muted transition-all duration-base ease-out group-hover:translate-x-1 group-hover:text-primary" />
        ) : (
          <Badge variant="neutral">
            <Lock className="h-3 w-3" /> Not enabled
          </Badge>
        )}
      </div>
      <div className="mt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          {section.group}
        </p>
        <p className="font-semibold text-ink">{section.label}</p>
        <p className="mt-0.5 text-sm text-ink-muted">{section.description}</p>
      </div>
    </>
  );
}

/** One "Your sections" tile — tilt + spotlight when available, calm otherwise. */
function SectionTile({
  section,
  slug,
}: {
  section: ResolvedSection;
  slug: string;
}) {
  const href = sectionHref(slug, section);
  const available = section.status === "available" && href;

  if (available) {
    return (
      <SpotlightTilt className="h-full rounded-2xl" maxDeg={6}>
        <Link
          to={href}
          className="group relative flex h-full flex-col rounded-2xl border border-subtle bg-surface-raised p-5 shadow-sm transition-[border-color,box-shadow] duration-base ease-out hover:border-primary/50 hover:shadow-[0_20px_48px_-20px_rgb(var(--color-primary-500)/0.55)] focus-visible:outline-none focus-visible:shadow-focus"
        >
          <TileBody section={section} />
        </Link>
      </SpotlightTilt>
    );
  }
  return (
    <div className="flex h-full flex-col rounded-2xl border border-dashed border-subtle bg-surface p-5 opacity-80">
      <TileBody section={section} />
    </div>
  );
}

interface StatDef {
  key: string;
  feature: CollegeFeature;
  icon: LucideIcon;
  label: string;
  value: number;
}

export function CollegeStudentDashboardPage() {
  const { slug, context } = useCollege();
  const { entitlements, college, membership } = context;
  const { profile, user } = useAuth();

  const summaryQuery = useQuery(
    () => api.collegeContext.studentSummary(slug),
    [slug],
  );
  const summary = summaryQuery.data;
  const loading = summaryQuery.loading;

  const sections = resolveStudentSections(entitlements);
  const studentName = profile?.fullName ?? user?.username ?? "there";

  // One stat card per ENTITLED feature — real counts, no fabricated numbers.
  const stats: StatDef[] = [
    {
      key: "courses",
      feature: CollegeFeature.COURSES,
      icon: BookOpen,
      label: "My courses",
      value: summary?.courses ?? 0,
    },
    {
      key: "exams",
      feature: CollegeFeature.EXAMS,
      icon: ClipboardCheck,
      label: "Available exams",
      value: summary?.exams ?? 0,
    },
    {
      key: "essays",
      feature: CollegeFeature.ESSAYS,
      icon: PenLine,
      label: "Essay prompts",
      value: summary?.essays ?? 0,
    },
    {
      key: "postings",
      feature: CollegeFeature.POSTINGS,
      icon: Briefcase,
      label: "Open placements",
      value: summary?.postings ?? 0,
    },
  ].filter((s) => checkEntitlement(entitlements, s.feature));

  return (
    <div className="space-y-8">
      {/* Aurora hero — college identity + the student's name/role. */}
      <Reveal variant="fadeInUp">
        <div className="rounded-[1.15rem] bg-gradient-to-r from-primary/40 via-info/30 to-primary/40 p-px shadow-[0_20px_60px_-24px_rgb(var(--color-primary-500)/0.6)]">
          <Card className="relative overflow-hidden rounded-[1.1rem] border-0 bg-gradient-to-br from-primary/10 via-surface-raised to-surface-raised">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden"
            >
              <span className="aurora-blob aurora-1 -left-20 -top-24 h-72 w-72 bg-primary/30" />
              <span className="aurora-blob aurora-2 -top-16 right-0 h-64 w-64 bg-info/25" />
              <span className="aurora-blob aurora-3 -bottom-28 left-1/3 h-72 w-72 bg-primary/20" />
              <span className="hero-grid absolute inset-0" />
              <span className="animate-shimmer absolute inset-0 opacity-60" />
              <span className="absolute inset-y-0 left-0 w-2/3 bg-gradient-to-r from-surface-raised/80 to-transparent" />
              <span className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
            </div>

            <div className="relative flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
              <div className="flex items-center gap-4">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/20 text-primary shadow-[0_0_28px_-6px_rgb(var(--color-primary-500)/0.8)] ring-1 ring-inset ring-primary/30">
                  <GraduationCap className="h-7 w-7" />
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                    Welcome back
                  </p>
                  <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                    {studentName}
                  </h1>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <Badge variant="primary">{roleLabel(membership.role)}</Badge>
                    <span className="text-sm text-ink-secondary">
                      {college.name}
                    </span>
                    <span className="font-mono text-xs text-ink-muted">
                      /c/{college.slug}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </Reveal>

      {/* Stat cards — one per entitled feature; count up when the summary loads. */}
      {summaryQuery.error ? (
        <Reveal variant="fadeIn">
          <Alert variant="error">{summaryQuery.error}</Alert>
        </Reveal>
      ) : stats.length === 0 ? (
        <Reveal variant="fadeIn">
          <Alert variant="info">
            Your college hasn&apos;t enabled any learning features yet. When they
            do, your courses, exams, essays and placements will appear here.
          </Alert>
        </Reveal>
      ) : (
        <Stagger
          container={staggerContainerFast}
          className="grid grid-cols-2 gap-4 lg:grid-cols-4"
        >
          {stats.map((s) => (
            <StaggerItem
              key={s.key}
              className="h-full"
              variant={springUp}
              transition={springSoft}
            >
              <StatCard
                icon={s.icon}
                label={s.label}
                value={s.value}
                loading={loading}
              />
            </StaggerItem>
          ))}
        </Stagger>
      )}

      {/* Your sections */}
      <section className="space-y-4">
        <Reveal variant="fadeInUp" className="space-y-1">
          <h2 className="text-lg font-semibold text-ink">Your sections</h2>
          <p className="text-sm text-ink-muted">
            Jump into your college learning. Sections your college hasn&apos;t
            enabled are shown so you know what may open up.
          </p>
        </Reveal>
        <Stagger
          container={staggerContainerFast}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {sections.map((section) => (
            <StaggerItem
              key={section.key}
              className="h-full"
              variant={springUp}
              transition={springSoft}
            >
              <SectionTile section={section} slug={slug} />
            </StaggerItem>
          ))}
        </Stagger>
      </section>
    </div>
  );
}
