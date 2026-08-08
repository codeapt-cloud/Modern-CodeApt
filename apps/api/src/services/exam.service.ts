/**
 * Exam engine — server-authoritative attempt lifecycle + grading.
 *
 * Timing: `sectionStartTime` + `section.durationMinutes` are the only source of
 * truth for remaining time (client time is never trusted). Grading: MCQ inline
 * (strict / set-equality), CODE via the Step-6 `assessment` queue with the
 * question's HIDDEN test cases attached server-side; scoring is finalized
 * idempotently once every code job is terminal (guarded by an atomic
 * status transition, like the Step-7 award pattern). Answers, correctOptions,
 * and test cases never appear in any candidate-facing projection.
 */
import { randomUUID } from "node:crypto";

import {
  ExamAttemptStatus,
  ExamErrorCode,
  ExamQuestionType,
  EXAM_MAX_WARNINGS,
  JobStatus,
  QueueName,
  gradeMcq,
  isPassing,
  isSectionExpired,
  proportionalCodeMarks,
  sectionRemainingSeconds,
  type AnswerInput,
  type AttemptSectionView,
  type CodeExecutionJob,
  type CodeLanguage,
  type ExamResult,
  type ExecutionResult,
  type QuestionResult,
  type SanitizedQuestion,
  type SavedAnswer,
  type SectionResult,
  type StartAttemptResponse,
} from "@codeapt/shared";
import { Types, type HydratedDocument } from "mongoose";

import { AppError } from "../errors/app-error.js";
import { enqueueCodeJob } from "../lib/execution-queue.js";
import { resolveExamDisplayTitle } from "../lib/exam-title.js";
import {
  ExamModel,
  ExamQuestionModel,
  ExamSectionModel,
  ExamTestCaseModel,
  ExamAttemptCounterModel,
  StudentExamAttemptModel,
  type Exam,
  type ExamQuestion,
  type ExamSection,
  type StudentExamAttempt,
} from "../models/assessment.model.js";
import { ExecutionJobModel } from "../models/execution.model.js";

type AttemptDoc = HydratedDocument<StudentExamAttempt>;
type ExamDoc = HydratedDocument<Exam>;
type SectionDoc = HydratedDocument<ExamSection>;
type QuestionDoc = HydratedDocument<ExamQuestion>;

// --- responseData shape (Mixed on the model) --------------------------------

interface StoredAnswer {
  selectedOptions?: number[];
  code?: string;
  language?: CodeLanguage;
}
interface ResponseData {
  answers: Record<string, StoredAnswer>;
  finishedSections: string[];
  codeJobs: Record<string, string>; // questionId -> jobId
  /** Question ids flagged for review by the candidate (across sections). */
  markedForReview: string[];
  breakdown?: SectionResult[];
}

function readResponseData(attempt: AttemptDoc): ResponseData {
  const raw = (attempt.responseData ?? {}) as Partial<ResponseData>;
  return {
    answers: raw.answers ?? {},
    finishedSections: raw.finishedSections ?? [],
    codeJobs: raw.codeJobs ?? {},
    markedForReview: raw.markedForReview ?? [],
    breakdown: raw.breakdown,
  };
}

// --- Loading + authorization ------------------------------------------------

interface Caller {
  userId?: string;
  token?: string;
}

async function loadAndAuthorize(
  attemptId: string,
  caller: Caller,
): Promise<AttemptDoc> {
  if (!Types.ObjectId.isValid(attemptId)) {
    throw new AppError(
      "Attempt not found",
      404,
      ExamErrorCode.ATTEMPT_NOT_FOUND,
    );
  }
  const attempt = await StudentExamAttemptModel.findById(attemptId);
  if (!attempt) {
    throw new AppError(
      "Attempt not found",
      404,
      ExamErrorCode.ATTEMPT_NOT_FOUND,
    );
  }
  const tokenOk = !!caller.token && caller.token === attempt.attemptToken;
  const ownerOk =
    !!caller.userId &&
    attempt.user != null &&
    attempt.user.toString() === caller.userId;
  if (!tokenOk && !ownerOk) {
    throw new AppError(
      "You are not authorized for this attempt",
      403,
      ExamErrorCode.NOT_AUTHORIZED,
    );
  }
  return attempt;
}

// --- Section helpers --------------------------------------------------------

async function loadSections(examId: Types.ObjectId): Promise<SectionDoc[]> {
  return ExamSectionModel.find({ exam: examId }).sort({ order: 1, _id: 1 });
}

