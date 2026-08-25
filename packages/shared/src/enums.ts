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
  /** Coding profiles: students add competitive-coding handles (Codeforces /
   * LeetCode / CodeChef); a scheduled job fetches + stores normalized stats per
   * platform so the (Prompt-2) leaderboard reads fast, stored data. */
  CODING_PROFILES: "coding_profiles",
  /** Gaming: adaptive, unbounded-question game rounds (Cognizant/Capgemini
   * style). A GameSet bundles 1..N timed games; difficulty steps up/down per
   * answer. Distinct from EXAMS (fixed pre-authored question list). */
  GAMING: "gaming",
  /** Communication: the Cognizant/CTS communication assessment. Phase 3 (the
   * non-speech half) opens the module — grammar (an Exam), comprehension (an
   * Exam with an audio stimulus), and Round-2 scenario email (an EssayTopic
   * with promptKind=email). `authoring` gates a college creating its own
   * communication content; `speaking` is a placeholder for the later speech
   * phase, listed now so the console needs no schema change then. */
  COMMUNICATION: "communication",
} as const;
export type CollegeFeature =
  (typeof CollegeFeature)[keyof typeof CollegeFeature];
export const COLLEGE_FEATURE_VALUES = Object.values(CollegeFeature);

/**
 * Competitive-coding platforms a college student can link a handle for. Only
 * Codeforces has an OFFICIAL public API; LeetCode + CodeChef use best-available
 * (unofficial) sources, so their adapters are isolated and degrade gracefully.
 */
export const CodingPlatform = {
  CODEFORCES: "codeforces",
  LEETCODE: "leetcode",
  CODECHEF: "codechef",
} as const;
export type CodingPlatform =
  (typeof CodingPlatform)[keyof typeof CodingPlatform];
export const CODING_PLATFORM_VALUES = Object.values(CodingPlatform);

/**
 * Per-handle fetch status stored alongside the stats. `never` = a handle exists
 * but has never been fetched yet; `ok` = last fetch succeeded; `not_found` = the
 * platform said no such handle; `error` = the platform was unreachable / errored
 * (we KEEP the last-known numbers and just flag this so nothing is nulled out).
 */
export const CodingFetchStatus = {
  NEVER: "never",
  OK: "ok",
  NOT_FOUND: "not_found",
  ERROR: "error",
} as const;
export type CodingFetchStatus =
  (typeof CodingFetchStatus)[keyof typeof CodingFetchStatus];
export const CODING_FETCH_STATUS_VALUES = Object.values(CodingFetchStatus);

/**
 * The metric the (Prompt-2) coding leaderboard ranks by. `rating` = the
 * platform's contest rating; `problemsSolved` = the accepted-problems count.
 */
export const CodingMetric = {
  RATING: "rating",
  PROBLEMS_SOLVED: "problemsSolved",
} as const;
export type CodingMetric = (typeof CodingMetric)[keyof typeof CodingMetric];
export const CODING_METRIC_VALUES = Object.values(CodingMetric);

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
  /** A curriculum topic that maps 1:1 to a GameSet (mirrors EXAM). */
  GAME: "game",
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
// Gaming (net-new adaptive game engine — see packages/shared/src/games/)
// ---------------------------------------------------------------------------

/** Registered game modules. `_probe` is a DEV-ONLY throwaway generator used to
 * prove the seam end-to-end; it is never shown in an admin picker. Real games
 * are added in later steps. */
export const GameKey = {
  PROBE: "_probe",
  /** Latin-square deduction: fill the one `?` cell with the forced symbol. */
  GEO_SUDO: "geo_sudo",
  /** Permutation "switch" tracing (top-down, bottom-up, and 3-layer). */
  SWITCH_CHALLENGE: "switch_challenge",
  /** Rush-Hour: slide blocks to clear a path for the ball to the hole (BFS). */
  MOTION_CHALLENGE: "motion_challenge",
  /** Inductive reasoning: pick the two option grids that follow the hidden rule. */
  INDUCTIVE_REASONING: "inductive_reasoning",
  /** Quickfire math: click three bubbles in ascending order of value. */
  BUBBLE_MATH: "bubble_math",
  /** Maze with INVISIBLE walls: collect keys, reach the door (interactive/probe). */
  DOOR_KEY: "door_key",
  /** Three-cycle interleaved dual task: memorise a highlighted circle, judge a
   * rotation, ×3, then recall the circles in order (interactive; +3/-1). */
  GRID_CHALLENGE: "grid_challenge",
} as const;
export type GameKey = (typeof GameKey)[keyof typeof GameKey];
export const GAME_KEY_VALUES = Object.values(GameKey);

