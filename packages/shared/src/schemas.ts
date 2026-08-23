/**
 * Zod schemas for payloads shared across the API boundary.
 *
 * These are the single source of truth for request/response shapes: the API
 * validates against them, the worker consumes the job payloads, and the web
 * client infers its types from them. No feature/business logic here — only
 * the shapes the walking skeleton needs plus the ones every later step reuses.
 */
import { z } from "zod";

import { MAX_AI_EXAM_SECTIONS, MAX_AI_GENERATED_QUESTIONS } from "./ai-questions.js";
import {
  AI_PROVIDER_STATUS_VALUES,
  PROVIDER_CAPABILITY_VALUES,
  PROVIDER_KIND_VALUES,
  type AiProviderStatus,
  type ProviderCapability,
  type ProviderKind,
} from "./llm-gateway/types.js";
import {
  CODE_LANGUAGE_VALUES,
  CodeLanguage,
  COLLEGE_FEATURE_VALUES,
  COLLEGE_STATUS_VALUES,
  COUPON_DISCOUNT_TYPE_VALUES,
  CouponDiscountType,
  AI_CREDIT_TIER_VALUES,
  type AiCreditTier,
  ATTENDANCE_GROUP_KIND_VALUES,
  AttendanceGroupKind,
  ATTENDANCE_MEMBER_SOURCE_VALUES,
  type AttendanceMemberSource,
  ATTENDANCE_SESSION_STATUS_VALUES,
  type AttendanceSessionStatus,
  ATTENDANCE_RECORD_STATUS_VALUES,
  type AttendanceRecordStatus,
  CODING_PLATFORM_VALUES,
  type CodingPlatform,
  CODING_FETCH_STATUS_VALUES,
  type CodingFetchStatus,
  CODING_METRIC_VALUES,
  type CodingMetric,
  DAILY_CHALLENGE_SOURCE_VALUES,
  DailyChallengeSource,
  DAILY_QUESTION_TYPE_VALUES,
  DailyQuestionType,
  ORG_UNIT_TYPE_VALUES,
  USER_TYPE_VALUES,
  BANK_KIND_VALUES,
  BANK_SCOPE_VALUES,
  QUESTION_DIFFICULTY_VALUES,
  GAME_KEY_VALUES,
  GAME_DIFFICULTY_VALUES,
  GAME_OUTCOME_VALUES,
  GAME_SELECTION_MODE_VALUES,
  GAME_SET_ATTEMPT_STATUS_VALUES,
  type GameKey,
  type GameDifficulty,
  type GameOutcome,
  type GameSelectionMode,
  type GameSetAttemptStatus,
  ESSAY_GRADING_STATUS_VALUES,
  ESSAY_PROMPT_KIND_VALUES,
  ESSAY_SCORE_SOURCE_VALUES,
  ESSAY_STATUS_VALUES,
  EXAM_ATTEMPT_STATUS_VALUES,
  EXAM_QUESTION_TYPE_VALUES,
  JOB_APPLICATION_STATUS_VALUES,
  JOB_STATUS_VALUES,
  PAYMENT_STATUS_VALUES,
  POSTING_TYPE_VALUES,
  ROLE_VALUES,
  SPEAKING_ATTEMPT_STATUS_VALUES,
  SPEAKING_ITEM_TYPE_VALUES,
  SPEECH_JOB_STATUS_VALUES,
  TOPIC_TYPE_VALUES,
  TopicType,
  type CouponDiscountType as CouponDiscountTypeT,
  type EssayGradingStatus,
  type EssayPromptKind,
  type EssayScoreSource,
  type EssayStatus,
  type ExamAttemptStatus,
  type ExamQuestionType,
  type JobApplicationStatus,
  type JobStatus,
  type PaymentStatus,
  type PostingType,
  type Role,
  type SpeakingAttemptStatus,
  type SpeakingItemType,
  type SpeechJobStatus,
  type CollegeFeature,
  type CollegeStatus,
  type OrgUnitType,
  type UserType,
  type BankKind,
  type BankScope,
  type QuestionDifficulty,
} from "./enums.js";
import {
  ADMIN_ORDERS_DEFAULT_PAGE_SIZE,
  ADMIN_ORDERS_MAX_PAGE_SIZE,
  CAREERS_DEFAULT_PAGE_SIZE,
  CAREERS_MAX_PAGE_SIZE,
  COUPON_REJECT_REASON_VALUES,
  EnrollResult,
  GAME_DEFAULT_CLOCK_SECONDS,
  ESSAY_MAX_CONTENT_CHARS,
  ESSAY_SCORE_WEIGHTS,
  EMAIL_SCORE_WEIGHTS,
  EXECUTION_PURPOSE_VALUES,
  LEADERBOARD_DEFAULT_PAGE_SIZE,
  LEADERBOARD_MAX_PAGE_SIZE,
  MAX_SOURCE_BYTES,
  MAX_STDIN_BYTES,
  MAX_TEST_CASES,
  QUEUE_NAME_VALUES,
  type CouponRejectReason,
  type EssayScoreDimension,
  type EmailScoreDimension,
  type ExecutionPurpose,
  type QueueName,
} from "./constants.js";
import { ESSAY_RISK_LEVELS, type EssayRiskLevel } from "./essay-risk.js";

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  uptime: z.number().nonnegative(),
  timestamp: z.string().datetime(),
  services: z.object({
    database: z.enum(["connected", "disconnected", "connecting", "unknown"]),
  }),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

// ---------------------------------------------------------------------------
// Auth — requests
// ---------------------------------------------------------------------------

export const roleSchema = z.enum(ROLE_VALUES as [Role, ...Role[]]);

/** Username: 3–30 chars, letters/digits/`_ . -`. */
export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters")
  .max(30, "Username must be at most 30 characters")
  .regex(
    /^[a-zA-Z0-9_.-]+$/,
    "Username may only contain letters, digits, and _ . -",
  );

/**
 * Password strength: 8–128 chars with at least one lowercase, one uppercase,
 * and one digit. Reused by register and change-password.
 */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters")
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[0-9]/, "Password must contain a digit");

export const registerSchema = z.object({
  username: usernameSchema,
  email: z.string().email().toLowerCase(),
  password: passwordSchema,
  fullName: z.string().trim().min(1).max(150),
  rollNumber: z.string().trim().min(1).max(50),
  collegeName: z.string().trim().min(1).max(200),
  phoneNumber: z.string().trim().min(7).max(20),
  state: z.string().trim().min(1).max(100),
});
export type RegisterInput = z.infer<typeof registerSchema>;

/** Login accepts a username OR an email in a single `identifier` field. */
export const loginSchema = z.object({
  identifier: z.string().trim().min(1, "Username or email is required"),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Optional body for refresh/logout when a client sends the token explicitly
 * (browsers use the httpOnly cookie instead). */
export const refreshSchema = z.object({
  refreshToken: z.string().optional(),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

/**
 * PATCH /api/me — mirrors the original UserUpdateForm (email) +
 * ProfileUpdateForm split. All fields optional; rollNumber is immutable.
 */
export const updateMeSchema = z
  .object({
    email: z.string().email().toLowerCase().optional(),
    fullName: z.string().trim().min(1).max(150).optional(),
    collegeName: z.string().trim().min(1).max(200).optional(),
    phoneNumber: z.string().trim().min(7).max(20).optional(),
    state: z.string().trim().min(1).max(100).optional(),
    bio: z.string().trim().max(500).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

// ---------------------------------------------------------------------------
// Auth — responses (the typed contract the UI consumes)
// ---------------------------------------------------------------------------

export const publicUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  email: z.string().email(),
  role: roleSchema,
  /**
   * `college` for a tenant member (college_admin / faculty / college student),
   * `individual` for a B2C learner. Lets the web branch a college student (who
   * gets their /c/:slug space) from an individual learner without an extra call.
   */
  userType: z.enum(USER_TYPE_VALUES as [UserType, ...UserType[]]),
  forcePasswordChange: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

export const publicProfileSchema = z.object({
  fullName: z.string(),
  collegeName: z.string(),
  rollNumber: z.string(),
  phoneNumber: z.string(),
  state: z.string(),
  bio: z.string(),
  avatarUrl: z.string(),
});
export type PublicProfile = z.infer<typeof publicProfileSchema>;

/** GET /api/me and PATCH /api/me response body. */
export const meResponseSchema = z.object({
  user: publicUserSchema,
  profile: publicProfileSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/**
 * Response for login / refresh / change-password. Tokens are ALSO set as
 * httpOnly cookies; they are echoed in the body so non-browser API clients can
 * use `Authorization: Bearer` and drive refresh themselves.
 * Read `user.forcePasswordChange` to decide whether to route to change-password.
 */
export const authResponseSchema = z.object({
  user: publicUserSchema,
  profile: publicProfileSchema,
  accessToken: z.string(),
  refreshToken: z.string(),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

/** POST /api/auth/register response — no tokens (client then logs in). */
export const registerResponseSchema = meResponseSchema;
export type RegisterResponse = z.infer<typeof registerResponseSchema>;

// ---------------------------------------------------------------------------
// Async execution / grading jobs (api -> worker payloads)
// ---------------------------------------------------------------------------

export const queueNameSchema = z.enum(
  QUEUE_NAME_VALUES as [QueueName, ...QueueName[]],
);
export const jobStatusSchema = z.enum(
  JOB_STATUS_VALUES as [JobStatus, ...JobStatus[]],
);
export const codeLanguageSchema = z.enum(
  CODE_LANGUAGE_VALUES as [CodeLanguage, ...CodeLanguage[]],
);
export const executionPurposeSchema = z.enum(
  EXECUTION_PURPOSE_VALUES as [ExecutionPurpose, ...ExecutionPurpose[]],
);

/** One graded test case (input piped to stdin; output compared to expected). */
export const testCaseSchema = z.object({
  input: z.string(),
  expectedOutput: z.string(),
});
export type TestCase = z.infer<typeof testCaseSchema>;

// TextEncoder is a standard global in both browsers and Node 18+.
const byteLen = (s: string): number => new TextEncoder().encode(s).length;

/**
 * Client → API request for `POST /api/execute`. The API generates the jobId and
 * decides the queue; the client never sets those. Size caps guard the worker
 * and Piston from oversized inputs.
 */
export const executeRequestSchema = z.object({
  language: codeLanguageSchema,
  source: z
    .string()
    .min(1, "Source cannot be empty")
    .refine((s) => byteLen(s) <= MAX_SOURCE_BYTES, {
      message: `Source exceeds ${Math.floor(MAX_SOURCE_BYTES / 1024)} KB limit`,
    }),
  stdin: z
    .string()
    .refine((s) => byteLen(s) <= MAX_STDIN_BYTES, {
      message: `stdin exceeds ${Math.floor(MAX_STDIN_BYTES / 1024)} KB limit`,
    })
    .optional(),
  /** Optional test cases for a graded run; absent for a plain playground run. */
  testCases: z.array(testCaseSchema).max(MAX_TEST_CASES).optional(),
  /** Which queue to route to; defaults to the playground queue. */
  purpose: executionPurposeSchema.default("playground"),
});
export type ExecuteRequest = z.infer<typeof executeRequestSchema>;

/** Payload enqueued onto BullMQ; the worker consumes exactly this shape. */
export const codeExecutionJobSchema = z.object({
  jobId: z.string().min(1),
  submissionRef: z.string().min(1),
  language: codeLanguageSchema,
  source: z.string(),
  stdin: z.string().optional(),
  /** Optional test cases for graded runs; absent for playground runs. */
  testCases: z.array(testCaseSchema).optional(),
});
export type CodeExecutionJob = z.infer<typeof codeExecutionJobSchema>;

/** Result of a single program run (plain or one test case). */
export const runOutputSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  /** Process exit code; null when the run was killed by a signal/timeout. */
  exitCode: z.number().nullable(),
  /** Signal that killed the process, if any (e.g. "SIGKILL"). */
  signal: z.string().nullable(),
});
export type RunOutput = z.infer<typeof runOutputSchema>;

/** Per-test-case grading detail (present only for graded runs). */
export const testCaseResultSchema = z.object({
  index: z.number().int().nonnegative(),
  passed: z.boolean(),
  input: z.string(),
  expectedOutput: z.string(),
  actualOutput: z.string(),
  stderr: z.string(),
});
export type TestCaseResult = z.infer<typeof testCaseResultSchema>;

/**
 * The result written to ExecutionJob.result for a code job. Shared by the
 * playground now and reused by exam/challenge grading later (per-case pass/fail
 * + a passed/total tally live here).
 */
export const executionResultSchema = z.object({
  language: codeLanguageSchema,
  version: z.string(),
  /** Compile phase output (compiled languages only; null for interpreted). */
  compile: runOutputSchema.nullable(),
  /** Program run — for graded runs this is the FIRST case's run (diagnostics). */
  run: runOutputSchema,
  /** True when Piston reported the run was killed for exceeding a limit. */
  timedOut: z.boolean(),
  /** Present only for graded runs. */
  testResults: z.array(testCaseResultSchema).nullable(),
  passedCount: z.number().int().nonnegative().nullable(),
  totalCount: z.number().int().nonnegative().nullable(),
});
export type ExecutionResult = z.infer<typeof executionResultSchema>;

/** Returned immediately on submit — the client then polls/streams status. */
export const jobRefSchema = z.object({
  jobId: z.string(),
  status: jobStatusSchema,
});
export type JobRef = z.infer<typeof jobRefSchema>;

/** Payload enqueued when an essay attempt needs grading. */
export const essayGradingJobSchema = z.object({
  jobId: z.string().min(1),
  attemptId: z.string().min(1),
  /**
   * Whether AI-assisted scoring is permitted for this attempt (the college's
   * `ai.essay_grading` entitlement, resolved at enqueue). Absent/true → AI may
   * run (individual essays are ungated); false → deterministic-only. Optional so
   * jobs enqueued before this field default to the prior behavior.
   */
  aiEnabled: z.boolean().optional(),
  /**
   * The owning COLLEGE (Stage-1 AI credits) so the worker can charge AI grading
   * to that college at the gateway seam. Absent for individual/B2C essays
   * (`college == null`) → grading is not metered against any college.
   */
  collegeId: z.string().optional(),
  /**
   * The STUDENT (essay author) to charge AI grading to, set ONLY when the college
   * has per-student credit distribution enabled (resolved at enqueue). Present →
   * the worker seam meters this grading against the student's ledger instead of
   * the college pool; absent → Stage-1 per-college metering (unchanged).
   */
  userId: z.string().optional(),
});
export type EssayGradingJob = z.infer<typeof essayGradingJobSchema>;

/** Generic job-status response (essay grading etc. reuse this shape). */
export const jobStatusResponseSchema = z.object({
  jobId: z.string(),
  status: jobStatusSchema,
  result: z.unknown().nullable(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type JobStatusResponse = z.infer<typeof jobStatusResponseSchema>;

/** `GET /api/execute/:jobId` — the generic shape narrowed to a code result. */
export const executeStatusResponseSchema = jobStatusResponseSchema.extend({
  result: executionResultSchema.nullable(),
});
export type ExecuteStatusResponse = z.infer<typeof executeStatusResponseSchema>;

// ---------------------------------------------------------------------------
// Curriculum / LMS
// ---------------------------------------------------------------------------

export const topicTypeSchema = z.enum(
  TOPIC_TYPE_VALUES as [TopicType, ...TopicType[]],
);

/** Query-string boolean ("true"/"false" -> boolean; avoids z.coerce pitfalls). */
const queryBoolean = z.enum(["true", "false"]).transform((v) => v === "true");

export const programSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
});
export type ProgramSummary = z.infer<typeof programSummarySchema>;

// --- Catalog ---------------------------------------------------------------

export const catalogItemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  image: z.string(),
  price: z.number().int().nonnegative(), // paise
  discountPrice: z.number().int().nonnegative(), // paise
  effectivePrice: z.number().int().nonnegative(), // paise
  isFree: z.boolean(),
  isPopular: z.boolean(),
  moduleCount: z.number().int().nonnegative(),
  topicCount: z.number().int().nonnegative(),
  program: programSummarySchema.nullable(),
  /** Only meaningful when the request is authenticated; false otherwise. */
  isEnrolled: z.boolean(),
});
export type CatalogItem = z.infer<typeof catalogItemSchema>;

export const catalogQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(24),
  program: z.string().trim().optional(), // program slug filter
  popular: queryBoolean.optional(),
  free: queryBoolean.optional(),
  q: z.string().trim().max(120).optional(),
});
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

export const catalogResponseSchema = z.object({
  items: z.array(catalogItemSchema),
  programs: z.array(programSummarySchema),
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});
export type CatalogResponse = z.infer<typeof catalogResponseSchema>;

// --- Subject detail (browse) -----------------------------------------------

export const topicNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  topicType: topicTypeSchema,
  order: z.number(),
  duration: z.string(),
  /** Content is gated: locked until the user is enrolled. */
  isLocked: z.boolean(),
  isCompleted: z.boolean(),
});
export type TopicNode = z.infer<typeof topicNodeSchema>;

export const moduleNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  order: z.number(),
  topics: z.array(topicNodeSchema),
});
export type ModuleNode = z.infer<typeof moduleNodeSchema>;

export const progressInfoSchema = z.object({
  completedTopics: z.number().int().nonnegative(),
  totalTopics: z.number().int().nonnegative(),
  percentage: z.number().int().min(0).max(100),
});
export type ProgressInfo = z.infer<typeof progressInfoSchema>;

export const enrollmentInfoSchema = z.object({
  isEnrolled: z.boolean(),
  enrolledAt: z.string().datetime().nullable(),
  /** When access ends (null = no expiry). Drives the in-player countdown. */
  expiresAt: z.string().datetime().nullable(),
});
export type EnrollmentInfo = z.infer<typeof enrollmentInfoSchema>;

export const subjectDetailSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  image: z.string(),
  price: z.number().int().nonnegative(),
  discountPrice: z.number().int().nonnegative(),
  effectivePrice: z.number().int().nonnegative(),
  isFree: z.boolean(),
  isPopular: z.boolean(),
  program: programSummarySchema.nullable(),
  /** Access window granted on enrollment, in days (0 = lifetime). */
  validityDays: z.number().int().nonnegative(),
  moduleCount: z.number().int().nonnegative(),
  topicCount: z.number().int().nonnegative(),
  modules: z.array(moduleNodeSchema),
  enrollment: enrollmentInfoSchema,
  progress: progressInfoSchema,
});
export type SubjectDetail = z.infer<typeof subjectDetailSchema>;

// --- Enrollment ------------------------------------------------------------

export const enrollResponseSchema = z.object({
  result: z.enum([EnrollResult.ENROLLED, EnrollResult.ALREADY_ENROLLED]),
  subjectSlug: z.string(),
  progress: progressInfoSchema,
});
export type EnrollResponse = z.infer<typeof enrollResponseSchema>;

export const enrollmentListItemSchema = z.object({
  subject: z.object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    image: z.string(),
    program: programSummarySchema.nullable(),
  }),
  enrolledAt: z.string().datetime(),
  /** When access ends (null = no expiry). Drives the days-left badge. */
  expiresAt: z.string().datetime().nullable(),
  progress: progressInfoSchema,
});
export type EnrollmentListItem = z.infer<typeof enrollmentListItemSchema>;

export const myEnrollmentsResponseSchema = z.object({
  items: z.array(enrollmentListItemSchema),
});
export type MyEnrollmentsResponse = z.infer<typeof myEnrollmentsResponseSchema>;

// --- Topic content (player step consumes this) -----------------------------

export const topicContentSchema = z.object({
  id: z.string(),
  moduleId: z.string(),
  name: z.string(),
  topicType: topicTypeSchema,
  order: z.number(),
  content: z.string(),
  videoId: z.string(),
  duration: z.string(),
  isCompleted: z.boolean(),
});
export type TopicContent = z.infer<typeof topicContentSchema>;

export const topicCompleteRequestSchema = z.object({
  completed: z.boolean(),
});
export type TopicCompleteRequest = z.infer<typeof topicCompleteRequestSchema>;

export const topicCompleteResponseSchema = z.object({
  topicId: z.string(),
  isCompleted: z.boolean(),
  progress: progressInfoSchema,
});
export type TopicCompleteResponse = z.infer<typeof topicCompleteResponseSchema>;

// --- Quiz (subject-level quiz topic) ---------------------------------------

export const quizChoiceSchema = z.object({
  id: z.string(),
  text: z.string(),
});
export type QuizChoice = z.infer<typeof quizChoiceSchema>;

export const quizQuestionSchema = z.object({
  id: z.string(),
  text: z.string(),
  marks: z.number().int().nonnegative(),
  /** Choices WITHOUT the correct flag — answers never leave the server. */
  choices: z.array(quizChoiceSchema),
});
export type QuizQuestion = z.infer<typeof quizQuestionSchema>;

export const quizSchema = z.object({
  topicId: z.string(),
  subjectSlug: z.string(),
  title: z.string(),
  questions: z.array(quizQuestionSchema),
});
export type Quiz = z.infer<typeof quizSchema>;

export const quizAnswerSchema = z.object({
  questionId: z.string(),
  choiceIds: z.array(z.string()),
});
export const quizSubmitRequestSchema = z.object({
  answers: z.array(quizAnswerSchema),
});
export type QuizSubmitRequest = z.infer<typeof quizSubmitRequestSchema>;

export const quizQuestionResultSchema = z.object({
  questionId: z.string(),
  correct: z.boolean(),
  selectedChoiceIds: z.array(z.string()),
  /** Revealed only in the graded RESULT (never in the quiz GET). */
  correctChoiceIds: z.array(z.string()),
});
export type QuizQuestionResult = z.infer<typeof quizQuestionResultSchema>;

export const quizResultSchema = z.object({
  score: z.number().nonnegative(),
  maxScore: z.number().nonnegative(),
  totalQuestions: z.number().int().nonnegative(),
  correctCount: z.number().int().nonnegative(),
  percentage: z.number().int().min(0).max(100),
  results: z.array(quizQuestionResultSchema),
});
export type QuizResult = z.infer<typeof quizResultSchema>;

// ---------------------------------------------------------------------------
// Daily challenges
// ---------------------------------------------------------------------------

export const dailyQuestionTypeSchema = z.enum(
  DAILY_QUESTION_TYPE_VALUES as [DailyQuestionType, ...DailyQuestionType[]],
);

/** The user's streak snapshot, returned alongside every challenge response. */
export const streakInfoSchema = z.object({
  currentStreak: z.number().int().nonnegative(),
  maxStreak: z.number().int().nonnegative(),
  totalScore: z.number().int().nonnegative(),
  /** A correct submission exists for today's question. */
  solvedToday: z.boolean(),
  /** Any scoring submission exists for today (a wrong MCQ still counts). */
  attemptedToday: z.boolean(),
});
export type StreakInfo = z.infer<typeof streakInfoSchema>;

/** A visible sample test case (hidden cases are NEVER sent to the client). */
export const challengeSampleCaseSchema = z.object({
  input: z.string(),
  expectedOutput: z.string(),
});
export type ChallengeSampleCase = z.infer<typeof challengeSampleCaseSchema>;

/**
 * Today's challenge, sanitized: MCQ options WITHOUT `correctOption`; CODE
 * starter + language + visible sample cases only (hidden tests stay server-side).
 */
export const todayChallengeSchema = z.object({
  available: z.literal(true),
  id: z.string(),
  questionType: dailyQuestionTypeSchema,
  title: z.string(),
  description: z.string(),
  points: z.number().int().nonnegative(),
  dayKey: z.string(),
  // MCQ only.
  options: z.array(z.string()).nullable(),
  // CODE only.
  starterCode: z.string().nullable(),
  language: codeLanguageSchema.nullable(),
  sampleCases: z.array(challengeSampleCaseSchema).nullable(),
  streak: streakInfoSchema,
});
export type TodayChallenge = z.infer<typeof todayChallengeSchema>;

/** Empty-state response when no challenge is released today. */
export const noChallengeTodaySchema = z.object({
  available: z.literal(false),
  streak: streakInfoSchema,
});
export type NoChallengeToday = z.infer<typeof noChallengeTodaySchema>;

/** GET /api/challenges/today — a challenge, or the empty state (still w/ streak). */
export const challengeTodayResponseSchema = z.union([
  todayChallengeSchema,
  noChallengeTodaySchema,
]);
export type ChallengeTodayResponse = z.infer<
  typeof challengeTodayResponseSchema
>;

// --- Submit MCQ ---
export const submitMcqRequestSchema = z.object({
  option: z.number().int().nonnegative(),
});
export type SubmitMcqRequest = z.infer<typeof submitMcqRequestSchema>;

export const submitMcqResponseSchema = z.object({
  correct: z.boolean(),
  /** Revealed only in the RESULT (never in the today GET). */
  correctOption: z.number().int().nonnegative(),
  awardedPoints: z.number().int().nonnegative(),
  streak: streakInfoSchema,
});
export type SubmitMcqResponse = z.infer<typeof submitMcqResponseSchema>;

// --- Submit CODE (rides the execution pipeline) ---
export const submitCodeRequestSchema = z.object({
  language: codeLanguageSchema,
  source: z
    .string()
    .min(1, "Source cannot be empty")
    .refine((s) => byteLen(s) <= MAX_SOURCE_BYTES, {
      message: `Source exceeds ${Math.floor(MAX_SOURCE_BYTES / 1024)} KB limit`,
    }),
});
export type SubmitCodeRequest = z.infer<typeof submitCodeRequestSchema>;

/**
 * Result of finalizing a CODE submission. Poll GET /api/execute/:jobId for the
 * run itself; this reports whether it counted as solved + the updated streak.
 * Idempotent: re-finalizing returns the same result without re-awarding.
 */
export const finalizeChallengeResponseSchema = z.object({
  status: jobStatusSchema,
  graded: z
    .object({
      passedCount: z.number().int().nonnegative(),
      totalCount: z.number().int().nonnegative(),
    })
    .nullable(),
  solved: z.boolean(),
  /** Whether points were awarded (now or on a prior finalize). */
  awarded: z.boolean(),
  awardedPoints: z.number().int().nonnegative(),
  error: z.string().nullable(),
  streak: streakInfoSchema,
});
export type FinalizeChallengeResponse = z.infer<
  typeof finalizeChallengeResponseSchema
>;

// --- Leaderboard ---
export const leaderboardRowSchema = z.object({
  rank: z.number().int().positive(),
  userId: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  totalScore: z.number().int().nonnegative(),
  currentStreak: z.number().int().nonnegative(),
  isCurrentUser: z.boolean(),
});
export type LeaderboardRow = z.infer<typeof leaderboardRowSchema>;

