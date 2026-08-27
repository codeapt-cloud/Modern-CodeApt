/**
 * AI Mock Interview service (Step 33). I/O only; all SCORING is pure in
 * @codeapt/shared (`scoreInterviewAnswerFloor`, `computeInterviewReport`) and all
 * LLM I/O is isolated in `lib/interview-ai.ts` behind the never-throws gateway.
 *
 * ACCESS: `assertCanTakeInterview` is a verbatim clone of
 * `assertCanTakeSpeakingAssessment` — the three tenancy shapes with the same
 * 404-vs-403 discipline and org-unit descendant math; the course-attached branch
 * (a MOCK_INTERVIEW topic) is reachable by a B2C learner via enrollment and by a
 * college student via course grant with NO feature flag.
 *
 * LIFECYCLE (turn-based, DIVERGING from speaking): start intake (resume+JD+role)
 * → LLM analyses the resume + generates the question plan (degrade → role bank) →
 * answer each turn (audio always uploaded; deterministic floor computed inline;
 * the LLM grades the answer and MAY append one adaptive follow-up turn) → on the
 * last turn the stored per-answer data aggregates into the final report inline.
 * Unlike speaking's fixed pre-materialized items, the `turns` array GROWS as
 * follow-ups are inserted; progressive disclosure still rides `currentIndex`.
 */
import {
  CLOUDINARY_UPLOAD_FOLDER,
  INTERVIEW_ANSWER_WINDOW_SECONDS,
  INTERVIEW_MAX_FOLLOWUPS_PER_ANSWER,
  INTERVIEW_MAX_FOLLOWUPS_PER_SESSION,
  INTERVIEW_MAX_QUESTIONS,
  INTERVIEW_MAX_WARNINGS,
  INTERVIEW_PREP_SECONDS,
  InterviewErrorCode,
  type InterviewQuestionCategory,
  InterviewQuestionSource,
  InterviewScoreSource,
  MockInterviewStatus,
  TopicType,
  collectDescendantUnitIds,
  buildResumeQuestions,
  computeInterviewReport,
  correctTranscript,
  dropDuplicateQuestions,
  interviewAcknowledgement,
  interviewClosing,
  interviewGreeting,
  isNearDuplicateQuestion,
  fluencyFromEnvelope,
  isCourseGranted,
  isPlatformAdmin,
  sanitizeClientFluency,
  scoreInterviewAnswerFloor,
  type InterviewCurrentResponse,
  type InterviewPerAnswer,
  type InterviewReport,
  type InterviewTurnView,
  type MockInterviewAttemptAdminList,
  type MockInterviewAttemptResult,
  type MockInterviewCohortReport,
  type MockInterviewDetail,
  type MockInterviewListResponse,
  type MockInterviewPlayListResponse,
  type MockInterviewUpsert,
  type StartMockInterviewRequest,
  type StartMockInterviewResponse,
  type SubmitInterviewAnswerRequest,
  type SubmitInterviewAnswerResponse,
  type SpeakingTtsResponse,
  type GameTopicListResponse,
} from "@codeapt/shared";
import { Types, type HydratedDocument } from "mongoose";

import { AppError } from "../errors/app-error.js";
import { synthesizePrompt, TtsError } from "../lib/asr-tts.js";
import { uploadBufferToCloudinary } from "../lib/cloudinary.js";
import {
  analyzeResume,
  correctTranscriptContextually,
  fallbackQuestions,
  generateFollowUp,
  generateQuestions,
  gradeAnswer,
  type AiMeter,
  type GeneratedQuestion,
} from "../lib/interview-ai.js";
import { createTenantScope } from "../lib/tenant-scope.js";
import { CollegeModel } from "../models/college.model.js";
import {
  EnrollmentModel,
  ModuleModel,
  SubjectModel,
  TopicModel,
} from "../models/curriculum.model.js";
import {
  MockInterviewAttemptModel,
  MockInterviewModel,
  type MockInterview,
  type MockInterviewAttempt,
} from "../models/mock-interview.model.js";
import { OrgUnitModel } from "../models/org-unit.model.js";
import { ProfileModel, UserModel } from "../models/user.model.js";
import { normalizeEntitlements } from "./college.service.js";
import { resolveStudentMeterId } from "./student-ai-credit.service.js";

type AssessmentDoc = HydratedDocument<MockInterview>;
type AttemptDoc = HydratedDocument<MockInterviewAttempt>;
type TurnDoc = MockInterviewAttempt["turns"][number];

const NOT_FOUND = (): AppError =>
  new AppError("Mock interview not found", 404, InterviewErrorCode.ASSESSMENT_NOT_FOUND);
const ATTEMPT_NOT_FOUND = (): AppError =>
  new AppError("Attempt not found", 404, InterviewErrorCode.ATTEMPT_NOT_FOUND);
const OUT_OF_SCOPE = (msg: string): AppError =>
  new AppError(msg, 403, InterviewErrorCode.ORG_UNIT_OUT_OF_SCOPE);

// Overall deadline slack (upload + inter-turn gap), like speaking's grace.
const SUBMIT_GRACE_MS = 90 * 1000;

// ---------------------------------------------------------------------------
// Access matrix (the three shapes) — verbatim clone of the speaking gate.
// ---------------------------------------------------------------------------
export async function assertCanTakeInterview(
  userId: string,
  assessment: AssessmentDoc,
): Promise<void> {
  // 1. TENANT assessment.
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
      const units = await OrgUnitModel.find({ college: assessment.college }).select(
        "_id parent",
      );
      const refs = units.map((u) => ({
        id: u._id.toString(),
        parentId: u.parent ? u.parent.toString() : null,
      }));
      const studentUnit = user.orgUnit ? user.orgUnit.toString() : null;
      const allowed = new Set(collectDescendantUnitIds(refs, targets));
      if (!studentUnit || !allowed.has(studentUnit)) {
        throw OUT_OF_SCOPE("This interview is not assigned to your cohort");
      }
    }
    return;
  }

  // 2. COURSE-ATTACHED (college null, topic set): enrollment OR course grant.
  if (assessment.topic) {
    const topic = await TopicModel.findById(assessment.topic).select("module");
    const mod = topic ? await ModuleModel.findById(topic.module).select("subject") : null;
    if (!mod) throw NOT_FOUND();
    const subjectId = mod.subject.toString();
    const enrolled = await EnrollmentModel.exists({ user: userId, subject: mod.subject });
    if (enrolled) return; // B2C learner via enrollment
    const user = await UserModel.findById(userId).select("college");
    if (user?.college) {
      const college = await CollegeModel.findById(user.college);
      if (college && isCourseGranted(normalizeEntitlements(college), subjectId)) {
        return; // college student via course grant — NO feature flag
      }
    }
    throw NOT_FOUND();
  }

  // 3. PLATFORM-INTERNAL: platform admins only.
  const user = await UserModel.findById(userId).select("role");
  if (!user || !isPlatformAdmin(user.role)) throw NOT_FOUND();
}

