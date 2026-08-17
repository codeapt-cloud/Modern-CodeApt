/**
 * Admin exam authoring — CRUD over the exam tree, Excel bulk upload / results
 * export, and attempt-limit resets (with an audit log). Admin projections
 * intentionally INCLUDE correctOptions + test cases (unlike candidate views).
 */
import {
  ExamErrorCode,
  ExamQuestionType,
  type AdminExamDetail,
  type AdminPublicLinkUpsert,
  type AdminQuestionUpsert,
  type AdminSectionUpsert,
  type AdminTestCaseUpsert,
  type CodeLanguage,
  type ExamQuestionType as ExamQuestionTypeT,
  type ExamBulkUploadKind,
  type ExcelUploadResponse,
  type PublicLink,
} from "@codeapt/shared";
import { randomUUID } from "node:crypto";
import { Types, type HydratedDocument } from "mongoose";

import { AppError } from "../errors/app-error.js";
import {
  buildResultsWorkbook,
  parseCodingWorkbook,
  parseMcqWorkbook,
  type ParsedQuestion,
  type ResultRow,
} from "../lib/exam-excel.js";
import {
  ExamModel,
  ExamAttemptCounterModel,
  ExamAttemptResetLogModel,
  ExamQuestionModel,
  ExamSectionModel,
  ExamTestCaseModel,
  PublicExamLinkModel,
  StudentExamAttemptModel,
  type Exam,
} from "../models/assessment.model.js";
import { ProfileModel } from "../models/user.model.js";
import { resolveExamTitle, topicNamesByIds } from "../lib/exam-title.js";

type ExamDoc = HydratedDocument<Exam>;

async function requireExamDoc(examId: string): Promise<ExamDoc> {
  if (!Types.ObjectId.isValid(examId)) {
    throw new AppError("Exam not found", 404, ExamErrorCode.EXAM_NOT_FOUND);
  }
  const exam = await ExamModel.findById(examId);
  if (!exam)
    throw new AppError("Exam not found", 404, ExamErrorCode.EXAM_NOT_FOUND);
  return exam;
}

/**
 * Deep-copy the whole paper (sections → questions → test cases, incl. hidden
 * cases and correctOptions) from one exam onto another, EMPTY target exam,
 * re-linking every child to the new parents. Used by the college "duplicate
 * exam" flow. Does NOT copy attempts/counters/public links — the caller creates
 * the target as a fresh unpublished draft. Recomputes the target's totalMarks.
 */
export async function cloneExamContent(
  sourceExamId: Types.ObjectId,
  targetExamId: Types.ObjectId,
): Promise<void> {
  const sections = await ExamSectionModel.find({ exam: sourceExamId }).sort({
    order: 1,
    _id: 1,
  });
  for (const s of sections) {
    const newSection = await ExamSectionModel.create({
      exam: targetExamId,
      name: s.name,
      order: s.order,
      durationMinutes: s.durationMinutes,
      description: s.description,
    });
    const questions = await ExamQuestionModel.find({ section: s._id }).sort({
      order: 1,
      _id: 1,
    });
    for (const q of questions) {
      const newQuestion = await ExamQuestionModel.create({
        section: newSection._id,
        exam: targetExamId,
        questionType: q.questionType,
        text: q.text,
        order: q.order,
        options: q.options,
        correctOptions: q.correctOptions,
        starterCode: q.starterCode,
        language: q.language,
        allowedLanguages: q.allowedLanguages,
        image: q.image,
        marks: q.marks,
      });
      const testCases = await ExamTestCaseModel.find({ question: q._id }).sort({
        order: 1,
        _id: 1,
      });
      if (testCases.length > 0) {
        await ExamTestCaseModel.insertMany(
          testCases.map((tc) => ({
            question: newQuestion._id,
            inputData: tc.inputData,
            expectedOutput: tc.expectedOutput,
            isHidden: tc.isHidden,
            order: tc.order,
          })),
        );
      }
    }
  }
  await recomputeTotal(targetExamId);
}

/** Keep exam.totalMarks in sync with the sum of its question marks. */
async function recomputeTotal(examId: Types.ObjectId): Promise<number> {
  const questions = await ExamQuestionModel.find({ exam: examId }).select(
    "marks",
  );
  const total = questions.reduce((s, q) => s + q.marks, 0);
  await ExamModel.updateOne({ _id: examId }, { $set: { totalMarks: total } });
  return total;
}