export const leaderboardResponseSchema = z.object({
  rows: z.array(leaderboardRowSchema),
  /** The caller's own row — included even when off the visible page. */
  me: leaderboardRowSchema.nullable(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>;

export const leaderboardQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .positive()
    .max(LEADERBOARD_MAX_PAGE_SIZE)
    .default(LEADERBOARD_DEFAULT_PAGE_SIZE),
});
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

// ---------------------------------------------------------------------------
// Assessments / mock exams
// ---------------------------------------------------------------------------

export const examQuestionTypeSchema = z.enum(
  EXAM_QUESTION_TYPE_VALUES as [ExamQuestionType, ...ExamQuestionType[]],
);
export const attemptStatusSchema = z.enum(
  EXAM_ATTEMPT_STATUS_VALUES as [ExamAttemptStatus, ...ExamAttemptStatus[]],
);

export const examSampleCaseSchema = z.object({
  input: z.string(),
  expectedOutput: z.string(),
});

/** One candidate answer (MCQ selections OR code + language). */
export const answerInputSchema = z.object({
  questionId: z.string(),
  selectedOptions: z.array(z.number().int().nonnegative()).optional(),
  code: z.string().optional(),
  language: codeLanguageSchema.optional(),
});
export type AnswerInput = z.infer<typeof answerInputSchema>;

export const savedAnswerSchema = z.object({
  selectedOptions: z.array(z.number().int().nonnegative()).nullable(),
  code: z.string().nullable(),
  language: codeLanguageSchema.nullable(),
});
export type SavedAnswer = z.infer<typeof savedAnswerSchema>;

/** A question as the CANDIDATE sees it — no correctOptions, no hidden tests. */
export const sanitizedQuestionSchema = z.object({
  id: z.string(),
  type: examQuestionTypeSchema,
  text: z.string(),
  order: z.number(),
  marks: z.number().int().nonnegative(),
  image: z.string(),
  options: z.array(z.string()).nullable(),
  starterCode: z.string().nullable(),
  language: codeLanguageSchema.nullable(),
  // Language policy the candidate sees: [] = open (pick any), [lang] = locked.
  allowedLanguages: z.array(codeLanguageSchema),
  sampleCases: z.array(examSampleCaseSchema).nullable(),
  savedAnswer: savedAnswerSchema.nullable(),
});
export type SanitizedQuestion = z.infer<typeof sanitizedQuestionSchema>;

/** The current section as the candidate sees it, with server-computed time. */
export const attemptSectionViewSchema = z.object({
  attemptId: z.string(),
  status: attemptStatusSchema,
  examId: z.string(),
  examTitle: z.string(),
  /** Whether the in-exam calculator is available for this exam. */
  calculatorEnabled: z.boolean(),
  sectionIndex: z.number().int().nonnegative(),
  totalSections: z.number().int().positive(),
  section: z.object({
    id: z.string(),
    name: z.string(),
    order: z.number(),
    description: z.string(),
    durationMinutes: z.number(),
    /**
     * Comprehension stimulus: a hosted audio file (Cloudinary) played before
     * the section's questions. Empty when the section has no stimulus (every
     * existing section). `stimulusPlayLimit` is the intended number of plays
     * (0 = unlimited) — enforced on the client and recorded server-side; see
     * the play-count note in the exam service (a hosted URL cannot be truly
     * un-replayable).
     */
    stimulusAudioUrl: z.string().default(""),
    stimulusPlayLimit: z.number().int().nonnegative().default(0),
    /** Plays already recorded for this section on this attempt (server truth). */
    stimulusPlaysUsed: z.number().int().nonnegative().default(0),
  }),
  sectionRemainingSeconds: z.number().int().nonnegative(),
  questions: z.array(sanitizedQuestionSchema),
  /** Question ids in THIS section the candidate flagged for review (persisted). */
  markedForReview: z.array(z.string()),
});
export type AttemptSectionView = z.infer<typeof attemptSectionViewSchema>;

/** Start-attempt echoes the attempt token (required for anonymous continuation). */
export const startAttemptResponseSchema = attemptSectionViewSchema.extend({
  attemptToken: z.string(),
});
export type StartAttemptResponse = z.infer<typeof startAttemptResponseSchema>;

export const saveSectionAnswersRequestSchema = z.object({
  answers: z.array(answerInputSchema),
  /** Marked-for-review question ids IN THE CURRENT SECTION (persisted as-is). */
  markedForReview: z.array(z.string()).optional(),
});
export type SaveSectionAnswersRequest = z.infer<
  typeof saveSectionAnswersRequestSchema
>;
export const saveSectionAnswersResponseSchema = z.object({
  saved: z.number().int().nonnegative(),
  sectionRemainingSeconds: z.number().int().nonnegative(),
});
export type SaveSectionAnswersResponse = z.infer<
  typeof saveSectionAnswersResponseSchema
>;

export const submitAttemptRequestSchema = z.object({
  auto: z.boolean().optional(),
});
export type SubmitAttemptRequest = z.infer<typeof submitAttemptRequestSchema>;

export const recordWarningResponseSchema = z.object({
  warningsTriggered: z.number().int().nonnegative(),
  isMalpractice: z.boolean(),
  /** True when this warning crossed the limit and force-submitted the attempt. */
  autoSubmitted: z.boolean(),
});
export type RecordWarningResponse = z.infer<typeof recordWarningResponseSchema>;

/**
 * Record a play of the CURRENT section's comprehension stimulus. The server
 * increments a per-(attempt, section) counter and reports it back. `exhausted`
 * is true once `playsUsed >= stimulusPlayLimit` (with a non-zero limit) — the
 * client uses it to disable the audio control. This is an HONEST record, not a
 * hard gate: the audio lives at a hosted URL the client already holds, so a
 * determined taker can re-fetch it; we record what happened rather than pretend
 * the file is un-replayable.
 */
export const recordStimulusPlayResponseSchema = z.object({
  sectionId: z.string(),
  playsUsed: z.number().int().nonnegative(),
  playLimit: z.number().int().nonnegative(),
  exhausted: z.boolean(),
});
export type RecordStimulusPlayResponse = z.infer<
  typeof recordStimulusPlayResponseSchema
>;

// --- Graded result / review (reveals correctOptions AFTER grading) ---
export const questionResultSchema = z.object({
  questionId: z.string(),
  type: examQuestionTypeSchema,
  text: z.string(),
  maxMarks: z.number().int().nonnegative(),
  awardedMarks: z.number().int().nonnegative(),
  selectedOptions: z.array(z.number().int()).nullable(),
  correctOptions: z.array(z.number().int()).nullable(),
  code: z.string().nullable(),
  testsPassed: z.number().int().nonnegative().nullable(),
  testsTotal: z.number().int().nonnegative().nullable(),
  note: z.string().nullable(),
});
export type QuestionResult = z.infer<typeof questionResultSchema>;

export const sectionResultSchema = z.object({
  sectionId: z.string(),
  name: z.string(),
  score: z.number().int().nonnegative(),
  maxScore: z.number().int().nonnegative(),
  questions: z.array(questionResultSchema),
});
export type SectionResult = z.infer<typeof sectionResultSchema>;

export const examResultSchema = z.object({
  attemptId: z.string(),
  status: attemptStatusSchema,
  score: z.number().int().nonnegative(),
  totalMarks: z.number().int().nonnegative(),
  passPercentage: z.number().int().min(0).max(100),
  passed: z.boolean(),
  autoSubmitted: z.boolean(),
  warnings: z.number().int().nonnegative(),
  isMalpractice: z.boolean(),
  /** True while CODE grading jobs are still running. */
  gradingPending: z.boolean(),
  /**
   * True when the organiser has turned OFF result display for this exam — the
   * attempt is still graded server-side, but the student sees "coming soon"
   * (score/sections are redacted) until results are published.
   */
  resultsHidden: z.boolean(),
  /** Null until fully graded (or when results are hidden). */
  sections: z.array(sectionResultSchema).nullable(),
});
export type ExamResult = z.infer<typeof examResultSchema>;

// --- Student exam list ---
export const examListItemSchema = z.object({
  id: z.string(),
  topicId: z.string(),
  title: z.string(),
  totalMarks: z.number().int().nonnegative(),
  passPercentage: z.number().int().min(0).max(100),
  sectionCount: z.number().int().nonnegative(),
  questionCount: z.number().int().nonnegative(),
  totalDurationMinutes: z.number().int().nonnegative(),
  /** True → the student must enter a start code (the code itself is never sent). */
  accessCodeEnabled: z.boolean(),
  attemptsUsed: z.number().int().nonnegative(),
  maxAttempts: z.number().int().nonnegative(),
  lastAttempt: z
    .object({
      id: z.string(),
      status: attemptStatusSchema,
      score: z.number().int().nonnegative(),
      passed: z.boolean(),
    })
    .nullable(),
});
export type ExamListItem = z.infer<typeof examListItemSchema>;
export const examListResponseSchema = z.object({
  items: z.array(examListItemSchema),
});
export type ExamListResponse = z.infer<typeof examListResponseSchema>;

// --- Public link (anonymous) ---
export const publicExamSummarySchema = z.object({
  title: z.string(),
  totalMarks: z.number().int().nonnegative(),
  passPercentage: z.number().int().min(0).max(100),
  sectionCount: z.number().int().nonnegative(),
  totalDurationMinutes: z.number().int().nonnegative(),
});
export const publicExamAvailabilitySchema = z.object({
  available: z.boolean(),
  reason: z.string().nullable(),
  /** True → the taker must enter a start code (the code itself is never sent). */
  accessCodeEnabled: z.boolean(),
  exam: publicExamSummarySchema.nullable(),
});
export type PublicExamAvailability = z.infer<
  typeof publicExamAvailabilitySchema
>;
export const publicStartRequestSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required").max(120),
  gender: z.enum(["male", "female"], {
    errorMap: () => ({ message: "Select a gender" }),
  }),
  rollNumber: z.string().min(1, "Roll number is required").max(64),
  collegeName: z.string().min(1, "College name is required").max(200),
  /** Start code, when the link is code-gated (validated server-side). */
  accessCode: z.string().trim().max(64).optional(),
});
export type PublicStartRequest = z.infer<typeof publicStartRequestSchema>;

/**
 * Body for the authenticated attempt-start endpoints (individual + college).
 * Carries only the optional start code; the exam id is a URL param.
 */
export const startAttemptRequestSchema = z.object({
  accessCode: z.string().trim().max(64).optional(),
});
export type StartAttemptRequest = z.infer<typeof startAttemptRequestSchema>;

// --- Admin authoring ---
export const adminExamUpsertSchema = z.object({
  topicId: z.string().min(1),
  title: z.string().min(1),
  passPercentage: z.number().int().min(0).max(100).default(40),
  calculatorEnabled: z.boolean().default(true),
  shuffleQuestions: z.boolean().default(false),
  shuffleOptions: z.boolean().default(false),
  resultsVisible: z.boolean().default(true),
});
export type AdminExamUpsert = z.infer<typeof adminExamUpsertSchema>;

export const adminSectionUpsertSchema = z.object({
  name: z.string().min(1),
  order: z.number().int().nonnegative().default(0),
  durationMinutes: z.number().int().positive(),
  description: z.string().default(""),
  /** Comprehension stimulus audio (Cloudinary URL); "" for a normal section. */
  stimulusAudioUrl: z.string().default(""),
  /** Intended plays for the stimulus (0 = unlimited). */
  stimulusPlayLimit: z.number().int().nonnegative().default(0),
});
export type AdminSectionUpsert = z.infer<typeof adminSectionUpsertSchema>;

export const adminQuestionUpsertSchema = z.object({
  sectionId: z.string().min(1),
  type: examQuestionTypeSchema,
  text: z.string().min(1),
  order: z.number().int().nonnegative().default(0),
  marks: z.number().int().nonnegative().default(5),
  options: z.array(z.string()).max(5).optional(),
  correctOptions: z.array(z.number().int().nonnegative()).optional(),
  starterCode: z.string().default(""),
  language: codeLanguageSchema.default("python"),
  // Language policy (CODE): [] = open (any language), [lang] = locked to it.
  allowedLanguages: z.array(codeLanguageSchema).default([]),
  image: z.string().default(""),
});
export type AdminQuestionUpsert = z.infer<typeof adminQuestionUpsertSchema>;

export const adminTestCaseUpsertSchema = z.object({
  input: z.string().default(""),
  expectedOutput: z.string().default(""),
  isHidden: z.boolean().default(false),
  order: z.number().int().nonnegative().default(0),
});
export type AdminTestCaseUpsert = z.infer<typeof adminTestCaseUpsertSchema>;

export const adminPublicLinkUpsertSchema = z
  .object({
    isActive: z.boolean().default(true),
    startTime: z.string().datetime().nullable().optional(),
    endTime: z.string().datetime().nullable().optional(),
    /** Gate anonymous starts behind a code the organiser reads out. */
    accessCodeEnabled: z.boolean().default(false),
    accessCode: z.string().trim().max(64).default(""),
    /** Admin-only label to differentiate sessions (e.g. "Section 2 CSE"). */
    tag: z.string().trim().max(120).default(""),
    /** Per-link overrides for this link's takers. */
    shuffleQuestions: z.boolean().default(false),
    shuffleOptions: z.boolean().default(false),
    resultsVisible: z.boolean().default(true),
  })
  .refine((v) => !v.accessCodeEnabled || v.accessCode.length >= 4, {
    message: "Enter a start code of at least 4 characters to enable the code gate",
    path: ["accessCode"],
  });
export type AdminPublicLinkUpsert = z.infer<typeof adminPublicLinkUpsertSchema>;
export const publicLinkSchema = z.object({
  id: z.string(),
  accessToken: z.string(),
  isActive: z.boolean(),
  startTime: z.string().datetime().nullable(),
  endTime: z.string().datetime().nullable(),
  /** Author-only: echoed back so the organiser can read out / copy the code. */
  accessCodeEnabled: z.boolean(),
  accessCode: z.string(),
  /** Admin-only session label (never shown to takers). */
  tag: z.string(),
  /** Per-link overrides (see the model): shuffle + result visibility. */
  shuffleQuestions: z.boolean(),
  shuffleOptions: z.boolean(),
  resultsVisible: z.boolean(),
});
export type PublicLink = z.infer<typeof publicLinkSchema>;

export const adminResetAttemptsRequestSchema = z.object({
  userId: z.string().min(1),
  reason: z.string().default(""),
});
export type AdminResetAttemptsRequest = z.infer<
  typeof adminResetAttemptsRequestSchema
>;

// Admin exam detail — the full authored tree, INCLUDING answers + test cases.
export const adminTestCaseSchema = z.object({
  id: z.string(),
  input: z.string(),
  expectedOutput: z.string(),
  isHidden: z.boolean(),
  order: z.number(),
});
export const adminQuestionSchema = z.object({
  id: z.string(),
  type: examQuestionTypeSchema,
  text: z.string(),
  order: z.number(),
  marks: z.number().int().nonnegative(),
  options: z.array(z.string()).nullable(),
  correctOptions: z.array(z.number().int()).nullable(),
  starterCode: z.string(),
  language: codeLanguageSchema,
  // Language policy (CODE): [] = open, [lang] = locked to that language.
  allowedLanguages: z.array(codeLanguageSchema),
  image: z.string(),
  testCases: z.array(adminTestCaseSchema),
});
export const adminSectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  order: z.number(),
  durationMinutes: z.number(),
  description: z.string(),
  stimulusAudioUrl: z.string().default(""),
  stimulusPlayLimit: z.number().int().nonnegative().default(0),
  questions: z.array(adminQuestionSchema),
});
export const adminExamDetailSchema = z.object({
  id: z.string(),
  topicId: z.string(),
  title: z.string(),
  totalMarks: z.number().int().nonnegative(),
  passPercentage: z.number().int().min(0).max(100),
  calculatorEnabled: z.boolean(),
  shuffleQuestions: z.boolean(),
  shuffleOptions: z.boolean(),
  /** Whether students see their result after submitting (else "coming soon"). */
  resultsVisible: z.boolean(),
  /** Author-only: per-exam start-code gate (echoed so faculty can read it out). */
  accessCodeEnabled: z.boolean(),
  accessCode: z.string(),
  sections: z.array(adminSectionSchema),
  publicLinks: z.array(publicLinkSchema),
});
export type AdminExamDetail = z.infer<typeof adminExamDetailSchema>;

// Admin exam list — every exam (regardless of enrollment) with cheap counts.
export const adminExamSummarySchema = z.object({
  id: z.string(),
  topicId: z.string(),
  title: z.string(),
  totalMarks: z.number().int().nonnegative(),
  passPercentage: z.number().int().min(0).max(100),
  sectionCount: z.number().int().nonnegative(),
  questionCount: z.number().int().nonnegative(),
});
export type AdminExamSummary = z.infer<typeof adminExamSummarySchema>;
export const adminExamListResponseSchema = z.object({
  items: z.array(adminExamSummarySchema),
});
export type AdminExamListResponse = z.infer<
  typeof adminExamListResponseSchema
>;

// ---------------------------------------------------------------------------
// Curriculum admin authoring — structural tree (Program / Subject / Module).
// Money stays integer paise. Slug is optional on write: derived from the name
// when omitted; a clean validation error (SLUG_TAKEN) on collision.
// ---------------------------------------------------------------------------

/** Reorder a sibling set by supplying the full ordered id array (order = index). */
export const adminReorderSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});
export type AdminReorder = z.infer<typeof adminReorderSchema>;

/** Optional slug on write: lowercase kebab, letters/numbers/hyphens only. */
const adminSlugField = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug may contain only lowercase letters, numbers, and single hyphens",
  )
  .optional();

// --- Program ---
export const adminProgramUpsertSchema = z.object({
  name: z.string().trim().min(1),
  slug: adminSlugField,
  description: z.string().default(""),
  order: z.number().int().nonnegative().default(0),
  isVisible: z.boolean().default(true),
});
export type AdminProgramUpsert = z.infer<typeof adminProgramUpsertSchema>;

export const adminProgramSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  order: z.number(),
  isVisible: z.boolean(),
  subjectCount: z.number().int().nonnegative(),
});
export type AdminProgram = z.infer<typeof adminProgramSchema>;
export const adminProgramListResponseSchema = z.object({
  items: z.array(adminProgramSchema),
});
export type AdminProgramListResponse = z.infer<
  typeof adminProgramListResponseSchema
>;

// --- Subject ---
export const adminSubjectUpsertSchema = z.object({
  name: z.string().trim().min(1),
  slug: adminSlugField,
  /** Program to file the subject under; null/omitted = unfiled. */
  programId: z.string().min(1).nullable().optional(),
  /**
   * Image reference (or empty). Normally a Cloudinary secure_url from the
   * signed-upload pipeline, but tolerant of legacy/non-URL values so existing
   * records stay editable — a hard `.url()` check here blocks saving ANY edit
   * (name, price, validity …) on a course whose stored image predates it.
   */
  image: z.string().trim().max(2048).default(""),
  description: z.string().default(""),
  price: z.number().int().nonnegative().default(0), // paise
  discountPrice: z.number().int().nonnegative().default(0), // paise
  /** Access window granted on enrollment, in days (0 = lifetime, no expiry). */
  validityDays: z.number().int().nonnegative().default(0),
  isPopular: z.boolean().default(false),
  isVisible: z.boolean().default(true),
});
export type AdminSubjectUpsert = z.infer<typeof adminSubjectUpsertSchema>;

export const adminSubjectSchema = z.object({
  id: z.string(),
  programId: z.string().nullable(),
  programName: z.string().nullable(),
  name: z.string(),
  slug: z.string(),
  image: z.string(),
  description: z.string(),
  price: z.number().int().nonnegative(),
  discountPrice: z.number().int().nonnegative(),
  validityDays: z.number().int().nonnegative(),
  isPopular: z.boolean(),
  isVisible: z.boolean(),
  moduleCount: z.number().int().nonnegative(),
  enrollmentCount: z.number().int().nonnegative(),
});
export type AdminSubject = z.infer<typeof adminSubjectSchema>;

/** Result of recomputing a course's enrollment expiries from its validity. */
export const recomputeExpiryResponseSchema = z.object({
  /** Enrollments whose expiry was recomputed. */
  updated: z.number().int().nonnegative(),
  /** Of those, how many are now past their expiry (access ended). */
  expired: z.number().int().nonnegative(),
});
export type RecomputeExpiryResponse = z.infer<
  typeof recomputeExpiryResponseSchema
>;
export const adminSubjectListResponseSchema = z.object({
  items: z.array(adminSubjectSchema),
});
export type AdminSubjectListResponse = z.infer<
  typeof adminSubjectListResponseSchema
>;

// --- Module ---
export const adminModuleUpsertSchema = z.object({
  name: z.string().trim().min(1),
  order: z.number().int().nonnegative().default(0),
});
export type AdminModuleUpsert = z.infer<typeof adminModuleUpsertSchema>;

export const adminModuleSchema = z.object({
  id: z.string(),
  subjectId: z.string(),
  name: z.string(),
  order: z.number(),
  topicCount: z.number().int().nonnegative(),
});
export type AdminModule = z.infer<typeof adminModuleSchema>;
export const adminModuleListResponseSchema = z.object({
  items: z.array(adminModuleSchema),
});
export type AdminModuleListResponse = z.infer<
  typeof adminModuleListResponseSchema
>;

// ---------------------------------------------------------------------------
// Curriculum admin authoring — leaf tree (Topic + quiz Question/Choice).
//
// The Topic upsert is a DISCRIMINATED UNION on topicType so each type carries
// only its own fields (matches the original admin form, which shows type-
// specific inputs). `order` is optional on write — omit to append at the end of
// the module (service assigns max+1); it is a FLOAT so topics insert between.
// ---------------------------------------------------------------------------

// Fields shared by every topic type. `order` omitted => append (service-side).
const adminTopicBase = {
  name: z.string().trim().min(1),
  order: z.number().optional(),
  isVisible: z.boolean().default(true),
};

export const adminTopicUpsertSchema = z.discriminatedUnion("topicType", [
  z.object({
    topicType: z.literal(TopicType.TEXT),
    ...adminTopicBase,
    content: z.string().default(""),
  }),
  z.object({
    topicType: z.literal(TopicType.VIDEO),
    ...adminTopicBase,
    // Bare YouTube id (extraction is a UI concern); duration is a label string.
    videoId: z.string().trim().default(""),
    duration: z.string().trim().default(""),
  }),
  z.object({
    topicType: z.literal(TopicType.QUIZ),
    ...adminTopicBase,
  }),
  z.object({
    topicType: z.literal(TopicType.EXAM),
    ...adminTopicBase,
  }),
  z.object({
    // A GAME topic carries no extra authoring fields — its GameSet is created +
    // linked separately (platform game-set create with topicId), exactly as an
    // EXAM topic's Exam is created and linked by Exam.topic.
    topicType: z.literal(TopicType.GAME),
    ...adminTopicBase,
  }),
  z.object({
    topicType: z.literal(TopicType.ESSAY),
    ...adminTopicBase,
    // Optional + nullable: an essay topic may exist with no prompt linked yet.
    essayTopicId: z.string().min(1).nullable().optional(),
  }),
]);
export type AdminTopicUpsert = z.infer<typeof adminTopicUpsertSchema>;

export const adminTopicSchema = z.object({
  id: z.string(),
  moduleId: z.string(),
  name: z.string(),
  topicType: topicTypeSchema,
  order: z.number(),
  isVisible: z.boolean(),
  content: z.string(),
  videoId: z.string(),
  duration: z.string(),
  /** Set only for essay topics (null when unlinked or not an essay topic). */
  essayTopicId: z.string().nullable(),
  essayTopicTitle: z.string().nullable(),
  /** Set only for exam topics — the linked Exam's id (null otherwise). */
  examId: z.string().nullable(),
  /** Authored quiz question count (0 unless a quiz topic). */
  questionCount: z.number().int().nonnegative(),
});
export type AdminTopic = z.infer<typeof adminTopicSchema>;
export const adminTopicListResponseSchema = z.object({
  items: z.array(adminTopicSchema),
});
export type AdminTopicListResponse = z.infer<
  typeof adminTopicListResponseSchema
>;

// --- Quiz Question / Choice (subject-level quiz, scoped to a quiz topic) ---
export const adminChoiceUpsertSchema = z.object({
  text: z.string().trim().min(1),
  isCorrect: z.boolean().default(false),
});
export type AdminChoiceUpsert = z.infer<typeof adminChoiceUpsertSchema>;

export const adminQuizQuestionUpsertSchema = z
  .object({
    text: z.string().trim().min(1),
    marks: z.number().int().nonnegative().default(1),
    // Choices are a nested write (replace-all on update). A quiz question is
    // always MCQ: >= 2 choices, >= 1 correct (multiple correct is allowed).
    choices: z
      .array(adminChoiceUpsertSchema)
      .min(2, "A question needs at least 2 choices"),
  })
  .refine((q) => q.choices.some((c) => c.isCorrect), {
    message: "At least one choice must be marked correct",
    path: ["choices"],
  });
export type AdminQuizQuestionUpsert = z.infer<
  typeof adminQuizQuestionUpsertSchema
>;

export const adminChoiceSchema = z.object({
  id: z.string(),
  text: z.string(),
  isCorrect: z.boolean(),
});
export const adminQuizQuestionSchema = z.object({
  id: z.string(),
  topicId: z.string(),
  text: z.string(),
  marks: z.number().int().nonnegative(),
  choices: z.array(adminChoiceSchema),
});
export type AdminQuizQuestion = z.infer<typeof adminQuizQuestionSchema>;
export const adminQuizQuestionListResponseSchema = z.object({
  items: z.array(adminQuizQuestionSchema),
});
export type AdminQuizQuestionListResponse = z.infer<
  typeof adminQuizQuestionListResponseSchema
>;

// --- Exam-topic picker (what the 4b exam editor needs to attach/find exams) ---
export const adminExamTopicSchema = z.object({
  topicId: z.string(),
  examId: z.string(),
  name: z.string(),
  moduleId: z.string(),
  moduleName: z.string(),
  subjectId: z.string(),
  subjectName: z.string(),
});
export type AdminExamTopic = z.infer<typeof adminExamTopicSchema>;
export const adminExamTopicListResponseSchema = z.object({
  items: z.array(adminExamTopicSchema),
});
export type AdminExamTopicListResponse = z.infer<
  typeof adminExamTopicListResponseSchema
>;

// --- Excel bulk upload ---
/** Generic base64-workbook upload body (topics, roster, …). */
export const excelUploadRequestSchema = z.object({
  /** The .xlsx workbook, base64-encoded. */
  fileBase64: z.string().min(1),
});
export type ExcelUploadRequest = z.infer<typeof excelUploadRequestSchema>;

/** Which single-sheet question format an exam bulk upload / template is for. */
export const examBulkUploadKindSchema = z.enum(["mcq", "coding"]);
export type ExamBulkUploadKind = z.infer<typeof examBulkUploadKindSchema>;

/** Exam question bulk upload — the workbook PLUS which type-specific format it is. */
export const examBulkUploadRequestSchema = excelUploadRequestSchema.extend({
  kind: examBulkUploadKindSchema,
});
export type ExamBulkUploadRequest = z.infer<typeof examBulkUploadRequestSchema>;
export const excelRowErrorSchema = z.object({
  sheet: z.string(),
  row: z.number().int(),
  message: z.string(),
});
export const excelUploadResponseSchema = z.object({
  createdSections: z.number().int().nonnegative(),
  createdQuestions: z.number().int().nonnegative(),
  createdTestCases: z.number().int().nonnegative(),
  errors: z.array(excelRowErrorSchema),
});
export type ExcelUploadResponse = z.infer<typeof excelUploadResponseSchema>;

// ---------------------------------------------------------------------------
// Question bank (net-new) — a global Standard/Coding bank + per-college Self
// Bank. A bank Question's PAYLOAD MIRRORS an ExamQuestion (same fields), so
// pulling one into an exam is a clean field copy (no conversion).
// ---------------------------------------------------------------------------

export const questionDifficultySchema = z.enum(
  QUESTION_DIFFICULTY_VALUES as [QuestionDifficulty, ...QuestionDifficulty[]],
);
export const bankScopeSchema = z.enum(
  BANK_SCOPE_VALUES as [BankScope, ...BankScope[]],
);
export const bankKindSchema = z.enum(
  BANK_KIND_VALUES as [BankKind, ...BankKind[]],
);

/** Embedded test case for a CODE bank question (mirrors ExamTestCase fields). */
export const bankTestCaseSchema = z.object({
  input: z.string().default(""),
  expectedOutput: z.string().default(""),
  isHidden: z.boolean().default(false),
  order: z.number().int().nonnegative().default(0),
});
export type BankTestCase = z.infer<typeof bankTestCaseSchema>;

/** A bank question as returned to clients. Payload mirrors ExamQuestion +
 * embedded test cases (CODE) + bank metadata + scope. */
export const bankQuestionSchema = z.object({
  id: z.string(),
  scope: bankScopeSchema,
  /** Null for global; the owning college id for a Self Bank question. */
  college: z.string().nullable(),
  kind: bankKindSchema,
  category: z.string(),
  subCategory: z.string(),
  company: z.string(),
  difficulty: questionDifficultySchema,
  tags: z.array(z.string()),
  // --- Payload mirroring ExamQuestion ---
  questionType: examQuestionTypeSchema,
  text: z.string(),
  options: z.array(z.string()).nullable(),
  correctOptions: z.array(z.number().int().nonnegative()).nullable(),
  starterCode: z.string(),
  language: codeLanguageSchema,
  allowedLanguages: z.array(codeLanguageSchema),
  image: z.string(),
  marks: z.number().int().nonnegative(),
  testCases: z.array(bankTestCaseSchema),
});
export type BankQuestion = z.infer<typeof bankQuestionSchema>;

/** Super-admin create/update of a GLOBAL bank question. `kind` is derived from
 * `questionType` server-side; `scope` is always global (server-set). */
export const bankQuestionUpsertSchema = z.object({
  category: z.string().trim().min(1).max(120),
  subCategory: z.string().trim().max(120).default(""),
  company: z.string().trim().max(120).default("General"),
  difficulty: questionDifficultySchema.default("medium"),
  tags: z.array(z.string().trim().min(1)).default([]),
  questionType: examQuestionTypeSchema,
  text: z.string().min(1),
  marks: z.number().int().nonnegative().default(5),
  options: z.array(z.string()).max(5).optional(),
  correctOptions: z.array(z.number().int().nonnegative()).optional(),
  starterCode: z.string().default(""),
  language: codeLanguageSchema.default("python"),
  allowedLanguages: z.array(codeLanguageSchema).default([]),
  image: z.string().default(""),
  testCases: z.array(bankTestCaseSchema).default([]),
});
export type BankQuestionUpsert = z.infer<typeof bankQuestionUpsertSchema>;

