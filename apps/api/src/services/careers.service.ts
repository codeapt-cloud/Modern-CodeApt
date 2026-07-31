/**
 * Careers service (student surface) — browse postings, view detail, apply, and
 * list the caller's own applications.
 *
 * Server-authoritative: the open/closed gate (active + deadline) is enforced
 * here via the pure `postingOpenState`; apply is idempotent per (user, posting)
 * through a unique index (a re-apply is a 409, not a silent update — an
 * application is a reviewed record, not an editable draft). No eligibility
 * rules exist in the source, so none are enforced.
 *
 * Admin-only applicant contact never appears in a student projection.
 */
import {
  CareerErrorCode,
  JobApplicationStatus,
  postingOpenState,
  type ApplicationResponse,
  type ApplyRequest,
  type MyApplicationRef,
  type MyApplicationsResponse,
  type PostingDetail,
  type PostingListQuery,
  type PostingListResponse,
  type PostingSummary,
  type PostingType,
} from "@codeapt/shared";
import { Types, type HydratedDocument } from "mongoose";

import { AppError } from "../errors/app-error.js";
import {
  JobApplicationModel,
  JobModel,
  type Job,
  type JobApplication,
} from "../models/careers.model.js";

type JobDoc = HydratedDocument<Job>;
type AppDoc = HydratedDocument<JobApplication>;

const MONGO_DUPLICATE_KEY = 11000;
function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: number }).code === MONGO_DUPLICATE_KEY
  );
}

const deadlineMs = (job: Job): number | null =>
  job.deadline ? job.deadline.getTime() : null;

export function toPostingSummary(job: JobDoc, now: Date): PostingSummary {
  const open = postingOpenState(
    { isActive: job.isActive, deadlineMs: deadlineMs(job) },
    now.getTime(),
  );
  return {
    id: job._id.toString(),
    title: job.title,
    company: job.company,
    companyLogo: job.companyLogo,
    location: job.location,
    type: job.employmentType as PostingType,
    compensation: job.compensation,
    deadline: job.deadline ? job.deadline.toISOString() : null,
    isOpen: open.isOpen,
    postedAt: (job.postedAt ?? job.createdAt ?? now).toISOString(),
  };
}

function toApplicationRef(app: AppDoc): MyApplicationRef {
  return {
    id: app._id.toString(),
    status: app.status as JobApplicationStatus,
    appliedAt: (app.createdAt ?? new Date()).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listPostings(
  query: PostingListQuery,
): Promise<PostingListResponse> {
  const now = new Date();
  const includeClosed = query.includeClosed === "true";

  // Students only ever see published (active) postings; closed = past-deadline.
  // Tenant isolation (Phase 5b): the individual/global feed shows ONLY global
  // postings (`college: null`, which also matches pre-tenancy docs with no
  // field). College postings live behind /c/:slug/careers and never leak here.
  const match: Record<string, unknown> = { isActive: true, college: null };
  if (!includeClosed) {
    match.$or = [{ deadline: null }, { deadline: { $gte: now } }];
  }
  if (query.type) match.employmentType = query.type;
  if (query.q) {
    match.$and = [
      {
        $or: [
          { title: { $regex: query.q, $options: "i" } },
          { company: { $regex: query.q, $options: "i" } },
        ],
      },
    ];
  }

  const total = await JobModel.countDocuments(match);
  const jobs = await JobModel.find(match)
    .sort({ postedAt: -1, createdAt: -1 })
    .skip((query.page - 1) * query.pageSize)
    .limit(query.pageSize);

  return {
    items: jobs.map((j) => toPostingSummary(j, now)),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

/** Load a published posting or 404 (inactive postings are invisible to students). */
async function requirePublishedPosting(id: string): Promise<JobDoc> {
  if (!Types.ObjectId.isValid(id)) {
    throw new AppError(
      "Posting not found",
      404,
      CareerErrorCode.POSTING_NOT_FOUND,
    );
  }
  const job = await JobModel.findById(id);
  // A college posting (college set) is invisible/unapplyable on the individual
  // surface — it is reachable only through its tenant's /c/:slug/careers routes.
  if (!job || !job.isActive || job.college) {
    throw new AppError(
      "Posting not found",
      404,
      CareerErrorCode.POSTING_NOT_FOUND,
    );
  }
  return job;
}

export async function getPosting(
  userId: string,
  id: string,
): Promise<PostingDetail> {
  const now = new Date();
  const job = await requirePublishedPosting(id);
  const mine = await JobApplicationModel.findOne({
    job: job._id,
    user: new Types.ObjectId(userId),
  });
  return {
    ...toPostingSummary(job, now),
    description: job.description,
    requirements: job.requirements,
    applyUrl: job.applyUrl,
    myApplication: mine ? toApplicationRef(mine) : null,
  };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export async function applyToPosting(
  userId: string,
  id: string,
  input: ApplyRequest,
): Promise<ApplicationResponse> {
  const now = new Date();
  const job = await requirePublishedPosting(id);

  const open = postingOpenState(
    { isActive: job.isActive, deadlineMs: deadlineMs(job) },
    now.getTime(),
  );
  if (!open.isOpen) {
    throw new AppError(
      open.reason === CareerErrorCode.DEADLINE_PASSED
        ? "The application deadline has passed"
        : "This posting is no longer accepting applications",
      409,
      open.reason ?? CareerErrorCode.POSTING_CLOSED,
    );
  }

  try {
    const app = await JobApplicationModel.create({
      job: job._id,
      user: new Types.ObjectId(userId),
      fullName: input.fullName,
      email: input.email,
      phone: input.phone ?? "",
      resumeUrl: input.resumeUrl ?? "",
      coverLetter: input.coverLetter ?? "",
      status: JobApplicationStatus.SUBMITTED,
    });
    return {
      id: app._id.toString(),
      postingId: job._id.toString(),
      status: app.status as JobApplicationStatus,
      appliedAt: (app.createdAt ?? now).toISOString(),
    };
  } catch (err) {
    // Unique (job, user): the student already applied — idempotent 409.
    if (isDuplicateKeyError(err)) {
      throw new AppError(
        "You have already applied to this posting",
        409,
        CareerErrorCode.ALREADY_APPLIED,
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// My applications
// ---------------------------------------------------------------------------

export async function getMyApplications(
  userId: string,
): Promise<MyApplicationsResponse> {
  const now = new Date();
  const apps = await JobApplicationModel.find({
    user: new Types.ObjectId(userId),
  })
    .sort({ createdAt: -1 })
    .populate<{ job: JobDoc | null }>("job");

  const items = apps
    .filter((a) => a.job)
    .map((a) => ({
      id: a._id.toString(),
      status: a.status as JobApplicationStatus,
      appliedAt: (a.createdAt ?? now).toISOString(),
      // Non-null asserted: filtered above. Populated job doc.
      posting: toPostingSummary(a.job as JobDoc, now),
    }));

  return { items };
}
