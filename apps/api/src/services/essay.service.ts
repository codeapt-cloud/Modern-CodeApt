/**
 * Essay service — browse prompts, submit for grading, poll/finalize, history.
 *
 * Grading rides the async pipeline: `submit` creates an EssayAttempt
 * (gradingStatus=queued) + an ExecutionJob row and enqueues a `grade-essay`
 * job on the `default` queue, then returns a JobRef FAST. The worker computes
 * the deterministic floor (+ optional AI blend) and writes the scores back onto
 * the attempt. `getGradingResult` reports status idempotently and never mutates
 * grading state (the worker owns the write; finalize here is read-only).
 *
 * Reference keywords / rubric internals NEVER leave this layer — student
 * projections omit `semanticKeywords` entirely.
 */
import { randomUUID } from "node:crypto";

import {
  CollegeFeature,
  EssayErrorCode,
  EssayGradingStatus,
  ESSAY_DEFAULT_MIN_WORDS,
  JobStatus,
  QueueName,
  TopicType,
  callLlmChatJson,
  checkEntitlement,
  coerceEssayAiFeedback,
  computeEssayRisk,
  countWords,
  computeTextStats,
  deriveEssayMalpractice,
  hasLlmRouter,
  type EssayAiFeedbackResponse,
  type EssayAnalyticsInput,
  type EssayDimensionScoresDto,
  type EssayIntegrity,
  type EssayIntegrityRecord,
  type EssayDraftResponse,
  type EssayGradingResult,
  type EssayListResponse,
  type EssayPromptDetail,
  type EssayPromptSummary,
  type EssayScoreSource,
  type EssaySubmissionListResponse,
  type EssaySubmissionSummary,
  type JobRef,
  type SaveEssayDraftResponse,
} from "@codeapt/shared";
import { Types, type HydratedDocument } from "mongoose";

import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import { enqueueEssayGradingJob } from "../lib/execution-queue.js";
import { resolveStudentMeterId } from "./student-ai-credit.service.js";
import { CollegeModel } from "../models/college.model.js";
import { hasCreditsFor } from "./ai-credit.service.js";
import { normalizeEntitlements } from "./college.service.js";
import {
  EnrollmentModel,
  ModuleModel,
  TopicModel,
} from "../models/curriculum.model.js";
import {
  EssayAnalyticsModel,
  EssayAttemptModel,
  EssayDraftModel,
  EssayTopicModel,
  type EssayAttempt,
  type EssayTopic,
} from "../models/essay.model.js";
import { ExecutionJobModel } from "../models/execution.model.js";

type TopicDoc = HydratedDocument<EssayTopic>;
type AttemptDoc = HydratedDocument<EssayAttempt>;

// ---------------------------------------------------------------------------
// Enrollment → essay-topic resolution
// ---------------------------------------------------------------------------

/**
 * The set of EssayTopic ids reachable through the user's enrollments: enrolled
 * subject → module → curriculum Topic (type `essay`) → its `essayTopic` ref.
 */
async function enrolledEssayTopicIds(
  userId: string,
): Promise<Types.ObjectId[]> {
  const enrollments = await EnrollmentModel.find({ user: userId }).select(
    "subject",
  );
  const subjectIds = enrollments.map((e) => e.subject);
  if (subjectIds.length === 0) return [];

  const modules = await ModuleModel.find({
    subject: { $in: subjectIds },
  }).select("_id");
  const topics = await TopicModel.find({
    module: { $in: modules.map((m) => m._id) },
    topicType: TopicType.ESSAY,
  }).select("essayTopic");

  return topics
    .map((t) => t.essayTopic)
    .filter((id): id is Types.ObjectId => id != null);
}

/** The curriculum Topic (type essay) that points at a given EssayTopic. */
async function curriculumTopicIdFor(
  essayTopicId: Types.ObjectId,
): Promise<string | null> {
  const topic = await TopicModel.findOne({
    essayTopic: essayTopicId,
    topicType: TopicType.ESSAY,
  }).select("_id");
  return topic ? topic._id.toString() : null;
}