/** Browse/filter query for bank questions (paginated). */
export const bankBrowseQuerySchema = z.object({
  /** Which bank to read. Admin always reads `global`; a college defaults to
   * `all` (its granted global banks + its own Self Bank). */
  scope: z.enum(["global", "college", "all"]).default("all"),
  kind: bankKindSchema.optional(),
  category: z.string().trim().min(1).optional(),
  subCategory: z.string().trim().min(1).optional(),
  company: z.string().trim().min(1).optional(),
  difficulty: questionDifficultySchema.optional(),
  /** Match a single tag (a question's `tags[]` contains this value). */
  tag: z.string().trim().min(1).optional(),
  /** Free-text over text + tags. */
  q: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
export type BankBrowseQuery = z.infer<typeof bankBrowseQuerySchema>;

/**
 * DISTINCT filter values across the ENTIRE bank the caller may browse (scope/
 * grant + the source `kind`), NOT just the current page — so the filter bar can
 * offer every available value. Independent of the soft filters (category /
 * company / etc.), so choosing one never hides the others.
 */
export const bankFacetsSchema = z.object({
  kinds: z.array(bankKindSchema),
  categories: z.array(z.string()),
  subCategories: z.array(z.string()),
  companies: z.array(z.string()),
  difficulties: z.array(questionDifficultySchema),
  tags: z.array(z.string()),
});
export type BankFacets = z.infer<typeof bankFacetsSchema>;

export const bankListResponseSchema = z.object({
  items: z.array(bankQuestionSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  /** Bank-wide distinct filter values (see bankFacetsSchema). */
  facets: bankFacetsSchema,
});
export type BankListResponse = z.infer<typeof bankListResponseSchema>;

/** Pull a set of bank questions INTO an exam section (copied as ExamQuestions). */
export const bankPullIntoExamRequestSchema = z.object({
  examId: z.string().min(1),
  sectionId: z.string().min(1),
  questionIds: z.array(z.string().min(1)).min(1),
});
export type BankPullIntoExamRequest = z.infer<
  typeof bankPullIntoExamRequestSchema
>;

export const bankPullIntoExamResponseSchema = z.object({
  pulled: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
export type BankPullIntoExamResponse = z.infer<
  typeof bankPullIntoExamResponseSchema
>;

/** Bank importer response — created count + parser row errors (reused shape). */
export const bankImportResponseSchema = z.object({
  created: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  errors: z.array(excelRowErrorSchema),
});
export type BankImportResponse = z.infer<typeof bankImportResponseSchema>;

// --- AI Test Builder (generate questions into an exam section via the LLM) ---
/**
 * Faculty request to AI-generate questions into an exam section. `count` is the
 * number to insert (server-capped); `questionTypes` are the real engine types
 * the LLM may produce; `description` + `difficulty` steer the generation.
 */
export const aiGenerateQuestionsRequestSchema = z.object({
  examId: z.string().min(1),
  sectionId: z.string().min(1),
  description: z.string().trim().min(1).max(4000),
  questionTypes: z.array(examQuestionTypeSchema).min(1),
  count: z.coerce.number().int().positive().max(MAX_AI_GENERATED_QUESTIONS),
  difficulty: questionDifficultySchema.default("medium"),
});
export type AiGenerateQuestionsRequest = z.infer<
  typeof aiGenerateQuestionsRequestSchema
>;

/**
 * AI-generate result. `configured=false` is the graceful no-key state (nothing
 * generated, a warning explaining why); otherwise created/skipped counts + any
 * coercion warnings.
 */
export const aiGenerateQuestionsResponseSchema = z.object({
  configured: z.boolean(),
  created: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});
export type AiGenerateQuestionsResponse = z.infer<
  typeof aiGenerateQuestionsResponseSchema
>;

/**
 * Faculty request to AI-build a WHOLE exam: the LLM proposes `sectionCount`
 * sections (name + duration) and up to `questionsPerSection` questions in each;
 * the server creates the sections and inserts the valid questions. Both counts
 * are server-capped (sections ≤ MAX_AI_EXAM_SECTIONS, questions ≤
 * MAX_AI_GENERATED_QUESTIONS).
 */
export const aiGenerateExamRequestSchema = z.object({
  examId: z.string().min(1),
  description: z.string().trim().min(1).max(4000),
  questionTypes: z.array(examQuestionTypeSchema).min(1),
  sectionCount: z.coerce.number().int().positive().max(MAX_AI_EXAM_SECTIONS),
  questionsPerSection: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_AI_GENERATED_QUESTIONS),
  difficulty: questionDifficultySchema.default("medium"),
});
export type AiGenerateExamRequest = z.infer<typeof aiGenerateExamRequestSchema>;

/** Full-exam AI-build result: sections created + total questions inserted. */
export const aiGenerateExamResponseSchema = z.object({
  configured: z.boolean(),
  sectionsCreated: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});
export type AiGenerateExamResponse = z.infer<
  typeof aiGenerateExamResponseSchema
>;

// --- LLM Gateway admin (super-admin: manage providers/keys + monitoring) -----

const providerKindSchema = z.enum(
  PROVIDER_KIND_VALUES as [ProviderKind, ...ProviderKind[]],
);
const providerCapabilitySchema = z.enum(
  PROVIDER_CAPABILITY_VALUES as [ProviderCapability, ...ProviderCapability[]],
);
const aiProviderStatusSchema = z.enum(
  AI_PROVIDER_STATUS_VALUES as [AiProviderStatus, ...AiProviderStatus[]],
);

/** Documented limits as returned to the admin (null = "no limit on that axis"). */
export const aiProviderLimitsSchema = z.object({
  requestsPerMinute: z.number().int().nonnegative().nullable(),
  requestsPerDay: z.number().int().nonnegative().nullable(),
  tokensPerMinute: z.number().int().nonnegative().nullable(),
  tokensPerDay: z.number().int().nonnegative().nullable(),
});

const usageWindowSchema = z.object({
  requests: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
});

/** Live health for the monitoring view (real counters — never fabricated). */
export const aiProviderHealthViewSchema = z.object({
  status: aiProviderStatusSchema,
  cooldownUntil: z.number().nullable(),
  consecutiveFailures: z.number().int().nonnegative(),
  reliability: z.number(),
  lastError: z.string(),
  lastErrorAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  usage: z.object({ minute: usageWindowSchema, day: usageWindowSchema }),
});

/** One provider as shown to the super-admin. NEVER carries the key/plaintext. */
export const aiProviderAdminSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: providerKindSchema,
  baseUrl: z.string(),
  model: z.string(),
  enabled: z.boolean(),
  priority: z.number().int(),
  capability: providerCapabilitySchema,
  trainsOnData: z.boolean(),
  limits: aiProviderLimitsSchema,
  /** Whether an API key is stored — the key itself is NEVER returned. */
  keySet: z.boolean(),
  /** Where the super-admin claims a free API key for this provider (null if unknown). */
  keyUrl: z.string().nullable(),
  health: aiProviderHealthViewSchema,
});
export type AiProviderAdmin = z.infer<typeof aiProviderAdminSchema>;

export const aiProvidersSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  enabled: z.number().int().nonnegative(),
  keyed: z.number().int().nonnegative(),
  /** Enabled + keyed + not currently cooling down. */
  available: z.number().int().nonnegative(),
  /** False when the server has no ENCRYPTION_KEY — keys can't be stored yet. */
  encryptionConfigured: z.boolean(),
});
export type AiProvidersSummary = z.infer<typeof aiProvidersSummarySchema>;

export const aiProvidersListResponseSchema = z.object({
  providers: z.array(aiProviderAdminSchema),
  summary: aiProvidersSummarySchema,
});
export type AiProvidersListResponse = z.infer<
  typeof aiProvidersListResponseSchema
>;

/** Curated provider edit — every field optional (partial patch). */
export const aiProviderPatchSchema = z
  .object({
    enabled: z.boolean(),
    priority: z.number().int(),
    trainsOnData: z.boolean(),
    capability: providerCapabilitySchema,
    model: z.string().trim().min(1),
    baseUrl: z.string().trim().url(),
    limits: z.object({
      requestsPerMinute: z.number().int().nonnegative().nullable().optional(),
      requestsPerDay: z.number().int().nonnegative().nullable().optional(),
      tokensPerMinute: z.number().int().nonnegative().nullable().optional(),
      tokensPerDay: z.number().int().nonnegative().nullable().optional(),
    }),
  })
  .partial();
export type AiProviderPatch = z.infer<typeof aiProviderPatchSchema>;

/** Set/replace a provider's API key — encrypted server-side; never echoed. */
export const setProviderKeyRequestSchema = z.object({
  key: z.string().trim().min(1, "A key is required"),
});
export type SetProviderKeyRequest = z.infer<typeof setProviderKeyRequestSchema>;

export const keyStatusResponseSchema = z.object({ keySet: z.boolean() });
export type KeyStatusResponse = z.infer<typeof keyStatusResponseSchema>;

/** Result of a live key probe — never carries the key or a raw provider body. */
export const testProviderKeyResponseSchema = z.object({
  ok: z.boolean(),
  status: z.number().int().optional(),
  message: z.string().optional(),
});
export type TestProviderKeyResponse = z.infer<
  typeof testProviderKeyResponseSchema
>;

// --- Usage TRENDS (token-optimization monitoring; all numbers are REAL rollups) ---

/** One day's total consumption across all providers + cache activity. */
export const usageTrendDaySchema = z.object({
  date: z.string(), // YYYY-MM-DD (UTC)
  requests: z.number().int().nonnegative(),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  cacheHits: z.number().int().nonnegative(),
  tokensSaved: z.number().int().nonnegative(),
});
export type UsageTrendDay = z.infer<typeof usageTrendDaySchema>;

/** Per-provider totals over the window (for the by-provider breakdown). */
export const usageTrendProviderSchema = z.object({
  providerId: z.string(),
  name: z.string(),
  requests: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
});
export type UsageTrendProvider = z.infer<typeof usageTrendProviderSchema>;

/** Per-feature totals over the window (grading vs generation vs ai_build …). */
export const usageTrendFeatureSchema = z.object({
  feature: z.string(),
  requests: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
  cacheHits: z.number().int().nonnegative(),
  cacheMisses: z.number().int().nonnegative(),
  tokensSaved: z.number().int().nonnegative(),
});
export type UsageTrendFeature = z.infer<typeof usageTrendFeatureSchema>;

/** Cache effectiveness over the window. */
export const usageCacheSummarySchema = z.object({
  hits: z.number().int().nonnegative(),
  misses: z.number().int().nonnegative(),
  hitRate: z.number().min(0).max(1), // hits / (hits + misses); 0 when none
  tokensSaved: z.number().int().nonnegative(),
});
export type UsageCacheSummary = z.infer<typeof usageCacheSummarySchema>;

export const usageTrendsResponseSchema = z.object({
  windowDays: z.number().int().positive(),
  totals: z.object({
    requests: z.number().int().nonnegative(),
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
  }),
  byDay: z.array(usageTrendDaySchema),
  byProvider: z.array(usageTrendProviderSchema),
  byFeature: z.array(usageTrendFeatureSchema),
  cache: usageCacheSummarySchema,
});
export type UsageTrendsResponse = z.infer<typeof usageTrendsResponseSchema>;

// --- Bulk topic import (text/video only; per-subject) ---
/** One per-row failure in a topic bulk-upload (partial success is the norm). */
export const topicRowErrorSchema = z.object({
  row: z.number().int(),
  message: z.string(),
});
export const topicExcelUploadResponseSchema = z.object({
  createdModules: z.number().int().nonnegative(),
  createdTopics: z.number().int().nonnegative(),
  errors: z.array(topicRowErrorSchema),
});
export type TopicExcelUploadResponse = z.infer<
  typeof topicExcelUploadResponseSchema
>;

// --- Bulk enroll (roster → provision users + enroll across subjects) ---
export const bulkEnrollRequestSchema = z.object({
  /** Enroll the roster across one or more subjects in a single pass. */
  subjectIds: z.array(z.string().min(1)).min(1, "Select at least one course"),
  /** The .xlsx roster, base64-encoded. */
  fileBase64: z.string().min(1),
});
export type BulkEnrollRequest = z.infer<typeof bulkEnrollRequestSchema>;
export const bulkEnrollResponseSchema = z.object({
  /** Newly provisioned student accounts (existing users are reused). */
  createdUsers: z.number().int().nonnegative(),
  /** New enrollments added across the selected subjects. */
  enrolledCount: z.number().int().nonnegative(),
  errors: z.array(topicRowErrorSchema),
});
export type BulkEnrollResponse = z.infer<typeof bulkEnrollResponseSchema>;

// --- Admin: per-course enrollment management --------------------------------

export const ADMIN_ENROLLMENT_DEFAULT_PAGE_SIZE = 25;
export const ADMIN_ENROLLMENT_MAX_PAGE_SIZE = 100;

/** Paginated/filtered roster query for one course's enrollments. */
export const adminEnrollmentListQuerySchema = z.object({
  q: z.string().trim().default(""),
  status: z.enum(["all", "active", "expired"]).default("all"),
  /** Exact-match on the learner's college (Profile.collegeName). */
  college: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(ADMIN_ENROLLMENT_MAX_PAGE_SIZE)
    .default(ADMIN_ENROLLMENT_DEFAULT_PAGE_SIZE),
});
export type AdminEnrollmentListQuery = z.infer<
  typeof adminEnrollmentListQuerySchema
>;

/** Distinct colleges present among a course's enrollments (filter options). */
export const adminEnrollmentCollegesResponseSchema = z.object({
  colleges: z.array(z.string()),
});
export type AdminEnrollmentCollegesResponse = z.infer<
  typeof adminEnrollmentCollegesResponseSchema
>;

export const adminEnrollmentItemSchema = z.object({
  enrollmentId: z.string(),
  userId: z.string(),
  fullName: z.string(),
  email: z.string(),
  rollNumber: z.string(),
  /** "order" (paid) | "manual" (admin/roster) | "college" (tenant-assigned). */
  source: z.enum(["order", "manual", "college"]),
  enrolledAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  active: z.boolean(),
  /** Admin may remove/edit this row (false for college-assigned enrollments). */
  managed: z.boolean(),
});
export type AdminEnrollmentItem = z.infer<typeof adminEnrollmentItemSchema>;

export const adminEnrollmentListResponseSchema = z.object({
  items: z.array(adminEnrollmentItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type AdminEnrollmentListResponse = z.infer<
  typeof adminEnrollmentListResponseSchema
>;

/** Enroll existing users into a course (by user id). */
export const adminEnrollmentAddSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1, "Select at least one user"),
});
export type AdminEnrollmentAdd = z.infer<typeof adminEnrollmentAddSchema>;
export const adminEnrollmentAddResponseSchema = z.object({
  added: z.number().int().nonnegative(),
  /** Already enrolled (or protected college rows) — left untouched. */
  skipped: z.number().int().nonnegative(),
});
export type AdminEnrollmentAddResponse = z.infer<
  typeof adminEnrollmentAddResponseSchema
>;

/** Remove enrollments from a course (by user id); college rows are protected. */
export const adminEnrollmentRemoveSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1, "Select at least one user"),
});
export type AdminEnrollmentRemove = z.infer<typeof adminEnrollmentRemoveSchema>;
export const adminEnrollmentRemoveResponseSchema = z.object({
  removed: z.number().int().nonnegative(),
});
export type AdminEnrollmentRemoveResponse = z.infer<
  typeof adminEnrollmentRemoveResponseSchema
>;

/** Set/clear one enrollment's access expiry (null = lifetime). */
export const adminEnrollmentSetExpirySchema = z.object({
  expiresAt: z.string().datetime().nullable(),
});
export type AdminEnrollmentSetExpiry = z.infer<
  typeof adminEnrollmentSetExpirySchema
>;

// ---------------------------------------------------------------------------
// Generic API error envelope
// ---------------------------------------------------------------------------

export const apiErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    code: z.string().optional(),
    /** Field-level validation issues, when applicable. */
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

// ---------------------------------------------------------------------------
// Essays (AI-graded writing)
//
// Two projections of a prompt: the STUDENT projection (browse + detail) never
// carries reference keywords or rubric internals; those live only in the ADMIN
// projection. Grading results expose the per-dimension breakdown, the score
// source (ai_hybrid | deterministic_fallback), and a feedback summary.
// ---------------------------------------------------------------------------

export const essayGradingStatusSchema = z.enum(
  ESSAY_GRADING_STATUS_VALUES as [EssayGradingStatus, ...EssayGradingStatus[]],
);
export const essayScoreSourceSchema = z.enum(
  ESSAY_SCORE_SOURCE_VALUES as [EssayScoreSource, ...EssayScoreSource[]],
);
export const essayDifficultySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
/** essay | email. Defaults to essay everywhere so existing topics are unchanged. */
export const essayPromptKindSchema = z.enum(
  ESSAY_PROMPT_KIND_VALUES as [EssayPromptKind, ...EssayPromptKind[]],
);

// ---------------------------------------------------------------------------
// Essay-topic (prompt) admin authoring — CRUD over the EssayTopic model. The
// semanticKeywords feed the grader's relevance dimension (manual for now; AI
// keyword-generation awaits the real essay-AI integration — see the service).
// ---------------------------------------------------------------------------

export const adminEssayTopicUpsertSchema = z
  .object({
    title: z.string().trim().min(1),
    description: z.string().default(""),
    instructions: z.string().default(""),
    difficultyLevel: essayDifficultySchema.default(1),
    /** essay (default, unchanged) | email (grades through the email rubric). */
    promptKind: essayPromptKindSchema.default("essay"),
    minWords: z.number().int().nonnegative().default(0),
    maxWords: z.number().int().nonnegative().default(0),
    timeLimitMinutes: z.number().int().nonnegative().default(0),
    /** Per-topic attempt cap (submitted attempts). Defaults to the original's 3. */
    maxAttempts: z.number().int().min(1).default(3),
    isActive: z.boolean().default(true),
    /** Reference keywords for the relevance analyzer (deduped, non-empty). */
    semanticKeywords: z.array(z.string().trim().min(1)).default([]),
  })
  .refine((t) => t.maxWords === 0 || t.minWords === 0 || t.maxWords >= t.minWords, {
    message: "Max words must be greater than or equal to min words",
    path: ["maxWords"],
  });
export type AdminEssayTopicUpsert = z.infer<typeof adminEssayTopicUpsertSchema>;

export const adminEssayTopicSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  instructions: z.string(),
  difficultyLevel: essayDifficultySchema,
  promptKind: essayPromptKindSchema,
  minWords: z.number().int().nonnegative(),
  maxWords: z.number().int().nonnegative(),
  timeLimitMinutes: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  isActive: z.boolean(),
  semanticKeywords: z.array(z.string()),
  /** Student attempts referencing this prompt (drives delete-block). */
  attemptCount: z.number().int().nonnegative(),
  /** Curriculum essay-topics linking this prompt (SET_NULL on delete). */
  linkedTopicCount: z.number().int().nonnegative(),
});
export type AdminEssayTopic = z.infer<typeof adminEssayTopicSchema>;
/**
 * Generate semantic keywords for a topic (LLM-assisted, ADVISORY). Works for
 * unsaved topics too — the dialog sends the current title/description/
 * instructions, not an id. The response is a PROPOSAL the admin edits + saves;
 * it is never auto-applied. `source` reveals whether the LLM ran or the
 * deterministic fallback did.
 */
export const generateKeywordsRequestSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().default(""),
  instructions: z.string().default(""),
});
export type GenerateKeywordsRequest = z.infer<
  typeof generateKeywordsRequestSchema
>;

export const keywordSourceSchema = z.enum(["llm", "deterministic"]);
export type KeywordSource = z.infer<typeof keywordSourceSchema>;

export const generateKeywordsResponseSchema = z.object({
  keywords: z.array(z.string()),
  source: keywordSourceSchema,
});
export type GenerateKeywordsResponse = z.infer<
  typeof generateKeywordsResponseSchema
>;

export const adminEssayTopicListResponseSchema = z.object({
  items: z.array(adminEssayTopicSchema),
});
export type AdminEssayTopicListResponse = z.infer<
  typeof adminEssayTopicListResponseSchema
>;

// ---------------------------------------------------------------------------
// Daily-challenge authoring (admin)
// ---------------------------------------------------------------------------

/** An IST "challenge day" key, `YYYY-MM-DD` (the canonical schedule slot). */
export const challengeDayKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

/** Provenance of a daily challenge (how it was published). */
export const dailyChallengeSourceSchema = z.enum(
  DAILY_CHALLENGE_SOURCE_VALUES as [
    DailyChallengeSource,
    ...DailyChallengeSource[],
  ],
);

/** A CODE challenge's test case (hidden cases never leave the server). */
export const adminChallengeTestCaseSchema = z.object({
  input: z.string().default(""),
  expectedOutput: z.string().default(""),
  isHidden: z.boolean().default(false),
});
export type AdminChallengeTestCase = z.infer<
  typeof adminChallengeTestCaseSchema
>;

/**
 * Create/update payload for a DailyQuestion. `releaseDate` is a day key; the
 * service normalizes it to the IST-midnight instant the serving query matches.
 * MCQ needs ≥2 options and an in-range correct index; CODE carries a starter,
 * language, and test cases (the MCQ fields are ignored, and vice versa).
 */
export const adminChallengeUpsertSchema = z
  .object({
    questionType: dailyQuestionTypeSchema,
    releaseDate: challengeDayKeySchema,
    title: z.string().trim().min(1),
    description: z.string().default(""),
    marks: z.number().int().nonnegative().default(5),
    // MCQ
    options: z.array(z.string().trim().min(1)).default([]),
    correctOption: z.number().int().nonnegative().default(0),
    // CODE
    starterCode: z.string().default(""),
    language: codeLanguageSchema.default(CodeLanguage.PYTHON),
    testCases: z.array(adminChallengeTestCaseSchema).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.questionType === DailyQuestionType.MCQ) {
      if (v.options.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "An MCQ needs at least two options",
          path: ["options"],
        });
      }
      if (v.correctOption >= v.options.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Correct option is out of range",
          path: ["correctOption"],
        });
      }
    }
  });
export type AdminChallengeUpsert = z.infer<typeof adminChallengeUpsertSchema>;

/** Full challenge detail (create/update/get) — includes test cases. */
export const adminChallengeSchema = z.object({
  id: z.string(),
  questionType: dailyQuestionTypeSchema,
  releaseDate: challengeDayKeySchema,
  title: z.string(),
  description: z.string(),
  marks: z.number().int().nonnegative(),
  options: z.array(z.string()),
  correctOption: z.number().int().nonnegative(),
  starterCode: z.string(),
  language: codeLanguageSchema,
  testCases: z.array(adminChallengeTestCaseSchema),
  /** Scored submissions referencing this question (drives delete-block). */
  submissionCount: z.number().int().nonnegative(),
  /** Provenance (auto-pipeline vs manual). Defaults to manual for legacy rows. */
  source: dailyChallengeSourceSchema.default(DailyChallengeSource.MANUAL),
  /** When the auto-pipeline produced it (null for manual/legacy). */
  generatedAt: z.string().datetime().nullable().default(null),
  /** Human-readable validation outcome from the pipeline (empty for manual). */
  validationNote: z.string().default(""),
});
export type AdminChallenge = z.infer<typeof adminChallengeSchema>;

/** Lightweight list row (no test-case bodies). */
export const adminChallengeListItemSchema = z.object({
  id: z.string(),
  questionType: dailyQuestionTypeSchema,
  releaseDate: challengeDayKeySchema,
  title: z.string(),
  marks: z.number().int().nonnegative(),
  testCaseCount: z.number().int().nonnegative(),
  submissionCount: z.number().int().nonnegative(),
  /** Provenance badge for the admin list (manual / ai / *_fallback). */
  source: dailyChallengeSourceSchema.default(DailyChallengeSource.MANUAL),
  generatedAt: z.string().datetime().nullable().default(null),
});
export type AdminChallengeListItem = z.infer<
  typeof adminChallengeListItemSchema
>;
export const adminChallengeListResponseSchema = z.object({
  items: z.array(adminChallengeListItemSchema),
});
export type AdminChallengeListResponse = z.infer<
  typeof adminChallengeListResponseSchema
>;

/**
 * Excel bulk import. `startDate` present ⇒ SEQUENTIAL scheduling (row order,
 * one per consecutive day); absent ⇒ each row's `date` column is EXPLICIT.
 * Reuses the base64 body shape. Conflicts (an occupied date, in the DB or
 * earlier in the sheet) are reported per-row and skipped — never overwritten.
 */
export const adminChallengeBulkImportRequestSchema = z.object({
  fileBase64: z.string().min(1),
  startDate: challengeDayKeySchema.optional(),
});
export type AdminChallengeBulkImportRequest = z.infer<
  typeof adminChallengeBulkImportRequestSchema
>;
export const adminChallengeBulkImportResponseSchema = z.object({
  scheduled: z.number().int().nonnegative(),
  errors: z.array(topicRowErrorSchema),
});
export type AdminChallengeBulkImportResponse = z.infer<
  typeof adminChallengeBulkImportResponseSchema
>;

// ---------------------------------------------------------------------------
// Automatic daily-challenge generation pipeline (worker) + admin regenerate
// ---------------------------------------------------------------------------

/**
 * BullMQ payload for the daily-challenge generator. `dayKey` absent ⇒ the IST
 * day that has just begun (the scheduled path). `force` replaces an existing
 * challenge for that day (the admin "Regenerate" path); without it the pipeline
 * is a no-op when the day is already published (idempotent).
 */
export const dailyChallengeJobSchema = z.object({
  dayKey: challengeDayKeySchema.optional(),
  force: z.boolean().optional(),
});
export type DailyChallengeJob = z.infer<typeof dailyChallengeJobSchema>;

/**
 * The shape the LLM is asked to produce for an auto daily challenge — either a
 * CODE problem or an MCQ (discriminated by `questionType`).
 *
 * CODE: the `referenceSolution` is executed (Piston) against every test case
 * BEFORE publishing — a challenge whose own reference solution fails its cases
 * is rejected (→ fallback), so a broken/unsolvable AI CODE challenge is never
 * served. 3–5 cases, at least one hidden encouraged.
 *
 * MCQ: cannot be execution-validated (there is nothing to run), so it passes a
 * light sanity check only (≥2 options, an in-range correct index) and is marked
 * honestly as AI-authored-not-execution-validated.
 */
const aiDailyChallengeCodeSchema = z.object({
  questionType: z.literal(DailyQuestionType.CODE),
  title: z.string().trim().min(1).max(160),
  statement: z.string().trim().min(1).max(4000),
  starterCode: z.string().max(8000).default(""),
  language: codeLanguageSchema.default(CodeLanguage.PYTHON),
  referenceSolution: z.string().trim().min(1).max(12000),
  difficulty: questionDifficultySchema.optional(),
  testCases: z
    .array(
      z.object({
        input: z.string().default(""),
        expectedOutput: z.string().default(""),
        isHidden: z.boolean().default(false),
      }),
    )
    .min(3)
    .max(6),
});

const aiDailyChallengeMcqSchema = z.object({
  questionType: z.literal(DailyQuestionType.MCQ),
  title: z.string().trim().min(1).max(160),
  statement: z.string().trim().min(1).max(4000),
  difficulty: questionDifficultySchema.optional(),
  options: z.array(z.string().trim().min(1)).min(2).max(6),
  correctOption: z.number().int().nonnegative(),
});

/**
 * Robust to models that omit the discriminator: infer `questionType` from the
 * presence of `options` (→ MCQ) vs `testCases`/`referenceSolution` (→ CODE)
 * before validating the discriminated union. The MCQ correct-index range is
 * checked in a superRefine (a discriminatedUnion member can't itself be refined).
 */
export const aiDailyChallengeSchema = z
  .preprocess((val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const o = val as Record<string, unknown>;
      if (o.questionType == null) {
        const inferred =
          Array.isArray(o.options) && o.options.length > 0
            ? DailyQuestionType.MCQ
            : DailyQuestionType.CODE;
        return { ...o, questionType: inferred };
      }
    }
    return val;
  }, z.discriminatedUnion("questionType", [aiDailyChallengeCodeSchema, aiDailyChallengeMcqSchema]))
  .superRefine((v, ctx) => {
    if (
      v.questionType === DailyQuestionType.MCQ &&
      v.correctOption >= v.options.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "correctOption is out of range",
        path: ["correctOption"],
      });
    }
  });
export type AiDailyChallenge = z.infer<typeof aiDailyChallengeSchema>;