// --- Exam upsert (1:1 with a Topic) -----------------------------------------

export async function upsertExam(input: {
  topicId: string;
  title: string;
  passPercentage: number;
  calculatorEnabled: boolean;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
}): Promise<AdminExamDetail> {
  const exam = await ExamModel.findOneAndUpdate(
    { topic: new Types.ObjectId(input.topicId) },
    {
      $set: {
        title: input.title,
        passPercentage: input.passPercentage,
        calculatorEnabled: input.calculatorEnabled,
        shuffleQuestions: input.shuffleQuestions,
        shuffleOptions: input.shuffleOptions,
      },
    },
    { upsert: true, new: true },
  );
  return getAdminExamDetail(exam._id.toString());
}

/** List EVERY exam (regardless of enrollment) with cheap section/question counts. */
export async function listAllExams(): Promise<{
  items: {
    id: string;
    topicId: string;
    title: string;
    totalMarks: number;
    passPercentage: number;
    sectionCount: number;
    questionCount: number;
  }[];
}> {
  const exams = await ExamModel.find().sort({ createdAt: -1, _id: -1 });
  // Two grouped aggregations instead of N+1 per-exam counts.
  const [sectionAgg, questionAgg] = await Promise.all([
    ExamSectionModel.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $group: { _id: "$exam", count: { $sum: 1 } } },
    ]),
    ExamQuestionModel.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $group: { _id: "$exam", count: { $sum: 1 } } },
    ]),
  ]);
  // Filter null group keys: a doc with a null `exam` FK (e.g. imperfect
  // migrated data) yields an `_id: null` group whose `.toString()` would throw.
  const sectionCounts = new Map(
    sectionAgg.filter((s) => s._id).map((s) => [s._id.toString(), s.count]),
  );
  const questionCounts = new Map(
    questionAgg.filter((q) => q._id).map((q) => [q._id.toString(), q.count]),
  );
  // Migrated exams have a blank title → resolve to the linked topic's name.
  const topicNames = await topicNamesByIds(
    exams.map((e) => e.topic).filter((t): t is Types.ObjectId => t != null),
  );
  return {
    items: exams.map((exam) => ({
      id: exam._id.toString(),
      topicId: exam.topic ? exam.topic.toString() : "",
      title: resolveExamTitle(
        exam.title,
        exam.topic ? topicNames.get(exam.topic.toString()) : undefined,
      ),
      totalMarks: exam.totalMarks,
      passPercentage: exam.passPercentage,
      sectionCount: sectionCounts.get(exam._id.toString()) ?? 0,
      questionCount: questionCounts.get(exam._id.toString()) ?? 0,
    })),
  };
}

export async function getAdminExamDetail(
  examId: string,
): Promise<AdminExamDetail> {
  const exam = await requireExamDoc(examId);
  const sections = await ExamSectionModel.find({ exam: exam._id }).sort({
    order: 1,
    _id: 1,
  });
  const questions = await ExamQuestionModel.find({ exam: exam._id }).sort({
    order: 1,
    _id: 1,
  });
  const testCases = await ExamTestCaseModel.find({
    question: { $in: questions.map((q) => q._id) },
  }).sort({ order: 1, _id: 1 });
  const links = await PublicExamLinkModel.find({ exam: exam._id });

  const casesByQ = new Map<string, typeof testCases>();
  for (const c of testCases) {
    const key = c.question.toString();
    const list = casesByQ.get(key) ?? [];
    list.push(c);
    casesByQ.set(key, list);
  }
  const questionsBySection = new Map<string, typeof questions>();
  for (const q of questions) {
    const key = q.section.toString();
    const list = questionsBySection.get(key) ?? [];
    list.push(q);
    questionsBySection.set(key, list);
  }

  return {
    id: exam._id.toString(),
    // Individual exams are 1:1 with a Topic; tenant (college) exams are
    // standalone (no topic) → empty topicId. Guarded so the shared read never
    // dereferences a null topic.
    topicId: exam.topic ? exam.topic.toString() : "",
    title: exam.title,
    totalMarks: exam.totalMarks,
    passPercentage: exam.passPercentage,
    calculatorEnabled: exam.calculatorEnabled,
    shuffleQuestions: exam.shuffleQuestions,
    shuffleOptions: exam.shuffleOptions,
    accessCodeEnabled: exam.accessCodeEnabled,
    accessCode: exam.accessCode,
    sections: sections.map((s) => ({
      id: s._id.toString(),
      name: s.name,
      order: s.order,
      durationMinutes: s.durationMinutes,
      description: s.description,
      questions: (questionsBySection.get(s._id.toString()) ?? []).map((q) => ({
        id: q._id.toString(),
        type: q.questionType as ExamQuestionTypeT,
        text: q.text,
        order: q.order,
        marks: q.marks,
        options: q.options ?? null,
        correctOptions: q.correctOptions ?? null,
        starterCode: q.starterCode,
        language: q.language as CodeLanguage,
        allowedLanguages: (q.allowedLanguages ?? []) as CodeLanguage[],
        image: q.image,
        testCases: (casesByQ.get(q._id.toString()) ?? []).map((c) => ({
          id: c._id.toString(),
          input: c.inputData,
          expectedOutput: c.expectedOutput,
          isHidden: c.isHidden,
          order: c.order,
        })),
      })),
    })),
    publicLinks: links.map(toPublicLink),
  };
}

