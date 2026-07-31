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
  type BulkEnrollResponse,
} from "@codeapt/shared";
import { Types } from "mongoose";

import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
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
    "_id",
  );
  if (subjects.length !== uniqueIds.length) {
    throw new AppError(
      "One or more selected courses were not found",
      404,
      CurriculumErrorCode.SUBJECT_NOT_FOUND,
    );
  }
  const subjectObjectIds = subjects.map((s) => s._id);

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
          { $setOnInsert: { source: EnrollmentSource.MANUAL } },
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
