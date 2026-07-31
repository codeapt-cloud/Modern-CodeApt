/**
 * College careers/postings service (Phase 5b) — tenant-scoped authoring + the
 * student browse/apply flow over the EXISTING careers engine. Nothing here forks
 * the engine: authoring reuses the careers-admin field mapping + reference-safe
 * delete + applications review, and applying delegates to the shared
 * careers.service apply (which enforces the open/deadline gate + apply-once
 * idempotency). This module only adds the tenant + faculty scoping, org-unit
 * targeting, and the draft→published lifecycle on top.
 *
 * A college posting is a Job with `college` set, targeted at the whole college
 * or specific org-units, with an `isPublished` (draft→published) lifecycle.
 * Isolation is enforced by routing EVERY query through createTenantScope: a
 * posting not tagged with this tenant simply isn't found (404), so no college
 * can author/read/apply-to another's — and individual (college:null) postings
 * are invisible here and entirely unaffected. Applications carry no college
 * field; they resolve tenancy through their parent posting.
 *
 * Authoring is college_admin (unrestricted in-tenant) or faculty (only postings
 * targeted within their org-unit scope). Browsing/applying is by that college's
 * students whose org-unit falls in the posting's target (empty = college-wide).
 * See docs/MULTI_TENANT_ARCHITECTURE.md §2.
 */
import {
  CareerErrorCode,
  JobApplicationStatus,
  StudentErrorCode,
  collectDescendantUnitIds,
  postingOpenState,
  type AdminApplicationListResponse,
  type AdminPosting,
  type ApplicationResponse,
  type ApplyRequest,
  type CollegePostingListResponse,
  type CollegePostingSummary,
  type CollegeStudentPostingListResponse,
  type CreateCollegePostingInput,
  type PostingDetail,
  type UpdateCollegePostingInput,
} from "@codeapt/shared";
import { Types, type HydratedDocument } from "mongoose";

import { AppError } from "../errors/app-error.js";
import { createTenantScope, type TenantScope } from "../lib/tenant-scope.js";
import {
  JobApplicationModel,
  JobModel,
  type Job,
} from "../models/careers.model.js";
import { OrgUnitModel } from "../models/org-unit.model.js";
import { UserModel } from "../models/user.model.js";
import * as careersAdmin from "./careers-admin.service.js";
import { toPostingSummary } from "./careers.service.js";
import {
  resolveActorScope,
  type ActorScope,
  type StudentActor,
} from "./student.service.js";

type JobDoc = HydratedDocument<Job>;

/** The acting operator/student — same shape the student service uses. */
export type PostingActor = StudentActor;

const NOT_FOUND = () =>
  new AppError("Posting not found", 404, CareerErrorCode.POSTING_NOT_FOUND);
const OUT_OF_SCOPE = (msg: string) =>
  new AppError(msg, 403, StudentErrorCode.ORG_UNIT_OUT_OF_SCOPE);

// --- Org-unit scope helpers --------------------------------------------------

/** [{id, parentId}] for every unit in the tenant (for descendant math). */
async function unitRefs(
  scope: TenantScope,
): Promise<{ id: string; parentId: string | null }[]> {
  const units = await OrgUnitModel.find(scope.filter()).select("_id parent");
  return units.map((u) => ({
    id: u._id.toString(),
    parentId: u.parent ? u.parent.toString() : null,
  }));
}

/**
 * Validate a college posting's target org-units: every id must exist IN THIS
 * TENANT, and (for faculty) be within the actor's scope. A faculty member must
 * target at least one in-scope unit (they cannot create a college-wide posting);
 * a college_admin may target any units or none (empty = college-wide).
 */