function sanitizeQuestion(
  q: QuestionDoc,
  saved: StoredAnswer | undefined,
  visibleCases: { input: string; expectedOutput: string }[],
): SanitizedQuestion {
  const isCode = q.questionType === ExamQuestionType.CODE;
  const savedAnswer: SavedAnswer | null = saved
    ? {
        selectedOptions: saved.selectedOptions ?? null,
        code: saved.code ?? null,
        language: saved.language ?? null,
      }
    : null;
  return {
    id: q._id.toString(),
    type: q.questionType as ExamQuestionType,
    text: q.text,
    order: q.order,
    marks: q.marks,
    image: q.image,
    // MCQ options WITHOUT correctOptions; null for CODE.
    options: isCode ? null : (q.options ?? []),
    starterCode: isCode ? q.starterCode : null,
    language: isCode ? (q.language as CodeLanguage) : null,
    // Language policy: [] = open, [lang] = locked. Empty for MCQ.
    allowedLanguages: isCode
      ? ((q.allowedLanguages ?? []) as CodeLanguage[])
      : [],
    sampleCases: isCode ? visibleCases : null,
    savedAnswer,
  };
}

async function buildSectionView(
  attempt: AttemptDoc,
  exam: ExamDoc,
  sections: SectionDoc[],
  sectionIndex: number,
  now: Date,
): Promise<AttemptSectionView> {
  const section = sections[sectionIndex];
  if (!section) {
    throw new AppError("Section not found", 404, ExamErrorCode.EXAM_NOT_FOUND);
  }
  const data = readResponseData(attempt);
  const questions = await ExamQuestionModel.find({ section: section._id }).sort(
    {
      order: 1,
      _id: 1,
    },
  );
  // Visible (non-hidden) sample cases for the CODE questions in this section.
  const codeIds = questions
    .filter((q) => q.questionType === ExamQuestionType.CODE)
    .map((q) => q._id);
  const visibleByQ = new Map<
    string,
    { input: string; expectedOutput: string }[]
  >();
  if (codeIds.length > 0) {
    const cases = await ExamTestCaseModel.find({
      question: { $in: codeIds },
      isHidden: false,
    }).sort({ order: 1, _id: 1 });
    for (const c of cases) {
      const key = c.question.toString();
      const list = visibleByQ.get(key) ?? [];
      list.push({ input: c.inputData, expectedOutput: c.expectedOutput });
      visibleByQ.set(key, list);
    }
  }

  const remaining = attempt.sectionStartTime
    ? sectionRemainingSeconds(
        attempt.sectionStartTime,
        section.durationMinutes,
        now,
      )
    : section.durationMinutes * 60;

  return {
    attemptId: attempt._id.toString(),
    status: attempt.status as ExamAttemptStatus,
    examId: exam._id.toString(),
    examTitle: await resolveExamDisplayTitle(exam),
    calculatorEnabled: exam.calculatorEnabled,
    sectionIndex,
    totalSections: sections.length,
    section: {
      id: section._id.toString(),
      name: section.name,
      order: section.order,
      description: section.description,
      durationMinutes: section.durationMinutes,
    },
    sectionRemainingSeconds: remaining,
    questions: questions.map((q) =>
      sanitizeQuestion(
        q,
        data.answers[q._id.toString()],
        visibleByQ.get(q._id.toString()) ?? [],
      ),
    ),
    // Only this section's marked ids (the navigator shows one section at a time).
    markedForReview: data.markedForReview.filter((id) =>
      questions.some((q) => q._id.toString() === id),
    ),
  };
}

function currentSectionIndex(
  attempt: AttemptDoc,
  sections: SectionDoc[],
): number {
  if (!attempt.currentSection) return 0;
  const id = attempt.currentSection.toString();
  const idx = sections.findIndex((s) => s._id.toString() === id);
  return idx < 0 ? 0 : idx;
}

// --- Attempt lifecycle ------------------------------------------------------