// --- Section / question / test-case CRUD ------------------------------------

export async function createSection(
  examId: string,
  input: AdminSectionUpsert,
): Promise<AdminExamDetail> {
  const exam = await requireExamDoc(examId);
  await ExamSectionModel.create({ exam: exam._id, ...input });
  return getAdminExamDetail(examId);
}

export async function updateSection(
  sectionId: string,
  input: AdminSectionUpsert,
): Promise<AdminExamDetail> {
  const section = await ExamSectionModel.findById(sectionId);
  if (!section) {
    throw new AppError("Section not found", 404, ExamErrorCode.EXAM_NOT_FOUND);
  }
  section.name = input.name;
  section.order = input.order;
  section.durationMinutes = input.durationMinutes;
  section.description = input.description;
  await section.save();
  return getAdminExamDetail(section.exam.toString());
}

export async function deleteSection(sectionId: string): Promise<void> {
  const section = await ExamSectionModel.findById(sectionId);
  if (!section) return;
  const questions = await ExamQuestionModel.find({ section: section._id });
  await ExamTestCaseModel.deleteMany({
    question: { $in: questions.map((q) => q._id) },
  });
  await ExamQuestionModel.deleteMany({ section: section._id });
  await ExamSectionModel.deleteOne({ _id: section._id });
  await recomputeTotal(section.exam);
}

/**
 * Reference-safe exam delete. BLOCK when student attempts exist (never destroy
 * results history); otherwise cascade every exam-owned record — sections,
 * questions, test-cases, public links, and the attempt-limit counters/reset
 * logs (which are meaningless once the exam is gone).
 */
export async function deleteExam(examId: string): Promise<{ deleted: true }> {
  const exam = await requireExamDoc(examId);
  const attempts = await StudentExamAttemptModel.countDocuments({
    exam: exam._id,
  });
  if (attempts > 0) {
    throw new AppError(
      `Cannot delete "${exam.title}" — students have attempts recorded against it. ` +
        `Deleting it would destroy their results.`,
      409,
      ExamErrorCode.DELETE_BLOCKED,
      { blockers: { attempts } },
    );
  }
  const questions = await ExamQuestionModel.find({ exam: exam._id });
  await ExamTestCaseModel.deleteMany({
    question: { $in: questions.map((q) => q._id) },
  });
  await ExamQuestionModel.deleteMany({ exam: exam._id });
  await ExamSectionModel.deleteMany({ exam: exam._id });
  await PublicExamLinkModel.deleteMany({ exam: exam._id });
  await ExamAttemptCounterModel.deleteMany({ exam: exam._id });
  await ExamAttemptResetLogModel.deleteMany({ exam: exam._id });
  await ExamModel.deleteOne({ _id: exam._id });
  return { deleted: true };
}

export async function createQuestion(
  input: AdminQuestionUpsert,
): Promise<{ id: string }> {
  const section = await ExamSectionModel.findById(input.sectionId);
  if (!section) {
    throw new AppError("Section not found", 404, ExamErrorCode.EXAM_NOT_FOUND);
  }
  const q = await ExamQuestionModel.create({
    section: section._id,
    exam: section.exam,
    questionType: input.type,
    text: input.text,
    order: input.order,
    marks: input.marks,
    options: input.options,
    correctOptions: input.correctOptions,
    starterCode: input.starterCode,
    language: input.language,
    allowedLanguages: input.allowedLanguages,
    image: input.image,
  });
  await recomputeTotal(section.exam);
  return { id: q._id.toString() };
}

