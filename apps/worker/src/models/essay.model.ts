/**
 * Essay models (worker copy). Maps onto the SAME collections the API writes
 * (`essaytopics`, `essayattempts`) so the grading processor can load an
 * attempt + its topic and write back the sub-scores/final score.
 *
 * Kept to just the fields the worker reads (content, essayTopic,
 * semanticKeywords, instructions) and writes (subScores, finalScore, aiReport,
 * scoreSource, gradingStatus, status, gradedAt).
 */
import {
  ESSAY_DIFFICULTY_VALUES,
  ESSAY_PROMPT_KIND_VALUES,
  ESSAY_SCORE_SOURCE_VALUES,
  ESSAY_STATUS_VALUES,
  EssayPromptKind,
  EssayStatus,
  JOB_STATUS_VALUES,
  JobStatus,
} from "@codeapt/shared";
import { Schema, model, type InferSchemaType } from "mongoose";

// --- EssayTopic --------------------------------------------------------------
const essayTopicSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    instructions: { type: String, default: "" },
    difficultyLevel: {
      type: Number,
      enum: ESSAY_DIFFICULTY_VALUES,
      default: 1,
    },
    minWords: { type: Number, default: 0, min: 0 },
    maxWords: { type: Number, default: 0, min: 0 },
    timeLimitMinutes: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    // essay | email — the grader picks the rubric from this. Default essay.
    promptKind: {
      type: String,
      enum: ESSAY_PROMPT_KIND_VALUES,
      default: EssayPromptKind.ESSAY,
    },
    // Reference keywords for the relevance analyzer — server-side only.
    semanticKeywords: { type: [String], default: [] },
  },
  { timestamps: true },
);
export type EssayTopic = InferSchemaType<typeof essayTopicSchema>;
export const EssayTopicModel = model("EssayTopic", essayTopicSchema);

const subScoresSchema = new Schema(
  {
    grammar: { type: Number, default: 0 },
    spelling: { type: Number, default: 0 },
    punctuation: { type: Number, default: 0 },
    readability: { type: Number, default: 0 },
    vocabulary: { type: Number, default: 0 },
    structure: { type: Number, default: 0 },
    relevance: { type: Number, default: 0 },
    // Email rubric dimensions (Communication module).
    format: { type: Number, default: 0 },
    register: { type: Number, default: 0 },
    content: { type: Number, default: 0 },
    tone: { type: Number, default: 0 },
  },
  { _id: false },
);

// --- EssayAttempt ------------------------------------------------------------
const essayAttemptSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    essayTopic: {
      type: Schema.Types.ObjectId,
      ref: "EssayTopic",
      required: true,
    },
    attemptNumber: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ESSAY_STATUS_VALUES,
      default: EssayStatus.DRAFT,
    },
    content: { type: String, default: "" },
    wordCount: { type: Number, default: 0, min: 0 },
    characterCount: { type: Number, default: 0, min: 0 },
    paragraphCount: { type: Number, default: 0, min: 0 },
    subScores: { type: subScoresSchema, default: () => ({}) },
    finalScore: { type: Number, default: 0 },
    aiReport: { type: Schema.Types.Mixed, default: null },
    // Which path produced the score (ai_hybrid | deterministic_fallback).
    scoreSource: {
      type: String,
      enum: ESSAY_SCORE_SOURCE_VALUES,
      default: null,
    },
    feedback: { type: String, default: "" },
    gradingJobId: { type: String, default: null },
    gradingStatus: {
      type: String,
      enum: JOB_STATUS_VALUES,
      default: JobStatus.QUEUED,
    },
    timeLimitSeconds: { type: Number, default: 0, min: 0 },
    isTimed: { type: Boolean, default: false },
    timerExpired: { type: Boolean, default: false },
    startedAt: { type: Date },
    submittedAt: { type: Date },
    gradedAt: { type: Date },
    ipAddress: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    // Proctoring / integrity — mirror of the api model (ADDITIVE). The worker
    // never writes these; the schema mirrors them so loaded attempts keep the
    // fields intact across a grading save.
    warningsTriggered: { type: Number, default: 0, min: 0 },
    isMalpractice: { type: Boolean, default: false },
    integrityFlags: { type: [String], default: [] },
  },
  { timestamps: true },
);
essayAttemptSchema.index(
  { user: 1, essayTopic: 1, attemptNumber: 1 },
  { unique: true },
);
export type EssayAttempt = InferSchemaType<typeof essayAttemptSchema>;
export const EssayAttemptModel = model("EssayAttempt", essayAttemptSchema);