/** Admin "Regenerate" request — re-run the pipeline for a day (replaces it). */
export const regenerateDailyChallengeRequestSchema = z.object({
  releaseDate: challengeDayKeySchema,
  force: z.boolean().default(true),
});
export type RegenerateDailyChallengeRequest = z.infer<
  typeof regenerateDailyChallengeRequestSchema
>;

export const regenerateDailyChallengeResponseSchema = z.object({
  queued: z.boolean(),
  releaseDate: challengeDayKeySchema,
});
export type RegenerateDailyChallengeResponse = z.infer<
  typeof regenerateDailyChallengeResponseSchema
>;

/**
 * Synchronous "Build with AI" authoring assist for the challenge editor (an
 * optional `topic` hint). This drafts a CODE challenge to PRE-FILL the form for
 * the admin to review and save — it is NOT the automatic pipeline and is NOT
 * execution-validated (the API has no sandbox), so the admin must verify the
 * test cases before publishing. `referenceSolution` is returned only so the
 * admin can test it; it is not stored on the challenge.
 */
export const aiBuildChallengeRequestSchema = z.object({
  topic: z.string().trim().max(200).optional(),
  /** Desired type — the editor passes its current selection; absent ⇒ AI picks. */
  questionType: dailyQuestionTypeSchema.optional(),
});
export type AiBuildChallengeRequest = z.infer<
  typeof aiBuildChallengeRequestSchema
>;

/**
 * Flat draft for the editor to pre-fill — carries `questionType` and BOTH field
 * sets (only the type-relevant ones are populated). MCQ fills options +
 * correctOption; CODE fills starterCode/language/testCases (+ referenceSolution,
 * returned only so the admin can test it — it is not stored on the challenge).
 */
export const aiChallengeDraftSchema = z.object({
  questionType: dailyQuestionTypeSchema,
  title: z.string(),
  description: z.string(),
  options: z.array(z.string()).default([]),
  correctOption: z.number().int().nonnegative().default(0),
  starterCode: z.string().default(""),
  language: codeLanguageSchema.default(CodeLanguage.PYTHON),
  referenceSolution: z.string().default(""),
  testCases: z.array(adminChallengeTestCaseSchema).default([]),
});
export type AiChallengeDraft = z.infer<typeof aiChallengeDraftSchema>;

/**
 * `configured=false` ⇒ no AI provider is available (graceful — the admin just
 * authors manually). `draft=null` with `configured=true` ⇒ the model returned
 * nothing usable; try again.
 */
export const aiBuildChallengeResponseSchema = z.object({
  configured: z.boolean(),
  draft: aiChallengeDraftSchema.nullable(),
});
export type AiBuildChallengeResponse = z.infer<
  typeof aiBuildChallengeResponseSchema
>;

// ---------------------------------------------------------------------------
// User admin + per-college performance (item 4-i) — read/reporting
// ---------------------------------------------------------------------------

export const ADMIN_USER_DEFAULT_PAGE_SIZE = 20;
export const ADMIN_USER_MAX_PAGE_SIZE = 100;

/** List/search query (coerced from query-string params). */
export const adminUserListQuerySchema = z.object({
  q: z.string().trim().default(""),
  role: roleSchema.optional(),
  college: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(ADMIN_USER_MAX_PAGE_SIZE)
    .default(ADMIN_USER_DEFAULT_PAGE_SIZE),
});
export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;

export const adminUserListItemSchema = z.object({
  id: z.string(),
  username: z.string(),
  email: z.string(),
  role: roleSchema,
  isActive: z.boolean(),
  fullName: z.string(),
  collegeName: z.string(),
  rollNumber: z.string(),
  createdAt: z.string(),
  lastLoginAt: z.string().nullable(),
});
export type AdminUserListItem = z.infer<typeof adminUserListItemSchema>;

export const adminUserListResponseSchema = z.object({
  items: z.array(adminUserListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type AdminUserListResponse = z.infer<typeof adminUserListResponseSchema>;

/** One enrollment row on the user-detail view. */
export const adminUserEnrollmentSchema = z.object({
  id: z.string(),
  subject: z.string(),
  source: z.string(),
  createdAt: z.string(),
});
/** One exam attempt row. */
export const adminUserExamAttemptSchema = z.object({
  exam: z.string(),
  score: z.number(),
  totalMarks: z.number(),
  passed: z.boolean(),
  status: z.string(),
  completedAt: z.string().nullable(),
});
/** One essay attempt row. */
export const adminUserEssayAttemptSchema = z.object({
  topic: z.string(),
  finalScore: z.number(),
  status: z.string(),
  submittedAt: z.string().nullable(),
});
/** One topic-progress row (ledger read — CRUD batch 3a). */
export const adminUserTopicProgressSchema = z.object({
  topic: z.string(),
  isCompleted: z.boolean(),
  completedAt: z.string().nullable(),
});
/** One subject-quiz submission row. `percentage` derives from score/total. */
export const adminUserQuizSubmissionSchema = z.object({
  subject: z.string(),
  topic: z.string().nullable(),
  score: z.number(),
  totalQuestions: z.number(),
  percentage: z.number(),
  submittedAt: z.string().nullable(),
});
/** One daily-challenge submission row. */
export const adminUserDailySubmissionSchema = z.object({
  question: z.string(),
  releaseDate: z.string().nullable(),
  isCorrect: z.boolean(),
  score: z.number(),
  submittedAt: z.string().nullable(),
});

/** Read-only aggregate of everything queryable about one user. */
export const adminUserDetailSchema = z.object({
  id: z.string(),
  username: z.string(),
  email: z.string(),
  role: roleSchema,
  isActive: z.boolean(),
  createdAt: z.string(),
  lastLoginAt: z.string().nullable(),
  profile: z.object({
    fullName: z.string(),
    collegeName: z.string(),
    rollNumber: z.string(),
    phoneNumber: z.string(),
    state: z.string(),
    bio: z.string(),
  }),
  stats: z.object({
    enrollments: z.number().int().nonnegative(),
    examAttempts: z.number().int().nonnegative(),
    examsPassed: z.number().int().nonnegative(),
    essayAttempts: z.number().int().nonnegative(),
    topicsCompleted: z.number().int().nonnegative(),
    quizSubmissions: z.number().int().nonnegative(),
    dailySubmissions: z.number().int().nonnegative(),
    currentStreak: z.number().int().nonnegative(),
    maxStreak: z.number().int().nonnegative(),
    dailyTotalScore: z.number().int().nonnegative(),
  }),
  enrollments: z.array(adminUserEnrollmentSchema),
  examAttempts: z.array(adminUserExamAttemptSchema),
  essayAttempts: z.array(adminUserEssayAttemptSchema),
  // Ledger read rows (CRUD batch 3a) — the detail already carried counts in
  // `stats`; these expose the underlying per-row history read-only.
  topicProgress: z.array(adminUserTopicProgressSchema),
  quizSubmissions: z.array(adminUserQuizSubmissionSchema),
  dailySubmissions: z.array(adminUserDailySubmissionSchema),
});
export type AdminUserDetail = z.infer<typeof adminUserDetailSchema>;

/** CONFIG mutations (item CRUD-batch-2). Machinery fields are never accepted. */
export const adminSetUserActiveSchema = z.object({ isActive: z.boolean() });
export type AdminSetUserActive = z.infer<typeof adminSetUserActiveSchema>;

export const adminSetUserRoleSchema = z.object({ role: roleSchema });
export type AdminSetUserRole = z.infer<typeof adminSetUserRoleSchema>;

/** Editable Profile fields only — no passwordHash / tokenVersion / role here. */
export const adminUpdateProfileSchema = z.object({
  fullName: z.string().trim().min(1),
  collegeName: z.string().trim().default(""),
  rollNumber: z.string().trim().min(1),
  phoneNumber: z.string().trim().default(""),
  state: z.string().trim().default(""),
  bio: z.string().default(""),
});
export type AdminUpdateProfile = z.infer<typeof adminUpdateProfileSchema>;

// ---------------------------------------------------------------------------
// Essay analytics review (item 4-ii) — read/reporting
// ---------------------------------------------------------------------------

export const essayStatusSchema = z.enum(
  ESSAY_STATUS_VALUES as [EssayStatus, ...EssayStatus[]],
);

export const essayRiskLevelSchema = z.enum(
  ESSAY_RISK_LEVELS as unknown as [EssayRiskLevel, ...EssayRiskLevel[]],
);

export const ADMIN_ESSAY_ANALYTICS_DEFAULT_PAGE_SIZE = 20;
export const ADMIN_ESSAY_ANALYTICS_MAX_PAGE_SIZE = 100;

export const adminEssayAnalyticsListQuerySchema = z.object({
  essayTopic: z.string().trim().optional(),
  status: essayStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(ADMIN_ESSAY_ANALYTICS_MAX_PAGE_SIZE)
    .default(ADMIN_ESSAY_ANALYTICS_DEFAULT_PAGE_SIZE),
});
export type AdminEssayAnalyticsListQuery = z.infer<
  typeof adminEssayAnalyticsListQuerySchema
>;

/** One row in the essay-analytics review list. */
export const adminEssayAnalyticsListItemSchema = z.object({
  attemptId: z.string(),
  student: z.string(),
  topic: z.string(),
  finalScore: z.number(),
  status: z.string(),
  submittedAt: z.string().nullable(),
  /** Whether a stored analytics sidecar exists for this attempt. */
  hasAnalytics: z.boolean(),
  /** Compact real-signal preview (0 when no analytics stored). */
  pasteEvents: z.number().int().nonnegative(),
  pastedChars: z.number().int().nonnegative(),
  /** Advisory risk (computed from stored signals; 0/low when no analytics). */
  riskScore: z.number().int().nonnegative(),
  riskLevel: essayRiskLevelSchema,
  suspicious: z.boolean(),
});
export type AdminEssayAnalyticsListItem = z.infer<
  typeof adminEssayAnalyticsListItemSchema
>;

export const adminEssayAnalyticsListResponseSchema = z.object({
  items: z.array(adminEssayAnalyticsListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type AdminEssayAnalyticsListResponse = z.infer<
  typeof adminEssayAnalyticsListResponseSchema
>;

/** The REAL compose signals `recordAnalytics` actually persists. */
export const adminEssaySignalsSchema = z.object({
  keystrokes: z.number().int().nonnegative(),
  deletes: z.number().int().nonnegative(),
  pasteEvents: z.number().int().nonnegative(),
  pastedChars: z.number().int().nonnegative(),
  composeSeconds: z.number().int().nonnegative(),
  finalWordCount: z.number().int().nonnegative(),
  finalCharacterCount: z.number().int().nonnegative(),
});

/**
 * Per-attempt analytics detail. `signals` are the genuine stored values;
 * `riskScoring` is the ADVISORY anti-cheat assessment, computed server-side
 * from the stored signals (never a client value). `wired` is now true, and
 * `reasons` explains every signal that fired. It is a review aid — it never
 * penalizes a student or affects a grade.
 */
export const adminEssayAttemptAnalyticsSchema = z.object({
  attemptId: z.string(),
  student: z.string(),
  topic: z.string(),
  finalScore: z.number(),
  status: z.string(),
  submittedAt: z.string().nullable(),
  wordCount: z.number().int().nonnegative(),
  characterCount: z.number().int().nonnegative(),
  hasAnalytics: z.boolean(),
  signals: adminEssaySignalsSchema.nullable(),
  riskScoring: z.object({
    /** True — the advisory scoring model is wired (computed from signals). */
    wired: z.boolean(),
    /** 0..100 advisory score computed from the stored compose signals. */
    riskScore: z.number().int().nonnegative(),
    level: essayRiskLevelSchema,
    /** Advisory flag (MEDIUM or worse); never auto-penalizes. */
    suspiciousActivity: z.boolean(),
    /** Human-readable explanation of each signal that fired (may be empty). */
    reasons: z.array(z.string()),
  }),
});
export type AdminEssayAttemptAnalytics = z.infer<
  typeof adminEssayAttemptAnalyticsSchema
>;

// ---------------------------------------------------------------------------
// Exam attempt-management reads (item C4) — read/reporting
// ---------------------------------------------------------------------------

/** One row of the per-exam attempt-counter list. */
export const adminExamAttemptCounterSchema = z.object({
  userId: z.string(),
  student: z.string(),
  rollNumber: z.string(),
  attemptCount: z.number().int().nonnegative(),
  maxAttempts: z.number().int().nonnegative(),
  /** attemptCount >= maxAttempts. */
  exhausted: z.boolean(),
});
export type AdminExamAttemptCounter = z.infer<
  typeof adminExamAttemptCounterSchema
>;
export const adminExamAttemptCountersResponseSchema = z.object({
  examId: z.string(),
  examTitle: z.string(),
  items: z.array(adminExamAttemptCounterSchema),
});
export type AdminExamAttemptCountersResponse = z.infer<
  typeof adminExamAttemptCountersResponseSchema
>;

/** One of a user's attempt rows on a given exam. */
export const adminExamAttemptRowSchema = z.object({
  attemptId: z.string(),
  status: z.string(),
  score: z.number(),
  passed: z.boolean(),
  warnings: z.number().int().nonnegative(),
  isMalpractice: z.boolean(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export type AdminExamAttemptRow = z.infer<typeof adminExamAttemptRowSchema>;

export const adminUserExamAttemptsResponseSchema = z.object({
  examId: z.string(),
  examTitle: z.string(),
  userId: z.string(),
  student: z.string(),
  counter: z
    .object({
      attemptCount: z.number().int().nonnegative(),
      maxAttempts: z.number().int().nonnegative(),
    })
    .nullable(),
  attempts: z.array(adminExamAttemptRowSchema),
});
export type AdminUserExamAttemptsResponse = z.infer<
  typeof adminUserExamAttemptsResponseSchema
>;

/** One immutable reset-audit row. */
export const adminExamResetLogRowSchema = z.object({
  id: z.string(),
  student: z.string(),
  resetBy: z.string(),
  previousCount: z.number().int().nonnegative(),
  reason: z.string(),
  resetAt: z.string(),
});
export type AdminExamResetLogRow = z.infer<typeof adminExamResetLogRowSchema>;
export const adminExamResetLogResponseSchema = z.object({
  examId: z.string(),
  examTitle: z.string(),
  items: z.array(adminExamResetLogRowSchema),
});
export type AdminExamResetLogResponse = z.infer<
  typeof adminExamResetLogResponseSchema
>;

/** The seven weighted 0..100 sub-scores. Keys are fixed by ESSAY_SCORE_WEIGHTS. */
export const essayDimensionScoresSchema = z.object(
  Object.fromEntries(
    (Object.keys(ESSAY_SCORE_WEIGHTS) as EssayScoreDimension[]).map((d) => [
      d,
      z.number(),
    ]),
  ) as Record<EssayScoreDimension, z.ZodNumber>,
);
export type EssayDimensionScoresDto = z.infer<
  typeof essayDimensionScoresSchema
>;

/** The eight weighted 0..100 email sub-scores. Keys fixed by EMAIL_SCORE_WEIGHTS. */
export const emailDimensionScoresSchema = z.object(
  Object.fromEntries(
    (Object.keys(EMAIL_SCORE_WEIGHTS) as EmailScoreDimension[]).map((d) => [
      d,
      z.number(),
    ]),
  ) as Record<EmailScoreDimension, z.ZodNumber>,
);
export type EmailDimensionScoresDto = z.infer<
  typeof emailDimensionScoresSchema
>;

/** Compact summary of the caller's latest attempt at a prompt (list view). */
export const essayLastAttemptSchema = z.object({
  id: z.string(),
  attemptNumber: z.number().int().positive(),
  status: essayGradingStatusSchema,
  finalScore: z.number().nullable(),
  source: essayScoreSourceSchema.nullable(),
});
export type EssayLastAttempt = z.infer<typeof essayLastAttemptSchema>;

/** Essay prompt as it appears in the STUDENT browse list. No rubric internals. */
export const essayPromptSummarySchema = z.object({
  id: z.string(),
  topicId: z.string(),
  title: z.string(),
  description: z.string(),
  difficultyLevel: essayDifficultySchema,
  /** essay | email — the student composer/instructions branch on this. */
  promptKind: essayPromptKindSchema,
  minWords: z.number().int().nonnegative(),
  maxWords: z.number().int().nonnegative(),
  timeLimitMinutes: z.number().int().nonnegative(),
  /** Per-topic attempt cap and how many the student has already submitted. */
  maxAttempts: z.number().int().positive(),
  attemptsUsed: z.number().int().nonnegative(),
  lastAttempt: essayLastAttemptSchema.nullable(),
});
export type EssayPromptSummary = z.infer<typeof essayPromptSummarySchema>;

export const essayListResponseSchema = z.object({
  items: z.array(essayPromptSummarySchema),
});
export type EssayListResponse = z.infer<typeof essayListResponseSchema>;

/** STUDENT prompt detail — adds instructions; still NO reference keywords. */
export const essayPromptDetailSchema = essayPromptSummarySchema.extend({
  instructions: z.string(),
});
export type EssayPromptDetail = z.infer<typeof essayPromptDetailSchema>;

/**
 * ADMIN prompt projection — the ONLY place reference keywords are exposed. The
 * relevance analyzer measures coverage against these; leaking them to a student
 * would trivially game the score, so they never appear in the student schemas.
 */
export const essayPromptAdminSchema = essayPromptDetailSchema.extend({
  referenceKeywords: z.array(z.string()),
  isActive: z.boolean(),
});
export type EssayPromptAdmin = z.infer<typeof essayPromptAdminSchema>;

/**
 * Compose-time integrity signals a PROCTORED (college) essay carries with its
 * submission — the mirror of the exam attempt's warnings/malpractice. `warnings`
 * is the count of hard proctoring violations (tab-switch / focus-loss /
 * fullscreen-exit / blocked-paste); `autoSubmitted` is true when the client
 * force-submitted after crossing the warning limit; `flags` are the advisory
 * keystroke-integrity signals (see essay-integrity.ts). All fields are optional
 * (individual essays are not proctored and omit this — their flow is unchanged);
 * the counts are clamped here and the malpractice flag is re-derived server-side.
 */
export const essayIntegritySchema = z.object({
  warnings: z.number().int().nonnegative().max(1000).default(0),
  autoSubmitted: z.boolean().default(false),
  flags: z.array(z.string().max(64)).max(50).default([]),
});
export type EssayIntegrity = z.infer<typeof essayIntegritySchema>;

/**
 * The integrity RECORD surfaced back on a graded/listed submission (read side).
 * `isMalpractice` is the server-derived flag (never the client's claim).
 */
export const essayIntegrityRecordSchema = z.object({
  warnings: z.number().int().nonnegative(),
  isMalpractice: z.boolean(),
  flags: z.array(z.string()),
});
export type EssayIntegrityRecord = z.infer<typeof essayIntegrityRecordSchema>;

/**
 * Submit an essay for grading. Content is bounded here by a hard character
 * ceiling (abuse guard); the topic's min/max WORD limits are enforced in the
 * service, since they depend on the specific prompt. `integrity` is optional and
 * present only for proctored college essays (additive — individual submits omit
 * it and behave exactly as before).
 */
export const submitEssayRequestSchema = z.object({
  content: z
    .string()
    .min(1, "Essay cannot be empty")
    .max(ESSAY_MAX_CONTENT_CHARS, "Essay is too long"),
  integrity: essayIntegritySchema.optional(),
});
export type SubmitEssayRequest = z.infer<typeof submitEssayRequestSchema>;

/**
 * Grading status/result for one submission (poll GET .../submissions/:jobId).
 * `gradingPending` is true until the worker finalizes; scores/source/feedback
 * are null until then. When complete, `source` distinguishes an AI-blended
 * result from a deterministic-only fallback.
 */
export const essayGradingResultSchema = z.object({
  jobId: z.string(),
  submissionId: z.string(),
  status: essayGradingStatusSchema,
  gradingPending: z.boolean(),
  total: z.number().nullable(),
  dimensions: essayDimensionScoresSchema.nullable(),
  /**
   * Email breakdown, present ONLY for an `email` topic (Communication module).
   * For an essay topic this is absent and `dimensions` carries the 7 essay
   * sub-scores exactly as before — the field is additive and never appears in
   * an essay response.
   */
  emailDimensions: emailDimensionScoresSchema.nullable().optional(),
  source: essayScoreSourceSchema.nullable(),
  feedback: z.string().nullable(),
  wordCount: z.number().int().nonnegative(),
  error: z.string().nullable(),
  /** Proctoring/integrity record (proctored essays); absent/null otherwise. */
  integrity: essayIntegrityRecordSchema.nullable().optional(),
});
export type EssayGradingResult = z.infer<typeof essayGradingResultSchema>;

/**
 * On-demand AI Scoring & Feedback for an essay (separate from the primary
 * heuristic grade): the model's own per-dimension scores plus qualitative
 * pros / cons / improvements and a short summary. Populated only when a user
 * clicks "AI Scoring and Feedback"; the heuristic grade remains the primary score.
 */
export const essayAiFeedbackSchema = z.object({
  scores: z.object({
    vocabulary: z.number().int().min(0).max(100),
    structure: z.number().int().min(0).max(100),
    relevance: z.number().int().min(0).max(100),
    overall: z.number().int().min(0).max(100),
  }),
  pros: z.array(z.string()),
  cons: z.array(z.string()),
  improvements: z.array(z.string()),
  summary: z.string(),
});
export type EssayAiFeedback = z.infer<typeof essayAiFeedbackSchema>;

/**
 * Result of an AI-feedback request. `configured=false` is the graceful state
 * when AI isn't available (no gateway/key, or the college's `ai.essay_grading`
 * is off); `feedback=null` when the model returned nothing usable.
 */
export const essayAiFeedbackResponseSchema = z.object({
  configured: z.boolean(),
  feedback: essayAiFeedbackSchema.nullable(),
  /**
   * Why feedback is null when it is. `"credits_exhausted"` = the college's AI
   * credits for this period are used up (contact your administrator). Absent
   * otherwise. Additive/optional so existing callers are unaffected.
   */
  reason: z.string().nullable().optional(),
});
export type EssayAiFeedbackResponse = z.infer<
  typeof essayAiFeedbackResponseSchema
>;

/** One row of a student's submission history for a prompt. */
export const essaySubmissionSummarySchema = z.object({
  id: z.string(),
  jobId: z.string().nullable(),
  attemptNumber: z.number().int().positive(),
  status: essayGradingStatusSchema,
  finalScore: z.number().nullable(),
  source: essayScoreSourceSchema.nullable(),
  wordCount: z.number().int().nonnegative(),
  submittedAt: z.string().datetime().nullable(),
  gradedAt: z.string().datetime().nullable(),
  /** Proctoring/integrity record (proctored essays); absent/null otherwise. */
  integrity: essayIntegrityRecordSchema.nullable().optional(),
});
export type EssaySubmissionSummary = z.infer<
  typeof essaySubmissionSummarySchema
>;

export const essaySubmissionListResponseSchema = z.object({
  promptId: z.string(),
  items: z.array(essaySubmissionSummarySchema),
});
export type EssaySubmissionListResponse = z.infer<
  typeof essaySubmissionListResponseSchema
>;

/**
 * Optional, ADDITIVE writing-analytics payload (Step 11). Posted to the
 * separate, non-grading endpoint `POST /essays/submissions/:jobId/analytics`.
 * It records cheap compose signals (counts + timings, never keylogged content)
 * and has ZERO effect on the grade — the grade is written by the worker and is
 * identical whether or not analytics are ever sent.
 */
export const essayAnalyticsRequestSchema = z.object({
  keystrokes: z.number().int().nonnegative().max(1_000_000),
  deletes: z.number().int().nonnegative().max(1_000_000),
  pasteCount: z.number().int().nonnegative().max(100_000),
  pastedChars: z.number().int().nonnegative().max(10_000_000),
  composeSeconds: z.number().int().nonnegative().max(1_000_000),
  wordCount: z.number().int().nonnegative().max(1_000_000),
  characterCount: z.number().int().nonnegative().max(10_000_000),
});
export type EssayAnalyticsInput = z.infer<typeof essayAnalyticsRequestSchema>;

/**
 * Autosave a draft snapshot of an in-progress essay (PUT /essays/:id/draft).
 * Content is bounded by the same hard character ceiling as a submission; the
 * server recomputes the word count and NEVER trusts a client-sent one. This is
 * a pure snapshot: it does not submit, grade, or consume an attempt.
 */
export const saveEssayDraftRequestSchema = z.object({
  content: z.string().max(ESSAY_MAX_CONTENT_CHARS, "Essay is too long"),
});
export type SaveEssayDraftRequest = z.infer<typeof saveEssayDraftRequestSchema>;

/** Acknowledgement of a saved draft snapshot. */
export const saveEssayDraftResponseSchema = z.object({
  savedAt: z.string().datetime(),
  wordCount: z.number().int().nonnegative(),
});
export type SaveEssayDraftResponse = z.infer<
  typeof saveEssayDraftResponseSchema
>;

/** A recoverable draft snapshot as returned by GET /essays/:id/draft. */
export const essayDraftDtoSchema = z.object({
  content: z.string(),
  wordCount: z.number().int().nonnegative(),
  savedAt: z.string().datetime(),
});
export type EssayDraftDto = z.infer<typeof essayDraftDtoSchema>;

/**
 * Latest recoverable draft for a prompt, or null when there is nothing to
 * restore (no draft, or the student already submitted after the last draft).
 */
export const essayDraftResponseSchema = z.object({
  draft: essayDraftDtoSchema.nullable(),
});
export type EssayDraftResponse = z.infer<typeof essayDraftResponseSchema>;

// ---------------------------------------------------------------------------
// Payments / coupons (PhonePe order lifecycle)
//
// All amounts are INTEGER PAISE; the UI formats with formatINR. The client
// never sends an amount — the server always re-resolves price + coupon.
// ---------------------------------------------------------------------------

export const paymentStatusSchema = z.enum(
  PAYMENT_STATUS_VALUES as [PaymentStatus, ...PaymentStatus[]],
);
export const couponRejectReasonSchema = z.enum(
  COUPON_REJECT_REASON_VALUES as [CouponRejectReason, ...CouponRejectReason[]],
);

// ---------------------------------------------------------------------------
// Order admin read (ledger read — CRUD batch 3a). READ-ONLY: no admin mutation.
// Gateway-owned fields (transactionId + gateway status) are surfaced in a
// dedicated `gateway` block and never presented as editable.
// ---------------------------------------------------------------------------

export const adminOrderListQuerySchema = z.object({
  /** Filter by lifecycle status. */
  status: paymentStatusSchema.optional(),
  /** Free-text search over orderId / transactionId / couponCode. */
  q: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(ADMIN_ORDERS_MAX_PAGE_SIZE)
    .default(ADMIN_ORDERS_DEFAULT_PAGE_SIZE),
});
export type AdminOrderListQuery = z.infer<typeof adminOrderListQuerySchema>;

/** One row in the order admin list. Amounts are integer PAISE. */
export const adminOrderListItemSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  status: paymentStatusSchema,
  amount: z.number().int().nonnegative(),
  student: z.string(),
  subject: z.string(),
  couponCode: z.string().nullable(),
  // Nullable: migrated/imported orders can lack a stored timestamp.
  createdAt: z.string().nullable(),
});
export type AdminOrderListItem = z.infer<typeof adminOrderListItemSchema>;

export const adminOrderListResponseSchema = z.object({
  items: z.array(adminOrderListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type AdminOrderListResponse = z.infer<
  typeof adminOrderListResponseSchema
>;

// ---------------------------------------------------------------------------
// Image uploads (Cloudinary signed uploads). The API computes a short-lived
// signature from the server-only api_secret; the browser uploads directly to
// Cloudinary with it. This response carries the PUBLIC values only (cloud name
// + api_key are public) plus the computed signature — NEVER the api_secret.
// ---------------------------------------------------------------------------

export const uploadSignatureResponseSchema = z.object({
  cloudName: z.string(),
  /** Public Cloudinary API key (safe to expose; the secret is not). */
  apiKey: z.string(),
  /** Unix seconds; part of the signed payload and short-lived. */
  timestamp: z.number().int(),
  /** Server-controlled folder the upload is pinned to. */
  folder: z.string(),
  /** SHA-1 signature over the signed params, computed with the api_secret. */
  signature: z.string(),
});
export type UploadSignatureResponse = z.infer<
  typeof uploadSignatureResponseSchema
>;

/** Full order detail. Amounts are integer PAISE. */
export const adminOrderDetailSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  status: paymentStatusSchema,
  amount: z.number().int().nonnegative(),
  discountAmount: z.number().int().nonnegative(),
  couponCode: z.string().nullable(),
  student: z.string(),
  studentEmail: z.string(),
  subject: z.string(),
  // Nullable: migrated/imported orders can lack stored timestamps.
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  /**
   * Gateway-owned (PhonePe) fields. Set by the verified payment callback /
   * webhook, NEVER edited from the admin — surfaced read-only for support.
   */
  gateway: z.object({
    transactionId: z.string().nullable(),
    status: paymentStatusSchema,
  }),
});
export type AdminOrderDetail = z.infer<typeof adminOrderDetailSchema>;
export const couponDiscountTypeSchema = z.enum(
  COUPON_DISCOUNT_TYPE_VALUES as [
    CouponDiscountTypeT,
    ...CouponDiscountTypeT[],
  ],
);

// ---------------------------------------------------------------------------
// Coupon admin authoring — CRUD over the Coupon model used by checkout.
//
// discountValue is discriminated on discountType: an integer PERCENT (1–100)
// for "percentage", or integer PAISE for "fixed" (money stays paise). Scope is
// nullable (global vs one subject). Validity window + usage caps mirror the
// redemption path (applyCoupon + resolvePricing).
// ---------------------------------------------------------------------------

// Fields shared by both discount types.
const couponCommon = {
  code: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(
      /^[A-Za-z0-9._-]+$/,
      "Code may contain only letters, numbers, and . _ -",
    ),
  active: z.boolean().default(true),
  /** ISO datetimes; null/omitted = open-ended on that side. */
  validFrom: z.string().datetime().nullable().optional(),
  validTo: z.string().datetime().nullable().optional(),
  /** Global redemption cap; null = unlimited. */
  usageLimit: z.number().int().positive().nullable().optional(),
  perUserLimit: z.number().int().positive().default(1),
  minOrderPaise: z.number().int().nonnegative().default(0),
  /** Scope: null/omitted = global; else the subject it applies to. */
  subjectId: z.string().min(1).nullable().optional(),
};

export const adminCouponUpsertSchema = z.discriminatedUnion("discountType", [
  z.object({
    discountType: z.literal(CouponDiscountType.PERCENTAGE),
    /** Percent off, 1–100. */
    discountValue: z.number().int().min(1).max(100),
    ...couponCommon,
  }),
  z.object({
    discountType: z.literal(CouponDiscountType.FIXED),
    /** Flat amount off, in paise (>= 1). */
    discountValue: z.number().int().min(1),
    ...couponCommon,
  }),
]);
export type AdminCouponUpsert = z.infer<typeof adminCouponUpsertSchema>;

export const adminCouponSchema = z.object({
  id: z.string(),
  code: z.string(),
  discountType: couponDiscountTypeSchema,
  discountValue: z.number().int().nonnegative(),
  active: z.boolean(),
  validFrom: z.string().datetime().nullable(),
  validTo: z.string().datetime().nullable(),
  usageLimit: z.number().int().positive().nullable(),
  perUserLimit: z.number().int().positive(),
  minOrderPaise: z.number().int().nonnegative(),
  /** Successful redemptions counted so far. */
  usedCount: z.number().int().nonnegative(),
  /** Orders referencing this coupon (any status) — drives delete-block. */
  orderCount: z.number().int().nonnegative(),
  subjectId: z.string().nullable(),
  subjectName: z.string().nullable(),
});
export type AdminCoupon = z.infer<typeof adminCouponSchema>;
export const adminCouponListResponseSchema = z.object({
  items: z.array(adminCouponSchema),
});
export type AdminCouponListResponse = z.infer<
  typeof adminCouponListResponseSchema
>;

/** Price preview / coupon check (POST /payments/quote) — no side effects. */
export const quoteRequestSchema = z.object({
  subjectId: z.string().min(1),
  couponCode: z.string().trim().min(1).max(64).optional(),
});
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

export const quoteResponseSchema = z.object({
  subjectId: z.string(),
  subjectSlug: z.string(),
  subjectName: z.string(),
  basePricePaise: z.number().int().nonnegative(),
  discountPaise: z.number().int().nonnegative(),
  finalPaise: z.number().int().nonnegative(),
  /** True when a coupon code was supplied AND accepted. */
  couponApplied: z.boolean(),
  /** Echoed (normalized) coupon code when applied. */
  couponCode: z.string().nullable(),
  /** Rejection reason when a supplied coupon could not be applied. */
  reason: couponRejectReasonSchema.nullable(),
  /** The subject is free (nothing to pay). */
  isFree: z.boolean(),
  /** The caller already owns this subject. */
  alreadyEnrolled: z.boolean(),
});
export type QuoteResponse = z.infer<typeof quoteResponseSchema>;

/** Create an order (POST /payments/orders). */
export const createOrderRequestSchema = z.object({
  subjectId: z.string().min(1),
  couponCode: z.string().trim().min(1).max(64).optional(),
});
export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;

/** The gateway redirect the client follows to complete payment. */
export const createOrderResponseSchema = z.object({
  orderId: z.string(),
  /** Hosted-checkout URL the client redirects to (gateway or mock-pay). */
  redirectUrl: z.string(),
  amountPaise: z.number().int().nonnegative(),
  discountPaise: z.number().int().nonnegative(),
  couponCode: z.string().nullable(),
});
export type CreateOrderResponse = z.infer<typeof createOrderResponseSchema>;

/** Order status (GET /payments/orders/:orderId) — poll target after return. */
export const orderStatusResponseSchema = z.object({
  orderId: z.string(),
  status: paymentStatusSchema,
  amountPaise: z.number().int().nonnegative(),
  discountPaise: z.number().int().nonnegative(),
  couponCode: z.string().nullable(),
  transactionId: z.string().nullable(),
  subject: z.object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
  }),
  /** Whether enrollment has been granted (true only after verified success). */
  enrolled: z.boolean(),
  createdAt: z.string().datetime(),
});
export type OrderStatusResponse = z.infer<typeof orderStatusResponseSchema>;

/** One row of the caller's order history. */
export const orderSummarySchema = z.object({
  orderId: z.string(),
  status: paymentStatusSchema,
  amountPaise: z.number().int().nonnegative(),
  discountPaise: z.number().int().nonnegative(),
  couponCode: z.string().nullable(),
  subjectSlug: z.string(),
  subjectName: z.string(),
  createdAt: z.string().datetime(),
});
export type OrderSummary = z.infer<typeof orderSummarySchema>;

export const orderListResponseSchema = z.object({
  items: z.array(orderSummarySchema),
});
export type OrderListResponse = z.infer<typeof orderListResponseSchema>;

/**
 * Mock-only affordance (POST /payments/mock/pay) used by tests + Part 2 to
 * drive a verified success/failure callback without a real gateway. Rejected
 * unless PAYMENT_GATEWAY=mock.
 */
export const mockPayRequestSchema = z.object({
  orderId: z.string().min(1),
  outcome: z.enum(["success", "failure"]),
});
export type MockPayRequest = z.infer<typeof mockPayRequestSchema>;

// ---------------------------------------------------------------------------
// Careers / placements (job postings + student applications)
//
// The source (Django `Job` + `JobApplication`) confirmed an application flow
// but specified no fields/statuses/eligibility. These schemas reuse the Step-1
// field set + the 5-state status enum; admin-only applicant contact never
// appears in a student projection.
// ---------------------------------------------------------------------------

export const postingTypeSchema = z.enum(
  POSTING_TYPE_VALUES as [PostingType, ...PostingType[]],
);
export const applicationStatusSchema = z.enum(
  JOB_APPLICATION_STATUS_VALUES as [
    JobApplicationStatus,
    ...JobApplicationStatus[],
  ],
);

/** A posting as the STUDENT sees it in the list (no internal fields). */
export const postingSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  company: z.string(),
  companyLogo: z.string(),
  location: z.string(),
  type: postingTypeSchema,
  /** Free-text compensation (e.g. "₹12 LPA", "₹25k/month"). */
  compensation: z.string(),
  /** ISO deadline, or null when the posting never closes. */
  deadline: z.string().datetime().nullable(),
  /** Server-computed: active AND not past deadline. */
  isOpen: z.boolean(),
  postedAt: z.string().datetime(),
});
export type PostingSummary = z.infer<typeof postingSummarySchema>;

/** Compact record of the caller's own application to a posting. */
export const myApplicationRefSchema = z.object({
  id: z.string(),
  status: applicationStatusSchema,
  appliedAt: z.string().datetime(),
});
export type MyApplicationRef = z.infer<typeof myApplicationRefSchema>;

/** STUDENT posting detail — adds description/requirements + the caller's own application. */
export const postingDetailSchema = postingSummarySchema.extend({
  description: z.string(),
  requirements: z.string(),
  /**
   * External application URL, or "" for in-app apply. Exposed on the student
   * detail (a public company link, not sensitive) so the UI can branch the
   * primary action between "Apply on company site" and the in-app form. Added
   * in Part 2 — a minimal, additive extension to the Part-1 read projection.
   */
  applyUrl: z.string(),
  myApplication: myApplicationRefSchema.nullable(),
});
export type PostingDetail = z.infer<typeof postingDetailSchema>;

export const postingListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .positive()
    .max(CAREERS_MAX_PAGE_SIZE)
    .default(CAREERS_DEFAULT_PAGE_SIZE),
  type: postingTypeSchema.optional(),
  q: z.string().trim().max(100).optional(),
  /** Include postings that are closed / past deadline (default false). */
  includeClosed: z.enum(["true", "false"]).optional(),
});
export type PostingListQuery = z.infer<typeof postingListQuerySchema>;

export const postingListResponseSchema = z.object({
  items: z.array(postingSummarySchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});
export type PostingListResponse = z.infer<typeof postingListResponseSchema>;

/** Apply to a posting (POST /careers/:id/apply). Applicant snapshot. */
export const applyRequestSchema = z.object({
  fullName: z.string().trim().min(1).max(150),
  email: z.string().email().toLowerCase(),
  phone: z.string().trim().max(20).optional(),
  resumeUrl: z.string().url().max(500).optional().or(z.literal("")),
  coverLetter: z.string().trim().max(5000).optional(),
});
export type ApplyRequest = z.infer<typeof applyRequestSchema>;

export const applicationResponseSchema = z.object({
  id: z.string(),
  postingId: z.string(),
  status: applicationStatusSchema,
  appliedAt: z.string().datetime(),
});
export type ApplicationResponse = z.infer<typeof applicationResponseSchema>;

/** One row of the student's "my applications" list. */
export const myApplicationSchema = z.object({
  id: z.string(),
  status: applicationStatusSchema,
  appliedAt: z.string().datetime(),
  posting: postingSummarySchema,
});
export type MyApplication = z.infer<typeof myApplicationSchema>;

export const myApplicationsResponseSchema = z.object({
  items: z.array(myApplicationSchema),
});
export type MyApplicationsResponse = z.infer<
  typeof myApplicationsResponseSchema
>;

// --- Admin projections ---

/** Create/update a posting (admin). `deadline` null clears it. */
export const adminPostingUpsertSchema = z.object({
  title: z.string().trim().min(1).max(200),
  company: z.string().trim().min(1).max(150),
  companyLogo: z.string().url().max(500).optional().or(z.literal("")),
  location: z.string().trim().max(150).optional(),
  type: postingTypeSchema,
  compensation: z.string().trim().max(100).optional(),
  description: z.string().max(10_000).optional(),
  requirements: z.string().max(10_000).optional(),
  applyUrl: z.string().url().max(500).optional().or(z.literal("")),
  deadline: z.string().datetime().nullable().optional(),
  isActive: z.boolean().optional(),
});
export type AdminPostingUpsert = z.infer<typeof adminPostingUpsertSchema>;

/** Admin posting projection — includes internal flags + application count. */
export const adminPostingSchema = postingSummarySchema.extend({
  description: z.string(),
  requirements: z.string(),
  applyUrl: z.string(),
  isActive: z.boolean(),
  applicationCount: z.number().int().nonnegative(),
});
export type AdminPosting = z.infer<typeof adminPostingSchema>;

export const adminPostingListResponseSchema = z.object({
  items: z.array(adminPostingSchema),
});
export type AdminPostingListResponse = z.infer<
  typeof adminPostingListResponseSchema
>;

/** An application row as the ADMIN sees it — full applicant contact. */
export const adminApplicationRowSchema = z.object({
  id: z.string(),
  status: applicationStatusSchema,
  appliedAt: z.string().datetime(),
  userId: z.string().nullable(),
  fullName: z.string(),
  email: z.string(),
  phone: z.string(),
  resumeUrl: z.string(),
  coverLetter: z.string(),
});
export type AdminApplicationRow = z.infer<typeof adminApplicationRowSchema>;

export const adminApplicationListResponseSchema = z.object({
  postingId: z.string(),
  postingTitle: z.string(),
  items: z.array(adminApplicationRowSchema),
});
export type AdminApplicationListResponse = z.infer<
  typeof adminApplicationListResponseSchema
>;

export const updateApplicationStatusRequestSchema = z.object({
  status: applicationStatusSchema,
});
export type UpdateApplicationStatusRequest = z.infer<
  typeof updateApplicationStatusRequestSchema
>;

// ---------------------------------------------------------------------------
// Multi-tenant colleges (Phase 0 foundation)
//
// Super-admin provisions colleges and controls their entitlements; college
// users operate a tenant-isolated space. These are the request/response shapes
// for provisioning + the resolved tenant context. See
// docs/MULTI_TENANT_ARCHITECTURE.md for the authoritative design.
// ---------------------------------------------------------------------------

export const userTypeSchema = z.enum(
  USER_TYPE_VALUES as [UserType, ...UserType[]],
);
export const collegeStatusSchema = z.enum(
  COLLEGE_STATUS_VALUES as [CollegeStatus, ...CollegeStatus[]],
);
export const collegeFeatureSchema = z.enum(
  COLLEGE_FEATURE_VALUES as [CollegeFeature, ...CollegeFeature[]],
);

/** The plain entitlement shape carried on a college + the tenant context. */
export const entitlementsSchema = z.object({
  /** One flag per FEATURE (may be partial; absent/false = OFF). */
  features: z.record(collegeFeatureSchema, z.boolean()),
  /** Flat map keyed `${feature}.${subCapability}` → enabled. */
  subCapabilities: z.record(z.string(), z.boolean()),
  /** Granted master-catalog course (Subject) ids. */
  grantedCourses: z.array(z.string()),
});
export type Entitlements = z.infer<typeof entitlementsSchema>;

/** Slug: lowercase URL segment for /c/:slug — stable tenant key. */
const collegeSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(64)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug may contain only lowercase letters, numbers and single hyphens",
  );

/** Provision a college (super_admin). Entitlements start empty (nothing granted). */
export const createCollegeSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: collegeSlugSchema,
  contactEmail: z.string().email().max(200).optional().or(z.literal("")),
  contactPhone: z.string().trim().max(30).optional(),
  status: collegeStatusSchema.optional(),
});
export type CreateCollegeInput = z.infer<typeof createCollegeSchema>;

