/**
 * Attendance SESSION service (Prompt 2) — sessions + taking attendance on a
 * Prompt-1 group. Reuses (not forks):
 *  - createTenantScope — every read/write tenant-scoped.
 *  - getManageableGroup (attendance.service) — the canonical creator/owner/admin
 *    authority, so ONLY a group's owners/creator/admin may run its sessions.
 *  - the group's members[] as the session roster.
 *
 * Sessions are scheduled (a future date/time) OR ad-hoc ("take now" → an open
 * session immediately). Marking upserts one record per (session, student),
 * completes the session, and is re-runnable (corrections). Sessions of DIFFERENT
 * groups may share a date/time with no conflict (no global timeslot uniqueness).
 * The % denominator (Prompt 3) counts COMPLETED sessions only — supported here by
 * the status + records, computed there.
 */
import {
  AttendanceErrorCode,
  AttendanceRecordStatus,
  AttendanceSessionStatus,
  type AttendanceRosterEntry,
  type AttendanceRosterResponse,
  type AttendanceSession,
  type CreateAttendanceSessionInput,
  type SaveAttendanceInput,
  type UpdateAttendanceSessionInput,
} from "@codeapt/shared";
import { Types } from "mongoose";

import { AppError } from "../errors/app-error.js";
import { createTenantScope, type TenantScope } from "../lib/tenant-scope.js";
import type { AttendanceGroupModel } from "../models/attendance-group.model.js";
import {
  AttendanceRecordModel,
  AttendanceSessionModel,
} from "../models/attendance-session.model.js";
import { ProfileModel, UserModel } from "../models/user.model.js";
import {
  getManageableGroup,
  type AttendanceActor,
} from "./attendance.service.js";

type SessionDoc = InstanceType<typeof AttendanceSessionModel>;
type GroupDoc = InstanceType<typeof AttendanceGroupModel>;

// --- Helpers -----------------------------------------------------------------

function sessionDTO(
  session: SessionDoc,
  group: GroupDoc,
  presentCount: number,
): AttendanceSession {
  const total = group.members.length;
  const recorded = session.status === AttendanceSessionStatus.COMPLETED;
  const present = recorded ? Math.min(presentCount, total) : 0;
  return {
    id: session._id.toString(),
    groupId: group._id.toString(),
    groupName: group.name,
    title: session.title ?? "",
    scheduledAt: session.scheduledAt.toISOString(),
    status: session.status as AttendanceSession["status"],
    createdBy: session.createdBy ? session.createdBy.toString() : null,
    takenBy: session.takenBy ? session.takenBy.toString() : null,
    takenAt: session.takenAt ? session.takenAt.toISOString() : null,
    total,
    presentCount: present,
    absentCount: recorded ? Math.max(0, total - present) : 0,
    recorded,
  };
}

/** Load a session in the tenant whose group the actor may manage, or 404. */
async function loadManageableSession(
  scope: TenantScope,
  actor: AttendanceActor,
  sessionId: string,
): Promise<{ session: SessionDoc; group: GroupDoc }> {
  if (!Types.ObjectId.isValid(sessionId)) {
    throw new AppError(
      "Attendance session not found",
      404,
      AttendanceErrorCode.SESSION_NOT_FOUND,
    );
  }
  const session = await AttendanceSessionModel.findOne(
    scope.filter({ _id: sessionId }),
  );
  if (!session) {
    throw new AppError(
      "Attendance session not found",
      404,
      AttendanceErrorCode.SESSION_NOT_FOUND,
    );
  }
  // Reuse the group authority (creator/owner/admin + tenant) — a session the
  // actor may not manage is indistinguishable from "not found".
  const group = await getManageableGroup(scope, actor, session.group.toString());
  return { session, group };
}

/** Present-record count for a session, limited to the group's CURRENT members. */
async function presentCountFor(
  session: SessionDoc,
  group: GroupDoc,
): Promise<number> {
  if (session.status !== AttendanceSessionStatus.COMPLETED) return 0;
  const memberIds = new Set(group.members.map((m) => m.student.toString()));
  const records = await AttendanceRecordModel.find({
    session: session._id,
    status: AttendanceRecordStatus.PRESENT,
  }).select("student");
  return records.filter((r) => memberIds.has(r.student.toString())).length;
}

// --- Public API --------------------------------------------------------------

export async function listSessions(
  collegeId: string,
  actor: AttendanceActor,
  groupId: string,
): Promise<AttendanceSession[]> {
  const scope = createTenantScope(collegeId);
  const group = await getManageableGroup(scope, actor, groupId);
  const sessions = await AttendanceSessionModel.find(
    scope.filter({ group: group._id }),
  ).sort({ scheduledAt: -1 });
  if (sessions.length === 0) return [];

  // Present tallies for the COMPLETED sessions in one pass.
  const memberIds = new Set(group.members.map((m) => m.student.toString()));
  const records = await AttendanceRecordModel.find({
    session: { $in: sessions.map((s) => s._id) },
    status: AttendanceRecordStatus.PRESENT,
  }).select("session student");
  const presentBySession = new Map<string, number>();
  for (const r of records) {
    if (!memberIds.has(r.student.toString())) continue;
    const key = r.session.toString();
    presentBySession.set(key, (presentBySession.get(key) ?? 0) + 1);
  }
  return sessions.map((s) =>
    sessionDTO(s, group, presentBySession.get(s._id.toString()) ?? 0),
  );
}

