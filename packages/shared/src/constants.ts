/**
 * System-wide constants shared by api, worker, and web.
 */
import { CodeLanguage } from "./enums.js";

// ---------------------------------------------------------------------------
// BullMQ queues — mirror the original django-rq setup.
// ---------------------------------------------------------------------------

export const QueueName = {
  DEFAULT: "default",
  PRACTICE: "practice",
  ASSESSMENT: "assessment",
  PLAYGROUND: "playground",
  /**
   * Paced AI queue (Stage-2 governor). Carries DEFERRABLE, non-urgent AI that
   * the governor sheds when the shared provider pool is low, drained by a
   * RATE-LIMITED worker so bursts never rate-limit everyone. Interactive grading
   * is NEVER placed here — it runs immediately while allowed.
   */
  AI_PACED: "ai-paced",
  /**
   * Coding-profile refresh. Carries one job PER STUDENT (fetch their linked
   * platform stats), drained by a RATE-LIMITED worker so a daily sweep of many
   * students never bursts hundreds of outbound calls at the coding platforms.
   */
  CODING_REFRESH: "coding-refresh",
  /**
   * Speech transcription (Communication Sections A/B). Carries one job per
   * recorded audio item; drained by a CONCURRENCY-CAPPED + RATE-LIMITED worker
   * so ASR (a CPU-heavy container) can never starve Piston mid-coding-exam. See
   * SPEECH_QUEUE_CONCURRENCY / SPEECH_MAX_PER_MINUTE and the arithmetic in the
   * Step-10 report.
   */
  SPEECH: "speech",
} as const;
export type QueueName = (typeof QueueName)[keyof typeof QueueName];
export const QUEUE_NAME_VALUES = Object.values(QueueName);

/** BullMQ job name for a speech transcription job (dedicated `speech` queue). */
export const SPEECH_JOB_NAME = "transcribe";

/**
 * Simultaneous in-flight ASR requests the worker will make. Sized from the
 * measured ~5s-per-15s-clip throughput and the 90-speaker target (see the
 * report): with 4 in flight against a 2-core ASR container a ~90-clip burst
 * drains in ~2 minutes, and the normal spread-out arrival stays near-real-time.
 */
export const SPEECH_QUEUE_CONCURRENCY = 4;

/** Rate cap (jobs/minute) on the speech queue — a burst guard beside the
 * concurrency cap so a stampede can't peg the ASR container. */
export const SPEECH_MAX_PER_MINUTE = 60;

/** BullMQ job name for a governor-deferred (paced) AI call. */
export const PACED_AI_JOB_NAME = "paced-ai-call";

/**
 * BullMQ job name for the automatic daily-challenge generator (runs on the
 * `default` queue). Shared so the api producer + the worker processor agree.
 */
export const DAILY_CHALLENGE_JOB_NAME = "generate-daily-challenge";

/**
 * Cron for the daily-challenge scheduler: 00:01 IST every day. The pipeline
 * targets the IST day that has just begun (so a valid challenge is live for the
 * new day), and is idempotent — a second fire/restart is a no-op if the day is
 * already published.
 */
export const DAILY_CHALLENGE_CRON = "1 0 * * *";
export const DAILY_CHALLENGE_CRON_TZ = "Asia/Kolkata";

/**
 * BullMQ job names for coding-profile refresh (shared so the api producer + the
 * worker consumer agree). The SWEEP runs on the `default` queue (name-dispatched
 * like the daily-challenge job) and fans out one STUDENT job per linked student
 * onto the rate-limited `coding-refresh` queue.
 */
export const CODING_REFRESH_SWEEP_JOB_NAME = "coding-refresh-sweep";
export const CODING_REFRESH_STUDENT_JOB_NAME = "coding-refresh-student";

/**
 * Cron for the daily coding-profile sweep: 02:10 IST (offset from the
 * daily-challenge job at 00:01 so the two never register/fire together). Same
 * IST timezone; the sweep is idempotent (re-enqueuing a student is de-duped).
 */
export const CODING_REFRESH_CRON = "10 2 * * *";
export const CODING_REFRESH_CRON_TZ = "Asia/Kolkata";

/**
 * The shared ATTEMPT REAPER — sweeps stale in-progress attempts (SpeakingAttempt
 * + GameSetAttempt) whose server deadline / game clocks have long passed, moving
 * them to a terminal state (expired / abandoned) so they stop consuming an
 * attempt slot and stop blocking assessment deletion. Rides the `default` queue
 * (name-dispatched) like the other cron jobs. Every 15 minutes; the sweep is
 * idempotent (only IN_PROGRESS/SUBMITTED-incomplete rows past deadline match).
 */
export const ATTEMPT_REAPER_JOB_NAME = "attempt-reaper";
export const ATTEMPT_REAPER_CRON = "*/15 * * * *";
export const ATTEMPT_REAPER_CRON_TZ = "Asia/Kolkata";
/** Grace after a game's last clock before its parent attempt is abandonable. */
export const GAME_ATTEMPT_ABANDON_GRACE_MS = 30 * 60 * 1000; // 30 min

/**
 * Bounded submit grace past a speaking attempt's deadline. A student who finishes
 * speaking INSIDE the window but whose upload + submit lands a few seconds late
 * must not lose their recording — the audio is already in Cloudinary; only the
 * POST is late. Within this grace the server ACCEPTS and stores the in-flight
 * answer for the item that was served before the deadline, then closes the
 * attempt EXPIRED. It grants NO extra playing time: no new item is served, no
 * prep window, no advance — only the one in-flight answer may land.
 *
 * 90s (not 60, not 120): comfortably covers a worst-case mobile upload of a
 * short clip (a ~1-2 MB webm on slow 3G at ~50-100 KB/s is ~10-30s) plus the API
 * round trip and a retry, with margin — while keeping the "blind submit" window
 * (a scripted client POSTing past the deadline) as small as is safe. 60s risks
 * truncating a slow large upload; 120s widens that window for no real benefit.
 */
export const SPEAKING_SUBMIT_GRACE_MS = 90 * 1000;

/**
 * Per-queue configuration. `timeoutSeconds` mirrors the django-rq job timeouts;
 * `priority` marks the assessment queue as the high-priority one (grading a
 * live, timed exam must not sit behind practice runs).
 */
export interface QueueConfig {
  readonly name: QueueName;
  readonly timeoutSeconds: number;
  readonly priority: boolean;
  /**
   * Optional per-queue BullMQ concurrency override. When unset the worker uses
   * WORKER_CONCURRENCY (the default for CPU-cheap I/O queues). The `speech`
   * queue sets this explicitly to bound simultaneous ASR requests so the shared
   * box's CPU can't be monopolised by transcription.
   */
  readonly concurrency?: number;
}

