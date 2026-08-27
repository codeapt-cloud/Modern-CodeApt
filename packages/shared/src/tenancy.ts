/**
 * Multi-tenant (college) foundation — the pure, framework-free core of the
 * entitlement + role-authority model. No mongoose, no express: the api uses
 * these for guards/services, the web will use them to gate UI, and they are
 * unit-tested in isolation.
 *
 * See docs/MULTI_TENANT_ARCHITECTURE.md for the authoritative design.
 */
import {
  CollegeFeature,
  OrgUnitType,
  Role,
  UserType,
  type OrgUnitType as OrgUnitTypeT,
  type Role as RoleType,
  type UserType as UserTypeT,
} from "./enums.js";

// ---------------------------------------------------------------------------
// Role authority sets (hierarchy). Higher tiers are supersets of lower ones so
// a super_admin can do anything a college_admin can, etc. The guards
// (requireSuperAdmin / requireCollegeAdmin / requireFaculty) are built from
// these exact sets. `admin` (legacy) sits with super_admin everywhere.
// ---------------------------------------------------------------------------

/** Platform owners — CodeApt itself. Legacy `admin` == `super_admin`. */
export const PLATFORM_ADMIN_ROLES: readonly RoleType[] = [
  Role.SUPER_ADMIN,
  Role.ADMIN,
];

/** May administer a college tenant (super_admin is a superset). */
export const COLLEGE_ADMIN_ROLES: readonly RoleType[] = [
  ...PLATFORM_ADMIN_ROLES,
  Role.COLLEGE_ADMIN,
];

/** May act as faculty within a college (college_admin/super_admin included). */
export const FACULTY_ROLES: readonly RoleType[] = [
  ...COLLEGE_ADMIN_ROLES,
  Role.FACULTY,
];

/** True for the platform-owner roles (super_admin or legacy admin). */
export function isPlatformAdmin(role: RoleType): boolean {
  return PLATFORM_ADMIN_ROLES.includes(role);
}

/**
 * True for a college OPERATOR — a college_admin or faculty whose home is the
 * college workspace (/c/:slug). Deliberately NARROWER than COLLEGE_ADMIN_ROLES:
 * it EXCLUDES platform admins (super_admin/admin), who keep the console as home,
 * and college students (role=student), who use the learner app. Drives the
 * post-login landing + the workspace/learner shell separation.
 */
export function isCollegeOperator(role: RoleType): boolean {
  return role === Role.COLLEGE_ADMIN || role === Role.FACULTY;
}

/**
 * True for a college STUDENT — role=student AND userType=college. This is the
 * ONLY way to tell a college student (who gets their own /c/:slug space) apart
 * from an individual (B2C) learner, since both share role=student. Drives the
 * student post-login landing + the student-flavored college shell. An individual
 * learner (userType=individual) is deliberately excluded.
 */
export function isCollegeStudent(
  role: RoleType,
  userType: UserTypeT,
): boolean {
  return role === Role.STUDENT && userType === UserType.COLLEGE;
}

// ---------------------------------------------------------------------------
// Sub-capability catalog. Keys are stored on the college as
// `${feature}.${subCapability}` (see subCapabilityKey); the map stays a flat,
// forward-compatible structure.
//
// THE RULE (Step 26 C8 — what belongs here and what each entry means):
//   Baseline authoring authority = the FEATURE grant + a faculty role. That is
//   the default; it needs no sub-capability. A catalog entry only ever REFINES
//   that baseline, and is exactly one of two kinds:
//     1. FEATURE TOGGLE — an optional add-on / integration within the feature,
//        off unless granted. e.g. exams.proctoring, exams.public_links,
//        analytics.export, gaming.ai_build. checkEntitlement(feature, key)
//        gates the add-on.
//     2. AUTHORING SCOPE — narrows authoring to a SUB-KIND of the feature's
//        content, so an operator can author some kinds but not others. e.g.
//        communication.speaking = "may author speaking assessments" (a college
//        may author grammar/email but not speaking). The route gates that
//        surface on the scope key.
//   A bare `authoring` key (meaning only "may author at all") is REDUNDANT with
//   the feature grant and should NOT gate baseline authoring — see the two
//   inconsistent legacy entries flagged below. Consuming a GRANTED course's
//   content never needs any of these — the grant is the authorization.
// ---------------------------------------------------------------------------

export const SUB_CAPABILITY_CATALOG: Record<
  CollegeFeature,
  readonly string[]
