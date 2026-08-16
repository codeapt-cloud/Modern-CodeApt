/**
 * Admin bulk-enroll — provision students from an Excel roster and enroll them
 * across one or more subjects in a single pass. Mirrors the original Django
 * roster importer, improving its two hazards:
 *   1. PER-ROW partial success with a {row, message} report (the original
 *      aborted the whole import on any exception).
 *   2. The default password is SOURCED FROM env (BULK_ENROLL_DEFAULT_PASSWORD),
 *      never a source literal — behavior is identical (shared default, forced
 *      reset on first login).
 *
 * Reuses the real auth machinery (hashPassword + User/Profile models) — no
 * hand-rolled auth. New accounts get forcePasswordChange=true; existing users
 * are enrolled without touching their password/flag. Enrollment.source =
 * "manual" (vs "order" for paid), get-or-created on the unique (user, subject).
 */
import {
  CurriculumErrorCode,
  EnrollmentSource,
  Role,
  type AdminEnrollmentAddResponse,
  type AdminEnrollmentListQuery,
  type AdminEnrollmentListResponse,
  type AdminEnrollmentRemoveResponse,
  type BulkEnrollResponse,
} from "@codeapt/shared";
import { Types, type PipelineStage } from "mongoose";

import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import { computeExpiresAt } from "../lib/enrollment-access.js";
import {
  buildEnrollmentRosterWorkbook,
  type EnrollmentRosterRow,
} from "../lib/enrollment-roster-report.js";
import { hashPassword } from "../lib/password.js";
import { parseRosterWorkbook } from "../lib/roster-excel.js";
import { EnrollmentModel, SubjectModel } from "../models/curriculum.model.js";
import { ProfileModel, UserModel } from "../models/user.model.js";

