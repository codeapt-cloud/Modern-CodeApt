/**
 * Daily-challenge ADMIN service — CRUD over DailyQuestion (+ its DailyTestCases)
 * and Excel bulk import with auto-scheduling. Mirrors the coupon/essay-topic
 * admin pattern (thin, zod-validated writes behind requireAdmin; AppError
 * envelope) and the curriculum bulk-upload pattern (base64 → ExcelJS → per-row
 * partial-success report; one bad row never aborts the import).
 *
 * Scheduling: `releaseDate` is a UNIQUE one-per-IST-day slot. A day key is
 * normalized to the IST-midnight instant the serving query matches (the same
 * canonical value the seed writes). Bulk import supports BOTH modes — sequential
 * from a `startDate` (row order → consecutive days) or an explicit per-row
 * `date` column. A date already taken (in the DB or earlier in the sheet) is
 * reported per-row and SKIPPED — never overwritten.
 *
 * Delete: challenges have no active flag, so the reference-safe guard is to
 * BLOCK hard-delete when scored DailySubmissions reference the question (409
 * DELETE_BLOCKED, details.blockers = { submissions }) — never destroy student
 * scores / streak history. With no submissions, the question and its OWNED
 * children (DailyTestCases + transient ChallengeCodeAttempt job-links) are
 * removed. Rescheduling is editing the release date.
 */
import {
  ChallengeErrorCode,
  DailyChallengeSource,
  DailyQuestionType,
  istDayKey,
  istDayRangeUtc,
  nextDayKey,
  type AdminChallenge,
  type AdminChallengeBulkImportResponse,
  type AdminChallengeListResponse,
  type AdminChallengeTestCase,
  type AdminChallengeUpsert,
  type CodeLanguage,
  adminChallengeUpsertSchema,
} from "@codeapt/shared";
import { Types, type HydratedDocument } from "mongoose";

import { AppError } from "../errors/app-error.js";
import {
  ChallengeCodeAttemptModel,
  DailyQuestionModel,
  DailySubmissionModel,
  DailyTestCaseModel,
  type DailyQuestion,
} from "../models/challenge.model.js";
import {
  parseChallengeWorkbook,
  type RawChallengeRow,
} from "../lib/challenge-excel.js";

type QuestionDoc = HydratedDocument<DailyQuestion>;

function objectId(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) {
    throw new AppError(
      "Challenge not found",
      404,
      ChallengeErrorCode.QUESTION_NOT_FOUND,
    );
  }
  return new Types.ObjectId(id);
}

async function loadQuestion(id: string): Promise<QuestionDoc> {
  const question = await DailyQuestionModel.findById(objectId(id));
  if (!question) {
    throw new AppError(
      "Challenge not found",
      404,
      ChallengeErrorCode.QUESTION_NOT_FOUND,
    );
  }
  return question;
}

/** The IST-midnight instant (UTC) a day key schedules on — matches serving. */
function dayKeyToReleaseDate(dayKey: string): Date {
  return istDayRangeUtc(dayKey).start;
}

/** Group-count DailySubmissions by question → Map<questionId, count>. */
async function submissionCountsByQuestion(): Promise<Map<string, number>> {
  const rows = await DailySubmissionModel.aggregate<{
    _id: Types.ObjectId;
    c: number;
  }>([{ $group: { _id: "$question", c: { $sum: 1 } } }]);
  return new Map(rows.map((r) => [r._id.toString(), r.c]));
}

async function testCaseCountsByQuestion(): Promise<Map<string, number>> {
  const rows = await DailyTestCaseModel.aggregate<{
    _id: Types.ObjectId;
    c: number;
  }>([{ $group: { _id: "$question", c: { $sum: 1 } } }]);
  return new Map(rows.map((r) => [r._id.toString(), r.c]));
}

async function loadTestCases(
  questionId: Types.ObjectId,
): Promise<AdminChallengeTestCase[]> {
  const cases = await DailyTestCaseModel.find({ question: questionId }).sort({
    _id: 1,
  });
  return cases.map((c) => ({
    input: c.inputData,
    expectedOutput: c.expectedOutput,
    isHidden: c.isHidden,
  }));
}

function toAdminChallenge(
  q: QuestionDoc,
  testCases: AdminChallengeTestCase[],
  submissionCount: number,
): AdminChallenge {
  return {
    id: q._id.toString(),
    questionType: q.questionType as DailyQuestionType,
    releaseDate: istDayKey(q.releaseDate),
    title: q.title,
    description: q.description,
    marks: q.marks,
    options: q.options ?? [],
    correctOption: q.correctOption ?? 0,
    starterCode: q.starterCode,
    language: q.language as CodeLanguage,
    testCases,
    submissionCount,
    source: (q.source as DailyChallengeSource) ?? DailyChallengeSource.MANUAL,
    generatedAt: q.generatedAt ? q.generatedAt.toISOString() : null,
    validationNote: q.validationNote ?? "",
  };
}

