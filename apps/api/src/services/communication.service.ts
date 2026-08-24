/**
 * CommunicationAssessment composite service (Step 21). A CONTAINER over the
 * exam / essay / speaking engines — it READS them, never modifies them. Two
 * concerns, mirroring speaking.service:
 *
 *  - ACCESS: `assertCanTakeCommunicationAssessment` is the exact mirror of
 *    `assertCanTakeSpeakingAssessment` / `assertCanPlayGameSet` — the same three
 *    shapes and 404-vs-403 discipline.
 *  - COMPOSE + REPORT: authoring is tenant-scoped over CommunicationAssessment;
 *    the student view + cohort report DERIVE each part's status and score by
 *    reading the underlying engine's attempts (no duplicated attempt state).
 *
 * Scoring honesty carries over verbatim: a part that isn't scored is ABSENT from
 * the composite (never a zero), a partial assessment is flagged partial (band
 * withheld), AI-influenced parts are marked approximate, and a hybrid part that
 * fell back to its deterministic floor keeps that badge.
 */
import {
  CommunicationErrorCode,
  CommunicationPartStatus,
  CommunicationPartType,
  EssayStatus,
  ExamAttemptStatus,
  JobStatus,
  SpeakingAttemptStatus,
  collectDescendantUnitIds,
  communicationBand,
  computeComposite,
  isCourseGranted,
  isPlatformAdmin,
  speakingOverallPercent,
  Role,
  UserType,
  type CommunicationAssessmentDetail,
  type CommunicationAssessmentListResponse,
  type CommunicationAssessmentUpsert,
  type CommunicationAvailableListResponse,
  type CommunicationCohortReport,
  type CommunicationCohortRow,
  type CommunicationLaunchResponse,
  type CommunicationPartDetail,
  type CommunicationStudentPart,
  type CommunicationStudentView,
  type CompositeResultDto,
} from "@codeapt/shared";
import { Types, type HydratedDocument } from "mongoose";

import { AppError } from "../errors/app-error.js";
import { createTenantScope } from "../lib/tenant-scope.js";
import {
  EssayAttemptModel,
  EssayTopicModel,
} from "../models/essay.model.js";
import {
  ExamModel,
  StudentExamAttemptModel,
} from "../models/assessment.model.js";
import { CollegeModel } from "../models/college.model.js";
import {
  CommunicationAssessmentModel,
  type CommunicationAssessment,
} from "../models/communication.model.js";
import {
  EnrollmentModel,
  ModuleModel,
  TopicModel,
} from "../models/curriculum.model.js";
import { OrgUnitModel } from "../models/org-unit.model.js";
import {
  SpeakingAssessmentModel,
  SpeakingAttemptModel,
} from "../models/speaking.model.js";
import { ProfileModel, UserModel } from "../models/user.model.js";
import { normalizeEntitlements } from "./college.service.js";

type AssessmentDoc = HydratedDocument<CommunicationAssessment>;
type PartType = (typeof CommunicationPartType)[keyof typeof CommunicationPartType];

const NOT_FOUND = (): AppError =>
  new AppError(
    "Communication assessment not found",
    404,
    CommunicationErrorCode.ASSESSMENT_NOT_FOUND,
  );
const OUT_OF_SCOPE = (msg: string): AppError =>
  new AppError(msg, 403, CommunicationErrorCode.ORG_UNIT_OUT_OF_SCOPE);

// ---------------------------------------------------------------------------
// Access matrix (mirror of assertCanTakeSpeakingAssessment)
// ---------------------------------------------------------------------------

export async function assertCanTakeCommunicationAssessment(
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

  // 2. COURSE-ATTACHED (college null, topic set): enrollment or course grant.
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

  // 3. PLATFORM-INTERNAL (college null, topic null): platform admins only.
  const user = await UserModel.findById(userId).select("role");
  if (!user || !isPlatformAdmin(user.role)) throw NOT_FOUND();
}

