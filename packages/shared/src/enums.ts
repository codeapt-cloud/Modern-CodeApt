/**
 * Centralized enums for the whole system.
 *
 * We use `as const` objects instead of TS `enum`s: they emit no extra runtime
 * machinery, tree-shake cleanly, expose a `*_VALUES` array for Mongoose
 * `enum:` options, and give us a same-named union type for free.
 */

// ---------------------------------------------------------------------------
// Auth / users
// ---------------------------------------------------------------------------

/**
 * Authority roles.
 *
 * The multi-tenant upgrade adds `super_admin` | `college_admin` | `faculty`
 * ALONGSIDE the original `student` | `admin`. `admin` is RETAINED (never
 * removed) so existing B2C data, flows and tests validate unchanged; it denotes
 * the legacy platform administrator and carries the SAME authority as
 * `super_admin` (the tenancy backfill maps existing `admin` → `super_admin`).
 * See docs/MULTI_TENANT_ARCHITECTURE.md for the full role × userType × tenant
 * matrix and the guard mapping.
 */
export const Role = {
  STUDENT: "student",
  /** Legacy platform admin — equivalent authority to SUPER_ADMIN (see above). */
  ADMIN: "admin",
  /** CodeApt platform owner: provisions colleges, grants entitlements. */
  SUPER_ADMIN: "super_admin",
  /** Runs a single college tenant (their own space only). */
  COLLEGE_ADMIN: "college_admin",
  /** Manages assigned org-units within a college (scope populated later). */
  FACULTY: "faculty",
} as const;
export type Role = (typeof Role)[keyof typeof Role];
export const ROLE_VALUES = Object.values(Role);

/**
 * Population type, orthogonal to authority. `individual` = the original B2C
 * learners + the platform admins (never tenant-scoped). `college` = users that
 * belong to a college tenant. Existing users default to `individual`, so the
 * B2C world is untouched.
 */
export const UserType = {
  INDIVIDUAL: "individual",
  COLLEGE: "college",
} as const;
export type UserType = (typeof UserType)[keyof typeof UserType];
export const USER_TYPE_VALUES = Object.values(UserType);

/** College (tenant) lifecycle status. */
export const CollegeStatus = {
  ACTIVE: "active",
  SUSPENDED: "suspended",
} as const;
export type CollegeStatus = (typeof CollegeStatus)[keyof typeof CollegeStatus];
export const COLLEGE_STATUS_VALUES = Object.values(CollegeStatus);

/**
 * The full enumerated set of FEATURE entitlements a super_admin can toggle
 * per college. Sub-capabilities under each feature live in the extensible
 * SUB_CAPABILITY_CATALOG (see tenancy.ts).
 */
export const CollegeFeature = {
  EXAMS: "exams",
  ESSAYS: "essays",
  CHALLENGES: "challenges",
  COURSES: "courses",
  CAREERS: "careers",
  ANALYTICS: "analytics",
  BULK_IMPORT: "bulk_import",
  FACULTY_MANAGEMENT: "faculty_management",
  POSTINGS: "postings",
  /** Access to the GLOBAL question banks (Standard + Coding). A college's OWN
   * Self Bank is always available (it's their data); this grant gates browsing
   * and pulling from the super-admin-curated global banks. */
  QUESTION_BANKS: "question_banks",
  /** Per-college AI control (the multi-provider gateway powers it platform-wide;
   * this gates WHICH colleges may consume it). Sub-capabilities: `essay_grading`
   * (AI-assisted essay scoring) and `question_generation` (AI Test Builder). */
  AI: "ai",
  /** Attendance: form attendance GROUPS (classes / events) from org-units,
   * sections, individuals, and Excel roll-number uploads, then take + report
   * attendance (sessions/records arrive in later prompts). */
  ATTENDANCE: "attendance",
} as const;
export type CollegeFeature =
  (typeof CollegeFeature)[keyof typeof CollegeFeature];
export const COLLEGE_FEATURE_VALUES = Object.values(CollegeFeature);

/**
 * College org-structure node types (Phase 2). The tree is FLEXIBLE — not every
 * college uses all four levels — so nesting is governed by a lenient rule
 * (ORG_UNIT_ALLOWED_CHILDREN / canNestUnder in tenancy.ts), not a fixed depth.
 */
