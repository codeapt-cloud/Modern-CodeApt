/**
 * Attendance ANALYTICS + report data (Prompt 3) — tenant + scope, READ-ONLY
 * aggregation over the Prompt-2 records. Changes no model/write path. Mirrors the
 * Phase-5a analytics discipline: real numbers only, "no data" (null rate) never a
 * fabricated 0%, org-unit rollups via collectDescendantUnitIds.
 *
 * FAIR DENOMINATOR: every rate is over COMPLETED sessions only. `rate = present ÷
 * recorded-marks` (null when there are no recorded marks). Scope: an admin sees
 * ALL groups in the college; a faculty sees groups they created or own — the SAME
 * rule as listAttendanceGroups / getManageableGroup (attendance authority is
 * per-group, not org-unit). The org-unit VIEW rolls the visible groups' members
 * up by their orgUnit.
 */
import {
  ATTENDANCE_DEFAULT_THRESHOLD,
  AttendanceRecordStatus,
  AttendanceSessionStatus,
  COLLEGE_ADMIN_ROLES,
  attendanceRate,
  collectDescendantUnitIds,
  isBelowThreshold,
  type AttendanceAnalyticsResponse,
  type AttendanceGroupStat,
  type AttendanceStudentStat,
  type AttendanceUnitStat,
  type StudentAttendanceGroup,
  type StudentAttendanceResponse,
  type StudentAttendanceSession,
} from "@codeapt/shared";
import { Types } from "mongoose";

import { createTenantScope, type TenantScope } from "../lib/tenant-scope.js";
import { AttendanceGroupModel } from "../models/attendance-group.model.js";
import {
  AttendanceRecordModel,
  AttendanceSessionModel,
} from "../models/attendance-session.model.js";
import { OrgUnitModel } from "../models/org-unit.model.js";
import { ProfileModel, UserModel } from "../models/user.model.js";
import {
  getManageableGroup,
  type AttendanceActor,
} from "./attendance.service.js";

type GroupDoc = InstanceType<typeof AttendanceGroupModel>;

export interface AnalyticsFilters {
  threshold?: number;
  groupId?: string;
  unitId?: string;
  from?: string;
  to?: string;
}

/** The groups the actor may see: all (admin) or created/owned (faculty). */
async function visibleGroups(
  scope: TenantScope,
  actor: AttendanceActor,
): Promise<GroupDoc[]> {
  const filter: Record<string, unknown> = {};
  if (!COLLEGE_ADMIN_ROLES.includes(actor.role)) {
    const uid = new Types.ObjectId(actor.userId);
    filter.$or = [{ createdBy: uid }, { facultyOwners: uid }];
  }
  return AttendanceGroupModel.find(scope.filter(filter));
}

interface Aggregate {
  present: number;
  total: number;
}
const empty = (): Aggregate => ({ present: 0, total: 0 });

/**
 * The core aggregation over the actor's visible groups (optionally filtered by a
 * single group, an org-unit subtree, and/or a session date range). Everything is
 * derived from records in COMPLETED sessions.
 */
