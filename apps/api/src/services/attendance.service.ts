/**
 * Attendance service (Prompt 1) — tenant-scoped, faculty-scope-aware GROUP
 * formation. A group's membership is the de-duplicated UNION of everyone added
 * by any of four methods (org-unit, section, individual, Excel roll-number),
 * each member carrying the PROVENANCE of how they were added.
 *
 * Reuse (mapped, not reinvented):
 *  - createTenantScope — every read/write is tenant-scoped (no cross-tenant leak).
 *  - resolveActorScope / inScope (student.service) — faculty org-unit scope.
 *  - collectDescendantUnitIds (@codeapt/shared) — org-unit descendant math.
 *  - dedupeMembers / uniqueRollNumbers (@codeapt/shared) — union + roll cleanup.
 *  - the roll-number `$in` match against college students (mirrors evaluateRows).
 *
 * Permissions: college_admin / platform admin form ANY group (unrestricted).
 * FACULTY form groups within their scope always; forming CROSS-CUTTING / Excel
 * groups (members outside their scope) requires the college's
 * `facultyCanFormCrossCuttingGroups` permission — else a 403.
 */
import {
  AttendanceErrorCode,
  AttendanceGroupKind,
  AttendanceMemberSource,
  COLLEGE_ADMIN_ROLES,
  OrgUnitType,
  Role,
  UserType,
  collectDescendantUnitIds,
  dedupeMembers,
  isCollegeOperator,
  uniqueRollNumbers,
  type AddAttendanceMembersInput,
  type AttendanceGroup,
  type AttendanceGroupSummary,
  type AttendanceImportPreviewResponse,
  type AttendanceMember,
  type AttendanceMemberSource as MemberSourceT,
  type AttendanceSettings,
  type CreateAttendanceGroupInput,
  type MemberCandidate,
  type Role as RoleT,
  type UpdateAttendanceGroupInput,
} from "@codeapt/shared";
import { Types } from "mongoose";

import { AppError } from "../errors/app-error.js";
import { createTenantScope, type TenantScope } from "../lib/tenant-scope.js";
import { AttendanceGroupModel } from "../models/attendance-group.model.js";
import { CollegeModel } from "../models/college.model.js";
import { OrgUnitModel } from "../models/org-unit.model.js";
import { ProfileModel, UserModel } from "../models/user.model.js";
import { inScope, resolveActorScope, type ActorScope } from "./student.service.js";

type GroupDoc = InstanceType<typeof AttendanceGroupModel>;

export interface AttendanceActor {
  userId: string;
  role: RoleT;
}

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: number }).code === 11000
  );
}

// --- Formation authority -----------------------------------------------------

interface FormationScope {
  actorScope: ActorScope;
  /** True when the actor may target students OUTSIDE their org-unit scope. */
  mayCrossCut: boolean;
}

/** Load the college's cross-cutting permission (default false). */
async function loadCrossCutPermission(collegeId: string): Promise<boolean> {
  const college = await CollegeModel.findById(collegeId).select(
    "attendanceSettings",
  );
  return college?.attendanceSettings?.facultyCanFormCrossCuttingGroups === true;
}

async function resolveFormationScope(
  scope: TenantScope,
  actor: AttendanceActor,
): Promise<FormationScope> {
  const actorScope = await resolveActorScope(scope, actor);
  // Admins are unrestricted; faculty may cross-cut only with the permission.
  const mayCrossCut = actorScope.unrestricted
    ? true
    : await loadCrossCutPermission(scope.collegeId.toString());
  return { actorScope, mayCrossCut };
}

function outOfScope(): never {
  throw new AppError(
    "Some targeted students are outside your assigned scope. Ask an admin to enable cross-cutting attendance groups for faculty.",
    403,
    AttendanceErrorCode.OUT_OF_SCOPE,
  );
}

// --- Org-unit refs (descendant math) -----------------------------------------

interface UnitRef {
  id: string;
  parentId: string | null;
  type: string;
}

async function loadUnitRefs(scope: TenantScope): Promise<UnitRef[]> {
  const units = await OrgUnitModel.find(scope.filter()).select("_id parent type");
  return units.map((u) => ({
    id: u._id.toString(),
    parentId: u.parent ? u.parent.toString() : null,
    type: u.type,
  }));
}

// --- Membership resolution (the four methods → candidates) -------------------