// ---------------------------------------------------------------------------
// Projections (STUDENT — no reference keywords / rubric)
// ---------------------------------------------------------------------------

const ESSAY_GRADING_STATUS_SET = new Set<EssayGradingStatus>([
  EssayGradingStatus.QUEUED,
  EssayGradingStatus.PROCESSING,
  EssayGradingStatus.COMPLETED,
  EssayGradingStatus.FAILED,
]);
export const asGradingStatus = (s: string): EssayGradingStatus =>
  ESSAY_GRADING_STATUS_SET.has(s as EssayGradingStatus)
    ? (s as EssayGradingStatus)
    : EssayGradingStatus.QUEUED;

export function toSummary(
  topic: TopicDoc,
  topicId: string,
  last: AttemptDoc | null,
  attemptsUsed: number,
): EssayPromptSummary {
  return {
    id: topic._id.toString(),
    topicId,
    title: topic.title,
    description: topic.description,
    // difficultyLevel is 1|2|3 in the schema; the union type mirrors that.
    difficultyLevel: (topic.difficultyLevel ?? 1) as 1 | 2 | 3,
    minWords: topic.minWords,
    maxWords: topic.maxWords,
    timeLimitMinutes: topic.timeLimitMinutes,
    maxAttempts: topic.maxAttempts ?? 3,
    attemptsUsed,
    lastAttempt: last
      ? {
          id: last._id.toString(),
          attemptNumber: last.attemptNumber,
          status: asGradingStatus(last.gradingStatus),
          finalScore:
            last.gradingStatus === JobStatus.COMPLETED ? last.finalScore : null,
          source: (last.scoreSource as EssayScoreSource | null) ?? null,
        }
      : null,
  };
}

export async function latestAttempt(
  userId: string,
  essayTopicId: Types.ObjectId,
): Promise<AttemptDoc | null> {
  return EssayAttemptModel.findOne({
    user: new Types.ObjectId(userId),
    essayTopic: essayTopicId,
  }).sort({ attemptNumber: -1 });
}

/**
 * How many attempts the user has already SUBMITTED for a topic. Every
 * EssayAttempt row is a real submission (drafts live in a separate collection),
 * so a document count is the attempt count — this drives the per-topic cap.
 */
export async function countAttempts(
  userId: string,
  essayTopicId: Types.ObjectId,
): Promise<number> {
  return EssayAttemptModel.countDocuments({
    user: new Types.ObjectId(userId),
    essayTopic: essayTopicId,
  });
}

// ---------------------------------------------------------------------------
// Browse
// ---------------------------------------------------------------------------

export async function listEssays(userId: string): Promise<EssayListResponse> {
  const essayTopicIds = await enrolledEssayTopicIds(userId);
  if (essayTopicIds.length === 0) return { items: [] };

  const topics = await EssayTopicModel.find({
    _id: { $in: essayTopicIds },
    isActive: true,
  });

  const items: EssayPromptSummary[] = [];
  for (const topic of topics) {
    const topicId = await curriculumTopicIdFor(topic._id);
    if (!topicId) continue;
    const [last, attemptsUsed] = await Promise.all([
      latestAttempt(userId, topic._id),
      countAttempts(userId, topic._id),
    ]);
    items.push(toSummary(topic, topicId, last, attemptsUsed));
  }
  return { items };
}

/** Load an essay prompt the user may access (enrolled + active), or 404. */
async function requireAccessibleTopic(
  userId: string,
  essayTopicId: string,
): Promise<TopicDoc> {
  if (!Types.ObjectId.isValid(essayTopicId)) {
    throw new AppError("Essay not found", 404, EssayErrorCode.ESSAY_NOT_FOUND);
  }
  const allowed = await enrolledEssayTopicIds(userId);
  const inScope = allowed.some((id) => id.toString() === essayTopicId);
  const topic = await EssayTopicModel.findById(essayTopicId);
  if (!topic || !topic.isActive || !inScope) {
    throw new AppError("Essay not found", 404, EssayErrorCode.ESSAY_NOT_FOUND);
  }
  return topic;
}