export async function updateQuestion(
  questionId: string,
  input: AdminQuestionUpsert,
): Promise<{ id: string }> {
  if (!Types.ObjectId.isValid(questionId)) {
    throw new AppError("Question not found", 404, ExamErrorCode.EXAM_NOT_FOUND);
  }
  const q = await ExamQuestionModel.findById(questionId);
  if (!q) {
    throw new AppError("Question not found", 404, ExamErrorCode.EXAM_NOT_FOUND);
  }
  // The question keeps its section/exam; only the authored fields change.
  q.questionType = input.type;
  q.text = input.text;
  q.order = input.order;
  q.marks = input.marks;
  q.options = input.options;
  q.correctOptions = input.correctOptions;
  q.starterCode = input.starterCode;
  q.language = input.language;
  q.allowedLanguages = input.allowedLanguages;
  q.image = input.image;
  await q.save();
  await recomputeTotal(q.exam);
  return { id: q._id.toString() };
}

export async function deleteQuestion(questionId: string): Promise<void> {
  const q = await ExamQuestionModel.findById(questionId);
  if (!q) return;
  await ExamTestCaseModel.deleteMany({ question: q._id });
  await ExamQuestionModel.deleteOne({ _id: q._id });
  await recomputeTotal(q.exam);
}

export async function addTestCase(
  questionId: string,
  input: AdminTestCaseUpsert,
): Promise<{ id: string }> {
  const q = await ExamQuestionModel.findById(questionId);
  if (!q) {
    throw new AppError("Question not found", 404, ExamErrorCode.EXAM_NOT_FOUND);
  }
  const tc = await ExamTestCaseModel.create({
    question: q._id,
    inputData: input.input,
    expectedOutput: input.expectedOutput,
    isHidden: input.isHidden,
    order: input.order,
  });
  return { id: tc._id.toString() };
}

export async function updateTestCase(
  testCaseId: string,
  input: AdminTestCaseUpsert,
): Promise<{ id: string }> {
  const tc = await ExamTestCaseModel.findById(testCaseId);
  if (!tc) {
    throw new AppError("Test case not found", 404, ExamErrorCode.EXAM_NOT_FOUND);
  }
  tc.inputData = input.input;
  tc.expectedOutput = input.expectedOutput;
  tc.isHidden = input.isHidden;
  tc.order = input.order;
  await tc.save();
  return { id: tc._id.toString() };
}

export async function deleteTestCase(testCaseId: string): Promise<void> {
  await ExamTestCaseModel.deleteOne({ _id: testCaseId });
}

// --- Public links -----------------------------------------------------------

function toPublicLink(
  link: HydratedDocument<{
    accessToken: string;
    isActive: boolean;
    startTime?: Date | null;
    endTime?: Date | null;
    accessCodeEnabled: boolean;
    accessCode: string;
    tag: string;
  }>,
): PublicLink {
  return {
    id: link._id.toString(),
    accessToken: link.accessToken,
    isActive: link.isActive,
    startTime: link.startTime ? link.startTime.toISOString() : null,
    endTime: link.endTime ? link.endTime.toISOString() : null,
    accessCodeEnabled: link.accessCodeEnabled,
    accessCode: link.accessCode,
    tag: link.tag,
  };
}

export async function createPublicLink(
  examId: string,
  input: AdminPublicLinkUpsert,
): Promise<PublicLink> {
  const exam = await requireExamDoc(examId);
  const link = await PublicExamLinkModel.create({
    exam: exam._id,
    accessToken: randomUUID(),
    isActive: input.isActive,
    startTime: input.startTime ? new Date(input.startTime) : undefined,
    endTime: input.endTime ? new Date(input.endTime) : undefined,
    accessCodeEnabled: input.accessCodeEnabled,
    accessCode: input.accessCodeEnabled ? input.accessCode.trim() : "",
    tag: input.tag.trim(),
  });
  return toPublicLink(link);
}