async function validateTargetUnits(
  scope: TenantScope,
  actorScope: ActorScope,
  orgUnitIds: string[],
): Promise<Types.ObjectId[]> {
  const unique = [...new Set(orgUnitIds)];
  for (const id of unique) {
    if (!Types.ObjectId.isValid(id)) {
      throw OUT_OF_SCOPE("One or more target org-units are invalid");
    }
  }
  if (unique.length === 0) {
    if (!actorScope.unrestricted) {
      throw OUT_OF_SCOPE(
        "Faculty must target one or more org-units within their scope",
      );
    }
    return [];
  }
  const found = await OrgUnitModel.find(
    scope.filter({ _id: { $in: unique } }),
  ).select("_id");
  if (found.length !== unique.length) {
    throw OUT_OF_SCOPE("One or more target org-units are not in this college");
  }
  if (!actorScope.unrestricted) {
    for (const id of unique) {
      if (!actorScope.unitIds.has(id)) {
        throw OUT_OF_SCOPE(
          "One or more target org-units are outside your scope",
        );
      }
    }
  }
  return unique.map((id) => new Types.ObjectId(id));
}

/** A faculty member may only manage a posting whose target is within their scope. */
function assertPostingManageable(job: JobDoc, actorScope: ActorScope): void {
  if (actorScope.unrestricted) return;
  const units = (job.orgUnits ?? []).map((u) => u.toString());
  if (units.length === 0 || !units.every((u) => actorScope.unitIds.has(u))) {
    throw OUT_OF_SCOPE("This posting is outside your assigned scope");
  }
}

// --- Tenant posting resolution ----------------------------------------------

/** Load a college posting of THIS tenant, or 404 (isolation: cross-tenant not found). */
async function requireTenantPosting(
  scope: TenantScope,
  postingId: string,
): Promise<JobDoc> {
  if (!Types.ObjectId.isValid(postingId)) throw NOT_FOUND();
  const job = await JobModel.findOne(scope.filter({ _id: postingId }));
  if (!job) throw NOT_FOUND();
  return job;
}

/** Resolve the tenant posting that OWNS an application (via application.job). */
async function postingOfApplication(
  scope: TenantScope,
  appId: string,
): Promise<JobDoc> {
  if (!Types.ObjectId.isValid(appId)) {
    throw new AppError(
      "Application not found",
      404,
      CareerErrorCode.APPLICATION_NOT_FOUND,
    );
  }
  const app = await JobApplicationModel.findById(appId).select("job");
  if (!app) {
    throw new AppError(
      "Application not found",
      404,
      CareerErrorCode.APPLICATION_NOT_FOUND,
    );
  }
  return requireTenantPosting(scope, app.job.toString());
}

/** Resolve posting + actor scope, then assert the actor may manage it. */
async function forManage(
  collegeId: string,
  actor: PostingActor,
  load: (scope: TenantScope) => Promise<JobDoc>,
): Promise<{ scope: TenantScope; job: JobDoc }> {
  const scope = createTenantScope(collegeId);
  const [actorScope, job] = await Promise.all([
    resolveActorScope(scope, actor),
    load(scope),
  ]);
  assertPostingManageable(job, actorScope);
  return { scope, job };
}

// --- Projections -------------------------------------------------------------

/** The college authoring-list row: admin projection + lifecycle + targeting. */
function toCollegePostingSummary(
  job: JobDoc,
  applicationCount: number,
): CollegePostingSummary {
  const now = Date.now();
  const isOpen =
    job.isActive && (!job.deadline || job.deadline.getTime() >= now);
  return {
    id: job._id.toString(),
    title: job.title,
    company: job.company,
    companyLogo: job.companyLogo,
    location: job.location,
    type: job.employmentType as CollegePostingSummary["type"],
    compensation: job.compensation,
    deadline: job.deadline ? job.deadline.toISOString() : null,
    isOpen,
    postedAt: (job.postedAt ?? job.createdAt ?? new Date()).toISOString(),
    description: job.description,
    requirements: job.requirements,
    applyUrl: job.applyUrl,
    isActive: job.isActive,
    applicationCount,
    isPublished: job.isPublished ?? false,
    orgUnitIds: (job.orgUnits ?? []).map((u) => u.toString()),
  };
}

// --- Authoring: posting lifecycle -------------------------------------------