// ---------------------------------------------------------------------------
// Per-part reads (READ-ONLY over the engines — no writes, ever)
// ---------------------------------------------------------------------------

interface PartOutcome {
  /** The referenced artifact still resolves. */
  exists: boolean;
  /** ...and is published (so a student could actually open it). */
  published: boolean;
  title: string;
  /** The student has an attempt (opened it). */
  started: boolean;
  /** The student FINISHED the part (submitted) — the gate signal. */
  complete: boolean;
  /** A comparable 0..100 score, or null if not scored yet (never a zero). */
  percent: number | null;
  scored: boolean;
  /** Honesty badges (speaking/essay). */
  approximate: boolean;
  deterministicFallback: boolean;
}

const MISSING: PartOutcome = {
  exists: false,
  published: false,
  title: "",
  started: false,
  complete: false,
  percent: null,
  scored: false,
  approximate: false,
  deterministicFallback: false,
};

const round1 = (n: number): number => Math.round(n * 10) / 10;

async function readExamPart(
  ref: Types.ObjectId,
  userId: string,
): Promise<PartOutcome> {
  const exam = await ExamModel.findById(ref).select(
    "title isPublished totalMarks",
  );
  if (!exam) return MISSING;
  const attempt = await StudentExamAttemptModel.findOne({
    exam: ref,
    user: new Types.ObjectId(userId),
  })
    .sort({ createdAt: -1 })
    .select("status score");
  const complete =
    !!attempt &&
    (attempt.status === ExamAttemptStatus.SUBMITTED ||
      attempt.status === ExamAttemptStatus.GRADED);
  // MCQ marks are final at submit; CODE grading may still be running (score is
  // the current graded total either way — the composite reads what's there).
  const totalMarks = exam.totalMarks ?? 0;
  const scored = complete && totalMarks > 0;
  return {
    exists: true,
    published: !!exam.isPublished,
    title: exam.title,
    started: !!attempt,
    complete,
    percent: scored ? round1(((attempt?.score ?? 0) / totalMarks) * 100) : null,
    scored,
    approximate: false,
    deterministicFallback: false,
  };
}

async function readEssayPart(
  ref: Types.ObjectId,
  userId: string,
): Promise<PartOutcome> {
  const topic = await EssayTopicModel.findById(ref).select("title isPublished");
  if (!topic) return MISSING;
  // Attempts exist only once submitted (drafts live in EssayDraft) — the latest
  // by attemptNumber is the student's outcome.
  const attempt = await EssayAttemptModel.findOne({
    essayTopic: ref,
    user: new Types.ObjectId(userId),
  })
    .sort({ attemptNumber: -1 })
    .select("status gradingStatus finalScore scoreSource");
  const started = !!attempt;
  const complete =
    !!attempt &&
    (attempt.status === EssayStatus.SUBMITTED ||
      attempt.status === EssayStatus.UNDER_REVIEW ||
      attempt.status === EssayStatus.GRADED);
  const scored =
    !!attempt &&
    (attempt.gradingStatus === JobStatus.COMPLETED ||
      attempt.status === EssayStatus.GRADED);
  return {
    exists: true,
    published: !!topic.isPublished,
    title: topic.title,
    started,
    complete,
    percent: scored ? round1(attempt.finalScore ?? 0) : null,
    scored,
    // The essay's relevance dimension is AI-influenced; carry the badge when the
    // hybrid path scored it, and the fallback badge when AI was down.
    approximate: attempt?.scoreSource === "ai_hybrid",
    deterministicFallback: attempt?.scoreSource === "deterministic_fallback",
  };
}