export async function startAttempt(
  userId: string,
  examId: string,
): Promise<StartAttemptResponse> {
  const exam = await requireExam(examId);
  const sections = await loadSections(exam._id);
  if (sections.length === 0) {
    throw new AppError(
      "Exam has no sections",
      400,
      ExamErrorCode.EXAM_NOT_FOUND,
    );
  }

  // Attempt-limit enforcement (per user+exam).
  const counter = await ExamAttemptCounterModel.findOneAndUpdate(
    { user: userId, exam: exam._id },
    { $setOnInsert: { attemptCount: 0, maxAttempts: 1 } },
    { upsert: true, new: true },
  );
  if (counter.attemptCount >= counter.maxAttempts) {
    throw new AppError(
      "You have reached the attempt limit for this exam",
      409,
      ExamErrorCode.ATTEMPT_LIMIT_REACHED,
    );
  }
  counter.attemptCount += 1;
  await counter.save();

  const attempt = await createAttempt(exam, sections[0]!, {
    user: new Types.ObjectId(userId),
  });
  const view = await buildSectionView(attempt, exam, sections, 0, new Date());
  return { ...view, attemptToken: attempt.attemptToken };
}

interface CreateAttemptExtra {
  user?: Types.ObjectId | null;
  publicLink?: Types.ObjectId;
  rollNumber?: string;
  collegeName?: string;
}
async function createAttempt(
  exam: ExamDoc,
  firstSection: SectionDoc,
  extra: CreateAttemptExtra,
): Promise<AttemptDoc> {
  const init: ResponseData = {
    answers: {},
    finishedSections: [],
    codeJobs: {},
    markedForReview: [],
  };
  return StudentExamAttemptModel.create({
    exam: exam._id,
    // Copy the exam's tenant onto the attempt (null for individual/global
    // exams — unchanged) so a college's attempt data is tenant-isolated.
    college: exam.college ?? null,
    user: extra.user ?? null,
    publicLink: extra.publicLink,
    rollNumber: extra.rollNumber ?? "",
    collegeName: extra.collegeName ?? "",
    attemptToken: randomUUID(),
    status: ExamAttemptStatus.IN_PROGRESS,
    currentSection: firstSection._id,
    sectionStartTime: new Date(),
    responseData: init,
    startedAt: new Date(),
  });
}

export async function getCurrentSection(
  attemptId: string,
  caller: Caller,
): Promise<AttemptSectionView> {
  const attempt = await loadAndAuthorize(attemptId, caller);
  const exam = await requireExam(attempt.exam.toString());
  const sections = await loadSections(exam._id);
  const idx = currentSectionIndex(attempt, sections);
  return buildSectionView(attempt, exam, sections, idx, new Date());
}

export async function saveAnswers(
  attemptId: string,
  caller: Caller,
  answers: AnswerInput[],
  markedForReview?: string[],
): Promise<{ saved: number; sectionRemainingSeconds: number }> {
  const attempt = await loadAndAuthorize(attemptId, caller);
  requireInProgress(attempt);
  const exam = await requireExam(attempt.exam.toString());
  const sections = await loadSections(exam._id);
  const idx = currentSectionIndex(attempt, sections);
  const section = sections[idx]!;
  const now = new Date();

  if (
    attempt.sectionStartTime &&
    isSectionExpired(attempt.sectionStartTime, section.durationMinutes, now)
  ) {
    throw new AppError(
      "This section's time has expired",
      409,
      ExamErrorCode.SECTION_EXPIRED,
    );
  }

  // Only accept answers for questions that belong to the CURRENT section.
  const sectionQuestionIds = new Set(
    (await ExamQuestionModel.find({ section: section._id }).select("_id")).map(
      (q) => q._id.toString(),
    ),
  );
  const data = readResponseData(attempt);
  let saved = 0;
  for (const a of answers) {
    if (!sectionQuestionIds.has(a.questionId)) continue;
    const entry: StoredAnswer = {};
    if (a.selectedOptions) entry.selectedOptions = a.selectedOptions;
    if (a.code !== undefined) entry.code = a.code;
    if (a.language) entry.language = a.language;
    data.answers[a.questionId] = entry;
    saved += 1;
  }

  // Marked-for-review (optional): the client sends the CURRENT section's marked
  // ids. Merge = keep other sections' marks + replace this section's set. Only
  // ids that belong to this section are accepted (mirrors the answer guard).
  if (markedForReview) {
    const others = data.markedForReview.filter(
      (id) => !sectionQuestionIds.has(id),
    );
    const thisSection = markedForReview.filter((id) =>
      sectionQuestionIds.has(id),
    );
    data.markedForReview = [...others, ...new Set(thisSection)];
  }

  attempt.responseData = data;
  attempt.markModified("responseData");
  await attempt.save();

  return {
    saved,
    sectionRemainingSeconds: sectionRemainingSeconds(
      attempt.sectionStartTime!,
      section.durationMinutes,
      now,
    ),
  };
}