export async function createCollegePosting(
  collegeId: string,
  actor: PostingActor,
  input: CreateCollegePostingInput,
): Promise<AdminPosting> {
  const scope = createTenantScope(collegeId);
  const actorScope = await resolveActorScope(scope, actor);
  const orgUnits = await validateTargetUnits(
    scope,
    actorScope,
    input.orgUnitIds,
  );
  const job = await JobModel.create(
    scope.attach({
      ...careersAdmin.postingUpsertFields(input),
      isActive: input.isActive ?? true,
      isPublished: false,
      orgUnits,
      postedAt: new Date(),
    }),
  );
  return careersAdmin.getPostingAdmin(job._id.toString());
}

export async function listCollegePostings(
  collegeId: string,
  actor: PostingActor,
): Promise<CollegePostingListResponse> {
  const scope = createTenantScope(collegeId);
  const actorScope = await resolveActorScope(scope, actor);
  const jobs = await JobModel.find(scope.filter()).sort({
    createdAt: -1,
    _id: -1,
  });

  const manageable = actorScope.unrestricted
    ? jobs
    : jobs.filter((j) => {
        const units = (j.orgUnits ?? []).map((u) => u.toString());
        return units.length > 0 && units.every((u) => actorScope.unitIds.has(u));
      });

  const items = await Promise.all(
    manageable.map(async (job) => {
      const applicationCount = await JobApplicationModel.countDocuments({
        job: job._id,
      });
      return toCollegePostingSummary(job, applicationCount);
    }),
  );
  return { items };
}

export async function getCollegePosting(
  collegeId: string,
  actor: PostingActor,
  postingId: string,
): Promise<AdminPosting> {
  const { job } = await forManage(collegeId, actor, (s) =>
    requireTenantPosting(s, postingId),
  );
  return careersAdmin.getPostingAdmin(job._id.toString());
}

export async function updateCollegePosting(
  collegeId: string,
  actor: PostingActor,
  postingId: string,
  input: UpdateCollegePostingInput,
): Promise<AdminPosting> {
  const { scope, job } = await forManage(collegeId, actor, (s) =>
    requireTenantPosting(s, postingId),
  );
  const actorScope = await resolveActorScope(scope, actor);
  job.set(careersAdmin.postingUpsertFields(input));
  job.orgUnits = await validateTargetUnits(scope, actorScope, input.orgUnitIds);
  await job.save();
  return careersAdmin.getPostingAdmin(job._id.toString());
}

/** Publish / unpublish a college posting (draft→published lifecycle). */
export async function setCollegePostingPublished(
  collegeId: string,
  actor: PostingActor,
  postingId: string,
  isPublished: boolean,
): Promise<CollegePostingSummary> {
  const { job } = await forManage(collegeId, actor, (s) =>
    requireTenantPosting(s, postingId),
  );
  job.isPublished = isPublished;
  await job.save();
  const applicationCount = await JobApplicationModel.countDocuments({
    job: job._id,
  });
  return toCollegePostingSummary(job, applicationCount);
}

export async function removeCollegePosting(
  collegeId: string,
  actor: PostingActor,
  postingId: string,
): Promise<{ deleted: true }> {
  const { job } = await forManage(collegeId, actor, (s) =>
    requireTenantPosting(s, postingId),
  );
  // Reuse the reference-safe delete (blocks if applications exist).
  return careersAdmin.deletePosting(job._id.toString());
}

// --- Applications (tenant-scoped operator view) ------------------------------

export async function collegePostingApplications(
  collegeId: string,
  actor: PostingActor,
  postingId: string,
): Promise<AdminApplicationListResponse> {
  const { job } = await forManage(collegeId, actor, (s) =>
    requireTenantPosting(s, postingId),
  );
  return careersAdmin.listApplications(job._id.toString());
}

export async function updateCollegeApplicationStatus(
  collegeId: string,
  actor: PostingActor,
  appId: string,
  status: JobApplicationStatus,
): Promise<{ id: string; status: JobApplicationStatus }> {
  // The application must belong to a posting THIS actor can manage (tenant +
  // faculty scope) — resolve the posting through the application, then delegate.
  await forManage(collegeId, actor, (s) => postingOfApplication(s, appId));
  return careersAdmin.updateApplicationStatus(appId, status);
}

// --- Browsing / applying (college student) -----------------------------------

