/**
 * Pure (React/DOM-free) nav model for the college workspace shell + dashboard.
 * ONE catalog of sections drives BOTH the top-nav dropdowns and the dashboard's
 * "Admin utilities" tiles, so the two can never drift.
 *
 * Each section maps to a REAL college feature (from the shared CollegeFeature
 * catalog) and resolves to one of three states against a college's entitlements:
 *   - "available"   — reachable now (feature on, or a member-open section).
 *   - "locked"      — the page exists but the college isn't entitled ("not
 *                     enabled"): shown, not hidden, never a broken link.
 *   - "coming_soon" — the feature is in the catalog but has no UI/backend yet
 *                     (a roadmap item, e.g. Exams/Essays/Jobs/Analytics).
 * Entitlement-aware + catalog-driven: the states come from checkEntitlement over
 * the shared catalog, never a hardcoded list, so a new grant flows through here
 * automatically. Unit-tested in isolation (apps/web/tests/college-nav.test.ts).
 */
import {
  CollegeFeature,
  checkEntitlement,
  type CollegeEntitlements,
} from "@codeapt/shared";

/** Icon identity — mapped to a concrete lucide icon in the component layer so
 * this module stays framework-free (and node-testable). */
export type CollegeNavIcon =
  | "dashboard"
  | "structure"
  | "faculty"
  | "students"
  | "import"
  | "courses"
  | "exams"
  | "essays"
  | "challenges"
  | "jobs"
  | "analytics"
  | "attendance"
  | "coding"
  | "gaming"
  | "results";

export type SectionStatus = "available" | "locked" | "coming_soon";

export interface CollegeSection {
  key: string;
  label: string;
  /** One-line description for tiles / dropdown items. */
  description: string;
  /** The nav group this section belongs to. */
  group: string;
  icon: CollegeNavIcon;
  /**
   * Route suffix under `/c/:slug` (e.g. "structure"), or null when the section
   * has no page yet (a coming-soon roadmap item).
   */
  path: string | null;
  /** Optional query appended to the route (e.g. "import=1" to open the import). */
  query?: string;
  /**
   * The feature that must be entitled for this section, or null for a section
   * open to any college member (Structure, Student registry).
   */
  feature: CollegeFeature | null;
  /** True when the feature is catalogued but the UI/backend isn't built yet. */
  comingSoon: boolean;
}

export interface ResolvedSection extends CollegeSection {
  status: SectionStatus;
}

export interface CollegeNavGroup {
  name: string;
  sections: ResolvedSection[];
}

/** Fixed group order for the nav bar + dashboard tiles. */
export const COLLEGE_NAV_GROUPS = [
  "Academics",
  "People",
  "Learning",
  "Placement",
  "Insights",
] as const;

/**
 * THE section catalog. Every entry maps to a real CollegeFeature (or null for a
 * member-open section). Sections with `comingSoon` have no route yet and always
 * resolve to "coming_soon".
 */