// ---------------------------------------------------------------------------
// Timing helpers (mirror speaking).
// ---------------------------------------------------------------------------
function remainingSeconds(expiresAt: Date | null | undefined, now: Date): number {
  if (!expiresAt) return 0;
  return Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
}
function attemptExpired(attempt: AttemptDoc, now: Date): boolean {
  return (
    attempt.currentIndex < attempt.turns.length &&
    attempt.status !== MockInterviewStatus.SCORED &&
    attempt.status !== MockInterviewStatus.EXPIRED &&
    !!attempt.expiresAt &&
    now.getTime() > attempt.expiresAt.getTime()
  );
}

function turnView(turn: TurnDoc): InterviewTurnView {
  return {
    index: turn.index,
    question: turn.question,
    category: turn.category as InterviewQuestionCategory,
    isFollowUp: !!turn.isFollowUp,
    source: turn.source as InterviewQuestionSource,
    promptAudioUrl: turn.promptAudioUrl ?? "",
    answerWindowSeconds: INTERVIEW_ANSWER_WINDOW_SECONDS,
    prepSeconds: INTERVIEW_PREP_SECONDS,
  };
}

function buildCurrent(attempt: AttemptDoc, now: Date): InterviewCurrentResponse {
  const total = attempt.turns.length;
  const expired =
    attempt.status === MockInterviewStatus.EXPIRED || attemptExpired(attempt, now);
  const idx = attempt.currentIndex;
  const done = idx >= total;
  const turn = !expired && !done ? attempt.turns[idx] : undefined;
  // B1 prefetch peek: the first NON-follow-up turn after the current index.
  // Null while expired/done. Lets the runner pre-synthesize the next question's
  // TTS during the current answer so it can speak with no post-submit wait.
  let nextMain: InterviewCurrentResponse["nextMainQuestion"] = null;
  if (!expired && !done) {
    for (let i = idx + 1; i < total; i += 1) {
      const t = attempt.turns[i]!;
      if (!t.isFollowUp) {
        nextMain = {
          index: t.index,
          question: t.question,
          category: t.category as InterviewQuestionCategory,
        };
        break;
      }
    }
  }
  return {
    attemptId: attempt._id.toString(),
    status: attempt.status as MockInterviewStatus,
    totalTurns: total,
    currentIndex: Math.min(idx, total),
    expiresAt: attempt.expiresAt ? attempt.expiresAt.toISOString() : "",
    remainingSeconds: remainingSeconds(attempt.expiresAt, now),
    expired,
    turn: turn ? turnView(turn) : null,
    nextMainQuestion: nextMain,
  };
}

// ---------------------------------------------------------------------------
// Tenant / load helpers.
// ---------------------------------------------------------------------------
async function loadAssessmentOr404(assessmentId: string): Promise<AssessmentDoc> {
  if (!Types.ObjectId.isValid(assessmentId)) throw NOT_FOUND();
  const doc = await MockInterviewModel.findById(assessmentId);
  if (!doc) throw NOT_FOUND();
  return doc;
}
async function loadTenant(collegeId: string, assessmentId: string): Promise<AssessmentDoc> {
  const scope = createTenantScope(collegeId);
  if (!Types.ObjectId.isValid(assessmentId)) throw NOT_FOUND();
  const doc = await MockInterviewModel.findOne(
    scope.filter({ _id: new Types.ObjectId(assessmentId) }),
  );
  if (!doc) throw NOT_FOUND();
  return doc;
}
async function loadPlatform(assessmentId: string): Promise<AssessmentDoc> {
  if (!Types.ObjectId.isValid(assessmentId)) throw NOT_FOUND();
  const doc = await MockInterviewModel.findOne({
    _id: new Types.ObjectId(assessmentId),
    college: null,
  });
  if (!doc) throw NOT_FOUND();
  return doc;
}
async function loadOwnedAttempt(userId: string, attemptId: string): Promise<AttemptDoc> {
  if (!Types.ObjectId.isValid(attemptId)) throw ATTEMPT_NOT_FOUND();
  const attempt = await MockInterviewAttemptModel.findOne({
    _id: new Types.ObjectId(attemptId),
    user: new Types.ObjectId(userId),
  });
  if (!attempt) throw ATTEMPT_NOT_FOUND();
  return attempt;
}

async function validateOrgUnits(
  collegeId: string,
  orgUnitIds: readonly string[] | undefined,
): Promise<Types.ObjectId[]> {
  if (!orgUnitIds || orgUnitIds.length === 0) return [];
  const ids = orgUnitIds.filter((id) => Types.ObjectId.isValid(id));
  const found = await OrgUnitModel.find({
    _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
    college: new Types.ObjectId(collegeId),
  }).select("_id");
  if (found.length !== ids.length) {
    throw OUT_OF_SCOPE("One or more org units are unknown in this college");
  }
  return found.map((u) => u._id);
}

async function resolveInterviewTopic(
  topicId: string,
  excludeId?: Types.ObjectId,
): Promise<Types.ObjectId> {
  if (!Types.ObjectId.isValid(topicId)) {
    throw new AppError("Topic not found", 404, InterviewErrorCode.TOPIC_NOT_FOUND);
  }
  const topic = await TopicModel.findById(topicId).select("topicType");
  if (!topic) throw new AppError("Topic not found", 404, InterviewErrorCode.TOPIC_NOT_FOUND);
  if (topic.topicType !== TopicType.MOCK_INTERVIEW) {
    throw new AppError(
      "That topic is not a mock-interview topic",
      400,
      InterviewErrorCode.TOPIC_NOT_INTERVIEW,
    );
  }
  const existing = await MockInterviewModel.findOne({ topic: topic._id }).select("_id");
  if (existing && (!excludeId || existing._id.toString() !== excludeId.toString())) {
    throw new AppError(
      "That topic already has a mock interview",
      409,
      InterviewErrorCode.TOPIC_ALREADY_ATTACHED,
    );
  }
  return topic._id;
}