/** Is a student (in `studentUnit`) inside the posting's target org-units? */
function studentInTarget(
  targetUnitIds: string[],
  studentUnit: string | null,
  refs: { id: string; parentId: string | null }[],
): boolean {
  if (targetUnitIds.length === 0) return true; // college-wide
  if (!studentUnit) return false;
  const allowed = new Set(collectDescendantUnitIds(refs, targetUnitIds));
  return allowed.has(studentUnit);
}

export async function listStudentCollegePostings(
  collegeId: string,
  studentUserId: string,
): Promise<CollegeStudentPostingListResponse> {
  const now = new Date();
  const scope = createTenantScope(collegeId);
  const student = await UserModel.findById(studentUserId).select("orgUnit");
  const studentUnit = student?.orgUnit ? student.orgUnit.toString() : null;

  // Published + open (active, not past-deadline) — mirrors the shared student
  // list default (closed/past-deadline postings are hidden).
  const jobs = await JobModel.find(
    scope.filter({
      isPublished: true,
      isActive: true,
      $or: [{ deadline: null }, { deadline: { $gte: now } }],
    }),
  ).sort({ postedAt: -1, createdAt: -1 });
  if (jobs.length === 0) return { items: [] };
  const refs = await unitRefs(scope);

  const items = jobs
    .filter((job) => {
      const targets = (job.orgUnits ?? []).map((u) => u.toString());
      return studentInTarget(targets, studentUnit, refs);
    })
    .map((job) => toPostingSummary(job, now));
  return { items };
}

/** Load a published, in-target college posting for THIS student, or 404/403. */
async function requireStudentPosting(
  collegeId: string,
  studentUserId: string,
  postingId: string,
): Promise<JobDoc> {
  const scope = createTenantScope(collegeId);
  if (!Types.ObjectId.isValid(postingId)) throw NOT_FOUND();
  // Isolation + lifecycle: must be a PUBLISHED posting of THIS tenant.
  const job = await JobModel.findOne(
    scope.filter({ _id: postingId, isPublished: true }),
  );
  if (!job) throw NOT_FOUND();

  const targets = (job.orgUnits ?? []).map((u) => u.toString());
  if (targets.length > 0) {
    const student = await UserModel.findById(studentUserId).select("orgUnit");
    const studentUnit = student?.orgUnit ? student.orgUnit.toString() : null;
    const refs = await unitRefs(scope);
    if (!studentInTarget(targets, studentUnit, refs)) {
      throw OUT_OF_SCOPE("This posting is not assigned to your cohort");
    }
  }
  return job;
}

export async function getStudentCollegePosting(
  collegeId: string,
  studentUserId: string,
  postingId: string,
): Promise<PostingDetail> {
  const now = new Date();
  const job = await requireStudentPosting(collegeId, studentUserId, postingId);
  const mine = await JobApplicationModel.findOne({
    job: job._id,
    user: new Types.ObjectId(studentUserId),
  });
  return {
    ...toPostingSummary(job, now),
    description: job.description,
    requirements: job.requirements,
    applyUrl: job.applyUrl,
    myApplication: mine
      ? {
          id: mine._id.toString(),
          status: mine.status as JobApplicationStatus,
          appliedAt: (mine.createdAt ?? now).toISOString(),
        }
      : null,
  };
}

const MONGO_DUPLICATE_KEY = 11000;
function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: number }).code === MONGO_DUPLICATE_KEY
  );
}

export async function applyToStudentCollegePosting(
  collegeId: string,
  studentUserId: string,
  postingId: string,
  input: ApplyRequest,
): Promise<ApplicationResponse> {
  // Verify tenant + published + in-target FIRST (isolation). The apply WRITE
  // reuses the engine's application model + unique index (apply-once) and the
  // shared open/deadline gate helper — it is written here rather than delegated
  // to careers.service because that path deliberately rejects college postings
  // (they must never be reachable on the individual surface).
  const now = new Date();
  const job = await requireStudentPosting(collegeId, studentUserId, postingId);

  const open = postingOpenState(
    {
      isActive: job.isActive,
      deadlineMs: job.deadline ? job.deadline.getTime() : null,
    },
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
      user: new Types.ObjectId(studentUserId),
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
