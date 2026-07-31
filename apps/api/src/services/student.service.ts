/**
 * College-student service (Phase 3) — single-add + the parse-agnostic bulk-import
 * pipeline (validate → preview → commit), all tenant-scoped AND faculty-scoped.
 *
 * A college student is a User: role=student, userType=college, college=<tenant>,
 * orgUnit=<assigned unit>, rollNumber (PER-COLLEGE unique via the compound
 * partial index), created with the shared temp password + forcePasswordChange
 * (they set their own on first login). Their login handle (username) is their
 * email. The real roll lives on User.rollNumber; the Profile carries a per-user
 * placeholder roll (`STU-<id>`) to satisfy the legacy required+global-unique
 * Profile.rollNumber index without colliding across colleges (mirrors faculty's
 * STAFF-<id>).
 *
 * Scope: a college_admin (or platform admin) is UNRESTRICTED across the tenant; a
 * faculty member may only add/see/manage students in their assigned org-units and
 * their descendants (computed with the pure collectDescendantUnitIds helper).
 *
 * The import core is PARSE-AGNOSTIC: it consumes an array of raw rows (the UI in
 * 3b produces these from a file OR a pasted table), so preview and commit share
 * one row-evaluation pass — verdicts always agree. Every query runs through
 * createTenantScope, so nothing can cross a tenant boundary.
 * See docs/MULTI_TENANT_ARCHITECTURE.md §2.
 */
import {
  COLLEGE_ADMIN_ROLES,
  collectDescendantUnitIds,
  normalizeUnitKey,
  Role,
  StudentErrorCode,
  STUDENT_IMPORT_HEADERS,
  UserType,
  validateStudentImportRow,
  type CollegeStudent,
  type CollegeStudentListQuery,
  type CreateCollegeStudentInput,
  type Role as RoleT,
  type StudentImportCommitResponse,
  type StudentImportPreviewResponse,
  type StudentImportRowInput,
  type StudentImportRowVerdict,
  type UpdateCollegeStudentInput,
} from "@codeapt/shared";
import { Types } from "mongoose";

import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import { hashPassword } from "../lib/password.js";
import { createTenantScope, type TenantScope } from "../lib/tenant-scope.js";
import { OrgUnitModel } from "../models/org-unit.model.js";
import { ProfileModel, UserModel } from "../models/user.model.js";

type UserDoc = InstanceType<typeof UserModel>;

/** The acting user (from req.auth) — enough to resolve their scope. */
export interface StudentActor {
  userId: string;
  role: RoleT;
}