export async function getEssayDetail(
  userId: string,
  essayTopicId: string,
): Promise<EssayPromptDetail> {
  const topic = await requireAccessibleTopic(userId, essayTopicId);
  const topicId = await curriculumTopicIdFor(topic._id);
  if (!topicId) {
    throw new AppError("Essay not found", 404, EssayErrorCode.ESSAY_NOT_FOUND);
  }
  const [last, attemptsUsed] = await Promise.all([
    latestAttempt(userId, topic._id),
    countAttempts(userId, topic._id),
  ]);
  return {
    ...toSummary(topic, topicId, last, attemptsUsed),
    instructions: topic.instructions,
  };
}

// ---------------------------------------------------------------------------
// Autosave drafts (recovery buffer — NEVER submits, grades, or consumes an
// attempt). Drafts are keyed by (user, essayTopic) because the attempt does not
// exist until submit. The latest N snapshots per (user, topic) are retained.
// ---------------------------------------------------------------------------

/** How many draft snapshots to retain per (user, topic) — matches the original. */
const DRAFT_HISTORY_LIMIT = 10;

/**
 * Snapshot the current essay text as a draft. Access-scoped exactly like
 * compose (enrolled + active topic → else 404); the word count is recomputed
 * server-side. Older snapshots beyond DRAFT_HISTORY_LIMIT are pruned so growth
 * is bounded. This touches nothing the grader reads/writes and never creates an
 * attempt.
 */
export async function saveDraft(
  userId: string,
  essayTopicId: string,
  content: string,
): Promise<SaveEssayDraftResponse> {
  const topic = await requireAccessibleTopic(userId, essayTopicId);
  return saveDraftForTopic(userId, topic, content);
}

/**
 * The draft-save CORE, given an already-access-checked topic. Reused by BOTH the
 * individual path (via `saveDraft` above) and the tenant college path (which
 * runs its own tenant + org-target access check). Identical behavior — the only
 * difference upstream is HOW the topic was authorized.
 */
export async function saveDraftForTopic(
  userId: string,
  topic: TopicDoc,
  content: string,
): Promise<SaveEssayDraftResponse> {
  const wordCount = countWords(content);
  const savedAt = new Date();

  await EssayDraftModel.create({
    user: new Types.ObjectId(userId),
    essayTopic: topic._id,
    content,
    wordCount,
    savedAt,
  });

  // Keep only the latest N snapshots for this (user, topic); prune the rest.
  // Tie-break on _id so ordering is stable even for same-millisecond saves.
  const stale = await EssayDraftModel.find({
    user: new Types.ObjectId(userId),
    essayTopic: topic._id,
  })
    .sort({ savedAt: -1, _id: -1 })
    .skip(DRAFT_HISTORY_LIMIT)
    .select("_id");
  if (stale.length > 0) {
    await EssayDraftModel.deleteMany({
      _id: { $in: stale.map((d) => d._id) },
    });
  }

  return { savedAt: savedAt.toISOString(), wordCount };
}

/**
 * The latest recoverable draft for a prompt, or null when there is nothing to
 * restore. A draft is suppressed once the student has SUBMITTED after it (a
 * later attempt exists), so recovery never resurrects an already-submitted
 * essay.
 */
export async function getLatestDraft(
  userId: string,
  essayTopicId: string,
): Promise<EssayDraftResponse> {
  const topic = await requireAccessibleTopic(userId, essayTopicId);
  return getLatestDraftForTopic(userId, topic);
}