// ---------------------------------------------------------------------------
// Projections.
// ---------------------------------------------------------------------------
function toDetail(doc: AssessmentDoc): MockInterviewDetail {
  return {
    id: doc._id.toString(),
    title: doc.title,
    description: doc.description ?? "",
    role: doc.role,
    seniority: doc.seniority ?? "",
    durationMinutes: doc.durationMinutes,
    maxAttempts: doc.maxAttempts,
    isPublished: doc.isPublished,
    plan: {
      behaviouralCount: doc.plan?.behaviouralCount ?? 0,
      technicalCount: doc.plan?.technicalCount ?? 0,
      maxFollowUpsPerAnswer: doc.plan?.maxFollowUpsPerAnswer ?? 0,
      maxFollowUpsPerSession: doc.plan?.maxFollowUpsPerSession ?? 0,
    },
    seedQuestions: (doc.seedQuestions ?? []).map((s) => ({
      text: s.text,
      category: s.category as InterviewQuestionCategory,
      promptAudioUrl: s.promptAudioUrl ?? "",
      promptAudioVoiceId: s.promptAudioVoiceId ?? "",
      promptAudioVoiceVersion: s.promptAudioVoiceVersion ?? "",
    })),
    orgUnitIds: (doc.orgUnits ?? []).map((u) => u.toString()),
    topicId: doc.topic ? doc.topic.toString() : "",
    createdAt: (doc.createdAt as Date).toISOString(),
  };
}

function assertPublishable(doc: AssessmentDoc): void {
  const mains = (doc.plan?.behaviouralCount ?? 0) + (doc.plan?.technicalCount ?? 0);
  if (mains + (doc.seedQuestions?.length ?? 0) === 0) {
    throw new AppError(
      "An interview needs at least one question (a plan count or a seed question)",
      409,
      InterviewErrorCode.NOT_PUBLISHABLE,
    );
  }
}

function buildAssessmentFields(input: MockInterviewUpsert) {
  const behaviouralCount = Math.min(input.plan.behaviouralCount, INTERVIEW_MAX_QUESTIONS);
  const technicalCount = Math.min(input.plan.technicalCount, INTERVIEW_MAX_QUESTIONS);
  return {
    title: input.title,
    description: input.description,
    role: input.role,
    seniority: input.seniority,
    durationMinutes: input.durationMinutes,
    maxAttempts: input.maxAttempts,
    plan: {
      behaviouralCount,
      technicalCount,
      maxFollowUpsPerAnswer: Math.min(
        input.plan.maxFollowUpsPerAnswer,
        INTERVIEW_MAX_FOLLOWUPS_PER_ANSWER,
      ),
      maxFollowUpsPerSession: Math.min(
        input.plan.maxFollowUpsPerSession,
        INTERVIEW_MAX_FOLLOWUPS_PER_SESSION,
      ),
    },
    seedQuestions: (input.seedQuestions ?? []).map((s) => ({
      text: s.text,
      category: s.category,
      promptAudioUrl: s.promptAudioUrl,
      promptAudioVoiceId: s.promptAudioVoiceId,
      promptAudioVoiceVersion: s.promptAudioVoiceVersion,
    })),
  };
}

// ---------------------------------------------------------------------------
// Authoring — college (tenant).
// ---------------------------------------------------------------------------
export async function createCollegeInterview(
  collegeId: string,
  input: MockInterviewUpsert,
): Promise<MockInterviewDetail> {
  const scope = createTenantScope(collegeId);
  const orgUnits = await validateOrgUnits(collegeId, input.orgUnitIds);
  const doc = await MockInterviewModel.create(
    scope.attach({ topic: null, orgUnits, isPublished: false, ...buildAssessmentFields(input) }),
  );
  return toDetail(doc);
}
export async function listCollegeInterviews(
  collegeId: string,
): Promise<MockInterviewListResponse> {
  const scope = createTenantScope(collegeId);
  const docs = await MockInterviewModel.find(scope.filter()).sort({ createdAt: -1, _id: -1 });
  return { items: docs.map(toListItem) };
}
export async function getCollegeInterview(
  collegeId: string,
  assessmentId: string,
): Promise<MockInterviewDetail> {
  return toDetail(await loadTenant(collegeId, assessmentId));
}
export async function updateCollegeInterview(
  collegeId: string,
  assessmentId: string,
  input: MockInterviewUpsert,
): Promise<MockInterviewDetail> {
  const doc = await loadTenant(collegeId, assessmentId);
  const orgUnits = await validateOrgUnits(collegeId, input.orgUnitIds);
  Object.assign(doc, buildAssessmentFields(input));
  doc.orgUnits = orgUnits;
  await doc.save();
  return toDetail(doc);
}
export async function setCollegeInterviewPublished(
  collegeId: string,
  assessmentId: string,
  isPublished: boolean,
): Promise<MockInterviewDetail> {
  const doc = await loadTenant(collegeId, assessmentId);
  if (isPublished) assertPublishable(doc);
  doc.isPublished = isPublished;
  await doc.save();
  return toDetail(doc);
}
export async function deleteCollegeInterview(
  collegeId: string,
  assessmentId: string,
): Promise<void> {
  const doc = await loadTenant(collegeId, assessmentId);
  await assertDeletable(doc);
  await doc.deleteOne();
}