/** Adaptive difficulty tiers. easy=1, moderate=2, hard=3 marks (see
 * GAME_DIFFICULTY_MARKS in constants.ts). */
export const GameDifficulty = {
  EASY: "easy",
  MODERATE: "moderate",
  HARD: "hard",
} as const;
export type GameDifficulty =
  (typeof GameDifficulty)[keyof typeof GameDifficulty];
export const GAME_DIFFICULTY_VALUES = Object.values(GameDifficulty);

/** How a served item resolved. Kept DISTINCT (never collapse skipped into
 * wrong) — analytics separate them. `expired` = the game clock ran out. */
export const GameOutcome = {
  CORRECT: "correct",
  WRONG: "wrong",
  SKIPPED: "skipped",
  EXPIRED: "expired",
} as const;
export type GameOutcome = (typeof GameOutcome)[keyof typeof GameOutcome];
export const GAME_OUTCOME_VALUES = Object.values(GameOutcome);

/** How a GameSet resolves its game sequence at attempt start. */
export const GameSelectionMode = {
  /** Play every authored game, in order. */
  FIXED: "fixed",
  /** Pick `pickCount` games at random from the authored pool (Capgemini's
   * "24 games, system picks 4"). The selection is frozen once per attempt. */
  RANDOM_N_OF_POOL: "random_n_of_pool",
} as const;
export type GameSelectionMode =
  (typeof GameSelectionMode)[keyof typeof GameSelectionMode];
export const GAME_SELECTION_MODE_VALUES = Object.values(GameSelectionMode);

/** Parent GameSetAttempt lifecycle: in_progress → graded (terminal), or
 *  → abandoned (terminal) when the shared reaper sweeps a stale in-progress
 *  attempt whose game clocks all expired without a finish. */
export const GameSetAttemptStatus = {
  IN_PROGRESS: "in_progress",
  GRADED: "graded",
  ABANDONED: "abandoned",
} as const;
export type GameSetAttemptStatus =
  (typeof GameSetAttemptStatus)[keyof typeof GameSetAttemptStatus];
export const GAME_SET_ATTEMPT_STATUS_VALUES = Object.values(
  GameSetAttemptStatus,
);

/** Child GameAttempt lifecycle: in_progress → complete (frozen when the game's
 * clock expires or the student advances). */
export const GameAttemptStatus = {
  IN_PROGRESS: "in_progress",
  COMPLETE: "complete",
} as const;
export type GameAttemptStatus =
  (typeof GameAttemptStatus)[keyof typeof GameAttemptStatus];
export const GAME_ATTEMPT_STATUS_VALUES = Object.values(GameAttemptStatus);

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
 * What kind of prompt an EssayTopic is. `essay` is the original behaviour and
 * the default — every existing topic reads back as `essay` and grades through
 * the unchanged 7-dimension essay engine. `email` (Communication module,
 * Round 2 scenario email) grades through the email rubric instead: the same
 * deterministic mechanics, rebalanced weights, and email-specific dimensions.
 */
export const EssayPromptKind = {
  ESSAY: "essay",
  EMAIL: "email",
} as const;
export type EssayPromptKind =
  (typeof EssayPromptKind)[keyof typeof EssayPromptKind];
export const ESSAY_PROMPT_KIND_VALUES = Object.values(EssayPromptKind);

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
// Speaking (Communication Sections A/B — the speech spine)
// ---------------------------------------------------------------------------

/**
 * Speaking item types. Step 10 built ONLY `read_aloud` (the whole spine
 * validated on one item type, like `_probe` for the game engine). Step 12 adds
 * the rest of the Communication catalogue. The enum is a const object so new
 * types extend it without a schema migration.
 *
 * Scoring family of each (see packages/shared/src/speech.ts):
 *   - Reference-known SPOKEN, phonetic-tolerant WER: read_aloud, repeat,
 *     sentence_build, error_correct, fill_missing_word.
 *   - Answer-set match (fuzzy + phonetic): short_answer, conversation,
 *     passage_question.
 *   - TYPED, phonetics OFF: dictation.
 *   - LLM-judged HYBRID (deterministic floor + AI blend): story_retell,
 *     open_topic. (role_play is DEFERRED — see the Step 12 report.)
 */
