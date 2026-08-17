/**
 * Mock exams & anti-cheat: Exam, ExamSection, ExamQuestion, ExamTestCase,
 * StudentExamAttempt, PublicExamLink, ExamAttemptCounter, ExamAttemptResetLog.
 *
 * Design notes:
 * - Everything is referenced, not embedded: exams are authored section-by-
 *   section and question-by-question in the admin, and attempts must be
 *   queried independently for grading and result export.
 * - MCQ options are modeled as a `options: string[]` array with
 *   `correctOptions: number[]` (indices) instead of Django's option_1..5 +
 *   comma-separated string — cleaner and avoids parsing.
 * - Section timing is SERVER-AUTHORITATIVE: `sectionStartTime` is stored so
 *   remaining time is computed server-side (prevents time pooling / tampering).
 * - StudentExamAttempt supports both logged-in and anonymous public takers
 *   (`user` nullable; `rollNumber`/`collegeName` captured for anonymous).
 */
import { Schema, model, type InferSchemaType } from "mongoose";
import {
  CODE_LANGUAGE_VALUES,
  CodeLanguage,
  EXAM_QUESTION_TYPE_VALUES,
  EXAM_ATTEMPT_STATUS_VALUES,
  ExamAttemptStatus,
} from "@codeapt/shared";

// --- Exam --------------------------------------------------------------------
// Individual (B2C) exams are 1-to-1 with a curriculum `Topic` (type EXAM), and
// availability is derived purely from enrollment in the topic's subject. Phase
// 4b adds ADDITIVE, tenant-scoped college exams: `college` set, `topic` ABSENT
// (a standalone exam not tied to the shared master curriculum, so it's isolated
// per tenant), targeted at the college (optionally to specific org-units), with
// a draft→published lifecycle. `topic` therefore becomes optional; its 1-to-1
// uniqueness is preserved for individual exams by a PARTIAL unique index (unique
// only over docs that actually have a topic), mirroring the per-college
// rollNumber partial-index pattern (Phase 3). Individual exams (college:null,
// topic set, isPublished ignored) keep their exact behavior + uniqueness.
const examSchema = new Schema(
  {
    // Present for individual/global exams (1:1 with a curriculum Topic); ABSENT
    // for tenant (college) exams, which are standalone.
    topic: {
      type: Schema.Types.ObjectId,
      ref: "Topic",
    },
    // Tenant owner (null = individual/global exam — the existing behavior).
    college: { type: Schema.Types.ObjectId, ref: "College", default: null },
    // Target cohort for a college exam: empty = the whole college; otherwise the
    // exam is takeable only by students in these org-units (and descendants).
    // Always empty for individual exams.
    orgUnits: { type: [Schema.Types.ObjectId], ref: "OrgUnit", default: [] },
    // Draft→published lifecycle for college exams (a college exam is invisible
    // to students until published). Ignored for individual exams, whose
    // availability is enrollment-driven as before.
    isPublished: { type: Boolean, default: false },
    title: { type: String, required: true, trim: true },
    totalMarks: { type: Number, default: 0, min: 0 },
    passPercentage: { type: Number, default: 40, min: 0, max: 100 },
    // Whether the in-exam calculator is available to candidates. Defaults on to
    // preserve the always-available calculator behavior for existing exams;
    // staff can disable it per-exam.
    calculatorEnabled: { type: Boolean, default: true },
    // Optional per-exam start-code gate (college exams). When enabled, a student
    // must enter `accessCode` (announced by faculty right before the exam) to
    // start. Defaults off → no gate, preserving existing behavior. The code is
    // stored as-authored so faculty can read it back.
    accessCodeEnabled: { type: Boolean, default: false },
    accessCode: { type: String, default: "" },
    // Randomize question order WITHIN each section (never across sections), and
    // MCQ option order per question. Both default off (unchanged behavior); the
    // per-attempt permutation is persisted on the attempt so it stays stable.
    shuffleQuestions: { type: Boolean, default: false },
    shuffleOptions: { type: Boolean, default: false },
  },
  { timestamps: true },
);
// Preserve the individual-exam 1:1-with-topic guarantee WITHOUT constraining
// topic-less college exams: unique only over docs whose `topic` is an ObjectId.
examSchema.index(
  { topic: 1 },
  { unique: true, partialFilterExpression: { topic: { $type: "objectId" } } },
);
// Tenant-scoped listing (college exams for a tenant).
examSchema.index({ college: 1 });
export type Exam = InferSchemaType<typeof examSchema>;
export const ExamModel = model("Exam", examSchema);