// ---------------------------------------------------------------------------
// Authoring — platform (college:null; topicId → course-attached).
// ---------------------------------------------------------------------------
export async function createPlatformInterview(
  input: MockInterviewUpsert,
): Promise<MockInterviewDetail> {
  const topic = input.topicId ? await resolveInterviewTopic(input.topicId) : null;
  const doc = await MockInterviewModel.create({
    college: null,
    topic,
    orgUnits: [],
    isPublished: false,
    ...buildAssessmentFields(input),
  });
  return toDetail(doc);
}
export async function listPlatformInterviews(): Promise<MockInterviewListResponse> {
  const docs = await MockInterviewModel.find({ college: null }).sort({ createdAt: -1, _id: -1 });
  return { items: docs.map(toListItem) };
}
export async function getPlatformInterview(
  assessmentId: string,
): Promise<MockInterviewDetail> {
  return toDetail(await loadPlatform(assessmentId));
}
export async function updatePlatformInterview(
  assessmentId: string,
  input: MockInterviewUpsert,
): Promise<MockInterviewDetail> {
  const doc = await loadPlatform(assessmentId);
  doc.topic = input.topicId
    ? await resolveInterviewTopic(input.topicId, doc._id)
    : null;
  Object.assign(doc, buildAssessmentFields(input));
  await doc.save();
  return toDetail(doc);
}
export async function setPlatformInterviewPublished(
  assessmentId: string,
  isPublished: boolean,
): Promise<MockInterviewDetail> {
  const doc = await loadPlatform(assessmentId);
  if (isPublished) assertPublishable(doc);
  doc.isPublished = isPublished;
  await doc.save();
  return toDetail(doc);
}
export async function deletePlatformInterview(assessmentId: string): Promise<void> {
  const doc = await loadPlatform(assessmentId);
  await assertDeletable(doc);
  await doc.deleteOne();
}

async function assertDeletable(doc: AssessmentDoc): Promise<void> {
  if (doc.isPublished) {
    throw new AppError(
      "Unpublish before deleting",
      409,
      InterviewErrorCode.NOT_DELETABLE,
    );
  }
  const live = await MockInterviewAttemptModel.exists({
    assessment: doc._id,
    status: { $ne: MockInterviewStatus.EXPIRED },
  });
  if (live) {
    throw new AppError(
      "This interview has attempts and cannot be deleted",
      409,
      InterviewErrorCode.NOT_DELETABLE,
    );
  }
}

function toListItem(doc: AssessmentDoc) {
  return {
    id: doc._id.toString(),
    title: doc.title,
    role: doc.role,
    isPublished: doc.isPublished,
    maxAttempts: doc.maxAttempts,
    orgUnitIds: (doc.orgUnits ?? []).map((u) => u.toString()),
    createdAt: (doc.createdAt as Date).toISOString(),
  };
}

/** Authoring-time Piper TTS for a seed question (mirrors speaking's TTS). */
export async function generateInterviewPromptAudio(
  scope: string,
  text: string,
): Promise<SpeakingTtsResponse> {
  let synth: Awaited<ReturnType<typeof synthesizePrompt>>;
  try {
    synth = await synthesizePrompt(text);
  } catch (err) {
    if (err instanceof TtsError) {
      throw new AppError(err.message, 503, InterviewErrorCode.TTS_UNAVAILABLE);
    }
    throw err;
  }
  try {
    const audioUrl = await uploadBufferToCloudinary(synth.bytes, {
      folder: `${CLOUDINARY_UPLOAD_FOLDER}/interview-tts/${scope}`,
      filename: "prompt.wav",
      resourceType: "video",
    });
    return { audioUrl, voiceId: synth.voiceId, voiceVersion: synth.voiceVersion };
  } catch {
    throw new AppError(
      "Could not host the generated audio",
      503,
      InterviewErrorCode.TTS_UNAVAILABLE,
    );
  }
}

// ---------------------------------------------------------------------------
// Consumption — start.
// ---------------------------------------------------------------------------
function meterFor(collegeId: Types.ObjectId | null | undefined): string | undefined {
  return collegeId ? collegeId.toString() : undefined;
}

async function countAttempts(userId: string, assessmentId: Types.ObjectId): Promise<number> {
  return MockInterviewAttemptModel.countDocuments({
    user: new Types.ObjectId(userId),
    assessment: assessmentId,
    status: { $ne: MockInterviewStatus.EXPIRED },
  });
}

export async function startInterview(
  userId: string,
  assessmentId: string,
  body: StartMockInterviewRequest,
): Promise<StartMockInterviewResponse> {
  const assessment = await loadAssessmentOr404(assessmentId);
  await assertCanTakeInterview(userId, assessment);

  if (assessment.maxAttempts > 0) {
    const used = await countAttempts(userId, assessment._id);
    if (used >= assessment.maxAttempts) {
      throw new AppError(
        "You have used all attempts for this interview",
        409,
        InterviewErrorCode.ATTEMPT_LIMIT_REACHED,
      );
    }
  }

  const role = body.role?.trim() || assessment.role;
  const collegeId = assessment.college ?? null;
  const meterCollege = meterFor(collegeId);
  const meter: AiMeter = {
    collegeId: meterCollege,
    userId: await resolveStudentMeterId(meterCollege, userId),
  };
  const candidateName = await candidateFullName(userId);

  // 1. Analyse the resume (degrade → null; generation still proceeds).
  const analysis = await analyzeResume(body.resumeText, body.jobDescription, role, meter);

  // 2. Generate the question plan (degrade → role-based fallback bank). The
  // resume TEXT + extracted highlights shape the questions (E); the seed
  // questions are threaded in as ALREADY-ASKED so the model doesn't echo them,
  // and we drop any near-duplicate that slips through, regenerating once (D).
  const behaviouralCount = assessment.plan?.behaviouralCount ?? 0;
  const technicalCount = assessment.plan?.technicalCount ?? 0;
  const seeds = (assessment.seedQuestions ?? []).map((s) => s.text);
  const generated = await generateQuestions(
    role,
    assessment.seniority,
    behaviouralCount,
    technicalCount,
    analysis,
    body.jobDescription,
    body.resumeText,
    seeds,
    candidateName,
    meter,
  );
  const aiGenerated = generated !== null;
  // Degrade order (Step 36 D): LLM plan → resume-anchored deterministic questions
  // (when the resume analysis yielded highlights) → the generic role bank. So even
  // without the LLM, questions still reference the candidate's actual experience.
  const resumeFallback = buildResumeQuestions(analysis, behaviouralCount, technicalCount);
  let mainQuestions: GeneratedQuestion[] =
    generated?.questions ??
    (resumeFallback.length > 0 ? resumeFallback : fallbackQuestions(behaviouralCount, technicalCount));
  const greeting = generated?.greeting?.trim() || interviewGreeting(candidateName);
  const closing = generated?.closing?.trim() || interviewClosing();

  if (aiGenerated) {
    const requested = behaviouralCount + technicalCount;
    mainQuestions = dropDuplicateQuestions(mainQuestions, seeds);
    // If de-duplication left us short of the plan, regenerate ONCE, telling the
    // model everything asked so far, and top up from the fresh (deduped) batch.
    if (mainQuestions.length < requested) {
      const asked = [...seeds, ...mainQuestions.map((q) => q.text)];
      const again = await generateQuestions(
        role,
        assessment.seniority,
        behaviouralCount,
        technicalCount,
        analysis,
        body.jobDescription,
        body.resumeText,
        asked,
        candidateName,
        meter,
      );
      if (again) {
        for (const q of dropDuplicateQuestions(again.questions, asked)) {
          if (mainQuestions.length >= requested) break;
          mainQuestions.push(q);
          asked.push(q.text);
        }
      }
    }
  }

  // Seed questions (author-fixed) first, then generated/fallback, capped.
  const turns: TurnDoc[] = [];
  let idx = 0;
  for (const s of assessment.seedQuestions ?? []) {
    if (idx >= INTERVIEW_MAX_QUESTIONS) break;
    turns.push(
      makeTurn(idx++, s.text, s.category as InterviewQuestionCategory, InterviewQuestionSource.SEED, {
        promptAudioUrl: s.promptAudioUrl ?? "",
      }),
    );
  }
  for (const q of mainQuestions) {
    if (idx >= INTERVIEW_MAX_QUESTIONS) break;
    turns.push(
      makeTurn(
        idx++,
        q.text,
        q.category,
        aiGenerated ? InterviewQuestionSource.LLM : InterviewQuestionSource.FALLBACK,
      ),
    );
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + assessment.durationMinutes * 60 * 1000);
  const attempt = await MockInterviewAttemptModel.create({
    user: new Types.ObjectId(userId),
    assessment: assessment._id,
    college: collegeId,
    status: MockInterviewStatus.IN_PROGRESS,
    role,
    seniority: assessment.seniority,
    resumeText: body.resumeText,
    jobDescription: body.jobDescription,
    analysis: analysis ?? null,
    greeting,
    closing,
    turns,
    currentIndex: 0,
    followUpsUsed: 0,
    expiresAt,
    startedAt: now,
  });

  return {
    ...buildCurrent(attempt, now),
    title: assessment.title,
    aiGenerated,
    greeting,
  };
}

