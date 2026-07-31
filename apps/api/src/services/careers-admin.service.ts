/**
 * Careers ADMIN service — posting CRUD + publish/close, application review, and
 * status updates. Mirrors the exam-admin pattern (Step 8): thin zod-validated
 * writes behind requireAdmin, returning admin projections that DO expose
 * internal fields (isActive, applicant contact) which student projections omit.
 */
import {
  CareerErrorCode,
  type AdminApplicationListResponse,
  type AdminPosting,
  type AdminPostingListResponse,
  type AdminPostingUpsert,
  type JobApplicationStatus,
  type PostingType,
} from "@codeapt/shared";
import { Types, type HydratedDocument } from "mongoose";

import { AppError } from "../errors/app-error.js";
import {
  JobApplicationModel,
  JobModel,
  type Job,
} from "../models/careers.model.js";

type JobDoc = HydratedDocument<Job>;

function toAdminPosting(job: JobDoc, applicationCount: number): AdminPosting {
  const now = Date.now();
  const isOpen =
    job.isActive && (!job.deadline || job.deadline.getTime() >= now);
  return {
    id: job._id.toString(),
    title: job.title,
    company: job.company,
    companyLogo: job.companyLogo,
    location: job.location,
    type: job.employmentType as PostingType,
    compensation: job.compensation,
    deadline: job.deadline ? job.deadline.toISOString() : null,
    isOpen,
    postedAt: (job.postedAt ?? job.createdAt ?? new Date()).toISOString(),
    description: job.description,
    requirements: job.requirements,
    applyUrl: job.applyUrl,
    isActive: job.isActive,
    applicationCount,
  };
}

async function loadPostingOr404(id: string): Promise<JobDoc> {
  if (!Types.ObjectId.isValid(id)) {
    throw new AppError(
      "Posting not found",
      404,
      CareerErrorCode.POSTING_NOT_FOUND,
    );
  }
  const job = await JobModel.findById(id);
  if (!job) {
    throw new AppError(
      "Posting not found",
      404,
      CareerErrorCode.POSTING_NOT_FOUND,
    );
  }
  return job;
}

/** Translate an upsert payload into stored fields (deadline ISO → Date|null).
 * Exported so the tenant-scoped college-careers service reuses the SAME field
 * mapping (Phase 5b) rather than duplicating it. */
export function postingUpsertFields(
  input: AdminPostingUpsert,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    title: input.title,
    company: input.company,
    employmentType: input.type,
  };
  if (input.companyLogo !== undefined) fields.companyLogo = input.companyLogo;
  if (input.location !== undefined) fields.location = input.location;
  if (input.compensation !== undefined)
    fields.compensation = input.compensation;
  if (input.description !== undefined) fields.description = input.description;
  if (input.requirements !== undefined)
    fields.requirements = input.requirements;
  if (input.applyUrl !== undefined) fields.applyUrl = input.applyUrl;
  if (input.deadline !== undefined) {
    fields.deadline = input.deadline ? new Date(input.deadline) : null;
  }
  if (input.isActive !== undefined) fields.isActive = input.isActive;
  return fields;
}

export async function listPostingsAdmin(): Promise<AdminPostingListResponse> {
  const jobs = await JobModel.find().sort({ createdAt: -1 });
  const counts = await JobApplicationModel.aggregate<{
    _id: Types.ObjectId;
    c: number;
  }>([{ $group: { _id: "$job", c: { $sum: 1 } } }]);
  const byJob = new Map(counts.map((c) => [c._id.toString(), c.c]));
  return {
    items: jobs.map((j) => toAdminPosting(j, byJob.get(j._id.toString()) ?? 0)),
  };
}

export async function getPostingAdmin(id: string): Promise<AdminPosting> {
  const job = await loadPostingOr404(id);
  const count = await JobApplicationModel.countDocuments({ job: job._id });
  return toAdminPosting(job, count);
}

export async function createPosting(
  input: AdminPostingUpsert,
): Promise<AdminPosting> {
  const job = await JobModel.create({
    ...postingUpsertFields(input),
    isActive: input.isActive ?? true,
    postedAt: new Date(),
  });
  return toAdminPosting(job, 0);
}

export async function updatePosting(
  id: string,
  input: AdminPostingUpsert,
): Promise<AdminPosting> {
  const job = await loadPostingOr404(id);
  job.set(postingUpsertFields(input));
  await job.save();
  const count = await JobApplicationModel.countDocuments({ job: job._id });
  return toAdminPosting(job, count);
}

/** Publish (isActive=true) or close (isActive=false) a posting. */
export async function setPostingActive(
  id: string,
  isActive: boolean,
): Promise<AdminPosting> {
  const job = await loadPostingOr404(id);
  job.isActive = isActive;
  await job.save();
  const count = await JobApplicationModel.countDocuments({ job: job._id });
  return toAdminPosting(job, count);
}

export async function deletePosting(id: string): Promise<{ deleted: true }> {
  const job = await loadPostingOr404(id);
  // Reference-safe: never destroy application history. Close is the retire path.
  const applications = await JobApplicationModel.countDocuments({ job: job._id });
  if (applications > 0) {
    throw new AppError(
      `Cannot delete "${job.title}" — it has applications. Close it instead to ` +
        `retire it without losing applicant history.`,
      409,
      CareerErrorCode.DELETE_BLOCKED,
      { blockers: { applications } },
    );
  }
  await JobModel.deleteOne({ _id: job._id });
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export async function listApplications(
  postingId: string,
): Promise<AdminApplicationListResponse> {
  const job = await loadPostingOr404(postingId);
  const apps = await JobApplicationModel.find({ job: job._id }).sort({
    createdAt: -1,
  });
  return {
    postingId: job._id.toString(),
    postingTitle: job.title,
    items: apps.map((a) => ({
      id: a._id.toString(),
      status: a.status as JobApplicationStatus,
      appliedAt: (a.createdAt ?? new Date()).toISOString(),
      userId: a.user ? a.user.toString() : null,
      fullName: a.fullName,
      email: a.email,
      phone: a.phone,
      resumeUrl: a.resumeUrl,
      coverLetter: a.coverLetter,
    })),
  };
}

export async function updateApplicationStatus(
  appId: string,
  status: JobApplicationStatus,
): Promise<{ id: string; status: JobApplicationStatus }> {
  if (!Types.ObjectId.isValid(appId)) {
    throw new AppError(
      "Application not found",
      404,
      CareerErrorCode.APPLICATION_NOT_FOUND,
    );
  }
  const app = await JobApplicationModel.findById(appId);
  if (!app) {
    throw new AppError(
      "Application not found",
      404,
      CareerErrorCode.APPLICATION_NOT_FOUND,
    );
  }
  // `status` is validated against the enum by the zod schema at the controller;
  // any status in the set is a legal target (the source defines no state machine).
  app.status = status;
  await app.save();
  return { id: app._id.toString(), status };
}
