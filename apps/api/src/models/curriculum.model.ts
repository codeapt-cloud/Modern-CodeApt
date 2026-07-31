/**
 * LMS content tree: Program → Subject → Module → Topic, plus subject-level
 * quizzes (Question/Choice), Enrollment, TopicProgress, and QuizSubmission.
 *
 * Design notes:
 * - Tree uses references (parent id on each child), not deep embedding: the
 *   tree is edited independently at every level in the admin, and topics are
 *   queried/reordered on their own.
 * - Money is stored as INTEGER PAISE (minor units) to stay decimal-safe
 *   without Decimal128 ergonomics; the UI divides by 100 for display.
 * - Topic.order is a FLOAT so new topics can be inserted between existing ones
 *   (e.g. 1.5 between 1 and 2) — the ordering trick preserved from Django.
 */
import { Schema, model, type InferSchemaType } from "mongoose";
import { TOPIC_TYPE_VALUES } from "@codeapt/shared";

// --- Program -----------------------------------------------------------------
const programSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true },
    description: { type: String, default: "" },
    order: { type: Number, default: 0 },
    isVisible: { type: Boolean, default: true },
  },
  { timestamps: true },
);
// PARTIAL-unique slug: a migrated legacy program may have a blank slug, so
// uniqueness is enforced only on non-empty values ({ $gt: "" }).
programSchema.index(
  { slug: 1 },
  { unique: true, partialFilterExpression: { slug: { $gt: "" } } },
);
programSchema.index({ isVisible: 1 });
export type Program = InferSchemaType<typeof programSchema>;
export const ProgramModel = model("Program", programSchema);

// --- Subject -----------------------------------------------------------------
const subjectSchema = new Schema(
  {
    program: { type: Schema.Types.ObjectId, ref: "Program" },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    image: { type: String, default: "" },
    description: { type: String, default: "" },
    // Prices in paise.
    price: { type: Number, default: 0, min: 0 },
    discountPrice: { type: Number, default: 0, min: 0 },
    isPopular: { type: Boolean, default: false },
    isVisible: { type: Boolean, default: true },
  },
  { timestamps: true },
);
// Hot filters for the catalog.
subjectSchema.index({ isVisible: 1, isPopular: 1 });
subjectSchema.index({ program: 1 });
export type Subject = InferSchemaType<typeof subjectSchema>;
export const SubjectModel = model("Subject", subjectSchema);

// --- Module ------------------------------------------------------------------
const moduleSchema = new Schema(
  {
    subject: { type: Schema.Types.ObjectId, ref: "Subject", required: true },
    name: { type: String, required: true, trim: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);
moduleSchema.index({ subject: 1, order: 1 });
export type Module = InferSchemaType<typeof moduleSchema>;
export const ModuleModel = model("Module", moduleSchema);

// --- Topic -------------------------------------------------------------------
const topicSchema = new Schema(
  {
    module: { type: Schema.Types.ObjectId, ref: "Module", required: true },
    name: { type: String, required: true, trim: true },
    topicType: { type: String, enum: TOPIC_TYPE_VALUES, required: true },
    // FLOAT ordering — see file header.
    order: { type: Number, default: 0 },
    content: { type: String, default: "" },
    videoId: { type: String, default: "" }, // extracted YouTube id
    duration: { type: String, default: "" },
    // Only set when topicType === "essay".
    essayTopic: { type: Schema.Types.ObjectId, ref: "EssayTopic" },
    isVisible: { type: Boolean, default: true },
  },
  { timestamps: true },
);
topicSchema.index({ module: 1, order: 1 });
topicSchema.index({ topicType: 1 });
export type Topic = InferSchemaType<typeof topicSchema>;
export const TopicModel = model("Topic", topicSchema);

// --- Question (subject-level quiz) -------------------------------------------
const questionSchema = new Schema(
  {
    subject: { type: Schema.Types.ObjectId, ref: "Subject", required: true },
    // Optional link to a specific quiz topic.
    topic: { type: Schema.Types.ObjectId, ref: "Topic" },
    text: { type: String, required: true },
    marks: { type: Number, default: 1, min: 0 },
  },
  { timestamps: true },
);
questionSchema.index({ subject: 1 });
export type Question = InferSchemaType<typeof questionSchema>;
export const QuestionModel = model("Question", questionSchema);

// --- Choice ------------------------------------------------------------------
// Separate collection (not embedded) to match Django's Choice model and allow
// per-choice references from submissions later.
const choiceSchema = new Schema(
  {
    question: {
      type: Schema.Types.ObjectId,
      ref: "Question",
      required: true,
    },
    text: { type: String, required: true },
    isCorrect: { type: Boolean, default: false },
  },
  { timestamps: true },
);
choiceSchema.index({ question: 1 });
export type Choice = InferSchemaType<typeof choiceSchema>;
export const ChoiceModel = model("Choice", choiceSchema);

// --- Enrollment --------------------------------------------------------------
const enrollmentSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    subject: { type: Schema.Types.ObjectId, ref: "Subject", required: true },
    // How the enrollment was created: paid order, admin bulk upload, or a
    // college assigning a granted course to its student (Phase 4a).
    source: {
      type: String,
      enum: ["order", "manual", "college"],
      default: "manual",
    },
    order: { type: Schema.Types.ObjectId, ref: "Order" },
    // Tenant scope for a college assignment (source "college"); null for
    // individual (B2C) enrollments — which are completely unaffected.
    college: { type: Schema.Types.ObjectId, ref: "College", default: null },
  },
  { timestamps: true },
);
// A user enrolls in a subject at most once (individual OR college — college
// students are a separate user population, so no conflict with B2C enrollments).
enrollmentSchema.index({ user: 1, subject: 1 }, { unique: true });
// College-assignment queries: a college's assignments for a course, and counts.
// Additive; individual enrollments (college:null) are excluded from these reads.
enrollmentSchema.index({ college: 1, subject: 1 });
export type Enrollment = InferSchemaType<typeof enrollmentSchema>;
export const EnrollmentModel = model("Enrollment", enrollmentSchema);

// --- TopicProgress -----------------------------------------------------------
const topicProgressSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    topic: { type: Schema.Types.ObjectId, ref: "Topic", required: true },
    isCompleted: { type: Boolean, default: false },
    completedAt: { type: Date },
  },
  { timestamps: true },
);
topicProgressSchema.index({ user: 1, topic: 1 }, { unique: true });
export type TopicProgress = InferSchemaType<typeof topicProgressSchema>;
export const TopicProgressModel = model("TopicProgress", topicProgressSchema);

// --- QuizSubmission ----------------------------------------------------------
const quizSubmissionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    subject: { type: Schema.Types.ObjectId, ref: "Subject", required: true },
    topic: { type: Schema.Types.ObjectId, ref: "Topic" },
    score: { type: Number, default: 0, min: 0 },
    totalQuestions: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);
quizSubmissionSchema.index({ user: 1, subject: 1 });
// `percentage` was a Python property; expose it as a virtual.
quizSubmissionSchema.virtual("percentage").get(function () {
  return this.totalQuestions > 0
    ? Math.round((this.score / this.totalQuestions) * 100)
    : 0;
});
export type QuizSubmission = InferSchemaType<typeof quizSubmissionSchema>;
export const QuizSubmissionModel = model(
  "QuizSubmission",
  quizSubmissionSchema,
);