export async function createSession(
  collegeId: string,
  actor: AttendanceActor,
  groupId: string,
  input: CreateAttendanceSessionInput,
): Promise<AttendanceSession> {
  const scope = createTenantScope(collegeId);
  const group = await getManageableGroup(scope, actor, groupId);

  // scheduledAt present → pre-scheduled; absent → ad-hoc "now" (open).
  const adHoc = !input.scheduledAt;
  const session = await AttendanceSessionModel.create(
    scope.attach({
      group: group._id,
      title: input.title ?? "",
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : new Date(),
      status: adHoc
        ? AttendanceSessionStatus.OPEN
        : AttendanceSessionStatus.SCHEDULED,
      createdBy: new Types.ObjectId(actor.userId),
    }),
  );
  return sessionDTO(session, group, 0);
}

export async function updateSession(
  collegeId: string,
  actor: AttendanceActor,
  sessionId: string,
  input: UpdateAttendanceSessionInput,
): Promise<AttendanceSession> {
  const scope = createTenantScope(collegeId);
  const { session, group } = await loadManageableSession(scope, actor, sessionId);
  if (input.title !== undefined) session.title = input.title;
  if (input.scheduledAt !== undefined) {
    session.scheduledAt = new Date(input.scheduledAt);
  }
  await session.save();
  return sessionDTO(session, group, await presentCountFor(session, group));
}

export async function deleteSession(
  collegeId: string,
  actor: AttendanceActor,
  sessionId: string,
): Promise<{ deleted: true }> {
  const scope = createTenantScope(collegeId);
  const { session } = await loadManageableSession(scope, actor, sessionId);
  // Cascade the session's records so no orphans remain.
  await AttendanceRecordModel.deleteMany(scope.filter({ session: session._id }));
  await AttendanceSessionModel.deleteOne(scope.filter({ _id: session._id }));
  return { deleted: true };
}

/** Build a roster: current members + each one's mark for THIS session. */
async function buildRoster(
  session: SessionDoc,
  group: GroupDoc,
): Promise<AttendanceRosterResponse> {
  const studentIds = group.members.map((m) => m.student);
  const [users, profiles, records] = await Promise.all([
    UserModel.find({ _id: { $in: studentIds } }).select("_id rollNumber orgUnit"),
    ProfileModel.find({ user: { $in: studentIds } }).select("user fullName"),
    AttendanceRecordModel.find({ session: session._id }).select("student status"),
  ]);
  const userById = new Map(users.map((u) => [u._id.toString(), u]));
  const nameByUser = new Map(profiles.map((p) => [p.user.toString(), p.fullName]));
  const statusByStudent = new Map(
    records.map((r) => [r.student.toString(), r.status]),
  );

  const entries: AttendanceRosterEntry[] = group.members.map((m) => {
    const sid = m.student.toString();
    const u = userById.get(sid);
    const recorded = statusByStudent.get(sid);
    return {
      studentId: sid,
      fullName: nameByUser.get(sid) ?? "",
      rollNumber: u?.rollNumber ?? "",
      orgUnitId: u?.orgUnit ? u.orgUnit.toString() : null,
      status:
        (recorded as AttendanceRosterEntry["status"]) ??
        AttendanceRecordStatus.ABSENT,
      marked: recorded !== undefined,
    };
  });
  const present = entries.filter(
    (e) => e.marked && e.status === AttendanceRecordStatus.PRESENT,
  ).length;
  return { session: sessionDTO(session, group, present), entries };
}

export async function getSessionRoster(
  collegeId: string,
  actor: AttendanceActor,
  sessionId: string,
): Promise<AttendanceRosterResponse> {
  const scope = createTenantScope(collegeId);
  const { session, group } = await loadManageableSession(scope, actor, sessionId);
  return buildRoster(session, group);
}

/**
 * Save the session's attendance. `marks` is the FINAL set; any current member
 * missing from it is recorded ABSENT so a completed session is fully recorded.
 * Upserts one record per (session, student), completes the session, and stamps
 * takenBy/takenAt. Re-runnable — a later save corrects prior marks.
 */
export async function saveAttendance(
  collegeId: string,
  actor: AttendanceActor,
  sessionId: string,
  input: SaveAttendanceInput,
): Promise<AttendanceRosterResponse> {
  const scope = createTenantScope(collegeId);
  const { session, group } = await loadManageableSession(scope, actor, sessionId);

  const memberIds = new Set(group.members.map((m) => m.student.toString()));
  // Only marks for CURRENT members count; the last mark for a student wins.
  const sent = new Map<string, AttendanceRecordStatus>();
  for (const mark of input.marks) {
    if (memberIds.has(mark.studentId)) {
      sent.set(mark.studentId, mark.status as AttendanceRecordStatus);
    }
  }

  const now = new Date();
  const markedBy = new Types.ObjectId(actor.userId);
  const ops = group.members.map((m) => {
    const sid = m.student.toString();
    const status = sent.get(sid) ?? AttendanceRecordStatus.ABSENT;
    return {
      updateOne: {
        filter: { session: session._id, student: m.student },
        update: {
          $set: { status, markedBy, markedAt: now },
          $setOnInsert: scope.attach({
            session: session._id,
            student: m.student,
          }),
        },
        upsert: true,
      },
    };
  });
  if (ops.length > 0) await AttendanceRecordModel.bulkWrite(ops);

  session.status = AttendanceSessionStatus.COMPLETED;
  session.takenBy = markedBy;
  session.takenAt = now;
  await session.save();

  return buildRoster(session, group);
}
