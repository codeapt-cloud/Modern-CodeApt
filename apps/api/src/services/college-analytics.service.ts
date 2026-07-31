/**
 * College analytics service (Phase 5a) — tenant + faculty-scoped READ-ONLY
 * aggregation over the EXISTING Phase 4 data. It changes NO engine, model, or
 * write path: it only reads tenant-scoped rows and rolls them up three ways —
 * OVERVIEW (scope level), BY ORG-UNIT (dept/section via descendant math), and
 * INDIVIDUAL (per student). Every read runs through createTenantScope, and the
 * student population is the actor's scope (a faculty member sees only their
 * in-scope students, a college_admin the whole college) — reusing
 * listCollegeStudents + resolveActorScope so the scope rule is computed one way.
 *
 * Data sources (all tenant-scoped):
 *  - exams      → StudentExamAttempt {college,user,score,passed}
 *  - essays     → EssayAttempt {college,user,finalScore,gradingStatus}
 *  - courses    → Enrollment {college,source:'college',user}  (ASSIGNMENT counts
 *                 only — the engine tracks no per-enrollment progress)
 *  - challenges → UserStreak (no college field → scoped via the college's User set)
 *
 * Only metrics the data supports are computed — no fabricated progress/completion.
 * Rich per-dimension analytics beyond this is a later Phase 5 step.
 * See docs/MULTI_TENANT_ARCHITECTURE.md §2.
 */
import {
  EnrollmentSource,
  JobStatus,
  Role,
  StudentErrorCode,
  collectDescendantUnitIds,
  type CollegeAnalyticsByUnitResponse,
  type CollegeAnalyticsOverview,
  type CollegeAnalyticsStudent,
  type CollegeAnalyticsUnit,
  type OrgUnitType,
} from "@codeapt/shared";
import { Types } from "mongoose";

import { AppError } from "../errors/app-error.js";
import {
  aggregateChallenges,
  aggregateCourses,
  aggregateEssays,
  aggregateExams,
  mean,
  type EssayRow,
  type ExamRow,
  type StreakRow,
} from "../lib/analytics-rollup.js";
import { createTenantScope, type TenantScope } from "../lib/tenant-scope.js";
import { StudentExamAttemptModel } from "../models/assessment.model.js";
import { EssayAttemptModel } from "../models/essay.model.js";
import { EnrollmentModel } from "../models/curriculum.model.js";
import { UserStreakModel } from "../models/challenge.model.js";
import { OrgUnitModel } from "../models/org-unit.model.js";
import { ProfileModel, UserModel } from "../models/user.model.js";
import {
  listCollegeStudents,
  resolveActorScope,
  type StudentActor,
} from "./student.service.js";

export type AnalyticsActor = StudentActor;

interface ScopedStudent {
  id: string;
  orgUnitId: string | null;
}

/** The actor's in-scope student population (id + org-unit), reusing the roster's
 * exact faculty-scope rule. Empty for a faculty with no in-scope students. */
async function scopedStudents(
  collegeId: string,
  actor: AnalyticsActor,
): Promise<ScopedStudent[]> {
  const { items } = await listCollegeStudents(collegeId, actor, {});
  return items.map((s) => ({ id: s.id, orgUnitId: s.orgUnitId }));
}

interface RawRows {
  exams: ExamRow[];
  essays: EssayRow[];
  courses: { userId: string }[];
  challenges: StreakRow[];
}

/** Batch-read all four data sources for a set of student ids (tenant-scoped). */
async function fetchRows(
  scope: TenantScope,
  userIds: string[],
): Promise<RawRows> {
  if (userIds.length === 0) {
    return { exams: [], essays: [], courses: [], challenges: [] };
  }
  const ids = userIds.map((id) => new Types.ObjectId(id));
  const [examDocs, essayDocs, courseDocs, streakDocs] = await Promise.all([
    StudentExamAttemptModel.find(
      scope.filter({ user: { $in: ids } }),
    ).select("user score passed"),
    EssayAttemptModel.find(
      scope.filter({ user: { $in: ids } }),
    ).select("user finalScore gradingStatus"),
    EnrollmentModel.find(
      scope.filter({ source: EnrollmentSource.COLLEGE, user: { $in: ids } }),
    ).select("user"),
    // UserStreak has no college field → tenant boundary is the userIds set.
    UserStreakModel.find({
      user: { $in: ids },
      totalScore: { $gt: 0 },
    }).select("user totalScore currentStreak maxStreak"),
  ]);

  return {
    exams: examDocs.map((d) => ({
      userId: d.user ? d.user.toString() : "",
      score: d.score,
      passed: d.passed,
    })),
    essays: essayDocs.map((d) => ({
      userId: d.user ? d.user.toString() : "",
      finalScore: d.finalScore,
      graded: d.gradingStatus === JobStatus.COMPLETED,
    })),
    courses: courseDocs.map((d) => ({
      userId: d.user ? d.user.toString() : "",
    })),
    challenges: streakDocs.map((d) => ({
      userId: d.user.toString(),
      totalScore: d.totalScore,
      currentStreak: d.currentStreak,
      maxStreak: d.maxStreak,
    })),
  };
}