export const QUEUE_CONFIGS: Record<QueueName, QueueConfig> = {
  [QueueName.DEFAULT]: {
    name: QueueName.DEFAULT,
    timeoutSeconds: 300,
    priority: false,
  },
  [QueueName.PRACTICE]: {
    name: QueueName.PRACTICE,
    timeoutSeconds: 300,
    priority: false,
  },
  [QueueName.ASSESSMENT]: {
    name: QueueName.ASSESSMENT,
    timeoutSeconds: 600,
    priority: true,
  },
  [QueueName.PLAYGROUND]: {
    name: QueueName.PLAYGROUND,
    timeoutSeconds: 300,
    priority: false,
  },
  [QueueName.AI_PACED]: {
    name: QueueName.AI_PACED,
    timeoutSeconds: 120,
    priority: false,
  },
  [QueueName.CODING_REFRESH]: {
    name: QueueName.CODING_REFRESH,
    timeoutSeconds: 120,
    priority: false,
  },
  [QueueName.SPEECH]: {
    name: QueueName.SPEECH,
    // A ~15s read-aloud clip transcribes in ~5s; 120s is a generous ceiling that
    // comfortably exceeds ASR_TIMEOUT_MS (30s) + one fallback retry, so a wedged
    // transcription is reclaimed as stalled rather than double-processed.
    timeoutSeconds: 120,
    priority: false,
    // Cap simultaneous ASR requests (see the queue arithmetic in the report).
    concurrency: SPEECH_QUEUE_CONCURRENCY,
  },
};

// ---------------------------------------------------------------------------
// Code execution — Piston language mapping + limits.
// ---------------------------------------------------------------------------

/**
 * Why a submission runs, which decides the queue it lands on. Mirrors the
 * original django-rq split: playground/practice runs are best-effort, while
 * `assessment` (live, timed exams) gets the high-priority queue. Exams reserve
 * `assessment`; the playground uses `playground`.
 */
export const ExecutionPurpose = {
  PLAYGROUND: "playground",
  PRACTICE: "practice",
  ASSESSMENT: "assessment",
} as const;
export type ExecutionPurpose =
  (typeof ExecutionPurpose)[keyof typeof ExecutionPurpose];
export const EXECUTION_PURPOSE_VALUES = Object.values(ExecutionPurpose);

/** Each execution purpose maps 1:1 to the queue that carries it. */
export const PURPOSE_QUEUE: Record<ExecutionPurpose, QueueName> = {
  [ExecutionPurpose.PLAYGROUND]: QueueName.PLAYGROUND,
  [ExecutionPurpose.PRACTICE]: QueueName.PRACTICE,
  [ExecutionPurpose.ASSESSMENT]: QueueName.ASSESSMENT,
};

/**
 * Language → Piston runtime + version. Mirrors the original executor's mapping
 * (Python / JavaScript / Java / C++ / C). Versions match the public Piston
 * (emkc) runtimes; a self-hosted Piston should install the same set. The worker
 * resolves a `CodeLanguage` to this pair before calling Piston.
 */
export interface PistonRuntime {
  /** Piston's language key (note: C++ is `c++`, not our `cpp` enum value). */
  readonly language: string;
  readonly version: string;
}
export const PISTON_RUNTIMES: Record<CodeLanguage, PistonRuntime> = {
  [CodeLanguage.PYTHON]: { language: "python", version: "3.10.0" },
  [CodeLanguage.JAVASCRIPT]: { language: "javascript", version: "18.15.0" },
  [CodeLanguage.JAVA]: { language: "java", version: "15.0.2" },
  [CodeLanguage.CPP]: { language: "c++", version: "10.2.0" },
  [CodeLanguage.C]: { language: "c", version: "10.2.0" },
};

/** Human-facing language names for selectors. */
export const CODE_LANGUAGE_LABELS: Record<CodeLanguage, string> = {
  [CodeLanguage.PYTHON]: "Python",
  [CodeLanguage.JAVASCRIPT]: "JavaScript",
  [CodeLanguage.JAVA]: "Java",
  [CodeLanguage.CPP]: "C++",
  [CodeLanguage.C]: "C",
};

/**
 * The source filename Piston should use per language. Java in particular needs
 * a `.java` extension (and its public class is conventionally `Main`).
 */
export const PISTON_SOURCE_FILENAME: Record<CodeLanguage, string> = {
  [CodeLanguage.PYTHON]: "main.py",
  [CodeLanguage.JAVASCRIPT]: "main.js",
  [CodeLanguage.JAVA]: "Main.java",
  [CodeLanguage.CPP]: "main.cpp",
  [CodeLanguage.C]: "main.c",
};

/** Safety limits for the submit endpoint (bytes / counts). */
export const MAX_SOURCE_BYTES = 64 * 1024; // 64 KB of source
export const MAX_STDIN_BYTES = 16 * 1024; // 16 KB of stdin
export const MAX_TEST_CASES = 50;

/** Execution submissions allowed per user inside the rate-limit window. */
export const EXECUTE_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const EXECUTE_RATE_LIMIT_MAX = 30;

/** Machine-readable codes for the execution surface (UI can switch on these). */
export const ExecutionErrorCode = {
  JOB_NOT_FOUND: "JOB_NOT_FOUND",
  /** The job exists but belongs to another user. */
  JOB_FORBIDDEN: "JOB_FORBIDDEN",
  /** Too many submissions in the rate-limit window. */
  RATE_LIMITED: "RATE_LIMITED",
} as const;
export type ExecutionErrorCode =
  (typeof ExecutionErrorCode)[keyof typeof ExecutionErrorCode];

// ---------------------------------------------------------------------------
// Essay scoring weights. Rebalanced from the original Django engine to weight
// mechanics (grammar+spelling+punctuation) at 22% (was 15%) — now that spelling
// is a real dictionary check — and trim vocabulary (0.30 → 0.22); structure and
// relevance unchanged in intent. Sum of weights MUST remain 1.00 (asserted in a
// test). Original: grammar .08, spelling .03, punctuation .04, readability .05,
// vocabulary .30, structure .25, relevance .25.
// ---------------------------------------------------------------------------