async function analyze(
  collegeId: string,
  actor: AttendanceActor,
  filters: AnalyticsFilters,
): Promise<AttendanceAnalyticsResponse> {
  const scope = createTenantScope(collegeId);
  const threshold = filters.threshold ?? ATTENDANCE_DEFAULT_THRESHOLD;

  let groups = await visibleGroups(scope, actor);
  if (filters.groupId) {
    groups = groups.filter((g) => g._id.toString() === filters.groupId);
  }

  // Completed sessions of the visible groups (optionally within a date range).
  const sessionFilter: Record<string, unknown> = {
    group: { $in: groups.map((g) => g._id) },
    status: AttendanceSessionStatus.COMPLETED,
  };
  if (filters.from || filters.to) {
    const range: Record<string, Date> = {};
    if (filters.from) range.$gte = new Date(filters.from);
    if (filters.to) range.$lte = new Date(filters.to);
    sessionFilter.scheduledAt = range;
  }
  const sessions =
    groups.length === 0
      ? []
      : await AttendanceSessionModel.find(scope.filter(sessionFilter)).select(
          "_id group",
        );
  const sessionGroup = new Map(
    sessions.map((s) => [s._id.toString(), s.group.toString()]),
  );
  const sessionsByGroup = new Map<string, number>();
  for (const s of sessions) {
    const g = s.group.toString();
    sessionsByGroup.set(g, (sessionsByGroup.get(g) ?? 0) + 1);
  }

  const records =
    sessions.length === 0
      ? []
      : await AttendanceRecordModel.find(
          scope.filter({ session: { $in: sessions.map((s) => s._id) } }),
        ).select("session student status");

  // Members of the visible groups (the roster the by-student list covers) + who
  // they are (name / roll / org-unit).
  const memberIdSet = new Set<string>();
  for (const g of groups) {
    for (const m of g.members) memberIdSet.add(m.student.toString());
  }
  const memberIds = [...memberIdSet].map((id) => new Types.ObjectId(id));
  const [users, profiles] = await Promise.all([
    UserModel.find({ _id: { $in: memberIds } }).select("_id rollNumber orgUnit"),
    ProfileModel.find({ user: { $in: memberIds } }).select("user fullName"),
  ]);
  const orgUnitByStudent = new Map(
    users.map((u) => [u._id.toString(), u.orgUnit ? u.orgUnit.toString() : null]),
  );
  const rollByStudent = new Map(users.map((u) => [u._id.toString(), u.rollNumber ?? ""]));
  const nameByStudent = new Map(profiles.map((p) => [p.user.toString(), p.fullName]));

  // Optional org-unit filter: restrict the population to a unit's subtree.
  const unitRefs = await OrgUnitModel.find(scope.filter()).select("_id name type parent");
  const refs = unitRefs.map((u) => ({
    id: u._id.toString(),
    parentId: u.parent ? u.parent.toString() : null,
  }));
  let population = [...memberIdSet];
  if (filters.unitId) {
    const subtree = new Set(collectDescendantUnitIds(refs, [filters.unitId]));
    population = population.filter((id) => {
      const unit = orgUnitByStudent.get(id);
      return unit !== null && unit !== undefined && subtree.has(unit);
    });
  }
  const populationSet = new Set(population);

  // Tally records → per-student and per-group aggregates (only for the
  // population; a filtered-out student's marks don't count).
  const perStudent = new Map<string, Aggregate>();
  const perGroup = new Map<string, Aggregate>();
  let present = 0;
  let totalMarks = 0;
  for (const r of records) {
    const sid = r.student.toString();
    if (!populationSet.has(sid)) continue;
    const isPresent = r.status === AttendanceRecordStatus.PRESENT;
    const gid = sessionGroup.get(r.session.toString());

    totalMarks += 1;
    if (isPresent) present += 1;

    const ps = perStudent.get(sid) ?? empty();
    ps.total += 1;
    if (isPresent) ps.present += 1;
    perStudent.set(sid, ps);

    if (gid) {
      const pg = perGroup.get(gid) ?? empty();
      pg.total += 1;
      if (isPresent) pg.present += 1;
      perGroup.set(gid, pg);
    }
  }

  // BY STUDENT (full roster; no-data students carry a null rate).
  const students: AttendanceStudentStat[] = population.map((sid) => {
    const agg = perStudent.get(sid) ?? empty();
    const rate = attendanceRate(agg.present, agg.total);
    return {
      studentId: sid,
      name: nameByStudent.get(sid) ?? "",
      rollNumber: rollByStudent.get(sid) ?? "",
      orgUnitId: orgUnitByStudent.get(sid) ?? null,
      attended: agg.present,
      total: agg.total,
      rate,
      below: isBelowThreshold(rate, threshold),
    };
  });
  students.sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101)); // worst first

  // BY GROUP.
  const groupStats: AttendanceGroupStat[] = groups.map((g) => {
    const gid = g._id.toString();
    const agg = perGroup.get(gid) ?? empty();
    return {
      groupId: gid,
      name: g.name,
      kind: g.kind as AttendanceGroupStat["kind"],
      memberCount: g.members.length,
      sessionsHeld: sessionsByGroup.get(gid) ?? 0,
      present: agg.present,
      total: agg.total,
      rate: attendanceRate(agg.present, agg.total),
    };
  });

  // BY ORG-UNIT (rollup over the population by each unit's subtree).
  const units: AttendanceUnitStat[] = unitRefs.map((unit) => {
    const subtree = new Set(collectDescendantUnitIds(refs, [unit._id.toString()]));
    const agg = empty();
    let tracked = 0;
    for (const sid of population) {
      const unitId = orgUnitByStudent.get(sid);
      if (!unitId || !subtree.has(unitId)) continue;
      const ps = perStudent.get(sid);
      if (ps && ps.total > 0) {
        agg.present += ps.present;
        agg.total += ps.total;
        tracked += 1;
      }
    }
    return {
      id: unit._id.toString(),
      name: unit.name,
      type: unit.type,
      parentId: unit.parent ? unit.parent.toString() : null,
      students: tracked,
      present: agg.present,
      total: agg.total,
      rate: attendanceRate(agg.present, agg.total),
    };
  });

  const studentsTracked = [...perStudent.values()].filter((a) => a.total > 0).length;
  const belowThreshold = students.filter((s) => s.below).length;

  return {
    overview: {
      groups: groups.length,
      sessionsHeld: sessions.length,
      totalMarks,
      present,
      overallRate: attendanceRate(present, totalMarks),
      studentsTracked,
      belowThreshold,
      threshold,
    },
    groups: groupStats,
    units,
    students,
    threshold,
  };
}