async function readSpeakingPart(
  ref: Types.ObjectId,
  userId: string,
): Promise<PartOutcome> {
  const asm = await SpeakingAssessmentModel.findById(ref).select(
    "title isPublished",
  );
  if (!asm) return MISSING;
  const attempt = await SpeakingAttemptModel.findOne({
    assessment: ref,
    user: new Types.ObjectId(userId),
  })
    .sort({ createdAt: -1 })
    .select("status items");
  const started = !!attempt;
  const complete =
    !!attempt &&
    (attempt.status === SpeakingAttemptStatus.SUBMITTED ||
      attempt.status === SpeakingAttemptStatus.SCORED ||
      attempt.status === SpeakingAttemptStatus.EXPIRED);
  const subScores = (attempt?.items ?? []).map((it) => it.subScores);
  const percent = attempt ? speakingOverallPercent(subScores) : null;
  // Honesty badges from the item scores.
  let approximate = false;
  let deterministicFallback = false;
  for (const sc of subScores) {
    if (sc && typeof sc === "object") {
      const s = sc as Record<string, unknown>;
      if (s.kind === "open_topic") {
        if (typeof s.aiGrammar === "number" || typeof s.aiRelevance === "number")
          approximate = true;
      }
      if (
        (s.kind === "open_topic" || s.kind === "story_retell") &&
        s.source === "deterministic_floor"
      )
        deterministicFallback = true;
    }
  }
  return {
    exists: true,
    published: !!asm.isPublished,
    title: asm.title,
    started,
    complete,
    percent,
    scored: percent !== null,
    approximate,
    deterministicFallback,
  };
}

function readPart(
  partType: PartType,
  ref: Types.ObjectId,
  userId: string,
): Promise<PartOutcome> {
  switch (partType) {
    case CommunicationPartType.EXAM:
      return readExamPart(ref, userId);
    case CommunicationPartType.ESSAY:
      return readEssayPart(ref, userId);
    case CommunicationPartType.SPEAKING:
      return readSpeakingPart(ref, userId);
    default:
      return Promise.resolve(MISSING);
  }
}

// ---------------------------------------------------------------------------
// Student view — derive each part's status + the composite
// ---------------------------------------------------------------------------

/** Build the ordered student parts + composite. The single source of truth for
 *  BOTH the student view and the launch gate (launch re-derives, then checks the
 *  one part's status), so the UI and the API can never disagree. */
async function buildStudentParts(
  assessment: AssessmentDoc,
  userId: string,
  now: Date,
): Promise<{ parts: CommunicationStudentPart[]; composite: CompositeResultDto }> {
  const ordered = [...assessment.parts].sort((a, b) => a.order - b.order);
  const outcomes = await Promise.all(
    ordered.map((p) => readPart(p.partType as PartType, p.ref, userId)),
  );

  const parts: CommunicationStudentPart[] = [];
  // "Complete for the purpose of unlocking the NEXT part." An unavailable part
  // never counts as complete (so a removed predecessor cannot silently satisfy a
  // gate); instead it blocks visibly (see below).
  let prevComplete = true;
  let prevUnavailable = false;
  for (let i = 0; i < ordered.length; i += 1) {
    const p = ordered[i]!;
    const o = outcomes[i]!;

    let status: (typeof CommunicationPartStatus)[keyof typeof CommunicationPartStatus];
    let reason = "";
    let exposeRef = false;

    if (!o.exists || !o.published) {
      // The artifact was deleted or unpublished out from under the composite.
      // Fail SAFE + VISIBLE — never a crash, and the student's other parts and
      // any already-recorded attempt on this one are untouched.
      status = CommunicationPartStatus.UNAVAILABLE;
      reason = !o.exists
        ? "This part was removed by your college — contact your faculty."
        : "This part is not published yet — contact your faculty.";
    } else if (p.requiresPrevious && prevUnavailable) {
      // A required predecessor is broken. Surface it (do NOT silently lock the
      // whole tail as if the student simply hasn't reached it).
      status = CommunicationPartStatus.UNAVAILABLE;
      reason =
        "A previous part of this assessment was removed — contact your faculty.";
    } else if (p.requiresPrevious && !prevComplete) {
      status = CommunicationPartStatus.LOCKED;
      reason = `Available after you complete "${ordered[i - 1]?.label ?? "the previous part"}".`;
    } else if (p.availableFrom && now < p.availableFrom) {
      status = CommunicationPartStatus.LOCKED;
      reason = `Opens ${p.availableFrom.toISOString()}.`;
    } else if (o.complete) {
      status = CommunicationPartStatus.COMPLETE;
      exposeRef = true;
    } else if (o.started) {
      status = CommunicationPartStatus.IN_PROGRESS;
      exposeRef = true;
    } else {
      status = CommunicationPartStatus.AVAILABLE;
      exposeRef = true;
    }

    parts.push({
      order: p.order,
      partType: p.partType as PartType,
      label: p.label,
      weight: p.weight ?? 1,
      status,
      reason,
      ref: exposeRef ? p.ref.toString() : "",
      percent: o.percent,
      band:
        o.percent === null
          ? null
          : communicationBand(
              o.percent,
              assessment.passPercentage,
              assessment.distinctionPercentage,
            ),
      approximate: o.approximate,
      deterministicFallback: o.deterministicFallback,
    });

    prevComplete = o.complete;
    prevUnavailable = status === CommunicationPartStatus.UNAVAILABLE;
  }

  const composite = computeComposite(
    ordered.map((p, i) => ({
      weight: p.weight ?? 1,
      percent: outcomes[i]!.percent,
    })),
    assessment.passPercentage,
    assessment.distinctionPercentage,
  );

  return { parts, composite };
}

