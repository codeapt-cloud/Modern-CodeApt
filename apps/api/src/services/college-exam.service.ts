/**
 * College exam service (Phase 4b) — tenant-scoped authoring + taking over the
 * EXISTING exam engine. Nothing here forks the engine: authoring delegates to
 * exam-admin.service (section/question/test-case/public-link/bulk-upload CRUD,
 * delete, reset-attempts, detail) and taking delegates to exam.service
 * (startAttempt → the shared /attempts/* lifecycle authorizes by attempt
 * ownership, so a college student rides the same engine unchanged).
 *
 * A college exam is an Exam with `college` set and NO curriculum `topic`
 * (standalone → isolated from the shared master curriculum), targeted at the
 * whole college or specific org-units, with a draft→published lifecycle.
 * Isolation is enforced by routing EVERY query through createTenantScope: an
 * exam/attempt not tagged with this tenant simply isn't found (404), so no
 * college can author/take/read another's — and individual (college:null) exams
 * are invisible here and entirely unaffected.
 *
 * Authoring is college_admin (unrestricted in-tenant) or faculty (only exams
 * targeted within their org-unit scope). Taking is by that college's students
 * whose org-unit falls in the exam's target (empty target = college-wide).
 * See docs/MULTI_TENANT_ARCHITECTURE.md §2.
 */
import {
  collectDescendantUnitIds,
  ExamErrorCode,
  StudentErrorCode,
  type AdminExamDetail,
  type AdminPublicLinkUpsert,
  type AdminQuestionUpsert,
  type AdminSectionUpsert,
  type AdminTestCaseUpsert,
  type CollegeExamListResponse,
  type CollegeExamResultsResponse,
  type CreateCollegeExamInput,
  type DuplicateCollegeExamInput,
  type ExamBulkUploadKind,
  type ExamListItem,
  type ExamListResponse,
  type ExcelUploadResponse,
  type PublicLink,
  type StartAttemptResponse,
  type UpdateCollegeExamInput,
} from "@codeapt/shared";
import { Types, type HydratedDocument } from "mongoose";

import { AppError } from "../errors/app-error.js";
import { resolveExamTitle } from "../lib/exam-title.js";
import { createTenantScope, type TenantScope } from "../lib/tenant-scope.js";
import {
  ExamModel,
  ExamAttemptCounterModel,
  ExamQuestionModel,
  ExamSectionModel,
  ExamTestCaseModel,
  PublicExamLinkModel,
  StudentExamAttemptModel,
  type Exam,
} from "../models/assessment.model.js";
import { OrgUnitModel } from "../models/org-unit.model.js";
import { ProfileModel, UserModel } from "../models/user.model.js";
import * as examAdmin from "./exam-admin.service.js";
import { autoPopulateSelfBank } from "./question-bank.service.js";
import { startAttempt } from "./exam.service.js";
import {
  resolveActorScope,
  type ActorScope,
  type StudentActor,
} from "./student.service.js";

type ExamDoc = HydratedDocument<Exam>;

/** The acting operator/student — same shape the student service uses. */
export type ExamActor = StudentActor;

const NOT_FOUND = () =>
  new AppError("Exam not found", 404, ExamErrorCode.EXAM_NOT_FOUND);
const OUT_OF_SCOPE = (msg: string) =>
  new AppError(msg, 403, StudentErrorCode.ORG_UNIT_OUT_OF_SCOPE);

// --- Org-unit scope helpers --------------------------------------------------

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
 * Validate a college exam's target org-units: every id must exist IN THIS
 * TENANT, and (for faculty) be within the actor's scope. A faculty member must
 * target at least one in-scope unit (they cannot create a college-wide exam);
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

/** A faculty member may only manage an exam whose target is within their scope. */
function assertExamManageable(exam: ExamDoc, actorScope: ActorScope): void {
  if (actorScope.unrestricted) return;
  const units = (exam.orgUnits ?? []).map((u) => u.toString());
  if (units.length === 0 || !units.every((u) => actorScope.unitIds.has(u))) {
    throw OUT_OF_SCOPE("This exam is outside your assigned scope");
  }
}