export const COLLEGE_SECTIONS: readonly CollegeSection[] = [
  {
    key: "structure",
    label: "Academic structure",
    description: "Departments, years, sections and semesters.",
    group: "Academics",
    icon: "structure",
    path: "structure",
    feature: null,
    comingSoon: false,
  },
  {
    key: "faculty",
    label: "Faculty",
    description: "Invite faculty and set their org-unit scope.",
    group: "Academics",
    icon: "faculty",
    path: "faculty",
    feature: CollegeFeature.FACULTY_MANAGEMENT,
    comingSoon: false,
  },
  {
    key: "students",
    label: "Student registry",
    description: "Add, filter and manage your students.",
    group: "People",
    icon: "students",
    path: "students",
    feature: null,
    comingSoon: false,
  },
  {
    key: "attendance",
    label: "Attendance",
    description: "Form classes and events, then track attendance.",
    group: "People",
    icon: "attendance",
    path: "attendance",
    feature: CollegeFeature.ATTENDANCE,
    comingSoon: false,
  },
  {
    key: "attendance-analytics",
    label: "Attendance reports",
    description: "Attendance rates by group, section, and student + Excel reports.",
    group: "Insights",
    icon: "analytics",
    path: "attendance/analytics",
    feature: CollegeFeature.ATTENDANCE,
    comingSoon: false,
  },
  {
    key: "coding-leaderboard",
    label: "Coding leaderboard",
    description: "Rank students by coding stats, filter by section or group + Excel.",
    group: "Insights",
    icon: "coding",
    path: "coding-leaderboard",
    feature: CollegeFeature.CODING_PROFILES,
    comingSoon: false,
  },
  {
    key: "ai-credits",
    label: "AI credits",
    description: "Distribute the AI credit pool to specific students.",
    group: "People",
    icon: "analytics",
    path: "ai-credits",
    feature: CollegeFeature.AI,
    comingSoon: false,
  },
  {
    key: "import",
    label: "Bulk import",
    description: "Add many students from a file or a paste.",
    group: "People",
    icon: "import",
    path: "students",
    query: "import=1",
    feature: CollegeFeature.BULK_IMPORT,
    comingSoon: false,
  },
  {
    key: "courses",
    label: "Courses",
    description: "Assign granted courses to your students.",
    group: "Learning",
    icon: "courses",
    path: "courses",
    feature: CollegeFeature.COURSES,
    comingSoon: false,
  },
  {
    key: "exams",
    label: "Exams",
    description: "Author and assign exams to your cohorts.",
    group: "Learning",
    icon: "exams",
    path: "exams",
    feature: CollegeFeature.EXAMS,
    comingSoon: false,
  },
  {
    key: "gaming",
    label: "Games",
    description: "Author, clone, or AI-draft adaptive game sets for your cohorts.",
    group: "Learning",
    icon: "gaming",
    path: "gaming",
    feature: CollegeFeature.GAMING,
    comingSoon: false,
  },
  {
    key: "essays",
    label: "Essays",
    description: "Author writing prompts and review submissions.",
    group: "Learning",
    icon: "essays",
    path: "essays",
    feature: CollegeFeature.ESSAYS,
    comingSoon: false,
  },
  {
    key: "challenges",
    label: "Challenges",
    description: "Your students' daily-challenge leaderboard.",
    group: "Learning",
    icon: "challenges",
    path: "challenges",
    feature: CollegeFeature.CHALLENGES,
    comingSoon: false,
  },
  {
    key: "jobs",
    label: "Placements",
    description: "Post jobs and internships, then track applicants.",
    group: "Placement",
    icon: "jobs",
    path: "postings",
    feature: CollegeFeature.POSTINGS,
    comingSoon: false,
  },
  {
    key: "analytics",
    label: "Analytics",
    description: "Cohort performance — overview, sections, and students.",
    group: "Insights",
    icon: "analytics",
    path: "analytics",
    feature: CollegeFeature.ANALYTICS,
    comingSoon: false,
  },
];

/** Resolve one section's state against a college's entitlements. */
export function sectionStatus(
  section: CollegeSection,
  entitlements: CollegeEntitlements,
): SectionStatus {
  if (section.comingSoon) return "coming_soon";
  if (section.feature === null) return "available";
  return checkEntitlement(entitlements, section.feature)
    ? "available"
    : "locked";
}

/** All sections resolved against entitlements, in catalog order. */
export function resolveSections(
  entitlements: CollegeEntitlements,
): ResolvedSection[] {
  return COLLEGE_SECTIONS.map((s) => ({
    ...s,
    status: sectionStatus(s, entitlements),
  }));
}

/**
 * Build the grouped nav model for the top-nav dropdowns + dashboard tiles.
 * Groups appear in COLLEGE_NAV_GROUPS order; empty groups are dropped.
 */
export function buildCollegeNav(
  entitlements: CollegeEntitlements,
): CollegeNavGroup[] {
  const resolved = resolveSections(entitlements);
  return COLLEGE_NAV_GROUPS.map((name) => ({
    name,
    sections: resolved.filter((s) => s.group === name),
  })).filter((g) => g.sections.length > 0);
}

/** Build the full route for a section under a college slug (null if no page). */
export function sectionHref(
  slug: string,
  section: Pick<CollegeSection, "path" | "query">,
): string | null {
  if (!section.path) return null;
  const base = `/c/${slug}/${section.path}`;
  return section.query ? `${base}?${section.query}` : base;
}