export const ESSAY_SCORE_WEIGHTS = {
  grammar: 0.12,
  spelling: 0.05,
  punctuation: 0.05,
  readability: 0.08,
  vocabulary: 0.22,
  structure: 0.23,
  relevance: 0.25,
} as const;
export type EssayScoreDimension = keyof typeof ESSAY_SCORE_WEIGHTS;

/** +5 bonus if vocabulary, structure, and relevance are ALL >= this threshold. */
export const ESSAY_BONUS_THRESHOLD = 80;
export const ESSAY_BONUS_POINTS = 5;

/**
 * Per-dimension LLM blend weights: a blended sub-score is
 * `deterministic * (1 - b) + llm * b` for the dimension's `b`. ONLY these three
 * "judgment" dimensions are AI-influenced — mechanics (grammar/spelling/
 * punctuation/readability) stay fully deterministic and are never in this map.
 * Relevance leans on the LLM (0.6) because keyword-matching is the weakest
 * deterministic signal. Tunable here.
 */
export const ESSAY_AI_BLEND = {
  vocabulary: 0.5,
  structure: 0.5,
  relevance: 0.6,
} as const;

// ---------------------------------------------------------------------------
// Email scoring weights (Communication module, Round 2 scenario email). The
// email rubric EXTENDS the essay engine rather than replacing it: the four
// mechanics dimensions (grammar/spelling/punctuation/readability) are the SAME
// analyzers and the same concerns, so an email score is directly comparable to
// an essay score. The three essay "meaning" dimensions (vocabulary/structure/
// relevance) are swapped for four email-specific ones — `format` (subject line,
// salutation, sign-off, paragraphing, length), `register` (no contractions/
// slang/ALL-CAPS shouting), `content` (addresses the scenario + clear CTA), and
// `tone` (right for the recipient). Weights are REBALANCED for email: subject
// line and structure matter more than readability, and content carries the most
// weight. Sum MUST remain 1.00 (asserted in a test).
// ---------------------------------------------------------------------------

export const EMAIL_SCORE_WEIGHTS = {
  grammar: 0.12,
  spelling: 0.05,
  punctuation: 0.05,
  readability: 0.05,
  format: 0.18,
  register: 0.1,
  content: 0.28,
  tone: 0.17,
} as const;
export type EmailScoreDimension = keyof typeof EMAIL_SCORE_WEIGHTS;

/**
 * Per-dimension LLM blend weights for email. ONLY `content` and `tone` are
 * AI-influenced — the four mechanics dimensions AND the two structural
 * deterministic dimensions (`format`, `register`) are never in this map, so the
 * LLM can only refine judgement, never mechanics or structure. `content` leans
 * hardest on the LLM (0.6) because "does it actually address the scenario and
 * state a clear call-to-action" is a judgement the deterministic keyword-
 * coverage baseline only approximates. Each blended sub-score is
 * `deterministic * (1 - b) + llm * b`.
 */
export const EMAIL_AI_BLEND = {
  content: 0.6,
  tone: 0.5,
} as const;

/** +5 bonus if content, format, AND tone are ALL >= ESSAY_BONUS_THRESHOLD. */
export const EMAIL_BONUS_DIMENSIONS = ["content", "format", "tone"] as const;

/** Feature flags for the AI grading path (defaults match the original). */
export const ESSAY_AI_FLAGS = {
  ENABLE_AI_FEEDBACK: true,
  ENABLE_AI_VOCAB: false,
  ENABLE_AI_STRUCTURE: false,
} as const;

/** Submission length bounds enforced when a topic sets no explicit min/max. */
export const ESSAY_DEFAULT_MIN_WORDS = 1;
export const ESSAY_MAX_CONTENT_CHARS = 50_000; // hard ceiling (abuse guard)

/** Essay submissions allowed per user inside the rate-limit window. */
export const ESSAY_SUBMIT_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const ESSAY_SUBMIT_RATE_LIMIT_MAX = 10;

/** Machine-readable codes for the essay surface (UI switches on these). */
export const EssayErrorCode = {
  /** No active EssayTopic with that id in an enrolled subject. */
  ESSAY_NOT_FOUND: "ESSAY_NOT_FOUND",
  /** The submission/attempt does not exist. */
  SUBMISSION_NOT_FOUND: "SUBMISSION_NOT_FOUND",
  /** Caller is not the owner of the submission. */
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  /** Content shorter than the topic's minWords / longer than maxWords. */
  LENGTH_OUT_OF_RANGE: "LENGTH_OUT_OF_RANGE",
  /** Not enrolled in a subject that carries this essay topic. */
  NOT_ENROLLED: "NOT_ENROLLED",
  /** Too many submissions in the rate-limit window. */
  RATE_LIMITED: "RATE_LIMITED",
  /** The per-topic attempt cap (EssayTopic.maxAttempts) is exhausted. */
  ATTEMPT_LIMIT_REACHED: "ATTEMPT_LIMIT_REACHED",
} as const;
export type EssayErrorCode =
  (typeof EssayErrorCode)[keyof typeof EssayErrorCode];

/** Machine-readable codes for the essay-topic ADMIN surface. */
export const EssayTopicErrorCode = {
  ESSAY_TOPIC_NOT_FOUND: "ESSAY_TOPIC_NOT_FOUND",
  /**
   * Hard-delete refused because student attempts reference the prompt
   * (details.blockers). Same code the other admins use so the web blocker
   * dialog renders it; deactivation is the retire path.
   */
  DELETE_BLOCKED: "DELETE_BLOCKED",
} as const;
export type EssayTopicErrorCode =
  (typeof EssayTopicErrorCode)[keyof typeof EssayTopicErrorCode];

// ---------------------------------------------------------------------------
// Misc shared constants
// ---------------------------------------------------------------------------

/** IST offset — display concern only; all storage is UTC. */
export const IST_OFFSET_MINUTES = 330; // UTC+05:30

// ---------------------------------------------------------------------------
// AI GOVERNOR (Stage-2) — global free-tier pool protection.
// Percentages of the COMBINED daily provider pool. `reservePercent` is a hard
// floor college DEFERRABLE AI may never consume into; `platformReservePercent`
// is a smaller slice only PLATFORM-critical jobs (daily-challenge) may use, and
// the floor below which even college INTERACTIVE grading is shed. `shedThreshold`
// is the headroom below which deferrable college AI is deferred to the paced
// queue. Sensible super-admin-tunable defaults; the governor is ON by default.
// ---------------------------------------------------------------------------
export const AI_GOVERNOR_DEFAULTS = {
  enabled: true,
  /** Keep ≥20% of the combined daily pool free from college deferrable AI. */
  reservePercent: 20,
  /** A 10% slice only platform-critical jobs may dip into (grading floor). */
  platformReservePercent: 10,
  /** Below 30% combined headroom, deferrable college AI is deferred/paced. */
  shedThreshold: 30,
} as const;