// --- Tenant exam resolution --------------------------------------------------

/** Load a college exam of THIS tenant, or 404 (isolation: cross-tenant not found). */
async function requireTenantExam(
  scope: TenantScope,
  examId: string,
): Promise<ExamDoc> {
  if (!Types.ObjectId.isValid(examId)) throw NOT_FOUND();
  const exam = await ExamModel.findOne(scope.filter({ _id: examId }));
  if (!exam) throw NOT_FOUND();
  return exam;
}

/** Resolve the tenant exam that OWNS a section (via section.exam). */
async function examOfSection(
  scope: TenantScope,
  sectionId: string,
): Promise<ExamDoc> {
  if (!Types.ObjectId.isValid(sectionId)) throw NOT_FOUND();
  const section = await ExamSectionModel.findById(sectionId).select("exam");
  if (!section) throw NOT_FOUND();
  return requireTenantExam(scope, section.exam.toString());
}

/** Resolve the tenant exam that OWNS a question (via question.exam). */
async function examOfQuestion(
  scope: TenantScope,
  questionId: string,
): Promise<ExamDoc> {
  if (!Types.ObjectId.isValid(questionId)) throw NOT_FOUND();
  const q = await ExamQuestionModel.findById(questionId).select("exam");
  if (!q) throw NOT_FOUND();
  return requireTenantExam(scope, q.exam.toString());
}

/** Resolve the tenant exam that OWNS a test case (testCase → question → exam). */
async function examOfTestCase(
  scope: TenantScope,
  testCaseId: string,
): Promise<ExamDoc> {
  if (!Types.ObjectId.isValid(testCaseId)) throw NOT_FOUND();
  const tc = await ExamTestCaseModel.findById(testCaseId).select("question");
  if (!tc) throw NOT_FOUND();
  return examOfQuestion(scope, tc.question.toString());
}

/** Resolve the tenant exam that OWNS a public link. */
async function examOfLink(
  scope: TenantScope,
  linkId: string,
): Promise<ExamDoc> {
  if (!Types.ObjectId.isValid(linkId)) throw NOT_FOUND();
  const link = await PublicExamLinkModel.findById(linkId).select("exam");
  if (!link) throw NOT_FOUND();
  return requireTenantExam(scope, link.exam.toString());
}

/** Resolve exam + actor scope, then assert the actor may manage it. */
async function forManage(
  collegeId: string,
  actor: ExamActor,
  load: (scope: TenantScope) => Promise<ExamDoc>,
): Promise<{ scope: TenantScope; exam: ExamDoc }> {
  const scope = createTenantScope(collegeId);
  const [actorScope, exam] = await Promise.all([
    resolveActorScope(scope, actor),
    load(scope),
  ]);
  assertExamManageable(exam, actorScope);
  return { scope, exam };
}

/**
 * Load a tenant exam the actor may manage (creator/admin unrestricted; faculty
 * within their org-unit scope) — the canonical exam authority. Exported so the
 * Phase-5 exam-analysis service enforces the SAME scope without forking it.
 */
export async function loadManageableExam(
  collegeId: string,
  actor: ExamActor,
  examId: string,
): Promise<{ scope: TenantScope; exam: ExamDoc }> {
  return forManage(collegeId, actor, (s) => requireTenantExam(s, examId));
}

// --- Authoring: exam lifecycle ----------------------------------------------

export async function createCollegeExam(
  collegeId: string,
  actor: ExamActor,
  input: CreateCollegeExamInput,
): Promise<AdminExamDetail> {
  const scope = createTenantScope(collegeId);
  const actorScope = await resolveActorScope(scope, actor);
  const orgUnits = await validateTargetUnits(
    scope,
    actorScope,
    input.orgUnitIds,
  );
  const exam = await ExamModel.create(
    scope.attach({
      title: input.title,
      passPercentage: input.passPercentage,
      calculatorEnabled: input.calculatorEnabled,
      accessCodeEnabled: input.accessCodeEnabled,
      accessCode: input.accessCodeEnabled ? input.accessCode.trim() : "",
      orgUnits,
      isPublished: false,
    }),
  );
  return examAdmin.getAdminExamDetail(exam._id.toString());
}

