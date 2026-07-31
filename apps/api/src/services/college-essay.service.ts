/**
 * College essay service (Phase 4c) — tenant-scoped authoring + writing over the
 * EXISTING essay engine. Nothing here forks the engine: authoring delegates to
 * essay-topic-admin.service (topic CRUD, keyword generation) and writing
 * delegates to the essay.service *ForTopic cores (draft autosave, the attempt-
 * cap + word-bounds submit, and the SAME async grading pipeline — deterministic
 * weights + LLM blend + risk scoring, entirely unchanged). Grading-status polling
 * + analytics ride the shared /essays/submissions/:jobId endpoints (authorized by
 * attempt ownership), so a college student uses them unchanged — not duplicated.
 *
 * A college essay is an EssayTopic with `college` set and NO curriculum link
 * (standalone → isolated from the shared master curriculum + the enrollment
 * browse path), targeted at the whole college or specific org-units, with a
 * draft→published lifecycle. Isolation is enforced by routing EVERY query through
 * createTenantScope: a topic/attempt not tagged with this tenant simply isn't
 * found (404), so no college can author/write/read another's — and individual
 * (college:null) essays are invisible here and entirely unaffected (they surface
 * only via enrollment, which never sees college topics).
 *
 * Authoring is college_admin (unrestricted in-tenant) or faculty (only topics
 * targeted within their org-unit scope). Writing is by that college's students
 * whose org-unit falls in the topic's target (empty target = college-wide).
 * See docs/MULTI_TENANT_ARCHITECTURE.md §2.
 */
import {
  collectDescendantUnitIds,
  EssayTopicErrorCode,
  JobStatus,
  StudentErrorCode,
  type AdminEssayTopic,
  type AdminEssayTopicUpsert,
  type CollegeEssayListResponse,
  type CollegeEssayResultsResponse,
  type CreateCollegeEssayInput,
  type EssayDraftResponse,
  type EssayListResponse,
  type EssayPromptDetail,
  type EssayPromptSummary,
  type EssayScoreSource,
  type EssaySubmissionListResponse,
  type GenerateKeywordsRequest,
  type GenerateKeywordsResponse,
  type JobRef,
  type SaveEssayDraftResponse,
  type UpdateCollegeEssayInput,
} from "@codeapt/shared";
import { Types, type HydratedDocument } from "mongoose";

import { AppError } from "../errors/app-error.js";
import { createTenantScope, type TenantScope } from "../lib/tenant-scope.js";
import {
  EssayAttemptModel,
  EssayTopicModel,
  type EssayTopic,
} from "../models/essay.model.js";
import { OrgUnitModel } from "../models/org-unit.model.js";
import { ProfileModel, UserModel } from "../models/user.model.js";
import * as essayAdmin from "./essay-topic-admin.service.js";
import * as essays from "./essay.service.js";
import {
  resolveActorScope,
  type ActorScope,
  type StudentActor,
} from "./student.service.js";

type TopicDoc = HydratedDocument<EssayTopic>;

/** The acting operator/student — same shape the student service uses. */
export type EssayActor = StudentActor;

const NOT_FOUND = () =>
  new AppError(
    "Essay not found",
    404,
    EssayTopicErrorCode.ESSAY_TOPIC_NOT_FOUND,
  );
const OUT_OF_SCOPE = (msg: string) =>
  new AppError(msg, 403, StudentErrorCode.ORG_UNIT_OUT_OF_SCOPE);

// --- Org-unit scope helpers (mirror college-exam.service) --------------------

/** [{id, parentId}] for every unit in the tenant (for descendant math). */
async function unitRefs(
  scope: TenantScope,
): Promise<{ id: string; parentId: string | null }[]> {
  const units = await OrgUnitModel.find(scope.filter()).select("_id parent");
  return units.map((u) => ({
    id: u._id.toString(),
    parentId: u.parent ? u.parent.toString() : null,
  }));
}

/**
 * Validate a college essay's target org-units: every id must exist IN THIS
 * TENANT, and (for faculty) be within the actor's scope. A faculty member must
 * target at least one in-scope unit (they cannot create a college-wide essay);
 * a college_admin may target any units or none (empty = college-wide).
 */
async function validateTargetUnits(
  scope: TenantScope,
  actorScope: ActorScope,
  orgUnitIds: string[],
): Promise<Types.ObjectId[]> {
  const unique = [...new Set(orgUnitIds)];
  for (const id of unique) {
    if (!Types.ObjectId.isValid(id)) {
      throw OUT_OF_SCOPE("One or more target org-units are invalid");
    }
  }
  if (unique.length === 0) {
    if (!actorScope.unrestricted) {
      throw OUT_OF_SCOPE(
        "Faculty must target one or more org-units within their scope",
      );
    }
    return [];
  }
  const found = await OrgUnitModel.find(
    scope.filter({ _id: { $in: unique } }),
  ).select("_id");
  if (found.length !== unique.length) {
    throw OUT_OF_SCOPE("One or more target org-units are not in this college");
  }
  if (!actorScope.unrestricted) {
    for (const id of unique) {
      if (!actorScope.unitIds.has(id)) {
        throw OUT_OF_SCOPE("One or more target org-units are outside your scope");
      }
    }
  }
  return unique.map((id) => new Types.ObjectId(id));
}