/** Update a college's mutable fields (slug is immutable — it is the URL key). */
/**
 * Per-college LOGIN branding — the public skin of /c/:slug/login. All optional;
 * empty falls back cleanly (displayName → college name, no logo → wordmark).
 * `brandColor` is a CSS color the page uses as an accent.
 */
export const collegeBrandingUpdateSchema = z.object({
  logoUrl: z.string().trim().max(500).optional(),
  displayName: z.string().trim().max(120).optional(),
  welcomeText: z.string().trim().max(300).optional(),
  brandColor: z.string().trim().max(32).optional(),
});
export type CollegeBrandingUpdate = z.infer<typeof collegeBrandingUpdateSchema>;

/** Stored/DTO branding shape (strings, possibly empty). */
export const collegeBrandingFieldsSchema = z.object({
  logoUrl: z.string(),
  displayName: z.string(),
  welcomeText: z.string(),
  brandColor: z.string(),
});
export type CollegeBrandingFields = z.infer<typeof collegeBrandingFieldsSchema>;

export const updateCollegeSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    contactEmail: z.string().email().max(200).optional().or(z.literal("")),
    contactPhone: z.string().trim().max(30).optional(),
    status: collegeStatusSchema.optional(),
    branding: collegeBrandingUpdateSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });
export type UpdateCollegeInput = z.infer<typeof updateCollegeSchema>;

/**
 * PUBLIC (pre-auth) branding for a college's login page — exposes ONLY brand
 * fields (never members, entitlements, or contacts). `displayName` is already
 * resolved to the college name when no custom name is set.
 */
export const collegeBrandingSchema = z.object({
  slug: z.string(),
  displayName: z.string(),
  logoUrl: z.string(),
  welcomeText: z.string(),
  brandColor: z.string(),
});
export type CollegeBranding = z.infer<typeof collegeBrandingSchema>;

/**
 * Toggle any subset of feature / sub-capability entitlements (add or remove,
 * anytime). Keys are validated against the catalog server-side. At least one
 * of `features` / `subCapabilities` must be present.
 */
export const setEntitlementsSchema = z
  .object({
    features: z.record(collegeFeatureSchema, z.boolean()).optional(),
    subCapabilities: z.record(z.string(), z.boolean()).optional(),
  })
  .refine((v) => v.features !== undefined || v.subCapabilities !== undefined, {
    message: "Provide features and/or subCapabilities to change",
  });
export type SetEntitlementsInput = z.infer<typeof setEntitlementsSchema>;

/** Grant/revoke master-catalog courses (Subject ids) to/from a college. */
export const grantCoursesSchema = z.object({
  courseIds: z.array(z.string().min(1)).min(1),
});
export type GrantCoursesInput = z.infer<typeof grantCoursesSchema>;

/** Full college projection (super_admin views). */
export const aiCreditTierSchema = z.enum(
  AI_CREDIT_TIER_VALUES as [AiCreditTier, ...AiCreditTier[]],
);

/** Per-college AI credit CONFIG stored on the college (not the live balance). */
export const collegeCreditsSchema = z.object({
  tier: aiCreditTierSchema,
  /** Explicit monthly credits that override the tier formula; null = use tier. */
  monthlyOverride: z.number().int().nonnegative().nullable(),
  /**
   * OPT-IN per-student credit distribution. Default false → student AI draws the
   * college pool as before (unchanged). When true, the college_admin allocates
   * the pool to specific students and student-initiated AI is metered against
   * each student's own allocation (no allocation → no AI).
   */
  perStudentDistribution: z.boolean().default(false),
});
export type CollegeCredits = z.infer<typeof collegeCreditsSchema>;

export const collegeSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: collegeStatusSchema,
  contactEmail: z.string(),
  contactPhone: z.string(),
  createdBy: z.string().nullable(),
  entitlements: entitlementsSchema,
  branding: collegeBrandingFieldsSchema,
  credits: collegeCreditsSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type College = z.infer<typeof collegeSchema>;

/** Super-admin: set a college's AI credit tier / explicit override / reset period. */
export const setCollegeCreditsSchema = z
  .object({
    tier: aiCreditTierSchema.optional(),
    /** Explicit monthly credits (null clears the override → use the tier). */
    monthlyOverride: z.number().int().nonnegative().nullable().optional(),
    /** Zero this period's consumption (adjust/reset). */
    reset: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });
export type SetCollegeCreditsInput = z.infer<typeof setCollegeCreditsSchema>;

/** Live AI-credit balance for a college's CURRENT monthly period. */
export const aiCreditBalanceSchema = z.object({
  collegeId: z.string(),
  tier: aiCreditTierSchema,
  monthlyOverride: z.number().int().nonnegative().nullable(),
  studentCount: z.number().int().nonnegative(),
  periodKey: z.string(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  allocated: z.number().int().nonnegative(),
  consumed: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  /** Consumption broken down by AI feature this period. */
  byFeature: z.record(z.string(), z.number()),
});
export type AiCreditBalance = z.infer<typeof aiCreditBalanceSchema>;

// ---------------------------------------------------------------------------
// PER-STUDENT AI CREDIT DISTRIBUTION — the college_admin carves the pool into
// per-student allocations; students spend only their own. Layers UNDER Stage-1
// (pool source) + Stage-2 (governor). Read-only over stored ledgers.
// ---------------------------------------------------------------------------

/** One student's own AI-credit allocation this period (student + admin views). */
export const studentAiCreditRowSchema = z.object({
  studentId: z.string(),
  fullName: z.string(),
  rollNumber: z.string(),
  orgUnitId: z.string().nullable(),
  allocated: z.number().int().nonnegative(),
  consumed: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
});
export type StudentAiCreditRow = z.infer<typeof studentAiCreditRowSchema>;

/** Admin distribution view: pool math + per-student allocations this period. */
export const aiCreditDistributionResponseSchema = z.object({
  /** Whether per-student distribution is enabled for this college. */
  enabled: z.boolean(),
  periodKey: z.string(),
  /** The college pool cap this period (Stage-1 `allocated`). */
  poolAllocated: z.number().int().nonnegative(),
  /** Σ of all students' allocations this period. */
  allocatedToStudents: z.number().int().nonnegative(),
  /** poolAllocated − allocatedToStudents (never negative). */
  distributable: z.number().int().nonnegative(),
  /** Σ of all students' consumption this period. */
  consumedByStudents: z.number().int().nonnegative(),
  /** Students who currently hold an allocation (allocated > 0). */
  students: z.array(studentAiCreditRowSchema),
});
export type AiCreditDistributionResponse = z.infer<
  typeof aiCreditDistributionResponseSchema
>;

/**
 * Allocate (SET) an amount to a set of students, chosen by org-unit subtree /
 * individual ids / Excel-matched roll numbers (reusing the attendance selection).
 * SET-semantics: each selected student's allocation becomes `amount` (not added);
 * amount 0 clears it. Rejected if Σ would exceed the pool.
 */
export const allocateStudentCreditsSchema = z
  .object({
    orgUnitIds: z.array(z.string().min(1)).max(500).optional(),
    studentIds: z.array(z.string().min(1)).max(5000).optional(),
    excelRollNumbers: z.array(z.string().min(1)).max(5000).optional(),
    amount: z.number().int().min(0).max(1_000_000),
  })
  .refine(
    (v) =>
      (v.orgUnitIds?.length ?? 0) +
        (v.studentIds?.length ?? 0) +
        (v.excelRollNumbers?.length ?? 0) >
      0,
    { message: "Select at least one student (org-unit, individual, or roll number)" },
  );
export type AllocateStudentCreditsInput = z.infer<
  typeof allocateStudentCreditsSchema
>;

/** Toggle per-student distribution mode for a college (college_admin). */
export const setStudentDistributionSchema = z.object({ enabled: z.boolean() });
export type SetStudentDistributionInput = z.infer<
  typeof setStudentDistributionSchema
>;

/** A student's OWN AI-credit balance (own-data-only student view). */
export const studentOwnAiCreditSchema = z.object({
  /** Whether the college runs per-student distribution (else pool-managed). */
  enabled: z.boolean(),
  periodKey: z.string(),
  /** Null when the college has never allocated to this student this period. */
  allocated: z.number().int().nonnegative().nullable(),
  consumed: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
});
export type StudentOwnAiCredit = z.infer<typeof studentOwnAiCreditSchema>;

// ---------------------------------------------------------------------------
// AI GOVERNOR (Stage-2) — the global free-tier pool governor config + status.
// Super-admin tunable; percentages of the combined daily provider pool.
// ---------------------------------------------------------------------------

const percentSchema = z.number().int().min(0).max(100);

/** Governor tuning (the single-doc settings the super-admin edits). */
export const aiGovernorConfigSchema = z.object({
  enabled: z.boolean(),
  reservePercent: percentSchema,
  platformReservePercent: percentSchema,
  shedThreshold: percentSchema,
});
export type AiGovernorConfig = z.infer<typeof aiGovernorConfigSchema>;

/** Super-admin partial update of the governor config (at least one field). */
export const setAiGovernorConfigSchema = aiGovernorConfigSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  })
  .refine(
    (v) =>
      v.platformReservePercent === undefined ||
      v.reservePercent === undefined ||
      v.platformReservePercent <= v.reservePercent,
    { message: "platformReservePercent must be ≤ reservePercent" },
  );
export type SetAiGovernorConfigInput = z.infer<typeof setAiGovernorConfigSchema>;

/** Live combined-pool headroom (real counters) shown on the governor panel. */
export const aiGovernorHeadroomSchema = z.object({
  dayFraction: z.number(),
  minuteFraction: z.number(),
  anyCapacity: z.boolean(),
  combinedDayRemaining: z.number(),
  combinedDayLimit: z.number(),
  providersWithLimits: z.number().int().nonnegative(),
});
export type AiGovernorHeadroom = z.infer<typeof aiGovernorHeadroomSchema>;

/** Governor config + live status (headroom, shedding state, paced-queue depth). */
export const aiGovernorViewSchema = z.object({
  config: aiGovernorConfigSchema,
  headroom: aiGovernorHeadroomSchema,
  /** True when deferrable college AI would currently be shed/paced. */
  sheddingActive: z.boolean(),
  /** Non-urgent AI jobs waiting in the paced queue (waiting + delayed). */
  pacedQueueDepth: z.number().int().nonnegative(),
  /** The paced worker's per-minute drain rate (read-only; set on the worker). */
  pacedMaxPerMinute: z.number().int().nonnegative(),
  /** How many enabled+keyed providers the pool is measured across. */
  providerCount: z.number().int().nonnegative(),
});
export type AiGovernorView = z.infer<typeof aiGovernorViewSchema>;

/**
 * BullMQ payload for a governor-DEFERRED (paced) AI call. Carries the exact
 * request so the paced worker can run it later (within minute-limits) and warm
 * the response cache; the original caller retries and gets a cache hit. `policy`
 * is a loose passthrough of the task policy (validated leniently — the worker
 * re-applies Stage-1 metering + the router's own gate).
 */
export const pacedAiJobSchema = z.object({
  system: z.string(),
  user: z.string(),
  policy: z.record(z.string(), z.unknown()).optional(),
});
export type PacedAiJob = z.infer<typeof pacedAiJobSchema>;

// ---------------------------------------------------------------------------
// Coding profiles (Prompt 1) — student handles + stored per-platform stats.
// ---------------------------------------------------------------------------

/**
 * BullMQ payload for a per-STUDENT coding-profile refresh (rate-limited
 * `coding-refresh` queue). Carries only the identity — the worker loads the
 * current handles from the stored profile so a handle edit mid-flight is always
 * respected. Enqueued by the daily sweep (fan-out) + the manual "refresh now".
 */
export const codingRefreshStudentJobSchema = z.object({
  collegeId: z.string(),
  userId: z.string(),
});
export type CodingRefreshStudentJob = z.infer<typeof codingRefreshStudentJobSchema>;

/** A handle is a short opaque platform username; blank string = "not linked". */
const codingHandleSchema = z.string().trim().max(100);

/**
 * Set/update the calling student's handles. Any field OMITTED is left unchanged;
 * an empty string CLEARS that platform's handle (and its stored stats). Trusting
 * the entered handle — no ownership verification in v1 (a wrong handle simply
 * fetches to `not_found`, flagged, never crashes).
 */
export const setCodingHandlesSchema = z
  .object({
    codeforces: codingHandleSchema.optional(),
    leetcode: codingHandleSchema.optional(),
    codechef: codingHandleSchema.optional(),
  })
  .strict();
export type SetCodingHandlesInput = z.infer<typeof setCodingHandlesSchema>;

export const codingPlatformSchema = z.enum(
  CODING_PLATFORM_VALUES as [CodingPlatform, ...CodingPlatform[]],
);
export const codingFetchStatusSchema = z.enum(
  CODING_FETCH_STATUS_VALUES as [CodingFetchStatus, ...CodingFetchStatus[]],
);

/** One platform's stored, normalized stats (client-facing; `raw` is NOT sent). */
export const codingPlatformStatSchema = z.object({
  platform: codingPlatformSchema,
  handle: z.string(),
  rating: z.number().nullable(),
  maxRating: z.number().nullable(),
  problemsSolved: z.number().nullable(),
  rank: z.string().nullable(),
  status: codingFetchStatusSchema,
  lastFetchedAt: z.string().datetime().nullable(),
});
export type CodingPlatformStat = z.infer<typeof codingPlatformStatSchema>;

export const codingHandlesSchema = z.object({
  codeforces: z.string().nullable(),
  leetcode: z.string().nullable(),
  codechef: z.string().nullable(),
});
export type CodingHandles = z.infer<typeof codingHandlesSchema>;

/** The calling student's own coding profile (handles + per-platform stats). */
export const codingProfileResponseSchema = z.object({
  handles: codingHandlesSchema,
  stats: z.array(codingPlatformStatSchema),
  /** True once a refresh has been requested/queued and is not yet reflected. */
  refreshQueued: z.boolean(),
  updatedAt: z.string().datetime().nullable(),
});
export type CodingProfileResponse = z.infer<typeof codingProfileResponseSchema>;