export const SpeakingItemType = {
  READ_ALOUD: "read_aloud",
  REPEAT: "repeat",
  SHORT_ANSWER: "short_answer",
  SENTENCE_BUILD: "sentence_build",
  CONVERSATION: "conversation",
  PASSAGE_QUESTION: "passage_question",
  FILL_MISSING_WORD: "fill_missing_word",
  ERROR_CORRECT: "error_correct",
  DICTATION: "dictation",
  STORY_RETELL: "story_retell",
  OPEN_TOPIC: "open_topic",
} as const;
export type SpeakingItemType =
  (typeof SpeakingItemType)[keyof typeof SpeakingItemType];
export const SPEAKING_ITEM_TYPE_VALUES = Object.values(SpeakingItemType);

/**
 * Item types whose task is IMPOSSIBLE without hearing an audio stimulus — the
 * reference is withheld from the student view (ListenSpeakRenderer), so with no
 * audio there is literally nothing to respond to. The single source of truth for:
 * the runner (blocks recording + shows an unavailable state when the audio is
 * missing), the publish guard (a listen item with no audio is not publishable),
 * and the seed (which item types need prompt audio generated).
 *
 * Excluded, and why: `read_aloud` shows its text; `open_topic` carries the topic
 * in its on-screen prompt; `sentence_build` is treated as self-contained here
 * (its jumbled words belong on screen) — see the Step-27 note if its CTS prompt
 * ("you will hear three parts") is reworked into a true listen item.
 */
export const SPEAKING_AUDIO_REQUIRED_ITEM_TYPES: ReadonlySet<SpeakingItemType> =
  new Set<SpeakingItemType>([
    SpeakingItemType.REPEAT,
    SpeakingItemType.SHORT_ANSWER,
    SpeakingItemType.CONVERSATION,
    SpeakingItemType.PASSAGE_QUESTION,
    SpeakingItemType.FILL_MISSING_WORD,
    SpeakingItemType.ERROR_CORRECT,
    SpeakingItemType.STORY_RETELL,
    SpeakingItemType.DICTATION,
  ]);

/** True when an item TYPE always needs audio, regardless of its content. */
export function speakingItemRequiresAudio(itemType: string): boolean {
  return SPEAKING_AUDIO_REQUIRED_ITEM_TYPES.has(itemType as SpeakingItemType);
}

/**
 * The OPERATIVE, instance-level check: does THIS authored item need an audio
 * prompt to be answerable? The always-audio types plus `sentence_build` ONLY
 * when it has scrambled `chunks` to speak (a sentence_build with no chunks is a
 * plain build task with nothing to hear). Used by the item-view builder (which
 * surfaces the result to the runner), the publish guard, and the seed — so the
 * runtime block, the publish refusal, and the audio generation all agree.
 */
export function speakingItemNeedsAudio(item: {
  itemType: string;
  chunks?: readonly string[] | null;
}): boolean {
  if (speakingItemRequiresAudio(item.itemType)) return true;
  if (item.itemType === SpeakingItemType.SENTENCE_BUILD) {
    return (item.chunks?.length ?? 0) > 0;
  }
  return false;
}

/**
 * Item types whose `referenceText` is the WITHHELD CORRECT ANSWER — the complete
 * sentence the student must produce (fill_missing_word) or the corrected form
 * (error_correct). Speaking the reference would read the answer aloud, so the
 * prompt clip must NEVER be synthesised from it. The sentence the student
 * actually hears (with the word gapped / with the grammar error) is a different
 * string the author supplies as the STIMULUS — which the runner plays in
 * preference to the prompt clip anyway.
 */
const SPEAKING_REFERENCE_IS_ANSWER: ReadonlySet<SpeakingItemType> =
  new Set<SpeakingItemType>([
    SpeakingItemType.FILL_MISSING_WORD,
    SpeakingItemType.ERROR_CORRECT,
  ]);

