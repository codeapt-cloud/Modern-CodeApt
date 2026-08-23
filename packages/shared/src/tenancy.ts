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
// Sub-capability catalog — extensible per-feature toggles. Keys are stored on
// the college as `${feature}.${subCapability}` (see subCapabilityKey). Add new
// keys here; the map on the college stays a flat, forward-compatible structure.
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
  // Adaptive game rounds. `authoring` = a college creating/cloning its OWN game
  // sets (consuming a GRANTED course's games needs no feature — the grant is the
  // authorization). `ai_build` is a Step-8 placeholder listed now so the
  // super-admin console can expose it without a later schema change.
  [CollegeFeature.GAMING]: ["authoring", "ai_build"],
  // Communication (non-speech Phase 3). `authoring` = a college creating its
  // own communication content (email scenarios / grammar & comprehension
  // papers); consuming a GRANTED course's communication content needs no
  // feature — the grant is the authorization, exactly as gaming. `speaking` is
  // a placeholder for the later speech phase (Sections A/B) so the console can
  // expose it without a schema change then.
  [CollegeFeature.COMMUNICATION]: ["authoring", "speaking"],
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