/** Latest-draft CORE, given an already-access-checked topic (see saveDraftForTopic). */
export async function getLatestDraftForTopic(
  userId: string,
  topic: TopicDoc,
): Promise<EssayDraftResponse> {
  const draft = await EssayDraftModel.findOne({
    user: new Types.ObjectId(userId),
    essayTopic: topic._id,
  }).sort({ savedAt: -1, _id: -1 });
  if (!draft) return { draft: null };

  const last = await latestAttempt(userId, topic._id);
  const draftAt = draft.savedAt ?? new Date(0);
  if (last?.submittedAt && last.submittedAt >= draftAt) {
    return { draft: null };
  }

  return {
    draft: {
      content: draft.content ?? "",
      wordCount: draft.wordCount ?? 0,
      savedAt: draftAt.toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Submit (enqueue grading)
// ---------------------------------------------------------------------------

/**
 * Submit metadata. `integrity` is present only for PROCTORED (college) essays;
 * individual submits omit it and are unaffected.
 */
export interface SubmitEssayMeta {
  ipAddress?: string;
  userAgent?: string;
  integrity?: EssayIntegrity;
}

export async function submitEssay(
  userId: string,
  essayTopicId: string,
  content: string,
  meta: SubmitEssayMeta = {},
): Promise<JobRef> {
  const topic = await requireAccessibleTopic(userId, essayTopicId);
  return submitEssayForTopic(userId, topic, content, meta);
}

/**
 * The submit CORE, given an already-access-checked topic. Reused by the tenant
 * college path (which runs its own tenant + org-target access check). Enforces
 * the attempt cap + word bounds, creates the attempt, and enqueues the SAME
 * grading pipeline — the grade is produced identically for individual and
 * college essays. The attempt is stamped with the topic's `college` (null for
 * individual essays, so those are unaffected).
 */
/**
 * Whether AI-assisted grading is permitted for an essay owned by `college`.
 * Individual essays (college null) are ungated → true. College essays require
 * the `ai.essay_grading` entitlement; a missing college is treated as not
 * granted (safe default).
 */
async function essayAiEnabled(college: Types.ObjectId | null): Promise<boolean> {
  if (!college) return true;
  const doc = await CollegeModel.findById(college);
  if (!doc) return false;
  return checkEntitlement(
    normalizeEntitlements(doc),
    CollegeFeature.AI,
    "essay_grading",
  );
}

export async function submitEssayForTopic(
  userId: string,
  topic: TopicDoc,
  content: string,
  meta: SubmitEssayMeta = {},
): Promise<JobRef> {
  const integrity = meta.integrity;
  // Enforce the per-topic attempt cap BEFORE doing any work. Every attempt row
  // is a real submission (drafts are separate), so a count is the used-count.
  const maxAttempts = topic.maxAttempts ?? 3;
  const attemptsUsed = await countAttempts(userId, topic._id);
  if (attemptsUsed >= maxAttempts) {
    throw new AppError(
      `You have reached the attempt limit for this essay (${maxAttempts})`,
      409,
      EssayErrorCode.ATTEMPT_LIMIT_REACHED,
    );
  }

  // Enforce the prompt's WORD bounds (char ceiling is enforced by the schema).
  // A proctored AUTO-SUBMIT (warning limit crossed) bypasses the MIN-word floor
  // so a flagged, possibly-incomplete attempt is still recorded — mirroring the
  // exam runner, which force-submits whatever exists when the limit is crossed.
  const wordCount = countWords(content);
  const minWords = Math.max(topic.minWords || 0, ESSAY_DEFAULT_MIN_WORDS);
  if (wordCount < minWords && !integrity?.autoSubmitted) {
    throw new AppError(
      `Essay must be at least ${minWords} words (got ${wordCount})`,
      422,
      EssayErrorCode.LENGTH_OUT_OF_RANGE,
    );
  }
  if (topic.maxWords > 0 && wordCount > topic.maxWords) {
    throw new AppError(
      `Essay must be at most ${topic.maxWords} words (got ${wordCount})`,
      422,
      EssayErrorCode.LENGTH_OUT_OF_RANGE,
    );
  }

  // Next attempt number for this (user, topic) — resubmission is allowed.
  const previous = await latestAttempt(userId, topic._id);
  const attemptNumber = (previous?.attemptNumber ?? 0) + 1;

  const stats = computeTextStats(content);
  const jobId = randomUUID();

  // Proctoring/integrity: the compose surface has no live attempt to count
  // against, so the warning COUNT is client-reported (and clamped by the submit
  // schema) — but the malpractice FLAG is always RE-DERIVED here, never trusted
  // from the client. Individual essays send no integrity → zeros (unchanged).
  const warningsTriggered = integrity?.warnings ?? 0;
  const integrityFlags = integrity?.flags ?? [];
  const isMalpractice = integrity
    ? deriveEssayMalpractice(warningsTriggered, integrityFlags)
    : false;

  const attempt = await EssayAttemptModel.create({
    user: new Types.ObjectId(userId),
    essayTopic: topic._id,
    attemptNumber,
    status: "SUBMITTED",
    content,
    wordCount: stats.wordCount,
    characterCount: stats.characterCount,
    paragraphCount: stats.paragraphCount,
    gradingStatus: JobStatus.QUEUED,
    gradingJobId: jobId,
    submittedAt: new Date(),
    ipAddress: meta.ipAddress ?? "",
    userAgent: meta.userAgent ?? "",
    warningsTriggered,
    isMalpractice,
    integrityFlags,
    // Tenant stamp: college essays carry their owning college; individual
    // essays have topic.college == null → attempt.college null (unchanged).
    college: topic.college ?? null,
  });

  await ExecutionJobModel.create({
    jobId,
    user: new Types.ObjectId(userId),
    submissionRef: `essay:${attempt._id.toString()}`,
    queue: QueueName.DEFAULT,
    status: JobStatus.QUEUED,
  });

  // Per-college AI gate: a college essay gets AI-assisted grading only when its
  // `ai.essay_grading` entitlement is on; individual essays (no college) are
  // ungated. The worker falls back to deterministic-only when this is false.
  const collegeId = topic.college ? topic.college.toString() : null;
  let aiEnabled = await essayAiEnabled(topic.college ?? null);
  // AI CREDITS (Stage 1): for a college essay, ensure the period ledger exists
  // (so the worker can reserve against it) and advisory-pre-gate on remaining
  // credits — if exhausted, don't even enqueue AI (deterministic grading). The
  // AUTHORITATIVE debit still happens once, at the worker gateway seam on success.
  if (aiEnabled && collegeId) {
    aiEnabled = await hasCreditsFor(collegeId, "grading", new Date());
  }
  // If the college runs per-student distribution, meter this grading against the
  // STUDENT's own allocation at the worker seam (undefined → college pool).
  const meterStudentId = await resolveStudentMeterId(collegeId, userId);
  await enqueueEssayGradingJob({
    jobId,
    attemptId: attempt._id.toString(),
    aiEnabled,
    collegeId: collegeId ?? undefined,
    userId: meterStudentId,
  });

  return { jobId, status: JobStatus.QUEUED };
}

// ---------------------------------------------------------------------------
// Grading status / result (read-only, idempotent)
// ---------------------------------------------------------------------------

export async function getGradingResult(
  userId: string,
  jobId: string,
): Promise<EssayGradingResult> {
  const attempt = await EssayAttemptModel.findOne({ gradingJobId: jobId });
  if (!attempt) {
    throw new AppError(
      "Submission not found",
      404,
      EssayErrorCode.SUBMISSION_NOT_FOUND,
    );
  }
  if (attempt.user.toString() !== userId) {
    throw new AppError(
      "You do not own this submission",
      403,
      EssayErrorCode.NOT_AUTHORIZED,
    );
  }

  const job = await ExecutionJobModel.findOne({ jobId });
  const status = asGradingStatus(attempt.gradingStatus);
  const completed = status === EssayGradingStatus.COMPLETED;
  const failed = status === EssayGradingStatus.FAILED;

  const dimensions: EssayDimensionScoresDto | null = completed
    ? {
        grammar: attempt.subScores?.grammar ?? 0,
        spelling: attempt.subScores?.spelling ?? 0,
        punctuation: attempt.subScores?.punctuation ?? 0,
        readability: attempt.subScores?.readability ?? 0,
        vocabulary: attempt.subScores?.vocabulary ?? 0,
        structure: attempt.subScores?.structure ?? 0,
        relevance: attempt.subScores?.relevance ?? 0,
      }
    : null;

  return {
    jobId,
    submissionId: attempt._id.toString(),
    status,
    gradingPending: !completed && !failed,
    total: completed ? attempt.finalScore : null,
    dimensions,
    source: completed
      ? ((attempt.scoreSource as EssayScoreSource | null) ?? null)
      : null,
    feedback: completed ? attempt.feedback || null : null,
    wordCount: attempt.wordCount,
    error: failed ? (job?.error ?? "Grading failed") : null,
    integrity: integrityRecord(attempt),
  };
}

/**
 * The integrity record surfaced on a submission (null for a clean attempt with
 * no warnings and no flags — the common case, so the UI shows nothing extra).
 */
function integrityRecord(attempt: AttemptDoc): EssayIntegrityRecord | null {
  const warnings = attempt.warningsTriggered ?? 0;
  const flags = attempt.integrityFlags ?? [];
  const isMalpractice = attempt.isMalpractice ?? false;
  if (warnings === 0 && flags.length === 0 && !isMalpractice) return null;
  return { warnings, isMalpractice, flags };
}

// ---------------------------------------------------------------------------
// On-demand AI Scoring & Feedback (supplementary — never replaces the heuristic
// primary grade). Runs through the shared LLM seam (gateway or fallback).
// ---------------------------------------------------------------------------

const ESSAY_FEEDBACK_SYSTEM_PROMPT =
  "You are a supportive but rigorous writing coach reviewing a student essay. " +
  "Return STRICT JSON ONLY — no prose, no code fences — exactly: " +
  '{"scores": {"vocabulary": <int 0-100>, "structure": <int 0-100>, ' +
  '"relevance": <int 0-100>, "overall": <int 0-100>}, "pros": ["<strength>"], ' +
  '"cons": ["<weakness>"], "improvements": ["<specific, actionable suggestion>"], ' +
  '"summary": "<2-3 sentence overview>"}. Judge SUBSTANCE over surface polish. ' +
  "Give 2-5 concise, concrete items in each of pros, cons, and improvements " +
  "(short phrases, not paragraphs). Do not include anything outside the JSON.";

function buildEssayFeedbackUserPrompt(
  topic: TopicDoc,
  content: string,
  keywords: readonly string[],
): string {
  const prompt = [topic.title, topic.description, topic.instructions]
    .filter(Boolean)
    .join("\n\n");
  const kw = keywords.length > 0 ? keywords.join(", ") : "(none provided)";
  return (
    `Prompt / topic:\n${prompt}\n\n` +
    `Key ideas a strong response should address: ${kw}\n\n` +
    `Student essay:\n"""\n${content}\n"""`
  );
}

/**
 * Generate AI Scoring & Feedback for one attempt and persist it onto the
 * attempt's `aiReport.aiFeedback`. Gated: for a COLLEGE essay the owning college
 * must have `ai.essay_grading`; and the LLM must be configured (gateway or env).
 * Either gate off → `{configured:false}` (graceful). The model output is coerced
 * defensively; nothing usable → `{configured:true, feedback:null}`.
 */
export async function generateEssayAiFeedbackForAttempt(
  attempt: AttemptDoc,
): Promise<EssayAiFeedbackResponse> {
  // Per-college gate (individual essays — college null — are ungated).
  if (attempt.college) {
    const college = await CollegeModel.findById(attempt.college);
    const entitled = college
      ? checkEntitlement(
          normalizeEntitlements(college),
          CollegeFeature.AI,
          "essay_grading",
        )
      : false;
    if (!entitled) return { configured: false, feedback: null };
  }

  const configured =
    hasLlmRouter() ||
    (env.ESSAY_AI_PROVIDER === "llm" &&
      Boolean(env.ESSAY_LLM_URL) &&
      Boolean(env.ESSAY_LLM_API_KEY));
  if (!configured) return { configured: false, feedback: null };

  const topic = await EssayTopicModel.findById(attempt.essayTopic);
  if (!topic) return { configured: false, feedback: null };

  const parsed = await callLlmChatJson(
    {
      url: env.ESSAY_LLM_URL,
      apiKey: env.ESSAY_LLM_API_KEY,
      model: env.ESSAY_LLM_MODEL,
      timeoutMs: env.ESSAY_AI_TIMEOUT_MS,
    },
    ESSAY_FEEDBACK_SYSTEM_PROMPT,
    buildEssayFeedbackUserPrompt(
      topic as unknown as TopicDoc,
      attempt.content,
      topic.semanticKeywords ?? [],
    ),
    // Sensitive student text → stable provider, no training providers. Feedback
    // is bounded prose → a tight output cap. Cacheable by exact essay. A COLLEGE
    // essay carries its collegeId so this feedback is charged to that college's
    // AI credits at the seam (individual essays omit it → uncharged).
    {
      kind: "grading",
      sensitive: true,
      maxTokens: 800,
      feature: "essay_feedback",
      collegeId: attempt.college ? attempt.college.toString() : undefined,
      // If the college runs per-student credit distribution, meter this against
      // the STUDENT's own allocation instead of the pool (undefined otherwise).
      userId: await resolveStudentMeterId(
        attempt.college ? attempt.college.toString() : undefined,
        attempt.user ? attempt.user.toString() : undefined,
      ),
    },
  );

  const feedback = coerceEssayAiFeedback(parsed);
  if (!feedback) {
    // Distinguish "your AI credits are used up" from a generic empty result, so
    // the college can see WHY (the seam returns null when credits are exhausted).
    if (
      attempt.college &&
      !(await hasCreditsFor(attempt.college.toString(), "essay_feedback", new Date()))
    ) {
      return { configured: true, feedback: null, reason: "credits_exhausted" };
    }
    return { configured: true, feedback: null };
  }

  attempt.aiReport = {
    ...(attempt.aiReport && typeof attempt.aiReport === "object"
      ? (attempt.aiReport as Record<string, unknown>)
      : {}),
    aiFeedback: feedback,
  };
  await attempt.save();
  return { configured: true, feedback };
}

/**
 * Owner path: load an attempt by its grading job id, verify ownership, then
 * generate AI feedback. Mirrors `getGradingResult`'s auth.
 */
export async function generateAiFeedbackForOwner(
  userId: string,
  jobId: string,
): Promise<EssayAiFeedbackResponse> {
  const attempt = await EssayAttemptModel.findOne({ gradingJobId: jobId });
  if (!attempt) {
    throw new AppError(
      "Submission not found",
      404,
      EssayErrorCode.SUBMISSION_NOT_FOUND,
    );
  }
  if (attempt.user.toString() !== userId) {
    throw new AppError(
      "You do not own this submission",
      403,
      EssayErrorCode.NOT_AUTHORIZED,
    );
  }
  return generateEssayAiFeedbackForAttempt(attempt);
}

/**
 * Faculty path: load an attempt by id SCOPED to the college (cross-tenant → 404),
 * then generate AI feedback. Used by the college essay-results view.
 */
export async function generateAiFeedbackForTenant(
  collegeId: string,
  attemptId: string,
): Promise<EssayAiFeedbackResponse> {
  if (!Types.ObjectId.isValid(attemptId)) {
    throw new AppError(
      "Submission not found",
      404,
      EssayErrorCode.SUBMISSION_NOT_FOUND,
    );
  }
  const attempt = await EssayAttemptModel.findOne({
    _id: attemptId,
    college: new Types.ObjectId(collegeId),
  });
  if (!attempt) {
    throw new AppError(
      "Submission not found",
      404,
      EssayErrorCode.SUBMISSION_NOT_FOUND,
    );
  }
  return generateEssayAiFeedbackForAttempt(attempt);
}

// ---------------------------------------------------------------------------
// Submission history
// ---------------------------------------------------------------------------

export async function listSubmissions(
  userId: string,
  essayTopicId: string,
): Promise<EssaySubmissionListResponse> {
  const topic = await requireAccessibleTopic(userId, essayTopicId);
  return listSubmissionsForTopic(userId, topic);
}

/** Submission-history CORE, given an already-access-checked topic. */
export async function listSubmissionsForTopic(
  userId: string,
  topic: TopicDoc,
): Promise<EssaySubmissionListResponse> {
  const attempts = await EssayAttemptModel.find({
    user: new Types.ObjectId(userId),
    essayTopic: topic._id,
  }).sort({ attemptNumber: -1 });

  const items: EssaySubmissionSummary[] = attempts.map((a) => {
    const completed = a.gradingStatus === JobStatus.COMPLETED;
    return {
      id: a._id.toString(),
      jobId: a.gradingJobId ?? null,
      attemptNumber: a.attemptNumber,
      status: asGradingStatus(a.gradingStatus),
      finalScore: completed ? a.finalScore : null,
      source: (a.scoreSource as EssayScoreSource | null) ?? null,
      wordCount: a.wordCount,
      submittedAt: a.submittedAt ? a.submittedAt.toISOString() : null,
      gradedAt: a.gradedAt ? a.gradedAt.toISOString() : null,
      integrity: integrityRecord(a),
    };
  });

  return { promptId: topic._id.toString(), items };
}

// ---------------------------------------------------------------------------
// Writing analytics (Step 11) — ADDITIVE + OPTIONAL, never affects grading.
// ---------------------------------------------------------------------------

/**
 * Persist optional compose analytics for a submission. Fully decoupled from
 * grading: it writes to the EssayAnalytics sidecar (1-to-1 with the attempt)
 * and touches NOTHING the grader reads or writes. The grade is identical
 * whether or not this is ever called. Ownership is enforced via the attempt.
 */
export async function recordAnalytics(
  userId: string,
  jobId: string,
  input: EssayAnalyticsInput,
): Promise<void> {
  const attempt = await EssayAttemptModel.findOne({ gradingJobId: jobId });
  if (!attempt) {
    throw new AppError(
      "Submission not found",
      404,
      EssayErrorCode.SUBMISSION_NOT_FOUND,
    );
  }
  if (attempt.user.toString() !== userId) {
    throw new AppError(
      "You do not own this submission",
      403,
      EssayErrorCode.NOT_AUTHORIZED,
    );
  }

  // Compute the ADVISORY risk assessment server-side from the incoming signals
  // (never a client-supplied score). Purely a review aid — it does not touch
  // grading, the attempt, or the submission in any way.
  const risk = computeEssayRisk({
    keystrokes: input.keystrokes,
    deletes: input.deletes,
    pasteEvents: input.pasteCount,
    pastedChars: input.pastedChars,
    composeSeconds: input.composeSeconds,
    wordCount: input.wordCount,
    characterCount: input.characterCount,
  });

  await EssayAnalyticsModel.updateOne(
    { attempt: attempt._id },
    {
      $set: {
        typingEvents: input.keystrokes,
        deleteEvents: input.deletes,
        pasteEvents: input.pasteCount,
        pastedChars: input.pastedChars,
        composeSeconds: input.composeSeconds,
        finalWordCount: input.wordCount,
        finalCharacterCount: input.characterCount,
        riskScore: risk.riskScore,
        riskLevel: risk.level,
        suspiciousActivity: risk.suspicious,
        riskReasons: risk.reasons,
      },
    },
    { upsert: true },
  );
}
