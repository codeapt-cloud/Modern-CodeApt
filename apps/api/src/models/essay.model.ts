/**
 * Essays: EssayTopic, EssayAttempt, EssayDraft, EssayAnalytics.
 *
 * Design notes:
 * - The 7 deterministic sub-scores are EMBEDDED on the attempt (they are
 *   written once at grading time and always read together).
 * - EssayDraft (autosave snapshots) and EssayAnalytics (keystroke/anti-cheat)
 *   are separate collections: drafts are high-churn append data, and analytics
 *   is a 1-to-1 sidecar that would otherwise bloat the attempt document.
 * - `attemptNumber` is unique per (user, topic).
 */
import { Schema, model, type InferSchemaType } from "mongoose";
import {
  ESSAY_SCORE_SOURCE_VALUES,
  ESSAY_STATUS_VALUES,
  EssayStatus,
  ESSAY_DIFFICULTY_VALUES,
  JOB_STATUS_VALUES,
  JobStatus,
} from "@codeapt/shared";

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
    // Per-topic submitted-attempt cap. Default 3 matches the original Django
    // app's hardcoded limit (migrated topics carry no column → default applies).
    maxAttempts: { type: Number, default: 3, min: 1 },
    isActive: { type: Boolean, default: true },
    // Keywords used by the relevance analyzer.
    semanticKeywords: { type: [String], default: [] },
    // --- Multi-tenant (Phase 4c) — ADDITIVE. An individual/global essay topic
    //     has college=null and is unaffected: it's surfaced only via the
    //     enrollment path (which never sees college topics), and `orgUnits` /
    //     `isPublished` are simply unused on that path. A COLLEGE essay topic
    //     carries the owning college, optional org-unit targeting (empty =
    //     college-wide), and a draft→publish lifecycle. Isolation is enforced by
    //     routing every college query through createTenantScope. ---
    college: {
      type: Schema.Types.ObjectId,
      ref: "College",
      default: null,
    },
    orgUnits: {
      type: [Schema.Types.ObjectId],
      ref: "OrgUnit",
      default: [],
    },
    isPublished: { type: Boolean, default: false },
  },
  { timestamps: true },
);
essayTopicSchema.index({ isActive: 1 });
essayTopicSchema.index({ college: 1 });
export type EssayTopic = InferSchemaType<typeof essayTopicSchema>;
export const EssayTopicModel = model("EssayTopic", essayTopicSchema);

// Embedded 7-dimension sub-score block (weights live in @codeapt/shared).
const subScoresSchema = new Schema(
  {
    grammar: { type: Number, default: 0 },
    spelling: { type: Number, default: 0 },
    punctuation: { type: Number, default: 0 },
    readability: { type: Number, default: 0 },
    vocabulary: { type: Number, default: 0 },
    structure: { type: Number, default: 0 },
    relevance: { type: Number, default: 0 },
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
    // Which path produced the score (ai_hybrid | deterministic_fallback);
    // null until grading finalizes.
    scoreSource: {
      type: String,
      enum: ESSAY_SCORE_SOURCE_VALUES,
      default: null,
    },
    feedback: { type: String, default: "" },
    // The ExecutionJob.jobId that grades this attempt (poll target).
    gradingJobId: { type: String, default: null },
    gradingStatus: {
      type: String,
      enum: JOB_STATUS_VALUES,
      default: JobStatus.QUEUED,
    },
    // Timing.
    timeLimitSeconds: { type: Number, default: 0, min: 0 },
    isTimed: { type: Boolean, default: false },
    timerExpired: { type: Boolean, default: false },
    startedAt: { type: Date },
    submittedAt: { type: Date },
    gradedAt: { type: Date },
    // Anti-cheat context.
    ipAddress: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    // Proctoring / integrity — ADDITIVE. Mirrors the exam attempt's
    // warnings/malpractice. Populated at submit for PROCTORED (college) essays
    // from the compose-time integrity signals the client reports; individual
    // essays are not proctored and keep the defaults (unchanged). `isMalpractice`
    // is always RE-DERIVED server-side, never trusted from the client.
    warningsTriggered: { type: Number, default: 0, min: 0 },
    isMalpractice: { type: Boolean, default: false },
    integrityFlags: { type: [String], default: [] },
    // Tenant stamp (Phase 4c) — ADDITIVE. Auto-set from the topic's `college` at
    // submit time (null for individual essays, so those are unaffected). Gives a
    // direct per-college filter for tenant-scoped results + the Phase 5
    // analytics roll-up; isolation itself already holds via the tenant-owned
    // topic the attempt references.
    college: {
      type: Schema.Types.ObjectId,
      ref: "College",
      default: null,
    },
  },
  { timestamps: true },
);
// Attempt numbers are unique per user+topic.
essayAttemptSchema.index(
  { user: 1, essayTopic: 1, attemptNumber: 1 },
  { unique: true },
);
essayAttemptSchema.index({ status: 1 });
essayAttemptSchema.index({ college: 1, essayTopic: 1 });
export type EssayAttempt = InferSchemaType<typeof essayAttemptSchema>;
export const EssayAttemptModel = model("EssayAttempt", essayAttemptSchema);

