/**
 * Daily-challenge service — today's problem, MCQ + CODE grading, streaks, and
 * the leaderboard.
 *
 * CODE grading rides the Step-6 execution pipeline: submit enqueues an
 * ExecutionJob (with the question's HIDDEN test cases attached server-side) on
 * the `practice` queue and returns a JobRef; the worker runs Piston + grades
 * generically. AWARDING lives here (not the worker): finalize reads the graded
 * result and, on first all-pass, records the DailySubmission + updates the
 * streak — idempotently, guarded by the unique (user, question) index.
 *
 * Answers (MCQ correctOption) and hidden test cases NEVER leave this layer.
 */
import { randomUUID } from "node:crypto";

import {
  ChallengeErrorCode,
  DailyQuestionType,
  JobStatus,
  QueueName,
  computeStreakUpdate,
  istDayKey,
  istDayRangeUtc,
  type ChallengeTodayResponse,
  type CodeExecutionJob,
  type CodeLanguage,
  type ExecutionResult,
  type FinalizeChallengeResponse,
  type JobRef,
  type LeaderboardQuery,
  type LeaderboardResponse,
  type LeaderboardRow,
  type StreakInfo,
  type SubmitCodeRequest,
  type SubmitMcqResponse,
} from "@codeapt/shared";
import { Types, type HydratedDocument } from "mongoose";

import { AppError } from "../errors/app-error.js";
import { enqueueCodeJob } from "../lib/execution-queue.js";
import {
  ChallengeCodeAttemptModel,
  DailyQuestionModel,
  DailySubmissionModel,
  DailyTestCaseModel,
  UserStreakModel,
  type DailyQuestion,
  type UserStreak,
} from "../models/challenge.model.js";
import { ExecutionJobModel } from "../models/execution.model.js";
import { ProfileModel } from "../models/user.model.js";

type QuestionDoc = HydratedDocument<DailyQuestion>;
type StreakDoc = HydratedDocument<UserStreak>;

const MONGO_DUPLICATE_KEY = 11000;
function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: number }).code === MONGO_DUPLICATE_KEY
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function todayKey(): string {
  return istDayKey(new Date());
}

async function findTodaysQuestion(): Promise<QuestionDoc | null> {
  const { start, end } = istDayRangeUtc(todayKey());
  return DailyQuestionModel.findOne({
    releaseDate: { $gte: start, $lt: end },
  });
}

async function getOrCreateStreak(userId: string): Promise<StreakDoc> {
  const existing = await UserStreakModel.findOne({ user: userId });
  if (existing) return existing;
  return UserStreakModel.create({
    user: new Types.ObjectId(userId),
    currentStreak: 0,
    maxStreak: 0,
    totalScore: 0,
  });
}

function toStreakInfo(
  streak: StreakDoc,
  flags: { solvedToday: boolean; attemptedToday: boolean },
): StreakInfo {
  return {
    currentStreak: streak.currentStreak,
    maxStreak: streak.maxStreak,
    totalScore: streak.totalScore,
    solvedToday: flags.solvedToday,
    attemptedToday: flags.attemptedToday,
  };
}

/** Apply a solve to the streak doc (adds points, advances the streak). */
async function awardSolve(streak: StreakDoc, points: number): Promise<void> {
  const next = computeStreakUpdate(
    {
      currentStreak: streak.currentStreak,
      maxStreak: streak.maxStreak,
      lastSolvedDay: streak.lastSolvedDate
        ? istDayKey(streak.lastSolvedDate)
        : null,
    },
    todayKey(),
  );
  streak.currentStreak = next.currentStreak;
  streak.maxStreak = next.maxStreak;
  streak.lastSolvedDate = new Date();
  streak.totalScore += points;
  await streak.save();
}

// ---------------------------------------------------------------------------
// Today's challenge
// ---------------------------------------------------------------------------