export const OrgUnitType = {
  DEPARTMENT: "department",
  YEAR: "year",
  SECTION: "section",
  SEMESTER: "semester",
} as const;
export type OrgUnitType = (typeof OrgUnitType)[keyof typeof OrgUnitType];
export const ORG_UNIT_TYPE_VALUES = Object.values(OrgUnitType);

// ---------------------------------------------------------------------------
// Attendance (module core — Prompt 1)
// ---------------------------------------------------------------------------

/**
 * An attendance GROUP is either a recurring "class" or a one-off "event" (a
 * training, workshop, etc.). The distinction is purely organizational — the
 * membership + session structure is identical.
 */
export const AttendanceGroupKind = {
  CLASS: "class",
  EVENT: "event",
} as const;
export type AttendanceGroupKind =
  (typeof AttendanceGroupKind)[keyof typeof AttendanceGroupKind];
export const ATTENDANCE_GROUP_KIND_VALUES = Object.values(AttendanceGroupKind);

/**
 * How a student came to be a member of a group — kept as PROVENANCE on each
 * membership so a group is editable/re-resolvable. `org_unit` = added via a
 * dept/year unit; `section` = added via a section unit (a unit of type section);
 * `individual` = picked explicitly; `excel` = matched from a roll-number upload.
 */
export const AttendanceMemberSource = {
  ORG_UNIT: "org_unit",
  SECTION: "section",
  INDIVIDUAL: "individual",
  EXCEL: "excel",
} as const;
export type AttendanceMemberSource =
  (typeof AttendanceMemberSource)[keyof typeof AttendanceMemberSource];
export const ATTENDANCE_MEMBER_SOURCE_VALUES = Object.values(
  AttendanceMemberSource,
);

/**
 * A session's lifecycle (Prompt 2). `scheduled` = booked for a future date/time,
 * not yet taken; `open` = an ad-hoc "take now" session awaiting marks; `completed`
 * = attendance has been recorded (this is the state the % denominator counts —
 * a scheduled-but-never-taken session never counts).
 */
export const AttendanceSessionStatus = {
  SCHEDULED: "scheduled",
  OPEN: "open",
  COMPLETED: "completed",
} as const;
export type AttendanceSessionStatus =
  (typeof AttendanceSessionStatus)[keyof typeof AttendanceSessionStatus];
export const ATTENDANCE_SESSION_STATUS_VALUES = Object.values(
  AttendanceSessionStatus,
);

/** A per-student mark within a session. */
export const AttendanceRecordStatus = {
  PRESENT: "present",
  ABSENT: "absent",
} as const;
export type AttendanceRecordStatus =
  (typeof AttendanceRecordStatus)[keyof typeof AttendanceRecordStatus];
export const ATTENDANCE_RECORD_STATUS_VALUES = Object.values(
  AttendanceRecordStatus,
);

// ---------------------------------------------------------------------------
// Payments (Order.status)
// ---------------------------------------------------------------------------

export const OrderStatus = {
  PENDING: "PENDING",
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];
export const ORDER_STATUS_VALUES = Object.values(OrderStatus);

export const CouponDiscountType = {
  PERCENTAGE: "percentage",
  FIXED: "fixed",
} as const;
export type CouponDiscountType =
  (typeof CouponDiscountType)[keyof typeof CouponDiscountType];
export const COUPON_DISCOUNT_TYPE_VALUES = Object.values(CouponDiscountType);

/**
 * Payment order lifecycle. Richer than the original Django `{PENDING, SUCCESS,
 * FAILED}` (kept as {@link OrderStatus} for reference): an order starts
 * `created` (row written + gateway invoked), may sit `pending` at the gateway,
 * and transitions EXACTLY ONCE to a terminal `success`/`failed`/`expired`.
 */
export const PaymentStatus = {
  CREATED: "created",
  PENDING: "pending",
  SUCCESS: "success",
  FAILED: "failed",
  EXPIRED: "expired",
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];
export const PAYMENT_STATUS_VALUES = Object.values(PaymentStatus);

/** Pre-terminal states an order may still legally transition FROM. */
export const PAYMENT_NON_TERMINAL_STATUSES: readonly PaymentStatus[] = [
  PaymentStatus.CREATED,
  PaymentStatus.PENDING,
];

// ---------------------------------------------------------------------------
// Curriculum
// ---------------------------------------------------------------------------

export const TopicType = {
  TEXT: "text",
  VIDEO: "video",
  QUIZ: "quiz",
  EXAM: "exam",
  ESSAY: "essay",
} as const;
export type TopicType = (typeof TopicType)[keyof typeof TopicType];
export const TOPIC_TYPE_VALUES = Object.values(TopicType);