export async function listCollegeExams(
  collegeId: string,
  actor: ExamActor,
): Promise<CollegeExamListResponse> {
  const scope = createTenantScope(collegeId);
  const actorScope = await resolveActorScope(scope, actor);
  const exams = await ExamModel.find(scope.filter()).sort({
    createdAt: -1,
    _id: -1,
  });

  const manageable = actorScope.unrestricted
    ? exams
    : exams.filter((e) => {
        const units = (e.orgUnits ?? []).map((u) => u.toString());
        return units.length > 0 && units.every((u) => actorScope.unitIds.has(u));
      });

  const items = await Promise.all(
    manageable.map(async (exam) => {
      const [sectionCount, questionCount, attemptCount] = await Promise.all([
        ExamSectionModel.countDocuments({ exam: exam._id }),
        ExamQuestionModel.countDocuments({ exam: exam._id }),
        StudentExamAttemptModel.countDocuments(
          scope.filter({ exam: exam._id }),
        ),
      ]);
      return {
        id: exam._id.toString(),
        title: exam.title,
        totalMarks: exam.totalMarks,
        passPercentage: exam.passPercentage,
        calculatorEnabled: exam.calculatorEnabled,
        accessCodeEnabled: exam.accessCodeEnabled,
        accessCode: exam.accessCode,
        sectionCount,
        questionCount,
        isPublished: exam.isPublished,
        orgUnitIds: (exam.orgUnits ?? []).map((u) => u.toString()),
        attemptCount,
        createdAt: exam.createdAt.toISOString(),
      };
    }),
  );
  return { items };
}

export async function getCollegeExam(
  collegeId: string,
  actor: ExamActor,
  examId: string,
): Promise<AdminExamDetail> {
  const { exam } = await forManage(collegeId, actor, (s) =>
    requireTenantExam(s, examId),
  );
  return examAdmin.getAdminExamDetail(exam._id.toString());
}

export async function updateCollegeExam(
  collegeId: string,
  actor: ExamActor,
  examId: string,
  input: UpdateCollegeExamInput,
): Promise<AdminExamDetail> {
  const { scope, exam } = await forManage(collegeId, actor, (s) =>
    requireTenantExam(s, examId),
  );
  if (input.title !== undefined) exam.title = input.title;
  if (input.passPercentage !== undefined)
    exam.passPercentage = input.passPercentage;
  if (input.calculatorEnabled !== undefined)
    exam.calculatorEnabled = input.calculatorEnabled;
  if (input.accessCodeEnabled !== undefined) {
    exam.accessCodeEnabled = input.accessCodeEnabled;
    // Clearing the gate also clears the stored code; enabling stores the trimmed
    // code (the schema guarantees a ≥4-char code accompanies an enable).
    if (!input.accessCodeEnabled) exam.accessCode = "";
    else if (input.accessCode !== undefined)
      exam.accessCode = input.accessCode.trim();
  } else if (input.accessCode !== undefined) {
    exam.accessCode = input.accessCode.trim();
  }
  if (input.orgUnitIds !== undefined) {
    const actorScope = await resolveActorScope(scope, actor);
    exam.orgUnits = await validateTargetUnits(
      scope,
      actorScope,
      input.orgUnitIds,
    );
  }
  await exam.save();
  return examAdmin.getAdminExamDetail(exam._id.toString());
}

/**
 * Duplicate an exam's whole paper into a NEW unpublished draft under a new
 * title, same tenant + same targeting, with zero attempts. Copies exam-level
 * settings (pass %, calculator, access-code gate) and the full section/question/
 * test-case tree; does NOT copy public links or any attempt state.
 */
