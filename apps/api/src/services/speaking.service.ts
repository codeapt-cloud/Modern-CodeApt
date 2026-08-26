/**
 * Speaking service (Communication Sections A/B — the speech spine). I/O only;
 * all scoring is pure in @codeapt/shared and runs in the worker. Two concerns:
 *
 *  - ACCESS: `assertCanTakeSpeakingAssessment` mirrors `assertCanPlayGameSet` —
 *    the same three shapes (tenant-authored / course-attached / platform) with
 *    the same 404-vs-403 discipline and org-unit descendant math.
 *  - LIFECYCLE: start an attempt → submit each item's recorded audio URL (which
 *    creates an ExecutionJob + enqueues a `speech` transcription job) → poll the
 *    per-item results. The worker owns the transcription + scoring write; the API
 *    is a thin producer/poller, exactly like the essay pipeline.
 *
 * Authoring (college surface) is tenant-scoped over the same model, mirroring
 * college-game.service: isolation via createTenantScope, org-unit targeting
 * validated in-tenant, a draft→publish gate, delete refused once attempts exist.
 */
import { randomUUID } from "node:crypto";

import {
  JobStatus,
  QueueName,
  SpeakingAttemptStatus,
  SpeakingItemType,
  speakingItemNeedsAudio,
  SpeechJobStatus,
  SpeakingErrorCode,
  CLOUDINARY_UPLOAD_FOLDER,
  collectDescendantUnitIds,
  isCourseGranted,
  isPlatformAdmin,
  scoreDictation,
  speakingAttemptBudgetSeconds,
  SPEAKING_SUBMIT_GRACE_MS,
  TopicType,
  type SpeakingTtsResponse,
  type SpeakingAssessmentDetail,
  type SpeakingAssessmentListResponse,
  type SpeakingAssessmentUpsert,
  type SpeakingAttemptAdminList,
  type SpeakingAttemptResult,
  type SpeakingCurrentAttemptResponse,
  type SpeakingCurrentResponse,
  type SpeakingItemResult,
  type SpeakingItemScoreDto,
  type SpeakingItemType as SpeakingItemTypeName,
  type SpeakingItemView,
  type SpeakingPlayListResponse,
  type StartSpeakingResponse,
  type SubmitSpeakingItemRequest,
  type SubmitSpeakingItemResponse,
  type GameTopicListResponse,
} from "@codeapt/shared";
import { Types, type HydratedDocument } from "mongoose";

import { AppError } from "../errors/app-error.js";
import { synthesizePrompt, TtsError } from "../lib/asr-tts.js";
import { uploadBufferToCloudinary } from "../lib/cloudinary.js";
import { enqueueSpeechJob } from "../lib/execution-queue.js";
import { createTenantScope } from "../lib/tenant-scope.js";
import { CollegeModel } from "../models/college.model.js";
import {
  EnrollmentModel,
  ModuleModel,
  SubjectModel,
  TopicModel,
} from "../models/curriculum.model.js";
import { ExecutionJobModel } from "../models/execution.model.js";
import { OrgUnitModel } from "../models/org-unit.model.js";
import {
  SpeakingAssessmentModel,
  SpeakingAttemptModel,
  type SpeakingAssessment,
  type SpeakingAttempt,
} from "../models/speaking.model.js";
import { UserModel } from "../models/user.model.js";
import { normalizeEntitlements } from "./college.service.js";

type AssessmentDoc = HydratedDocument<SpeakingAssessment>;
type AttemptDoc = HydratedDocument<SpeakingAttempt>;

const NOT_FOUND = (): AppError =>
  new AppError(
    "Speaking assessment not found",
    404,
    SpeakingErrorCode.ASSESSMENT_NOT_FOUND,
  );
const ATTEMPT_NOT_FOUND = (): AppError =>
  new AppError("Attempt not found", 404, SpeakingErrorCode.ATTEMPT_NOT_FOUND);
const OUT_OF_SCOPE = (msg: string): AppError =>
  new AppError(msg, 403, SpeakingErrorCode.ORG_UNIT_OUT_OF_SCOPE);

// ---------------------------------------------------------------------------
// Access matrix (mirror of assertCanPlayGameSet)
// ---------------------------------------------------------------------------

export async function assertCanTakeSpeakingAssessment(
  userId: string,
  assessment: AssessmentDoc,
): Promise<void> {
  // 1. TENANT assessment (college set).
  if (assessment.college) {
    const user = await UserModel.findById(userId).select("college orgUnit");
    if (
      !user?.college ||
      user.college.toString() !== assessment.college.toString() ||
      !assessment.isPublished
    ) {
      throw NOT_FOUND();
    }
    const targets = (assessment.orgUnits ?? []).map((u) => u.toString());
    if (targets.length > 0) {
      const units = await OrgUnitModel.find({
        college: assessment.college,
      }).select("_id parent");
      const refs = units.map((u) => ({
        id: u._id.toString(),
        parentId: u.parent ? u.parent.toString() : null,
      }));
      const studentUnit = user.orgUnit ? user.orgUnit.toString() : null;
      const allowed = new Set(collectDescendantUnitIds(refs, targets));
      if (!studentUnit || !allowed.has(studentUnit)) {
        throw OUT_OF_SCOPE("This assessment is not assigned to your cohort");
      }
    }
    return;
  }

  // 2. COURSE-ATTACHED assessment (college null, topic set): enrollment or grant
  //    in the owning subject, exactly like a course-attached game set.
  if (assessment.topic) {
    const topic = await TopicModel.findById(assessment.topic).select("module");
    const mod = topic
      ? await ModuleModel.findById(topic.module).select("subject")
      : null;
    if (!mod) throw NOT_FOUND();
    const subjectId = mod.subject.toString();
    const enrolled = await EnrollmentModel.exists({
      user: userId,
      subject: mod.subject,
    });
    if (enrolled) return;
    const user = await UserModel.findById(userId).select("college");
    if (user?.college) {
      const college = await CollegeModel.findById(user.college);
      if (college && isCourseGranted(normalizeEntitlements(college), subjectId)) {
        return;
      }
    }
    throw NOT_FOUND();
  }

  // 3. PLATFORM-INTERNAL assessment (college null, topic null): platform admins.
  const user = await UserModel.findById(userId).select("role");
  if (!user || !isPlatformAdmin(user.role)) throw NOT_FOUND();
}