// --- ExamSection (per-section timers) ---------------------------------------
const examSectionSchema = new Schema(
  {
    exam: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    name: { type: String, required: true, trim: true },
    order: { type: Number, default: 0 },
    durationMinutes: { type: Number, required: true, min: 0 },
    description: { type: String, default: "" },
  },
  { timestamps: true },
);
examSectionSchema.index({ exam: 1, order: 1 });
export type ExamSection = InferSchemaType<typeof examSectionSchema>;
export const ExamSectionModel = model("ExamSection", examSectionSchema);

// --- ExamQuestion ------------------------------------------------------------
const examQuestionSchema = new Schema(
  {
    section: {
      type: Schema.Types.ObjectId,
      ref: "ExamSection",
      required: true,
    },
    exam: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    questionType: {
      type: String,
      enum: EXAM_QUESTION_TYPE_VALUES,
      required: true,
    },
    text: { type: String, required: true },
    order: { type: Number, default: 0 },
    // MCQ fields.
    options: { type: [String], default: undefined }, // up to 5
    correctOptions: { type: [Number], default: undefined }, // indices
    // CODE fields.
    starterCode: { type: String, default: "" },
    language: {
      type: String,
      enum: CODE_LANGUAGE_VALUES,
      default: CodeLanguage.PYTHON,
    },
    // Per-question language policy (CODE only). Convention: EMPTY = OPEN (the
    // student may pick any supported language); exactly one entry = LOCKED to
    // that language. Missing/empty (e.g. migrated questions) is treated as open.
    allowedLanguages: {
      type: [String],
      enum: CODE_LANGUAGE_VALUES,
      default: [],
    },
    // Cloudinary image URL.
    image: { type: String, default: "" },
    marks: { type: Number, default: 5, min: 0 },
  },
  { timestamps: true },
);
examQuestionSchema.index({ exam: 1 });
examQuestionSchema.index({ section: 1, order: 1 });
export type ExamQuestion = InferSchemaType<typeof examQuestionSchema>;
export const ExamQuestionModel = model("ExamQuestion", examQuestionSchema);