// ---------------------------------------------------------------------------
// Question types
// ---------------------------------------------------------------------------

/** Exam questions (assessments surface). */
export const ExamQuestionType = {
  MCQ_SINGLE: "MCQ_SINGLE",
  MCQ_MULTI: "MCQ_MULTI",
  CODE: "CODE",
} as const;
export type ExamQuestionType =
  (typeof ExamQuestionType)[keyof typeof ExamQuestionType];
export const EXAM_QUESTION_TYPE_VALUES = Object.values(ExamQuestionType);

// ---------------------------------------------------------------------------
// Question bank (net-new) — a global Standard/Coding bank (super-admin curated)
// + a per-college auto-populated Self Bank. A bank Question's PAYLOAD mirrors an
// ExamQuestion so pulling one into an exam is a clean field copy.
// ---------------------------------------------------------------------------

/** Difficulty label for a bank question (a filter facet). */
export const QuestionDifficulty = {
  EASY: "easy",
  MEDIUM: "medium",
  HARD: "hard",
} as const;
export type QuestionDifficulty =
  (typeof QuestionDifficulty)[keyof typeof QuestionDifficulty];
export const QUESTION_DIFFICULTY_VALUES = Object.values(QuestionDifficulty);

/** Which bank a question lives in: the shared GLOBAL bank or a COLLEGE's Self
 * Bank (tenant-scoped, auto-populated from that college's own questions). */
export const BankScope = {
  GLOBAL: "global",
  COLLEGE: "college",
} as const;
export type BankScope = (typeof BankScope)[keyof typeof BankScope];
export const BANK_SCOPE_VALUES = Object.values(BankScope);

/** High-level bank family — DERIVED from questionType (CODE → coding, MCQ_* →
 * standard). Stored for cheap filtering; never set independently of the type. */
export const BankKind = {
  STANDARD: "standard",
  CODING: "coding",
} as const;
export type BankKind = (typeof BankKind)[keyof typeof BankKind];
export const BANK_KIND_VALUES = Object.values(BankKind);

/** Daily-challenge questions. */
export const DailyQuestionType = {
  MCQ: "MCQ",
  CODE: "CODE",
} as const;
export type DailyQuestionType =
  (typeof DailyQuestionType)[keyof typeof DailyQuestionType];
export const DAILY_QUESTION_TYPE_VALUES = Object.values(DailyQuestionType);

/**
 * Provenance of a daily challenge — how it came to be published. `manual` is an
 * admin-authored challenge (the historical default); the automatic pipeline
 * marks `ai` (LLM-generated AND execution-validated), `bank_fallback` (a curated
 * global coding-bank question), or `curated_fallback` (a built-in problem — the
 * guaranteed floor when both AI and the bank are unavailable). Honest by design:
 * only an execution-validated LLM challenge is ever marked `ai`.
 */
export const DailyChallengeSource = {
  MANUAL: "manual",
  AI: "ai",
  BANK_FALLBACK: "bank_fallback",
  CURATED_FALLBACK: "curated_fallback",
} as const;
export type DailyChallengeSource =
  (typeof DailyChallengeSource)[keyof typeof DailyChallengeSource];
export const DAILY_CHALLENGE_SOURCE_VALUES =
  Object.values(DailyChallengeSource);

/**
 * Per-college AI credit tier (Stage 1). Drives the monthly allocation formula
 * base(tier) + students × per_seat (see AI_CREDIT_TIERS in credits.ts). A
 * super-admin can also set an explicit monthly override that ignores the tier.
 */
export const AiCreditTier = {
  FREE: "free",
  STANDARD: "standard",
  PREMIUM: "premium",
} as const;
export type AiCreditTier = (typeof AiCreditTier)[keyof typeof AiCreditTier];
export const AI_CREDIT_TIER_VALUES = Object.values(AiCreditTier);

// ---------------------------------------------------------------------------
// Assessments (StudentExamAttempt.status)
// ---------------------------------------------------------------------------

export const ExamAttemptStatus = {
  /** Candidate is working through sections. */
  IN_PROGRESS: "in_progress",
  /** Submitted; MCQ graded, CODE grading may still be running on the queue. */
  SUBMITTED: "submitted",
  /** Fully graded (score/passed final). */
  GRADED: "graded",
  /** Abandoned/expired without a completed submission. */
  EXPIRED: "expired",
} as const;
export type ExamAttemptStatus =
  (typeof ExamAttemptStatus)[keyof typeof ExamAttemptStatus];