export async function getToday(
  userId: string,
): Promise<ChallengeTodayResponse> {
  const streak = await getOrCreateStreak(userId);
  const question = await findTodaysQuestion();

  if (!question) {
    return {
      available: false,
      streak: toStreakInfo(streak, {
        solvedToday: false,
        attemptedToday: false,
      }),
    };
  }

  const submission = await DailySubmissionModel.findOne({
    user: userId,
    question: question._id,
  });
  const attemptedToday = submission !== null;
  const solvedToday = submission?.isCorrect === true;
  const streakInfo = toStreakInfo(streak, { solvedToday, attemptedToday });

  const base = {
    available: true as const,
    id: question._id.toString(),
    title: question.title,
    description: question.description,
    points: question.marks,
    dayKey: todayKey(),
    streak: streakInfo,
  };

  if (question.questionType === DailyQuestionType.MCQ) {
    return {
      ...base,
      questionType: DailyQuestionType.MCQ,
      // Options WITHOUT correctOption — the answer never leaves the server.
      options: question.options ?? [],
      starterCode: null,
      language: null,
      sampleCases: null,
    };
  }

  // CODE — visible sample cases only; hidden cases stay server-side.
  const samples = await DailyTestCaseModel.find({
    question: question._id,
    isHidden: false,
  });
  return {
    ...base,
    questionType: DailyQuestionType.CODE,
    options: null,
    starterCode: question.starterCode,
    language: question.language as CodeLanguage,
    sampleCases: samples.map((c) => ({
      input: c.inputData,
      expectedOutput: c.expectedOutput,
    })),
  };
}

// ---------------------------------------------------------------------------
// MCQ submit
// ---------------------------------------------------------------------------