/** The candidate's full name (for the greeting), or "" when no profile. */
async function candidateFullName(userId: string): Promise<string> {
  const profile = await ProfileModel.findOne({ user: new Types.ObjectId(userId) }).select(
    "fullName",
  );
  return profile?.fullName ?? "";
}

function makeTurn(
  index: number,
  question: string,
  category: InterviewQuestionCategory,
  source: InterviewQuestionSource,
  extra: Partial<TurnDoc> = {},
): TurnDoc {
  return {
    index,
    category,
    isFollowUp: false,
    source,
    question,
    promptAudioUrl: "",
    parentIndex: null,
    audioUrl: "",
    transcript: "",
    fluency: null,
    latencySeconds: null,
    answered: false,
    answeredAt: null,
    floor: null,
    ai: null,
    feedback: "",
    ...extra,
  } as TurnDoc;
}

// ---------------------------------------------------------------------------
// Consumption — resume / current / submit.
// ---------------------------------------------------------------------------
async function finalizeIfExpired(attempt: AttemptDoc, now: Date): Promise<void> {
  if (
    attempt.status === MockInterviewStatus.IN_PROGRESS &&
    attemptExpired(attempt, now) &&
    now.getTime() > (attempt.expiresAt?.getTime() ?? 0) + SUBMIT_GRACE_MS
  ) {
    await finalizeAttempt(attempt, MockInterviewStatus.EXPIRED, now);
  }
}

export async function getInProgressInterview(
  userId: string,
  assessmentId: string,
): Promise<{ attempt: InterviewCurrentResponse | null }> {
  if (!Types.ObjectId.isValid(assessmentId)) return { attempt: null };
  const attempt = await MockInterviewAttemptModel.findOne({
    user: new Types.ObjectId(userId),
    assessment: new Types.ObjectId(assessmentId),
    status: MockInterviewStatus.IN_PROGRESS,
  });
  if (!attempt) return { attempt: null };
  const now = new Date();
  await finalizeIfExpired(attempt, now);
  return { attempt: buildCurrent(attempt, now) };
}

export async function getCurrentInterviewTurn(
  userId: string,
  attemptId: string,
): Promise<InterviewCurrentResponse> {
  const attempt = await loadOwnedAttempt(userId, attemptId);
  const now = new Date();
  await finalizeIfExpired(attempt, now);
  return buildCurrent(attempt, now);
}