/** The dashboard payload (whole college / scope, at a threshold). */
export async function getAttendanceAnalytics(
  collegeId: string,
  actor: AttendanceActor,
  threshold?: number,
): Promise<AttendanceAnalyticsResponse> {
  return analyze(collegeId, actor, { threshold });
}

// --- Report data -------------------------------------------------------------

export interface RegisterReport {
  groupName: string;
  sessions: { id: string; label: string; scheduledAt: string }[];
  rows: {
    name: string;
    rollNumber: string;
    cells: ("P" | "A" | "")[];
    present: number;
    total: number;
    rate: number | null;
  }[];
  sessionPresent: number[];
}

/** The classic P/A register grid for ONE group (students × completed sessions). */
export async function groupRegisterData(
  collegeId: string,
  actor: AttendanceActor,
  groupId: string,
): Promise<RegisterReport> {
  const scope = createTenantScope(collegeId);
  // Authority: only the group's owner/creator/admin may pull its register.
  const group = await getManageableGroup(scope, actor, groupId);

  const sessions = await AttendanceSessionModel.find(
    scope.filter({
      group: group._id,
      status: AttendanceSessionStatus.COMPLETED,
    }),
  )
    .select("_id scheduledAt title")
    .sort({ scheduledAt: 1 });
  const sessionIds = sessions.map((s) => s._id);

  const records = await AttendanceRecordModel.find(
    scope.filter({ session: { $in: sessionIds } }),
  ).select("session student status");
  const markByKey = new Map<string, string>();
  for (const r of records) {
    markByKey.set(`${r.session.toString()}:${r.student.toString()}`, r.status);
  }

  const studentIds = group.members.map((m) => m.student);
  const [users, profiles] = await Promise.all([
    UserModel.find({ _id: { $in: studentIds } }).select("_id rollNumber"),
    ProfileModel.find({ user: { $in: studentIds } }).select("user fullName"),
  ]);
  const rollById = new Map(users.map((u) => [u._id.toString(), u.rollNumber ?? ""]));
  const nameById = new Map(profiles.map((p) => [p.user.toString(), p.fullName]));

  const sessionPresent = sessions.map(() => 0);
  const rows = group.members.map((m) => {
    const sid = m.student.toString();
    let presentCount = 0;
    let total = 0;
    const cells = sessions.map((s, i): "P" | "A" | "" => {
      const mark = markByKey.get(`${s._id.toString()}:${sid}`);
      if (mark === undefined) return "";
      total += 1;
      if (mark === AttendanceRecordStatus.PRESENT) {
        presentCount += 1;
        sessionPresent[i] = (sessionPresent[i] ?? 0) + 1;
        return "P";
      }
      return "A";
    });
    return {
      name: nameById.get(sid) ?? "",
      rollNumber: rollById.get(sid) ?? "",
      cells,
      present: presentCount,
      total,
      rate: attendanceRate(presentCount, total),
    };
  });

  return {
    groupName: group.name,
    sessions: sessions.map((s) => ({
      id: s._id.toString(),
      label: s.title || new Date(s.scheduledAt).toISOString().slice(0, 10),
      scheduledAt: s.scheduledAt.toISOString(),
    })),
    rows,
    sessionPresent,
  };
}