export const EXAM_ATTEMPT_STATUS_VALUES = Object.values(ExamAttemptStatus);

// ---------------------------------------------------------------------------
// Essays
// ---------------------------------------------------------------------------

export const EssayStatus = {
  DRAFT: "DRAFT",
  IN_PROGRESS: "IN_PROGRESS",
  SUBMITTED: "SUBMITTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  GRADED: "GRADED",
  CANCELLED: "CANCELLED",
} as const;
export type EssayStatus = (typeof EssayStatus)[keyof typeof EssayStatus];
export const ESSAY_STATUS_VALUES = Object.values(EssayStatus);

/** Difficulty levels 1/2/3 as in the original EssayTopic. */
export const EssayDifficulty = {
  EASY: 1,
  MEDIUM: 2,
  HARD: 3,
} as const;
export type EssayDifficulty =
  (typeof EssayDifficulty)[keyof typeof EssayDifficulty];
export const ESSAY_DIFFICULTY_VALUES = Object.values(EssayDifficulty);

/**
 * How an essay's final score was produced:
 * - `ai_hybrid`: deterministic engine blended with a successful AI analysis
 *   (vocabulary & structure = 0.6 deterministic + 0.4 AI).
 * - `deterministic_fallback`: AI was disabled/failed/timed out, so the score is
 *   the deterministic engine alone. This is the guaranteed floor — grading
 *   NEVER fails just because the AI layer is unavailable.
 */
export const EssayScoreSource = {
  AI_HYBRID: "ai_hybrid",
  DETERMINISTIC_FALLBACK: "deterministic_fallback",
} as const;
export type EssayScoreSource =
  (typeof EssayScoreSource)[keyof typeof EssayScoreSource];
export const ESSAY_SCORE_SOURCE_VALUES = Object.values(EssayScoreSource);

/**
 * Essay grading lifecycle. Mirrors {@link JobStatus} value-for-value (essays
 * ride the same async-job model) but is named for the essay surface so the UI
 * and schemas can refer to it directly.
 */
export const EssayGradingStatus = {
  QUEUED: "queued",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;
export type EssayGradingStatus =
  (typeof EssayGradingStatus)[keyof typeof EssayGradingStatus];
export const ESSAY_GRADING_STATUS_VALUES = Object.values(EssayGradingStatus);

// ---------------------------------------------------------------------------
// Grading / async jobs
// ---------------------------------------------------------------------------

/** ExecutionJob.status and essay grading_status share this lifecycle. */
export const JobStatus = {
  QUEUED: "queued",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];
export const JOB_STATUS_VALUES = Object.values(JobStatus);

// ---------------------------------------------------------------------------
// Code execution
// ---------------------------------------------------------------------------

/** Languages supported by the Piston-backed executor. */
export const CodeLanguage = {
  PYTHON: "python",
  JAVASCRIPT: "javascript",
  JAVA: "java",
  CPP: "cpp",
  C: "c",
} as const;
export type CodeLanguage = (typeof CodeLanguage)[keyof typeof CodeLanguage];
export const CODE_LANGUAGE_VALUES = Object.values(CodeLanguage);

// ---------------------------------------------------------------------------
// Job applications (careers)
// ---------------------------------------------------------------------------

export const JobApplicationStatus = {
  SUBMITTED: "SUBMITTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  SHORTLISTED: "SHORTLISTED",
  REJECTED: "REJECTED",
  HIRED: "HIRED",
} as const;
export type JobApplicationStatus =
  (typeof JobApplicationStatus)[keyof typeof JobApplicationStatus];
export const JOB_APPLICATION_STATUS_VALUES =
  Object.values(JobApplicationStatus);

/**
 * Posting employment type. The original stored a free-text `employment_type`;
 * this typed set (added for a filterable, validated UI) is the minimal sensible
 * enumeration for a campus placement board.
 */
export const PostingType = {
  FULL_TIME: "full_time",
  INTERNSHIP: "internship",
  PART_TIME: "part_time",
  CONTRACT: "contract",
} as const;
export type PostingType = (typeof PostingType)[keyof typeof PostingType];
export const POSTING_TYPE_VALUES = Object.values(PostingType);
