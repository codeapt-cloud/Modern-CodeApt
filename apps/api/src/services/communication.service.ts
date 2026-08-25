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
  TopicType,
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
  /** The student has at least one attempt (opened it). */
  started: boolean;
  /** The student has FINISHED the part at least once (any completed attempt) —
   *  the gate signal. "Once complete, always complete": starting a retake does
   *  NOT re-lock this part or the parts gated behind it (Step 23 C2). */
  complete: boolean;
  /** A comparable 0..100 score, or null if not scored yet (never a zero). This
   *  is the student's BEST scored attempt — a retake in flight cannot lower or
   *  erase it, and an abandoned/expired retake (scored null) never displaces it. */
  percent: number | null;
  scored: boolean;
  /** How many attempts exist (surfaced to the student as "best of N"). */
  attemptCount: number;
  /** A fresh attempt is actively under way (in progress, or submitted and
   *  awaiting grading) on top of an already-scored result. Excludes a terminal
   *  abandoned/expired retake — that is finished, not "in progress". */
  retakeInProgress: boolean;
  /** Honesty badges, taken from the BEST scored attempt (speaking/essay). */
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
  attemptCount: 0,
  retakeInProgress: false,
  approximate: false,
  deterministicFallback: false,
};

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * One normalized attempt as the composite reads it — engine-agnostic. Each
 * `readXPart` maps its engine's rows into these, then `reduceAttempts` picks the
 * BEST scored one and derives the aggregate outcome. Keeping the policy in ONE
 * place is what makes "best attempt, no retake ever erases a score" consistent
 * across all three engines (Step 23 C2).
 */
interface NormalizedAttempt {
  /** Reached a completed/terminal state (submitted / graded / expired). */
  done: boolean;
  /** Has a real, comparable 0..100 score. */
  scored: boolean;
  /** The score (only read when `scored`). */
  percent: number;
  /** Actively under way (in progress, or awaiting grading) — NOT terminal. A
   *  retake in this state is "in progress"; an abandoned/expired one is not. */
  live: boolean;
  approximate: boolean;
  deterministicFallback: boolean;
}

function reduceAttempts(
  exists: boolean,
  published: boolean,
  title: string,
  attempts: NormalizedAttempt[],
): PartOutcome {
  let best: NormalizedAttempt | null = null;
  let complete = false;
  let anyLive = false;
  for (const a of attempts) {
    if (a.done) complete = true;
    if (a.live) anyLive = true;
    if (a.scored && (best === null || a.percent > best.percent)) best = a;
  }
  const scored = best !== null;
  return {
    exists,
    published,
    title,
    started: attempts.length > 0,
    complete,
    percent: scored ? best!.percent : null,
    scored,
    attemptCount: attempts.length,
    // A retake counts as "in progress" only when there is already a score to
    // protect — otherwise it is just the student's first attempt in progress.
    retakeInProgress: scored && anyLive,
    approximate: scored ? best!.approximate : false,
    deterministicFallback: scored ? best!.deterministicFallback : false,
  };
}

async function readExamPart(
  ref: Types.ObjectId,
  userId: string,
): Promise<PartOutcome> {
  const exam = await ExamModel.findById(ref).select(
    "title isPublished totalMarks",
  );
  if (!exam) return MISSING;
  // ALL attempts — the composite reports the BEST scored one, so a retake can't
  // erase a prior result (Step 23 C2).
  const attempts = await StudentExamAttemptModel.find({
    exam: ref,
    user: new Types.ObjectId(userId),
  }).select("status score");
  // MCQ marks are final at submit; CODE grading may still be running (score is
  // the current graded total either way — the composite reads what's there).
  const totalMarks = exam.totalMarks ?? 0;
  const normalized: NormalizedAttempt[] = attempts.map((a) => {
    const done =
      a.status === ExamAttemptStatus.SUBMITTED ||
      a.status === ExamAttemptStatus.GRADED;
    const scored = done && totalMarks > 0;
    return {
      done,
      scored,
      percent: scored ? round1(((a.score ?? 0) / totalMarks) * 100) : 0,
      live: a.status === ExamAttemptStatus.IN_PROGRESS,
      approximate: false,
      deterministicFallback: false,
    };
  });
  return reduceAttempts(true, !!exam.isPublished, exam.title, normalized);
}