export async function submitInterviewAnswer(
  userId: string,
  attemptId: string,
  turnIndex: number,
  body: SubmitInterviewAnswerRequest,
): Promise<SubmitInterviewAnswerResponse> {
  const attempt = await loadOwnedAttempt(userId, attemptId);
  const now = new Date();

  if (attempt.status !== MockInterviewStatus.IN_PROGRESS) {
    throw new AppError("This interview is not in progress", 409, InterviewErrorCode.ATTEMPT_EXPIRED);
  }
  if (turnIndex !== attempt.currentIndex) {
    throw new AppError("That is not the current question", 409, InterviewErrorCode.NOT_CURRENT_TURN);
  }
  const turn = attempt.turns[turnIndex];
  if (!turn) throw new AppError("Question not found", 404, InterviewErrorCode.NOT_CURRENT_TURN);

  const deadline = attempt.expiresAt?.getTime() ?? 0;
  const pastDeadline = !!attempt.expiresAt && now.getTime() > deadline;
  if (pastDeadline && now.getTime() > deadline + SUBMIT_GRACE_MS) {
    await finalizeAttempt(attempt, MockInterviewStatus.EXPIRED, now);
    throw new AppError("This interview's time has expired", 409, InterviewErrorCode.ATTEMPT_EXPIRED);
  }

  const role = attempt.role;
  const meterCollege = meterFor(attempt.college);
  const meter: AiMeter = {
    collegeId: meterCollege,
    userId: await resolveStudentMeterId(meterCollege, userId),
  };

  // --- Record the answer + deterministic floor (audio ALWAYS stored). ---
  const rawTranscript = (body.transcript ?? "").trim();
  // Two-stage transcript correction. Stage 1 (Step 34 fix #3): deterministic
  // term-list correction of KNOWN JD/resume terms — TERMS ONLY, never phrasing.
  // Stage 2 (Step 35 G): an LLM pass fixes GENERAL mishearings the term list
  // can't, gated by a structural guard so it can only fix, never rewrite; it
  // degrades to the term-list text when the LLM is unavailable. The FINAL
  // corrected transcript is what every dimension scores; the raw is kept for
  // disputes and every change (term + contextual) is recorded for the audit view.
  const terms = ((attempt.analysis as { terms?: unknown } | null)?.terms ?? []) as string[];
  const termsArr = Array.isArray(terms) ? terms : [];
  const correction = correctTranscript(rawTranscript, termsArr);
  const termCorrected = correction.corrected.trim();
  const answered = !body.silent && termCorrected !== "";
  turn.audioUrl = body.audioUrl ?? "";
  turn.latencySeconds = typeof body.latencySeconds === "number" ? body.latencySeconds : null;
  turn.answeredAt = now;

  let followUpAdded = false;
  let acknowledgement = "";
  let closing = "";
  if (answered) {
    // Stage 2 contextual correction runs BEFORE scoring (the corrected transcript
    // is what's scored). One LLM round-trip; the runner's "thinking" state covers
    // it. Degrades to the term-list transcript on unavailability or an over-edit.
    const contextual = await correctTranscriptContextually(termCorrected, termsArr, role, meter);
    const transcript = (contextual?.text ?? termCorrected).trim();
    const contextChanges = contextual?.changes ?? [];

    const fluency =
      sanitizeClientFluency(body.fluency, INTERVIEW_ANSWER_WINDOW_SECONDS, transcript) ??
      fluencyFromEnvelope([], 0, transcript);
    turn.transcript = transcript;
    turn.rawTranscript = rawTranscript;
    turn.corrections = [...correction.applied, ...contextChanges];
    turn.fluency = fluency;
    turn.answered = true;
    turn.floor = scoreInterviewAnswerFloor(transcript, fluency, turn.latencySeconds ?? undefined);

    // --- Grading and the follow-up decision are INDEPENDENT LLM calls, so run
    // them CONCURRENTLY (Step 34 B): the submit round-trip is then max(grade,
    // follow-up) instead of their sum — the follow-up decision gates what the
    // runner speaks next, so shortening this path is the conversational win.
    // Grading (protected interactive tier) annotates the turn; the follow-up
    // (deferrable tier) may splice a probe. Both degrade to null independently. ---
    const rootIndex = turn.isFollowUp ? (turn.parentIndex ?? turn.index) : turn.index;
    const followUpsForRoot = attempt.turns.filter((t) => t.parentIndex === rootIndex).length;
    const plan = await planFor(attempt.assessment);
    const canFollowUp =
      !pastDeadline &&
      attempt.followUpsUsed < plan.maxFollowUpsPerSession &&
      followUpsForRoot < plan.maxFollowUpsPerAnswer;
    // Every question asked so far — threaded into the follow-up so it never
    // repeats one (D). Also the dedup baseline for the returned probe.
    const asked = attempt.turns.map((t) => t.question);
    const [judged, probe] = await Promise.all([
      gradeAnswer(
        turn.question,
        transcript,
        turn.category as InterviewQuestionCategory,
        role,
        meter,
      ),
      canFollowUp
        ? generateFollowUp(turn.question, transcript, role, asked, meter)
        : Promise.resolve(null),
    ]);
    if (judged) {
      turn.ai = judged.scores;
      turn.feedback = judged.feedback;
    }
    // A neutral acknowledgement of this answer, spoken before the next question
    // (F). The grading call supplies a tailored one for free; fall back to the
    // deterministic phrase bank (varied by turn index) when the LLM is down.
    acknowledgement = judged?.acknowledgement?.trim() || interviewAcknowledgement(turn.index);
    // Splice a probe only when one came back AND it isn't a near-duplicate of an
    // already-asked question (D — the last-line defence past the prompt instruction).
    if (canFollowUp && probe && !isNearDuplicateQuestion(probe, asked)) {
      const insertAt = turnIndex + 1;
      const follow = makeTurn(
        insertAt,
        probe,
        turn.category as InterviewQuestionCategory,
        InterviewQuestionSource.LLM,
        { isFollowUp: true, parentIndex: rootIndex },
      );
      attempt.turns.splice(insertAt, 0, follow);
      reindexTurns(attempt);
      attempt.followUpsUsed += 1;
      followUpAdded = true;
    }
  } else {
    turn.answered = false;
  }

  const respond = (): SubmitInterviewAnswerResponse => ({
    index: turnIndex,
    followUpAdded,
    current: buildCurrent(attempt, now),
    acknowledgement,
    closing,
  });

  // --- Advance. Within-grace-but-past-deadline: accept once, do NOT advance, close. ---
  if (pastDeadline) {
    await finalizeAttempt(attempt, MockInterviewStatus.EXPIRED, now);
    closing = attempt.closing || interviewClosing();
    return respond();
  }

  attempt.currentIndex = turnIndex + 1;
  if (attempt.currentIndex >= attempt.turns.length) {
    await finalizeAttempt(attempt, MockInterviewStatus.SCORED, now);
    closing = attempt.closing || interviewClosing();
  } else {
    await attempt.save();
  }
  return respond();
}

function reindexTurns(attempt: AttemptDoc): void {
  attempt.turns.forEach((t, i) => {
    t.index = i;
  });
}

