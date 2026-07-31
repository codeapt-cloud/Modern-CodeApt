/**
 * Daily challenges: DailyQuestion, DailyTestCase, UserStreak, DailySubmission.
 *
 * Streak/leaderboard semantics use IST day boundaries (a display/logic concern
 * handled in the service layer); all timestamps here are stored UTC.
 * `releaseDate` is a unique DATE (one problem per day).
 */
import { Schema, model, type InferSchemaType } from "mongoose";
import {
  CODE_LANGUAGE_VALUES,
  CodeLanguage,
  DAILY_CHALLENGE_SOURCE_VALUES,
  DailyChallengeSource,
  DAILY_QUESTION_TYPE_VALUES,
} from "@codeapt/shared";

// --- DailyQuestion -----------------------------------------------------------
const dailyQuestionSchema = new Schema(
  {
    questionType: {
      type: String,
      enum: DAILY_QUESTION_TYPE_VALUES,
      required: true,
    },
    // One question per calendar day.
    releaseDate: { type: Date, required: true, unique: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    // MCQ: options + correct index.
    options: { type: [String], default: undefined },
    correctOption: { type: Number },
    // CODE.
    starterCode: { type: String, default: "" },
    // Language a CODE question's starter/tests target (ignored for MCQ).
    language: {
      type: String,
      enum: CODE_LANGUAGE_VALUES,
      default: CodeLanguage.PYTHON,
    },
    marks: { type: Number, default: 5, min: 0 },
    // Provenance (ADDITIVE) — how this challenge was published. `manual` is the
    // historical default (admin-authored); the automatic generator marks
    // `ai`/`bank_fallback`/`curated_fallback`. `bankQuestion` links the source
    // bank question when a fallback was used (also the "already used" marker for
    // picking an unused one). Only an execution-validated AI challenge is `ai`.
    source: {
      type: String,
      enum: DAILY_CHALLENGE_SOURCE_VALUES,
      default: DailyChallengeSource.MANUAL,
    },
    generatedAt: { type: Date, default: null },
    validationNote: { type: String, default: "" },
    bankQuestion: {
      type: Schema.Types.ObjectId,
      ref: "BankQuestion",
      default: null,
    },
  },
  { timestamps: true },
);
export type DailyQuestion = InferSchemaType<typeof dailyQuestionSchema>;
export const DailyQuestionModel = model("DailyQuestion", dailyQuestionSchema);

// --- DailyTestCase -----------------------------------------------------------
const dailyTestCaseSchema = new Schema(
  {
    question: {
      type: Schema.Types.ObjectId,
      ref: "DailyQuestion",
      required: true,
    },
    inputData: { type: String, default: "" },
    expectedOutput: { type: String, default: "" },
    isHidden: { type: Boolean, default: false },
  },
  { timestamps: true },
);
dailyTestCaseSchema.index({ question: 1 });
export type DailyTestCase = InferSchemaType<typeof dailyTestCaseSchema>;
export const DailyTestCaseModel = model("DailyTestCase", dailyTestCaseSchema);

// --- UserStreak (1-to-1 user) ------------------------------------------------
const userStreakSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    currentStreak: { type: Number, default: 0, min: 0 },
    maxStreak: { type: Number, default: 0, min: 0 },
    totalScore: { type: Number, default: 0, min: 0 },
    lastSolvedDate: { type: Date },
  },
  { timestamps: true },
);
// Leaderboard sort: score desc, then streak desc.
userStreakSchema.index({ totalScore: -1, currentStreak: -1 });
export type UserStreak = InferSchemaType<typeof userStreakSchema>;
export const UserStreakModel = model("UserStreak", userStreakSchema);

// --- DailySubmission ---------------------------------------------------------
const dailySubmissionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    question: {
      type: Schema.Types.ObjectId,
      ref: "DailyQuestion",
      required: true,
    },
    isCorrect: { type: Boolean, default: false },
    score: { type: Number, default: 0, min: 0 },
    submittedCode: { type: String, default: "" },
    language: { type: String, default: "" },
  },
  { timestamps: true },
);
// One submission per user per question (per day).
dailySubmissionSchema.index({ user: 1, question: 1 }, { unique: true });
export type DailySubmission = InferSchemaType<typeof dailySubmissionSchema>;
export const DailySubmissionModel = model(
  "DailySubmission",
  dailySubmissionSchema,
);

// --- ChallengeCodeAttempt (jobId ↔ user+question link) -----------------------
// Links a Step-6 ExecutionJob back to the challenge it grades. Created on
// submit-code; read on finalize to verify ownership + the target question and
// to recover the source for the DailySubmission record. Multiple attempts per
// day are allowed (a user retries until they pass) — awarding idempotency lives
// on the unique DailySubmission index, not here.
const challengeCodeAttemptSchema = new Schema(
  {
    jobId: { type: String, required: true, unique: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    question: {
      type: Schema.Types.ObjectId,
      ref: "DailyQuestion",
      required: true,
    },
    language: { type: String, enum: CODE_LANGUAGE_VALUES, required: true },
    source: { type: String, default: "" },
  },
  { timestamps: true },
);
challengeCodeAttemptSchema.index({ user: 1, question: 1 });
export type ChallengeCodeAttempt = InferSchemaType<
  typeof challengeCodeAttemptSchema
>;
export const ChallengeCodeAttemptModel = model(
  "ChallengeCodeAttempt",
  challengeCodeAttemptSchema,
);