function buildAvatarUrl(username: string): string {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(
    username,
  )}&background=random`;
}

function messageFromError(err: unknown): string {
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: number }).code === 11000
  ) {
    return "Duplicate value — roll number, username, or email already in use";
  }
  return "Failed to import this row";
}

export async function bulkEnrollFromRoster(
  subjectIds: string[],
  fileBase64: string,
): Promise<BulkEnrollResponse> {
  // Validate + load the target subjects up front (fail fast on a bad id).
  const uniqueIds = [...new Set(subjectIds)];
  for (const id of uniqueIds) {
    if (!Types.ObjectId.isValid(id)) {
      throw new AppError(
        "Course not found",
        404,
        CurriculumErrorCode.SUBJECT_NOT_FOUND,
      );
    }
  }
  const subjects = await SubjectModel.find({ _id: { $in: uniqueIds } }).select(
    "_id validityDays",
  );
  if (subjects.length !== uniqueIds.length) {
    throw new AppError(
      "One or more selected courses were not found",
      404,
      CurriculumErrorCode.SUBJECT_NOT_FOUND,
    );
  }
  const subjectObjectIds = subjects.map((s) => s._id);
  // Per-course access window, applied when a NEW enrollment is inserted below.
  const validityBySubject = new Map(
    subjects.map((s) => [s._id.toString(), s.validityDays]),
  );

  const buffer = Buffer.from(fileBase64, "base64");
  const { rows, errors: parseErrors } = await parseRosterWorkbook(buffer);
  const errors: { row: number; message: string }[] = [...parseErrors];

  // Hash the shared default ONCE (env-sourced, never a literal).
  const defaultHash = await hashPassword(env.BULK_ENROLL_DEFAULT_PASSWORD);

  let createdUsers = 0;
  let enrolledCount = 0;

  for (const row of rows) {
    try {
      const username = row.username.trim();
      const email = row.email.trim().toLowerCase();
      if (!username || !email) {
        errors.push({
          row: row.rowNumber,
          message: "Missing username or email",
        });
        continue;
      }

      let user = await UserModel.findOne({ $or: [{ username }, { email }] });

      if (!user) {
        // A new account needs a roll number (unique + required on Profile).
        const rollNumber = row.rollNumber.trim();
        if (!rollNumber) {
          errors.push({
            row: row.rowNumber,
            message: "Missing roll_number (required to create a new student)",
          });
          continue;
        }
        user = await UserModel.create({
          username,
          email,
          passwordHash: defaultHash,
          role: Role.STUDENT,
          forcePasswordChange: true,
        });
        try {
          await ProfileModel.create({
            user: user._id,
            fullName: row.fullName.trim() || username,
            collegeName: row.collegeName.trim(),
            rollNumber,
            phoneNumber: row.phoneNumber.trim(),
            state: row.state.trim(),
            bio: row.bio.trim(),
            avatarUrl: buildAvatarUrl(username),
          });
        } catch (err) {
          // No standalone-Mongo transactions — roll back the user so a failed
          // profile insert (e.g. a duplicate rollNumber) leaves no orphan.
          await UserModel.deleteOne({ _id: user._id });
          throw err;
        }
        createdUsers += 1;
      } else {
        // Existing user: never touch password/flag. Update provided profile
        // fields only, and never rollNumber (unique-index conflict risk).
        const set: Record<string, string> = {};
        if (row.fullName.trim()) set.fullName = row.fullName.trim();
        if (row.collegeName.trim()) set.collegeName = row.collegeName.trim();
        if (row.phoneNumber.trim()) set.phoneNumber = row.phoneNumber.trim();
        if (row.state.trim()) set.state = row.state.trim();
        if (row.bio.trim()) set.bio = row.bio.trim();
        if (Object.keys(set).length > 0) {
          await ProfileModel.updateOne({ user: user._id }, { $set: set });
        }
      }

      // Enroll (idempotent) across every selected subject.
      for (const subjectId of subjectObjectIds) {
        const res = await EnrollmentModel.updateOne(
          { user: user._id, subject: subjectId },
          {
            $setOnInsert: {
              source: EnrollmentSource.MANUAL,
              expiresAt: computeExpiresAt(
                validityBySubject.get(subjectId.toString()) ?? 0,
              ),
            },
          },
          { upsert: true },
        );
        if (res.upsertedCount && res.upsertedCount > 0) enrolledCount += 1;
      }
    } catch (err) {
      // One bad row never aborts the import.
      errors.push({
        row: row.rowNumber,
        message: err instanceof AppError ? err.message : messageFromError(err),
      });
    }
  }

  return { createdUsers, enrolledCount, errors };
}

// --- Per-course enrollment management (admin "Manage enrollments" tab) -------

const SUBJECT_NOT_FOUND = (): AppError =>
  new AppError("Course not found", 404, CurriculumErrorCode.SUBJECT_NOT_FOUND);

/** Enrollments this admin surface may mutate — college-assigned rows are off-limits. */
const MANAGED_SOURCES = [EnrollmentSource.ORDER, EnrollmentSource.MANUAL];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function requireSubjectDoc(id: string) {
  if (!Types.ObjectId.isValid(id)) throw SUBJECT_NOT_FOUND();
  const subject = await SubjectModel.findById(id).select("name slug validityDays");
  if (!subject) throw SUBJECT_NOT_FOUND();
  return subject;
}

/** Raw shape of an enrollment joined with its user + profile. */
interface RosterAggRow {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  source: string;
  createdAt?: Date;
  expiresAt?: Date | null;
  u?: { email?: string; username?: string; rollNumber?: string };
  p?: { fullName?: string; rollNumber?: string };
}

/** Enrollment (join user+profile) → API row. */
function toRosterRow(e: RosterAggRow, now: Date): EnrollmentRosterRow & {
  enrollmentId: string;
  userId: string;
  source: "order" | "manual" | "college";
  managed: boolean;
} {
  const active = e.expiresAt == null || new Date(e.expiresAt) > now;
  return {
    enrollmentId: e._id.toString(),
    userId: e.user.toString(),
    fullName: e.p?.fullName ?? "",
    email: e.u?.email ?? "",
    rollNumber: e.p?.rollNumber || e.u?.rollNumber || "",
    source: e.source as "order" | "manual" | "college",
    enrolledAt: (e.createdAt ?? now).toISOString(),
    expiresAt: e.expiresAt ? new Date(e.expiresAt).toISOString() : null,
    active,
    managed: e.source !== EnrollmentSource.COLLEGE,
  };
}

/** The join pipeline shared by list + export (before facet/paging). */
function rosterJoinStages(
  subjectId: Types.ObjectId,
  extraMatch: Record<string, unknown>,
  opts: { q?: string; college?: string } = {},
): PipelineStage[] {
  const stages: PipelineStage[] = [
    { $match: { subject: subjectId, ...extraMatch } },
    { $lookup: { from: "users", localField: "user", foreignField: "_id", as: "u" } },
    { $unwind: "$u" },
    { $lookup: { from: "profiles", localField: "user", foreignField: "user", as: "p" } },
    { $unwind: { path: "$p", preserveNullAndEmptyArrays: true } },
  ];
  // Filters over JOINED fields must run after the lookups.
  const post: Record<string, unknown> = {};
  const term = (opts.q ?? "").trim();
  if (term) {
    const rx = new RegExp(escapeRegex(term), "i");
    post.$or = [
      { "u.email": rx },
      { "u.username": rx },
      { "u.rollNumber": rx },
      { "p.fullName": rx },
      { "p.rollNumber": rx },
    ];
  }
  if (opts.college) post["p.collegeName"] = opts.college;
  if (Object.keys(post).length > 0) stages.push({ $match: post });
  return stages;
}

function statusMatch(
  status: AdminEnrollmentListQuery["status"],
  now: Date,
): Record<string, unknown> {
  if (status === "active")
    return { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] };
  if (status === "expired") return { expiresAt: { $ne: null, $lte: now } };
  return {};
}

export async function listSubjectEnrollments(
  subjectId: string,
  query: AdminEnrollmentListQuery,
): Promise<AdminEnrollmentListResponse> {
  const subject = await requireSubjectDoc(subjectId);
  const now = new Date();
  const pipeline = rosterJoinStages(subject._id, statusMatch(query.status, now), {
    q: query.q,
    college: query.college,
  });
  pipeline.push({
    $facet: {
      items: [
        { $sort: { createdAt: -1, _id: -1 } },
        { $skip: (query.page - 1) * query.pageSize },
        { $limit: query.pageSize },
      ],
      total: [{ $count: "n" }],
    },
  });
  const [facet] = await EnrollmentModel.aggregate<{
    items: RosterAggRow[];
    total: { n: number }[];
  }>(pipeline);
  const items = (facet?.items ?? []).map((e) => {
    const row = toRosterRow(e, now);
    return {
      enrollmentId: row.enrollmentId,
      userId: row.userId,
      fullName: row.fullName,
      email: row.email,
      rollNumber: row.rollNumber,
      source: row.source,
      enrolledAt: row.enrolledAt,
      expiresAt: row.expiresAt,
      active: row.active,
      managed: row.managed,
    };
  });
  return {
    items,
    total: facet?.total?.[0]?.n ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/** Distinct, non-empty colleges among a course's enrollments (filter options). */
export async function listSubjectEnrollmentColleges(
  subjectId: string,
): Promise<{ colleges: string[] }> {
  const subject = await requireSubjectDoc(subjectId);
  const rows = await EnrollmentModel.aggregate<{ _id: string | null }>([
    { $match: { subject: subject._id } },
    { $lookup: { from: "profiles", localField: "user", foreignField: "user", as: "p" } },
    { $unwind: { path: "$p", preserveNullAndEmptyArrays: true } },
    { $group: { _id: "$p.collegeName" } },
    { $sort: { _id: 1 } },
  ]);
  return {
    colleges: rows
      .map((r) => r._id)
      .filter((c): c is string => typeof c === "string" && c.trim().length > 0),
  };
}

export async function addSubjectEnrollments(
  subjectId: string,
  userIds: string[],
): Promise<AdminEnrollmentAddResponse> {
  const subject = await requireSubjectDoc(subjectId);
  const expiresAt = computeExpiresAt(subject.validityDays);
  const uniqueIds = [...new Set(userIds)].filter((id) =>
    Types.ObjectId.isValid(id),
  );
  // Only enroll real, existing users.
  const users = await UserModel.find({ _id: { $in: uniqueIds } }).select("_id");
  let added = 0;
  for (const u of users) {
    const res = await EnrollmentModel.updateOne(
      { user: u._id, subject: subject._id },
      { $setOnInsert: { source: EnrollmentSource.MANUAL, expiresAt } },
      { upsert: true },
    );
    if (res.upsertedCount && res.upsertedCount > 0) added += 1;
  }
  return { added, skipped: uniqueIds.length - added };
}

export async function removeSubjectEnrollments(
  subjectId: string,
  userIds: string[],
): Promise<AdminEnrollmentRemoveResponse> {
  const subject = await requireSubjectDoc(subjectId);
  const ids = [...new Set(userIds)]
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));
  // College-assigned rows are protected (only order|manual are removable).
  const res = await EnrollmentModel.deleteMany({
    subject: subject._id,
    user: { $in: ids },
    source: { $in: MANAGED_SOURCES },
  });
  return { removed: res.deletedCount ?? 0 };
}

export async function setEnrollmentExpiry(
  subjectId: string,
  enrollmentId: string,
  expiresAt: string | null,
): Promise<{ updated: true }> {
  const subject = await requireSubjectDoc(subjectId);
  if (!Types.ObjectId.isValid(enrollmentId)) {
    throw new AppError(
      "Enrollment not found",
      404,
      CurriculumErrorCode.SUBJECT_NOT_FOUND,
    );
  }
  const res = await EnrollmentModel.updateOne(
    {
      _id: enrollmentId,
      subject: subject._id,
      source: { $in: MANAGED_SOURCES },
    },
    { $set: { expiresAt: expiresAt ? new Date(expiresAt) : null } },
  );
  if (res.matchedCount === 0) {
    throw new AppError(
      "Enrollment not found or not editable (college-assigned rows are protected)",
      404,
      CurriculumErrorCode.SUBJECT_NOT_FOUND,
    );
  }
  return { updated: true };
}

export async function exportSubjectEnrollments(
  subjectId: string,
): Promise<{ buffer: Buffer; filename: string }> {
  const subject = await requireSubjectDoc(subjectId);
  const now = new Date();
  const rows = await EnrollmentModel.aggregate<RosterAggRow>([
    ...rosterJoinStages(subject._id, {}),
    { $sort: { createdAt: -1, _id: -1 } },
  ]);
  const buffer = await buildEnrollmentRosterWorkbook(
    subject.name,
    rows.map((e) => {
      const r = toRosterRow(e, now);
      return {
        fullName: r.fullName,
        email: r.email,
        rollNumber: r.rollNumber,
        source: r.source,
        enrolledAt: r.enrolledAt,
        expiresAt: r.expiresAt,
        active: r.active,
      };
    }),
  );
  return { buffer, filename: `enrolments-${subject.slug}.xlsx` };
}