export async function updatePublicLink(
  linkId: string,
  input: AdminPublicLinkUpsert,
): Promise<PublicLink> {
  const link = await PublicExamLinkModel.findByIdAndUpdate(
    linkId,
    {
      $set: {
        isActive: input.isActive,
        startTime: input.startTime ? new Date(input.startTime) : null,
        endTime: input.endTime ? new Date(input.endTime) : null,
        accessCodeEnabled: input.accessCodeEnabled,
        accessCode: input.accessCodeEnabled ? input.accessCode.trim() : "",
        tag: input.tag.trim(),
      },
    },
    { new: true },
  );
  if (!link) {
    throw new AppError("Link not found", 404, ExamErrorCode.LINK_UNAVAILABLE);
  }
  return toPublicLink(link);
}

/** Revoke (hard-delete) a public link — anonymous access via its token stops. */
export async function deletePublicLink(linkId: string): Promise<void> {
  await PublicExamLinkModel.deleteOne({ _id: linkId });
}

// --- Excel bulk upload ------------------------------------------------------

export async function bulkUploadQuestions(
  examId: string,
  fileBase64: string,
  kind: ExamBulkUploadKind,
): Promise<ExcelUploadResponse> {
  const { response } = await bulkUploadQuestionsWithParsed(
    examId,
    fileBase64,
    kind,
  );
  return response;
}

/**
 * As {@link bulkUploadQuestions}, but ALSO returns the PARSED questions. The
 * college exam path uses this to additionally mirror the same questions into the
 * college's Self Bank (auto-populate) without re-parsing. The individual/global
 * exam path calls the thin wrapper above, so its behavior is unchanged.
 */
export async function bulkUploadQuestionsWithParsed(
  examId: string,
  fileBase64: string,
  kind: ExamBulkUploadKind,
): Promise<{ response: ExcelUploadResponse; questions: ParsedQuestion[] }> {
  const exam = await requireExamDoc(examId);
  const buffer = Buffer.from(fileBase64, "base64");
  const { questions, errors } =
    kind === "mcq"
      ? await parseMcqWorkbook(buffer)
      : await parseCodingWorkbook(buffer);

  let createdSections = 0;
  let createdQuestions = 0;
  let createdTestCases = 0;

  // Find-or-create sections by (exam, name).
  const sectionByName = new Map<string, Types.ObjectId>();
  for (const q of questions) {
    if (sectionByName.has(q.sectionName)) continue;
    const existing = await ExamSectionModel.findOne({
      exam: exam._id,
      name: q.sectionName,
    });
    if (existing) {
      sectionByName.set(q.sectionName, existing._id);
    } else {
      const created = await ExamSectionModel.create({
        exam: exam._id,
        name: q.sectionName,
        order: q.sectionOrder,
        durationMinutes: q.sectionDuration,
      });
      sectionByName.set(q.sectionName, created._id);
      createdSections += 1;
    }
  }

  for (const q of questions) {
    const sectionId = sectionByName.get(q.sectionName)!;
    const created = await ExamQuestionModel.create({
      section: sectionId,
      exam: exam._id,
      questionType: q.type,
      text: q.text,
      order: q.order,
      marks: q.marks,
      options: q.options,
      correctOptions: q.correctOptions,
      starterCode: q.starterCode,
      language: q.language,
      allowedLanguages: q.allowedLanguages,
    });
    createdQuestions += 1;
    if (q.type === ExamQuestionType.CODE && q.testCases.length > 0) {
      await ExamTestCaseModel.insertMany(
        q.testCases.map((c, i) => ({
          question: created._id,
          inputData: c.input,
          expectedOutput: c.expectedOutput,
          isHidden: c.isHidden,
          order: i,
        })),
      );
      createdTestCases += q.testCases.length;
    }
  }

  await recomputeTotal(exam._id);
  return {
    response: { createdSections, createdQuestions, createdTestCases, errors },
    questions,
  };
}

// --- Results export ---------------------------------------------------------

