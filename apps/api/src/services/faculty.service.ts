/**
 * Faculty service (Phase 2) — a faculty member is a college USER: role=faculty,
 * userType=college, `college` = this tenant, with a validated
 * `facultyScope.orgUnits` set. Creation reuses the existing secure user
 * conventions (argon2 hashPassword, uniqueness checks, User+Profile with
 * rollback) and sets forcePasswordChange so the invitee sets their own password
 * on first login.
 *
 * Tenant isolation: faculty lookups run through createTenantScope (so they
 * filter by `college`), and every assigned org-unit is verified to belong to
 * THIS college — a foreign/unknown unit id is rejected. See
 * docs/MULTI_TENANT_ARCHITECTURE.md §2/§4.
 */
import {
  FacultyErrorCode,
  Role,
  UserType,
  type CreateFacultyInput,
  type Faculty,
  type UpdateFacultyInput,
} from "@codeapt/shared";
import { Types } from "mongoose";

import { AppError } from "../errors/app-error.js";
import { hashPassword } from "../lib/password.js";
import { createTenantScope, type TenantScope } from "../lib/tenant-scope.js";
import { OrgUnitModel } from "../models/org-unit.model.js";
import { ProfileModel, UserModel } from "../models/user.model.js";

type UserDoc = InstanceType<typeof UserModel>;

function buildAvatarUrl(username: string): string {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(
    username,
  )}&background=random`;
}

/**
 * Validate that every id is a real org-unit IN THIS TENANT (the scope filter
 * injects `college`, so a foreign unit simply isn't found → rejected). Returns
 * the ids as ObjectIds for storage.
 */
async function assertUnitsInTenant(
  scope: TenantScope,
  ids: string[],
): Promise<Types.ObjectId[]> {
  if (ids.length === 0) return [];
  const invalid = ids.filter((id) => !Types.ObjectId.isValid(id));
  if (invalid.length > 0) {
    throw new AppError(
      "One or more assigned org units are invalid",
      400,
      FacultyErrorCode.FACULTY_SCOPE_INVALID,
      { invalid },
    );
  }
  const unique = [...new Set(ids)];
  const found = await OrgUnitModel.find(
    scope.filter({ _id: { $in: unique } }),
  ).select("_id");
  if (found.length !== unique.length) {
    const foundIds = new Set(found.map((u) => u._id.toString()));
    throw new AppError(
      "One or more assigned org units do not belong to this college",
      400,
      FacultyErrorCode.FACULTY_SCOPE_INVALID,
      { unknown: unique.filter((id) => !foundIds.has(id)) },
    );
  }
  return unique.map((id) => new Types.ObjectId(id));
}

function toDTO(user: UserDoc, fullName: string): Faculty {
  return {
    id: user._id.toString(),
    username: user.username,
    email: user.email,
    fullName,
    role: user.role as Role,
    isActive: user.isActive,
    forcePasswordChange: user.forcePasswordChange,
    orgUnitIds: (user.facultyScope?.orgUnits ?? []).map((u) => u.toString()),
    createdAt: user.createdAt.toISOString(),
  };
}

async function fullNameFor(userId: Types.ObjectId): Promise<string> {
  const profile = await ProfileModel.findOne({ user: userId }).select(
    "fullName",
  );
  return profile?.fullName ?? "";
}

export async function createFaculty(
  collegeId: string,
  input: CreateFacultyInput,
): Promise<Faculty> {
  const scope = createTenantScope(collegeId);

  if (await UserModel.exists({ email: input.email })) {
    throw new AppError(
      "Email is already registered",
      409,
      FacultyErrorCode.EMAIL_TAKEN,
    );
  }
  if (await UserModel.exists({ username: input.username })) {
    throw new AppError(
      "Username is already taken",
      409,
      FacultyErrorCode.USERNAME_TAKEN,
    );
  }
  const orgUnits = await assertUnitsInTenant(scope, input.orgUnitIds);

  const passwordHash = await hashPassword(input.password);
  const user = await UserModel.create({
    username: input.username,
    email: input.email,
    passwordHash,
    role: Role.FACULTY,
    userType: UserType.COLLEGE,
    college: scope.collegeId,
    forcePasswordChange: true,
    facultyScope: { orgUnits },
  });

  try {
    await ProfileModel.create({
      user: user._id,
      fullName: input.fullName,
      // Faculty have no student roll number; a per-user unique placeholder keeps
      // the required + partial-unique Profile.rollNumber index satisfied.
      rollNumber: `STAFF-${user._id.toString()}`,
      avatarUrl: buildAvatarUrl(input.username),
    });
  } catch (err) {
    // No standalone-Mongo transactions — roll back the user to avoid an orphan.
    await UserModel.deleteOne({ _id: user._id });
    throw err;
  }
  return toDTO(user, input.fullName);
}

export async function listFaculty(collegeId: string): Promise<Faculty[]> {
  const scope = createTenantScope(collegeId);
  const users = await UserModel.find(
    scope.filter({ role: Role.FACULTY }),
  ).sort({ createdAt: -1 });

  const names = await ProfileModel.find({
    user: { $in: users.map((u) => u._id) },
  }).select("user fullName");
  const nameByUser = new Map(
    names.map((p) => [p.user.toString(), p.fullName]),
  );

  return users.map((u) => toDTO(u, nameByUser.get(u._id.toString()) ?? ""));
}

async function getFacultyOrThrow(
  scope: TenantScope,
  id: string,
): Promise<UserDoc> {
  if (!Types.ObjectId.isValid(id)) {
    throw new AppError(
      "Faculty not found",
      404,
      FacultyErrorCode.FACULTY_NOT_FOUND,
    );
  }
  const user = await UserModel.findOne(
    scope.filter({ _id: id, role: Role.FACULTY }),
  );
  if (!user) {
    throw new AppError(
      "Faculty not found",
      404,
      FacultyErrorCode.FACULTY_NOT_FOUND,
    );
  }
  return user;
}

export async function updateFaculty(
  collegeId: string,
  id: string,
  input: UpdateFacultyInput,
): Promise<Faculty> {
  const scope = createTenantScope(collegeId);
  const user = await getFacultyOrThrow(scope, id);

  if (input.orgUnitIds !== undefined) {
    const orgUnits = await assertUnitsInTenant(scope, input.orgUnitIds);
    user.facultyScope = { orgUnits };
  }
  if (input.isActive !== undefined) {
    user.isActive = input.isActive;
    // Deactivating revokes their active sessions immediately.
    if (!input.isActive) user.tokenVersion += 1;
  }
  await user.save();
  return toDTO(user, await fullNameFor(user._id));
}

/** Soft-deactivate a faculty member (preserves records; kills sessions). */
export async function deactivateFaculty(
  collegeId: string,
  id: string,
): Promise<Faculty> {
  const scope = createTenantScope(collegeId);
  const user = await getFacultyOrThrow(scope, id);
  user.isActive = false;
  user.tokenVersion += 1;
  await user.save();
  return toDTO(user, await fullNameFor(user._id));
}