async function readEssayPart(
  ref: Types.ObjectId,
  userId: string,
): Promise<PartOutcome> {
  const topic = await EssayTopicModel.findById(ref).select("title isPublished");
  if (!topic) return MISSING;
  // Attempts exist only once submitted (drafts live in EssayDraft). ALL of them
  // — the composite reports the BEST scored attempt, so submitting a retake that
  // is still awaiting grading can't null a previously graded score (Step 23 C2).
  const attempts = await EssayAttemptModel.find({
    essayTopic: ref,
    user: new Types.ObjectId(userId),
  }).select("status gradingStatus finalScore scoreSource");
  const normalized: NormalizedAttempt[] = attempts.map((a) => {
    const done =
      a.status === EssayStatus.SUBMITTED ||
      a.status === EssayStatus.UNDER_REVIEW ||
      a.status === EssayStatus.GRADED;
    const scored =
      a.gradingStatus === JobStatus.COMPLETED ||
      a.status === EssayStatus.GRADED;
    return {
      done,
      scored,
      percent: scored ? round1(a.finalScore ?? 0) : 0,
      // Submitted/under-review but not yet graded = a retake still in flight.
      live: a.status === EssayStatus.IN_PROGRESS || (done && !scored),
      // The essay's relevance dimension is AI-influenced; carry the badge when
      // the hybrid path scored it, and the fallback badge when AI was down.
      approximate: a.scoreSource === "ai_hybrid",
      deterministicFallback: a.scoreSource === "deterministic_fallback",
    };
  });
  return reduceAttempts(true, !!topic.isPublished, topic.title, normalized);
}