export async function exportResults(
  examId: string,
  opts?: { publicLinkId?: Types.ObjectId; filenameLabel?: string },
): Promise<{ buffer: Buffer; filename: string }> {
  const exam = await requireExamDoc(examId);
  const sections = await ExamSectionModel.find({ exam: exam._id }).sort({
    order: 1,
    _id: 1,
  });
  const sectionNames = sections.map((s) => s.name);

  const attempts = await StudentExamAttemptModel.find({
    exam: exam._id,
    // When scoped to one public link, export ONLY that link's takers.
    ...(opts?.publicLinkId ? { publicLink: opts.publicLinkId } : {}),
  }).sort({
    createdAt: 1,
  });
  const userIds = attempts
    .map((a) => a.user)
    .filter((u): u is Types.ObjectId => u != null);
  const profiles = await ProfileModel.find({ user: { $in: userIds } }).lean<
    { user: Types.ObjectId; fullName: string; rollNumber: string }[]
  >();
  const profileByUser = new Map(profiles.map((p) => [p.user.toString(), p]));

  // Public-link tag per attempt — one combined file across all links, with a
  // Tag/Session column so an admin can tell which link a taker came through.
  const links = await PublicExamLinkModel.find({ exam: exam._id }).select("tag");
  const tagByLink = new Map(links.map((l) => [l._id.toString(), l.tag]));

  const rows: ResultRow[] = attempts.map((a) => {
    const breakdown =
      (a.responseData as { breakdown?: { name: string; score: number }[] })
        ?.breakdown ?? [];
    const profile = a.user ? profileByUser.get(a.user.toString()) : undefined;
    return {
      candidate: profile?.fullName ?? (a.user ? "User" : "Anonymous"),
      rollNumber: profile?.rollNumber ?? a.rollNumber,
      collegeName: a.collegeName,
      tag: a.publicLink ? (tagByLink.get(a.publicLink.toString()) ?? "") : "",
      status: a.status,
      score: a.score,
      totalMarks: exam.totalMarks,
      passed: a.passed,
      autoSubmitted: a.isAutoSubmitted,
      warnings: a.warningsTriggered,
      sectionScores: breakdown.map((b) => ({ name: b.name, score: b.score })),
      submittedAt: a.completedAt ? a.completedAt.toISOString() : "",
    };
  });

  const buffer = await buildResultsWorkbook(exam.title, sectionNames, rows);
  const filename = opts?.filenameLabel
    ? `results-${opts.filenameLabel}.xlsx`
    : `results-${exam._id.toString()}.xlsx`;
  return { buffer, filename };
}

/** Filename-safe slug of a free-text tag (falls back to "" when empty). */
function fileSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Export results for a SINGLE public link (only its anonymous takers). Reuses
 * the exam-wide builder filtered to the link, with a filename derived from the
 * link's tag (or a token prefix) so downloads for different sessions are
 * distinguishable on disk.
 */
export async function exportPublicLinkResults(
  linkId: string,
): Promise<{ buffer: Buffer; filename: string }> {
  if (!Types.ObjectId.isValid(linkId)) {
    throw new AppError("Link not found", 404, ExamErrorCode.LINK_UNAVAILABLE);
  }
  const link = await PublicExamLinkModel.findById(linkId);
  if (!link) {
    throw new AppError("Link not found", 404, ExamErrorCode.LINK_UNAVAILABLE);
  }
  const label = fileSlug(link.tag) || `link-${link.accessToken.slice(0, 8)}`;
  return exportResults(link.exam.toString(), {
    publicLinkId: link._id,
    filenameLabel: label,
  });
}

// --- Attempt-limit reset (audited) ------------------------------------------

export async function resetAttempts(
  examId: string,
  adminId: string,
  input: { userId: string; reason: string },
): Promise<{ attemptCount: number; maxAttempts: number }> {
  const exam = await requireExamDoc(examId);
  const counter = await ExamAttemptCounterModel.findOne({
    exam: exam._id,
    user: input.userId,
  });
  const previousCount = counter?.attemptCount ?? 0;

  await ExamAttemptResetLogModel.create({
    exam: exam._id,
    user: new Types.ObjectId(input.userId),
    resetBy: new Types.ObjectId(adminId),
    previousCount,
    reason: input.reason,
  });

  const updated = await ExamAttemptCounterModel.findOneAndUpdate(
    { exam: exam._id, user: input.userId },
    { $set: { attemptCount: 0 }, $setOnInsert: { maxAttempts: 1 } },
    { upsert: true, new: true },
  );
  return {
    attemptCount: updated.attemptCount,
    maxAttempts: updated.maxAttempts,
  };
}

// --- Attempt-management READS (item C4) -------------------------------------

function iso(d: Date | null | undefined): string | null {
  return d ? new Date(d).toISOString() : null;
}

/** Build a Map<userId, fullName> for the given user ids. */
async function nameByUser(
  ids: Types.ObjectId[],
): Promise<Map<string, { fullName: string; rollNumber: string }>> {
  if (ids.length === 0) return new Map();
  const profiles = await ProfileModel.find({ user: { $in: ids } }).lean<
    { user: Types.ObjectId; fullName: string; rollNumber: string }[]
  >();
  return new Map(
    profiles.map((p) => [
      p.user.toString(),
      { fullName: p.fullName, rollNumber: p.rollNumber },
    ]),
  );
}