/** A faculty member may only manage a topic whose target is within their scope. */
function assertTopicManageable(topic: TopicDoc, actorScope: ActorScope): void {
  if (actorScope.unrestricted) return;
  const units = (topic.orgUnits ?? []).map((u) => u.toString());
  if (units.length === 0 || !units.every((u) => actorScope.unitIds.has(u))) {
    throw OUT_OF_SCOPE("This essay is outside your assigned scope");
  }
}

// --- Tenant topic resolution -------------------------------------------------

/** Load a college essay topic of THIS tenant, or 404 (isolation: cross-tenant not found). */
async function requireTenantTopic(
  scope: TenantScope,
  topicId: string,
): Promise<TopicDoc> {
  if (!Types.ObjectId.isValid(topicId)) throw NOT_FOUND();
  const topic = await EssayTopicModel.findOne(scope.filter({ _id: topicId }));
  if (!topic) throw NOT_FOUND();
  return topic;
}

/** Resolve topic + actor scope, then assert the actor may manage it. */
async function forManage(
  collegeId: string,
  actor: EssayActor,
  topicId: string,
): Promise<{ scope: TenantScope; topic: TopicDoc }> {
  const scope = createTenantScope(collegeId);
  const [actorScope, topic] = await Promise.all([
    resolveActorScope(scope, actor),
    requireTenantTopic(scope, topicId),
  ]);
  assertTopicManageable(topic, actorScope);
  return { scope, topic };
}

function dedupeKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keywords) {
    const k = raw.trim();
    if (!k) continue;
    const key = k.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
  }
  return out;
}

/** The base (non-tenant) essay-topic fields from a college create/update input. */
function baseFields(input: AdminEssayTopicUpsert): Record<string, unknown> {
  return {
    title: input.title.trim(),
    description: input.description,
    instructions: input.instructions,
    difficultyLevel: input.difficultyLevel,
    minWords: input.minWords,
    maxWords: input.maxWords,
    timeLimitMinutes: input.timeLimitMinutes,
    maxAttempts: input.maxAttempts,
    isActive: input.isActive,
    semanticKeywords: dedupeKeywords(input.semanticKeywords),
  };
}

// --- Authoring: essay-topic lifecycle ---------------------------------------

export async function createCollegeEssay(
  collegeId: string,
  actor: EssayActor,
  input: CreateCollegeEssayInput,
): Promise<AdminEssayTopic> {
  const scope = createTenantScope(collegeId);
  const actorScope = await resolveActorScope(scope, actor);
  const orgUnits = await validateTargetUnits(
    scope,
    actorScope,
    input.orgUnitIds,
  );
  const topic = await EssayTopicModel.create(
    scope.attach({
      ...baseFields(input),
      orgUnits,
      isPublished: false,
    }),
  );
  return essayAdmin.getEssayTopicAdmin(topic._id.toString());
}

export async function listCollegeEssays(
  collegeId: string,
  actor: EssayActor,
): Promise<CollegeEssayListResponse> {
  const scope = createTenantScope(collegeId);
  const actorScope = await resolveActorScope(scope, actor);
  const topics = await EssayTopicModel.find(scope.filter()).sort({
    createdAt: -1,
    _id: -1,
  });

  const manageable = actorScope.unrestricted
    ? topics
    : topics.filter((t) => {
        const units = (t.orgUnits ?? []).map((u) => u.toString());
        return units.length > 0 && units.every((u) => actorScope.unitIds.has(u));
      });

  const items = await Promise.all(
    manageable.map(async (topic) => {
      const attemptCount = await EssayAttemptModel.countDocuments(
        scope.filter({ essayTopic: topic._id }),
      );
      return {
        id: topic._id.toString(),
        title: topic.title,
        difficultyLevel: (topic.difficultyLevel ?? 1) as 1 | 2 | 3,
        minWords: topic.minWords,
        maxWords: topic.maxWords,
        timeLimitMinutes: topic.timeLimitMinutes,
        maxAttempts: topic.maxAttempts ?? 3,
        isPublished: topic.isPublished,
        orgUnitIds: (topic.orgUnits ?? []).map((u) => u.toString()),
        attemptCount,
        createdAt: topic.createdAt.toISOString(),
      };
    }),
  );
  return { items };
}