async function loadAssessmentOr404(id: string): Promise<AssessmentDoc> {
  if (!Types.ObjectId.isValid(id)) throw NOT_FOUND();
  const a = await CommunicationAssessmentModel.findById(id);
  if (!a) throw NOT_FOUND();
  return a;
}

/** Published tenant composites the student's cohort can take (mirror of
 *  speaking listAvailableForCollege — org-unit descendant visibility). */
export async function listAvailableCommunicationForCollege(
  userId: string,
  collegeId: string,
): Promise<CommunicationAvailableListResponse> {
  const scope = createTenantScope(collegeId);
  const user = await UserModel.findById(userId).select("orgUnit");
  const docs = await CommunicationAssessmentModel.find(
    scope.filter({ isPublished: true }),
  ).sort({ createdAt: -1 });

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

  return {
    items: visible.map((a) => ({
      id: a._id.toString(),
      title: a.title,
      description: a.description ?? "",
      partCount: a.parts.length,
    })),
  };
}

export async function getCommunicationForStudent(
  userId: string,
  assessmentId: string,
): Promise<CommunicationStudentView> {
  const assessment = await loadAssessmentOr404(assessmentId);
  await assertCanTakeCommunicationAssessment(userId, assessment);
  const { parts, composite } = await buildStudentParts(
    assessment,
    userId,
    new Date(),
  );
  return {
    id: assessment._id.toString(),
    title: assessment.title,
    description: assessment.description ?? "",
    passPercentage: assessment.passPercentage,
    distinctionPercentage: assessment.distinctionPercentage,
    parts,
    composite,
  };
}

/**
 * The GATE, enforced by API. Re-derives the part's status for this student and
 * refuses (403 PART_LOCKED) unless it is genuinely open (available / in progress
 * / complete-and-retakeable). On success it echoes the artifact ref + type so
 * the client routes into the EXISTING engine runner — the composite starts
 * nothing itself.
 */