// ---------------------------------------------------------------------------
// Consumption lifecycle
// ---------------------------------------------------------------------------

/** ONE item's student view — reference/answer material withheld (only read_aloud
 *  shows its text; answerSet/keyFacts/missingWord are never viewed). */
function singleItemView(
  it: AssessmentDoc["items"][number],
  index: number,
): SpeakingItemView {
  return {
    index,
    itemType: it.itemType,
    referenceText:
      it.itemType === SpeakingItemType.READ_ALOUD ? it.referenceText : "",
    promptText: it.promptText ?? "",
    promptAudioUrl: it.promptAudioUrl ?? "",
    stimulusAudioUrl: it.stimulusAudioUrl ?? "",
    stimulusPlayLimit: it.stimulusPlayLimit ?? 0,
    // Instance-level: listen types + sentence_build WITH chunks. The runner reads
    // this to block recording when the required audio is missing (Step 27).
    requiresAudio: speakingItemNeedsAudio({
      itemType: it.itemType,
      chunks: it.chunks ?? [],
    }),
    section: it.section ?? "",
    prepSeconds: it.prepSeconds ?? 0,
    responseWindowSeconds: it.responseWindowSeconds ?? 60,
  };
}

function remainingSeconds(
  expiresAt: Date | null | undefined,
  now: Date,
): number {
  if (!expiresAt) return 0;
  return Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
}

/** An attempt is EXPIRED when it still has an undisclosed item AND its server
 *  deadline has passed. Once every item is answered the deadline no longer
 *  matters (only async SCORING remains, which the deadline must not block). */
function attemptExpired(attempt: AttemptDoc, now: Date): boolean {
  return (
    attempt.currentIndex < attempt.items.length &&
    attempt.status !== SpeakingAttemptStatus.SCORED &&
    attempt.status !== SpeakingAttemptStatus.EXPIRED &&
    !!attempt.expiresAt &&
    now.getTime() > attempt.expiresAt.getTime()
  );
}

/** PROGRESSIVE DISCLOSURE: the in-progress state = ONLY the current item. */
function buildCurrent(
  attempt: AttemptDoc,
  assessment: AssessmentDoc | null,
  now: Date,
): SpeakingCurrentResponse {
  const total = assessment ? assessment.items.length : attempt.items.length;
  const expired =
    attempt.status === SpeakingAttemptStatus.EXPIRED ||
    attemptExpired(attempt, now);
  const idx = attempt.currentIndex;
  const done = idx >= total;
  const authored = assessment?.items[idx];
  const item =
    !expired && !done && authored ? singleItemView(authored, idx) : null;
  return {
    attemptId: attempt._id.toString(),
    status: attempt.status as SpeakingAttemptStatus,
    totalItems: total,
    currentIndex: Math.min(idx, total),
    expiresAt: attempt.expiresAt ? attempt.expiresAt.toISOString() : "",
    remainingSeconds: remainingSeconds(attempt.expiresAt, now),
    expired,
    item,
  };
}

async function loadAssessmentOr404(assessmentId: string): Promise<AssessmentDoc> {
  if (!Types.ObjectId.isValid(assessmentId)) throw NOT_FOUND();
  const a = await SpeakingAssessmentModel.findById(assessmentId);
  if (!a) throw NOT_FOUND();
  return a;
}

export async function startSpeakingAttempt(
  userId: string,
  assessmentId: string,
): Promise<StartSpeakingResponse> {
  const assessment = await loadAssessmentOr404(assessmentId);
  await assertCanTakeSpeakingAssessment(userId, assessment);
  if (assessment.items.length === 0) throw NOT_FOUND();

  // Attempt cap (0 = unlimited). EXPIRED attempts do NOT count — an abandoned
  // attempt that timed out must not permanently burn the student's slot.
  if (assessment.maxAttempts > 0) {
    const used = await SpeakingAttemptModel.countDocuments({
      user: userId,
      assessment: assessment._id,
      status: { $ne: SpeakingAttemptStatus.EXPIRED },
    });
    if (used >= assessment.maxAttempts) {
      throw new AppError(
        "You have used all attempts for this assessment",
        409,
        SpeakingErrorCode.ATTEMPT_LIMIT_REACHED,
      );
    }
  }

  // Server-authoritative deadline stamped once at start.
  const now = new Date();
  const budgetSeconds = speakingAttemptBudgetSeconds(
    assessment.items.map((it) => ({
      prepSeconds: it.prepSeconds ?? 0,
      responseWindowSeconds: it.responseWindowSeconds ?? 60,
    })),
  );
  const expiresAt = new Date(now.getTime() + budgetSeconds * 1000);

  const attempt = await SpeakingAttemptModel.create({
    user: new Types.ObjectId(userId),
    assessment: assessment._id,
    college: assessment.college ?? null,
    status: SpeakingAttemptStatus.IN_PROGRESS,
    currentIndex: 0,
    expiresAt,
    startedAt: now,
    items: assessment.items.map((_, index) => ({
      itemIndex: index,
      audioUrl: "",
      jobId: null,
      jobStatus: SpeechJobStatus.QUEUED,
      transcript: "",
      wordTimings: [],
      subScores: null,
      error: "",
    })),
  });

  return {
    ...buildCurrent(attempt, assessment, now),
    assessmentTitle: assessment.title,
  };
}