// ---------------------------------------------------------------------------
// Coding leaderboard (Prompt 2) — admin ranking over the stored stats above.
// Read-only; no live fetching. Ranked strictly over real `ok` stats; na/stale
// students are surfaced honestly (unranked, never a fabricated rank).
// ---------------------------------------------------------------------------

export const codingMetricSchema = z.enum(
  CODING_METRIC_VALUES as [CodingMetric, ...CodingMetric[]],
);

/** Filters/params for the leaderboard read (coerced from the query string). */
export const codingLeaderboardQuerySchema = z.object({
  platform: codingPlatformSchema.default("codeforces"),
  metric: codingMetricSchema.default("rating"),
  /** Restrict to an org-unit subtree (branch/section/year); scope-checked. */
  unitId: z.string().min(1).optional(),
  /** Restrict to an attendance group's members. */
  groupId: z.string().min(1).optional(),
});
export type CodingLeaderboardQuery = z.infer<typeof codingLeaderboardQuerySchema>;

/** One leaderboard row — a linked student with per-platform stats + rank. */
export const codingLeaderboardRowSchema = z.object({
  /** 1-based rank on the chosen platform+metric; null = not ranked (na/stale). */
  rank: z.number().int().positive().nullable(),
  studentId: z.string(),
  fullName: z.string(),
  rollNumber: z.string(),
  orgUnitId: z.string().nullable(),
  orgUnitName: z.string().nullable(),
  /** The ranked metric's value on the chosen platform (null when unranked). */
  metricValue: z.number().nullable(),
  /** Status + freshness of the CHOSEN platform's stat (honest na/stale signal). */
  rankedStatus: codingFetchStatusSchema,
  rankedLastFetchedAt: z.string().datetime().nullable(),
  /** Per-platform quick stats (reuses the Prompt-1 stat shape). */
  stats: z.array(codingPlatformStatSchema),
});
export type CodingLeaderboardRow = z.infer<typeof codingLeaderboardRowSchema>;

export const codingLeaderboardOverviewSchema = z.object({
  platform: codingPlatformSchema,
  metric: codingMetricSchema,
  /** Students in the filtered population (scope + org-unit/group filters). */
  totalStudents: z.number().int().nonnegative(),
  /** Of those, how many have at least one linked handle (are shown as rows). */
  linked: z.number().int().nonnegative(),
  /** Of the linked, how many are ranked for the chosen platform+metric. */
  ranked: z.number().int().nonnegative(),
  /** Linked but not ranked for this platform (na/stale) — shown, not faked. */
  unranked: z.number().int().nonnegative(),
  /** Freshness range of the ranked stats (earliest/latest lastFetchedAt). */
  lastRefreshedFrom: z.string().datetime().nullable(),
  lastRefreshedTo: z.string().datetime().nullable(),
});
export type CodingLeaderboardOverview = z.infer<
  typeof codingLeaderboardOverviewSchema
>;

export const codingLeaderboardResponseSchema = z.object({
  overview: codingLeaderboardOverviewSchema,
  /** Ranked rows first (rank 1..n), then unranked (rank null), name-sorted. */
  rows: z.array(codingLeaderboardRowSchema),
});
export type CodingLeaderboardResponse = z.infer<
  typeof codingLeaderboardResponseSchema
>;

export const collegeListResponseSchema = z.object({
  items: z.array(collegeSchema),
});
export type CollegeListResponse = z.infer<typeof collegeListResponseSchema>;

/**
 * College administrators — provisioned by a super_admin from the console. A
 * college_admin is a User (role=college_admin, userType=college, college=<this>,
 * forcePasswordChange). Lets the platform designate who runs a college's
 * workspace without hand-editing DB fields.
 */
export const collegeAdminSchema = z.object({
  id: z.string(),
  username: z.string(),
  email: z.string(),
  fullName: z.string(),
  role: roleSchema,
  isActive: z.boolean(),
  forcePasswordChange: z.boolean(),
  createdAt: z.string().datetime(),
});
export type CollegeAdmin = z.infer<typeof collegeAdminSchema>;

export const collegeAdminListResponseSchema = z.object({
  items: z.array(collegeAdminSchema),
});
export type CollegeAdminListResponse = z.infer<
  typeof collegeAdminListResponseSchema
>;

export const createCollegeAdminSchema = z.object({
  fullName: z.string().trim().min(1).max(150),
  username: usernameSchema,
  email: z.string().email().toLowerCase(),
  /** Initial password; the account is created with forcePasswordChange. */
  password: passwordSchema,
});
export type CreateCollegeAdminInput = z.infer<typeof createCollegeAdminSchema>;

/**
 * Resolved tenant context (GET /api/c/:collegeSlug/context) — what the client
 * bootstraps a college session from: the college identity, the caller's
 * membership, and the entitlements that gate the UI.
 */
export const collegeContextResponseSchema = z.object({
  college: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    status: collegeStatusSchema,
  }),
  membership: z.object({
    role: roleSchema,
    userType: userTypeSchema,
  }),
  entitlements: entitlementsSchema,
});
export type CollegeContextResponse = z.infer<
  typeof collegeContextResponseSchema
>;

/**
 * The caller's OWN college membership (GET /api/me/college) — how a college user
 * discovers which /c/:slug space to enter. `college` is null for individual
 * (B2C) users and platform admins with no college of their own. This is the
 * minimal spine read the web uses to route + show the college nav; the richer
 * per-college context (entitlements) comes from GET /c/:slug/context.
 */
export const myCollegeResponseSchema = z.object({
  college: z
    .object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      status: collegeStatusSchema,
    })
    .nullable(),
});
export type MyCollegeResponse = z.infer<typeof myCollegeResponseSchema>;

/**
 * College STUDENT home summary (GET /c/:slug/student/summary) — the overview
 * counts behind the student dashboard cards. Every number is a REAL, tenant- and
 * cohort-scoped count derived from the existing student-facing services (assigned
 * college courses; published exams / essays targeting the student's org-unit;
 * open postings). A count is 0 when the college isn't entitled to that feature
 * (the dashboard simply omits that card). Read-only; no cross-tenant data.
 */
export const collegeStudentSummaryResponseSchema = z.object({
  courses: z.number().int().nonnegative(),
  exams: z.number().int().nonnegative(),
  essays: z.number().int().nonnegative(),
  postings: z.number().int().nonnegative(),
});
export type CollegeStudentSummaryResponse = z.infer<
  typeof collegeStudentSummaryResponseSchema
>;

/** A granted master-catalog course as surfaced to a college. */
export const grantedCourseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
});
export const grantedCoursesResponseSchema = z.object({
  items: z.array(grantedCourseSchema),
});
export type GrantedCoursesResponse = z.infer<
  typeof grantedCoursesResponseSchema
>;

// ---------------------------------------------------------------------------
// Org structure (OrgUnit tree) + faculty — Phase 2 (tenant-scoped).
// See docs/MULTI_TENANT_ARCHITECTURE.md §2.
// ---------------------------------------------------------------------------

export const orgUnitTypeSchema = z.enum(
  ORG_UNIT_TYPE_VALUES as [OrgUnitType, ...OrgUnitType[]],
);

/** An org-unit as returned to the client. */
export const orgUnitSchema = z.object({
  id: z.string(),
  type: orgUnitTypeSchema,
  name: z.string(),
  /** null = root-level unit. */
  parentId: z.string().nullable(),
  order: z.number(),
});
export type OrgUnit = z.infer<typeof orgUnitSchema>;

/** A node in the org tree (an OrgUnit plus its nested children). */
export interface OrgUnitTreeNode extends OrgUnit {
  children: OrgUnitTreeNode[];
}
export const orgUnitTreeNodeSchema: z.ZodType<OrgUnitTreeNode> = z.lazy(() =>
  orgUnitSchema.extend({ children: z.array(orgUnitTreeNodeSchema) }),
);
export const orgUnitTreeResponseSchema = z.object({
  items: z.array(orgUnitTreeNodeSchema),
});
export type OrgUnitTreeResponse = z.infer<typeof orgUnitTreeResponseSchema>;

export const createOrgUnitSchema = z.object({
  type: orgUnitTypeSchema,
  name: z.string().trim().min(1).max(120),
  /** null / omitted = create at root. */
  parentId: z.string().min(1).nullable().optional(),
  order: z.number().int().optional(),
});
export type CreateOrgUnitInput = z.infer<typeof createOrgUnitSchema>;

export const updateOrgUnitSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    /** Pass null to move to root; a string to re-parent. */
    parentId: z.string().min(1).nullable().optional(),
    order: z.number().int().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });
export type UpdateOrgUnitInput = z.infer<typeof updateOrgUnitSchema>;

/** Paste-to-create: one parent + type + many sibling names → many units. */
export const bulkCreateOrgUnitsSchema = z.object({
  type: orgUnitTypeSchema,
  parentId: z.string().min(1).nullable().optional(),
  names: z.array(z.string().trim().min(1).max(120)).min(1).max(200),
});
export type BulkCreateOrgUnitsInput = z.infer<typeof bulkCreateOrgUnitsSchema>;

export const bulkCreateOrgUnitsResponseSchema = z.object({
  created: z.array(orgUnitSchema),
  /** Sibling names skipped because they already existed under the parent. */
  skipped: z.array(z.string()),
});
export type BulkCreateOrgUnitsResponse = z.infer<
  typeof bulkCreateOrgUnitsResponseSchema
>;

// --- Faculty ---

/** A faculty member as returned to the college admin. */
export const facultySchema = z.object({
  id: z.string(),
  username: z.string(),
  email: z.string(),
  fullName: z.string(),
  role: roleSchema,
  isActive: z.boolean(),
  /** They must set their own password on first login. */
  forcePasswordChange: z.boolean(),
  /** Assigned org-unit ids (all within this college). */
  orgUnitIds: z.array(z.string()),
  createdAt: z.string().datetime(),
});
export type Faculty = z.infer<typeof facultySchema>;
export const facultyListResponseSchema = z.object({
  items: z.array(facultySchema),
});
export type FacultyListResponse = z.infer<typeof facultyListResponseSchema>;

export const createFacultySchema = z.object({
  fullName: z.string().trim().min(1).max(150),
  username: usernameSchema,
  email: z.string().email().toLowerCase(),
  /** Initial password; the account is created with forcePasswordChange. */
  password: passwordSchema,
  orgUnitIds: z.array(z.string().min(1)).default([]),
});
export type CreateFacultyInput = z.infer<typeof createFacultySchema>;

export const updateFacultySchema = z
  .object({
    /** Replaces the full assigned-scope set. */
    orgUnitIds: z.array(z.string().min(1)).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.orgUnitIds !== undefined || v.isActive !== undefined, {
    message: "Provide orgUnitIds and/or isActive to change",
  });
export type UpdateFacultyInput = z.infer<typeof updateFacultySchema>;

// ---------------------------------------------------------------------------
// College students + bulk import — Phase 3 (tenant-scoped, faculty-scoped).
// A college student is a User (role=student, userType=college, college=<tenant>,
// orgUnit=<assigned unit>, rollNumber per-college-unique). A separate population
// from individual (B2C) students, which are untouched.
// See docs/MULTI_TENANT_ARCHITECTURE.md §2.
// ---------------------------------------------------------------------------

/** A college student as returned to the college admin / faculty. */
export const collegeStudentSchema = z.object({
  id: z.string(),
  username: z.string(),
  email: z.string(),
  fullName: z.string(),
  /** The student's roll number (unique within the college). */
  rollNumber: z.string(),
  role: roleSchema,
  isActive: z.boolean(),
  /** They must set their own password on first login. */
  forcePasswordChange: z.boolean(),
  /** The assigned org-unit id (always within this college). */
  orgUnitId: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type CollegeStudent = z.infer<typeof collegeStudentSchema>;

export const collegeStudentListResponseSchema = z.object({
  items: z.array(collegeStudentSchema),
  total: z.number(),
});
export type CollegeStudentListResponse = z.infer<
  typeof collegeStudentListResponseSchema
>;

/** Optional filters for the student list. */
export const collegeStudentListQuerySchema = z.object({
  /** Restrict to one org-unit (must be in the actor's scope). */
  orgUnitId: z.string().min(1).optional(),
});
export type CollegeStudentListQuery = z.infer<
  typeof collegeStudentListQuerySchema
>;

/** Single-add a college student (college_admin, or faculty within scope). */
export const createCollegeStudentSchema = z.object({
  fullName: z.string().trim().min(1).max(150),
  email: z.string().email().toLowerCase(),
  rollNumber: z.string().trim().min(1).max(64),
  /** The org-unit to assign (validated in tenant + in the actor's scope). */
  orgUnitId: z.string().min(1),
});
export type CreateCollegeStudentInput = z.infer<
  typeof createCollegeStudentSchema
>;

/**
 * Edit a college student's details (college_admin, or faculty within scope).
 * Every field is optional; at least one must be provided. `email` is also the
 * login handle, so changing it re-checks global uniqueness and revokes sessions.
 */
export const updateCollegeStudentSchema = z
  .object({
    fullName: z.string().trim().min(1).max(150).optional(),
    email: z.string().email().toLowerCase().optional(),
    rollNumber: z.string().trim().min(1).max(64).optional(),
    /** Reassign to another org-unit (validated in tenant + in the actor's scope). */
    orgUnitId: z.string().min(1).optional(),
    /** Reactivate (true) or deactivate (false); deactivating revokes sessions. */
    isActive: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.fullName !== undefined ||
      v.email !== undefined ||
      v.rollNumber !== undefined ||
      v.orgUnitId !== undefined ||
      v.isActive !== undefined,
    { message: "Provide at least one field to change" },
  );
export type UpdateCollegeStudentInput = z.infer<
  typeof updateCollegeStudentSchema
>;

// --- Import pipeline (parse-agnostic: rows in) ---

/** One raw import row (produced by the UI from a file OR a pasted table). */
export const studentImportRowSchema = z.object({
  fullName: z.string(),
  email: z.string(),
  rollNumber: z.string(),
  /** Org-unit path ("CSE / 2026 / A") or a unique bare name. */
  orgUnit: z.string(),
});

export const studentImportRequestSchema = z.object({
  rows: z.array(studentImportRowSchema).min(1).max(1000),
});
export type StudentImportRequest = z.infer<typeof studentImportRequestSchema>;

/** Per-row verdict from preview (and the classification commit reuses). */
export const studentImportRowVerdictSchema = z.object({
  index: z.number(),
  fullName: z.string(),
  email: z.string(),
  rollNumber: z.string(),
  orgUnit: z.string(),
  /** "ok" = will be created; "error" = blocked (see `errors`). */
  status: z.enum(["ok", "error"]),
  errors: z.array(z.string()),
  /** Resolved org-unit id when the reference matched a scoped unit. */
  orgUnitId: z.string().nullable(),
});
export type StudentImportRowVerdict = z.infer<
  typeof studentImportRowVerdictSchema
>;

export const studentImportPreviewResponseSchema = z.object({
  rows: z.array(studentImportRowVerdictSchema),
  summary: z.object({
    total: z.number(),
    ok: z.number(),
    errors: z.number(),
  }),
});
export type StudentImportPreviewResponse = z.infer<
  typeof studentImportPreviewResponseSchema
>;

/** A row not created at commit (with the reason it was skipped/failed). */
export const studentImportOutcomeRowSchema = z.object({
  index: z.number(),
  rollNumber: z.string(),
  reason: z.string(),
});

export const studentImportCommitResponseSchema = z.object({
  created: z.array(collegeStudentSchema),
  /** Rows not created because they were invalid or duplicate (idempotent-ish). */
  skipped: z.array(studentImportOutcomeRowSchema),
  /** Rows that errored unexpectedly during creation. */
  failed: z.array(studentImportOutcomeRowSchema),
  summary: z.object({
    created: z.number(),
    skipped: z.number(),
    failed: z.number(),
  }),
});
export type StudentImportCommitResponse = z.infer<
  typeof studentImportCommitResponseSchema
>;

// ---------------------------------------------------------------------------
// College courses — Phase 4a (assign super-admin-GRANTED courses to students).
// Reuses the existing course/enrollment engine, tenant-scoped + feature-gated.
// ---------------------------------------------------------------------------

/** A course granted to the college, with its current assignment count. */
export const collegeCourseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  image: z.string(),
  /** How many of this college's students are currently assigned this course. */
  assignedCount: z.number(),
});
export type CollegeCourse = z.infer<typeof collegeCourseSchema>;

export const collegeCourseListResponseSchema = z.object({
  items: z.array(collegeCourseSchema),
});
export type CollegeCourseListResponse = z.infer<
  typeof collegeCourseListResponseSchema
>;

/** Assign/revoke a granted course to/from a set of the college's students. */
export const courseAssignmentRequestSchema = z.object({
  studentIds: z.array(z.string().min(1)).min(1).max(1000),
});
export type CourseAssignmentRequest = z.infer<
  typeof courseAssignmentRequestSchema
>;

export const courseAssignResponseSchema = z.object({
  /** Newly-assigned (created) enrollments. */
  assigned: z.number(),
  /** Already-assigned students (idempotent no-ops). */
  alreadyAssigned: z.number(),
  total: z.number(),
});
export type CourseAssignResponse = z.infer<typeof courseAssignResponseSchema>;

export const courseRevokeResponseSchema = z.object({
  revoked: z.number(),
  total: z.number(),
});
export type CourseRevokeResponse = z.infer<typeof courseRevokeResponseSchema>;

/** The college students currently assigned a given course. */
export const courseAssignedStudentsResponseSchema = z.object({
  items: z.array(collegeStudentSchema),
});
export type CourseAssignedStudentsResponse = z.infer<
  typeof courseAssignedStudentsResponseSchema
>;

// ---------------------------------------------------------------------------
// Attendance module (Prompt 1) — GROUP formation. A group is a named set of
// students (a recurring "class" or a one-off "event") assembled from any mix of
// org-units, sections, individuals, and an Excel roll-number upload, de-duped.
// Sessions + records (Prompt 2) reference a group id — not modeled here.
// ---------------------------------------------------------------------------

export const attendanceGroupKindSchema = z.enum(
  ATTENDANCE_GROUP_KIND_VALUES as [AttendanceGroupKind, ...AttendanceGroupKind[]],
);
export const attendanceMemberSourceSchema = z.enum(
  ATTENDANCE_MEMBER_SOURCE_VALUES as [
    AttendanceMemberSource,
    ...AttendanceMemberSource[],
  ],
);

/** One resolved member of a group, with the PROVENANCE of how they were added. */
export const attendanceMemberSchema = z.object({
  studentId: z.string(),
  fullName: z.string(),
  rollNumber: z.string(),
  orgUnitId: z.string().nullable(),
  source: attendanceMemberSourceSchema,
  /** The org-unit id when source is org_unit/section; null otherwise. */
  sourceRef: z.string().nullable(),
});
export type AttendanceMember = z.infer<typeof attendanceMemberSchema>;

/** A named faculty owner (who may take the group's attendance in Prompt 2). */
export const attendanceOwnerSchema = z.object({
  id: z.string(),
  fullName: z.string(),
});
export type AttendanceOwner = z.infer<typeof attendanceOwnerSchema>;

/** Group list item (no members — just the count). */
export const attendanceGroupSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  kind: attendanceGroupKindSchema,
  memberCount: z.number().int().nonnegative(),
  owners: z.array(attendanceOwnerSchema),
  createdBy: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AttendanceGroupSummary = z.infer<
  typeof attendanceGroupSummarySchema
>;

/** Full group detail (with the resolved membership + provenance). */
export const attendanceGroupSchema = attendanceGroupSummarySchema.extend({
  members: z.array(attendanceMemberSchema),
});
export type AttendanceGroup = z.infer<typeof attendanceGroupSchema>;

export const attendanceGroupListResponseSchema = z.object({
  items: z.array(attendanceGroupSummarySchema),
});
export type AttendanceGroupListResponse = z.infer<
  typeof attendanceGroupListResponseSchema
>;

/**
 * Membership sources for create / add-members. Any combination may be present;
 * the resolved membership is their de-duplicated UNION. `orgUnitIds` resolves to
 * every student under each unit (+ descendants); `studentIds` are explicit;
 * `excelRollNumbers` are matched against the college's students (unmatched are
 * ignored — they were surfaced in the preview).
 */
const attendanceMembershipInput = {
  orgUnitIds: z.array(z.string().min(1)).max(500).optional(),
  studentIds: z.array(z.string().min(1)).max(5000).optional(),
  excelRollNumbers: z.array(z.string().min(1)).max(5000).optional(),
};

export const createAttendanceGroupSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  kind: attendanceGroupKindSchema.default(AttendanceGroupKind.CLASS),
  /** Faculty user ids who may take this group's attendance (Prompt 2). */
  facultyOwnerIds: z.array(z.string().min(1)).max(50).optional(),
  ...attendanceMembershipInput,
});
export type CreateAttendanceGroupInput = z.infer<
  typeof createAttendanceGroupSchema
>;

/**
 * Update metadata and/or RE-RESOLVE membership. When any of the membership
 * fields is present, membership is fully re-resolved from them (replace); when
 * all are absent, membership is left untouched (metadata-only edit).
 */
export const updateAttendanceGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(2000).optional(),
    kind: attendanceGroupKindSchema.optional(),
    facultyOwnerIds: z.array(z.string().min(1)).max(50).optional(),
    ...attendanceMembershipInput,
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });
export type UpdateAttendanceGroupInput = z.infer<
  typeof updateAttendanceGroupSchema
>;

/** Add members to an existing group (union with the current membership). */
export const addAttendanceMembersSchema = z
  .object(attendanceMembershipInput)
  .refine(
    (v) =>
      (v.orgUnitIds?.length ?? 0) +
        (v.studentIds?.length ?? 0) +
        (v.excelRollNumbers?.length ?? 0) >
      0,
    { message: "Provide at least one org-unit, student, or roll number" },
  );
export type AddAttendanceMembersInput = z.infer<
  typeof addAttendanceMembersSchema
>;

/** Excel roll-number PREVIEW: upload a workbook, get matched/unmatched, NO persist. */
export const attendanceImportPreviewRequestSchema = excelUploadRequestSchema;
export type AttendanceImportPreviewRequest = z.infer<
  typeof attendanceImportPreviewRequestSchema
>;

export const attendanceMatchedRowSchema = z.object({
  studentId: z.string(),
  rollNumber: z.string(),
  fullName: z.string(),
  orgUnitId: z.string().nullable(),
});
export type AttendanceMatchedRow = z.infer<typeof attendanceMatchedRowSchema>;

export const attendanceImportPreviewResponseSchema = z.object({
  matched: z.array(attendanceMatchedRowSchema),
  /** Roll numbers from the file with no matching student in this college. */
  unmatched: z.array(z.string()),
  summary: z.object({
    total: z.number().int().nonnegative(),
    matched: z.number().int().nonnegative(),
    unmatched: z.number().int().nonnegative(),
  }),
});
export type AttendanceImportPreviewResponse = z.infer<
  typeof attendanceImportPreviewResponseSchema
>;

/** Whether faculty (not admins) may form CROSS-CUTTING / Excel groups. */
export const attendanceSettingsSchema = z.object({
  facultyCanFormCrossCuttingGroups: z.boolean(),
});
export type AttendanceSettings = z.infer<typeof attendanceSettingsSchema>;

export const setAttendanceSettingsSchema = attendanceSettingsSchema;
export type SetAttendanceSettingsInput = z.infer<
  typeof setAttendanceSettingsSchema
>;

// --- Attendance SESSIONS + records (Prompt 2) --------------------------------

export const attendanceSessionStatusSchema = z.enum(
  ATTENDANCE_SESSION_STATUS_VALUES as [
    AttendanceSessionStatus,
    ...AttendanceSessionStatus[],
  ],
);
export const attendanceRecordStatusSchema = z.enum(
  ATTENDANCE_RECORD_STATUS_VALUES as [
    AttendanceRecordStatus,
    ...AttendanceRecordStatus[],
  ],
);

/** A session (a dated/timed occurrence of a group) + its live mark tally. */
/**
 * An OPTIONAL photo attached to a session (for filing/audit). Uploaded via the
 * shared Cloudinary flow → we keep the returned URL. A session normally has none.
 */
export const attendancePhotoSchema = z.object({
  id: z.string(),
  url: z.string(),
  caption: z.string(),
  uploadedBy: z.string().nullable(),
  uploadedAt: z.string().datetime(),
});
export type AttendancePhoto = z.infer<typeof attendancePhotoSchema>;

export const attendanceSessionSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  title: z.string(),
  scheduledAt: z.string().datetime(),
  status: attendanceSessionStatusSchema,
  createdBy: z.string().nullable(),
  takenBy: z.string().nullable(),
  takenAt: z.string().datetime().nullable(),
  /** Roster size (current group members). */
  total: z.number().int().nonnegative(),
  presentCount: z.number().int().nonnegative(),
  absentCount: z.number().int().nonnegative(),
  /** True once attendance has been recorded (status completed / has records). */
  recorded: z.boolean(),
  /** Optional filing/audit photos (usually empty). */
  photos: z.array(attendancePhotoSchema),
});
export type AttendanceSession = z.infer<typeof attendanceSessionSchema>;

/** Attach one or more optional photos (already-uploaded Cloudinary URLs). */
export const addAttendancePhotosSchema = z.object({
  photos: z
    .array(
      z.object({
        url: z.string().url().max(2000),
        caption: z.string().trim().max(300).optional(),
      }),
    )
    .min(1)
    .max(20),
});
export type AddAttendancePhotosInput = z.infer<
  typeof addAttendancePhotosSchema
>;

export const attendanceSessionListResponseSchema = z.object({
  items: z.array(attendanceSessionSchema),
});
export type AttendanceSessionListResponse = z.infer<
  typeof attendanceSessionListResponseSchema
>;

/**
 * Create a session. `scheduledAt` present → a PRE-SCHEDULED session (status
 * scheduled). `scheduledAt` absent → an AD-HOC "take now" session (status open,
 * timestamped server-side). `title` is optional (defaults from the group).
 */
export const createAttendanceSessionSchema = z.object({
  title: z.string().trim().max(200).optional(),
  scheduledAt: z.string().datetime().optional(),
});
export type CreateAttendanceSessionInput = z.infer<
  typeof createAttendanceSessionSchema
>;

/** Reschedule / rename a session (both optional; at least one). */
export const updateAttendanceSessionSchema = z
  .object({
    title: z.string().trim().max(200).optional(),
    scheduledAt: z.string().datetime().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });
export type UpdateAttendanceSessionInput = z.infer<
  typeof updateAttendanceSessionSchema
>;

/** One roster line for a session: a member + their mark for THIS session. */
export const attendanceRosterEntrySchema = z.object({
  studentId: z.string(),
  fullName: z.string(),
  rollNumber: z.string(),
  orgUnitId: z.string().nullable(),
  /** The current mark; unmarked members default to `absent`. */
  status: attendanceRecordStatusSchema,
  /** True when a record already exists for this student in this session. */
  marked: z.boolean(),
});
export type AttendanceRosterEntry = z.infer<typeof attendanceRosterEntrySchema>;

export const attendanceRosterResponseSchema = z.object({
  session: attendanceSessionSchema,
  entries: z.array(attendanceRosterEntrySchema),
});
export type AttendanceRosterResponse = z.infer<
  typeof attendanceRosterResponseSchema
>;

/** One student's mark in a save payload. */
export const attendanceMarkSchema = z.object({
  studentId: z.string().min(1),
  status: attendanceRecordStatusSchema,
});
export type AttendanceMark = z.infer<typeof attendanceMarkSchema>;

/**
 * Save (mark) a session's attendance — the FINAL set of marks (the UI builds it
 * from "mark all present" + individual toggles). Upserts one record per student;
 * any current member not present in `marks` is recorded ABSENT; the session is
 * completed. Re-saving corrects prior marks.
 */
export const saveAttendanceSchema = z.object({
  marks: z.array(attendanceMarkSchema).max(10000),
});
export type SaveAttendanceInput = z.infer<typeof saveAttendanceSchema>;

// --- Attendance ANALYTICS + reports (Prompt 3) -------------------------------
// Read-only aggregation over COMPLETED sessions only (the fair denominator).
// `rate` is null = "no data" (no completed sessions), never a fabricated 0%.