export async function duplicateCollegeExam(
  collegeId: string,
  actor: ExamActor,
  examId: string,
  input: DuplicateCollegeExamInput,
): Promise<AdminExamDetail> {
  const { scope, exam } = await forManage(collegeId, actor, (s) =>
    requireTenantExam(s, examId),
  );
  // Re-validate the source's targeting under the actor's CURRENT scope so a
  // faculty member can't clone an exam into units they no longer manage.
  const actorScope = await resolveActorScope(scope, actor);
  const orgUnits = await validateTargetUnits(
    scope,
    actorScope,
    (exam.orgUnits ?? []).map((u) => u.toString()),
  );
  const copy = await ExamModel.create(
    scope.attach({
      title: input.title,
      passPercentage: exam.passPercentage,
      calculatorEnabled: exam.calculatorEnabled,
      accessCodeEnabled: exam.accessCodeEnabled,
      accessCode: exam.accessCode,
      orgUnits,
      isPublished: false,
    }),
  );
  await examAdmin.cloneExamContent(exam._id, copy._id);
  return examAdmin.getAdminExamDetail(copy._id.toString());
}

/** Publish / unpublish. Publishing requires at least one question. */
export async function setCollegeExamPublished(
  collegeId: string,
  actor: ExamActor,
  examId: string,
  isPublished: boolean,
): Promise<AdminExamDetail> {
  const { exam } = await forManage(collegeId, actor, (s) =>
    requireTenantExam(s, examId),
  );
  if (isPublished) {
    const questionCount = await ExamQuestionModel.countDocuments({
      exam: exam._id,
    });
    if (questionCount === 0) {
      throw new AppError(
        "Add at least one question before publishing this exam",
        400,
        "EXAM_NOT_PUBLISHABLE",
      );
    }
  }
  exam.isPublished = isPublished;
  await exam.save();
  return examAdmin.getAdminExamDetail(exam._id.toString());
}

export async function removeCollegeExam(
  collegeId: string,
  actor: ExamActor,
  examId: string,
): Promise<{ deleted: true }> {
  const { exam } = await forManage(collegeId, actor, (s) =>
    requireTenantExam(s, examId),
  );
  // Reuse the reference-safe delete (blocks if attempts exist, else cascades).
  return examAdmin.deleteExam(exam._id.toString());
}

// --- Authoring: section / question / test-case / link CRUD (delegated) -------

export async function addSection(
  collegeId: string,
  actor: ExamActor,
  examId: string,
  input: AdminSectionUpsert,
): Promise<AdminExamDetail> {
  await forManage(collegeId, actor, (s) => requireTenantExam(s, examId));
  return examAdmin.createSection(examId, input);
}

export async function editSection(
  collegeId: string,
  actor: ExamActor,
  sectionId: string,
  input: AdminSectionUpsert,
): Promise<AdminExamDetail> {
  await forManage(collegeId, actor, (s) => examOfSection(s, sectionId));
  return examAdmin.updateSection(sectionId, input);
}

export async function removeSection(
  collegeId: string,
  actor: ExamActor,
  sectionId: string,
): Promise<AdminExamDetail> {
  const { exam } = await forManage(collegeId, actor, (s) =>
    examOfSection(s, sectionId),
  );
  await examAdmin.deleteSection(sectionId);
  return examAdmin.getAdminExamDetail(exam._id.toString());
}

export async function addQuestion(
  collegeId: string,
  actor: ExamActor,
  input: AdminQuestionUpsert,
): Promise<{ id: string }> {
  await forManage(collegeId, actor, (s) => examOfSection(s, input.sectionId));
  return examAdmin.createQuestion(input);
}

export async function editQuestion(
  collegeId: string,
  actor: ExamActor,
  questionId: string,
  input: AdminQuestionUpsert,
): Promise<{ id: string }> {
  await forManage(collegeId, actor, (s) => examOfQuestion(s, questionId));
  return examAdmin.updateQuestion(questionId, input);
}

export async function removeQuestion(
  collegeId: string,
  actor: ExamActor,
  questionId: string,
): Promise<{ deleted: true }> {
  await forManage(collegeId, actor, (s) => examOfQuestion(s, questionId));
  await examAdmin.deleteQuestion(questionId);
  return { deleted: true };
}

export async function addTestCase(
  collegeId: string,
  actor: ExamActor,
  questionId: string,
  input: AdminTestCaseUpsert,
): Promise<{ id: string }> {
  await forManage(collegeId, actor, (s) => examOfQuestion(s, questionId));
  return examAdmin.addTestCase(questionId, input);
}

