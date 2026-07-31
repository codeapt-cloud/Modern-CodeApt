/**
 * Careers / placements: Job (posting) and JobApplication.
 *
 * Extends the Step-1 shape minimally (flagged in the Step-14 report):
 *  - `employmentType` is now a typed PostingType (was free text).
 *  - `compensation` free-text field (the source had no monetary field; campus
 *    postings quote ranges/LPA text, so paise would be awkward).
 *  - `deadline` (nullable) application deadline.
 * No eligibility rules exist in the source, so none are modeled.
 */
import { Schema, model, type InferSchemaType } from "mongoose";
import {
  JOB_APPLICATION_STATUS_VALUES,
  JobApplicationStatus,
  POSTING_TYPE_VALUES,
  PostingType,
} from "@codeapt/shared";

// --- Job (posting) -----------------------------------------------------------
const jobSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    company: { type: String, required: true, trim: true },
    companyLogo: { type: String, default: "" },
    location: { type: String, default: "" },
    employmentType: {
      type: String,
      enum: POSTING_TYPE_VALUES,
      default: PostingType.FULL_TIME,
    },
    // Free-text compensation, e.g. "₹12 LPA" / "₹25k/month stipend".
    compensation: { type: String, default: "" },
    description: { type: String, default: "" },
    requirements: { type: String, default: "" },
    applyUrl: { type: String, default: "" },
    // Application deadline; null/absent = the posting never closes on time.
    deadline: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
    postedAt: { type: Date, default: () => new Date() },
    // --- Multi-tenancy (Phase 5b, additive) ---------------------------------
    // A college posting carries its owning `college`; individual/global postings
    // have `college: null` and never go through the tenant layer (their queries
    // don't reference these fields), so they are byte-for-byte unaffected.
    college: { type: Schema.Types.ObjectId, ref: "College", default: null },
    // Target org-units (empty = the whole college). Mirrors the exam/essay
    // targeting; a faculty member may only target units within their scope.
    orgUnits: { type: [Schema.Types.ObjectId], ref: "OrgUnit", default: [] },
    // Draft→published lifecycle for COLLEGE postings (mirrors Exam.isPublished):
    // a college posting is visible to students only when published. Individual
    // postings ignore this flag (their list filters on `isActive` only), so the
    // default `false` is invisible to them.
    isPublished: { type: Boolean, default: false },
  },
  { timestamps: true },
);
jobSchema.index({ isActive: 1, postedAt: -1 });
// Tenant-scoped lookups (student list + authoring list) hit college + publish.
jobSchema.index({ college: 1, isPublished: 1 });
export type Job = InferSchemaType<typeof jobSchema>;
export const JobModel = model("Job", jobSchema);

// --- JobApplication ----------------------------------------------------------
const jobApplicationSchema = new Schema(
  {
    job: { type: Schema.Types.ObjectId, ref: "Job", required: true },
    // Nullable: public tracking by email is supported (track_application).
    user: { type: Schema.Types.ObjectId, ref: "User" },
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, default: "" },
    resumeUrl: { type: String, default: "" },
    coverLetter: { type: String, default: "" },
    status: {
      type: String,
      enum: JOB_APPLICATION_STATUS_VALUES,
      default: JobApplicationStatus.SUBMITTED,
    },
  },
  { timestamps: true },
);
jobApplicationSchema.index({ job: 1, email: 1 });
jobApplicationSchema.index({ user: 1 });
// A logged-in student applies at most once per posting (Step-14). Partial so
// anonymous (user=null) email-tracked applications are unaffected.
jobApplicationSchema.index(
  { job: 1, user: 1 },
  { unique: true, partialFilterExpression: { user: { $exists: true } } },
);
export type JobApplication = InferSchemaType<typeof jobApplicationSchema>;
export const JobApplicationModel = model(
  "JobApplication",
  jobApplicationSchema,
);