export async function getCollegeEssay(
  collegeId: string,
  actor: EssayActor,
  topicId: string,
): Promise<AdminEssayTopic> {
  const { topic } = await forManage(collegeId, actor, topicId);
  return essayAdmin.getEssayTopicAdmin(topic._id.toString());
}

export async function updateCollegeEssay(
  collegeId: string,
  actor: EssayActor,
  topicId: string,
  input: UpdateCollegeEssayInput,
): Promise<AdminEssayTopic> {
  const { scope, topic } = await forManage(collegeId, actor, topicId);
  const actorScope = await resolveActorScope(scope, actor);
  const orgUnits = await validateTargetUnits(
    scope,
    actorScope,
    input.orgUnitIds,
  );
  // Reuse the admin base-field update (validation + keyword dedupe), then set
  // the tenant targeting. Publish state is changed only via setCollegeEssayPublished.
  await essayAdmin.updateEssayTopic(topic._id.toString(), input);
  await EssayTopicModel.updateOne(scope.filter({ _id: topic._id }), {
    orgUnits,
  });
  return essayAdmin.getEssayTopicAdmin(topic._id.toString());
}

/** Publish / unpublish. Publishing requires a real prompt (description or instructions). */
export async function setCollegeEssayPublished(
  collegeId: string,
  actor: EssayActor,
  topicId: string,
  isPublished: boolean,
): Promise<AdminEssayTopic> {
  const { topic } = await forManage(collegeId, actor, topicId);
  if (isPublished) {
    const hasPrompt =
      (topic.description ?? "").trim().length > 0 ||
      (topic.instructions ?? "").trim().length > 0;
    if (!hasPrompt) {
      throw new AppError(
        "Add a description or instructions (the prompt) before publishing this essay",
        400,
        "ESSAY_NOT_PUBLISHABLE",
      );
    }
  }
  topic.isPublished = isPublished;
  await topic.save();
  return essayAdmin.getEssayTopicAdmin(topic._id.toString());
}

export async function removeCollegeEssay(
  collegeId: string,
  actor: EssayActor,
  topicId: string,
): Promise<{ deleted: true }> {
  const { topic } = await forManage(collegeId, actor, topicId);
  // Reuse the reference-safe delete (blocks if attempts exist, else SET_NULL any
  // curriculum links — none for a college topic — and deletes).
  return essayAdmin.deleteEssayTopic(topic._id.toString());
}

/** Keyword generation — reuse the shared generator; charged to this college's
 * AI credits (Stage 1) by threading the tenant id into the gateway policy. */
export async function generateCollegeKeywords(
  collegeId: string,
  input: GenerateKeywordsRequest,
): Promise<GenerateKeywordsResponse> {
  return essayAdmin.generateKeywords(input, collegeId);
}

// --- Results (tenant-scoped read) -------------------------------------------

export async function collegeEssayResults(
  collegeId: string,
  actor: EssayActor,
  topicId: string,
): Promise<CollegeEssayResultsResponse> {
  const { scope, topic } = await forManage(collegeId, actor, topicId);
  // Tenant-scoped: only THIS college's attempts on the topic.
  const attempts = await EssayAttemptModel.find(
    scope.filter({ essayTopic: topic._id }),
  ).sort({ createdAt: -1 });
  const userIds = attempts
    .map((a) => a.user)
    .filter((u): u is Types.ObjectId => u != null);
  // Name from the Profile; the REAL per-college roll lives on User.rollNumber
  // (the Profile.rollNumber is a `STU-<id>` placeholder for college students).
  const [profiles, users] = await Promise.all([
    ProfileModel.find({ user: { $in: userIds } }).select("user fullName"),
    UserModel.find({ _id: { $in: userIds } }).select("rollNumber"),
  ]);
  const nameByUser = new Map(
    profiles.map((p) => [p.user.toString(), p.fullName]),
  );
  const rollByUser = new Map(
    users.map((u) => [u._id.toString(), u.rollNumber ?? ""]),
  );

  return {
    essayTopicId: topic._id.toString(),
    essayTitle: topic.title,
    items: attempts.map((a) => {
      const uid = a.user ? a.user.toString() : null;
      const completed = a.gradingStatus === JobStatus.COMPLETED;
      return {
        attemptId: a._id.toString(),
        userId: uid,
        student: uid ? (nameByUser.get(uid) ?? "Student") : "Unknown",
        rollNumber: uid ? (rollByUser.get(uid) ?? "") : "",
        attemptNumber: a.attemptNumber,
        status: essays.asGradingStatus(a.gradingStatus),
        finalScore: completed ? a.finalScore : null,
        source: (a.scoreSource as EssayScoreSource | null) ?? null,
        wordCount: a.wordCount,
        submittedAt: a.submittedAt ? a.submittedAt.toISOString() : null,
        gradedAt: a.gradedAt ? a.gradedAt.toISOString() : null,
      };
    }),
  };
}