export async function advanceSection(
  attemptId: string,
  caller: Caller,
): Promise<AttemptSectionView> {
  const attempt = await loadAndAuthorize(attemptId, caller);
  requireInProgress(attempt);
  const exam = await requireExam(attempt.exam.toString());
  const sections = await loadSections(exam._id);
  const idx = currentSectionIndex(attempt, sections);
  const next = sections[idx + 1];
  if (!next) {
    throw new AppError(
      "There is no next section — submit the exam instead",
      400,
      ExamErrorCode.NO_NEXT_SECTION,
    );
  }
  // Lock the finished section (server enforces no return) + reset the clock.
  const data = readResponseData(attempt);
  const finishedId = sections[idx]!._id.toString();
  if (!data.finishedSections.includes(finishedId)) {
    data.finishedSections.push(finishedId);
  }
  attempt.responseData = data;
  attempt.markModified("responseData");
  attempt.currentSection = next._id;
  attempt.sectionStartTime = new Date();
  await attempt.save();

  return buildSectionView(attempt, exam, sections, idx + 1, new Date());
}

export async function recordWarning(
  attemptId: string,
  caller: Caller,
): Promise<{
  warningsTriggered: number;
  isMalpractice: boolean;
  autoSubmitted: boolean;
}> {
  const attempt = await loadAndAuthorize(attemptId, caller);

  // Once the attempt is terminal (already auto-submitted or submitted) don't
  // keep counting — report the frozen state so the client ends the exam.
  if (attempt.status !== ExamAttemptStatus.IN_PROGRESS) {
    return {
      warningsTriggered: attempt.warningsTriggered,
      isMalpractice: attempt.isMalpractice,
      autoSubmitted: true,
    };
  }

  attempt.warningsTriggered += 1;
  attempt.isMalpractice = attempt.warningsTriggered > EXAM_MAX_WARNINGS;
  await attempt.save();

  // Crossing the limit into malpractice force-submits the attempt through the
  // EXISTING submit pipeline (auto-submitted + malpractice already persisted).
  // submitAttempt is idempotent, so a race just returns the same result.
  if (attempt.isMalpractice) {
    await submitAttempt(attemptId, caller, true);
    return {
      warningsTriggered: attempt.warningsTriggered,
      isMalpractice: true,
      autoSubmitted: true,
    };
  }

  return {
    warningsTriggered: attempt.warningsTriggered,
    isMalpractice: attempt.isMalpractice,
    autoSubmitted: false,
  };
}

// --- Submit + grade ---------------------------------------------------------

export async function submitAttempt(
  attemptId: string,
  caller: Caller,
  auto: boolean,
): Promise<ExamResult> {
  const attempt = await loadAndAuthorize(attemptId, caller);
  const exam = await requireExam(attempt.exam.toString());

  // Idempotent: a resubmit just returns the current result/status.
  if (attempt.status !== ExamAttemptStatus.IN_PROGRESS) {
    return finalizeAttempt(attemptId, caller);
  }

  const sections = await loadSections(exam._id);
  const questions = await ExamQuestionModel.find({ exam: exam._id });
  const data = readResponseData(attempt);

  // Auto-submit if triggered by the client OR the current section expired.
  const idx = currentSectionIndex(attempt, sections);
  const section = sections[idx];
  const expired =
    !!attempt.sectionStartTime &&
    !!section &&
    isSectionExpired(
      attempt.sectionStartTime,
      section.durationMinutes,
      new Date(),
    );

  // Enqueue CODE grading jobs (assessment queue) for non-empty code answers.
  const codeJobs: Record<string, string> = {};
  for (const q of questions) {
    if (q.questionType !== ExamQuestionType.CODE) continue;
    const answer = data.answers[q._id.toString()];
    if (!answer?.code || answer.code.trim().length === 0) continue;
    const cases = await ExamTestCaseModel.find({ question: q._id }).sort({
      order: 1,
      _id: 1,
    });
    if (cases.length === 0) continue;
    const jobId = randomUUID();
    await ExecutionJobModel.create({
      jobId,
      user: attempt.user ?? null,
      submissionRef: `exam:${attempt._id.toString()}:${q._id.toString()}`,
      queue: QueueName.ASSESSMENT,
      status: JobStatus.QUEUED,
    });
    const payload: CodeExecutionJob = {
      jobId,
      submissionRef: `exam:${q._id.toString()}`,
      language: (answer.language ?? q.language) as CodeLanguage,
      source: answer.code,
      testCases: cases.map((c) => ({
        input: c.inputData,
        expectedOutput: c.expectedOutput,
      })),
    };
    await enqueueCodeJob(QueueName.ASSESSMENT, payload);
    codeJobs[q._id.toString()] = jobId;
  }

  data.codeJobs = codeJobs;
  attempt.responseData = data;
  attempt.markModified("responseData");
  attempt.status = ExamAttemptStatus.SUBMITTED;
  attempt.isAutoSubmitted = auto || expired;
  attempt.completedAt = new Date();
  await attempt.save();

  // No code jobs → grade immediately.
  return finalizeAttempt(attemptId, caller);
}