/** Headline stats over the actor's visible groups. */
export const attendanceOverviewSchema = z.object({
  groups: z.number().int().nonnegative(),
  sessionsHeld: z.number().int().nonnegative(),
  /** Total marks recorded across completed sessions (the rate denominator). */
  totalMarks: z.number().int().nonnegative(),
  present: z.number().int().nonnegative(),
  overallRate: z.number().nullable(),
  /** Students with ≥1 recorded mark (i.e. real data). */
  studentsTracked: z.number().int().nonnegative(),
  /** Tracked students whose rate is below `threshold`. */
  belowThreshold: z.number().int().nonnegative(),
  threshold: z.number(),
});
export type AttendanceOverview = z.infer<typeof attendanceOverviewSchema>;

export const attendanceGroupStatSchema = z.object({
  groupId: z.string(),
  name: z.string(),
  kind: attendanceGroupKindSchema,
  memberCount: z.number().int().nonnegative(),
  sessionsHeld: z.number().int().nonnegative(),
  present: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  rate: z.number().nullable(),
});
export type AttendanceGroupStat = z.infer<typeof attendanceGroupStatSchema>;

export const attendanceUnitStatSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  parentId: z.string().nullable(),
  /** Tracked students (≥1 recorded mark) whose org-unit is in this subtree. */
  students: z.number().int().nonnegative(),
  present: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  rate: z.number().nullable(),
});
export type AttendanceUnitStat = z.infer<typeof attendanceUnitStatSchema>;

export const attendanceStudentStatSchema = z.object({
  studentId: z.string(),
  name: z.string(),
  rollNumber: z.string(),
  orgUnitId: z.string().nullable(),
  attended: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  rate: z.number().nullable(),
  /** Flagged defaulter (real rate below the threshold). */
  below: z.boolean(),
});
export type AttendanceStudentStat = z.infer<typeof attendanceStudentStatSchema>;

/** The whole analytics payload (one read powers the dashboard). */
export const attendanceAnalyticsResponseSchema = z.object({
  overview: attendanceOverviewSchema,
  groups: z.array(attendanceGroupStatSchema),
  units: z.array(attendanceUnitStatSchema),
  students: z.array(attendanceStudentStatSchema),
  threshold: z.number(),
});
export type AttendanceAnalyticsResponse = z.infer<
  typeof attendanceAnalyticsResponseSchema
>;

// --- STUDENT's OWN attendance view (own-data-only) ---------------------------
// A college student's own %: attended ÷ their records in COMPLETED sessions
// across the groups they're in. `rate` null = "no data", never a fake 0%.

export const studentAttendanceGroupSchema = z.object({
  groupId: z.string(),
  name: z.string(),
  kind: attendanceGroupKindSchema,
  attended: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  rate: z.number().nullable(),
});
export type StudentAttendanceGroup = z.infer<
  typeof studentAttendanceGroupSchema
>;

export const studentAttendanceSessionSchema = z.object({
  sessionId: z.string(),
  groupName: z.string(),
  title: z.string(),
  scheduledAt: z.string().datetime(),
  status: attendanceRecordStatusSchema,
});
export type StudentAttendanceSession = z.infer<
  typeof studentAttendanceSessionSchema
>;

export const studentAttendanceResponseSchema = z.object({
  overall: z.object({
    attended: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    rate: z.number().nullable(),
  }),
  groups: z.array(studentAttendanceGroupSchema),
  /** Present/absent history, most recent first. */
  sessions: z.array(studentAttendanceSessionSchema),
});
export type StudentAttendanceResponse = z.infer<
  typeof studentAttendanceResponseSchema
>;

// ---------------------------------------------------------------------------
// EXAM RESULT ANALYSIS — per-exam analytics over graded attempts. Read-only.
// Rates/averages are null = "no data" (no graded attempts), never fake 0.
// Question-level is present ONLY when per-question breakdown data exists.
// ---------------------------------------------------------------------------

export const examAnalysisOverviewSchema = z.object({
  attempts: z.number().int().nonnegative(),
  /** Graded (completed) attempts — the analysis denominator. */
  completed: z.number().int().nonnegative(),
  avgScore: z.number().nullable(),
  avgPercent: z.number().nullable(),
  passRate: z.number().nullable(),
  highest: z.number().nullable(),
  lowest: z.number().nullable(),
  median: z.number().nullable(),
  totalMarks: z.number().int().nonnegative(),
  passPercentage: z.number(),
});
export type ExamAnalysisOverview = z.infer<typeof examAnalysisOverviewSchema>;

export const examScoreBandSchema = z.object({
  label: z.string(),
  min: z.number(),
  max: z.number(),
  count: z.number().int().nonnegative(),
});
export type ExamScoreBand = z.infer<typeof examScoreBandSchema>;

/** Per exam-SECTION comparison (average over graded attempts). */
export const examSectionStatSchema = z.object({
  sectionId: z.string(),
  name: z.string(),
  avgScore: z.number().nullable(),
  maxScore: z.number(),
  avgPercent: z.number().nullable(),
});
export type ExamSectionStat = z.infer<typeof examSectionStatSchema>;

/** Per-question correctness (only when breakdown data exists). */
export const examQuestionStatSchema = z.object({
  questionId: z.string(),
  section: z.string(),
  text: z.string(),
  maxMarks: z.number(),
  /** Attempts that answered it with full marks. */
  correct: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  correctRate: z.number().nullable(),
});
export type ExamQuestionStat = z.infer<typeof examQuestionStatSchema>;

/** Org-unit (dept/section of the STUDENTS) rollup. */
export const examUnitStatSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  parentId: z.string().nullable(),
  students: z.number().int().nonnegative(),
  avgPercent: z.number().nullable(),
  passRate: z.number().nullable(),
});
export type ExamUnitStat = z.infer<typeof examUnitStatSchema>;

export const examStudentResultSchema = z.object({
  attemptId: z.string(),
  userId: z.string().nullable(),
  name: z.string(),
  rollNumber: z.string(),
  orgUnitId: z.string().nullable(),
  score: z.number(),
  percent: z.number().nullable(),
  passed: z.boolean(),
  status: z.string(),
});
export type ExamStudentResult = z.infer<typeof examStudentResultSchema>;

export const examAnalysisResponseSchema = z.object({
  examId: z.string(),
  examTitle: z.string(),
  totalMarks: z.number().int().nonnegative(),
  passPercentage: z.number(),
  /** True when per-question breakdown data was available to analyze. */
  hasQuestionData: z.boolean(),
  overview: examAnalysisOverviewSchema,
  distribution: z.array(examScoreBandSchema),
  passFail: z.object({
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  sections: z.array(examSectionStatSchema),
  questions: z.array(examQuestionStatSchema),
  units: z.array(examUnitStatSchema),
  students: z.array(examStudentResultSchema),
});
export type ExamAnalysisResponse = z.infer<typeof examAnalysisResponseSchema>;

// ---------------------------------------------------------------------------
// College dashboard summary — a single cheap read for the workspace landing
// (GET /api/c/:collegeSlug/summary). Aggregate counts + a short recent-students
// list, so the dashboard needs ONE request instead of fanning out over every
// (some feature-gated) list endpoint. Read-only; the counts are honest facts
// about the tenant — the UI decides what to surface based on entitlements.
// The student total + recent list are actor-scope-aware (a faculty member sees
// their in-scope students), reusing the same scope rule as the student list.
// ---------------------------------------------------------------------------

export const collegeSummaryResponseSchema = z.object({
  counts: z.object({
    /** College students in the caller's scope (all, for a college_admin). */
    students: z.number(),
    /** Faculty accounts in the college. */
    faculty: z.number(),
    /** Org-structure units (departments / years / sections / semesters). */
    orgUnits: z.number(),
    /** Master-catalog courses granted to the college. */
    grantedCourses: z.number(),
    /** Active course assignments (source:"college" enrollments) in the college. */
    courseAssignments: z.number(),
  }),
  /** The most recently added students in scope (newest first, up to 5). */
  recentStudents: z.array(collegeStudentSchema),
});
export type CollegeSummaryResponse = z.infer<
  typeof collegeSummaryResponseSchema
>;

// ---------------------------------------------------------------------------
// College exams — Phase 4b (tenant-scoped over the EXISTING exam engine).
// A college exam reuses the whole engine (sections/questions/CODE/timing/
// attempts/grading) but is standalone (no shared curriculum Topic), owned by a
// tenant, targeted at the college (optionally specific org-units), and has a
// draft→published lifecycle. Authoring is college_admin/faculty behind the
// `exams` feature; taking is by that college's students only. Reuses the admin
// authoring DTOs (AdminSectionUpsert / AdminQuestionUpsert / AdminTestCaseUpsert
// / AdminPublicLinkUpsert / AdminExamDetail) and the taking DTOs
// (StartAttemptResponse / ExamResult) unchanged.
// See docs/MULTI_TENANT_ARCHITECTURE.md §2.
// ---------------------------------------------------------------------------

/** Create a college exam shell (sections/questions are added via the reused CRUD). */
export const createCollegeExamSchema = z.object({
  title: z.string().trim().min(1).max(200),
  passPercentage: z.number().int().min(0).max(100).default(40),
  calculatorEnabled: z.boolean().default(true),
  shuffleQuestions: z.boolean().default(false),
  shuffleOptions: z.boolean().default(false),
  resultsVisible: z.boolean().default(true),
  /** Per-exam start-code gate (faculty read the code out right before the exam). */
  accessCodeEnabled: z.boolean().default(false),
  accessCode: z.string().trim().max(64).default(""),
  /**
   * Target org-units (empty = the whole college). A college_admin may leave it
   * empty (college-wide) or target any units; a faculty member MUST target
   * units within their scope (enforced server-side).
   */
  orgUnitIds: z.array(z.string().min(1)).default([]),
})
  .refine((v) => !v.accessCodeEnabled || v.accessCode.length >= 4, {
    message: "Enter a start code of at least 4 characters to enable the code gate",
    path: ["accessCode"],
  });
export type CreateCollegeExamInput = z.infer<typeof createCollegeExamSchema>;

export const updateCollegeExamSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    passPercentage: z.number().int().min(0).max(100).optional(),
    calculatorEnabled: z.boolean().optional(),
    shuffleQuestions: z.boolean().optional(),
    shuffleOptions: z.boolean().optional(),
    resultsVisible: z.boolean().optional(),
    accessCodeEnabled: z.boolean().optional(),
    accessCode: z.string().trim().max(64).optional(),
    orgUnitIds: z.array(z.string().min(1)).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Provide at least one field to update",
  })
  .refine(
    // When turning the gate ON in an update, a code (≥4) must accompany it.
    (v) => v.accessCodeEnabled !== true || (v.accessCode?.length ?? 0) >= 4,
    {
      message: "Enter a start code of at least 4 characters to enable the code gate",
      path: ["accessCode"],
    },
  );
export type UpdateCollegeExamInput = z.infer<typeof updateCollegeExamSchema>;

/** Duplicate a college exam's whole paper (sections/questions/test cases) under a new title. */
export const duplicateCollegeExamSchema = z.object({
  title: z.string().trim().min(1).max(200),
});
export type DuplicateCollegeExamInput = z.infer<
  typeof duplicateCollegeExamSchema
>;

export const setExamPublishSchema = z.object({
  isPublished: z.boolean(),
});
export type SetExamPublishInput = z.infer<typeof setExamPublishSchema>;

/** A college exam in the authoring list (cheap counts + lifecycle + targeting). */
export const collegeExamSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  totalMarks: z.number().int().nonnegative(),
  passPercentage: z.number().int().min(0).max(100),
  calculatorEnabled: z.boolean(),
  /** Per-exam start-code gate (author-scoped list, so the code is echoed). */
  accessCodeEnabled: z.boolean(),
  accessCode: z.string(),
  sectionCount: z.number().int().nonnegative(),
  questionCount: z.number().int().nonnegative(),
  isPublished: z.boolean(),
  /** Target org-unit ids (empty = college-wide). */
  orgUnitIds: z.array(z.string()),
  attemptCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type CollegeExamSummary = z.infer<typeof collegeExamSummarySchema>;
export const collegeExamListResponseSchema = z.object({
  items: z.array(collegeExamSummarySchema),
});
export type CollegeExamListResponse = z.infer<
  typeof collegeExamListResponseSchema
>;

/** One student's attempt on a college exam (tenant-scoped results read). */
export const collegeExamResultRowSchema = z.object({
  attemptId: z.string(),
  userId: z.string().nullable(),
  student: z.string(),
  rollNumber: z.string(),
  status: attemptStatusSchema,
  score: z.number().int().nonnegative(),
  passed: z.boolean(),
  warnings: z.number().int().nonnegative(),
  isMalpractice: z.boolean(),
  completedAt: z.string().datetime().nullable(),
});
export type CollegeExamResultRow = z.infer<typeof collegeExamResultRowSchema>;
export const collegeExamResultsResponseSchema = z.object({
  examId: z.string(),
  examTitle: z.string(),
  totalMarks: z.number().int().nonnegative(),
  items: z.array(collegeExamResultRowSchema),
});
export type CollegeExamResultsResponse = z.infer<
  typeof collegeExamResultsResponseSchema
>;

// ---------------------------------------------------------------------------
// College essays — Phase 4c (tenant-scoped over the EXISTING essay engine).
// A college essay reuses the whole engine (prompt/keywords/config, the writer +
// autosave drafts, the attempt cap, and the grading pipeline — deterministic
// weights + LLM blend + risk scoring) but is a STANDALONE topic (no curriculum
// Topic link), owned by a tenant, targeted at the college (optionally specific
// org-units), with a draft→published lifecycle. Authoring is college_admin/
// faculty behind the `essays` feature; writing is by that college's students.
// Reuses the admin authoring DTO (AdminEssayTopicUpsert / AdminEssayTopic) and
// the student DTOs (EssayPromptSummary/Detail, submit/draft/result) unchanged.
// See docs/MULTI_TENANT_ARCHITECTURE.md §2.
// ---------------------------------------------------------------------------

/** Target org-units for a college essay (empty = whole college). */
const collegeEssayTargetSchema = z.object({
  orgUnitIds: z.array(z.string().min(1)).default([]),
});

/**
 * Create/update a college essay topic — the full admin authoring surface PLUS
 * org-unit targeting. Reuses `adminEssayTopicUpsertSchema` (so authoring is
 * identical to the platform admin) and adds `orgUnitIds`. Update is a full
 * upsert, matching the admin update semantics.
 */
export const createCollegeEssaySchema = adminEssayTopicUpsertSchema.and(
  collegeEssayTargetSchema,
);
export type CreateCollegeEssayInput = z.infer<typeof createCollegeEssaySchema>;
export const updateCollegeEssaySchema = createCollegeEssaySchema;
export type UpdateCollegeEssayInput = CreateCollegeEssayInput;

/** A college essay in the authoring list (cheap counts + lifecycle + targeting). */
export const collegeEssaySummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  difficultyLevel: essayDifficultySchema,
  minWords: z.number().int().nonnegative(),
  maxWords: z.number().int().nonnegative(),
  timeLimitMinutes: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  isPublished: z.boolean(),
  /** Target org-unit ids (empty = college-wide). */
  orgUnitIds: z.array(z.string()),
  /** Submissions across this college's students (drives the results view). */
  attemptCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type CollegeEssaySummary = z.infer<typeof collegeEssaySummarySchema>;
export const collegeEssayListResponseSchema = z.object({
  items: z.array(collegeEssaySummarySchema),
});
export type CollegeEssayListResponse = z.infer<
  typeof collegeEssayListResponseSchema
>;

/** One student's graded submission on a college essay (tenant-scoped read). */
export const collegeEssayResultRowSchema = z.object({
  attemptId: z.string(),
  userId: z.string().nullable(),
  student: z.string(),
  rollNumber: z.string(),
  attemptNumber: z.number().int().positive(),
  status: essayGradingStatusSchema,
  finalScore: z.number().nullable(),
  source: essayScoreSourceSchema.nullable(),
  wordCount: z.number().int().nonnegative(),
  submittedAt: z.string().datetime().nullable(),
  gradedAt: z.string().datetime().nullable(),
});
export type CollegeEssayResultRow = z.infer<typeof collegeEssayResultRowSchema>;
export const collegeEssayResultsResponseSchema = z.object({
  essayTopicId: z.string(),
  essayTitle: z.string(),
  items: z.array(collegeEssayResultRowSchema),
});
export type CollegeEssayResultsResponse = z.infer<
  typeof collegeEssayResultsResponseSchema
>;

// ---------------------------------------------------------------------------
// College challenges — Phase 4d (tenant-scoped over the EXISTING daily-challenge
// engine). Unlike exams/essays there is nothing to author or assign per college:
// the daily challenge is ONE global problem per day with a global leaderboard +
// per-user streaks, and every student already solves it in the learner app. The
// college-specific artifact (the one the sub-capability catalog earmarked:
// SUB_CAPABILITY_CATALOG[challenges] = ["leaderboard"]) is a tenant-scoped
// LEADERBOARD of the college's OWN students' daily-challenge standings — an
// additive read over the shared UserStreak, filtered to the college's members.
// The global solving experience + individual flows are entirely unchanged.
// See docs/MULTI_TENANT_ARCHITECTURE.md §2.
// ---------------------------------------------------------------------------

/** One college student's standing on the daily-challenge leaderboard. */
export const collegeChallengeRowSchema = z.object({
  rank: z.number().int().positive(),
  userId: z.string(),
  name: z.string(),
  rollNumber: z.string(),
  totalScore: z.number().int().nonnegative(),
  currentStreak: z.number().int().nonnegative(),
  maxStreak: z.number().int().nonnegative(),
});
export type CollegeChallengeRow = z.infer<typeof collegeChallengeRowSchema>;

export const collegeChallengeLeaderboardResponseSchema = z.object({
  rows: z.array(collegeChallengeRowSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type CollegeChallengeLeaderboardResponse = z.infer<
  typeof collegeChallengeLeaderboardResponseSchema
>;

// ---------------------------------------------------------------------------
// College analytics — Phase 5a (tenant + faculty-scoped READ-ONLY aggregation).
// Rolls up the real Phase 4 data (college exam attempts, college essay
// submissions, college course enrollments, the college challenge streaks) three
// ways: OVERVIEW (scope-level headline), BY ORG-UNIT (dept/section rollups via
// descendant math), and INDIVIDUAL (per-student profile). NO engine change — it
// only reads existing tenant-scoped data. Metrics are only what the data
// supports (e.g. courses report ASSIGNMENT counts — the engine tracks no
// per-enrollment progress — never a fabricated completion %). `avgExamScore` is
// the mean of raw attempt scores; `examPassRate`/participation are the
// cross-artifact comparables. Scores are 0-decimal counts or rounded numbers.
// See docs/MULTI_TENANT_ARCHITECTURE.md §2.
// ---------------------------------------------------------------------------

/** Exam metrics for a population (attempts + comparables). */
export const analyticsExamMetricSchema = z.object({
  attempts: z.number().int().nonnegative(),
  students: z.number().int().nonnegative(),
  /** Mean of raw attempt scores (marks vary per exam — see the note above). */
  avgScore: z.number().nonnegative(),
  /** Passed attempts as a percentage of attempts, 0-100. */
  passRate: z.number().min(0).max(100),
});
/** Essay metrics for a population. */
export const analyticsEssayMetricSchema = z.object({
  submissions: z.number().int().nonnegative(),
  students: z.number().int().nonnegative(),
  graded: z.number().int().nonnegative(),
  /** Mean final score over GRADED submissions (0-100). */
  avgScore: z.number().min(0).max(100),
});
/** Course metrics — assignment counts only (no progress is tracked). */
export const analyticsCourseMetricSchema = z.object({
  assignments: z.number().int().nonnegative(),
  students: z.number().int().nonnegative(),
});
/** Challenge metrics from the daily-challenge streaks. */
export const analyticsChallengeMetricSchema = z.object({
  participants: z.number().int().nonnegative(),
  avgScore: z.number().nonnegative(),
  avgCurrentStreak: z.number().nonnegative(),
});
export type AnalyticsExamMetric = z.infer<typeof analyticsExamMetricSchema>;
export type AnalyticsEssayMetric = z.infer<typeof analyticsEssayMetricSchema>;
export type AnalyticsCourseMetric = z.infer<typeof analyticsCourseMetricSchema>;
export type AnalyticsChallengeMetric = z.infer<
  typeof analyticsChallengeMetricSchema
>;

export const collegeAnalyticsOverviewSchema = z.object({
  /** Students in the caller's scope (whole college for an admin). */
  students: z.number().int().nonnegative(),
  exams: analyticsExamMetricSchema,
  essays: analyticsEssayMetricSchema,
  courses: analyticsCourseMetricSchema,
  challenges: analyticsChallengeMetricSchema,
});
export type CollegeAnalyticsOverview = z.infer<
  typeof collegeAnalyticsOverviewSchema
>;

/** One org-unit's rollup (students in its subtree). */
export const collegeAnalyticsUnitSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: orgUnitTypeSchema,
  parentId: z.string().nullable(),
  students: z.number().int().nonnegative(),
  exams: analyticsExamMetricSchema,
  essays: analyticsEssayMetricSchema,
  courses: analyticsCourseMetricSchema,
  challenges: analyticsChallengeMetricSchema,
});
export type CollegeAnalyticsUnit = z.infer<typeof collegeAnalyticsUnitSchema>;
export const collegeAnalyticsByUnitResponseSchema = z.object({
  /** Flat list (each carries parentId + type) so the UI can nest dept→section. */
  units: z.array(collegeAnalyticsUnitSchema),
});
export type CollegeAnalyticsByUnitResponse = z.infer<
  typeof collegeAnalyticsByUnitResponseSchema
>;

/** A single student's cross-artifact performance profile. */
export const collegeAnalyticsStudentSchema = z.object({
  id: z.string(),
  name: z.string(),
  rollNumber: z.string(),
  orgUnitId: z.string().nullable(),
  exams: z.object({
    attempts: z.number().int().nonnegative(),
    avgScore: z.number().nonnegative(),
    passed: z.number().int().nonnegative(),
  }),
  essays: z.object({
    submissions: z.number().int().nonnegative(),
    graded: z.number().int().nonnegative(),
    avgScore: z.number().min(0).max(100),
  }),
  courses: z.object({
    assignments: z.number().int().nonnegative(),
  }),
  /** Null when the student has never engaged the daily challenge. */
  challenge: z
    .object({
      totalScore: z.number().int().nonnegative(),
      currentStreak: z.number().int().nonnegative(),
      maxStreak: z.number().int().nonnegative(),
    })
    .nullable(),
});
export type CollegeAnalyticsStudent = z.infer<
  typeof collegeAnalyticsStudentSchema
>;

// ---------------------------------------------------------------------------
// College postings — Phase 5b (tenant-scoped over the EXISTING careers engine).
// A college posting reuses the whole careers engine (posting CRUD + the in-app
// apply flow) but is owned by a tenant, targeted at the college (optionally
// specific org-units), with a draft→published lifecycle (mirrors exams/essays).
// Authoring is college_admin/faculty behind the `postings` feature; browsing +
// applying is by that college's students. Reuses the admin authoring DTO
// (AdminPostingUpsert / AdminPosting) and the student DTOs (PostingSummary /
// PostingDetail / ApplyRequest / ApplicationResponse) + the admin applications
// projection (AdminApplicationListResponse) unchanged — only `orgUnitIds` +
// `isPublished` are added on top. Applications carry NO college field: they
// resolve tenancy through their parent posting. This COMPLETES the spec.
// See docs/MULTI_TENANT_ARCHITECTURE.md §2.
// ---------------------------------------------------------------------------

/** Target org-units for a college posting (empty = the whole college). */
const collegePostingTargetSchema = z.object({
  orgUnitIds: z.array(z.string().min(1)).default([]),
});

/**
 * Create/update a college posting — the full admin authoring surface PLUS
 * org-unit targeting. Reuses `adminPostingUpsertSchema` (so authoring is
 * identical to the platform admin) and adds `orgUnitIds`. Update is a full
 * upsert, matching the admin update semantics. `isPublished` is NOT set here —
 * the draft→publish lifecycle is a separate action (mirrors exams/essays).
 */
export const createCollegePostingSchema = adminPostingUpsertSchema.and(
  collegePostingTargetSchema,
);
export type CreateCollegePostingInput = z.infer<
  typeof createCollegePostingSchema
>;
export const updateCollegePostingSchema = createCollegePostingSchema;
export type UpdateCollegePostingInput = CreateCollegePostingInput;

/** Publish / unpublish a college posting (draft→published lifecycle). */
export const setPostingPublishSchema = z.object({
  isPublished: z.boolean(),
});
export type SetPostingPublishInput = z.infer<typeof setPostingPublishSchema>;

/** A college posting in the authoring list — the admin projection PLUS the
 * tenant lifecycle flag + targeting. */
export const collegePostingSummarySchema = adminPostingSchema.extend({
  isPublished: z.boolean(),
  /** Target org-unit ids (empty = college-wide). */
  orgUnitIds: z.array(z.string()),
});
export type CollegePostingSummary = z.infer<typeof collegePostingSummarySchema>;
export const collegePostingListResponseSchema = z.object({
  items: z.array(collegePostingSummarySchema),
});
export type CollegePostingListResponse = z.infer<
  typeof collegePostingListResponseSchema
>;

/** The published, in-target college postings a student may browse (student
 * projection — same PostingSummary the shared careers cards render). */
export const collegeStudentPostingListResponseSchema = z.object({
  items: z.array(postingSummarySchema),
});
export type CollegeStudentPostingListResponse = z.infer<
  typeof collegeStudentPostingListResponseSchema
>;

// ---------------------------------------------------------------------------
// Gaming (adaptive game engine) — authoring + play contracts
// ---------------------------------------------------------------------------

export const gameKeySchema = z.enum(
  GAME_KEY_VALUES as [GameKey, ...GameKey[]],
);
export const gameDifficultySchema = z.enum(
  GAME_DIFFICULTY_VALUES as [GameDifficulty, ...GameDifficulty[]],
);
export const gameOutcomeSchema = z.enum(
  GAME_OUTCOME_VALUES as [GameOutcome, ...GameOutcome[]],
);
export const gameSelectionModeSchema = z.enum(
  GAME_SELECTION_MODE_VALUES as [GameSelectionMode, ...GameSelectionMode[]],
);
export const gameSetAttemptStatusSchema = z.enum(
  GAME_SET_ATTEMPT_STATUS_VALUES as [
    GameSetAttemptStatus,
    ...GameSetAttemptStatus[],
  ],
);

// --- Authoring ---

/** One authored game inside a GameSet (embedded, ordered). */
export const gameSpecSchema = z.object({
  gameKey: gameKeySchema,
  durationSeconds: z.number().int().min(10).max(3600).default(GAME_DEFAULT_CLOCK_SECONDS),
  allowSkip: z.boolean().default(true),
  startingDifficulty: gameDifficultySchema.default("easy"),
  /** 0 = unlimited questions within the clock. */
  maxQuestions: z.number().int().min(0).max(1000).default(0),
  /** Interactive games (door_key) only: what a wall-bump does. `reset` sends the
   * player back to start (real exam); `block` keeps them in place (practice
   * portal). Default `block` — `reset` is punishing, so it must be opted into.
   * Ignored by non-interactive games. */
  onWallHit: z.enum(["block", "reset"]).default("block"),
});
export type GameSpecInput = z.infer<typeof gameSpecSchema>;

/**
 * Create/replace a GameSet. `orgUnitIds` is only meaningful for a college set
 * (platform-admin sets ignore it). `pickCount` is required + validated for
 * random_n_of_pool.
 */
/** How a set was first drafted — an operator audit trail only (never affects
 * play/scoring/access). `ai_drafted` is sticky through manual edits. */
export const gameSetSourceSchema = z.enum(["manual", "ai_drafted"]);
export type GameSetSource = z.infer<typeof gameSetSourceSchema>;

export const gameSetUpsertSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).default(""),
    games: z.array(gameSpecSchema).min(1, "A game set needs at least one game"),
    selectionMode: gameSelectionModeSchema.default("fixed"),
    pickCount: z.number().int().min(1).max(100).optional(),
    orgUnitIds: z.array(z.string().min(1)).default([]),
    /** PLATFORM authoring only: attach this set to a curriculum Topic (type
     * GAME), making it a course-attached set (college stays null). A tenant
     * (college) set must NOT set this — rejected at the service layer. */
    topicId: z.string().min(1).optional(),
    /** Practice-mode: optional per-question timer (0/undefined = none). */
    perQuestionTimerSeconds: z.number().int().min(0).max(600).default(0),
    /** Practice-mode: reveal correctness after each answer. */
    instantFeedback: z.boolean().default(false),
    /** Per-user attempt cap. 1 = single attempt (default); 0 = unlimited. */
    maxAttempts: z.number().int().min(0).max(100).default(1),
    /** Audit trail only — set "ai_drafted" when creating from an AI draft.
     * Never affects play/scoring/access, so it is not a security boundary. */
    source: gameSetSourceSchema.default("manual"),
  })
  .superRefine((v, ctx) => {
    if (v.selectionMode === "random_n_of_pool") {
      if (v.pickCount === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pickCount"],
          message: "pickCount is required for random_n_of_pool",
        });
      } else if (v.pickCount > v.games.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pickCount"],
          message: "pickCount cannot exceed the number of games in the pool",
        });
      }
    }
  });