async function loadOwnedAttempt(
  userId: string,
  attemptId: string,
): Promise<AttemptDoc> {
  if (!Types.ObjectId.isValid(attemptId)) throw ATTEMPT_NOT_FOUND();
  const attempt = await SpeakingAttemptModel.findById(attemptId);
  if (!attempt) throw ATTEMPT_NOT_FOUND();
  if (attempt.user.toString() !== userId) {
    throw new AppError(
      "You do not own this attempt",
      403,
      SpeakingErrorCode.NOT_AUTHORIZED,
    );
  }
  return attempt;
}

/** Lazily finalize an attempt whose deadline passed (so an expired attempt can't
 *  be resumed even before the reaper runs). Mutates the in-memory doc's status. */
async function finalizeIfExpired(attempt: AttemptDoc, now: Date): Promise<void> {
  if (attemptExpired(attempt, now)) {
    await SpeakingAttemptModel.updateOne(
      {
        _id: attempt._id,
        status: {
          $nin: [SpeakingAttemptStatus.SCORED, SpeakingAttemptStatus.EXPIRED],
        },
      },
      { $set: { status: SpeakingAttemptStatus.EXPIRED, scoredAt: now } },
    );
    attempt.status = SpeakingAttemptStatus.EXPIRED;
  }
}

/**
 * Step 25 C5 — the student's CURRENT in-progress attempt on ONE assessment, or
 * null. READ-ONLY: it lets the composite's speaking deep link RESUME an existing
 * attempt (found by (user, assessment) after a refresh, when the client has no
 * attemptId) instead of starting a second one. It never creates an attempt and
 * never touches the cap, so `start` and its cap behaviour are unchanged. Same
 * access gate as `start`; an expired-but-not-yet-reaped attempt is finalized and
 * reported as none (a dead attempt must not be resumed).
 */
export async function getInProgressSpeakingAttempt(
  userId: string,
  assessmentId: string,
): Promise<SpeakingCurrentAttemptResponse> {
  const assessment = await loadAssessmentOr404(assessmentId);
  await assertCanTakeSpeakingAssessment(userId, assessment);
  const now = new Date();
  const attempt = await SpeakingAttemptModel.findOne({
    user: new Types.ObjectId(userId),
    assessment: assessment._id,
    status: SpeakingAttemptStatus.IN_PROGRESS,
  }).sort({ createdAt: -1 });
  if (!attempt) return { attempt: null };
  await finalizeIfExpired(attempt, now);
  if (attempt.status !== SpeakingAttemptStatus.IN_PROGRESS) return { attempt: null };
  return {
    attempt: {
      ...buildCurrent(attempt, assessment, now),
      assessmentTitle: assessment.title,
    },
  };
}

/** READ the attempt's current item — progressive disclosure + resume. Enforces
 *  the deadline on read: an expired attempt returns item:null + expired:true. */
export async function getCurrentSpeakingItem(
  userId: string,
  attemptId: string,
): Promise<SpeakingCurrentResponse> {
  const attempt = await loadOwnedAttempt(userId, attemptId);
  const assessment = await SpeakingAssessmentModel.findById(attempt.assessment);
  const now = new Date();
  await finalizeIfExpired(attempt, now);
  return buildCurrent(attempt, assessment, now);
}

/**
 * Submit the CURRENT item's response and advance disclosure. Enforces the
 * deadline on WRITE (an expired attempt is refused + finalized) and progressive
 * disclosure (only the current index may be submitted — this also replaces the
 * old "already submitted" guard). Audio → enqueue async scoring; dictation →
 * scored inline; silent/skip → finalized as unanswered. Returns the advanced
 * state (the next item, or item:null when finished).
 */