export interface SummaryReport {
  threshold: number;
  students: AttendanceStudentStat[];
  groups: AttendanceGroupStat[];
  defaulters: AttendanceStudentStat[];
}

/** Per-student % + per-group rates + the defaulters, honoring optional filters. */
export async function summaryData(
  collegeId: string,
  actor: AttendanceActor,
  filters: AnalyticsFilters,
): Promise<SummaryReport> {
  const result = await analyze(collegeId, actor, filters);
  return {
    threshold: result.threshold,
    students: result.students,
    groups: result.groups,
    defaulters: result.students.filter((s) => s.below),
  };
}

// --- Student's OWN attendance (own-data-only, reuses the per-student math) ----

/**
 * A single college student's own attendance: overall + per-group % and a
 * present/absent session history, over COMPLETED sessions of the groups they're
 * in. `studentId` is ALWAYS the authenticated caller (own-data-only) — this
 * function never accepts another student's id from the client. Record-centric
 * (the same fair denominator as the admin analytics): a scheduled-never-taken
 * session has no record and doesn't count; no records → rate null ("no data").
 */
export async function getStudentAttendance(
  collegeId: string,
  studentId: string,
): Promise<StudentAttendanceResponse> {
  const scope = createTenantScope(collegeId);
  const sid = new Types.ObjectId(studentId);

  // The groups this student is a member of.
  const groups = await AttendanceGroupModel.find(
    scope.filter({ "members.student": sid }),
  ).select("_id name kind");
  if (groups.length === 0) {
    return { overall: { attended: 0, total: 0, rate: null }, groups: [], sessions: [] };
  }
  const groupById = new Map(groups.map((g) => [g._id.toString(), g]));

  // Completed sessions of those groups.
  const sessions = await AttendanceSessionModel.find(
    scope.filter({
      group: { $in: groups.map((g) => g._id) },
      status: AttendanceSessionStatus.COMPLETED,
    }),
  ).select("_id group title scheduledAt");
  const sessionById = new Map(sessions.map((s) => [s._id.toString(), s]));

  // THIS student's records in those completed sessions.
  const records =
    sessions.length === 0
      ? []
      : await AttendanceRecordModel.find(
          scope.filter({
            student: sid,
            session: { $in: sessions.map((s) => s._id) },
          }),
        ).select("session status");

  let attended = 0;
  const perGroup = new Map<string, { present: number; total: number }>();
  const history: StudentAttendanceSession[] = [];
  for (const r of records) {
    const session = sessionById.get(r.session.toString());
    if (!session) continue;
    const gid = session.group.toString();
    const group = groupById.get(gid);
    const isPresent = r.status === AttendanceRecordStatus.PRESENT;
    if (isPresent) attended += 1;

    const pg = perGroup.get(gid) ?? { present: 0, total: 0 };
    pg.total += 1;
    if (isPresent) pg.present += 1;
    perGroup.set(gid, pg);

    history.push({
      sessionId: session._id.toString(),
      groupName: group?.name ?? "",
      title: session.title ?? "",
      scheduledAt: session.scheduledAt.toISOString(),
      status: r.status as StudentAttendanceSession["status"],
    });
  }
  history.sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt)); // newest first

  const groupStats: StudentAttendanceGroup[] = groups.map((g) => {
    const agg = perGroup.get(g._id.toString()) ?? { present: 0, total: 0 };
    return {
      groupId: g._id.toString(),
      name: g.name,
      kind: g.kind as StudentAttendanceGroup["kind"],
      attended: agg.present,
      total: agg.total,
      rate: attendanceRate(agg.present, agg.total),
    };
  });

  return {
    overall: {
      attended,
      total: records.length,
      rate: attendanceRate(attended, records.length),
    },
    groups: groupStats,
    sessions: history,
  };
}