export async function launchCommunicationPart(
  userId: string,
  assessmentId: string,
  order: number,
): Promise<CommunicationLaunchResponse> {
  const assessment = await loadAssessmentOr404(assessmentId);
  await assertCanTakeCommunicationAssessment(userId, assessment);
  const { parts } = await buildStudentParts(assessment, userId, new Date());
  const part = parts.find((p) => p.order === order);
  if (!part) {
    throw new AppError(
      "That part does not exist",
      404,
      CommunicationErrorCode.PART_NOT_FOUND,
    );
  }
  if (
    part.status === CommunicationPartStatus.LOCKED ||
    part.status === CommunicationPartStatus.UNAVAILABLE
  ) {
    throw new AppError(
      part.reason || "This part is not available yet",
      403,
      CommunicationErrorCode.PART_LOCKED,
    );
  }
  return { partType: part.partType, ref: part.ref };
}

// ---------------------------------------------------------------------------
// College authoring (tenant-scoped)
// ---------------------------------------------------------------------------

/** Confirm a referenced artifact exists AND belongs to THIS college AND matches
 *  the declared type. Cross-tenant or wrong-type refs are rejected at author
 *  time (400 INVALID_PART_REF) — a composite can only bind its own college's
 *  artifacts. Returns the artifact's title + published flag for the detail view. */
async function resolvePartRefInTenant(
  collegeId: string,
  partType: PartType,
  ref: string,
): Promise<{ title: string; published: boolean } | null> {
  if (!Types.ObjectId.isValid(ref)) return null;
  const college = new Types.ObjectId(collegeId);
  const _id = new Types.ObjectId(ref);
  if (partType === CommunicationPartType.EXAM) {
    const e = await ExamModel.findOne({ _id, college }).select(
      "title isPublished",
    );
    return e ? { title: e.title, published: !!e.isPublished } : null;
  }
  if (partType === CommunicationPartType.ESSAY) {
    const t = await EssayTopicModel.findOne({ _id, college }).select(
      "title isPublished",
    );
    return t ? { title: t.title, published: !!t.isPublished } : null;
  }
  const s = await SpeakingAssessmentModel.findOne({ _id, college }).select(
    "title isPublished",
  );
  return s ? { title: s.title, published: !!s.isPublished } : null;
}

async function toDetail(
  a: AssessmentDoc,
  collegeId: string,
): Promise<CommunicationAssessmentDetail> {
  const ordered = [...a.parts].sort((x, y) => x.order - y.order);
  const parts: CommunicationPartDetail[] = await Promise.all(
    ordered.map(async (p) => {
      const resolved = await resolvePartRefInTenant(
        collegeId,
        p.partType as PartType,
        p.ref.toString(),
      );
      return {
        order: p.order,
        partType: p.partType as PartType,
        ref: p.ref.toString(),
        label: p.label,
        weight: p.weight ?? 1,
        requiresPrevious: !!p.requiresPrevious,
        availableFrom: p.availableFrom ? p.availableFrom.toISOString() : null,
        refTitle: resolved?.title ?? "",
        refExists: resolved !== null,
        refPublished: resolved?.published ?? false,
        valid: resolved !== null,
      };
    }),
  );
  return {
    id: a._id.toString(),
    title: a.title,
    description: a.description ?? "",
    isPublished: a.isPublished,
    passPercentage: a.passPercentage,
    distinctionPercentage: a.distinctionPercentage,
    orgUnitIds: (a.orgUnits ?? []).map((u) => u.toString()),
    parts,
  };
}

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
      CommunicationErrorCode.ORG_UNIT_OUT_OF_SCOPE,
    );
  }
  return found.map((u) => u._id);
}

interface PersistedPart {
  order: number;
  partType: PartType;
  ref: Types.ObjectId;
  label: string;
  weight: number;
  requiresPrevious: boolean;
  availableFrom: Date | null;
}

/** Validate + shape the parts for persistence. Every ref must resolve in-tenant
 *  and match its declared type, else 400 INVALID_PART_REF (naming the offender). */