export async function submitSpeakingItem(
  userId: string,
  attemptId: string,
  itemIndex: number,
  body: SubmitSpeakingItemRequest,
): Promise<SubmitSpeakingItemResponse> {
  const attempt = await loadOwnedAttempt(userId, attemptId);
  const now = new Date();

  // Deadline on WRITE — a BOUNDED grace so a small network overrun never costs a
  // student their recording, while granting zero extra playing time:
  //   - BEYOND the grace (expiresAt + SPEAKING_SUBMIT_GRACE_MS): the answer is
  //     too late to tie to this attempt → refuse + finalize EXPIRED.
  //   - WITHIN the grace but PAST the deadline: ACCEPT the in-flight answer for
  //     the item that was served before the deadline (the current, unanswered
  //     item), store it, and close the attempt EXPIRED WITHOUT advancing to a new
  //     item — so no further prompt is ever disclosed. A second/other-index
  //     submit is then refused (already-answered / not-current).
  const deadlineMs = attempt.expiresAt ? attempt.expiresAt.getTime() : null;
  const pastDeadline = deadlineMs !== null && now.getTime() > deadlineMs;
  const beyondGrace =
    deadlineMs !== null && now.getTime() > deadlineMs + SPEAKING_SUBMIT_GRACE_MS;
  if (beyondGrace) {
    await finalizeIfExpired(attempt, now);
    if (attempt.status !== SpeakingAttemptStatus.EXPIRED) {
      await SpeakingAttemptModel.updateOne(
        { _id: attempt._id, status: { $ne: SpeakingAttemptStatus.SCORED } },
        { $set: { status: SpeakingAttemptStatus.EXPIRED, scoredAt: now } },
      );
    }
    throw new AppError(
      "This attempt's time has expired",
      409,
      SpeakingErrorCode.ATTEMPT_EXPIRED,
    );
  }

  // Progressive disclosure: only the current item may be submitted (and this
  // subsumes the no-re-record rule — a past index is no longer current).
  if (itemIndex !== attempt.currentIndex) {
    throw new AppError(
      "That is not the current item",
      409,
      SpeakingErrorCode.NOT_CURRENT_ITEM,
    );
  }

  // Within-grace past the deadline: the served item may land exactly once — a
  // repeat submit of an already-answered item is refused (no second bite, and no
  // blind answering of items that were never disclosed).
  const currentItem = attempt.items[itemIndex];
  if (
    pastDeadline &&
    currentItem &&
    ((currentItem.audioUrl && currentItem.audioUrl.length > 0) ||
      currentItem.jobStatus !== SpeechJobStatus.QUEUED)
  ) {
    throw new AppError(
      "This attempt's time has expired",
      409,
      SpeakingErrorCode.ATTEMPT_EXPIRED,
    );
  }

  const assessment = await SpeakingAssessmentModel.findById(attempt.assessment);
  const authored = assessment?.items[itemIndex];
  if (!authored || !attempt.items[itemIndex]) {
    throw new AppError("Item not found", 404, SpeakingErrorCode.ITEM_NOT_FOUND);
  }

  const set: Record<string, unknown> = {};
  let itemStatus: SpeechJobStatus;
  const isDictation = authored.itemType === SpeakingItemType.DICTATION;
  const answeredDictation = isDictation && typeof body.text === "string" && !body.silent;
  const answeredSpoken = !isDictation && !body.silent && Boolean(body.audioUrl);

  if (answeredDictation) {
    // Typed, scored inline (no ASR / no queue).
    const score = scoreDictation(authored.referenceText, body.text ?? "");
    set[`items.${itemIndex}.transcript`] = body.text ?? "";
    set[`items.${itemIndex}.subScores`] = score;
    set[`items.${itemIndex}.jobStatus`] = SpeechJobStatus.COMPLETED;
    itemStatus = SpeechJobStatus.COMPLETED;
  } else if (answeredSpoken) {
    // Spoken → enqueue an async transcription job.
    const jobId = randomUUID();
    await ExecutionJobModel.create({
      jobId,
      user: new Types.ObjectId(userId),
      submissionRef: `${attemptId}:${itemIndex}`,
      queue: QueueName.SPEECH,
      status: JobStatus.QUEUED,
    });
    set[`items.${itemIndex}.audioUrl`] = body.audioUrl;
    set[`items.${itemIndex}.jobId`] = jobId;
    set[`items.${itemIndex}.jobStatus`] = SpeechJobStatus.QUEUED;
    itemStatus = SpeechJobStatus.QUEUED;
    await enqueueSpeechJob({
      jobId,
      attemptId,
      itemIndex,
      audioUrl: body.audioUrl!,
      collegeId: attempt.college ? attempt.college.toString() : undefined,
      userId,
    });
  } else {
    // Silent / skipped — no answer. Finalize the item so it stops blocking and
    // the attempt can reach a terminal state. Every item goes through submit so
    // the server's current index stays authoritative.
    set[`items.${itemIndex}.jobStatus`] = SpeechJobStatus.FAILED;
    set[`items.${itemIndex}.error`] = "No answer recorded.";
    itemStatus = SpeechJobStatus.FAILED;
  }

  // A normal (pre-deadline) submit advances to disclose the next item. A within-
  // grace submit keeps the recording (scored above) but does NOT advance —
  // currentIndex stays put so no new prompt is ever disclosed — and closes the
  // attempt EXPIRED.
  const nextIndex = pastDeadline ? itemIndex : itemIndex + 1;
  const finalStatus = pastDeadline
    ? SpeakingAttemptStatus.EXPIRED
    : SpeakingAttemptStatus.SUBMITTED;
  set.currentIndex = nextIndex;
  set.status = finalStatus;
  set.submittedAt = now;
  if (pastDeadline) set.scoredAt = now;
  await SpeakingAttemptModel.updateOne({ _id: attempt._id }, { $set: set });

  attempt.currentIndex = nextIndex;
  attempt.status = finalStatus;
  return {
    index: itemIndex,
    status: itemStatus,
    current: buildCurrent(attempt, assessment, now),
  };
}

function toItemResult(
  it: SpeakingAttempt["items"][number],
  itemType: SpeakingItemTypeName,
): SpeakingItemResult {
  return {
    index: it.itemIndex,
    itemType,
    status: it.jobStatus as SpeechJobStatus,
    audioUrl: it.audioUrl ?? "",
    transcript: it.transcript ? it.transcript : null,
    score: (it.subScores as SpeakingItemScoreDto | null) ?? null,
    error: it.error ? it.error : null,
  };
}

export async function getSpeakingAttemptResult(
  userId: string,
  attemptId: string,
): Promise<SpeakingAttemptResult> {
  const attempt = await loadOwnedAttempt(userId, attemptId);
  // The item TYPE lives on the authored assessment, not the attempt item.
  const assessment = await SpeakingAssessmentModel.findById(attempt.assessment);
  const typeAt = (index: number): SpeakingItemTypeName =>
    (assessment?.items[index]?.itemType as SpeakingItemTypeName) ??
    SpeakingItemType.READ_ALOUD;
  // "complete" = every RECORDED/answered item is finalized. Items never answered
  // (no audioUrl, still QUEUED) don't block — a student may leave an item blank.
  const complete = attempt.items.every(
    (it) =>
      (!it.audioUrl && it.jobStatus === SpeechJobStatus.QUEUED) ||
      it.jobStatus === SpeechJobStatus.COMPLETED ||
      it.jobStatus === SpeechJobStatus.FAILED,
  );
  return {
    attemptId: attempt._id.toString(),
    status: attempt.status as SpeakingAttemptStatus,
    complete,
    items: attempt.items.map((it) => toItemResult(it, typeAt(it.itemIndex))),
  };
}