/**
 * Resolve the membership candidates for a set of inputs. Order encodes dedupe
 * precedence: org-unit/section adds first (richest provenance), then explicit
 * individuals, then Excel-matched. Enforces scope unless the actor may cross-cut.
 */
async function resolveCandidates(
  scope: TenantScope,
  formation: FormationScope,
  input: {
    orgUnitIds?: string[];
    studentIds?: string[];
    excelRollNumbers?: string[];
  },
): Promise<MemberCandidate[]> {
  const { actorScope, mayCrossCut } = formation;
  const candidates: MemberCandidate[] = [];

  // 1) ORG-UNIT / SECTION: every student under each unit (+ descendants).
  const orgUnitIds = [...new Set(input.orgUnitIds ?? [])];
  if (orgUnitIds.length > 0) {
    const refs = await loadUnitRefs(scope);
    const typeById = new Map(refs.map((r) => [r.id, r.type]));
    for (const unitId of orgUnitIds) {
      if (!Types.ObjectId.isValid(unitId) || !typeById.has(unitId)) {
        throw new AppError(
          "An org-unit was not found in this college",
          400,
          AttendanceErrorCode.ORG_UNIT_NOT_FOUND,
        );
      }
      // A targeted unit outside scope is a cross-cutting add.
      if (!mayCrossCut && !inScope(actorScope, unitId)) outOfScope();
      const descendantIds = collectDescendantUnitIds(refs, [unitId]).map(
        (id) => new Types.ObjectId(id),
      );
      const students = await UserModel.find(
        scope.filter({
          role: Role.STUDENT,
          userType: UserType.COLLEGE,
          orgUnit: { $in: descendantIds },
        }),
      ).select("_id");
      // A section unit → `section` provenance; any other unit → `org_unit`.
      const source: MemberSourceT =
        typeById.get(unitId) === OrgUnitType.SECTION
          ? AttendanceMemberSource.SECTION
          : AttendanceMemberSource.ORG_UNIT;
      for (const s of students) {
        candidates.push({
          studentId: s._id.toString(),
          source,
          sourceRef: unitId,
        });
      }
    }
  }

  // 2) INDIVIDUAL: explicit student ids (must be college students in scope).
  const studentIds = [...new Set(input.studentIds ?? [])].filter((id) =>
    Types.ObjectId.isValid(id),
  );
  if (studentIds.length > 0) {
    const students = await UserModel.find(
      scope.filter({
        _id: { $in: studentIds.map((id) => new Types.ObjectId(id)) },
        role: Role.STUDENT,
        userType: UserType.COLLEGE,
      }),
    ).select("_id orgUnit");
    if (students.length !== studentIds.length) {
      throw new AppError(
        "A selected student was not found in this college",
        400,
        AttendanceErrorCode.STUDENT_NOT_FOUND,
      );
    }
    for (const s of students) {
      const unitId = s.orgUnit ? s.orgUnit.toString() : null;
      if (!mayCrossCut && (!unitId || !actorScope.unitIds.has(unitId))) {
        outOfScope();
      }
      candidates.push({
        studentId: s._id.toString(),
        source: AttendanceMemberSource.INDIVIDUAL,
        sourceRef: null,
      });
    }
  }

  // 3) EXCEL: roll numbers matched against the college's students. Unmatched are
  // ignored (they were surfaced in the preview). Matched out-of-scope students
  // are a cross-cutting add.
  const rolls = uniqueRollNumbers(input.excelRollNumbers ?? []);
  if (rolls.length > 0) {
    const students = await UserModel.find(
      scope.filter({
        rollNumber: { $in: rolls },
        role: Role.STUDENT,
        userType: UserType.COLLEGE,
      }),
    ).select("_id orgUnit");
    for (const s of students) {
      const unitId = s.orgUnit ? s.orgUnit.toString() : null;
      if (!mayCrossCut && (!unitId || !actorScope.unitIds.has(unitId))) {
        outOfScope();
      }
      candidates.push({
        studentId: s._id.toString(),
        source: AttendanceMemberSource.EXCEL,
        sourceRef: null,
      });
    }
  }

  return candidates;
}