export async function submitMcq(
  userId: string,
  option: number,
): Promise<SubmitMcqResponse> {
  const question = await requireTodaysQuestion();
  if (question.questionType !== DailyQuestionType.MCQ) {
    throw new AppError(
      "Today's challenge is not an MCQ",
      400,
      ChallengeErrorCode.WRONG_QUESTION_TYPE,
    );
  }
  if (
    await DailySubmissionModel.exists({ user: userId, question: question._id })
  ) {
    throw new AppError(
      "You have already answered today's challenge",
      409,
      ChallengeErrorCode.ALREADY_ATTEMPTED,
    );
  }

  const correctOption = question.correctOption ?? 0;
  const correct = option === correctOption;
  const points = correct ? question.marks : 0;

  // Unique (user, question) index makes this the authoritative once-per-day gate.
  try {
    await DailySubmissionModel.create({
      user: new Types.ObjectId(userId),
      question: question._id,
      isCorrect: correct,
      score: points,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new AppError(
        "You have already answered today's challenge",
        409,
        ChallengeErrorCode.ALREADY_ATTEMPTED,
      );
    }
    throw err;
  }

  const streak = await getOrCreateStreak(userId);
  if (correct) await awardSolve(streak, points);

  return {
    correct,
    correctOption,
    awardedPoints: points,
    streak: toStreakInfo(streak, {
      solvedToday: correct,
      attemptedToday: true,
    }),
  };
}

// ---------------------------------------------------------------------------
// CODE submit (enqueue) + finalize (award)
// ---------------------------------------------------------------------------

export async function submitCode(
  userId: string,
  input: SubmitCodeRequest,
): Promise<JobRef> {
  const question = await requireTodaysQuestion();
  if (question.questionType !== DailyQuestionType.CODE) {
    throw new AppError(
      "Today's challenge is not a coding problem",
      400,
      ChallengeErrorCode.WRONG_QUESTION_TYPE,
    );
  }

  // ALL cases (visible + hidden) grade the run; hidden ones never reach the UI.
  const cases = await DailyTestCaseModel.find({ question: question._id });
  const jobId = randomUUID();
  const submissionRef = `challenge:${question._id.toString()}`;

  await ExecutionJobModel.create({
    jobId,
    user: new Types.ObjectId(userId),
    submissionRef,
    queue: QueueName.PRACTICE,
    status: JobStatus.QUEUED,
  });
  await ChallengeCodeAttemptModel.create({
    jobId,
    user: new Types.ObjectId(userId),
    question: question._id,
    language: input.language,
    source: input.source,
  });

  const payload: CodeExecutionJob = {
    jobId,
    submissionRef,
    language: input.language,
    source: input.source,
    testCases: cases.map((c) => ({
      input: c.inputData,
      expectedOutput: c.expectedOutput,
    })),
  };
  await enqueueCodeJob(QueueName.PRACTICE, payload);

  return { jobId, status: JobStatus.QUEUED };
}

export async function finalizeCode(
  userId: string,
  jobId: string,
): Promise<FinalizeChallengeResponse> {
  const attempt = await ChallengeCodeAttemptModel.findOne({ jobId });
  if (!attempt || attempt.user.toString() !== userId) {
    throw new AppError(
      "Submission not found",
      404,
      ChallengeErrorCode.JOB_NOT_FOUND,
    );
  }

  // Must be for TODAY's question (can't finalize a stale day into today).
  const question = await findTodaysQuestion();
  if (!question || attempt.question.toString() !== question._id.toString()) {
    throw new AppError(
      "Submission is not for today's challenge",
      404,
      ChallengeErrorCode.JOB_NOT_FOUND,
    );
  }

  const job = await ExecutionJobModel.findOne({ jobId });
  if (!job) {
    throw new AppError(
      "Submission not found",
      404,
      ChallengeErrorCode.JOB_NOT_FOUND,
    );
  }

  const streak = await getOrCreateStreak(userId);
  const existing = await DailySubmissionModel.findOne({
    user: userId,
    question: question._id,
  });
  const alreadyAwarded = existing !== null;

  const result = (job.result as ExecutionResult | null) ?? null;
  const graded =
    result && result.totalCount !== null && result.passedCount !== null
      ? { passedCount: result.passedCount, totalCount: result.totalCount }
      : null;

  // Not yet terminal (or failed): report status, award nothing new.
  if (job.status !== JobStatus.COMPLETED) {
    return {
      status: job.status as JobStatus,
      graded,
      solved: alreadyAwarded,
      awarded: alreadyAwarded,
      awardedPoints: existing?.score ?? 0,
      error: job.error ?? null,
      streak: toStreakInfo(streak, {
        solvedToday: alreadyAwarded,
        attemptedToday: alreadyAwarded,
      }),
    };
  }

  const solved =
    graded !== null &&
    graded.totalCount > 0 &&
    graded.passedCount === graded.totalCount;

  // Already awarded on a previous finalize → return the same result (idempotent).
  if (alreadyAwarded) {
    return {
      status: JobStatus.COMPLETED,
      graded,
      solved: existing.isCorrect,
      awarded: true,
      awardedPoints: existing.score,
      error: null,
      streak: toStreakInfo(streak, { solvedToday: true, attemptedToday: true }),
    };
  }

  // Completed but not all cases passed → no record, user may retry.
  if (!solved) {
    return {
      status: JobStatus.COMPLETED,
      graded,
      solved: false,
      awarded: false,
      awardedPoints: 0,
      error: null,
      streak: toStreakInfo(streak, {
        solvedToday: false,
        attemptedToday: false,
      }),
    };
  }

  // First solve → record + award, once. The unique index resolves concurrent
  // finalizes: the loser catches the duplicate and returns without re-awarding.
  try {
    await DailySubmissionModel.create({
      user: new Types.ObjectId(userId),
      question: question._id,
      isCorrect: true,
      score: question.marks,
      submittedCode: attempt.source,
      language: attempt.language,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const fresh = await getOrCreateStreak(userId);
      return {
        status: JobStatus.COMPLETED,
        graded,
        solved: true,
        awarded: true,
        awardedPoints: question.marks,
        error: null,
        streak: toStreakInfo(fresh, {
          solvedToday: true,
          attemptedToday: true,
        }),
      };
    }
    throw err;
  }

  await awardSolve(streak, question.marks);
  return {
    status: JobStatus.COMPLETED,
    graded,
    solved: true,
    awarded: true,
    awardedPoints: question.marks,
    error: null,
    streak: toStreakInfo(streak, { solvedToday: true, attemptedToday: true }),
  };
}

async function requireTodaysQuestion(): Promise<QuestionDoc> {
  const question = await findTodaysQuestion();
  if (!question) {
    throw new AppError(
      "No challenge is available today",
      404,
      ChallengeErrorCode.NO_CHALLENGE_TODAY,
    );
  }
  return question;
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export async function getLeaderboard(
  userId: string,
  query: LeaderboardQuery,
): Promise<LeaderboardResponse> {
  const { page, pageSize } = query;
  const total = await UserStreakModel.countDocuments({
    totalScore: { $gt: 0 },
  });

  const skip = (page - 1) * pageSize;
  const docs = await UserStreakModel.find({ totalScore: { $gt: 0 } })
    .sort({ totalScore: -1, currentStreak: -1, _id: 1 })
    .skip(skip)
    .limit(pageSize)
    .lean<
      {
        _id: Types.ObjectId;
        user: Types.ObjectId;
        totalScore: number;
        currentStreak: number;
      }[]
    >();

  const rows = await hydrateRows(docs, skip, userId);

  // The caller's own rank — computed even when off the visible page.
  const me = await computeOwnRank(userId);

  return { rows, me, page, pageSize, total };
}

interface StreakLean {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  totalScore: number;
  currentStreak: number;
}

async function hydrateRows(
  docs: StreakLean[],
  skip: number,
  userId: string,
): Promise<LeaderboardRow[]> {
  if (docs.length === 0) return [];
  const profiles = await ProfileModel.find({
    user: { $in: docs.map((d) => d.user) },
  }).lean<{ user: Types.ObjectId; fullName: string; avatarUrl?: string }[]>();
  const byUser = new Map(profiles.map((p) => [p.user.toString(), p]));

  return docs.map((d, i) => {
    const profile = byUser.get(d.user.toString());
    return {
      rank: skip + i + 1,
      userId: d.user.toString(),
      name: profile?.fullName ?? "Anonymous",
      avatarUrl: profile?.avatarUrl ? profile.avatarUrl : null,
      totalScore: d.totalScore,
      currentStreak: d.currentStreak,
      isCurrentUser: d.user.toString() === userId,
    };
  });
}

async function computeOwnRank(userId: string): Promise<LeaderboardRow | null> {
  const mine = await UserStreakModel.findOne({
    user: userId,
  }).lean<StreakLean | null>();
  if (!mine || mine.totalScore <= 0) return null;

  // Rank = 1 + number of users strictly ahead in (score, streak) order.
  const ahead = await UserStreakModel.countDocuments({
    totalScore: { $gt: 0 },
    $or: [
      { totalScore: { $gt: mine.totalScore } },
      {
        totalScore: mine.totalScore,
        currentStreak: { $gt: mine.currentStreak },
      },
      {
        totalScore: mine.totalScore,
        currentStreak: mine.currentStreak,
        _id: { $lt: mine._id },
      },
    ],
  });

  const profile = await ProfileModel.findOne({ user: userId }).lean<{
    fullName: string;
    avatarUrl?: string;
  } | null>();

  return {
    rank: ahead + 1,
    userId,
    name: profile?.fullName ?? "Anonymous",
    avatarUrl: profile?.avatarUrl ? profile.avatarUrl : null,
    totalScore: mine.totalScore,
    currentStreak: mine.currentStreak,
    isCurrentUser: true,
  };
}