export async function editTestCase(
  collegeId: string,
  actor: ExamActor,
  testCaseId: string,
  input: AdminTestCaseUpsert,
): Promise<{ id: string }> {
  await forManage(collegeId, actor, (s) => examOfTestCase(s, testCaseId));
  return examAdmin.updateTestCase(testCaseId, input);
}

export async function removeTestCase(
  collegeId: string,
  actor: ExamActor,
  testCaseId: string,
): Promise<{ deleted: true }> {
  await forManage(collegeId, actor, (s) => examOfTestCase(s, testCaseId));
  await examAdmin.deleteTestCase(testCaseId);
  return { deleted: true };
}

export async function bulkUpload(
  collegeId: string,
  actor: ExamActor,
  examId: string,
  fileBase64: string,
  kind: ExamBulkUploadKind,
): Promise<ExcelUploadResponse> {
  await forManage(collegeId, actor, (s) => requireTenantExam(s, examId));
  // Reuse the shared exam creation path, and ALSO mirror the same questions into
  // this college's Self Bank (auto-populate). The self-bank write is additive:
  // if it fails, the exam upload still succeeds (never corrupt the exam).
  const { response, questions } = await examAdmin.bulkUploadQuestionsWithParsed(
    examId,
    fileBase64,
    kind,
  );
  try {
    await autoPopulateSelfBank(collegeId, questions);
  } catch {
    /* self-bank mirroring is best-effort; the exam upload already succeeded */
  }
  return response;
}

export async function addPublicLink(
  collegeId: string,
  actor: ExamActor,
  examId: string,
  input: AdminPublicLinkUpsert,
): Promise<PublicLink> {
  await forManage(collegeId, actor, (s) => requireTenantExam(s, examId));
  return examAdmin.createPublicLink(examId, input);
}

export async function editPublicLink(
  collegeId: string,
  actor: ExamActor,
  linkId: string,
  input: AdminPublicLinkUpsert,
): Promise<PublicLink> {
  await forManage(collegeId, actor, (s) => examOfLink(s, linkId));
  return examAdmin.updatePublicLink(linkId, input);
}

export async function removePublicLink(
  collegeId: string,
  actor: ExamActor,
  linkId: string,
): Promise<{ deleted: true }> {
  await forManage(collegeId, actor, (s) => examOfLink(s, linkId));
  await examAdmin.deletePublicLink(linkId);
  return { deleted: true };
}

/** Export results for ONE public link (tenant + faculty-scope authorized). */
export async function exportPublicLinkResults(
  collegeId: string,
  actor: ExamActor,
  linkId: string,
): Promise<{ buffer: Buffer; filename: string }> {
  await forManage(collegeId, actor, (s) => examOfLink(s, linkId));
  return examAdmin.exportPublicLinkResults(linkId);
}

export async function resetAttempts(
  collegeId: string,
  actor: ExamActor,
  examId: string,
  input: { userId: string; reason: string },
): Promise<{ attemptCount: number; maxAttempts: number }> {
  const { exam } = await forManage(collegeId, actor, (s) =>
    requireTenantExam(s, examId),
  );
  return examAdmin.resetAttempts(exam._id.toString(), actor.userId, input);
}

// --- Results (tenant-scoped read) -------------------------------------------