async function buildParts(
  collegeId: string,
  input: CommunicationAssessmentUpsert,
): Promise<PersistedPart[]> {
  const parts: PersistedPart[] = [];
  for (let i = 0; i < input.parts.length; i += 1) {
    const p = input.parts[i]!;
    const resolved = await resolvePartRefInTenant(collegeId, p.partType, p.ref);
    if (!resolved) {
      throw new AppError(
        `Part ${i + 1} ("${p.label}") does not reference a ${p.partType} in this college`,
        400,
        CommunicationErrorCode.INVALID_PART_REF,
      );
    }
    parts.push({
      order: i,
      partType: p.partType,
      ref: new Types.ObjectId(p.ref),
      label: p.label,
      weight: p.weight,
      requiresPrevious: p.requiresPrevious,
      availableFrom: p.availableFrom ? new Date(p.availableFrom) : null,
    });
  }
  return parts;
}

export async function createCollegeCommunication(
  collegeId: string,
  input: CommunicationAssessmentUpsert,
): Promise<CommunicationAssessmentDetail> {
  const scope = createTenantScope(collegeId);
  const orgUnits = await validateOrgUnits(collegeId, input.orgUnitIds);
  const parts = await buildParts(collegeId, input);
  const doc = await CommunicationAssessmentModel.create(
    scope.attach({
      topic: null,
      title: input.title,
      description: input.description,
      parts,
      passPercentage: input.passPercentage,
      distinctionPercentage: input.distinctionPercentage,
      orgUnits,
      isPublished: false,
    }),
  );
  return toDetail(doc, collegeId);
}