/**
 * Max deferred (paced) AI calls the paced-queue worker drains per minute. Set
 * conservatively below typical free-tier per-minute limits so draining the
 * backlog never rate-limits everyone. Enforced by the paced worker's BullMQ
 * limiter; surfaced read-only on the governor panel. Tunable here (code-level).
 */
export const AI_PACED_MAX_PER_MINUTE = 10;

/**
 * Max coding-profile STUDENT refresh jobs the coding-refresh worker drains per
 * minute. Each job makes a small number of outbound calls (one per linked
 * platform), so this paces the daily sweep well under the coding platforms'
 * limits. Enforced by the worker's BullMQ limiter; tunable here (code-level).
 */
export const CODING_REFRESH_MAX_PER_MINUTE = 20;

/** Assessments: malpractice flag raised when warnings exceed this count. */
export const EXAM_MAX_WARNINGS = 2;

/** Default score awarded for a correct daily/quiz MCQ. */
export const MCQ_CORRECT_MARKS = 5;

/** API route prefix. */
export const API_PREFIX = "/api";

// ---------------------------------------------------------------------------
// Machine-readable error codes for the auth surface.
// The UI switches on `error.code`; e.g. FORCE_PASSWORD_CHANGE => route to the
// change-password screen. All auth failures use INVALID_CREDENTIALS to avoid
// user enumeration.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Curriculum / LMS
// ---------------------------------------------------------------------------

/** Machine-readable codes for the curriculum surface (UI switches on these). */
export const CurriculumErrorCode = {
  SUBJECT_NOT_FOUND: "SUBJECT_NOT_FOUND",
  TOPIC_NOT_FOUND: "TOPIC_NOT_FOUND",
  /** Content/quiz route hit without an enrollment. */
  NOT_ENROLLED: "NOT_ENROLLED",
  /** Enroll attempted on a paid subject (checkout arrives in the payments step). */
  PAYMENT_REQUIRED: "PAYMENT_REQUIRED",
  /** Topic is not a quiz topic. */
  NOT_A_QUIZ: "NOT_A_QUIZ",
  /** Program not found (admin authoring). */
  PROGRAM_NOT_FOUND: "PROGRAM_NOT_FOUND",
  /** Module not found (admin authoring). */
  MODULE_NOT_FOUND: "MODULE_NOT_FOUND",
  /** A slug (program/subject) is already in use. */
  SLUG_TAKEN: "SLUG_TAKEN",
  /** Destructive delete blocked by dependent data (details lists the blockers). */
  DELETE_BLOCKED: "DELETE_BLOCKED",
  /** Quiz question not found (admin authoring). */
  QUESTION_NOT_FOUND: "QUESTION_NOT_FOUND",
  /** A topic's type cannot be changed after creation (would strand its sub-tree). */
  TOPIC_TYPE_IMMUTABLE: "TOPIC_TYPE_IMMUTABLE",
} as const;
export type CurriculumErrorCode =
  (typeof CurriculumErrorCode)[keyof typeof CurriculumErrorCode];

// ---------------------------------------------------------------------------
// Payments / coupons
// ---------------------------------------------------------------------------

/** Machine-readable codes for the payments surface (UI switches on these). */
export const PaymentErrorCode = {
  /** Subject id was not found / not visible. */
  SUBJECT_NOT_FOUND: "SUBJECT_NOT_FOUND",
  /** Subject is free — nothing to pay for. */
  SUBJECT_FREE: "SUBJECT_FREE",
  /** The user already owns (is enrolled in) this subject. */
  ALREADY_ENROLLED: "ALREADY_ENROLLED",
  /** Order id not found. */
  ORDER_NOT_FOUND: "ORDER_NOT_FOUND",
  /** Caller does not own this order. */
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  /** The coupon code could not be applied (see the coupon reason). */
  COUPON_REJECTED: "COUPON_REJECTED",
  /** The payment gateway call failed. */
  GATEWAY_ERROR: "GATEWAY_ERROR",
  /** Callback signature did not verify. */
  INVALID_SIGNATURE: "INVALID_SIGNATURE",
  /** Too many order-creation attempts in the window. */
  RATE_LIMITED: "RATE_LIMITED",
  /** A mock-only affordance was hit while the real gateway is selected. */
  MOCK_DISABLED: "MOCK_DISABLED",
} as const;
export type PaymentErrorCode =
  (typeof PaymentErrorCode)[keyof typeof PaymentErrorCode];

/** Machine-readable codes for the coupon ADMIN surface (UI switches on these). */
export const CouponErrorCode = {
  COUPON_NOT_FOUND: "COUPON_NOT_FOUND",
  /** Another coupon already uses this code. */
  CODE_TAKEN: "CODE_TAKEN",
  /** Scope subject id not found. */
  SUBJECT_NOT_FOUND: "SUBJECT_NOT_FOUND",
  /**
   * Hard-delete refused because orders reference the coupon (details.blockers).
   * Same code the curriculum admin uses so the web blocker dialog renders it.
   */
  DELETE_BLOCKED: "DELETE_BLOCKED",
} as const;
export type CouponErrorCode =
  (typeof CouponErrorCode)[keyof typeof CouponErrorCode];

/**
 * Structured reasons a coupon is rejected. The pure engine returns the
 * window/threshold/active reasons; the service adds the DB-backed usage ones.
 */
export const CouponRejectReason = {
  NOT_FOUND: "not-found",
  INACTIVE: "inactive",
  NOT_YET_VALID: "not-yet-valid",
  EXPIRED: "expired",
  MIN_ORDER_NOT_MET: "min-order-not-met",
  SUBJECT_MISMATCH: "subject-mismatch",
  USAGE_EXHAUSTED: "usage-exhausted",
  PER_USER_LIMIT: "per-user-limit",
} as const;
export type CouponRejectReason =
  (typeof CouponRejectReason)[keyof typeof CouponRejectReason];
export const COUPON_REJECT_REASON_VALUES = Object.values(CouponRejectReason);

/** Order-creation attempts allowed per user inside the rate-limit window. */
export const PAYMENT_ORDER_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const PAYMENT_ORDER_RATE_LIMIT_MAX = 10;

/** Outcome of a (free-path) enroll request. */
export const EnrollResult = {
  ENROLLED: "ENROLLED",
  ALREADY_ENROLLED: "ALREADY_ENROLLED",
} as const;
export type EnrollResult = (typeof EnrollResult)[keyof typeof EnrollResult];