function buildAvatarUrl(seed: string): string {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(
    seed,
  )}&background=random`;
}

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: number }).code === 11000
  );
}

function messageFromError(err: unknown): string {
  if (isDuplicateKeyError(err)) {
    return "Duplicate — roll number or email already exists";
  }
  return "Failed to create this student";
}

function toDTO(user: UserDoc, fullName: string): CollegeStudent {
  return {
    id: user._id.toString(),
    username: user.username,
    email: user.email,
    fullName,
    rollNumber: user.rollNumber ?? "",
    role: user.role as RoleT,
    isActive: user.isActive,
    forcePasswordChange: user.forcePasswordChange,
    orgUnitId: user.orgUnit ? user.orgUnit.toString() : null,
    createdAt: user.createdAt.toISOString(),
  };
}

// --- Actor scope -------------------------------------------------------------

export interface ActorScope {
  /** college_admin / platform admin — may act on any unit in the tenant. */
  unrestricted: boolean;
  /** For faculty: their assigned units + all descendants. */
  unitIds: Set<string>;
}

/**
 * Resolve the acting user's org-unit scope within a tenant. Shared by the
 * student service and the course-assignment service (Phase 4a) so faculty-scope
 * rules are computed one way. Exported for reuse.
 */
export async function resolveActorScope(
  scope: TenantScope,
  actor: StudentActor,
): Promise<ActorScope> {
  if (COLLEGE_ADMIN_ROLES.includes(actor.role)) {
    return { unrestricted: true, unitIds: new Set() };
  }
  const faculty = await UserModel.findById(actor.userId).select("facultyScope");
  const assigned = (faculty?.facultyScope?.orgUnits ?? []).map((id) =>
    id.toString(),
  );
  const units = await OrgUnitModel.find(scope.filter()).select("_id parent");
  const refs = units.map((u) => ({
    id: u._id.toString(),
    parentId: u.parent ? u.parent.toString() : null,
  }));
  return {
    unrestricted: false,
    unitIds: new Set(collectDescendantUnitIds(refs, assigned)),
  };
}

export function inScope(actorScope: ActorScope, orgUnitId: string): boolean {
  return actorScope.unrestricted || actorScope.unitIds.has(orgUnitId);
}

// --- Org-unit resolution index (for import references) -----------------------

interface UnitIndex {
  byPath: Map<string, string>;
  byName: Map<string, string[]>;
}

async function buildUnitIndex(scope: TenantScope): Promise<UnitIndex> {
  const units = await OrgUnitModel.find(scope.filter()).select("_id parent name");
  const info = new Map<string, { name: string; parentId: string | null }>();
  for (const u of units) {
    info.set(u._id.toString(), {
      name: u.name,
      parentId: u.parent ? u.parent.toString() : null,
    });
  }

  const pathNames = (id: string): string[] => {
    const names: string[] = [];
    const seen = new Set<string>();
    let cursor: string | null = id;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const node = info.get(cursor);
      if (!node) break;
      names.unshift(node.name);
      cursor = node.parentId;
    }
    return names;
  };

  const byPath = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const [id, node] of info) {
    byPath.set(normalizeUnitKey(pathNames(id).join(" / ")), id);
    const nameKey = normalizeUnitKey(node.name);
    const list = byName.get(nameKey) ?? [];
    list.push(id);
    byName.set(nameKey, list);
  }
  return { byPath, byName };
}

/** Resolve a raw org-unit reference (path, or unique bare name) to an id. */
function resolveUnit(
  index: UnitIndex,
  raw: string,
): { id?: string; error?: string } {
  const key = normalizeUnitKey(raw);
  const byPath = index.byPath.get(key);
  if (byPath) return { id: byPath };
  const byName = index.byName.get(key);
  if (byName && byName.length === 1) return { id: byName[0] as string };
  if (byName && byName.length > 1) {
    return {
      error: "Org-unit name is ambiguous — use the full path (e.g. CSE / 2026 / A)",
    };
  }
  return { error: "Org-unit not found in this college" };
}

// --- Shared user creation ----------------------------------------------------

async function createStudentDoc(
  scope: TenantScope,
  input: {
    fullName: string;
    email: string;
    rollNumber: string;
    orgUnitId: string;
  },
  passwordHash: string,
): Promise<CollegeStudent> {
  // Login handle = email (globally unique); roll numbers repeat across colleges
  // so they can't be the username.
  const user = await UserModel.create(
    scope.attach({
      username: input.email,
      email: input.email,
      passwordHash,
      role: Role.STUDENT,
      userType: UserType.COLLEGE,
      orgUnit: new Types.ObjectId(input.orgUnitId),
      rollNumber: input.rollNumber,
      forcePasswordChange: true,
    }),
  );
  try {
    await ProfileModel.create({
      user: user._id,
      fullName: input.fullName,
      // Placeholder roll keeps the legacy required+global-unique Profile index
      // satisfied; the real per-college roll lives on User.rollNumber.
      rollNumber: `STU-${user._id.toString()}`,
      avatarUrl: buildAvatarUrl(input.email),
    });
  } catch (err) {
    // No standalone-Mongo transactions — roll back the user to avoid an orphan.
    await UserModel.deleteOne({ _id: user._id });
    throw err;
  }
  return toDTO(user, input.fullName);
}

// --- Single-add --------------------------------------------------------------

export async function createCollegeStudent(
  collegeId: string,
  actor: StudentActor,
  input: CreateCollegeStudentInput,
): Promise<CollegeStudent> {
  const scope = createTenantScope(collegeId);
  const actorScope = await resolveActorScope(scope, actor);

  // Org-unit must exist IN THIS TENANT and be within the actor's scope.
  if (!Types.ObjectId.isValid(input.orgUnitId)) {
    throw new AppError(
      "The assigned org-unit was not found in this college",
      400,
      StudentErrorCode.ORG_UNIT_OUT_OF_SCOPE,
    );
  }
  const unit = await OrgUnitModel.findOne(
    scope.filter({ _id: input.orgUnitId }),
  ).select("_id");
  if (!unit) {
    throw new AppError(
      "The assigned org-unit was not found in this college",
      400,
      StudentErrorCode.ORG_UNIT_OUT_OF_SCOPE,
    );
  }
  if (!inScope(actorScope, input.orgUnitId)) {
    throw new AppError(
      "That org-unit is outside your assigned scope",
      403,
      StudentErrorCode.ORG_UNIT_OUT_OF_SCOPE,
    );
  }

  // Uniqueness: email is GLOBAL; roll number is PER-COLLEGE.
  if (await UserModel.exists({ email: input.email })) {
    throw new AppError(
      "Email is already registered",
      409,
      StudentErrorCode.EMAIL_TAKEN,
    );
  }
  if (await UserModel.exists({ username: input.email })) {
    throw new AppError(
      "That login is already taken",
      409,
      StudentErrorCode.USERNAME_TAKEN,
    );
  }
  if (await UserModel.exists(scope.filter({ rollNumber: input.rollNumber }))) {
    throw new AppError(
      "That roll number already exists in this college",
      409,
      StudentErrorCode.ROLL_NUMBER_TAKEN,
    );
  }

  const passwordHash = await hashPassword(env.BULK_ENROLL_DEFAULT_PASSWORD);
  try {
    return await createStudentDoc(
      scope,
      {
        fullName: input.fullName,
        email: input.email,
        rollNumber: input.rollNumber,
        orgUnitId: input.orgUnitId,
      },
      passwordHash,
    );
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new AppError(
        "That roll number or email already exists",
        409,
        StudentErrorCode.ROLL_NUMBER_TAKEN,
      );
    }
    throw err;
  }
}

// --- List (scope-aware) ------------------------------------------------------

export async function listCollegeStudents(
  collegeId: string,
  actor: StudentActor,
  query: CollegeStudentListQuery,
): Promise<{ items: CollegeStudent[]; total: number }> {
  const scope = createTenantScope(collegeId);
  const actorScope = await resolveActorScope(scope, actor);

  const filter: Record<string, unknown> = {
    role: Role.STUDENT,
    userType: UserType.COLLEGE,
  };

  if (query.orgUnitId) {
    if (
      !Types.ObjectId.isValid(query.orgUnitId) ||
      !inScope(actorScope, query.orgUnitId)
    ) {
      throw new AppError(
        "That org-unit is outside your assigned scope",
        403,
        StudentErrorCode.ORG_UNIT_OUT_OF_SCOPE,
      );
    }
    filter.orgUnit = new Types.ObjectId(query.orgUnitId);
  } else if (!actorScope.unrestricted) {
    // Faculty with no explicit filter: restrict to their in-scope units (an
    // empty scope → matches nothing, which is correct).
    filter.orgUnit = {
      $in: [...actorScope.unitIds].map((id) => new Types.ObjectId(id)),
    };
  }

  const users = await UserModel.find(scope.filter(filter)).sort({
    createdAt: -1,
  });
  const names = await ProfileModel.find({
    user: { $in: users.map((u) => u._id) },
  }).select("user fullName");
  const nameByUser = new Map(names.map((p) => [p.user.toString(), p.fullName]));

  const items = users.map((u) =>
    toDTO(u, nameByUser.get(u._id.toString()) ?? ""),
  );
  return { items, total: items.length };
}

// --- Deactivate (soft) -------------------------------------------------------

export async function deactivateCollegeStudent(
  collegeId: string,
  actor: StudentActor,
  studentId: string,
): Promise<CollegeStudent> {
  const scope = createTenantScope(collegeId);
  const actorScope = await resolveActorScope(scope, actor);
  if (!Types.ObjectId.isValid(studentId)) {
    throw new AppError(
      "Student not found",
      404,
      StudentErrorCode.STUDENT_NOT_FOUND,
    );
  }
  const user = await UserModel.findOne(
    scope.filter({ _id: studentId, role: Role.STUDENT }),
  );
  if (!user) {
    throw new AppError(
      "Student not found",
      404,
      StudentErrorCode.STUDENT_NOT_FOUND,
    );
  }
  const unitId = user.orgUnit ? user.orgUnit.toString() : null;
  if (!actorScope.unrestricted && (!unitId || !actorScope.unitIds.has(unitId))) {
    throw new AppError(
      "That student is outside your assigned scope",
      403,
      StudentErrorCode.ORG_UNIT_OUT_OF_SCOPE,
    );
  }
  user.isActive = false;
  user.tokenVersion += 1; // revoke active sessions
  await user.save();
  const profile = await ProfileModel.findOne({ user: user._id }).select(
    "fullName",
  );
  return toDTO(user, profile?.fullName ?? "");
}

// --- Edit details ------------------------------------------------------------

/**
 * Update a college student's details (name / email / roll / org-unit). All
 * fields optional. Tenant- AND faculty-scoped: the actor must already have the
 * student in scope (their CURRENT unit), and if reassigning, the TARGET unit
 * must also be in scope (mirrors createCollegeStudent). Uniqueness mirrors
 * single-add: email is GLOBAL (and doubles as the login handle), roll is
 * PER-COLLEGE — both re-checked excluding this student. Changing the email
 * revokes active sessions (the login handle moved).
 */
export async function updateCollegeStudent(
  collegeId: string,
  actor: StudentActor,
  studentId: string,
  input: UpdateCollegeStudentInput,
): Promise<CollegeStudent> {
  const scope = createTenantScope(collegeId);
  const actorScope = await resolveActorScope(scope, actor);

  if (!Types.ObjectId.isValid(studentId)) {
    throw new AppError(
      "Student not found",
      404,
      StudentErrorCode.STUDENT_NOT_FOUND,
    );
  }
  const user = await UserModel.findOne(
    scope.filter({ _id: studentId, role: Role.STUDENT }),
  );
  if (!user) {
    throw new AppError(
      "Student not found",
      404,
      StudentErrorCode.STUDENT_NOT_FOUND,
    );
  }

  // The actor must be able to act on this student (their current unit).
  const currentUnitId = user.orgUnit ? user.orgUnit.toString() : null;
  if (
    !actorScope.unrestricted &&
    (!currentUnitId || !actorScope.unitIds.has(currentUnitId))
  ) {
    throw new AppError(
      "That student is outside your assigned scope",
      403,
      StudentErrorCode.ORG_UNIT_OUT_OF_SCOPE,
    );
  }

  // Reassignment: the target unit must exist in the tenant AND be in scope.
  if (input.orgUnitId !== undefined) {
    if (!Types.ObjectId.isValid(input.orgUnitId)) {
      throw new AppError(
        "The assigned org-unit was not found in this college",
        400,
        StudentErrorCode.ORG_UNIT_OUT_OF_SCOPE,
      );
    }
    const unit = await OrgUnitModel.findOne(
      scope.filter({ _id: input.orgUnitId }),
    ).select("_id");
    if (!unit) {
      throw new AppError(
        "The assigned org-unit was not found in this college",
        400,
        StudentErrorCode.ORG_UNIT_OUT_OF_SCOPE,
      );
    }
    if (!inScope(actorScope, input.orgUnitId)) {
      throw new AppError(
        "That org-unit is outside your assigned scope",
        403,
        StudentErrorCode.ORG_UNIT_OUT_OF_SCOPE,
      );
    }
    user.orgUnit = new Types.ObjectId(input.orgUnitId);
  }

  // Email (also the login handle) — GLOBAL uniqueness, excluding this student.
  if (input.email !== undefined && input.email !== user.email) {
    if (
      await UserModel.exists({
        email: input.email,
        _id: { $ne: user._id },
      })
    ) {
      throw new AppError(
        "Email is already registered",
        409,
        StudentErrorCode.EMAIL_TAKEN,
      );
    }
    if (
      await UserModel.exists({
        username: input.email,
        _id: { $ne: user._id },
      })
    ) {
      throw new AppError(
        "That login is already taken",
        409,
        StudentErrorCode.USERNAME_TAKEN,
      );
    }
    user.email = input.email;
    user.username = input.email;
    user.tokenVersion += 1; // the login handle moved — revoke active sessions
  }

  // Roll number — PER-COLLEGE uniqueness, excluding this student.
  if (input.rollNumber !== undefined && input.rollNumber !== user.rollNumber) {
    if (
      await UserModel.exists(
        scope.filter({
          rollNumber: input.rollNumber,
          _id: { $ne: user._id },
        }),
      )
    ) {
      throw new AppError(
        "That roll number already exists in this college",
        409,
        StudentErrorCode.ROLL_NUMBER_TAKEN,
      );
    }
    user.rollNumber = input.rollNumber;
  }

  // Activation status — deactivating revokes active sessions immediately.
  if (input.isActive !== undefined) {
    user.isActive = input.isActive;
    if (!input.isActive) user.tokenVersion += 1;
  }

  try {
    await user.save();
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new AppError(
        "That roll number or email already exists",
        409,
        StudentErrorCode.ROLL_NUMBER_TAKEN,
      );
    }
    throw err;
  }

  let fullName: string | undefined;
  if (input.fullName !== undefined) {
    await ProfileModel.updateOne(
      { user: user._id },
      { $set: { fullName: input.fullName } },
    );
    fullName = input.fullName;
  } else {
    const profile = await ProfileModel.findOne({ user: user._id }).select(
      "fullName",
    );
    fullName = profile?.fullName ?? "";
  }

  return toDTO(user, fullName);
}

// --- Import pipeline (validate → preview → commit) ---------------------------

/**
 * The ONE row-evaluation pass shared by preview and commit. Runs pure field
 * validation, resolves + scope-checks the org-unit, and flags duplicates both
 * WITHIN the batch and against existing college students (per-college roll,
 * global email). No writes. Verdicts drive both the preview response and what
 * commit creates, so they can never disagree.
 */
async function evaluateRows(
  scope: TenantScope,
  actorScope: ActorScope,
  index: UnitIndex,
  rows: StudentImportRowInput[],
): Promise<StudentImportRowVerdict[]> {
  const normalized = rows.map((r) => validateStudentImportRow(r));

  const emails = [
    ...new Set(normalized.map((n) => n.value.email).filter(Boolean)),
  ];
  const rolls = [
    ...new Set(normalized.map((n) => n.value.rollNumber).filter(Boolean)),
  ];
  const existingEmails = new Set(
    (await UserModel.find({ email: { $in: emails } }).select("email")).map(
      (u) => u.email,
    ),
  );
  const existingRolls = new Set(
    (
      await UserModel.find(
        scope.filter({ rollNumber: { $in: rolls } }),
      ).select("rollNumber")
    ).map((u) => u.rollNumber),
  );

  const seenEmail = new Set<string>();
  const seenRoll = new Set<string>();
  const verdicts: StudentImportRowVerdict[] = [];

  normalized.forEach((n, i) => {
    const errors = [...n.errors];
    let orgUnitId: string | null = null;

    if (n.value.orgUnit) {
      const resolved = resolveUnit(index, n.value.orgUnit);
      if (resolved.id) {
        if (!inScope(actorScope, resolved.id)) {
          errors.push("Org-unit is outside your assigned scope");
        } else {
          orgUnitId = resolved.id;
        }
      } else {
        errors.push(resolved.error ?? "Org-unit not found in this college");
      }
    }

    if (n.value.email) {
      if (existingEmails.has(n.value.email)) {
        errors.push("Email already registered");
      }
      if (seenEmail.has(n.value.email)) {
        errors.push("Duplicate email within the import");
      }
      seenEmail.add(n.value.email);
    }
    if (n.value.rollNumber) {
      if (existingRolls.has(n.value.rollNumber)) {
        errors.push("Roll number already exists in this college");
      }
      if (seenRoll.has(n.value.rollNumber)) {
        errors.push("Duplicate roll number within the import");
      }
      seenRoll.add(n.value.rollNumber);
    }

    verdicts.push({
      index: i,
      fullName: n.value.fullName,
      email: n.value.email,
      rollNumber: n.value.rollNumber,
      orgUnit: n.value.orgUnit,
      status: errors.length === 0 ? "ok" : "error",
      errors,
      orgUnitId: errors.length === 0 ? orgUnitId : null,
    });
  });

  return verdicts;
}

export async function previewStudentImport(
  collegeId: string,
  actor: StudentActor,
  rows: StudentImportRowInput[],
): Promise<StudentImportPreviewResponse> {
  const scope = createTenantScope(collegeId);
  const [actorScope, index] = await Promise.all([
    resolveActorScope(scope, actor),
    buildUnitIndex(scope),
  ]);
  const verdicts = await evaluateRows(scope, actorScope, index, rows);
  const ok = verdicts.filter((v) => v.status === "ok").length;
  return {
    rows: verdicts,
    summary: { total: verdicts.length, ok, errors: verdicts.length - ok },
  };
}

export async function commitStudentImport(
  collegeId: string,
  actor: StudentActor,
  rows: StudentImportRowInput[],
): Promise<StudentImportCommitResponse> {
  const scope = createTenantScope(collegeId);
  const [actorScope, index] = await Promise.all([
    resolveActorScope(scope, actor),
    buildUnitIndex(scope),
  ]);
  const verdicts = await evaluateRows(scope, actorScope, index, rows);

  const created: CollegeStudent[] = [];
  const skipped: { index: number; rollNumber: string; reason: string }[] = [];
  const failed: { index: number; rollNumber: string; reason: string }[] = [];

  const passwordHash = await hashPassword(env.BULK_ENROLL_DEFAULT_PASSWORD);

  for (const v of verdicts) {
    if (v.status === "error" || !v.orgUnitId) {
      skipped.push({
        index: v.index,
        rollNumber: v.rollNumber,
        reason: v.errors[0] ?? "Invalid row",
      });
      continue;
    }
    try {
      const student = await createStudentDoc(
        scope,
        {
          fullName: v.fullName,
          email: v.email,
          rollNumber: v.rollNumber,
          orgUnitId: v.orgUnitId,
        },
        passwordHash,
      );
      created.push(student);
    } catch (err) {
      // A row that raced another writer to the same roll/email → skipped, not a
      // hard failure (idempotent-ish re-commits land here).
      if (isDuplicateKeyError(err)) {
        skipped.push({
          index: v.index,
          rollNumber: v.rollNumber,
          reason: "Duplicate — already exists",
        });
      } else {
        failed.push({
          index: v.index,
          rollNumber: v.rollNumber,
          reason: messageFromError(err),
        });
      }
    }
  }

  return {
    created,
    skipped,
    failed,
    summary: {
      created: created.length,
      skipped: skipped.length,
      failed: failed.length,
    },
  };
}

// --- Import template (downloadable CSV) --------------------------------------

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * A sample import CSV with the EXACT headers the parser/preview expect and a
 * couple of example rows. Dependency-light (hand-built), CRLF line endings for
 * spreadsheet friendliness.
 */
export function studentImportTemplateCsv(): string {
  const header = STUDENT_IMPORT_HEADERS.join(",");
  const examples = [
    ["Asha Rao", "asha.rao@college.edu", "CS2026001", "CSE / 2026 / A"],
    ["Vikram Singh", "vikram.singh@college.edu", "CS2026002", "CSE / 2026 / B"],
  ].map((cells) => cells.map(csvCell).join(","));
  return [header, ...examples].join("\r\n") + "\r\n";
}