export async function listAttemptCounters(examId: string): Promise<{
  examId: string;
  examTitle: string;
  items: {
    userId: string;
    student: string;
    rollNumber: string;
    attemptCount: number;
    maxAttempts: number;
    exhausted: boolean;
  }[];
}> {
  const exam = await requireExamDoc(examId);
  const counters = await ExamAttemptCounterModel.find({ exam: exam._id })
    .sort({ updatedAt: -1 })
    .lean<
      {
        user: Types.ObjectId;
        attemptCount: number;
        maxAttempts: number;
      }[]
    >();
  const names = await nameByUser(counters.map((c) => c.user));
  return {
    examId: exam._id.toString(),
    examTitle: exam.title,
    items: counters.map((c) => {
      const p = names.get(c.user.toString());
      return {
        userId: c.user.toString(),
        student: p?.fullName ?? "(unknown)",
        rollNumber: p?.rollNumber ?? "",
        attemptCount: c.attemptCount,
        maxAttempts: c.maxAttempts,
        exhausted: c.attemptCount >= c.maxAttempts,
      };
    }),
  };
}

export async function getUserExamAttempts(
  examId: string,
  userId: string,
): Promise<{
  examId: string;
  examTitle: string;
  userId: string;
  student: string;
  counter: { attemptCount: number; maxAttempts: number } | null;
  attempts: {
    attemptId: string;
    status: string;
    score: number;
    passed: boolean;
    warnings: number;
    isMalpractice: boolean;
    startedAt: string | null;
    completedAt: string | null;
  }[];
}> {
  const exam = await requireExamDoc(examId);
  if (!Types.ObjectId.isValid(userId)) {
    throw new AppError("User not found", 404, ExamErrorCode.EXAM_NOT_FOUND);
  }
  const uid = new Types.ObjectId(userId);
  const [attempts, counter, names] = await Promise.all([
    StudentExamAttemptModel.find({ exam: exam._id, user: uid })
      .sort({ startedAt: -1, createdAt: -1 })
      .lean<
        {
          _id: Types.ObjectId;
          status: string;
          score: number;
          passed: boolean;
          warningsTriggered: number;
          isMalpractice: boolean;
          startedAt?: Date;
          completedAt?: Date;
        }[]
      >(),
    ExamAttemptCounterModel.findOne({ exam: exam._id, user: uid }).lean<{
      attemptCount: number;
      maxAttempts: number;
    } | null>(),
    nameByUser([uid]),
  ]);
  return {
    examId: exam._id.toString(),
    examTitle: exam.title,
    userId,
    student: names.get(userId)?.fullName ?? "(unknown)",
    counter: counter
      ? { attemptCount: counter.attemptCount, maxAttempts: counter.maxAttempts }
      : null,
    attempts: attempts.map((a) => ({
      attemptId: a._id.toString(),
      status: a.status,
      score: a.score,
      passed: a.passed,
      warnings: a.warningsTriggered,
      isMalpractice: a.isMalpractice,
      startedAt: iso(a.startedAt),
      completedAt: iso(a.completedAt),
    })),
  };
}

export async function listResetLog(examId: string): Promise<{
  examId: string;
  examTitle: string;
  items: {
    id: string;
    student: string;
    resetBy: string;
    previousCount: number;
    reason: string;
    resetAt: string;
  }[];
}> {
  const exam = await requireExamDoc(examId);
  const logs = await ExamAttemptResetLogModel.find({ exam: exam._id })
    .sort({ resetAt: -1 })
    .lean<
      {
        _id: Types.ObjectId;
        user: Types.ObjectId;
        resetBy: Types.ObjectId;
        previousCount: number;
        reason: string;
        resetAt: Date;
      }[]
    >();
  const names = await nameByUser(logs.flatMap((l) => [l.user, l.resetBy]));
  return {
    examId: exam._id.toString(),
    examTitle: exam.title,
    items: logs.map((l) => ({
      id: l._id.toString(),
      student: names.get(l.user.toString())?.fullName ?? "(unknown)",
      resetBy: names.get(l.resetBy.toString())?.fullName ?? "(admin)",
      previousCount: l.previousCount,
      reason: l.reason,
      resetAt: new Date(l.resetAt).toISOString(),
    })),
  };
}