/** How an enrollment was created. */
export const EnrollmentSource = {
  ORDER: "order",
  MANUAL: "manual",
  /** Assigned by a college to one of its students (Phase 4a). Tenant-scoped. */
  COLLEGE: "college",
} as const;
export type EnrollmentSource =
  (typeof EnrollmentSource)[keyof typeof EnrollmentSource];
export const ENROLLMENT_SOURCE_VALUES = Object.values(EnrollmentSource);

// ---------------------------------------------------------------------------
// Assessments / mock exams
// ---------------------------------------------------------------------------

/** Machine-readable codes for the assessment surface. */
export const ExamErrorCode = {
  EXAM_NOT_FOUND: "EXAM_NOT_FOUND",
  ATTEMPT_NOT_FOUND: "ATTEMPT_NOT_FOUND",
  /** Per-user attempt limit hit (ExamAttemptCounter). */
  ATTEMPT_LIMIT_REACHED: "ATTEMPT_LIMIT_REACHED",
  /** The current section's server clock has run out. */
  SECTION_EXPIRED: "SECTION_EXPIRED",
  /** Attempt is already submitted/graded — no more section edits. */
  ALREADY_SUBMITTED: "ALREADY_SUBMITTED",
  /** Public link inactive or outside its start/end window. */
  LINK_UNAVAILABLE: "LINK_UNAVAILABLE",
  /** This exam/link is code-gated and no code was supplied. */
  ACCESS_CODE_REQUIRED: "ACCESS_CODE_REQUIRED",
  /** The supplied start code did not match. */
  ACCESS_CODE_INVALID: "ACCESS_CODE_INVALID",
  /** Caller is neither the attempt's owner nor holds its attempt token. */
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  /** No next section to advance into. */
  NO_NEXT_SECTION: "NO_NEXT_SECTION",
  /** Grading not finished yet (code jobs still running). */
  GRADING_PENDING: "GRADING_PENDING",
  /**
   * Hard-delete refused because student attempts reference the exam
   * (details.blockers). Same code the other admins use so the web blocker
   * dialog renders it; delete a future/unattempted exam instead.
   */
  DELETE_BLOCKED: "DELETE_BLOCKED",
} as const;
export type ExamErrorCode = (typeof ExamErrorCode)[keyof typeof ExamErrorCode];

// ---------------------------------------------------------------------------
// Gaming (adaptive game engine)
// ---------------------------------------------------------------------------

/** Default per-game clock (Cognizant/Capgemini gaming round = 6 minutes). */
export const GAME_DEFAULT_CLOCK_SECONDS = 360;

/** Absolute ceiling on items served in one game, regardless of maxQuestions
 * (0 = unlimited). Well above the ~20-40 a real student clears in 6 minutes,
 * low enough to bound the GameAttempt document. Hitting it completes the game
 * exactly like maxQuestions. */
export const GAME_MAX_SERVED_ITEMS = 300;

/** Absolute ceiling on PROBE moves for a single interactive item (door_key).
 * A player exploring a 6×6 maze by bumping invisible walls needs many moves —
 * far more than the ~6-12 optimal — but never hundreds; 500 bounds the served
 * document (its `dirs`/`bumped` history) and stops a runaway/looping client,
 * while leaving honest sensing play unconstrained. Hitting it resolves the item
 * `wrong`, exactly like running out of clock. */
export const GAME_MAX_PROBES_PER_ITEM = 500;

/** Marks awarded for a CORRECT answer, by the difficulty of the item answered.
 * No negative marking anywhere; a wrong/skip/expired answer awards 0. This is the
 * LADDER scoring every game uses EXCEPT a game that declares custom `settle`. */
export const GAME_DIFFICULTY_MARKS = {
  easy: 1,
  moderate: 2,
  hard: 3,
} as const;

/**
 * Grid Challenge scoring + shape (the ONLY game with a penalty; see grid-challenge.ts).
 * Faithful to the live technicalhub portal: three interleaved cycles, each a 2s
 * highlight memorise + a 6s rotation judgement, then an ordered recall — every
 * answer is +3 correct / -1 wrong. These are game constants, not authorable: the
 * portal holds 2s/6s constant, so we vary difficulty by circle count / pattern
 * density only. The per-game score MAY go negative; the set composite floors at 0
 * (the per-game raw is preserved for operators). */
export const GRID_CHALLENGE = {
  CYCLES: 3,
  /** Client display windows (ms). Server enforces one-time exposure, not the clock. */
  HIGHLIGHT_MS: 2000,
  SYMMETRY_MS: 6000,
  PATTERN_SIZE: 5, // 5x5 rotation patterns
  MARKS_CORRECT: 3,
  MARKS_WRONG: -1,
  /** Min separation between free-floating circle centres, in normalised units
   * (positions live in a 0..100 box); keeps ~20 circles from overlapping. */
  MIN_SEPARATION: 9,
} as const;