// --- Writing (college student) ----------------------------------------------

/** Is a student (in `studentUnit`) inside the topic's target org-units? */
function studentInTarget(
  targetUnitIds: string[],
  studentUnit: string | null,
  refs: { id: string; parentId: string | null }[],
): boolean {
  if (targetUnitIds.length === 0) return true; // college-wide
  if (!studentUnit) return false;
  const allowed = new Set(collectDescendantUnitIds(refs, targetUnitIds));
  return allowed.has(studentUnit);
}

export async function listStudentCollegeEssays(
  collegeId: string,
  studentUserId: string,
): Promise<EssayListResponse> {
  const scope = createTenantScope(collegeId);
  const student = await UserModel.findById(studentUserId).select("orgUnit");
  const studentUnit = student?.orgUnit ? student.orgUnit.toString() : null;

  const topics = await EssayTopicModel.find(
    scope.filter({ isPublished: true, isActive: true }),
  ).sort({ createdAt: -1, _id: -1 });
  if (topics.length === 0) return { items: [] };
  const refs = await unitRefs(scope);

  const items: EssayPromptSummary[] = [];
  for (const topic of topics) {
    const targets = (topic.orgUnits ?? []).map((u) => u.toString());
    if (!studentInTarget(targets, studentUnit, refs)) continue;
    const [last, attemptsUsed] = await Promise.all([
      essays.latestAttempt(studentUserId, topic._id),
      essays.countAttempts(studentUserId, topic._id),
    ]);
    // College essays are standalone → no curriculum topic id (topicId "").
    items.push(essays.toSummary(topic, "", last, attemptsUsed));
  }
  return { items };
}

/**
 * Load a college essay topic a student may write: of THIS tenant, published +
 * active, and targeted at the student's cohort — else 404/403 (isolation:
 * cross-tenant / unpublished simply not found; wrong cohort → out-of-scope).
 */
async function requireStudentTopic(
  collegeId: string,
  studentUserId: string,
  topicId: string,
): Promise<TopicDoc> {
  const scope = createTenantScope(collegeId);
  if (!Types.ObjectId.isValid(topicId)) throw NOT_FOUND();
  const topic = await EssayTopicModel.findOne(
    scope.filter({ _id: topicId, isPublished: true, isActive: true }),
  );
  if (!topic) throw NOT_FOUND();
  const targets = (topic.orgUnits ?? []).map((u) => u.toString());
  if (targets.length > 0) {
    const student = await UserModel.findById(studentUserId).select("orgUnit");
    const studentUnit = student?.orgUnit ? student.orgUnit.toString() : null;
    const refs = await unitRefs(scope);
    if (!studentInTarget(targets, studentUnit, refs)) {
      throw OUT_OF_SCOPE("This essay is not assigned to your cohort");
    }
  }
  return topic;
}

export async function getStudentCollegeEssay(
  collegeId: string,
  studentUserId: string,
  topicId: string,
): Promise<EssayPromptDetail> {
  const topic = await requireStudentTopic(collegeId, studentUserId, topicId);
  const [last, attemptsUsed] = await Promise.all([
    essays.latestAttempt(studentUserId, topic._id),
    essays.countAttempts(studentUserId, topic._id),
  ]);
  return {
    ...essays.toSummary(topic, "", last, attemptsUsed),
    instructions: topic.instructions,
  };
}

export async function saveStudentDraft(
  collegeId: string,
  studentUserId: string,
  topicId: string,
  content: string,
): Promise<SaveEssayDraftResponse> {
  const topic = await requireStudentTopic(collegeId, studentUserId, topicId);
  return essays.saveDraftForTopic(studentUserId, topic, content);
}

export async function getStudentDraft(
  collegeId: string,
  studentUserId: string,
  topicId: string,
): Promise<EssayDraftResponse> {
  const topic = await requireStudentTopic(collegeId, studentUserId, topicId);
  return essays.getLatestDraftForTopic(studentUserId, topic);
}

export async function submitStudentEssay(
  collegeId: string,
  studentUserId: string,
  topicId: string,
  content: string,
  meta: essays.SubmitEssayMeta = {},
): Promise<JobRef> {
  const topic = await requireStudentTopic(collegeId, studentUserId, topicId);
  return essays.submitEssayForTopic(studentUserId, topic, content, meta);
}

export async function listStudentSubmissions(
  collegeId: string,
  studentUserId: string,
  topicId: string,
): Promise<EssaySubmissionListResponse> {
  const topic = await requireStudentTopic(collegeId, studentUserId, topicId);
  return essays.listSubmissionsForTopic(studentUserId, topic);
}