/**
 * Finalize scoring once all CODE jobs are terminal. Idempotent: an atomic
 * SUBMITTED→GRADED transition means only the first caller writes the score;
 * concurrent/repeat finalizes return the stored result.
 */
export async function finalizeAttempt(
  attemptId: string,
  caller: Caller,
): Promise<ExamResult> {
  const attempt = await loadAndAuthorize(attemptId, caller);
  const exam = await requireExam(attempt.exam.toString());

  if (attempt.status === ExamAttemptStatus.IN_PROGRESS) {
    throw new AppError(
      "Attempt has not been submitted",
      409,
      ExamErrorCode.ALREADY_SUBMITTED,
    );
  }
  if (attempt.status === ExamAttemptStatus.GRADED) {
    return buildResult(
      attempt,
      exam,
      readResponseData(attempt).breakdown ?? [],
    );
  }

  // status === SUBMITTED — check code jobs.
  const data = readResponseData(attempt);
  const jobIds = Object.values(data.codeJobs);
  const jobs = jobIds.length
    ? await ExecutionJobModel.find({ jobId: { $in: jobIds } })
    : [];
  const jobByQuestion = new Map<string, (typeof jobs)[number]>();
  for (const [qid, jobId] of Object.entries(data.codeJobs)) {
    const job = jobs.find((j) => j.jobId === jobId);
    if (job) jobByQuestion.set(qid, job);
  }
  const anyPending = [...jobByQuestion.values()].some(
    (j) => j.status === JobStatus.QUEUED || j.status === JobStatus.PROCESSING,
  );
  if (anyPending) {
    // Not ready — report pending without grading.
    return pendingResult(attempt, exam);
  }

  // All terminal — compute the full breakdown.
  const sections = await loadSections(exam._id);
  const questions = await ExamQuestionModel.find({ exam: exam._id });
  const questionsBySection = new Map<string, QuestionDoc[]>();
  for (const q of questions) {
    const key = q.section.toString();
    const list = questionsBySection.get(key) ?? [];
    list.push(q);
    questionsBySection.set(key, list);
  }

  const breakdown: SectionResult[] = sections.map((section) => {
    const qs = (questionsBySection.get(section._id.toString()) ?? []).sort(
      (a, b) => a.order - b.order,
    );
    const questionResults = qs.map((q) =>
      gradeQuestion(
        q,
        data.answers[q._id.toString()],
        jobByQuestion.get(q._id.toString()),
      ),
    );
    return {
      sectionId: section._id.toString(),
      name: section.name,
      score: questionResults.reduce((s, r) => s + r.awardedMarks, 0),
      maxScore: qs.reduce((s, q) => s + q.marks, 0),
      questions: questionResults,
    };
  });

  const score = breakdown.reduce((s, sec) => s + sec.score, 0);
  const totalMarks = breakdown.reduce((s, sec) => s + sec.maxScore, 0);
  const passed = isPassing(score, totalMarks, exam.passPercentage);

  // Atomic SUBMITTED→GRADED — only the first writer persists.
  const claimed = await StudentExamAttemptModel.findOneAndUpdate(
    { _id: attempt._id, status: ExamAttemptStatus.SUBMITTED },
    {
      $set: {
        status: ExamAttemptStatus.GRADED,
        score,
        passed,
        "responseData.breakdown": breakdown,
      },
    },
    { new: true },
  );
  const fresh =
    claimed ?? (await StudentExamAttemptModel.findById(attempt._id))!;
  return buildResult(
    fresh,
    exam,
    readResponseData(fresh).breakdown ?? breakdown,
  );
}