/** Machine-readable codes for the gaming surface (UI switches on these). */
export const GameErrorCode = {
  GAME_SET_NOT_FOUND: "GAME_SET_NOT_FOUND",
  ATTEMPT_NOT_FOUND: "ATTEMPT_NOT_FOUND",
  /** Per-user attempt limit for this game set has been reached. */
  ATTEMPT_LIMIT_REACHED: "ATTEMPT_LIMIT_REACHED",
  /** A skip was attempted on a game whose mechanics forbid skipping. */
  SKIP_NOT_ALLOWED: "SKIP_NOT_ALLOWED",
  /** Practice-mode reveal requested but instantFeedback is off for this set. */
  PRACTICE_MODE_OFF: "PRACTICE_MODE_OFF",
  /** Practice-mode reveal requested for an item that hasn't been answered yet. */
  ITEM_NOT_ANSWERED: "ITEM_NOT_ANSWERED",
  /** Caller is neither the attempt's owner nor holds its attempt token. */
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  /** The item's game clock has run out — the answer is recorded as `expired`. */
  GAME_EXPIRED: "GAME_EXPIRED",
  /** Answering an item that does not belong to the game currently in play. */
  NOT_CURRENT_GAME: "NOT_CURRENT_GAME",
  /** The referenced served-item index does not exist on this game attempt. */
  ITEM_NOT_FOUND: "ITEM_NOT_FOUND",
  /** Cannot advance: the current game is still in progress (clock not expired). */
  GAME_IN_PROGRESS: "GAME_IN_PROGRESS",
  /** No further game to advance into — the set is finished. */
  NO_NEXT_GAME: "NO_NEXT_GAME",
  /** Attempt already graded — no more play. */
  ALREADY_GRADED: "ALREADY_GRADED",
  /** Publishing refused (e.g. no games, or a bad random_n_of_pool pickCount). */
  GAME_SET_NOT_PUBLISHABLE: "GAME_SET_NOT_PUBLISHABLE",
  /** A referenced target org-unit is unknown in this college / out of scope. */
  ORG_UNIT_OUT_OF_SCOPE: "ORG_UNIT_OUT_OF_SCOPE",
  /** A `probe` was sent to a game that is not interactive (one-shot only). */
  NOT_INTERACTIVE: "NOT_INTERACTIVE",
  /** An `answer` was sent to an INTERACTIVE game — it must be played via probe. */
  NOT_ONE_SHOT: "NOT_ONE_SHOT",
  /** A probe action failed validation (malformed move payload). */
  INVALID_PROBE: "INVALID_PROBE",
  /** A referenced curriculum topic (for a course-attached set) was not found. */
  TOPIC_NOT_FOUND: "TOPIC_NOT_FOUND",
  /** The referenced topic exists but is not a GAME topic. */
  TOPIC_NOT_GAME: "TOPIC_NOT_GAME",
  /** That GAME topic already owns a game set (1:1). */
  TOPIC_ALREADY_ATTACHED: "TOPIC_ALREADY_ATTACHED",
  /** Invalid GameSet shape — a tenant (college) set cannot also carry a topic. */
  INVALID_GAME_SET_SHAPE: "INVALID_GAME_SET_SHAPE",
  /** The client reported its clock expired but the SERVER clock disagrees — the
   * item is still live, so no outcome is recorded (the client keeps playing). */
  GAME_NOT_EXPIRED: "GAME_NOT_EXPIRED",
} as const;
export type GameErrorCode = (typeof GameErrorCode)[keyof typeof GameErrorCode];

/** Machine-readable codes for the Speaking (Communication A/B) surface. */
export const SpeakingErrorCode = {
  ASSESSMENT_NOT_FOUND: "ASSESSMENT_NOT_FOUND",
  ATTEMPT_NOT_FOUND: "ATTEMPT_NOT_FOUND",
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  /** Per-user attempt cap for this assessment reached. */
  ATTEMPT_LIMIT_REACHED: "ATTEMPT_LIMIT_REACHED",
  /** A referenced item index does not exist on this assessment. */
  ITEM_NOT_FOUND: "ITEM_NOT_FOUND",
  /** That item was already submitted (no re-record — one recording per item). */
  ITEM_ALREADY_SUBMITTED: "ITEM_ALREADY_SUBMITTED",
  /** The attempt's server deadline passed — it cannot be read or written. */
  ATTEMPT_EXPIRED: "ATTEMPT_EXPIRED",
  /** Submit/read for an item other than the attempt's current index. */
  NOT_CURRENT_ITEM: "NOT_CURRENT_ITEM",
  /** A referenced target org-unit is unknown in this college / out of scope. */
  ORG_UNIT_OUT_OF_SCOPE: "ORG_UNIT_OUT_OF_SCOPE",
  /** Publishing refused (e.g. no items). */
  NOT_PUBLISHABLE: "NOT_PUBLISHABLE",
  /** Delete refused (published, or has attempts). */
  NOT_DELETABLE: "NOT_DELETABLE",
  /** Authoring-time TTS could not synthesize/host the clip (service unconfigured
   *  or a Piper/Cloudinary failure). */
  TTS_UNAVAILABLE: "TTS_UNAVAILABLE",
} as const;
export type SpeakingErrorCode =
  (typeof SpeakingErrorCode)[keyof typeof SpeakingErrorCode];

/** CommunicationAssessment composite (Step 21). */
export const CommunicationErrorCode = {
  ASSESSMENT_NOT_FOUND: "ASSESSMENT_NOT_FOUND",
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  /** A referenced part order does not exist on this assessment. */
  PART_NOT_FOUND: "PART_NOT_FOUND",
  /** The part's gate (requiresPrevious / availableFrom) is not yet satisfied —
   *  it cannot be launched. Enforced at the composite API, not just the UI. */
  PART_LOCKED: "PART_LOCKED",
  /** A part references an artifact that is missing / unpublished / the wrong
   *  type — authoring is refused; at read time the part shows `unavailable`. */
  INVALID_PART_REF: "INVALID_PART_REF",
  /** A referenced target org-unit is unknown in this college / out of scope. */
  ORG_UNIT_OUT_OF_SCOPE: "ORG_UNIT_OUT_OF_SCOPE",
  /** Publishing refused (e.g. no parts, or a part ref no longer resolves). */
  NOT_PUBLISHABLE: "NOT_PUBLISHABLE",
  /** Delete refused (published). */
  NOT_DELETABLE: "NOT_DELETABLE",
} as const;
export type CommunicationErrorCode =
  (typeof CommunicationErrorCode)[keyof typeof CommunicationErrorCode];

/**
 * Anonymous public-exam starts allowed per IP inside the window. Set high
 * because a whole lab/campus of takers usually shares ONE public IP (NAT) — a
 * low cap locks out a legitimate cohort starting together ("too many attempts
 * from this network").
 */
export const PUBLIC_EXAM_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const PUBLIC_EXAM_RATE_LIMIT_MAX = 500;

// ---------------------------------------------------------------------------
// Daily challenges
// ---------------------------------------------------------------------------

/** Machine-readable codes for the daily-challenge surface. */
export const ChallengeErrorCode = {
  /** No DailyQuestion released for the current IST day. */
  NO_CHALLENGE_TODAY: "NO_CHALLENGE_TODAY",
  /** A scoring submission already exists for today (one per user per day). */
  ALREADY_ATTEMPTED: "ALREADY_ATTEMPTED",
  /** submit-mcq called on a CODE question (or vice versa). */
  WRONG_QUESTION_TYPE: "WRONG_QUESTION_TYPE",
  /** The execution job does not belong to this user / today's question. */
  JOB_NOT_FOUND: "JOB_NOT_FOUND",
  /** Admin: no DailyQuestion with the given id. */
  QUESTION_NOT_FOUND: "QUESTION_NOT_FOUND",
  /** Admin: another challenge is already scheduled on that release date. */
  DATE_TAKEN: "DATE_TAKEN",
  /**
   * Admin: hard-delete refused because scored submissions reference the
   * question (details.blockers). Same code the other admins use so the web
   * blocker dialog renders it. Challenges have no active flag — reschedule
   * (edit the date) or delete a future one before anyone attempts it.
   */
  DELETE_BLOCKED: "DELETE_BLOCKED",
} as const;
export type ChallengeErrorCode =
  (typeof ChallengeErrorCode)[keyof typeof ChallengeErrorCode];