// --- ExamTestCase (drives proportional marking for CODE) --------------------
const examTestCaseSchema = new Schema(
  {
    question: {
      type: Schema.Types.ObjectId,
      ref: "ExamQuestion",
      required: true,
    },
    inputData: { type: String, default: "" },
    expectedOutput: { type: String, default: "" },
    isHidden: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);
examTestCaseSchema.index({ question: 1 });
export type ExamTestCase = InferSchemaType<typeof examTestCaseSchema>;
export const ExamTestCaseModel = model("ExamTestCase", examTestCaseSchema);

// --- StudentExamAttempt ------------------------------------------------------
const studentExamAttemptSchema = new Schema(
  {
    exam: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    // Tenant owner, copied from the exam at attempt creation (null for
    // individual/global exams — unchanged). Isolates a college's attempt/result
    // data so tenant-scoped reads never cross a college boundary.
    college: { type: Schema.Types.ObjectId, ref: "College", default: null },
    // Null for anonymous public takers.
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    // Bearer token authorizing engine calls for THIS attempt (esp. anonymous,
    // who have no session). Returned on start; required on subsequent calls.
    attemptToken: { type: String, required: true, index: true },
    publicLink: { type: Schema.Types.ObjectId, ref: "PublicExamLink" },
    // Captured for anonymous takers (no account).
    rollNumber: { type: String, default: "" },
    collegeName: { type: String, default: "" },
    status: {
      type: String,
      enum: EXAM_ATTEMPT_STATUS_VALUES,
      default: ExamAttemptStatus.IN_PROGRESS,
    },
    currentSection: { type: Schema.Types.ObjectId, ref: "ExamSection" },
    // Server-authoritative section timer anchor.
    sectionStartTime: { type: Date },
    // Per-section answers + metadata; free-form JSON, so Mixed.
    responseData: { type: Schema.Types.Mixed, default: {} },
    warningsTriggered: { type: Number, default: 0, min: 0 },
    isAutoSubmitted: { type: Boolean, default: false },
    isMalpractice: { type: Boolean, default: false },
    startedAt: { type: Date, default: () => new Date() },
    completedAt: { type: Date },
    score: { type: Number, default: 0, min: 0 },
    passed: { type: Boolean, default: false },
  },
  { timestamps: true },
);
studentExamAttemptSchema.index({ exam: 1, user: 1 });
studentExamAttemptSchema.index({ status: 1 });
studentExamAttemptSchema.index({ publicLink: 1 });
// Tenant-scoped result reads (a college's attempts for one of its exams).
studentExamAttemptSchema.index({ college: 1, exam: 1 });
export type StudentExamAttempt = InferSchemaType<
  typeof studentExamAttemptSchema
>;
export const StudentExamAttemptModel = model(
  "StudentExamAttempt",
  studentExamAttemptSchema,
);

// --- PublicExamLink (tokenized anonymous access) ----------------------------
const publicExamLinkSchema = new Schema(
  {
    exam: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    accessToken: { type: String, required: true, unique: true }, // UUID
    isActive: { type: Boolean, default: true },
    startTime: { type: Date },
    endTime: { type: Date },
    // Optional start-code gate for anonymous takers (super-admin public links).
    // When enabled, the organiser reads `accessCode` out right before the exam.
    accessCodeEnabled: { type: Boolean, default: false },
    accessCode: { type: String, default: "" },
    // Admin-only session label to differentiate links of the same exam (e.g.
    // "Section 2 CSE"). Surfaces in the admin UI + results export; NEVER shown
    // to takers.
    tag: { type: String, default: "" },
  },
  { timestamps: true },
);
publicExamLinkSchema.index({ exam: 1 });
export type PublicExamLink = InferSchemaType<typeof publicExamLinkSchema>;
export const PublicExamLinkModel = model(
  "PublicExamLink",
  publicExamLinkSchema,
);

// --- ExamAttemptCounter (per-user attempt limit) ----------------------------
const examAttemptCounterSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    exam: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    attemptCount: { type: Number, default: 0, min: 0 },
    maxAttempts: { type: Number, default: 1, min: 0 },
  },
  { timestamps: true },
);
examAttemptCounterSchema.index({ user: 1, exam: 1 }, { unique: true });
export type ExamAttemptCounter = InferSchemaType<
  typeof examAttemptCounterSchema
>;
export const ExamAttemptCounterModel = model(
  "ExamAttemptCounter",
  examAttemptCounterSchema,
);

// --- ExamAttemptResetLog (audit trail for limit resets) ---------------------
const examAttemptResetLogSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    exam: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    resetBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    previousCount: { type: Number, required: true, min: 0 },
    reason: { type: String, default: "" },
    resetAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);
examAttemptResetLogSchema.index({ user: 1, exam: 1 });
export type ExamAttemptResetLog = InferSchemaType<
  typeof examAttemptResetLogSchema
>;
export const ExamAttemptResetLogModel = model(
  "ExamAttemptResetLog",
  examAttemptResetLogSchema,
);