> = {
  [CollegeFeature.EXAMS]: ["public_links", "bulk_upload", "proctoring"],
  // AI essay grading re-homed under the unified AI feature → ai.essay_grading.
  [CollegeFeature.ESSAYS]: [],
  [CollegeFeature.CHALLENGES]: ["leaderboard"],
  [CollegeFeature.COURSES]: ["progress_tracking"],
  [CollegeFeature.CAREERS]: [],
  [CollegeFeature.ANALYTICS]: ["export"],
  [CollegeFeature.BULK_IMPORT]: [],
  [CollegeFeature.FACULTY_MANAGEMENT]: [],
  [CollegeFeature.POSTINGS]: ["external_apply"],
  [CollegeFeature.QUESTION_BANKS]: [],
  // One place for all per-college AI: assisted essay scoring + AI Test Builder.
  [CollegeFeature.AI]: ["essay_grading", "question_generation"],
  // Attendance groups + (later) sessions. No sub-capabilities in Prompt 1.
  [CollegeFeature.ATTENDANCE]: [],
  // Coding-profile tracking. Leaderboard arrives in Prompt 2; none in Prompt 1.
  [CollegeFeature.CODING_PROFILES]: [],
  // Adaptive game rounds. `ai_build` is a FEATURE TOGGLE — the AI set-builder
  // add-on, gated at the ai-build route. `authoring` is a LEGACY, UNENFORCED
  // entry: gaming's authoring routes gate on the GAMING feature + faculty (the
  // baseline), NOT on this key, so it's redundant per the rule above. Kept only
  // so removing it isn't a data migration; do not start enforcing it.
  [CollegeFeature.GAMING]: ["authoring", "ai_build"],
  // Communication. `speaking` is an AUTHORING SCOPE — "may author speaking
  // assessments" (live since Steps 10-13); the speaking author routes gate on
  // it, so a college can author grammar/email without it. `authoring` is the
  // odd one out: unlike gaming's, it IS enforced (as the composite editor's
  // gate), so it behaves as a second, coarser authoring scope — the naming
  // inconsistency C8 identified. See the rule above; a rename is a separate,
  // migration-bearing step (do not rename here).
  [CollegeFeature.COMMUNICATION]: ["authoring", "speaking"],
  // `interview` = AUTHORING SCOPE: may author mock interviews (consumption needs
  // only the INTERVIEW feature; the course-attached shape needs no flag at all).
  [CollegeFeature.INTERVIEW]: ["interview"],
};

/** Canonical flat key for a sub-capability toggle. */
export function subCapabilityKey(
  feature: CollegeFeature,
  subCapability: string,
): string {
  return `${feature}.${subCapability}`;
}

/** True when `key` (e.g. "exams.public_links") is a known catalog entry. */
export function isKnownSubCapability(key: string): boolean {
  const dot = key.indexOf(".");
  if (dot < 0) return false;
  const feature = key.slice(0, dot) as CollegeFeature;
  const sub = key.slice(dot + 1);
  return (SUB_CAPABILITY_CATALOG[feature] ?? []).includes(sub);
}

// ---------------------------------------------------------------------------
// Entitlements — the plain (framework-free) shape carried on a college and in
// the resolved tenant context. The mongoose model stores the same data (with a
// Map for subCapabilities); the tenant service normalizes it to this shape.
// ---------------------------------------------------------------------------

export interface CollegeEntitlements {
  /** One flag per FEATURE. Absent/false → the feature is OFF. */
  features: Partial<Record<CollegeFeature, boolean>>;
  /** Flat map keyed by `${feature}.${subCapability}` → enabled. */
  subCapabilities: Record<string, boolean>;
  /** Granted master-catalog course (Subject) ids, as strings. */
  grantedCourses: string[];
}

/** A college with NOTHING granted — the safe default at creation. */
export function buildDefaultEntitlements(): CollegeEntitlements {
  return { features: {}, subCapabilities: {}, grantedCourses: [] };
}

/**
 * THE entitlement check — one function used everywhere (guard + UI). Returns
 * true only if the FEATURE is enabled and, when a sub-capability is named, that
 * sub-capability is also enabled. Resource (course) grants are checked with
 * {@link isCourseGranted}.
 */
export function checkEntitlement(
  entitlements: CollegeEntitlements,
  feature: CollegeFeature,
  subCapability?: string,
): boolean {
  if (entitlements.features[feature] !== true) return false;
  if (subCapability === undefined) return true;
  return entitlements.subCapabilities[subCapabilityKey(feature, subCapability)] === true;
}

/** True when a specific master-catalog course id is granted to the college. */
export function isCourseGranted(
  entitlements: CollegeEntitlements,
  courseId: string,
): boolean {
  return entitlements.grantedCourses.includes(courseId);
}

// ---------------------------------------------------------------------------
// Org-unit nesting rule (Phase 2). Deliberately LENIENT to fit real variance:
// a root unit (parent = null) may be ANY type; when nesting under a parent, the
// child type must be an allowed descendant of the parent type. This permits the
// full department → year → section → semester chain AND common shortcuts
// (department → section, year → semester, …), while still rejecting nonsense
// (e.g. a department under a semester) and same-type nesting.
// ---------------------------------------------------------------------------

export const ORG_UNIT_ALLOWED_CHILDREN: Record<
  OrgUnitTypeT,
  readonly OrgUnitTypeT[]
> = {
  [OrgUnitType.DEPARTMENT]: [
    OrgUnitType.YEAR,
    OrgUnitType.SECTION,
    OrgUnitType.SEMESTER,
  ],
  [OrgUnitType.YEAR]: [OrgUnitType.SECTION, OrgUnitType.SEMESTER],
  [OrgUnitType.SECTION]: [OrgUnitType.SEMESTER],
  [OrgUnitType.SEMESTER]: [],
};

/**
 * May a `childType` unit nest directly under a `parentType` unit? Root-level
 * units (no parent) are validated separately (any type is allowed at root).
 */
export function canNestUnder(
  parentType: OrgUnitTypeT,
  childType: OrgUnitTypeT,
): boolean {
  return ORG_UNIT_ALLOWED_CHILDREN[parentType].includes(childType);
}