/** User admin (read/reporting + CONFIG mutations). */
export const UserAdminErrorCode = {
  /** No user with the given id. */
  USER_NOT_FOUND: "USER_NOT_FOUND",
  /** Admin tried to deactivate/demote their own account. */
  SELF_ACTION_FORBIDDEN: "SELF_ACTION_FORBIDDEN",
  /** Action would leave the system with no active admin. */
  LAST_ADMIN: "LAST_ADMIN",
  /** Another profile already uses this roll number. */
  ROLL_TAKEN: "ROLL_TAKEN",
  /** No enrollment of this user in the given subject. */
  ENROLLMENT_NOT_FOUND: "ENROLLMENT_NOT_FOUND",
} as const;
export type UserAdminErrorCode =
  (typeof UserAdminErrorCode)[keyof typeof UserAdminErrorCode];

/** Leaderboard pagination (fixes the original's hard 20 cap). */
export const LEADERBOARD_DEFAULT_PAGE_SIZE = 20;
export const LEADERBOARD_MAX_PAGE_SIZE = 100;

// ---------------------------------------------------------------------------
// Careers / placements
// ---------------------------------------------------------------------------

/** Machine-readable codes for the careers surface (UI switches on these). */
export const CareerErrorCode = {
  POSTING_NOT_FOUND: "POSTING_NOT_FOUND",
  /** Posting is unpublished/inactive. */
  POSTING_CLOSED: "POSTING_CLOSED",
  /** The application deadline has passed. */
  DEADLINE_PASSED: "DEADLINE_PASSED",
  /** The caller already applied to this posting. */
  ALREADY_APPLIED: "ALREADY_APPLIED",
  /**
   * Reserved: the source has NO eligibility rules (CGPA/branch/batch), so this
   * is never currently emitted. Kept for forward-compat if rules are added.
   */
  NOT_ELIGIBLE: "NOT_ELIGIBLE",
  /** Application id not found. */
  APPLICATION_NOT_FOUND: "APPLICATION_NOT_FOUND",
  /** Caller does not own this application. */
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  /** Status not in the allowed set. */
  INVALID_STATUS: "INVALID_STATUS",
  /**
   * Hard-delete refused because applications reference the posting
   * (details.blockers). Close the posting instead to retire it without
   * destroying application history.
   */
  DELETE_BLOCKED: "DELETE_BLOCKED",
} as const;
export type CareerErrorCode =
  (typeof CareerErrorCode)[keyof typeof CareerErrorCode];

/** Careers listing pagination. */
export const CAREERS_DEFAULT_PAGE_SIZE = 12;
export const CAREERS_MAX_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Orders (ledger read — CRUD batch 3a)
// ---------------------------------------------------------------------------

/** Machine-readable codes for the order admin read surface. */
export const OrderErrorCode = {
  /** No order with the given id. */
  ORDER_NOT_FOUND: "ORDER_NOT_FOUND",
} as const;
export type OrderErrorCode =
  (typeof OrderErrorCode)[keyof typeof OrderErrorCode];

/** Order admin list pagination. */
export const ADMIN_ORDERS_DEFAULT_PAGE_SIZE = 20;
export const ADMIN_ORDERS_MAX_PAGE_SIZE = 100;

// ---------------------------------------------------------------------------
// Image uploads (Cloudinary signed uploads)
// ---------------------------------------------------------------------------

/** Machine-readable codes for the signed-upload surface. */
export const UploadErrorCode = {
  /**
   * Cloudinary env vars are not set on the server. Surfaced (503) so the UI can
   * tell the admin to configure them / fall back to pasting a URL — the secret
   * is never involved.
   */
  UPLOAD_NOT_CONFIGURED: "UPLOAD_NOT_CONFIGURED",
} as const;
export type UploadErrorCode =
  (typeof UploadErrorCode)[keyof typeof UploadErrorCode];

/** Cloudinary folder all app uploads are signed into (server-controlled). */
export const CLOUDINARY_UPLOAD_FOLDER = "codeapt";

export const AuthErrorCode = {
  /** No/invalid credentials presented where auth is required. */
  UNAUTHENTICATED: "UNAUTHENTICATED",
  /** Login failed — deliberately generic (email/username existence hidden). */
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  /** Access/refresh token is expired. */
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  /** Token signature/shape is invalid. */
  TOKEN_INVALID: "TOKEN_INVALID",
  /** Token's tokenVersion is stale (all sessions revoked). */
  TOKEN_REVOKED: "TOKEN_REVOKED",
  /** A rotated/old refresh token was replayed — session killed. */
  TOKEN_REUSE_DETECTED: "TOKEN_REUSE_DETECTED",
  /** Refresh session was logged out or expired. */
  SESSION_REVOKED: "SESSION_REVOKED",
  /** User must change their password before accessing protected routes. */
  FORCE_PASSWORD_CHANGE: "FORCE_PASSWORD_CHANGE",
  /** Account is deactivated. */
  ACCOUNT_DISABLED: "ACCOUNT_DISABLED",
  /** Authenticated but lacks the required role. */
  FORBIDDEN: "FORBIDDEN",
  /** Registration/update conflict on a unique field. */
  EMAIL_TAKEN: "EMAIL_TAKEN",
  USERNAME_TAKEN: "USERNAME_TAKEN",
  ROLL_NUMBER_TAKEN: "ROLL_NUMBER_TAKEN",
} as const;
export type AuthErrorCode = (typeof AuthErrorCode)[keyof typeof AuthErrorCode];

/**
 * Multi-tenant (college) errors. The tenancy layer is a hard security boundary;
 * every denial returns one of these typed codes so clients can react precisely.
 * See docs/MULTI_TENANT_ARCHITECTURE.md.
 */