/** Validate faculty-owner ids are college operators (faculty/admin) in tenant. */
async function resolveOwners(
  scope: TenantScope,
  ownerIds: string[] | undefined,
): Promise<Types.ObjectId[]> {
  const ids = [...new Set(ownerIds ?? [])].filter((id) =>
    Types.ObjectId.isValid(id),
  );
  if (ids.length === 0) return [];
  const owners = await UserModel.find(
    scope.filter({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } }),
  ).select("_id role");
  if (owners.length !== ids.length) {
    throw new AppError(
      "A selected owner was not found in this college",
      400,
      AttendanceErrorCode.STUDENT_NOT_FOUND,
    );
  }
  for (const o of owners) {
    if (!isCollegeOperator(o.role as RoleT)) {
      throw new AppError(
        "Group owners must be faculty or college admins",
        400,
        AttendanceErrorCode.STUDENT_NOT_FOUND,
      );
    }
  }
  return owners.map((o) => o._id);
}

// --- DTO shaping -------------------------------------------------------------

async function resolveOwnerDTOs(
  ownerIds: Types.ObjectId[],
): Promise<{ id: string; fullName: string }[]> {
  if (ownerIds.length === 0) return [];
  const profiles = await ProfileModel.find({
    user: { $in: ownerIds },
  }).select("user fullName");
  const nameByUser = new Map(profiles.map((p) => [p.user.toString(), p.fullName]));
  return ownerIds.map((id) => ({
    id: id.toString(),
    fullName: nameByUser.get(id.toString()) ?? "",
  }));
}

function toSummaryBase(group: GroupDoc): Omit<AttendanceGroupSummary, "owners"> {
  return {
    id: group._id.toString(),
    name: group.name,
    description: group.description ?? "",
    kind: (group.kind as AttendanceGroup["kind"]) ?? AttendanceGroupKind.CLASS,
    memberCount: group.members.length,
    createdBy: group.createdBy ? group.createdBy.toString() : null,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
}

async function toSummary(group: GroupDoc): Promise<AttendanceGroupSummary> {
  return {
    ...toSummaryBase(group),
    owners: await resolveOwnerDTOs(group.facultyOwners ?? []),
  };
}

/** Full detail: resolve member names + roll numbers for display. */
async function toDetail(group: GroupDoc): Promise<AttendanceGroup> {
  const studentIds = group.members.map((m) => m.student);
  const [users, profiles, owners] = await Promise.all([
    UserModel.find({ _id: { $in: studentIds } }).select("_id rollNumber orgUnit"),
    ProfileModel.find({ user: { $in: studentIds } }).select("user fullName"),
    resolveOwnerDTOs(group.facultyOwners ?? []),
  ]);
  const userById = new Map(users.map((u) => [u._id.toString(), u]));
  const nameByUser = new Map(profiles.map((p) => [p.user.toString(), p.fullName]));

  const members: AttendanceMember[] = group.members.map((m) => {
    const sid = m.student.toString();
    const u = userById.get(sid);
    return {
      studentId: sid,
      fullName: nameByUser.get(sid) ?? "",
      rollNumber: u?.rollNumber ?? "",
      orgUnitId: u?.orgUnit ? u.orgUnit.toString() : null,
      source: m.source as MemberSourceT,
      sourceRef: m.sourceRef ? m.sourceRef.toString() : null,
    };
  });

  return { ...toSummaryBase(group), owners, members };
}

function candidatesToSubdocs(candidates: MemberCandidate[]) {
  return candidates.map((c) => ({
    student: new Types.ObjectId(c.studentId),
    source: c.source,
    sourceRef: c.sourceRef ? new Types.ObjectId(c.sourceRef) : null,
  }));
}

// --- Access (who can see/manage a group) -------------------------------------

/**
 * Fetch a group in the tenant the actor may manage, or throw 404. This is the
 * canonical "who may act on this group" rule (creator / owner / admin) — reused
 * by the Prompt-2 session service so taking attendance obeys the same authority.
 */
export async function getManageableGroup(
  scope: TenantScope,
  actor: AttendanceActor,
  groupId: string,
): Promise<GroupDoc> {
  if (!Types.ObjectId.isValid(groupId)) {
    throw new AppError(
      "Attendance group not found",
      404,
      AttendanceErrorCode.GROUP_NOT_FOUND,
    );
  }
  const group = await AttendanceGroupModel.findOne(scope.filter({ _id: groupId }));
  if (!group) {
    throw new AppError(
      "Attendance group not found",
      404,
      AttendanceErrorCode.GROUP_NOT_FOUND,
    );
  }
  // Admins manage any group; faculty manage groups they created or own.
  if (!COLLEGE_ADMIN_ROLES.includes(actor.role)) {
    const uid = actor.userId;
    const isCreator = group.createdBy?.toString() === uid;
    const isOwner = (group.facultyOwners ?? []).some((o) => o.toString() === uid);
    if (!isCreator && !isOwner) {
      throw new AppError(
        "Attendance group not found",
        404,
        AttendanceErrorCode.GROUP_NOT_FOUND,
      );
    }
  }
  return group;
}

// --- Public API --------------------------------------------------------------

export async function listAttendanceGroups(
  collegeId: string,
  actor: AttendanceActor,
): Promise<AttendanceGroupSummary[]> {
  const scope = createTenantScope(collegeId);
  const filter: Record<string, unknown> = {};
  if (!COLLEGE_ADMIN_ROLES.includes(actor.role)) {
    const uid = new Types.ObjectId(actor.userId);
    filter.$or = [{ createdBy: uid }, { facultyOwners: uid }];
  }
  const groups = await AttendanceGroupModel.find(scope.filter(filter)).sort({
    updatedAt: -1,
  });
  return Promise.all(groups.map((g) => toSummary(g)));
}

export async function getAttendanceGroup(
  collegeId: string,
  actor: AttendanceActor,
  groupId: string,
): Promise<AttendanceGroup> {
  const scope = createTenantScope(collegeId);
  const group = await getManageableGroup(scope, actor, groupId);
  return toDetail(group);
}

export async function createAttendanceGroup(
  collegeId: string,
  actor: AttendanceActor,
  input: CreateAttendanceGroupInput,
): Promise<AttendanceGroup> {
  const scope = createTenantScope(collegeId);
  const formation = await resolveFormationScope(scope, actor);
  const [candidates, owners] = await Promise.all([
    resolveCandidates(scope, formation, input),
    resolveOwners(scope, input.facultyOwnerIds),
  ]);
  const members = candidatesToSubdocs(dedupeMembers(candidates));

  try {
    const group = await AttendanceGroupModel.create(
      scope.attach({
        name: input.name,
        description: input.description ?? "",
        kind: input.kind ?? AttendanceGroupKind.CLASS,
        createdBy: new Types.ObjectId(actor.userId),
        facultyOwners: owners,
        members,
      }),
    );
    return toDetail(group);
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new AppError(
        `An attendance group named "${input.name}" already exists`,
        409,
        AttendanceErrorCode.GROUP_NAME_TAKEN,
      );
    }
    throw err;
  }
}