export async function collegeExamResults(
  collegeId: string,
  actor: ExamActor,
  examId: string,
): Promise<CollegeExamResultsResponse> {
  const { scope, exam } = await forManage(collegeId, actor, (s) =>
    requireTenantExam(s, examId),
  );
  // Tenant-scoped: only THIS college's attempts on the exam.
  const attempts = await StudentExamAttemptModel.find(
    scope.filter({ exam: exam._id }),
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
  const nameByUser = new Map(profiles.map((p) => [p.user.toString(), p.fullName]));
  const rollByUser = new Map(
    users.map((u) => [u._id.toString(), u.rollNumber ?? ""]),
  );

  return {
    examId: exam._id.toString(),
    examTitle: resolveExamTitle(exam.title, undefined),
    totalMarks: exam.totalMarks,
    items: attempts.map((a) => {
      const uid = a.user ? a.user.toString() : null;
      return {
        attemptId: a._id.toString(),
        userId: uid,
        student: uid ? (nameByUser.get(uid) ?? "Student") : "Anonymous",
        rollNumber: uid ? (rollByUser.get(uid) ?? "") : a.rollNumber,
        status: a.status,
        score: a.score,
        passed: a.passed,
        warnings: a.warningsTriggered,
        isMalpractice: a.isMalpractice,
        completedAt: a.completedAt ? a.completedAt.toISOString() : null,
      };
    }),
  };
}

// --- Taking (college student) ------------------------------------------------

/** Is a student (in `studentUnit`) inside the exam's target org-units? */
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

export async function listStudentCollegeExams(
  collegeId: string,
  studentUserId: string,
): Promise<ExamListResponse> {
  const scope = createTenantScope(collegeId);
  const student = await UserModel.findById(studentUserId).select("orgUnit");
  const studentUnit = student?.orgUnit ? student.orgUnit.toString() : null;

  const exams = await ExamModel.find(scope.filter({ isPublished: true })).sort({
    createdAt: -1,
    _id: -1,
  });
  if (exams.length === 0) return { items: [] };
  const refs = await unitRefs(scope);

  const items: ExamListItem[] = [];
  for (const exam of exams) {
    const targets = (exam.orgUnits ?? []).map((u) => u.toString());
    if (!studentInTarget(targets, studentUnit, refs)) continue;

    const [sectionCount, questionCount, sections] = await Promise.all([
      ExamSectionModel.countDocuments({ exam: exam._id }),
      ExamQuestionModel.countDocuments({ exam: exam._id }),
      ExamSectionModel.find({ exam: exam._id }).select("durationMinutes"),
    ]);
    const totalDurationMinutes = sections.reduce(
      (s, sec) => s + sec.durationMinutes,
      0,
    );
    const counter = await ExamAttemptCounterModel.findOne({
      user: studentUserId,
      exam: exam._id,
    });
    const last = await StudentExamAttemptModel.findOne({
      user: new Types.ObjectId(studentUserId),
      exam: exam._id,
    }).sort({ createdAt: -1 });

    items.push({
      id: exam._id.toString(),
      topicId: "",
      title: resolveExamTitle(exam.title, undefined),
      totalMarks: exam.totalMarks,
      passPercentage: exam.passPercentage,
      sectionCount,
      questionCount,
      totalDurationMinutes,
      accessCodeEnabled: exam.accessCodeEnabled,
      attemptsUsed: counter?.attemptCount ?? 0,
      maxAttempts: counter?.maxAttempts ?? 1,
      lastAttempt: last
        ? {
            id: last._id.toString(),
            status: last.status,
            score: last.score,
            passed: last.passed,
          }
        : null,
    });
  }
  return { items };
}

export async function startStudentCollegeExam(
  collegeId: string,
  studentUserId: string,
  examId: string,
  accessCode?: string,
): Promise<StartAttemptResponse> {
  const scope = createTenantScope(collegeId);
  if (!Types.ObjectId.isValid(examId)) throw NOT_FOUND();
  // Isolation + lifecycle: must be a PUBLISHED exam of THIS tenant.
  const exam = await ExamModel.findOne(
    scope.filter({ _id: examId, isPublished: true }),
  );
  if (!exam) throw NOT_FOUND();

  const targets = (exam.orgUnits ?? []).map((u) => u.toString());
  if (targets.length > 0) {
    const student = await UserModel.findById(studentUserId).select("orgUnit");
    const studentUnit = student?.orgUnit ? student.orgUnit.toString() : null;
    const refs = await unitRefs(scope);
    if (!studentInTarget(targets, studentUnit, refs)) {
      throw OUT_OF_SCOPE("This exam is not assigned to your cohort");
    }
  }
  // Reuse the engine: counter enforcement + attempt creation (which stamps the
  // tenant onto the attempt). Subsequent section/answer/submit/result calls use
  // the shared /attempts/* endpoints, authorized by attempt ownership.
  return startAttempt(studentUserId, examId, accessCode);
}