export type GameSetUpsert = z.infer<typeof gameSetUpsertSchema>;

/** Partial update — every field optional; server merges. */
export const gameSetUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  games: z.array(gameSpecSchema).min(1).optional(),
  selectionMode: gameSelectionModeSchema.optional(),
  pickCount: z.number().int().min(1).max(100).optional(),
  orgUnitIds: z.array(z.string().min(1)).optional(),
  perQuestionTimerSeconds: z.number().int().min(0).max(600).optional(),
  instantFeedback: z.boolean().optional(),
  maxAttempts: z.number().int().min(0).max(100).optional(),
});
export type GameSetUpdate = z.infer<typeof gameSetUpdateSchema>;

export const setGameSetPublishSchema = z.object({
  isPublished: z.boolean(),
});

/** Full authored GameSet (operator view — no player secrets exist here). */
export const gameSetDetailSchema = z.object({
  id: z.string(),
  college: z.string().nullable(),
  /** Curriculum Topic id for a course-attached set; null otherwise. */
  topic: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  isPublished: z.boolean(),
  orgUnits: z.array(z.string()),
  games: z.array(
    gameSpecSchema.extend({ order: z.number().int().min(0) }),
  ),
  selectionMode: gameSelectionModeSchema,
  pickCount: z.number().int().nullable(),
  perQuestionTimerSeconds: z.number().int(),
  instantFeedback: z.boolean(),
  maxAttempts: z.number().int(),
  source: gameSetSourceSchema,
  createdAt: z.string(),
});
export type GameSetDetail = z.infer<typeof gameSetDetailSchema>;

export const gameSetListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  isPublished: z.boolean(),
  gameCount: z.number().int(),
  selectionMode: gameSelectionModeSchema,
  source: gameSetSourceSchema,
  createdAt: z.string(),
});
export type GameSetListItem = z.infer<typeof gameSetListItemSchema>;

export const gameSetListResponseSchema = z.object({
  items: z.array(gameSetListItemSchema),
});
export type GameSetListResponse = z.infer<typeof gameSetListResponseSchema>;

/** AI set-builder: a free-text brief in → a reviewable DRAFT config out. The AI
 * composes CONFIGURATION ONLY (which games, timings, difficulty, counts); it
 * never authors game content, which is seed-generated. */
export const aiBuildGameSetRequestSchema = z.object({
  brief: z.string().trim().min(1).max(4000),
});
export type AiBuildGameSetRequest = z.infer<typeof aiBuildGameSetRequestSchema>;

/** Two-flag result (mirrors the AI challenge builder): `configured` = an LLM is
 * available at all; `draft` null = the model returned nothing usable / credits
 * exhausted → the operator composes manually. The draft, when present, has
 * already been validated + clamped against the registry and gameSetUpsertSchema. */
export const aiBuildGameSetResponseSchema = z.object({
  configured: z.boolean(),
  draft: gameSetUpsertSchema.nullable(),
});
export type AiBuildGameSetResponse = z.infer<
  typeof aiBuildGameSetResponseSchema
>;

/** Clone a PLATFORM game set into a college (tenant-owned, unpublished copy). */
export const cloneGameSetRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
});
export type CloneGameSetRequest = z.infer<typeof cloneGameSetRequestSchema>;

// --- Play ---

/**
 * A game set a STUDENT can play, as the play/discovery surface shows it. Carries
 * only operator-safe fields — title, which games, clock/attempt info — never a
 * seed or any per-game internal. `topicId` is set for course-attached sets
 * (reached through the learn player's topic tree, like exam topics) and null for
 * a college's own tenant-authored sets.
 */
/** A pre-flight-safe per-game preview (A2): the facts a rules card legitimately
 * shows — which game, its round clock, and whether skip is offered — never a
 * seed or per-game internal. */
export const gamePreviewSchema = z.object({
  gameKey: gameKeySchema,
  durationSeconds: z.number().int(),
  allowSkip: z.boolean(),
});
export type GamePreview = z.infer<typeof gamePreviewSchema>;

export const gamePlayListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  games: z.array(gamePreviewSchema),
  selectionMode: gameSelectionModeSchema,
  totalGames: z.number().int(),
  perQuestionTimerSeconds: z.number().int(),
  attemptsUsed: z.number().int(),
  /** 0 = unlimited. */
  maxAttempts: z.number().int(),
  topicId: z.string().nullable(),
});
export type GamePlayListItem = z.infer<typeof gamePlayListItemSchema>;

export const gamePlayListResponseSchema = z.object({
  items: z.array(gamePlayListItemSchema),
});
export type GamePlayListResponse = z.infer<typeof gamePlayListResponseSchema>;

/**
 * A served game item, as the CLIENT sees it. `view` is the game-specific client
 * view — deliberately `unknown` here because it varies per game AND because it
 * must never be widened to include the solution (the server projects it via the
 * module's `toClientView`, which strips the solution at the type level).
 */
export const gameItemViewSchema = z.object({
  attemptId: z.string(),
  gameKey: gameKeySchema,
  gameIndex: z.number().int(),
  itemIndex: z.number().int(),
  difficulty: gameDifficultySchema,
  view: z.unknown(),
  allowSkip: z.boolean(),
  remainingSeconds: z.number().int(),
  perQuestionTimerSeconds: z.number().int(),
  /** Server-enforced remaining time for THIS item (intrinsic per-item timer),
   * or null when the game has none. A UI counts down from this honestly. */
  itemRemainingSeconds: z.number().int().nullable(),
  /** True for interactive games (door_key): the client plays via the `probe`
   * endpoint, not `answer`. */
  interactive: z.boolean(),
  instantFeedback: z.boolean(),
});
export type GameItemView = z.infer<typeof gameItemViewSchema>;

/**
 * Server-authoritative facts about a game the PRE-FLIGHT needs, WITHOUT serving
 * its first item (so the round clock stays stopped while the tutorial is up).
 * `start` returns the first game's info; `advance` returns the next game's; the
 * clock only begins on the separate `begin` call. (Step 7b/A1.)
 */
export const gameInfoSchema = z.object({
  gameKey: gameKeySchema,
  gameIndex: z.number().int(),
  /** Clamped: a game whose mechanics forbid skipping can never be skipped. */
  allowSkip: z.boolean(),
  /** The round clock length (seconds) — begins only at `begin`. */
  durationSeconds: z.number().int(),
  /** Intrinsic per-item limit, or null. */
  itemSeconds: z.number().int().nullable(),
  instantFeedback: z.boolean(),
  /** 0 = unlimited questions within the round clock. */
  maxQuestions: z.number().int(),
});
export type GameInfo = z.infer<typeof gameInfoSchema>;

/** Start a game-set attempt. `serve:false` (the play UI) returns pre-flight info
 * WITHOUT serving the first item, so the round clock stays stopped during the
 * tutorial; `serve:true` (the default, e.g. tests / a quick-start caller) also
 * serves the first item and starts its clock immediately. */
export const startGameSetRequestSchema = z
  .object({ serve: z.boolean().default(true) })
  .default({ serve: true });
export type StartGameSetRequest = z.infer<typeof startGameSetRequestSchema>;

export const startGameSetResponseSchema = z.object({
  attemptId: z.string(),
  attemptToken: z.string(),
  gameSetId: z.string(),
  sequence: z.array(gameKeySchema),
  totalGames: z.number().int(),
  /** Attempts still available after this start; null = unlimited. */
  attemptsRemaining: z.number().int().nullable(),
  /** The first game's pre-flight info (clock NOT running yet). */
  firstGame: gameInfoSchema,
  /** The first item when `serve` was true, else null — served + clock started
   * only by `begin` in the deferred (UI) flow. */
  item: gameItemViewSchema.nullable(),
});
export type StartGameSetResponse = z.infer<typeof startGameSetResponseSchema>;

/** Serves the current game's first item and STARTS its clock (server-set
 * `expiresAt`). Idempotent: a re-call returns the current item without resetting
 * the clock, so a client cannot extend time by re-calling. */
export const beginGameResponseSchema = z.object({
  item: gameItemViewSchema,
});
export type BeginGameResponse = z.infer<typeof beginGameResponseSchema>;

/**
 * Answer / skip / declare-expired for the current item. `submission` is the
 * game-specific move payload the server REPLAYS — `unknown` because it varies
 * per game. The server NEVER reads a client-supplied score. `action: "expire"`
 * asks the server to record `expired` IFF its own clock agrees — see A3.
 */
export const answerGameItemRequestSchema = z.object({
  itemIndex: z.number().int().min(0),
  action: z.enum(["answer", "skip", "expire"]).default("answer"),
  submission: z.unknown().optional(),
});
export type AnswerGameItemRequest = z.infer<typeof answerGameItemRequestSchema>;

export const answerGameItemResponseSchema = z.object({
  itemIndex: z.number().int(),
  outcome: gameOutcomeSchema,
  marksAwarded: z.number().int(),
  answeredDifficulty: gameDifficultySchema,
  gameScore: z.number().int(),
  questionsCorrect: z.number().int(),
  questionsAttempted: z.number().int(),
  /** Instant-feedback (practice) only: whether the answer was correct. */
  correct: z.boolean(),
  /** The next item to play, or null if the game is complete (clock expired or
   * maxQuestions reached). */
  next: gameItemViewSchema.nullable(),
  gameComplete: z.boolean(),
});
export type AnswerGameItemResponse = z.infer<
  typeof answerGameItemResponseSchema
>;

/**
 * Play ONE move of an INTERACTIVE item (door_key). `action` is the game-specific
 * move payload the server validates + applies against the hidden instance —
 * `unknown` because it varies per game (door_key: `{ dir: 0..3 }`). The server
 * accumulates discovered state on its side; the client never reports position.
 */
export const probeGameItemRequestSchema = z.object({
  itemIndex: z.number().int().min(0),
  action: z.unknown(),
});
export type ProbeGameItemRequest = z.infer<typeof probeGameItemRequestSchema>;

export const probeGameItemResponseSchema = z.object({
  itemIndex: z.number().int(),
  /** REDACTED per-move view (discovered state only — never the hidden set). */
  view: z.unknown(),
  movesUsed: z.number().int(),
  /** True once the item resolved (goal reached, move cap, or expiry). */
  resolved: z.boolean(),
  /** Set only when resolved. */
  outcome: gameOutcomeSchema.nullable(),
  marksAwarded: z.number().int().nullable(),
  gameScore: z.number().int(),
  /** The next item once this one resolved and the game continues; else null. */
  next: gameItemViewSchema.nullable(),
  gameComplete: z.boolean(),
});
export type ProbeGameItemResponse = z.infer<typeof probeGameItemResponseSchema>;

export const advanceGameResponseSchema = z.object({
  /** The NEXT game's pre-flight info, or null if the whole set is finished. */
  nextGame: gameInfoSchema.nullable(),
  /** The next game's first item when `serve` was true, else null — served (and
   * its clock started) by the following `begin` in the deferred (UI) flow. */
  item: gameItemViewSchema.nullable(),
  setComplete: z.boolean(),
});
export type AdvanceGameResponse = z.infer<typeof advanceGameResponseSchema>;

/** Records one proctoring warning on the attempt (A4), mirroring the exam
 * warning route. Crossing the malpractice threshold force-finishes the attempt. */
export const recordGameWarningResponseSchema = z.object({
  warningsTriggered: z.number().int(),
  isMalpractice: z.boolean(),
  /** True when this warning crossed the threshold and the attempt was finished. */
  autoFinished: z.boolean(),
});
export type RecordGameWarningResponse = z.infer<
  typeof recordGameWarningResponseSchema
>;

export const gameResultSchema = z.object({
  status: gameSetAttemptStatusSchema,
  compositeScore: z.number().int(),
  games: z.array(
    z.object({
      gameKey: gameKeySchema,
      gameIndex: z.number().int(),
      score: z.number().int(),
      questionsServed: z.number().int(),
      questionsAttempted: z.number().int(),
      questionsCorrect: z.number().int(),
    }),
  ),
});
export type GameResult = z.infer<typeof gameResultSchema>;

/** Practice-mode reveal request (post-answer, instantFeedback only). */
export const explainGameItemRequestSchema = z.object({
  itemIndex: z.number().int().min(0),
});
export type ExplainGameItemRequest = z.infer<
  typeof explainGameItemRequestSchema
>;

/** Practice-mode reveal — MAY carry the solution (distinct, gated code path). */
export const gameExplanationResponseSchema = z.object({
  itemIndex: z.number().int(),
  outcome: gameOutcomeSchema,
  solution: z.unknown(),
  note: z.string().optional(),
});
export type GameExplanationResponse = z.infer<
  typeof gameExplanationResponseSchema
>;

// ---------------------------------------------------------------------------
// Speaking (Communication Sections A/B — the speech spine). Step 10 wires the
// whole path for ONE item type, read_aloud; the DTOs are shaped so Step 11's
// item types extend them without a wire change. Word accuracy + fluency only —
// there is NO pronunciation/clarity field anywhere.
// ---------------------------------------------------------------------------

export const speakingItemTypeSchema = z.enum(
  SPEAKING_ITEM_TYPE_VALUES as [SpeakingItemType, ...SpeakingItemType[]],
);
export const speechJobStatusSchema = z.enum(
  SPEECH_JOB_STATUS_VALUES as [SpeechJobStatus, ...SpeechJobStatus[]],
);
export const speakingAttemptStatusSchema = z.enum(
  SPEAKING_ATTEMPT_STATUS_VALUES as [
    SpeakingAttemptStatus,
    ...SpeakingAttemptStatus[],
  ],
);

/** One transcribed word with start/end offsets in seconds (mirrors WordTiming). */
export const wordTimingSchema = z.object({
  word: z.string(),
  start: z.number(),
  end: z.number(),
});
export type WordTimingDto = z.infer<typeof wordTimingSchema>;

export const misspokenWordSchema = z.object({
  expected: z.string(),
  heard: z.string(),
});

/** The read-aloud score as it goes on the wire (mirrors shared ReadAloudScore). */
export const readAloudScoreSchema = z.object({
  wordAccuracy: z.number(),
  wer: z.number(),
  /** Operator detail: exactly-matched word count + homophone (phonetic) matches
   * accepted as correct. The student view collapses these into "correct". */
  exactMatches: z.number().int().nonnegative(),
  phoneticMatches: z.array(misspokenWordSchema),
  missedWords: z.array(z.string()),
  missaidWords: z.array(misspokenWordSchema),
  extraWords: z.array(z.string()),
  fluency: z.object({
    wordCount: z.number().int().nonnegative(),
    durationSeconds: z.number(),
    speechRate: z.number(),
    pauseCount: z.number().int().nonnegative(),
    longestPauseSeconds: z.number(),
    fillerCount: z.number().int().nonnegative(),
    fillerRate: z.number(),
  }),
});
export type ReadAloudScoreDto = z.infer<typeof readAloudScoreSchema>;

const fluencyResultSchema = z.object({
  wordCount: z.number().int().nonnegative(),
  durationSeconds: z.number(),
  speechRate: z.number(),
  pauseCount: z.number().int().nonnegative(),
  longestPauseSeconds: z.number(),
  fillerCount: z.number().int().nonnegative(),
  fillerRate: z.number(),
});

/** Answer-set match (short_answer / conversation / passage_question). */
export const answerMatchScoreSchema = z.object({
  kind: z.literal("answer_set"),
  matched: z.boolean(),
  matchedAnswer: z.string().nullable(),
  score: z.number(),
  transcript: z.string(),
  acceptableAnswers: z.array(z.string()),
});

/** fill_missing_word: the gap word present AND the full sentence matched. */
export const fillMissingWordScoreSchema = z.object({
  kind: z.literal("fill_missing_word"),
  missingWordPresent: z.boolean(),
  sentenceAccuracy: z.number(),
  score: z.number(),
  missedWords: z.array(z.string()),
  missaidWords: z.array(misspokenWordSchema),
  extraWords: z.array(z.string()),
  fluency: fluencyResultSchema,
});

/** dictation: TYPED string comparison, phonetic tolerance OFF. */
export const dictationScoreSchema = z.object({
  kind: z.literal("dictation"),
  wordAccuracy: z.number(),
  wer: z.number(),
  exactMatches: z.number().int().nonnegative(),
  missedWords: z.array(z.string()),
  missaidWords: z.array(misspokenWordSchema),
  extraWords: z.array(z.string()),
  phoneticTolerant: z.literal(false),
});

const factCoverageSchema = z.object({
  fact: z.string(),
  covered: z.boolean(),
  matchedTokens: z.number().int().nonnegative(),
  requiredTokens: z.number().int().nonnegative(),
});

/** story_retell: key-fact coverage floor + optional AI coherence blend. */
export const storyRetellScoreSchema = z.object({
  kind: z.literal("story_retell"),
  source: z.enum(["deterministic_floor", "ai_hybrid"]),
  coverage: z.object({
    covered: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    ratio: z.number(),
    facts: z.array(factCoverageSchema),
  }),
  coverageScore: z.number(),
  aiCoherence: z.number().nullable(),
  total: z.number(),
  approximate: z.boolean(),
  fluency: fluencyResultSchema,
});

/** open_topic: fluency floor + optional AI relevance/grammar (APPROXIMATE). */
export const openTopicScoreSchema = z.object({
  kind: z.literal("open_topic"),
  source: z.enum(["deterministic_floor", "ai_hybrid"]),
  fluency: fluencyResultSchema,
  fluencyScore: z.number(),
  latencySeconds: z.number(),
  aiRelevance: z.number().nullable(),
  aiGrammar: z.number().nullable(),
  total: z.number(),
  approximate: z.boolean(),
});

/**
 * Any item's stored score. The read-aloud family (read_aloud / repeat /
 * sentence_build / error_correct) all use readAloudScoreSchema (no `kind`); the
 * rest are tagged by `kind`. Tagged variants are tried first so the untagged
 * read-aloud shape is the fallback.
 */
export const speakingItemScoreSchema = z.union([
  answerMatchScoreSchema,
  fillMissingWordScoreSchema,
  dictationScoreSchema,
  storyRetellScoreSchema,
  openTopicScoreSchema,
  readAloudScoreSchema,
]);
export type SpeakingItemScoreDto = z.infer<typeof speakingItemScoreSchema>;

/** Worker job payload for one item's transcription (dedicated `speech` queue). */
export const speechJobSchema = z.object({
  jobId: z.string().min(1),
  attemptId: z.string().min(1),
  itemIndex: z.number().int().nonnegative(),
  audioUrl: z.string().min(1),
  /** Owning college (audit/metering context); absent for platform-internal. */
  collegeId: z.string().optional(),
  /** The student, for per-student AI metering of the hybrid (LLM) item types. */
  userId: z.string().optional(),
});
export type SpeechJob = z.infer<typeof speechJobSchema>;

// --- Authoring ---
/** Item types whose scoring needs `referenceText` (the WER / typed reference). */
const REFERENCE_TEXT_TYPES: readonly SpeakingItemType[] = [
  "read_aloud",
  "repeat",
  "sentence_build",
  "error_correct",
  "fill_missing_word",
  "dictation",
];
/** Item types scored against an authored answer set. */
const ANSWER_SET_TYPES: readonly SpeakingItemType[] = [
  "short_answer",
  "conversation",
  "passage_question",
];

/**
 * One authored speaking item. The base object holds every possible field
 * (optional) and a superRefine enforces the fields each item TYPE actually
 * needs — so read_aloud still requires referenceText, an answer-set type
 * requires answerSet, story_retell requires keyFacts, etc. Fields not relevant
 * to a type are simply left at their defaults (no per-type object churn on the
 * wire — the item type is the discriminator).
 */
export const speakingItemUpsertSchema = z
  .object({
    itemType: speakingItemTypeSchema.default("read_aloud"),
    /** WER / typed reference (read_aloud, repeat, sentence_build,
     *  error_correct, fill_missing_word full sentence, dictation). */
    referenceText: z.string().trim().default(""),
    /** On-screen instructions / the topic prompt (required for open_topic). */
    promptText: z.string().default(""),
    /** TTS-generated spoken prompt (Cloudinary URL; authoring-time). */
    promptAudioUrl: z.string().default(""),
    /** Listening stimulus audio (conversation / passage_question / story_retell). */
    stimulusAudioUrl: z.string().default(""),
    /** How many times the stimulus may be played; 0 = unlimited (Step-9 precedent). */
    stimulusPlayLimit: z.number().int().min(0).default(0),
    /** Acceptable answers (short_answer / conversation / passage_question). */
    answerSet: z.array(z.string().trim().min(1)).default([]),
    /** The blanked word (fill_missing_word). */
    missingWord: z.string().trim().default(""),
    /** Authored key facts a retell should cover (story_retell). */
    keyFacts: z.array(z.string().trim().min(1)).default([]),
    /** Optional preset-composition grouping label (e.g. "Section B"). */
    section: z.string().default(""),
    /**
     * Prep countdown (seconds) BEFORE the recording window opens — the
     * prep-then-speak family (open_topic / role_play): CTS gives 90s prep,
     * Versant ~40s. 0 = no prep (record immediately). This is a client-side UX
     * clock, not server-enforced (the audio is captured in the browser).
     */
    prepSeconds: z.number().int().min(0).max(300).default(0),
    /** Fixed recording window in seconds. */
    responseWindowSeconds: z.number().int().positive().max(300).default(60),
  })
  .superRefine((item, ctx) => {
    const need = (cond: boolean, path: string, message: string) => {
      if (!cond)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    };
    if (REFERENCE_TEXT_TYPES.includes(item.itemType)) {
      need(
        item.referenceText.trim().length > 0,
        "referenceText",
        `${item.itemType} requires referenceText`,
      );
    }
    if (ANSWER_SET_TYPES.includes(item.itemType)) {
      need(
        item.answerSet.length > 0,
        "answerSet",
        `${item.itemType} requires at least one acceptable answer`,
      );
    }
    if (item.itemType === "fill_missing_word") {
      need(
        item.missingWord.trim().length > 0,
        "missingWord",
        "fill_missing_word requires missingWord",
      );
    }
    if (item.itemType === "story_retell") {
      need(
        item.keyFacts.length > 0,
        "keyFacts",
        "story_retell requires at least one key fact",
      );
    }
    if (item.itemType === "open_topic") {
      need(
        item.promptText.trim().length > 0,
        "promptText",
        "open_topic requires a topic prompt (promptText)",
      );
    }
  });
export type SpeakingItemUpsert = z.infer<typeof speakingItemUpsertSchema>;

export const speakingAssessmentUpsertSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().default(""),
  items: z.array(speakingItemUpsertSchema).default([]),
  /** Attempt cap; 0 = unlimited. */
  maxAttempts: z.number().int().min(0).default(1),
  /** College-surface org-unit targeting (empty = whole college). */
  orgUnitIds: z.array(z.string()).optional(),
});
export type SpeakingAssessmentUpsert = z.infer<
  typeof speakingAssessmentUpsertSchema
>;

export const setSpeakingPublishSchema = z.object({ isPublished: z.boolean() });
export type SetSpeakingPublish = z.infer<typeof setSpeakingPublishSchema>;

// --- Admin projections ---
export const speakingAssessmentListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  itemCount: z.number().int().nonnegative(),
  isPublished: z.boolean(),
  maxAttempts: z.number().int().nonnegative(),
  orgUnitIds: z.array(z.string()),
  createdAt: z.string(),
});
export type SpeakingAssessmentListItem = z.infer<
  typeof speakingAssessmentListItemSchema
>;
export const speakingAssessmentListResponseSchema = z.object({
  items: z.array(speakingAssessmentListItemSchema),
});
export type SpeakingAssessmentListResponse = z.infer<
  typeof speakingAssessmentListResponseSchema
>;

export const speakingAssessmentItemDetailSchema = z.object({
  itemType: speakingItemTypeSchema,
  referenceText: z.string(),
  promptText: z.string(),
  promptAudioUrl: z.string(),
  stimulusAudioUrl: z.string(),
  stimulusPlayLimit: z.number().int().nonnegative(),
  answerSet: z.array(z.string()),
  missingWord: z.string(),
  keyFacts: z.array(z.string()),
  section: z.string(),
  prepSeconds: z.number().int().nonnegative(),
  responseWindowSeconds: z.number().int().positive(),
});
export const speakingAssessmentDetailSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  isPublished: z.boolean(),
  maxAttempts: z.number().int().nonnegative(),
  orgUnitIds: z.array(z.string()),
  items: z.array(speakingAssessmentItemDetailSchema),
});
export type SpeakingAssessmentDetail = z.infer<
  typeof speakingAssessmentDetailSchema
>;

// --- Student consumption ---
export const speakingPlayListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  itemCount: z.number().int().nonnegative(),
  maxAttempts: z.number().int().nonnegative(),
  attemptsUsed: z.number().int().nonnegative(),
});
export type SpeakingPlayListItem = z.infer<typeof speakingPlayListItemSchema>;
export const speakingPlayListResponseSchema = z.object({
  items: z.array(speakingPlayListItemSchema),
});
export type SpeakingPlayListResponse = z.infer<
  typeof speakingPlayListResponseSchema
>;

/**
 * One item as the student sees it — NO scoring internals. `referenceText` is
 * populated ONLY for read_aloud, where the text on screen IS the task; for every
 * other type (repeat / sentence_build / dictation / error_correct /
 * fill_missing_word / the answer-set + LLM types) the reference, answer set,
 * key facts and missing word are WITHHELD — the student hears the stimulus and
 * reproduces it, so showing the text would defeat the item. The service is
 * responsible for blanking those fields (see itemViews).
 */
export const speakingItemViewSchema = z.object({
  index: z.number().int().nonnegative(),
  itemType: speakingItemTypeSchema,
  /** Present only for read_aloud; "" for every other type. */
  referenceText: z.string(),
  promptText: z.string(),
  promptAudioUrl: z.string(),
  stimulusAudioUrl: z.string(),
  stimulusPlayLimit: z.number().int().nonnegative(),
  section: z.string(),
  prepSeconds: z.number().int().nonnegative(),
  responseWindowSeconds: z.number().int().positive(),
});
export type SpeakingItemView = z.infer<typeof speakingItemViewSchema>;

export const startSpeakingResponseSchema = z.object({
  attemptId: z.string(),
  assessmentTitle: z.string(),
  status: speakingAttemptStatusSchema,
  items: z.array(speakingItemViewSchema),
});
export type StartSpeakingResponse = z.infer<typeof startSpeakingResponseSchema>;

export const submitSpeakingItemRequestSchema = z
  .object({
    /** Cloudinary URL of the recorded audio (spoken items; only the URL reaches
     *  the API). Absent for dictation. */
    audioUrl: z.string().min(1).optional(),
    /** The TYPED sentence for a dictation item — scored inline, no ASR. */
    text: z.string().optional(),
  })
  .refine((b) => Boolean(b.audioUrl) || typeof b.text === "string", {
    message: "provide audioUrl (spoken items) or text (dictation)",
  });
export type SubmitSpeakingItemRequest = z.infer<
  typeof submitSpeakingItemRequestSchema
>;

/** Poll status/result for one item. `score` is null until transcription
 * completes; a `failed` status is FINAL, not pending. */
export const speakingItemResultSchema = z.object({
  index: z.number().int().nonnegative(),
  itemType: speakingItemTypeSchema,
  status: speechJobStatusSchema,
  audioUrl: z.string(),
  transcript: z.string().nullable(),
  /** The item's score in its type's shape (union across all item types). */
  score: speakingItemScoreSchema.nullable(),
  error: z.string().nullable(),
});
export type SpeakingItemResult = z.infer<typeof speakingItemResultSchema>;

export const speakingAttemptResultSchema = z.object({
  attemptId: z.string(),
  status: speakingAttemptStatusSchema,
  /** True once every item is finalized (completed or failed). */
  complete: z.boolean(),
  items: z.array(speakingItemResultSchema),
});
export type SpeakingAttemptResult = z.infer<
  typeof speakingAttemptResultSchema
>;

export const submitSpeakingItemResponseSchema = z.object({
  index: z.number().int().nonnegative(),
  status: speechJobStatusSchema,
});
export type SubmitSpeakingItemResponse = z.infer<
  typeof submitSpeakingItemResponseSchema
>;