async function readSpeakingPart(
  ref: Types.ObjectId,
  userId: string,
): Promise<PartOutcome> {
  const asm = await SpeakingAssessmentModel.findById(ref).select(
    "title isPublished",
  );
  if (!asm) return MISSING;
  // ALL attempts — best scored wins. This is the case the report calls out: an
  // abandoned retry that the reaper marks EXPIRED scores null, so under the old
  // "latest attempt" read it registered as a finished part worth nothing and
  // erased a real score. Best-of makes it harmless (Step 23 C2).
  const attempts = await SpeakingAttemptModel.find({
    assessment: ref,
    user: new Types.ObjectId(userId),
  }).select("status items");
  const normalized: NormalizedAttempt[] = attempts.map((a) => {
    const done =
      a.status === SpeakingAttemptStatus.SUBMITTED ||
      a.status === SpeakingAttemptStatus.SCORED ||
      a.status === SpeakingAttemptStatus.EXPIRED;
    const subScores = (a.items ?? []).map((it) => it.subScores);
    const percent = speakingOverallPercent(subScores);
    // Honesty badges from this attempt's item scores.
    let approximate = false;
    let deterministicFallback = false;
    for (const sc of subScores) {
      if (sc && typeof sc === "object") {
        const s = sc as Record<string, unknown>;
        if (
          s.kind === "open_topic" &&
          (typeof s.aiGrammar === "number" || typeof s.aiRelevance === "number")
        )
          approximate = true;
        if (
          (s.kind === "open_topic" || s.kind === "story_retell") &&
          s.source === "deterministic_floor"
        )
          deterministicFallback = true;
      }
    }
    return {
      done,
      scored: percent !== null,
      percent: percent ?? 0,
      // In progress, or submitted-and-awaiting-scoring, is "in flight". EXPIRED
      // is terminal (abandoned) — never "in progress".
      live:
        a.status === SpeakingAttemptStatus.IN_PROGRESS ||
        a.status === SpeakingAttemptStatus.SUBMITTED,
      approximate,
      deterministicFallback,
    };
  });
  return reduceAttempts(true, !!asm.isPublished, asm.title, normalized);
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
      attemptCount: o.attemptCount,
      // Only meaningful when the part is otherwise shown as done — a genuine
      // first attempt in progress is IN_PROGRESS, not a "retake".
      retakeInProgress: o.retakeInProgress,
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
      topicId: a.topic ? a.topic.toString() : null,
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

/** Confirm a referenced artifact exists AND belongs to the given SCOPE AND
 *  matches the declared type. Cross-scope or wrong-type refs are rejected at
 *  author time (400 INVALID_PART_REF) — a composite can only bind artifacts from
 *  its own scope. `scope` is the college ObjectId for a tenant composite, or
 *  `null` for a platform composite (which binds `college: null` artifacts). The
 *  query is `{ _id, college: scope }` in BOTH cases — for the tenant path that is
 *  byte-identical to the previous `{ _id, college }`; only the value differs.
 *  Returns the artifact's title + published flag for the detail view. */
async function resolvePartRef(
  scope: Types.ObjectId | null,
  partType: PartType,
  ref: string,
): Promise<{ title: string; published: boolean } | null> {
  if (!Types.ObjectId.isValid(ref)) return null;
  const college = scope;
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
  scope: Types.ObjectId | null,
): Promise<CommunicationAssessmentDetail> {
  const ordered = [...a.parts].sort((x, y) => x.order - y.order);
  const parts: CommunicationPartDetail[] = await Promise.all(
    ordered.map(async (p) => {
      const resolved = await resolvePartRef(
        scope,
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
    topicId: a.topic ? a.topic.toString() : null,
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
  scope: Types.ObjectId | null,
  input: CommunicationAssessmentUpsert,
): Promise<PersistedPart[]> {
  const where = scope ? "in this college" : "on the platform";
  const parts: PersistedPart[] = [];
  for (let i = 0; i < input.parts.length; i += 1) {
    const p = input.parts[i]!;
    const resolved = await resolvePartRef(scope, p.partType, p.ref);
    if (!resolved) {
      throw new AppError(
        `Part ${i + 1} ("${p.label}") does not reference a ${p.partType} ${where}`,
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
  const parts = await buildParts(scope.collegeId, input);
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
  return toDetail(doc, scope.collegeId);
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
  return toDetail(
    await loadTenant(collegeId, assessmentId),
    new Types.ObjectId(collegeId),
  );
}

export async function updateCollegeCommunication(
  collegeId: string,
  assessmentId: string,
  input: CommunicationAssessmentUpsert,
): Promise<CommunicationAssessmentDetail> {
  const doc = await loadTenant(collegeId, assessmentId);
  const orgUnits = await validateOrgUnits(collegeId, input.orgUnitIds);
  const college = new Types.ObjectId(collegeId);
  const parts = await buildParts(college, input);
  doc.title = input.title;
  doc.description = input.description;
  doc.set("parts", parts);
  doc.passPercentage = input.passPercentage;
  doc.distinctionPercentage = input.distinctionPercentage;
  doc.set("orgUnits", orgUnits);
  await doc.save();
  return toDetail(doc, college);
}

/** Publish-safety FLOOR, shared by the tenant + platform publish paths (S29):
 *  at least one part, and every part must resolve IN SCOPE and be published, so a
 *  student never meets a dead or draft part. `scope` is the college ObjectId
 *  (tenant) or null (platform). Extracted verbatim from the tenant path so both
 *  surfaces enforce identical rules. */
async function assertCommunicationPublishable(
  doc: AssessmentDoc,
  scope: Types.ObjectId | null,
): Promise<void> {
  if (doc.parts.length === 0) {
    throw new AppError(
      "Add at least one part before publishing",
      400,
      CommunicationErrorCode.NOT_PUBLISHABLE,
    );
  }
  for (let i = 0; i < doc.parts.length; i += 1) {
    const p = doc.parts[i]!;
    const resolved = await resolvePartRef(scope, p.partType as PartType, p.ref.toString());
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

export async function setCollegeCommunicationPublished(
  collegeId: string,
  assessmentId: string,
  isPublished: boolean,
): Promise<CommunicationAssessmentDetail> {
  const doc = await loadTenant(collegeId, assessmentId);
  const college = new Types.ObjectId(collegeId);
  if (isPublished) await assertCommunicationPublishable(doc, college);
  doc.isPublished = isPublished;
  await doc.save();
  return toDetail(doc, college);
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
          attemptCount: p.attemptCount,
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

// ---------------------------------------------------------------------------
// Course attach (S29) — GAME pattern: entity.topic → Topic, forward + validated
// ---------------------------------------------------------------------------

/** Validate a curriculum topic for a course-attached composite: exists, is a
 *  COMMUNICATION topic, not already attached (1:1). Mirror of resolveGameTopic /
 *  resolveSpeakingTopic. `excludeId` skips the composite being edited. */
export async function resolveCommunicationTopic(
  topicId: string,
  excludeId?: Types.ObjectId,
): Promise<Types.ObjectId> {
  if (!Types.ObjectId.isValid(topicId)) {
    throw new AppError("Topic not found", 404, CommunicationErrorCode.TOPIC_NOT_FOUND);
  }
  const topic = await TopicModel.findById(topicId).select("topicType");
  if (!topic || topic.topicType !== TopicType.COMMUNICATION) {
    throw new AppError(
      "A composite can only attach to a COMMUNICATION topic",
      400,
      CommunicationErrorCode.TOPIC_NOT_COMMUNICATION,
    );
  }
  const existing = await CommunicationAssessmentModel.findOne({
    topic: topic._id,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  }).select("_id");
  if (existing) {
    throw new AppError(
      "That topic already has a communication assessment",
      409,
      CommunicationErrorCode.TOPIC_ALREADY_ATTACHED,
    );
  }
  return topic._id;
}

// ---------------------------------------------------------------------------
// Platform authoring (college: null) — parts resolve against college:null too
// ---------------------------------------------------------------------------

/** Load a PLATFORM composite (college:null) — never a college's. */
async function loadPlatform(assessmentId: string): Promise<AssessmentDoc> {
  if (!Types.ObjectId.isValid(assessmentId)) throw NOT_FOUND();
  const doc = await CommunicationAssessmentModel.findOne({
    _id: new Types.ObjectId(assessmentId),
    college: null,
  });
  if (!doc) throw NOT_FOUND();
  return doc;
}

export async function createPlatformCommunication(
  input: CommunicationAssessmentUpsert,
): Promise<CommunicationAssessmentDetail> {
  // Platform composite: college:null. Parts resolve against college:null artifacts
  // (scope=null), NOT a tenant. Optional topicId makes it course-attached.
  const topic = input.topicId ? await resolveCommunicationTopic(input.topicId) : null;
  const parts = await buildParts(null, input);
  const doc = await CommunicationAssessmentModel.create({
    college: null,
    topic,
    orgUnits: [],
    title: input.title,
    description: input.description,
    parts,
    passPercentage: input.passPercentage,
    distinctionPercentage: input.distinctionPercentage,
    isPublished: false,
  });
  return toDetail(doc, null);
}

export async function listPlatformCommunication(): Promise<CommunicationAssessmentListResponse> {
  const docs = await CommunicationAssessmentModel.find({ college: null }).sort({
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

export async function getPlatformCommunication(
  assessmentId: string,
): Promise<CommunicationAssessmentDetail> {
  return toDetail(await loadPlatform(assessmentId), null);
}

export async function updatePlatformCommunication(
  assessmentId: string,
  input: CommunicationAssessmentUpsert,
): Promise<CommunicationAssessmentDetail> {
  const doc = await loadPlatform(assessmentId);
  doc.topic = input.topicId
    ? await resolveCommunicationTopic(input.topicId, doc._id)
    : null;
  const parts = await buildParts(null, input);
  doc.title = input.title;
  doc.description = input.description;
  doc.set("parts", parts);
  doc.passPercentage = input.passPercentage;
  doc.distinctionPercentage = input.distinctionPercentage;
  await doc.save();
  return toDetail(doc, null);
}

export async function setPlatformCommunicationPublished(
  assessmentId: string,
  isPublished: boolean,
): Promise<CommunicationAssessmentDetail> {
  const doc = await loadPlatform(assessmentId);
  if (isPublished) await assertCommunicationPublishable(doc, null);
  doc.isPublished = isPublished;
  await doc.save();
  return toDetail(doc, null);
}

export async function deletePlatformCommunication(
  assessmentId: string,
): Promise<void> {
  const doc = await loadPlatform(assessmentId);
  if (doc.isPublished) {
    throw new AppError(
      "Unpublish the assessment before deleting it",
      409,
      CommunicationErrorCode.NOT_DELETABLE,
    );
  }
  await CommunicationAssessmentModel.deleteOne({ _id: doc._id });
}

// ---------------------------------------------------------------------------
// Enrollment-based discovery (S29) — mirror of listGamesForUser
// ---------------------------------------------------------------------------

/** Course-attached composites the user can reach by ENROLLMENT (B2C or college
 *  student): Enrollment → Subject → Module → Topic{COMMUNICATION} → composite.
 *  Global; carries topicId for the learn player. Mirrors listGamesForUser. */
export async function listCommunicationForUser(
  userId: string,
): Promise<CommunicationAvailableListResponse> {
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
    topicType: TopicType.COMMUNICATION,
  }).select("_id");
  const topicIds = topics.map((t) => t._id);
  if (topicIds.length === 0) return { items: [] };
  const docs = await CommunicationAssessmentModel.find({
    topic: { $in: topicIds },
  }).sort({ createdAt: -1 });
  return {
    items: docs.map((a) => ({
      id: a._id.toString(),
      topicId: a.topic ? a.topic.toString() : null,
      title: a.title,
      description: a.description ?? "",
      partCount: a.parts.length,
    })),
  };
}