// ---------------------------------------------------------------------------
// College authoring (tenant-scoped)
// ---------------------------------------------------------------------------

/**
 * AUTHORING-time TTS: render prompt TEXT to a FIXED-voice clip and host it,
 * returning the URL + the pinned voice id/version. Runs SERVER-SIDE (Piper in the
 * ASR container) — never browser SpeechSynthesis, whose voice differs per device.
 * The stored URL is used downstream exactly like a manual upload (playback reads
 * promptAudioUrl alone; the voice fields are provenance-only). Gated upstream by
 * the `author` stack (faculty + COMMUNICATION + speaking sub-capability).
 */
export async function generateSpeakingPromptAudio(
  collegeId: string,
  text: string,
): Promise<SpeakingTtsResponse> {
  let synth: Awaited<ReturnType<typeof synthesizePrompt>>;
  try {
    synth = await synthesizePrompt(text);
  } catch (err) {
    if (err instanceof TtsError) {
      throw new AppError(err.message, 503, SpeakingErrorCode.TTS_UNAVAILABLE);
    }
    throw err;
  }
  let audioUrl: string;
  try {
    audioUrl = await uploadBufferToCloudinary(synth.bytes, {
      folder: `${CLOUDINARY_UPLOAD_FOLDER}/speaking-tts/${collegeId}`,
      filename: "prompt.wav",
      resourceType: "video",
    });
  } catch (err) {
    throw new AppError(
      err instanceof Error ? err.message : "Could not host the generated audio.",
      503,
      SpeakingErrorCode.TTS_UNAVAILABLE,
    );
  }
  return { audioUrl, voiceId: synth.voiceId, voiceVersion: synth.voiceVersion };
}

function toDetail(a: AssessmentDoc): SpeakingAssessmentDetail {
  return {
    id: a._id.toString(),
    title: a.title,
    description: a.description ?? "",
    isPublished: a.isPublished,
    maxAttempts: a.maxAttempts,
    orgUnitIds: (a.orgUnits ?? []).map((u) => u.toString()),
    topicId: a.topic ? a.topic.toString() : null,
    items: a.items.map((it) => ({
      itemType: it.itemType,
      referenceText: it.referenceText,
      promptText: it.promptText ?? "",
      promptAudioText: it.promptAudioText ?? "",
      promptAudioUrl: it.promptAudioUrl ?? "",
      promptAudioVoiceId: it.promptAudioVoiceId ?? "",
      promptAudioVoiceVersion: it.promptAudioVoiceVersion ?? "",
      stimulusAudioUrl: it.stimulusAudioUrl ?? "",
      stimulusText: it.stimulusText ?? "",
      stimulusAudioVoiceId: it.stimulusAudioVoiceId ?? "",
      stimulusAudioVoiceVersion: it.stimulusAudioVoiceVersion ?? "",
      stimulusPlayLimit: it.stimulusPlayLimit ?? 0,
      answerSet: it.answerSet ?? [],
      missingWord: it.missingWord ?? "",
      keyFacts: it.keyFacts ?? [],
      chunks: it.chunks ?? [],
      section: it.section ?? "",
      prepSeconds: it.prepSeconds ?? 0,
      responseWindowSeconds: it.responseWindowSeconds ?? 60,
    })),
  };
}

/** Validate that every requested org-unit belongs to this college. */
async function validateOrgUnits(
  collegeId: string,
  orgUnitIds: string[] | undefined,
): Promise<Types.ObjectId[]> {
  if (!orgUnitIds || orgUnitIds.length === 0) return [];
  const ids = orgUnitIds.filter((id) => Types.ObjectId.isValid(id));
  const found = await OrgUnitModel.find({
    _id: { $in: ids },
    college: new Types.ObjectId(collegeId),
  }).select("_id");
  if (found.length !== ids.length) {
    throw new AppError(
      "One or more target units are not in this college",
      400,
      SpeakingErrorCode.ORG_UNIT_OUT_OF_SCOPE,
    );
  }
  return found.map((u) => u._id);
}

function buildItems(input: SpeakingAssessmentUpsert): Array<{
  itemType: SpeakingAssessmentUpsert["items"][number]["itemType"];
  referenceText: string;
  promptText: string;
  promptAudioText: string;
  promptAudioUrl: string;
  promptAudioVoiceId: string;
  promptAudioVoiceVersion: string;
  stimulusAudioUrl: string;
  stimulusText: string;
  stimulusAudioVoiceId: string;
  stimulusAudioVoiceVersion: string;
  stimulusPlayLimit: number;
  answerSet: string[];
  missingWord: string;
  keyFacts: string[];
  chunks: string[];
  section: string;
  prepSeconds: number;
  responseWindowSeconds: number;
  order: number;
}> {
  return input.items.map((it, order) => ({
    itemType: it.itemType,
    referenceText: it.referenceText,
    promptText: it.promptText,
    promptAudioText: it.promptAudioText,
    promptAudioUrl: it.promptAudioUrl,
    promptAudioVoiceId: it.promptAudioVoiceId,
    promptAudioVoiceVersion: it.promptAudioVoiceVersion,
    stimulusAudioUrl: it.stimulusAudioUrl,
    stimulusText: it.stimulusText,
    stimulusAudioVoiceId: it.stimulusAudioVoiceId,
    stimulusAudioVoiceVersion: it.stimulusAudioVoiceVersion,
    stimulusPlayLimit: it.stimulusPlayLimit,
    answerSet: it.answerSet,
    missingWord: it.missingWord,
    keyFacts: it.keyFacts,
    chunks: it.chunks,
    section: it.section,
    prepSeconds: it.prepSeconds,
    responseWindowSeconds: it.responseWindowSeconds,
    order,
  }));
}