export const TenantErrorCode = {
  /** No college could be resolved for the request path. */
  COLLEGE_NOT_FOUND: "COLLEGE_NOT_FOUND",
  /** The college exists but is suspended — access blocked. */
  COLLEGE_SUSPENDED: "COLLEGE_SUSPENDED",
  /** Slug collision when provisioning a college. */
  COLLEGE_SLUG_TAKEN: "COLLEGE_SLUG_TAKEN",
  /** The authenticated user does not belong to the resolved college. */
  CROSS_TENANT_DENIED: "CROSS_TENANT_DENIED",
  /** A college-scoped query/action was attempted without a tenant context. */
  TENANT_CONTEXT_REQUIRED: "TENANT_CONTEXT_REQUIRED",
  /** The college does not have the required FEATURE entitlement enabled. */
  FEATURE_NOT_ENABLED: "FEATURE_NOT_ENABLED",
  /** The feature is on but the required SUB-CAPABILITY is not enabled. */
  SUB_CAPABILITY_NOT_ENABLED: "SUB_CAPABILITY_NOT_ENABLED",
  /** The requested master-catalog course is not granted to the college. */
  COURSE_NOT_GRANTED: "COURSE_NOT_GRANTED",
} as const;
export type TenantErrorCode =
  (typeof TenantErrorCode)[keyof typeof TenantErrorCode];

/** Org-structure (OrgUnit) errors — Phase 2. All within a tenant boundary. */
export const OrgUnitErrorCode = {
  ORG_UNIT_NOT_FOUND: "ORG_UNIT_NOT_FOUND",
  /** Sibling name collision under the same parent + college. */
  ORG_UNIT_NAME_TAKEN: "ORG_UNIT_NAME_TAKEN",
  /** parent→child type nesting is not allowed, or parent is foreign/unknown. */
  ORG_UNIT_INVALID_PARENT: "ORG_UNIT_INVALID_PARENT",
  /** Re-parenting would create a cycle. */
  ORG_UNIT_CYCLE: "ORG_UNIT_CYCLE",
  /** Delete blocked because the unit still has child units. */
  ORG_UNIT_HAS_CHILDREN: "ORG_UNIT_HAS_CHILDREN",
  /** Delete blocked because the unit still has students assigned (Phase 3). */
  ORG_UNIT_HAS_STUDENTS: "ORG_UNIT_HAS_STUDENTS",
} as const;
export type OrgUnitErrorCode =
  (typeof OrgUnitErrorCode)[keyof typeof OrgUnitErrorCode];

/** Faculty management errors — Phase 2. */
export const FacultyErrorCode = {
  FACULTY_NOT_FOUND: "FACULTY_NOT_FOUND",
  /** An assigned org-unit is unknown or belongs to another college. */
  FACULTY_SCOPE_INVALID: "FACULTY_SCOPE_INVALID",
  USERNAME_TAKEN: "USERNAME_TAKEN",
  EMAIL_TAKEN: "EMAIL_TAKEN",
} as const;
export type FacultyErrorCode =
  (typeof FacultyErrorCode)[keyof typeof FacultyErrorCode];

/** College-student + import errors — Phase 3. */
export const StudentErrorCode = {
  STUDENT_NOT_FOUND: "STUDENT_NOT_FOUND",
  /** A roll number already exists WITHIN this college (per-college unique). */
  ROLL_NUMBER_TAKEN: "ROLL_NUMBER_TAKEN",
  EMAIL_TAKEN: "EMAIL_TAKEN",
  USERNAME_TAKEN: "USERNAME_TAKEN",
  /** No assigned org-unit was provided for the student. */
  ORG_UNIT_REQUIRED: "ORG_UNIT_REQUIRED",
  /** The org-unit is unknown in this college, or outside the actor's scope. */
  ORG_UNIT_OUT_OF_SCOPE: "ORG_UNIT_OUT_OF_SCOPE",
} as const;
export type StudentErrorCode =
  (typeof StudentErrorCode)[keyof typeof StudentErrorCode];

/** Attendance module errors (Prompt 1 — groups). Tenant + scope enforced. */
export const AttendanceErrorCode = {
  /** No attendance group with that id in this college. */
  GROUP_NOT_FOUND: "GROUP_NOT_FOUND",
  /** A group with that name already exists in this college. */
  GROUP_NAME_TAKEN: "GROUP_NAME_TAKEN",
  /** A targeted org-unit / student is outside the actor's faculty scope AND the
   * college has not granted faculty the cross-cutting-groups permission. */
  OUT_OF_SCOPE: "OUT_OF_SCOPE",
  /** A referenced org-unit was not found in this college. */
  ORG_UNIT_NOT_FOUND: "ORG_UNIT_NOT_FOUND",
  /** A referenced student was not found in this college. */
  STUDENT_NOT_FOUND: "STUDENT_NOT_FOUND",
  /** The student is not a member of the group (remove-member). */
  MEMBER_NOT_FOUND: "MEMBER_NOT_FOUND",
  /** No attendance session with that id in this college (Prompt 2). */
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  /** No photo with that id on the session (optional session photos). */
  PHOTO_NOT_FOUND: "PHOTO_NOT_FOUND",
} as const;
export type AttendanceErrorCode =
  (typeof AttendanceErrorCode)[keyof typeof AttendanceErrorCode];

/** Machine-readable codes for per-student AI credit distribution. */
export const AiCreditErrorCode = {
  /** Allocating this amount would exceed the college's distributable pool. */
  OVER_ALLOCATION: "OVER_ALLOCATION",
  /** A selected student was not found in this college. */
  STUDENT_NOT_FOUND: "STUDENT_NOT_FOUND",
  /** A referenced org-unit was not found in this college. */
  ORG_UNIT_NOT_FOUND: "ORG_UNIT_NOT_FOUND",
} as const;
export type AiCreditErrorCode =
  (typeof AiCreditErrorCode)[keyof typeof AiCreditErrorCode];

/** Machine-readable codes for the coding-profile surface (UI switches on these). */
export const CodingProfileErrorCode = {
  /** The caller is not a college student — only students keep coding profiles. */
  NOT_A_STUDENT: "NOT_A_STUDENT",
  /** No coding profile / linked student with that id in this college. */
  PROFILE_NOT_FOUND: "PROFILE_NOT_FOUND",
  /** A referenced student was not found in this college (admin refresh). */
  STUDENT_NOT_FOUND: "STUDENT_NOT_FOUND",
} as const;
export type CodingProfileErrorCode =
  (typeof CodingProfileErrorCode)[keyof typeof CodingProfileErrorCode];

/**
 * Default low-attendance threshold (%) for the analytics "defaulters" flag
 * (Prompt 3). Super-admin/operator tunable per request via a `threshold` query;
 * this is the fallback. A student's rate is over ACTUALLY-RECORDED (completed)
 * sessions — a student with no completed sessions is "no data", never a 0%.
 */
export const ATTENDANCE_DEFAULT_THRESHOLD = 75;