/**
 * Assert no OTHER question already occupies `releaseDate`. `exceptId` skips the
 * question being updated (so re-saving its own date is fine).
 */
async function assertDateFree(
  releaseDate: Date,
  exceptId?: Types.ObjectId,
): Promise<void> {
  const clash = await DailyQuestionModel.findOne({
    releaseDate,
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
  });
  if (clash) {
    throw new AppError(
      `A challenge is already scheduled on ${istDayKey(releaseDate)}`,
      409,
      ChallengeErrorCode.DATE_TAKEN,
    );
  }
}

/** Type-specific field set + rebuilt test cases from a validated payload. */
async function applyQuestion(
  question: QuestionDoc,
  input: AdminChallengeUpsert,
): Promise<void> {
  question.questionType = input.questionType;
  question.releaseDate = dayKeyToReleaseDate(input.releaseDate);
  question.title = input.title.trim();
  question.description = input.description;
  question.marks = input.marks;

  if (input.questionType === DailyQuestionType.MCQ) {
    question.options = input.options;
    question.correctOption = input.correctOption;
    question.starterCode = "";
  } else {
    question.options = undefined;
    question.correctOption = undefined;
    question.starterCode = input.starterCode;
    question.language = input.language;
  }
  await question.save();

  // Rebuild owned test cases (CODE only).
  await DailyTestCaseModel.deleteMany({ question: question._id });
  if (input.questionType === DailyQuestionType.CODE && input.testCases.length) {
    await DailyTestCaseModel.insertMany(
      input.testCases.map((c) => ({
        question: question._id,
        inputData: c.input,
        expectedOutput: c.expectedOutput,
        isHidden: c.isHidden,
      })),
    );
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listChallengesAdmin(): Promise<AdminChallengeListResponse> {
  const questions = await DailyQuestionModel.find().sort({ releaseDate: -1 });
  const [submissionCounts, testCaseCounts] = await Promise.all([
    submissionCountsByQuestion(),
    testCaseCountsByQuestion(),
  ]);
  return {
    items: questions.map((q) => ({
      id: q._id.toString(),
      questionType: q.questionType as DailyQuestionType,
      releaseDate: istDayKey(q.releaseDate),
      title: q.title,
      marks: q.marks,
      testCaseCount: testCaseCounts.get(q._id.toString()) ?? 0,
      submissionCount: submissionCounts.get(q._id.toString()) ?? 0,
      source: (q.source as DailyChallengeSource) ?? DailyChallengeSource.MANUAL,
      generatedAt: q.generatedAt ? q.generatedAt.toISOString() : null,
    })),
  };
}

export async function getChallengeAdmin(id: string): Promise<AdminChallenge> {
  const question = await loadQuestion(id);
  const [testCases, submissionCount] = await Promise.all([
    loadTestCases(question._id),
    DailySubmissionModel.countDocuments({ question: question._id }),
  ]);
  return toAdminChallenge(question, testCases, submissionCount);
}

export async function createChallenge(
  input: AdminChallengeUpsert,
): Promise<AdminChallenge> {
  await assertDateFree(dayKeyToReleaseDate(input.releaseDate));
  const question = new DailyQuestionModel();
  await applyQuestion(question, input);
  const testCases = await loadTestCases(question._id);
  return toAdminChallenge(question, testCases, 0);
}

export async function updateChallenge(
  id: string,
  input: AdminChallengeUpsert,
): Promise<AdminChallenge> {
  const question = await loadQuestion(id);
  await assertDateFree(dayKeyToReleaseDate(input.releaseDate), question._id);
  await applyQuestion(question, input);
  const [testCases, submissionCount] = await Promise.all([
    loadTestCases(question._id),
    DailySubmissionModel.countDocuments({ question: question._id }),
  ]);
  return toAdminChallenge(question, testCases, submissionCount);
}

export async function deleteChallenge(
  id: string,
): Promise<{ deleted: true }> {
  const question = await loadQuestion(id);
  const submissions = await DailySubmissionModel.countDocuments({
    question: question._id,
  });
  if (submissions > 0) {
    throw new AppError(
      `Cannot delete "${question.title}" — students have submitted against it. ` +
        `Reschedule it (edit the date) instead of destroying their scores.`,
      409,
      ChallengeErrorCode.DELETE_BLOCKED,
      { blockers: { submissions } },
    );
  }
  // No scored submissions → safe to remove the question and its owned children.
  await DailyTestCaseModel.deleteMany({ question: question._id });
  await ChallengeCodeAttemptModel.deleteMany({ question: question._id });
  await DailyQuestionModel.deleteOne({ _id: question._id });
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Excel bulk import (auto-scheduling)
// ---------------------------------------------------------------------------

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse the `options` cell — pipe- or newline-separated, trimmed, non-empty. */
function parseOptions(raw: string): string[] {
  return raw
    .split(/[\n|]/)
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

/**
 * Parse the `cases` cell into test cases. One case per line, `input=>expected`;
 * a leading `*` marks the case hidden.
 */
function parseCases(raw: string): AdminChallengeTestCase[] {
  const out: AdminChallengeTestCase[] = [];
  for (const line of raw.split("\n")) {
    let text = line.trim();
    if (!text) continue;
    let isHidden = false;
    if (text.startsWith("*")) {
      isHidden = true;
      text = text.slice(1).trim();
    }
    const sep = text.indexOf("=>");
    const input = sep >= 0 ? text.slice(0, sep).trim() : text;
    const expectedOutput = sep >= 0 ? text.slice(sep + 2).trim() : "";
    out.push({ input, expectedOutput, isHidden });
  }
  return out;
}

/** Build a validated upsert payload from a raw row + its resolved day key. */
function rowToUpsert(row: RawChallengeRow, dayKey: string): AdminChallengeUpsert {
  const type = row.type.trim().toLowerCase();
  const questionType =
    type === "mcq"
      ? DailyQuestionType.MCQ
      : type === "code"
        ? DailyQuestionType.CODE
        : row.type.trim(); // pass through so the schema surfaces the bad value

  const marksNum = Number(row.marks);
  const raw: Record<string, unknown> = {
    questionType,
    releaseDate: dayKey,
    title: row.title,
    description: row.description,
    ...(Number.isFinite(marksNum) && row.marks.trim() !== ""
      ? { marks: Math.trunc(marksNum) }
      : {}),
  };

  if (questionType === DailyQuestionType.MCQ) {
    raw.options = parseOptions(row.options);
    // The `correct` column is 1-based for authors; store 0-based.
    const correctNum = Number(row.correct);
    raw.correctOption =
      Number.isFinite(correctNum) && row.correct.trim() !== ""
        ? Math.trunc(correctNum) - 1
        : -1; // out of range → schema reports it
  } else {
    raw.starterCode = row.starterCode;
    if (row.language.trim()) raw.language = row.language.trim().toLowerCase();
    raw.testCases = parseCases(row.cases);
  }

  const parsed = adminChallengeUpsertSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(
      parsed.error.issues.map((iss) => iss.message).join("; "),
      400,
      "VALIDATION_ERROR",
    );
  }
  return parsed.data;
}

export async function bulkImportChallenges(
  fileBase64: string,
  startDate?: string,
): Promise<AdminChallengeBulkImportResponse> {
  const buffer = Buffer.from(fileBase64, "base64");
  const { rows, errors: parseErrors } = await parseChallengeWorkbook(buffer);
  const errors: { row: number; message: string }[] = [...parseErrors];
  let scheduled = 0;

  // Sequential mode: row position → consecutive days from startDate.
  let sequentialDay = startDate;

  for (const row of rows) {
    // Resolve this row's day key first (its slot is positional in sequential
    // mode, so a failed row still advances the cursor — predictable mapping).
    let dayKey: string | null = null;
    if (startDate) {
      dayKey = sequentialDay ?? startDate;
      sequentialDay = nextDayKey(dayKey);
    } else {
      const explicit = row.date.trim();
      if (!DATE_KEY_RE.test(explicit)) {
        errors.push({
          row: row.rowNumber,
          message: explicit
            ? `Invalid date "${explicit}" — expected YYYY-MM-DD`
            : "Missing date (add a `date` column or import with a start date)",
        });
        continue;
      }
      dayKey = explicit;
    }

    try {
      const payload = rowToUpsert(row, dayKey);
      // createChallenge enforces the one-per-day slot; a taken date (in the DB
      // or created by an earlier row this run) throws DATE_TAKEN → reported.
      await createChallenge(payload);
      scheduled += 1;
    } catch (err) {
      errors.push({
        row: row.rowNumber,
        message: err instanceof AppError ? err.message : "Failed to import row",
      });
    }
  }

  return { scheduled, errors };
}