export async function createCollegeSpeaking(
  collegeId: string,
  input: SpeakingAssessmentUpsert,
): Promise<SpeakingAssessmentDetail> {
  const scope = createTenantScope(collegeId);
  const orgUnits = await validateOrgUnits(collegeId, input.orgUnitIds);
  const doc = await SpeakingAssessmentModel.create(
    scope.attach({
      topic: null,
      title: input.title,
      description: input.description,
      items: buildItems(input),
      maxAttempts: input.maxAttempts,
      orgUnits,
      isPublished: false,
    }),
  );
  return toDetail(doc);
}

export async function listCollegeSpeaking(
  collegeId: string,
): Promise<SpeakingAssessmentListResponse> {
  const scope = createTenantScope(collegeId);
  const docs = await SpeakingAssessmentModel.find(scope.filter()).sort({
    createdAt: -1,
    _id: -1,
  });
  return {
    items: docs.map((a) => ({
      id: a._id.toString(),
      title: a.title,
      itemCount: a.items.length,
      isPublished: a.isPublished,
      maxAttempts: a.maxAttempts,
      orgUnitIds: (a.orgUnits ?? []).map((u) => u.toString()),
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

async function loadTenant(
  collegeId: string,
  assessmentId: string,
): Promise<AssessmentDoc> {
  const scope = createTenantScope(collegeId);
  if (!Types.ObjectId.isValid(assessmentId)) throw NOT_FOUND();
  const doc = await SpeakingAssessmentModel.findOne(
    scope.filter({ _id: new Types.ObjectId(assessmentId) }),
  );
  if (!doc) throw NOT_FOUND();
  return doc;
}

export async function getCollegeSpeaking(
  collegeId: string,
  assessmentId: string,
): Promise<SpeakingAssessmentDetail> {
  return toDetail(await loadTenant(collegeId, assessmentId));
}

export async function updateCollegeSpeaking(
  collegeId: string,
  assessmentId: string,
  input: SpeakingAssessmentUpsert,
): Promise<SpeakingAssessmentDetail> {
  const doc = await loadTenant(collegeId, assessmentId);
  const orgUnits = await validateOrgUnits(collegeId, input.orgUnitIds);
  doc.title = input.title;
  doc.description = input.description;
  doc.set("items", buildItems(input));
  doc.maxAttempts = input.maxAttempts;
  doc.set("orgUnits", orgUnits);
  await doc.save();
  return toDetail(doc);
}

/** Publish-safety FLOOR, shared by the tenant + platform publish paths (S29):
 *  at least one item, and no listen-based item left without its audio prompt (an
 *  item whose reference is withheld would be unanswerable). Same rule the tenant
 *  path always enforced — extracted verbatim so both surfaces agree. */
function assertSpeakingPublishable(doc: AssessmentDoc): void {
  if (doc.items.length === 0) {
    throw new AppError(
      "Add at least one item before publishing",
      400,
      SpeakingErrorCode.NOT_PUBLISHABLE,
    );
  }
  for (let i = 0; i < doc.items.length; i += 1) {
    const it = doc.items[i]!;
    if (
      speakingItemNeedsAudio({ itemType: it.itemType, chunks: it.chunks ?? [] }) &&
      !it.promptAudioUrl &&
      !it.stimulusAudioUrl
    ) {
      throw new AppError(
        `Item ${i + 1} (${it.itemType}) needs an audio prompt before publishing — generate or attach it first.`,
        400,
        SpeakingErrorCode.NOT_PUBLISHABLE,
      );
    }
  }
}

export async function setCollegeSpeakingPublished(
  collegeId: string,
  assessmentId: string,
  isPublished: boolean,
): Promise<SpeakingAssessmentDetail> {
  const doc = await loadTenant(collegeId, assessmentId);
  if (isPublished) assertSpeakingPublishable(doc);
  doc.isPublished = isPublished;
  await doc.save();
  return toDetail(doc);
}

export async function deleteCollegeSpeaking(
  collegeId: string,
  assessmentId: string,
): Promise<void> {
  const doc = await loadTenant(collegeId, assessmentId);
  if (doc.isPublished) {
    throw new AppError(
      "Unpublish the assessment before deleting it",
      409,
      SpeakingErrorCode.NOT_DELETABLE,
    );
  }
  // EXPIRED (reaped/abandoned) attempts no longer block deletion — the operator
  // can clear them, and they shouldn't pin an assessment open forever. Only
  // live/graded attempts count.
  const attempts = await SpeakingAttemptModel.countDocuments({
    assessment: doc._id,
    status: { $ne: SpeakingAttemptStatus.EXPIRED },
  });
  if (attempts > 0) {
    throw new AppError(
      "This assessment has attempts and cannot be deleted",
      409,
      SpeakingErrorCode.NOT_DELETABLE,
    );
  }
  await SpeakingAttemptModel.deleteMany({ assessment: doc._id });
  await SpeakingAssessmentModel.deleteOne({ _id: doc._id });
}

// ---------------------------------------------------------------------------
// Operator attempt management (visible + clearable — no more stuck rows)
// ---------------------------------------------------------------------------

/** List every attempt on an assessment with its status (incl. expired), so a
 *  faculty operator can SEE stale attempts rather than only a blocked delete. */
export async function listSpeakingAttempts(
  collegeId: string,
  assessmentId: string,
): Promise<SpeakingAttemptAdminList> {
  const doc = await loadTenant(collegeId, assessmentId);
  const attempts = await SpeakingAttemptModel.find({ assessment: doc._id }).sort({
    createdAt: -1,
  });
  const now = new Date();
  const users = await UserModel.find({
    _id: { $in: attempts.map((a) => a.user) },
  }).select("username");
  const nameById = new Map(users.map((u) => [u._id.toString(), u.username]));
  return {
    items: attempts.map((a) => ({
      attemptId: a._id.toString(),
      userId: a.user.toString(),
      userName: nameById.get(a.user.toString()) ?? "unknown",
      status: a.status as SpeakingAttemptStatus,
      currentIndex: a.currentIndex ?? 0,
      totalItems: a.items.length,
      startedAt: a.startedAt ? a.startedAt.toISOString() : a.createdAt.toISOString(),
      expiresAt: a.expiresAt ? a.expiresAt.toISOString() : null,
      expired: attemptExpired(a, now) || a.status === SpeakingAttemptStatus.EXPIRED,
    })),
  };
}

/** Clear one attempt (frees the student's slot; removes the audio references). */
export async function clearSpeakingAttempt(
  collegeId: string,
  assessmentId: string,
  attemptId: string,
): Promise<void> {
  const doc = await loadTenant(collegeId, assessmentId);
  if (!Types.ObjectId.isValid(attemptId)) throw ATTEMPT_NOT_FOUND();
  const res = await SpeakingAttemptModel.deleteOne({
    _id: new Types.ObjectId(attemptId),
    assessment: doc._id,
  });
  if (res.deletedCount === 0) throw ATTEMPT_NOT_FOUND();
}

/** Published tenant assessments the student's cohort can take. */
export async function listAvailableForCollege(
  userId: string,
  collegeId: string,
): Promise<SpeakingPlayListResponse> {
  const scope = createTenantScope(collegeId);
  const user = await UserModel.findById(userId).select("orgUnit");
  const docs = await SpeakingAssessmentModel.find(
    scope.filter({ isPublished: true }),
  ).sort({ createdAt: -1 });

  // Org-unit filtering (empty targets = whole college).
  const units = await OrgUnitModel.find({
    college: new Types.ObjectId(collegeId),
  }).select("_id parent");
  const refs = units.map((u) => ({
    id: u._id.toString(),
    parentId: u.parent ? u.parent.toString() : null,
  }));
  const studentUnit = user?.orgUnit ? user.orgUnit.toString() : null;

  const visible = docs.filter((a) => {
    const targets = (a.orgUnits ?? []).map((u) => u.toString());
    if (targets.length === 0) return true;
    if (!studentUnit) return false;
    return new Set(collectDescendantUnitIds(refs, targets)).has(studentUnit);
  });

  const items = await Promise.all(
    visible.map(async (a) => ({
      id: a._id.toString(),
      topicId: a.topic ? a.topic.toString() : null,
      title: a.title,
      description: a.description ?? "",
      itemCount: a.items.length,
      maxAttempts: a.maxAttempts,
      attemptsUsed: await SpeakingAttemptModel.countDocuments({
        user: userId,
        assessment: a._id,
      }),
    })),
  );
  return { items };
}

// ---------------------------------------------------------------------------
// Course attach (S29) — GAME pattern: entity.topic → Topic, forward + validated
// ---------------------------------------------------------------------------

/**
 * Validate a curriculum topic for a course-attached SPEAKING assessment: it must
 * exist, be a SPEAKING topic, and not already own an assessment (1:1). Direct
 * mirror of `resolveGameTopic` (game-set-admin.service). `excludeId` skips the
 * assessment being edited so re-saving its own topic isn't a false conflict.
 */
export async function resolveSpeakingTopic(
  topicId: string,
  excludeId?: Types.ObjectId,
): Promise<Types.ObjectId> {
  if (!Types.ObjectId.isValid(topicId)) {
    throw new AppError("Topic not found", 404, SpeakingErrorCode.TOPIC_NOT_FOUND);
  }
  const topic = await TopicModel.findById(topicId).select("topicType");
  if (!topic || topic.topicType !== TopicType.SPEAKING) {
    throw new AppError(
      "A speaking assessment can only attach to a SPEAKING topic",
      400,
      SpeakingErrorCode.TOPIC_NOT_SPEAKING,
    );
  }
  const existing = await SpeakingAssessmentModel.findOne({
    topic: topic._id,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  }).select("_id");
  if (existing) {
    throw new AppError(
      "That topic already has a speaking assessment",
      409,
      SpeakingErrorCode.TOPIC_ALREADY_ATTACHED,
    );
  }
  return topic._id;
}

/** Selectable SPEAKING curriculum topics for the course-attach picker (mirror of
 *  game-set-admin.listGameTopics). Reuses the generic {id,name,moduleName,
 *  subjectName,attached} option shape; `attached` = already owns an assessment. */
export async function listSpeakingTopics(): Promise<GameTopicListResponse> {
  const topics = await TopicModel.find({ topicType: TopicType.SPEAKING })
    .select("_id name module")
    .lean();
  if (topics.length === 0) return { items: [] };
  const modules = await ModuleModel.find({
    _id: { $in: topics.map((t) => t.module) },
  })
    .select("_id name subject")
    .lean();
  const modById = new Map(modules.map((m) => [m._id.toString(), m]));
  const subjects = await SubjectModel.find({
    _id: { $in: modules.map((m) => m.subject) },
  })
    .select("_id name")
    .lean();
  const subById = new Map(subjects.map((s) => [s._id.toString(), s.name]));
  const attachedDocs = await SpeakingAssessmentModel.find({
    topic: { $in: topics.map((t) => t._id) },
  })
    .select("topic")
    .lean();
  const attached = new Set(
    attachedDocs.map((a) => a.topic?.toString()).filter(Boolean),
  );
  const items = topics.map((t) => {
    const m = modById.get(t.module.toString());
    return {
      id: t._id.toString(),
      name: t.name,
      moduleName: m?.name ?? "",
      subjectName: m ? (subById.get(m.subject.toString()) ?? "") : "",
      attached: attached.has(t._id.toString()),
    };
  });
  items.sort((a, b) =>
    `${a.subjectName}${a.moduleName}${a.name}`.localeCompare(
      `${b.subjectName}${b.moduleName}${b.name}`,
    ),
  );
  return { items };
}

// ---------------------------------------------------------------------------
// Platform authoring (college: null) — mirrors game-set-admin.service
// ---------------------------------------------------------------------------

/** Load a PLATFORM assessment (college:null) — never a college's, so a platform
 *  admin can't reach a tenant doc (mirrors requireAdminGameSet's { college:null }). */
async function loadPlatform(assessmentId: string): Promise<AssessmentDoc> {
  if (!Types.ObjectId.isValid(assessmentId)) throw NOT_FOUND();
  const doc = await SpeakingAssessmentModel.findOne({
    _id: new Types.ObjectId(assessmentId),
    college: null,
  });
  if (!doc) throw NOT_FOUND();
  return doc;
}

export async function createPlatformSpeaking(
  input: SpeakingAssessmentUpsert,
): Promise<SpeakingAssessmentDetail> {
  // Platform sets are college:null. An optional topicId makes it course-attached
  // (still college:null); omitting it yields a platform-internal set. The
  // college!=null && topic!=null combination is structurally impossible here
  // (college is always null) — the tenant path likewise never sets a topic.
  const topic = input.topicId ? await resolveSpeakingTopic(input.topicId) : null;
  const doc = await SpeakingAssessmentModel.create({
    college: null,
    topic,
    orgUnits: [],
    title: input.title,
    description: input.description,
    items: buildItems(input),
    maxAttempts: input.maxAttempts,
    isPublished: false,
  });
  return toDetail(doc);
}

export async function listPlatformSpeaking(): Promise<SpeakingAssessmentListResponse> {
  const docs = await SpeakingAssessmentModel.find({ college: null }).sort({
    createdAt: -1,
    _id: -1,
  });
  return {
    items: docs.map((a) => ({
      id: a._id.toString(),
      title: a.title,
      itemCount: a.items.length,
      isPublished: a.isPublished,
      maxAttempts: a.maxAttempts,
      orgUnitIds: (a.orgUnits ?? []).map((u) => u.toString()),
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

export async function getPlatformSpeaking(
  assessmentId: string,
): Promise<SpeakingAssessmentDetail> {
  return toDetail(await loadPlatform(assessmentId));
}

export async function updatePlatformSpeaking(
  assessmentId: string,
  input: SpeakingAssessmentUpsert,
): Promise<SpeakingAssessmentDetail> {
  const doc = await loadPlatform(assessmentId);
  doc.topic = input.topicId
    ? await resolveSpeakingTopic(input.topicId, doc._id)
    : null;
  doc.title = input.title;
  doc.description = input.description;
  doc.set("items", buildItems(input));
  doc.maxAttempts = input.maxAttempts;
  await doc.save();
  return toDetail(doc);
}

export async function setPlatformSpeakingPublished(
  assessmentId: string,
  isPublished: boolean,
): Promise<SpeakingAssessmentDetail> {
  const doc = await loadPlatform(assessmentId);
  if (isPublished) assertSpeakingPublishable(doc);
  doc.isPublished = isPublished;
  await doc.save();
  return toDetail(doc);
}

export async function deletePlatformSpeaking(assessmentId: string): Promise<void> {
  const doc = await loadPlatform(assessmentId);
  if (doc.isPublished) {
    throw new AppError(
      "Unpublish the assessment before deleting it",
      409,
      SpeakingErrorCode.NOT_DELETABLE,
    );
  }
  const attempts = await SpeakingAttemptModel.countDocuments({
    assessment: doc._id,
    status: { $ne: SpeakingAttemptStatus.EXPIRED },
  });
  if (attempts > 0) {
    throw new AppError(
      "This assessment has attempts and cannot be deleted",
      409,
      SpeakingErrorCode.NOT_DELETABLE,
    );
  }
  await SpeakingAttemptModel.deleteMany({ assessment: doc._id });
  await SpeakingAssessmentModel.deleteOne({ _id: doc._id });
}

// ---------------------------------------------------------------------------
// Enrollment-based discovery (S29) — mirror of listGamesForUser
// ---------------------------------------------------------------------------

/** Course-attached speaking assessments the user can reach by ENROLLMENT (B2C or
 *  college student): Enrollment → Subject → Module → Topic{SPEAKING} → assessment.
 *  Global; carries topicId so the learn player can match it. Mirrors
 *  listGamesForUser (no publish filter — parity with games). */
export async function listSpeakingForUser(
  userId: string,
): Promise<SpeakingPlayListResponse> {
  const enrollments = await EnrollmentModel.find({ user: userId }).select(
    "subject",
  );
  const subjectIds = enrollments.map((e) => e.subject);
  if (subjectIds.length === 0) return { items: [] };
  const modules = await ModuleModel.find({
    subject: { $in: subjectIds },
  }).select("_id");
  const topics = await TopicModel.find({
    module: { $in: modules.map((m) => m._id) },
    topicType: TopicType.SPEAKING,
  }).select("_id");
  const topicIds = topics.map((t) => t._id);
  if (topicIds.length === 0) return { items: [] };
  // PUBLISHED only — a draft on a course topic is not discoverable (S30 A1).
  const docs = await SpeakingAssessmentModel.find({
    topic: { $in: topicIds },
    isPublished: true,
  });
  const items = await Promise.all(
    docs.map(async (a) => ({
      id: a._id.toString(),
      topicId: a.topic ? a.topic.toString() : null,
      title: a.title,
      description: a.description ?? "",
      itemCount: a.items.length,
      maxAttempts: a.maxAttempts,
      attemptsUsed: await SpeakingAttemptModel.countDocuments({
        user: userId,
        assessment: a._id,
      }),
    })),
  );
  return { items };
}