interface JobLike {
  status: string;
  result?: unknown;
  error?: string | null;
}
function gradeQuestion(
  q: QuestionDoc,
  answer: StoredAnswer | undefined,
  job: JobLike | undefined,
): QuestionResult {
  const base = {
    questionId: q._id.toString(),
    type: q.questionType as ExamQuestionType,
    text: q.text,
    maxMarks: q.marks,
  };

  if (q.questionType === ExamQuestionType.CODE) {
    if (!answer?.code) {
      return {
        ...base,
        awardedMarks: 0,
        selectedOptions: null,
        correctOptions: null,
        code: null,
        testsPassed: null,
        testsTotal: null,
        note: "No submission",
      };
    }
    // No job (or a failed/errored one) → 0 with a clear note.
    if (!job || job.status !== JobStatus.COMPLETED) {
      return {
        ...base,
        awardedMarks: 0,
        selectedOptions: null,
        correctOptions: null,
        code: answer.code,
        testsPassed: 0,
        testsTotal: null,
        note:
          job?.status === JobStatus.FAILED
            ? `Execution failed: ${job.error ?? "unknown error"}`
            : "Not graded (execution unavailable)",
      };
    }
    const result = job.result as ExecutionResult | null;
    const passed = result?.passedCount ?? 0;
    const total = result?.totalCount ?? 0;
    return {
      ...base,
      awardedMarks: proportionalCodeMarks(passed, total, q.marks),
      selectedOptions: null,
      correctOptions: null,
      code: answer.code,
      testsPassed: passed,
      testsTotal: total,
      note: null,
    };
  }

  // MCQ.
  const selected = answer?.selectedOptions ?? [];
  const correct = q.correctOptions ?? [];
  const correctAns = gradeMcq(
    q.questionType as ExamQuestionType,
    selected,
    correct,
  );
  return {
    ...base,
    awardedMarks: correctAns ? q.marks : 0,
    selectedOptions: selected,
    correctOptions: correct,
    code: null,
    testsPassed: null,
    testsTotal: null,
    note: null,
  };
}

function buildResult(
  attempt: AttemptDoc,
  exam: ExamDoc,
  breakdown: SectionResult[],
): ExamResult {
  const totalMarks = breakdown.reduce((s, sec) => s + sec.maxScore, 0);
  return {
    attemptId: attempt._id.toString(),
    status: attempt.status as ExamAttemptStatus,
    score: attempt.score,
    totalMarks,
    passPercentage: exam.passPercentage,
    passed: attempt.passed,
    autoSubmitted: attempt.isAutoSubmitted,
    warnings: attempt.warningsTriggered,
    isMalpractice: attempt.isMalpractice,
    gradingPending: false,
    sections: breakdown,
  };
}

function pendingResult(attempt: AttemptDoc, exam: ExamDoc): ExamResult {
  return {
    attemptId: attempt._id.toString(),
    status: attempt.status as ExamAttemptStatus,
    score: 0,
    totalMarks: exam.totalMarks,
    passPercentage: exam.passPercentage,
    passed: false,
    autoSubmitted: attempt.isAutoSubmitted,
    warnings: attempt.warningsTriggered,
    isMalpractice: attempt.isMalpractice,
    gradingPending: true,
    sections: null,
  };
}

export async function getResult(
  attemptId: string,
  caller: Caller,
): Promise<ExamResult> {
  return finalizeAttempt(attemptId, caller);
}

// --- Shared guards ----------------------------------------------------------

async function requireExam(examId: string): Promise<ExamDoc> {
  if (!Types.ObjectId.isValid(examId)) {
    throw new AppError("Exam not found", 404, ExamErrorCode.EXAM_NOT_FOUND);
  }
  const exam = await ExamModel.findById(examId);
  if (!exam) {
    throw new AppError("Exam not found", 404, ExamErrorCode.EXAM_NOT_FOUND);
  }
  return exam;
}

function requireInProgress(attempt: AttemptDoc): void {
  if (attempt.status !== ExamAttemptStatus.IN_PROGRESS) {
    throw new AppError(
      "This attempt is already submitted",
      409,
      ExamErrorCode.ALREADY_SUBMITTED,
    );
  }
}

// Re-exported model handles used by other services (public/admin).
export { createAttempt, buildSectionView, loadSections, requireExam };
