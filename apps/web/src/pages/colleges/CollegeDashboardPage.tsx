/**
 * College workspace dashboard (route: /c/:slug and /c/:slug/dashboard) — the
 * landing an operator (college_admin / faculty) sees first. Three honest layers:
 *   1. A living AURORA hero band with the college identity + the operator's role.
 *   2. Live STAT CARDS from the single /c/:slug/summary read (students, faculty,
 *      org-units, course assignments, enabled features). Real numbers, graceful 0s.
 *   3. "Admin utilities" TILES + honest panels. Tiles are the SAME entitlement-
 *      aware catalog as the top-nav (available → link, not-entitled → "Not
 *      enabled", roadmap → "Coming soon"), and the recent-students panel shows
 *      real data or a clean empty state — nothing is fabricated.
 *
 * Motion is presentation-only and reuses/extends the app's system (Reveal /
 * Stagger / SpotlightTilt / useCountUp in components/motion + lib/motion, plus
 * CSS aurora/shimmer utilities): a springy staggered entrance, dramatic count-up
 * stats, a drifting aurora hero, and tilt + pointer-spotlight hover on tiles.
 * Every effect collapses to a clean static result under prefers-reduced-motion
 * (and tilt/spotlight also no-op on touch) — the data, links, and available /
 * locked / coming-soon states are identical either way.
 */
import { CollegeFeature, checkEntitlement } from "@codeapt/shared";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Gamepad2,
  MessagesSquare,
  Briefcase,
  CalendarCheck,
  Code2,
  Building2,
  ClipboardCheck,
  FolderTree,
  GraduationCap,
  Lock,
  PenLine,
  Plus,
  Sparkles,
  Trophy,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";

import { StatCard } from "../../components/colleges/StatCard.js";
import { Reveal } from "../../components/motion/Reveal.js";
import { SpotlightTilt } from "../../components/motion/SpotlightTilt.js";
import { Stagger, StaggerItem } from "../../components/motion/Stagger.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { api } from "../../lib/api-client.js";
import { cn } from "../../lib/cn.js";
import {
  resolveSections,
  sectionHref,
  type CollegeNavIcon,
  type ResolvedSection,
} from "../../lib/college-nav.js";
import {
  TOTAL_FEATURE_COUNT,
  buildEntitlementTree,
  enabledFeatureCount,
} from "../../lib/entitlements-ui.js";
import {
  springSoft,
  springUp,
  staggerContainerFast,
} from "../../lib/motion.js";
import { roleLabel } from "../../lib/role-label.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