export async function listCollegeCommunication(
  collegeId: string,
): Promise<CommunicationAssessmentListResponse> {
  const scope = createTenantScope(collegeId);
  const docs = await CommunicationAssessmentModel.find(scope.filter()).sort({
    createdAt: -1,
    _id: -1,
  });
  return {
    items: docs.map((a) => ({
      id: a._id.toString(),
      title: a.title,
      partCount: a.parts.length,
      isPublished: a.isPublished,
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
  const doc = await CommunicationAssessmentModel.findOne(
    scope.filter({ _id: new Types.ObjectId(assessmentId) }),
  );
  if (!doc) throw NOT_FOUND();
  return doc;
}

export async function getCollegeCommunication(
  collegeId: string,
  assessmentId: string,
): Promise<CommunicationAssessmentDetail> {
  return toDetail(await loadTenant(collegeId, assessmentId), collegeId);
}

export async function updateCollegeCommunication(
  collegeId: string,
  assessmentId: string,
  input: CommunicationAssessmentUpsert,
): Promise<CommunicationAssessmentDetail> {
  const doc = await loadTenant(collegeId, assessmentId);
  const orgUnits = await validateOrgUnits(collegeId, input.orgUnitIds);
  const parts = await buildParts(collegeId, input);
  doc.title = input.title;
  doc.description = input.description;
  doc.set("parts", parts);
  doc.passPercentage = input.passPercentage;
  doc.distinctionPercentage = input.distinctionPercentage;
  doc.set("orgUnits", orgUnits);
  await doc.save();
  return toDetail(doc, collegeId);
}

export async function setCollegeCommunicationPublished(
  collegeId: string,
  assessmentId: string,
  isPublished: boolean,
): Promise<CommunicationAssessmentDetail> {
  const doc = await loadTenant(collegeId, assessmentId);
  if (isPublished) {
    if (doc.parts.length === 0) {
      throw new AppError(
        "Add at least one part before publishing",
        400,
        CommunicationErrorCode.NOT_PUBLISHABLE,
      );
    }
    // A published composite must be fully launchable: every part must resolve in
    // tenant AND be published, so a student never meets a dead or draft part.
    for (let i = 0; i < doc.parts.length; i += 1) {
      const p = doc.parts[i]!;
      const resolved = await resolvePartRefInTenant(
        collegeId,
        p.partType as PartType,
        p.ref.toString(),
      );
      if (!resolved) {
        throw new AppError(
          `Part ${i + 1} ("${p.label}") no longer exists — fix it before publishing`,
          400,
          CommunicationErrorCode.NOT_PUBLISHABLE,
        );
      }
      if (!resolved.published) {
        throw new AppError(
          `Part ${i + 1} ("${p.label}") is not published — publish it first`,
          400,
          CommunicationErrorCode.NOT_PUBLISHABLE,
        );
      }
    }
  }
  doc.isPublished = isPublished;
  await doc.save();
  return toDetail(doc, collegeId);
}

export async function deleteCollegeCommunication(
  collegeId: string,
  assessmentId: string,
): Promise<void> {
  const doc = await loadTenant(collegeId, assessmentId);
  if (doc.isPublished) {
    throw new AppError(
      "Unpublish the assessment before deleting it",
      409,
      CommunicationErrorCode.NOT_DELETABLE,
    );
  }
  // The composite owns NO attempt state — deleting it leaves every underlying
  // engine attempt (and its scores) intact.
  await CommunicationAssessmentModel.deleteOne({ _id: doc._id });
}

// ---------------------------------------------------------------------------
// Operator cohort report + the ONE export (replaces four manual joins)
// ---------------------------------------------------------------------------

/**
 * One row per student in the assessment's cohort × each part × the composite.
 * The cohort = the college's students in the targeted org-units (whole college
 * when no targets). A student who has not touched a part shows that part's
 * status (available/locked/…) with a NULL percent — never a fabricated zero —
 * and the composite is flagged partial until every part is scored.
 */
export async function getCommunicationCohortReport(
  collegeId: string,
  assessmentId: string,
): Promise<CommunicationCohortReport> {
  const assessment = await loadTenant(collegeId, assessmentId);
  const ordered = [...assessment.parts].sort((a, b) => a.order - b.order);

  // Resolve the target student set.
  const college = new Types.ObjectId(collegeId);
  const targets = (assessment.orgUnits ?? []).map((u) => u.toString());
  const studentFilter: Record<string, unknown> = {
    college,
    role: Role.STUDENT,
    userType: UserType.COLLEGE,
  };
  if (targets.length > 0) {
    const units = await OrgUnitModel.find({ college }).select("_id parent");
    const refs = units.map((u) => ({
      id: u._id.toString(),
      parentId: u.parent ? u.parent.toString() : null,
    }));
    const allowed = collectDescendantUnitIds(refs, targets).map(
      (id) => new Types.ObjectId(id),
    );
    studentFilter.orgUnit = { $in: allowed };
  }
  const students = await UserModel.find(studentFilter).select(
    "username rollNumber",
  );

  const profiles = await ProfileModel.find({
    user: { $in: students.map((s) => s._id) },
  }).select("user fullName rollNumber");
  const profileByUser = new Map(
    profiles.map((p) => [p.user.toString(), p]),
  );

  const now = new Date();
  const rows: CommunicationCohortRow[] = await Promise.all(
    students.map(async (student) => {
      const { parts, composite } = await buildStudentParts(
        assessment,
        student._id.toString(),
        now,
      );
      const profile = profileByUser.get(student._id.toString());
      return {
        userId: student._id.toString(),
        userName: profile?.fullName ?? student.username,
        rollNumber: profile?.rollNumber ?? student.rollNumber ?? "",
        cells: parts.map((p) => ({
          order: p.order,
          status: p.status,
          percent: p.percent,
          band: p.band,
        })),
        composite,
      };
    }),
  );
  // Stable ordering (by roll then name) for a deterministic export.
  rows.sort(
    (a, b) =>
      a.rollNumber.localeCompare(b.rollNumber) ||
      a.userName.localeCompare(b.userName),
  );

  return {
    id: assessment._id.toString(),
    title: assessment.title,
    parts: ordered.map((p) => ({
      order: p.order,
      label: p.label,
      partType: p.partType as PartType,
      weight: p.weight ?? 1,
    })),
    rows,
  };
}