/**
 * The EXACT text a needs-audio item's prompt clip is synthesised from — the ONE
 * source of truth for the seed and the authoring UI, so the generated clip and
 * the preview the operator sees always agree.
 *
 *   - `sentence_build` speaks its scrambled `chunks` (never the reference).
 *   - `fill_missing_word` / `error_correct` speak the on-screen prompt: their
 *     reference is the withheld ANSWER, so speaking it would give the game away;
 *     the real gapped/erroneous sentence is authored as the stimulus.
 *   - every other type speaks the reference sentence (the thing to repeat / type
 *     / retell), falling back to the prompt when there is no reference.
 *
 * Returns "" when there is nothing to speak yet (Generate stays disabled).
 * Callers should first check {@link speakingItemNeedsAudio}: a
 * `read_aloud`/`open_topic` item has no prompt clip regardless of this result.
 */
export function speakingPromptAudioText(item: {
  itemType: string;
  referenceText?: string | null;
  promptText?: string | null;
  chunks?: readonly string[] | null;
}): string {
  if (item.itemType === SpeakingItemType.SENTENCE_BUILD) {
    return (item.chunks ?? []).map((c) => c.trim()).filter(Boolean).join(". ");
  }
  if (SPEAKING_REFERENCE_IS_ANSWER.has(item.itemType as SpeakingItemType)) {
    return (item.promptText ?? "").trim();
  }
  return ((item.referenceText ?? "").trim() || (item.promptText ?? "").trim());
}

/**
 * Per-item transcription lifecycle. Mirrors {@link JobStatus} value-for-value
 * (speech rides the same async-job model as code execution + essay grading).
 * A `failed` item is FINALIZED — a failed transcription is not retried over
 * student audio.
 */
export const SpeechJobStatus = {
  QUEUED: "queued",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;
export type SpeechJobStatus =
  (typeof SpeechJobStatus)[keyof typeof SpeechJobStatus];
export const SPEECH_JOB_STATUS_VALUES = Object.values(SpeechJobStatus);

/** A speaking attempt's overall lifecycle. `expired` is terminal — a stale
 *  in-progress attempt whose server deadline passed (set by the shared reaper,
 *  or reached lazily when a read/write finds it past deadline). */
export const SpeakingAttemptStatus = {
  IN_PROGRESS: "in_progress",
  SUBMITTED: "submitted",
  SCORED: "scored",
  EXPIRED: "expired",
} as const;
export type SpeakingAttemptStatus =
  (typeof SpeakingAttemptStatus)[keyof typeof SpeakingAttemptStatus];
export const SPEAKING_ATTEMPT_STATUS_VALUES = Object.values(
  SpeakingAttemptStatus,
);

/**
 * Which engine one part of a CommunicationAssessment composite points at (Step
 * 21). The composite is an ordered CONTAINER — each part references an existing
 * artifact by id + this type, and routes into that engine's own runner. NO new
 * engine: `exam` → Exam, `essay` → EssayTopic, `speaking` → SpeakingAssessment.
 */
export const CommunicationPartType = {
  EXAM: "exam",
  ESSAY: "essay",
  SPEAKING: "speaking",
} as const;
export type CommunicationPartType =
  (typeof CommunicationPartType)[keyof typeof CommunicationPartType];
export const COMMUNICATION_PART_TYPE_VALUES = Object.values(
  CommunicationPartType,
);

/**
 * A part's status FOR ONE STUDENT, derived (never stored) from the underlying
 * engine's attempt + the gate. `locked` = a gate (requiresPrevious / availableFrom)
 * is not yet satisfied; `unavailable` = the referenced artifact was deleted or
 * unpublished out from under the composite (fails safe + visible, never a crash).
 */
export const CommunicationPartStatus = {
  LOCKED: "locked",
  AVAILABLE: "available",
  IN_PROGRESS: "in_progress",
  COMPLETE: "complete",
  UNAVAILABLE: "unavailable",
} as const;
export type CommunicationPartStatus =
  (typeof CommunicationPartStatus)[keyof typeof CommunicationPartStatus];
export const COMMUNICATION_PART_STATUS_VALUES = Object.values(
  CommunicationPartStatus,
);

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