const ICON: Record<CollegeNavIcon, LucideIcon> = {
  dashboard: Sparkles,
  structure: FolderTree,
  faculty: Users,
  students: GraduationCap,
  import: Upload,
  courses: BookOpen,
  exams: ClipboardCheck,
  essays: PenLine,
  challenges: Trophy,
  jobs: Briefcase,
  analytics: BarChart3,
  attendance: CalendarCheck,
  coding: Code2,
  gaming: Gamepad2,
  communication: MessagesSquare,
  results: BarChart3,
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
        {section.status === "coming_soon" ? (
          <Badge variant="info" className="animate-soft-pulse">
            Coming soon
          </Badge>
        ) : section.status === "locked" ? (
          <Badge variant="neutral">
            <Lock className="h-3 w-3" /> Not enabled
          </Badge>
        ) : (
          <ArrowRight className="h-4 w-4 text-ink-muted transition-all duration-base ease-out group-hover:translate-x-1 group-hover:text-primary" />
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

/** One "Admin utilities" tile — tilt + spotlight when available, calm otherwise. */
function UtilityTile({ section, slug }: { section: ResolvedSection; slug: string }) {
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
  // Locked / coming-soon: calm, non-interactive (no tilt/spotlight).
  return (
    <div className="flex h-full flex-col rounded-2xl border border-dashed border-subtle bg-surface p-5 opacity-80">
      <TileBody section={section} />
    </div>
  );
}

export function CollegeDashboardPage() {
  const { slug, context } = useCollege();
  const { entitlements, college, membership } = context;

  const summaryQuery = useQuery(() => api.collegeContext.summary(slug), [slug]);
  const summary = summaryQuery.data;
  const counts = summary?.counts;

  // AI credits readout (view-only) — only meaningful when the AI feature is on.
  const aiOn = checkEntitlement(entitlements, CollegeFeature.AI);
  const creditsQuery = useQuery(
    () => (aiOn ? api.collegeContext.aiCredits(slug) : Promise.resolve(null)),
    [slug, aiOn],
  );
  const credits = creditsQuery.data;

  const sections = resolveSections(entitlements);
  const enabled = enabledFeatureCount(entitlements);
  const enabledFeatures = buildEntitlementTree(entitlements).filter(
    (f) => f.enabled,
  );

  const coursesOn = checkEntitlement(entitlements, CollegeFeature.COURSES);

  const recent = summary?.recentStudents ?? [];
  const loading = summaryQuery.loading;

  return (
    <div className="space-y-8">
      {/* Aurora hero — drifting colour blobs + grid + shimmer, in a gradient
          border. Text sits on a scrim so it stays crisp over the motion. */}
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
              {/* Left scrim keeps the heading legible over the aurora. */}
              <span className="absolute inset-y-0 left-0 w-2/3 bg-gradient-to-r from-surface-raised/80 to-transparent" />
              <span className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
            </div>

            <div className="relative flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
              <div className="flex items-center gap-4">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/20 text-primary shadow-[0_0_28px_-6px_rgb(var(--color-primary-500)/0.8)] ring-1 ring-inset ring-primary/30">
                  <Building2 className="h-7 w-7" />
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                    College workspace
                  </p>
                  <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                    {college.name}
                  </h1>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <Badge variant="primary">{roleLabel(membership.role)}</Badge>
                    {college.status === "suspended" ? (
                      <Badge variant="warning">Suspended</Badge>
                    ) : (
                      <Badge variant="success">Active</Badge>
                    )}
                    <span className="font-mono text-xs text-ink-muted">
                      /c/{college.slug}
                    </span>
                  </div>
                </div>
              </div>
              <Button
                asChild
                variant="secondary"
                className="relative overflow-hidden"
              >
                <Link to={`/c/${slug}/students?import=1`}>
                  <Upload className="h-4 w-4" /> Import students
                  <span
                    aria-hidden
                    className="animate-shimmer pointer-events-none absolute inset-0"
                  />
                </Link>
              </Button>
            </div>
          </Card>
        </div>
      </Reveal>

      {/* Stat cards — springy cascade; numbers count up when the summary loads. */}
      {summaryQuery.error ? (
        <Reveal variant="fadeIn">
          <Alert variant="error">{summaryQuery.error}</Alert>
        </Reveal>
      ) : (
        <Stagger
          container={staggerContainerFast}
          className="grid grid-cols-2 gap-4 lg:grid-cols-5"
        >
          <StaggerItem
            className="h-full"
            variant={springUp}
            transition={springSoft}
          >
            <StatCard
              icon={GraduationCap}
              label="Students"
              value={counts?.students ?? 0}
              loading={loading}
            />
          </StaggerItem>
          <StaggerItem
            className="h-full"
            variant={springUp}
            transition={springSoft}
          >
            <StatCard
              icon={Users}
              label="Faculty"
              value={counts?.faculty ?? 0}
              loading={loading}
            />
          </StaggerItem>
          <StaggerItem
            className="h-full"
            variant={springUp}
            transition={springSoft}
          >
            <StatCard
              icon={FolderTree}
              label="Org units"
              value={counts?.orgUnits ?? 0}
              loading={loading}
            />
          </StaggerItem>
          <StaggerItem
            className="h-full"
            variant={springUp}
            transition={springSoft}
          >
            <StatCard
              icon={BookOpen}
              label="Courses assigned"
              value={counts?.courseAssignments ?? 0}
              hint={
                coursesOn
                  ? `${counts?.grantedCourses ?? 0} granted`
                  : "Courses not enabled"
              }
              loading={loading}
            />
          </StaggerItem>
          <StaggerItem
            className="h-full"
            variant={springUp}
            transition={springSoft}
          >
            <StatCard
              icon={Sparkles}
              label="Features enabled"
              value={enabled}
              suffix={`/ ${TOTAL_FEATURE_COUNT}`}
            />
          </StaggerItem>
        </Stagger>
      )}

      {/* AI credits (Stage 1) — read-only budget readout for operators. */}
      {aiOn && credits ? (
        <Reveal variant="fadeInUp">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h2 className="font-semibold text-ink">AI credits</h2>
                <span className="text-xs text-ink-muted">
                  · this month ({credits.periodKey})
                </span>
              </div>
              {credits.remaining === 0 ? (
                <span className="rounded-full bg-error/10 px-2.5 py-0.5 text-xs font-medium text-error-fg">
                  Used up — contact your administrator
                </span>
              ) : null}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-subtle bg-surface-base px-3 py-2">
                <div className="text-xs text-ink-muted">Remaining</div>
                <div className="font-mono text-lg font-semibold text-ink">
                  {credits.remaining}
                </div>
              </div>
              <div className="rounded-xl border border-subtle bg-surface-base px-3 py-2">
                <div className="text-xs text-ink-muted">Allocated</div>
                <div className="font-mono text-lg font-semibold text-ink">
                  {credits.allocated}
                </div>
              </div>
              <div className="rounded-xl border border-subtle bg-surface-base px-3 py-2">
                <div className="text-xs text-ink-muted">Used</div>
                <div className="font-mono text-lg font-semibold text-ink">
                  {credits.consumed}
                </div>
              </div>
            </div>
            {Object.keys(credits.byFeature).length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(credits.byFeature).map(([feature, n]) => (
                  <span
                    key={feature}
                    className="rounded-full border border-subtle px-2.5 py-1 text-xs text-ink-secondary"
                  >
                    {feature}: <span className="font-mono">{n}</span>
                  </span>
                ))}
              </div>
            ) : null}
          </Card>
        </Reveal>
      ) : null}

      {/* Admin utilities */}
      <section className="space-y-4">
        <Reveal variant="fadeInUp" className="space-y-1">
          <h2 className="text-lg font-semibold text-ink">Admin utilities</h2>
          <p className="text-sm text-ink-muted">
            Jump into a section. Locked and upcoming tools are shown so you know
            what your college can turn on next.
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
              <UtilityTile section={section} slug={slug} />
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      {/* Honest panels: real data only */}
      <Stagger className="grid gap-6 lg:grid-cols-3">
        <StaggerItem className="lg:col-span-2" variant={springUp} transition={springSoft}>
          <Card className="h-full p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-ink">
                  Recently added students
                </h2>
                <p className="text-sm text-ink-muted">
                  The latest students in your scope.
                </p>
              </div>
              <Button asChild size="sm" variant="ghost">
                <Link to={`/c/${slug}/students`}>
                  View all <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full rounded-xl" />
                <Skeleton className="h-12 w-full rounded-xl" />
                <Skeleton className="h-12 w-full rounded-xl" />
              </div>
            ) : recent.length === 0 ? (
              <EmptyState
                title="No students yet"
                description="Add your first student or import a batch to get started."
                icon={<GraduationCap />}
                action={
                  <Button asChild size="sm">
                    <Link to={`/c/${slug}/students`}>
                      <Plus className="h-4 w-4" /> Add student
                    </Link>
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-subtle">
                {recent.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-surface-overlay"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">
                        {s.fullName}
                      </p>
                      <p className="truncate text-xs text-ink-muted">
                        {s.email}
                      </p>
                    </div>
                    <span className="font-mono text-xs text-ink-secondary">
                      {s.rollNumber}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </StaggerItem>

        <StaggerItem variant={springUp} transition={springSoft}>
          <Card className="h-full p-6">
            <h2 className="text-lg font-semibold text-ink">Feature access</h2>
            <p className="text-sm text-ink-muted">
              Enabled by your CodeApt administrator.
            </p>
            <div className="mt-4">
              {enabledFeatures.length === 0 ? (
                <p className="text-sm text-ink-muted">
                  No features enabled yet. Structure and student management are
                  always available.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {enabledFeatures.map((f) => (
                    <Badge key={f.key} variant="primary">
                      {f.label}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </StaggerItem>
      </Stagger>
    </div>
  );
}
