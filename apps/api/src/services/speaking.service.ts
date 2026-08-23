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
  SpeechJobStatus,
  SpeakingErrorCode,
  collectDescendantUnitIds,
  isCourseGranted,
  isPlatformAdmin,
  scoreDictation,
  type SpeakingAssessmentDetail,
  type SpeakingAssessmentListResponse,
  type SpeakingAssessmentUpsert,
  type SpeakingAttemptResult,
  type SpeakingItemResult,
  type SpeakingItemScoreDto,
  type SpeakingItemType as SpeakingItemTypeName,
  type SpeakingPlayListResponse,
  type StartSpeakingResponse,
  type SubmitSpeakingItemRequest,
  type SubmitSpeakingItemResponse,
} from "@codeapt/shared";
import { Types, type HydratedDocument } from "mongoose";

import { AppError } from "../errors/app-error.js";
import { enqueueSpeechJob } from "../lib/execution-queue.js";
import { createTenantScope } from "../lib/tenant-scope.js";
import { CollegeModel } from "../models/college.model.js";
import {
  EnrollmentModel,
  ModuleModel,
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

function itemViews(a: AssessmentDoc): StartSpeakingResponse["items"] {
  return a.items.map((it, index) => ({
    index,
    itemType: it.itemType,
    // referenceText is the TASK only for read_aloud (the text on screen). For
    // every other reference type the student hears it and reproduces it, so
    // showing the text would defeat the item — withhold it. answerSet / keyFacts
    // / missingWord are never exposed to the student view at all.
    referenceText:
      it.itemType === SpeakingItemType.READ_ALOUD ? it.referenceText : "",
    promptText: it.promptText ?? "",
    promptAudioUrl: it.promptAudioUrl ?? "",
    stimulusAudioUrl: it.stimulusAudioUrl ?? "",
    stimulusPlayLimit: it.stimulusPlayLimit ?? 0,
    section: it.section ?? "",
    responseWindowSeconds: it.responseWindowSeconds ?? 60,
  }));
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

  // Attempt cap (0 = unlimited).
  if (assessment.maxAttempts > 0) {
    const used = await SpeakingAttemptModel.countDocuments({
      user: userId,
      assessment: assessment._id,
    });
    if (used >= assessment.maxAttempts) {
      throw new AppError(
        "You have used all attempts for this assessment",
        409,
        SpeakingErrorCode.ATTEMPT_LIMIT_REACHED,
      );
    }
  }

  const attempt = await SpeakingAttemptModel.create({
    user: new Types.ObjectId(userId),
    assessment: assessment._id,
    college: assessment.college ?? null,
    status: SpeakingAttemptStatus.IN_PROGRESS,
    startedAt: new Date(),
    // One placeholder per authored item; audioUrl fills in on submit.
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
    attemptId: attempt._id.toString(),
    assessmentTitle: assessment.title,
    status: SpeakingAttemptStatus.IN_PROGRESS,
    items: itemViews(assessment),
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

/**
 * Submit one item's response. For SPOKEN items this stores the recorded audio
 * URL, creates the ExecutionJob and enqueues a transcription on the `speech`
 * queue (the score arrives asynchronously). For DICTATION — which is TYPED, with
 * NO ASR — the typed text is scored INLINE here (string comparison, phonetics
 * off) and the item is finalized COMPLETED in the same request; nothing is
 * queued. No re-record either way: an already-submitted item is refused.
 */
export async function submitSpeakingItem(
  userId: string,
  attemptId: string,
  itemIndex: number,
  body: SubmitSpeakingItemRequest,
): Promise<SubmitSpeakingItemResponse> {
  const attempt = await loadOwnedAttempt(userId, attemptId);
  const attemptItem = attempt.items[itemIndex];
  if (!attemptItem) {
    throw new AppError("Item not found", 404, SpeakingErrorCode.ITEM_NOT_FOUND);
  }
  // One response per item: refuse if already recorded (spoken) or finalized
  // (dictation completes inline, so its status flips to COMPLETED on submit).
  if (
    (attemptItem.audioUrl && attemptItem.audioUrl.length > 0) ||
    attemptItem.jobStatus === SpeechJobStatus.COMPLETED
  ) {
    throw new AppError(
      "This item was already submitted",
      409,
      SpeakingErrorCode.ITEM_ALREADY_SUBMITTED,
    );
  }

  // The authored item carries the type + reference; the attempt item does not.
  const assessment = await SpeakingAssessmentModel.findById(attempt.assessment);
  const authored = assessment?.items[itemIndex];
  if (!authored) {
    throw new AppError("Item not found", 404, SpeakingErrorCode.ITEM_NOT_FOUND);
  }

  // --- DICTATION: typed, scored inline, no ASR / no queue. ---
  if (authored.itemType === SpeakingItemType.DICTATION) {
    if (typeof body.text !== "string") {
      throw new AppError(
        "Dictation requires typed text",
        400,
        SpeakingErrorCode.ITEM_NOT_FOUND,
      );
    }
    const score = scoreDictation(authored.referenceText, body.text);
    await SpeakingAttemptModel.updateOne(
      { _id: attempt._id },
      {
        $set: {
          [`items.${itemIndex}.transcript`]: body.text,
          [`items.${itemIndex}.subScores`]: score,
          [`items.${itemIndex}.jobStatus`]: SpeechJobStatus.COMPLETED,
          status: SpeakingAttemptStatus.SUBMITTED,
          submittedAt: new Date(),
        },
      },
    );
    return { index: itemIndex, status: SpeechJobStatus.COMPLETED };
  }

  // --- SPOKEN items: enqueue a transcription job. ---
  const audioUrl = body.audioUrl;
  if (!audioUrl) {
    throw new AppError(
      "This item requires a recorded audio URL",
      400,
      SpeakingErrorCode.ITEM_NOT_FOUND,
    );
  }
  const jobId = randomUUID();
  await ExecutionJobModel.create({
    jobId,
    user: new Types.ObjectId(userId),
    submissionRef: `${attemptId}:${itemIndex}`,
    queue: QueueName.SPEECH,
    status: JobStatus.QUEUED,
  });
  await SpeakingAttemptModel.updateOne(
    { _id: attempt._id },
    {
      $set: {
        [`items.${itemIndex}.audioUrl`]: audioUrl,
        [`items.${itemIndex}.jobId`]: jobId,
        [`items.${itemIndex}.jobStatus`]: SpeechJobStatus.QUEUED,
        status: SpeakingAttemptStatus.SUBMITTED,
        submittedAt: new Date(),
      },
    },
  );

  await enqueueSpeechJob({
    jobId,
    attemptId,
    itemIndex,
    audioUrl,
    collegeId: attempt.college ? attempt.college.toString() : undefined,
    userId,
  });

  return { index: itemIndex, status: SpeechJobStatus.QUEUED };
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

function toDetail(a: AssessmentDoc): SpeakingAssessmentDetail {
  return {
    id: a._id.toString(),
    title: a.title,
    description: a.description ?? "",
    isPublished: a.isPublished,
    maxAttempts: a.maxAttempts,
    orgUnitIds: (a.orgUnits ?? []).map((u) => u.toString()),
    items: a.items.map((it) => ({
      itemType: it.itemType,
      referenceText: it.referenceText,
      promptText: it.promptText ?? "",
      promptAudioUrl: it.promptAudioUrl ?? "",
      stimulusAudioUrl: it.stimulusAudioUrl ?? "",
      stimulusPlayLimit: it.stimulusPlayLimit ?? 0,
      answerSet: it.answerSet ?? [],
      missingWord: it.missingWord ?? "",
      keyFacts: it.keyFacts ?? [],
      section: it.section ?? "",
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
  promptAudioUrl: string;
  stimulusAudioUrl: string;
  stimulusPlayLimit: number;
  answerSet: string[];
  missingWord: string;
  keyFacts: string[];
  section: string;
  responseWindowSeconds: number;
  order: number;
}> {
  return input.items.map((it, order) => ({
    itemType: it.itemType,
    referenceText: it.referenceText,
    promptText: it.promptText,
    promptAudioUrl: it.promptAudioUrl,
    stimulusAudioUrl: it.stimulusAudioUrl,
    stimulusPlayLimit: it.stimulusPlayLimit,
    answerSet: it.answerSet,
    missingWord: it.missingWord,
    keyFacts: it.keyFacts,
    section: it.section,
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

export async function setCollegeSpeakingPublished(
  collegeId: string,
  assessmentId: string,
  isPublished: boolean,
): Promise<SpeakingAssessmentDetail> {
  const doc = await loadTenant(collegeId, assessmentId);
  if (isPublished && doc.items.length === 0) {
    throw new AppError(
      "Add at least one item before publishing",
      400,
      SpeakingErrorCode.NOT_PUBLISHABLE,
    );
  }
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
  const attempts = await SpeakingAttemptModel.countDocuments({
    assessment: doc._id,
  });
  if (attempts > 0) {
    throw new AppError(
      "This assessment has attempts and cannot be deleted",
      409,
      SpeakingErrorCode.NOT_DELETABLE,
    );
  }
  await SpeakingAssessmentModel.deleteOne({ _id: doc._id });
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