export async function updateAttendanceGroup(
  collegeId: string,
  actor: AttendanceActor,
  groupId: string,
  input: UpdateAttendanceGroupInput,
): Promise<AttendanceGroup> {
  const scope = createTenantScope(collegeId);
  const group = await getManageableGroup(scope, actor, groupId);

  if (input.name !== undefined) group.name = input.name;
  if (input.description !== undefined) group.description = input.description;
  if (input.kind !== undefined) group.kind = input.kind;
  if (input.facultyOwnerIds !== undefined) {
    group.facultyOwners = await resolveOwners(scope, input.facultyOwnerIds);
  }

  // Re-resolve the WHOLE membership only when a membership field is present.
  const hasMembership =
    input.orgUnitIds !== undefined ||
    input.studentIds !== undefined ||
    input.excelRollNumbers !== undefined;
  if (hasMembership) {
    const formation = await resolveFormationScope(scope, actor);
    const candidates = await resolveCandidates(scope, formation, input);
    group.members = candidatesToSubdocs(dedupeMembers(candidates)) as never;
  }

  try {
    await group.save();
    return toDetail(group);
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new AppError(
        `An attendance group named "${group.name}" already exists`,
        409,
        AttendanceErrorCode.GROUP_NAME_TAKEN,
      );
    }
    throw err;
  }
}

export async function addAttendanceMembers(
  collegeId: string,
  actor: AttendanceActor,
  groupId: string,
  input: AddAttendanceMembersInput,
): Promise<AttendanceGroup> {
  const scope = createTenantScope(collegeId);
  const group = await getManageableGroup(scope, actor, groupId);
  const formation = await resolveFormationScope(scope, actor);
  const fresh = await resolveCandidates(scope, formation, input);

  // Union: keep EXISTING members' provenance (they come first), append the new.
  const existing: MemberCandidate[] = group.members.map((m) => ({
    studentId: m.student.toString(),
    source: m.source as MemberSourceT,
    sourceRef: m.sourceRef ? m.sourceRef.toString() : null,
  }));
  group.members = candidatesToSubdocs(
    dedupeMembers([...existing, ...fresh]),
  ) as never;
  await group.save();
  return toDetail(group);
}

