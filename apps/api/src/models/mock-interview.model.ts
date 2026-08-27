/**
 * AI Mock Interview (Step 33) — the authored artifact + the attempt. Tenancy is
 * the exact three-shape pattern of SpeakingAssessment / GameSet / Exam:
 *   - tenant-authored  → college set, topic null
 *   - course-attached  → college null, topic set (1:1 with a MOCK_INTERVIEW topic)
 *   - platform-internal→ college null, topic null
 *
 * The attempt DIVERGES from the speaking attempt in one way: its `turns` array
 * GROWS during the session — an adaptive follow-up appends a turn — whereas a
 * speaking attempt pre-materializes one item per authored item at start. Progressive
 * disclosure still rides `currentIndex`.
 *
 * STORAGE / RETENTION: transcript + per-answer AUDIO URL (Cloudinary, ~5MB total)
 * are kept so fluency stays verifiable and the student can hear themselves back.
 * The resume is TEXT ONLY (no file is ever uploaded), stored on the attempt for the
 * session it drives, and removed when the attempt is cleared. NO VIDEO IS EVER
 * STORED — Part 2 captures camera frames live for observations and discards them.
 */
import { Schema, model, type InferSchemaType } from "mongoose";
import {
  INTERVIEW_QUESTION_CATEGORY_VALUES,
  INTERVIEW_QUESTION_SOURCE_VALUES,
  InterviewQuestionCategory,
  InterviewQuestionSource,
  InterviewScoreSource,
  INTERVIEW_SCORE_SOURCE_VALUES,
  MOCK_INTERVIEW_STATUS_VALUES,
  MockInterviewStatus,
} from "@codeapt/shared";

// --- Authored artifact -----------------------------------------------------
const seedQuestionSchema = new Schema(
  {
    text: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: INTERVIEW_QUESTION_CATEGORY_VALUES,
      default: InterviewQuestionCategory.BEHAVIOURAL,
    },
    promptAudioUrl: { type: String, default: "" },
    promptAudioVoiceId: { type: String, default: "" },
    promptAudioVoiceVersion: { type: String, default: "" },
  },
  { _id: false },
);

const mockInterviewSchema = new Schema(
  {
    college: { type: Schema.Types.ObjectId, ref: "College", default: null },
    topic: { type: Schema.Types.ObjectId, ref: "Topic", default: null },
    orgUnits: { type: [Schema.Types.ObjectId], ref: "OrgUnit", default: [] },
    isPublished: { type: Boolean, default: false },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    role: { type: String, required: true, trim: true },
    seniority: { type: String, default: "" },
    durationMinutes: { type: Number, default: 20, min: 1 },
    maxAttempts: { type: Number, default: 1, min: 0 }, // 0 = unlimited
    plan: {
      behaviouralCount: { type: Number, default: 3, min: 0 },
      technicalCount: { type: Number, default: 4, min: 0 },
      maxFollowUpsPerAnswer: { type: Number, default: 1, min: 0 },
      maxFollowUpsPerSession: { type: Number, default: 4, min: 0 },
    },
    seedQuestions: { type: [seedQuestionSchema], default: [] },
  },
  { timestamps: true },
);
// 1:1 topic↔interview only for course-attached docs (partial unique — mirrors
// SpeakingAssessment.topic / GameSet.topic / Exam.topic).
mockInterviewSchema.index(
  { topic: 1 },
  { unique: true, partialFilterExpression: { topic: { $type: "objectId" } } },
);
mockInterviewSchema.index({ college: 1 });
export type MockInterview = InferSchemaType<typeof mockInterviewSchema>;
export const MockInterviewModel = model("MockInterview", mockInterviewSchema);

// --- Attempt ---------------------------------------------------------------
const turnSchema = new Schema(
  {
    index: { type: Number, required: true, min: 0 },
    category: {
      type: String,
      enum: INTERVIEW_QUESTION_CATEGORY_VALUES,
      default: InterviewQuestionCategory.BEHAVIOURAL,
    },
    isFollowUp: { type: Boolean, default: false },
    source: {
      type: String,
      enum: INTERVIEW_QUESTION_SOURCE_VALUES,
      default: InterviewQuestionSource.LLM,
    },
    question: { type: String, required: true },
    /** Only set for author SEED questions (pre-generated Piper audio). */
    promptAudioUrl: { type: String, default: "" },
    /** For a follow-up: the main-turn index it probes. */
    parentIndex: { type: Number, default: null },
    // --- filled at answer time ---
    audioUrl: { type: String, default: "" },
    /** The domain-term-CORRECTED transcript (scored + shown). */
    transcript: { type: String, default: "" },
    /** The ORIGINAL browser-STT transcript, kept for disputes (Step 34 fix #3). */
    rawTranscript: { type: String, default: "" },
    /** Term corrections applied: [{ from, to, kind }]. */
    corrections: { type: Schema.Types.Mixed, default: [] },
    fluency: { type: Schema.Types.Mixed, default: null }, // FluencyResult | null
    latencySeconds: { type: Number, default: null },
    answered: { type: Boolean, default: false },
    answeredAt: { type: Date, default: null },
    /** Deterministic floor { speaking, vocabulary } once answered. */
    floor: { type: Schema.Types.Mixed, default: null },
    /** LLM per-answer judgement { concept, analysis, topicKnowledge, relevance,
     *  star } — null when the model was unavailable (degrade). */
    ai: { type: Schema.Types.Mixed, default: null },
    feedback: { type: String, default: "" },
  },
  { _id: false },
);

const mockInterviewAttemptSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    assessment: {
      type: Schema.Types.ObjectId,
      ref: "MockInterview",
      required: true,
    },
    college: { type: Schema.Types.ObjectId, ref: "College", default: null },
    status: {
      type: String,
      enum: MOCK_INTERVIEW_STATUS_VALUES,
      default: MockInterviewStatus.IN_PROGRESS,
    },
    // Intake snapshot (personal data — scoped to this attempt, no file retained).
    role: { type: String, default: "" },
    seniority: { type: String, default: "" },
    resumeText: { type: String, default: "" },
    jobDescription: { type: String, default: "" },
    /** LLM extraction { skills[], experience, gaps[] } — degrades to empty. */
    analysis: { type: Schema.Types.Mixed, default: null },
    turns: { type: [turnSchema], default: [] },
    currentIndex: { type: Number, default: 0, min: 0 },
    followUpsUsed: { type: Number, default: 0, min: 0 },
    expiresAt: { type: Date, default: null },
    startedAt: { type: Date },
    submittedAt: { type: Date },
    scoredAt: { type: Date },
    // Final report (computeInterviewReport output) once scored.
    report: { type: Schema.Types.Mixed, default: null },
    reportSource: {
      type: String,
      enum: INTERVIEW_SCORE_SOURCE_VALUES,
      default: InterviewScoreSource.DETERMINISTIC_FLOOR,
    },
    summary: { type: String, default: "" },
    // Proctoring (server-authoritative), same machinery as speaking Step 32.
    warnings: { type: Number, default: 0, min: 0 },
    terminated: { type: Boolean, default: false },
    terminatedReason: { type: String, default: "" },
  },
  { timestamps: true },
);
mockInterviewAttemptSchema.index({ user: 1, assessment: 1 });
mockInterviewAttemptSchema.index({ status: 1, expiresAt: 1 }); // reaper
export type MockInterviewAttempt = InferSchemaType<
  typeof mockInterviewAttemptSchema
>;
export const MockInterviewAttemptModel = model(
  "MockInterviewAttempt",
  mockInterviewAttemptSchema,
);