async function planFor(assessmentId: Types.ObjectId): Promise<{
  maxFollowUpsPerAnswer: number;
  maxFollowUpsPerSession: number;
}> {
  const doc = await MockInterviewModel.findById(assessmentId).select("plan");
  return {
    maxFollowUpsPerAnswer: doc?.plan?.maxFollowUpsPerAnswer ?? 0,
    maxFollowUpsPerSession: doc?.plan?.maxFollowUpsPerSession ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Scoring (aggregate the stored per-answer data — pure).
// ---------------------------------------------------------------------------
function buildReport(attempt: AttemptDoc): InterviewReport {
  const answers: InterviewPerAnswer[] = attempt.turns.map((t) => ({
    index: t.index,
    question: t.question,
    category: t.category as InterviewQuestionCategory,
    isFollowUp: !!t.isFollowUp,
    floor: (t.floor as { speaking: number; vocabulary: number } | null) ?? {
      speaking: 0,
      vocabulary: 0,
    },
    ai: (t.ai as InterviewPerAnswer["ai"]) ?? null,
    answered: !!t.answered,
  }));
  return computeInterviewReport(answers);
}

async function finalizeAttempt(
  attempt: AttemptDoc,
  status: MockInterviewStatus,
  now: Date,
): Promise<void> {
  const report = buildReport(attempt);
  attempt.report = report;
  attempt.reportSource = report.source;
  attempt.summary = summarize(attempt.role, report);
  attempt.status = status;
  attempt.scoredAt = now;
  if (status === MockInterviewStatus.EXPIRED && !attempt.submittedAt) {
    attempt.submittedAt = now;
  }
  await attempt.save();
}

function summarize(role: string, report: InterviewReport): string {
  if (report.overall === null) return "No answers were recorded for this interview.";
  const badge =
    report.source === InterviewScoreSource.AI_HYBRID
      ? "scored with AI judgement"
      : "scored on the deterministic measures only (AI was unavailable)";
  return `Overall ${report.overall}/100 for the ${role} interview, ${badge}.`;
}

// ---------------------------------------------------------------------------
// Result read.
// ---------------------------------------------------------------------------
export async function getInterviewResult(
  userId: string,
  attemptId: string,
): Promise<MockInterviewAttemptResult> {
  const attempt = await loadOwnedAttempt(userId, attemptId);
  const now = new Date();
  await finalizeIfExpired(attempt, now);
  return toResult(attempt);
}

function toResult(attempt: AttemptDoc): MockInterviewAttemptResult {
  const report = attempt.report as InterviewReport | null;
  const complete =
    attempt.status === MockInterviewStatus.SCORED ||
    attempt.status === MockInterviewStatus.EXPIRED;
  return {
    attemptId: attempt._id.toString(),
    status: attempt.status as MockInterviewStatus,
    complete,
    role: attempt.role,
    seniority: attempt.seniority,
    dimensions: report?.dimensions ?? null,
    overall: report?.overall ?? null,
    source: (attempt.reportSource as InterviewScoreSource) ?? InterviewScoreSource.DETERMINISTIC_FLOOR,
    approximate: report?.approximate ?? false,
    summary: attempt.summary ?? "",
    perQuestion: attempt.turns.map((t) => ({
      index: t.index,
      question: t.question,
      category: t.category as InterviewQuestionCategory,
      isFollowUp: !!t.isFollowUp,
      answered: !!t.answered,
      speaking: t.answered ? ((t.floor as { speaking: number } | null)?.speaking ?? null) : null,
      vocabulary: t.answered ? ((t.floor as { vocabulary: number } | null)?.vocabulary ?? null) : null,
      concept: (t.ai as { concept: number | null } | null)?.concept ?? null,
      analysis: (t.ai as { analysis: number | null } | null)?.analysis ?? null,
      topicKnowledge: (t.ai as { topicKnowledge: number | null } | null)?.topicKnowledge ?? null,
      relevance: (t.ai as { relevance: number | null } | null)?.relevance ?? null,
      star: (t.ai as { star: number | null } | null)?.star ?? null,
      transcript: t.transcript ? t.transcript : null,
      rawTranscript: t.rawTranscript ? t.rawTranscript : null,
      corrections: (Array.isArray(t.corrections) ? t.corrections : []) as {
        from: string;
        to: string;
        kind: string;
      }[],
      audioUrl: t.audioUrl ?? "",
      feedback: t.feedback ?? "",
    })),
    terminated: !!attempt.terminated,
    terminatedReason: attempt.terminatedReason ? attempt.terminatedReason : null,
  };
}

// ---------------------------------------------------------------------------
// Proctoring — server-authoritative warning (mirrors speaking Step 32).
// ---------------------------------------------------------------------------
export async function recordInterviewWarning(
  userId: string,
  attemptId: string,
  reason?: string,
): Promise<{ warnings: number; terminated: boolean }> {
  const attempt = await loadOwnedAttempt(userId, attemptId);
  if (attempt.terminated) return { warnings: attempt.warnings ?? 0, terminated: true };
  const warnings = (attempt.warnings ?? 0) + 1;
  const terminated = warnings >= INTERVIEW_MAX_WARNINGS;
  attempt.warnings = warnings;
  // Record WHY (audit) — a camera "frame changed" signal (multiple_faces /
  // left_frame) or a generic proctoring violation. This never records identity.
  attempt.proctoringEvents = [
    ...((attempt.proctoringEvents as { reason: string; at: Date }[] | undefined) ?? []),
    { reason: (reason ?? "proctoring").slice(0, 40), at: new Date() },
  ];
  if (terminated) {
    attempt.terminated = true;
    attempt.terminatedReason = "unauthorised actions detected";
    await finalizeAttempt(attempt, MockInterviewStatus.SCORED, new Date());
  } else {
    await attempt.save();
  }
  return { warnings, terminated };
}

// ---------------------------------------------------------------------------
// Operator — attempt list + cohort report (tenant).
// ---------------------------------------------------------------------------
export async function listInterviewAttempts(
  collegeId: string,
  assessmentId: string,
): Promise<MockInterviewAttemptAdminList> {
  const assessment = await loadTenant(collegeId, assessmentId);
  const attempts = await MockInterviewAttemptModel.find({ assessment: assessment._id }).sort({
    createdAt: -1,
  });
  const profiles = await profileMap(attempts.map((a) => a.user.toString()));
  return {
    items: attempts.map((a) => {
      const p = profiles.get(a.user.toString());
      const report = a.report as InterviewReport | null;
      return {
        attemptId: a._id.toString(),
        userId: a.user.toString(),
        userName: p?.fullName ?? "",
        rollNumber: p?.rollNumber ?? "",
        status: a.status as MockInterviewStatus,
        overall: report?.overall ?? null,
        source: (a.reportSource as InterviewScoreSource) ?? InterviewScoreSource.DETERMINISTIC_FLOOR,
        startedAt: a.startedAt ? a.startedAt.toISOString() : null,
        scoredAt: a.scoredAt ? a.scoredAt.toISOString() : null,
        flagged: !!a.terminated,
      };
    }),
  };
}

export async function clearInterviewAttempt(
  collegeId: string,
  assessmentId: string,
  attemptId: string,
): Promise<void> {
  const assessment = await loadTenant(collegeId, assessmentId);
  if (!Types.ObjectId.isValid(attemptId)) throw ATTEMPT_NOT_FOUND();
  const res = await MockInterviewAttemptModel.deleteOne({
    _id: new Types.ObjectId(attemptId),
    assessment: assessment._id,
  });
  if (res.deletedCount === 0) throw ATTEMPT_NOT_FOUND();
}

export async function getInterviewCohortReport(
  collegeId: string,
  assessmentId: string,
): Promise<MockInterviewCohortReport> {
  const assessment = await loadTenant(collegeId, assessmentId);
  const attempts = await MockInterviewAttemptModel.find({ assessment: assessment._id });
  const byUser = new Map<string, AttemptDoc[]>();
  for (const a of attempts) {
    const k = a.user.toString();
    (byUser.get(k) ?? byUser.set(k, []).get(k)!).push(a);
  }
  const profiles = await profileMap([...byUser.keys()]);
  const rows = [...byUser.entries()].map(([uid, list]) => {
    // BEST attempt by overall (a retake never lowers the cohort number).
    let best: InterviewReport | null = null;
    let bestOverall = -1;
    for (const a of list) {
      const r = a.report as InterviewReport | null;
      if (r && r.overall !== null && r.overall > bestOverall) {
        bestOverall = r.overall;
        best = r;
      }
    }
    const p = profiles.get(uid);
    return {
      userId: uid,
      userName: p?.fullName ?? "",
      rollNumber: p?.rollNumber ?? "",
      attempts: list.length,
      bestOverall: best ? best.overall : null,
      speaking: best ? best.dimensions.speaking : null,
      vocabulary: best ? best.dimensions.vocabulary : null,
      concept: best ? best.dimensions.concept : null,
      analysis: best ? best.dimensions.analysis : null,
      topicKnowledge: best ? best.dimensions.topicKnowledge : null,
      source: best ? best.source : null,
    };
  });
  rows.sort((a, b) => a.rollNumber.localeCompare(b.rollNumber) || a.userName.localeCompare(b.userName));
  return { id: assessment._id.toString(), title: assessment.title, role: assessment.role, rows };
}

async function profileMap(
  userIds: string[],
): Promise<Map<string, { fullName: string; rollNumber: string }>> {
  if (userIds.length === 0) return new Map();
  const profiles = await ProfileModel.find({
    user: { $in: userIds.map((id) => new Types.ObjectId(id)) },
  }).select("user fullName rollNumber");
  return new Map(
    profiles.map((p): [string, { fullName: string; rollNumber: string }] => [
      p.user.toString(),
      { fullName: p.fullName ?? "", rollNumber: p.rollNumber ?? "" },
    ]),
  );
}

// ---------------------------------------------------------------------------
// Discovery.
// ---------------------------------------------------------------------------
export async function listAvailableForCollege(
  userId: string,
  collegeId: string,
): Promise<MockInterviewPlayListResponse> {
  const user = await UserModel.findById(userId).select("orgUnit");
  const scope = createTenantScope(collegeId);
  const docs = await MockInterviewModel.find(scope.filter({ isPublished: true })).sort({
    createdAt: -1,
  });
  const units = await OrgUnitModel.find({ college: new Types.ObjectId(collegeId) }).select(
    "_id parent",
  );
  const refs = units.map((u) => ({
    id: u._id.toString(),
    parentId: u.parent ? u.parent.toString() : null,
  }));
  const studentUnit = user?.orgUnit ? user.orgUnit.toString() : null;
  const visible = docs.filter((d) => {
    const targets = (d.orgUnits ?? []).map((u) => u.toString());
    if (targets.length === 0) return true;
    if (!studentUnit) return false;
    return new Set(collectDescendantUnitIds(refs, targets)).has(studentUnit);
  });
  return { items: await toPlayList(userId, visible) };
}

export async function listInterviewsForUser(
  userId: string,
): Promise<MockInterviewPlayListResponse> {
  const enrollments = await EnrollmentModel.find({ user: new Types.ObjectId(userId) }).select(
    "subject",
  );
  const subjectIds = enrollments.map((e) => e.subject);
  if (subjectIds.length === 0) return { items: [] };
  const modules = await ModuleModel.find({ subject: { $in: subjectIds } }).select("_id");
  const topics = await TopicModel.find({
    module: { $in: modules.map((m) => m._id) },
    topicType: TopicType.MOCK_INTERVIEW,
  }).select("_id");
  if (topics.length === 0) return { items: [] };
  const docs = await MockInterviewModel.find({
    topic: { $in: topics.map((t) => t._id) },
    isPublished: true,
  }).sort({ createdAt: -1 });
  return { items: await toPlayList(userId, docs) };
}

async function toPlayList(userId: string, docs: AssessmentDoc[]) {
  return Promise.all(
    docs.map(async (d) => ({
      id: d._id.toString(),
      topicId: d.topic ? d.topic.toString() : "",
      title: d.title,
      role: d.role,
      seniority: d.seniority ?? "",
      durationMinutes: d.durationMinutes,
      maxAttempts: d.maxAttempts,
      attemptsUsed: await countAttempts(userId, d._id),
    })),
  );
}

/** Course-attach picker: MOCK_INTERVIEW topics + whether each is already taken
 *  (1:1). Mirrors listSpeakingTopics; reuses the GameTopic list shape. */
export async function listInterviewTopics(): Promise<GameTopicListResponse> {
  const topics = await TopicModel.find({ topicType: TopicType.MOCK_INTERVIEW })
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
  const attachedDocs = await MockInterviewModel.find({
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
      subjectName: m ? subById.get(m.subject.toString()) ?? "" : "",
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

/** Reaper predicate (pure) — mirrors shouldReapSpeaking. */
export function shouldReapInterview(
  attempt: Pick<MockInterviewAttempt, "status" | "expiresAt" | "currentIndex" | "turns">,
  now: Date,
): boolean {
  if (
    attempt.status !== MockInterviewStatus.IN_PROGRESS &&
    attempt.status !== MockInterviewStatus.SUBMITTED
  ) {
    return false;
  }
  if (!attempt.expiresAt) return false;
  if (now.getTime() <= attempt.expiresAt.getTime() + SUBMIT_GRACE_MS) return false;
  return attempt.currentIndex < attempt.turns.length;
}