export async function removeAttendanceMember(
  collegeId: string,
  actor: AttendanceActor,
  groupId: string,
  studentId: string,
): Promise<AttendanceGroup> {
  const scope = createTenantScope(collegeId);
  const group = await getManageableGroup(scope, actor, groupId);
  const before = group.members.length;
  group.members = group.members.filter(
    (m) => m.student.toString() !== studentId,
  ) as never;
  if (group.members.length === before) {
    throw new AppError(
      "That student is not a member of this group",
      404,
      AttendanceErrorCode.MEMBER_NOT_FOUND,
    );
  }
  await group.save();
  return toDetail(group);
}

export async function deleteAttendanceGroup(
  collegeId: string,
  actor: AttendanceActor,
  groupId: string,
): Promise<{ deleted: true }> {
  const scope = createTenantScope(collegeId);
  const group = await getManageableGroup(scope, actor, groupId);
  await AttendanceGroupModel.deleteOne(scope.filter({ _id: group._id }));
  return { deleted: true };
}

// --- Excel roll-number preview (matched/unmatched, NO persist) ---------------

export async function previewAttendanceRollNumbers(
  collegeId: string,
  rollNumbers: string[],
): Promise<AttendanceImportPreviewResponse> {
  const scope = createTenantScope(collegeId);
  const rolls = uniqueRollNumbers(rollNumbers);
  if (rolls.length === 0) {
    return { matched: [], unmatched: [], summary: { total: 0, matched: 0, unmatched: 0 } };
  }

  const students = await UserModel.find(
    scope.filter({
      rollNumber: { $in: rolls },
      role: Role.STUDENT,
      userType: UserType.COLLEGE,
    }),
  ).select("_id rollNumber orgUnit");
  const profiles = await ProfileModel.find({
    user: { $in: students.map((s) => s._id) },
  }).select("user fullName");
  const nameByUser = new Map(profiles.map((p) => [p.user.toString(), p.fullName]));

  const matchedByRoll = new Map<string, (typeof students)[number]>();
  for (const s of students) {
    if (s.rollNumber) matchedByRoll.set(s.rollNumber, s);
  }

  const matched = [] as AttendanceImportPreviewResponse["matched"];
  const unmatched: string[] = [];
  for (const roll of rolls) {
    const s = matchedByRoll.get(roll);
    if (s) {
      matched.push({
        studentId: s._id.toString(),
        rollNumber: roll,
        fullName: nameByUser.get(s._id.toString()) ?? "",
        orgUnitId: s.orgUnit ? s.orgUnit.toString() : null,
      });
    } else {
      unmatched.push(roll);
    }
  }

  return {
    matched,
    unmatched,
    summary: {
      total: rolls.length,
      matched: matched.length,
      unmatched: unmatched.length,
    },
  };
}

// --- Settings (the college-level cross-cutting permission) -------------------

export async function getAttendanceSettings(
  collegeId: string,
): Promise<AttendanceSettings> {
  const college = await CollegeModel.findById(collegeId).select(
    "attendanceSettings",
  );
  if (!college) {
    throw new AppError("College not found", 404, "COLLEGE_NOT_FOUND");
  }
  return {
    facultyCanFormCrossCuttingGroups:
      college.attendanceSettings?.facultyCanFormCrossCuttingGroups === true,
  };
}

export async function setAttendanceSettings(
  collegeId: string,
  input: AttendanceSettings,
): Promise<AttendanceSettings> {
  const college = await CollegeModel.findById(collegeId);
  if (!college) {
    throw new AppError("College not found", 404, "COLLEGE_NOT_FOUND");
  }
  if (!college.attendanceSettings) {
    college.attendanceSettings = {} as typeof college.attendanceSettings;
  }
  college.attendanceSettings.facultyCanFormCrossCuttingGroups =
    input.facultyCanFormCrossCuttingGroups;
  college.markModified("attendanceSettings");
  await college.save();
  return getAttendanceSettings(collegeId);
}