// ---------------------------------------------------------------------------
// STUDENT nav model — the CONSUME counterpart of the operator (manage) catalog
// above. A college student never sees operator/manage sections (Structure,
// Faculty, Student registry, Bulk import, Analytics); they get their own
// assigned/available surfaces. Same CollegeSection shape + sectionStatus +
// sectionHref, so the shell renders both identically — only the catalog differs.
//
// Part (ii): each section routes to a REAL view inside the student space that
// reuses the existing taking/writing/applying/player flows via the `?c=slug`
// seam. Entitlement gating is identical to the operator nav (a feature-off
// section shows "Not enabled"); "My results" is member-open.
// ---------------------------------------------------------------------------

/** Fixed group order for the student nav bar + dashboard tiles. */
export const STUDENT_COLLEGE_NAV_GROUPS = ["Learning", "Placement"] as const;

export const STUDENT_COLLEGE_SECTIONS: readonly CollegeSection[] = [
  {
    key: "my-courses",
    label: "My courses",
    description: "The courses assigned to you by your college.",
    group: "Learning",
    icon: "courses",
    path: "courses",
    feature: CollegeFeature.COURSES,
    comingSoon: false,
  },
  {
    key: "my-exams",
    label: "My exams",
    description: "Exams available to your cohort — take and review.",
    group: "Learning",
    icon: "exams",
    path: "exams",
    feature: CollegeFeature.EXAMS,
    comingSoon: false,
  },
  {
    key: "my-essays",
    label: "My essays",
    description: "Writing prompts assigned to you.",
    group: "Learning",
    icon: "essays",
    path: "essays",
    feature: CollegeFeature.ESSAYS,
    comingSoon: false,
  },
  {
    key: "my-attendance",
    label: "My attendance",
    description: "Your attendance % and which sessions you attended.",
    group: "Learning",
    icon: "attendance",
    path: "attendance",
    feature: CollegeFeature.ATTENDANCE,
    comingSoon: false,
  },
  {
    key: "my-coding",
    label: "Coding profile",
    description: "Link your Codeforces / LeetCode / CodeChef handles.",
    group: "Learning",
    icon: "coding",
    path: "coding",
    feature: CollegeFeature.CODING_PROFILES,
    comingSoon: false,
  },
  {
    key: "my-games",
    label: "Games",
    description: "Adaptive aptitude games assigned to your cohort.",
    group: "Learning",
    icon: "gaming",
    path: "gaming",
    feature: CollegeFeature.GAMING,
    comingSoon: false,
  },
  {
    key: "my-ai-credits",
    label: "AI credits",
    description: "Your AI credit allocation this period.",
    group: "Learning",
    icon: "analytics",
    path: "ai-credits",
    feature: CollegeFeature.AI,
    comingSoon: false,
  },
  {
    key: "my-results",
    label: "My results",
    description: "Your scores and submission history.",
    group: "Learning",
    icon: "results",
    path: "results",
    feature: null,
    comingSoon: false,
  },
  {
    key: "placements",
    label: "Placements",
    description: "Open jobs and internships you can apply to.",
    group: "Placement",
    icon: "jobs",
    path: "placements",
    feature: CollegeFeature.POSTINGS,
    comingSoon: false,
  },
];

/** All student sections resolved against entitlements, in catalog order. */
export function resolveStudentSections(
  entitlements: CollegeEntitlements,
): ResolvedSection[] {
  return STUDENT_COLLEGE_SECTIONS.map((s) => ({
    ...s,
    status: sectionStatus(s, entitlements),
  }));
}

/** Build the grouped STUDENT nav model (dropdowns + dashboard tiles). */
export function buildStudentCollegeNav(
  entitlements: CollegeEntitlements,
): CollegeNavGroup[] {
  const resolved = resolveStudentSections(entitlements);
  return STUDENT_COLLEGE_NAV_GROUPS.map((name) => ({
    name,
    sections: resolved.filter((s) => s.group === name),
  })).filter((g) => g.sections.length > 0);
}