function rollup(students: number, rows: RawRows) {
  return {
    students,
    exams: aggregateExams(rows.exams),
    essays: aggregateEssays(rows.essays),
    courses: aggregateCourses(rows.courses),
    challenges: aggregateChallenges(rows.challenges),
  };
}

// --- Overview ----------------------------------------------------------------

export async function analyticsOverview(
  collegeId: string,
  actor: AnalyticsActor,
): Promise<CollegeAnalyticsOverview> {
  const scope = createTenantScope(collegeId);
  const students = await scopedStudents(collegeId, actor);
  const rows = await fetchRows(
    scope,
    students.map((s) => s.id),
  );
  return rollup(students.length, rows);
}

// --- By org-unit (dept / section rollups) ------------------------------------

/** Restrict raw rows to a set of student ids. */
function rowsForUsers(rows: RawRows, userIds: Set<string>): RawRows {
  return {
    exams: rows.exams.filter((r) => userIds.has(r.userId)),
    essays: rows.essays.filter((r) => userIds.has(r.userId)),
    courses: rows.courses.filter((r) => userIds.has(r.userId)),
    challenges: rows.challenges.filter((r) => userIds.has(r.userId)),
  };
}

export async function analyticsByOrgUnit(
  collegeId: string,
  actor: AnalyticsActor,
): Promise<CollegeAnalyticsByUnitResponse> {
  const scope = createTenantScope(collegeId);
  const [actorScope, students, unitDocs] = await Promise.all([
    resolveActorScope(scope, actor),
    scopedStudents(collegeId, actor),
    OrgUnitModel.find(scope.filter()).select("_id name type parent"),
  ]);
  const rows = await fetchRows(
    scope,
    students.map((s) => s.id),
  );

  const refs = unitDocs.map((u) => ({
    id: u._id.toString(),
    parentId: u.parent ? u.parent.toString() : null,
  }));

  // The units the actor may see: whole tenant for an admin, else their subtree.
  const visibleUnits = actorScope.unrestricted
    ? unitDocs
    : unitDocs.filter((u) => actorScope.unitIds.has(u._id.toString()));

  const units: CollegeAnalyticsUnit[] = visibleUnits.map((unit) => {
    const subtree = new Set(collectDescendantUnitIds(refs, [unit._id.toString()]));
    const memberIds = new Set(
      students
        .filter((s) => s.orgUnitId !== null && subtree.has(s.orgUnitId))
        .map((s) => s.id),
    );
    const unitRows = rowsForUsers(rows, memberIds);
    return {
      id: unit._id.toString(),
      name: unit.name,
      type: unit.type as OrgUnitType,
      parentId: unit.parent ? unit.parent.toString() : null,
      ...rollup(memberIds.size, unitRows),
    };
  });

  return { units };
}

// --- Individual (per-student profile) ----------------------------------------

export async function analyticsStudent(
  collegeId: string,
  actor: AnalyticsActor,
  studentId: string,
): Promise<CollegeAnalyticsStudent> {
  const scope = createTenantScope(collegeId);
  const actorScope = await resolveActorScope(scope, actor);

  if (!Types.ObjectId.isValid(studentId)) {
    throw new AppError(
      "Student not found",
      404,
      StudentErrorCode.STUDENT_NOT_FOUND,
    );
  }
  // Tenant isolation: a student of another college is simply not found (404).
  const student = await UserModel.findOne(
    scope.filter({ _id: studentId, role: Role.STUDENT }),
  ).select("orgUnit rollNumber");
  if (!student) {
    throw new AppError(
      "Student not found",
      404,
      StudentErrorCode.STUDENT_NOT_FOUND,
    );
  }
  const unitId = student.orgUnit ? student.orgUnit.toString() : null;
  // Faculty scope: only students within the actor's units.
  if (
    !actorScope.unrestricted &&
    (!unitId || !actorScope.unitIds.has(unitId))
  ) {
    throw new AppError(
      "That student is outside your assigned scope",
      403,
      StudentErrorCode.ORG_UNIT_OUT_OF_SCOPE,
    );
  }

  const rows = await fetchRows(scope, [studentId]);
  const profile = await ProfileModel.findOne({ user: studentId }).select(
    "fullName",
  );

  const passed = rows.exams.filter((r) => r.passed).length;
  const gradedEssays = rows.essays.filter((r) => r.graded);
  const streak = rows.challenges[0] ?? null;

  return {
    id: studentId,
    name: profile?.fullName ?? "Student",
    rollNumber: student.rollNumber ?? "",
    orgUnitId: unitId,
    exams: {
      attempts: rows.exams.length,
      avgScore: mean(rows.exams.map((r) => r.score)),
      passed,
    },
    essays: {
      submissions: rows.essays.length,
      graded: gradedEssays.length,
      avgScore: mean(gradedEssays.map((r) => r.finalScore)),
    },
    courses: {
      assignments: rows.courses.length,
    },
    challenge: streak
      ? {
          totalScore: streak.totalScore,
          currentStreak: streak.currentStreak,
          maxStreak: streak.maxStreak,
        }
      : null,
  };
}