// --- EssayDraft (autosave snapshots) ----------------------------------------
// Legacy/migrated drafts hang off a submitted `attempt`. New autosave drafts
// are written WHILE COMPOSING — before any attempt exists (the rebuild creates
// the attempt only at submit time) — so they are keyed by (user, essayTopic)
// and never consume an attempt. `attempt` is therefore optional going forward.
const essayDraftSchema = new Schema(
  {
    attempt: {
      type: Schema.Types.ObjectId,
      ref: "EssayAttempt",
      default: null,
    },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    essayTopic: {
      type: Schema.Types.ObjectId,
      ref: "EssayTopic",
      default: null,
    },
    content: { type: String, default: "" },
    wordCount: { type: Number, default: 0, min: 0 },
    savedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);
essayDraftSchema.index({ attempt: 1, savedAt: -1 });
essayDraftSchema.index({ user: 1, essayTopic: 1, savedAt: -1 });
export type EssayDraft = InferSchemaType<typeof essayDraftSchema>;
export const EssayDraftModel = model("EssayDraft", essayDraftSchema);

// --- EssayAnalytics (1-to-1 with attempt; keystroke/anti-cheat) -------------
const essayAnalyticsSchema = new Schema(
  {
    attempt: {
      type: Schema.Types.ObjectId,
      ref: "EssayAttempt",
      required: true,
      unique: true,
    },
    typingEvents: { type: Number, default: 0, min: 0 },
    pasteEvents: { type: Number, default: 0, min: 0 },
    copyEvents: { type: Number, default: 0, min: 0 },
    deleteEvents: { type: Number, default: 0, min: 0 },
    focusLossCount: { type: Number, default: 0, min: 0 },
    inactivitySeconds: { type: Number, default: 0, min: 0 },
    longestPauseSeconds: { type: Number, default: 0, min: 0 },
    suspiciousActivity: { type: Boolean, default: false },
    riskScore: { type: Number, default: 0, min: 0 },
    // Advisory risk classification computed from the signals above (never
    // affects grading). Level buckets + the reasons each signal fired.
    riskLevel: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "low",
    },
    riskReasons: { type: [String], default: [] },
    // Step-11 additive compose signals (never affect grading).
    pastedChars: { type: Number, default: 0, min: 0 },
    composeSeconds: { type: Number, default: 0, min: 0 },
    finalWordCount: { type: Number, default: 0, min: 0 },
    finalCharacterCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);
export type EssayAnalytics = InferSchemaType<typeof essayAnalyticsSchema>;
export const EssayAnalyticsModel = model(
  "EssayAnalytics",
  essayAnalyticsSchema,
);
