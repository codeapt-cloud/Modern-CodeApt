/**
 * College course-assignment service (Phase 4a). Lets a college_admin / scoped
 * faculty assign the super-admin-GRANTED courses to their students and revoke
 * them — REUSING the existing course engine, not forking it.
 *
 * Assignment model = the existing Enrollment record, additively: a college
 * assignment is an Enrollment { user: student, subject: course, source:
 * "college", college: <tenant> }. Because the entire access/player/progress
 * engine keys off Enrollment(user, subject), an assigned college student's course
 * "just works" through the existing player with ZERO forking. Individual (B2C)
 * enrollments (college: null, source order/manual) are untouched; revoke only
 * ever deletes source:"college" rows scoped to this tenant.
 *
 * Gating: the `courses` FEATURE (route guard) AND the course being in the
 * college's grantedCourses (isCourseGranted). Faculty may only assign to students
 * within their org-unit scope. Every query goes through createTenantScope.
 * See docs/MULTI_TENANT_ARCHITECTURE.md §2.
 */
import {
  EnrollmentSource,
  Role,
  StudentErrorCode,
  TenantErrorCode,
  UserType,
  type CollegeCourse,
  type CollegeStudent,
  type CourseAssignResponse,
  type CourseRevokeResponse,
} from "@codeapt/shared";
import { Types } from "mongoose";

import { AppError } from "../errors/app-error.js";
import { computeExpiresAt } from "../lib/enrollment-access.js";
import { createTenantScope, type TenantScope } from "../lib/tenant-scope.js";
import { EnrollmentModel, SubjectModel } from "../models/curriculum.model.js";
import { ProfileModel, UserModel } from "../models/user.model.js";
import {
  inScope,
  resolveActorScope,
  type StudentActor,
} from "./student.service.js";

type UserDoc = InstanceType<typeof UserModel>;

function studentToDTO(user: UserDoc, fullName: string): CollegeStudent {
  return {
    id: user._id.toString(),
    username: user.username,
    email: user.email,
    fullName,
    rollNumber: user.rollNumber ?? "",
    role: user.role as Role,
    isActive: user.isActive,
    forcePasswordChange: user.forcePasswordChange,
    orgUnitId: user.orgUnit ? user.orgUnit.toString() : null,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Validate the course is a real Subject AND granted to this college. */
async function assertGrantedCourse(
  courseId: string,
  grantedCourseIds: string[],
): Promise<Types.ObjectId> {
  if (
    !Types.ObjectId.isValid(courseId) ||
    !grantedCourseIds.includes(courseId)
  ) {
    throw new AppError(
      "That course is not granted to your college",
      403,
      TenantErrorCode.COURSE_NOT_GRANTED,
      { courseId },
    );
  }
  const subject = await SubjectModel.findById(courseId).select("_id");
  if (!subject) {
    throw new AppError(
      "That course is not granted to your college",
      403,
      TenantErrorCode.COURSE_NOT_GRANTED,
      { courseId },
    );
  }
  return subject._id;
}

/**
 * Validate that every requested student is a college student IN THIS TENANT and
 * (for faculty) within the actor's org-unit scope. Hard-denies the whole
 * operation if any is invalid/out-of-scope. Returns their ObjectIds.
 */
async function assertStudentsInScope(
  scope: TenantScope,
  actor: StudentActor,
  studentIds: string[],
): Promise<Types.ObjectId[]> {
  const unique = [...new Set(studentIds)];
  for (const id of unique) {
    if (!Types.ObjectId.isValid(id)) {
      throw new AppError(
        "One or more students were not found in this college",
        400,
        StudentErrorCode.STUDENT_NOT_FOUND,
      );
    }
  }
  const students = await UserModel.find(
    scope.filter({
      _id: { $in: unique },
      role: Role.STUDENT,
      userType: UserType.COLLEGE,
    }),
  ).select("_id orgUnit");
  if (students.length !== unique.length) {
    throw new AppError(
      "One or more students were not found in this college",
      400,
      StudentErrorCode.STUDENT_NOT_FOUND,
    );
  }

  const actorScope = await resolveActorScope(scope, actor);
  if (!actorScope.unrestricted) {
    for (const s of students) {
      const unitId = s.orgUnit ? s.orgUnit.toString() : null;
      if (!unitId || !inScope(actorScope, unitId)) {
        throw new AppError(
          "One or more students are outside your assigned scope",
          403,
          StudentErrorCode.ORG_UNIT_OUT_OF_SCOPE,
        );
      }
    }
  }
  return students.map((s) => s._id);
}

export async function listCollegeCourses(
  collegeId: string,
  grantedCourseIds: string[],
): Promise<{ items: CollegeCourse[] }> {
  const scope = createTenantScope(collegeId);
  const ids = grantedCourseIds.filter((id) => Types.ObjectId.isValid(id));
  if (ids.length === 0) return { items: [] };

  const subjects = await SubjectModel.find({ _id: { $in: ids } }).sort({
    name: 1,
  });

  const items: CollegeCourse[] = [];
  for (const s of subjects) {
    const assignedCount = await EnrollmentModel.countDocuments(
      scope.filter({ subject: s._id, source: EnrollmentSource.COLLEGE }),
    );
    items.push({
      id: s._id.toString(),
      slug: s.slug,
      name: s.name,
      description: s.description,
      image: s.image,
      assignedCount,
    });
  }
  return { items };
}

export async function assignCourse(
  collegeId: string,
  actor: StudentActor,
  grantedCourseIds: string[],
  courseId: string,
  studentIds: string[],
): Promise<CourseAssignResponse> {
  const scope = createTenantScope(collegeId);
  const subjectId = await assertGrantedCourse(courseId, grantedCourseIds);
  const students = await assertStudentsInScope(scope, actor, studentIds);

  // Per-course access window, stamped only when a new assignment is inserted.
  const subject = await SubjectModel.findById(subjectId).select("validityDays");
  const expiresAt = computeExpiresAt(subject?.validityDays ?? 0);

  let assigned = 0;
  let alreadyAssigned = 0;
  for (const studentId of students) {
    // Idempotent: upsert on the unique (user, subject). An existing enrollment
    // (already assigned) is a no-op. $setOnInsert stamps the college + source so
    // this is unmistakably a tenant-scoped college assignment.
    const res = await EnrollmentModel.updateOne(
      { user: studentId, subject: subjectId },
      {
        $setOnInsert: {
          source: EnrollmentSource.COLLEGE,
          college: scope.collegeId,
          expiresAt,
        },
      },
      { upsert: true },
    );
    if (res.upsertedCount && res.upsertedCount > 0) assigned += 1;
    else alreadyAssigned += 1;
  }
  return { assigned, alreadyAssigned, total: students.length };
}

export async function revokeCourse(
  collegeId: string,
  actor: StudentActor,
  grantedCourseIds: string[],
  courseId: string,
  studentIds: string[],
): Promise<CourseRevokeResponse> {
  const scope = createTenantScope(collegeId);
  const subjectId = await assertGrantedCourse(courseId, grantedCourseIds);
  const students = await assertStudentsInScope(scope, actor, studentIds);

  // Scoped to source:college + this tenant, so an individual (B2C) enrollment
  // could never be deleted here.
  const res = await EnrollmentModel.deleteMany(
    scope.filter({
      subject: subjectId,
      user: { $in: students },
      source: EnrollmentSource.COLLEGE,
    }),
  );
  return { revoked: res.deletedCount ?? 0, total: students.length };
}

export async function listCourseAssignments(
  collegeId: string,
  actor: StudentActor,
  courseId: string,
): Promise<{ items: CollegeStudent[] }> {
  const scope = createTenantScope(collegeId);
  if (!Types.ObjectId.isValid(courseId)) return { items: [] };

  const enrollments = await EnrollmentModel.find(
    scope.filter({ subject: courseId, source: EnrollmentSource.COLLEGE }),
  ).select("user");
  const userIds = enrollments.map((e) => e.user);
  if (userIds.length === 0) return { items: [] };

  const actorScope = await resolveActorScope(scope, actor);
  const users = await UserModel.find(
    scope.filter({ _id: { $in: userIds }, role: Role.STUDENT }),
  ).sort({ createdAt: -1 });

  const scoped = actorScope.unrestricted
    ? users
    : users.filter((u) => {
        const unitId = u.orgUnit ? u.orgUnit.toString() : null;
        return unitId !== null && inScope(actorScope, unitId);
      });

  const names = await ProfileModel.find({
    user: { $in: scoped.map((u) => u._id) },
  }).select("user fullName");
  const nameByUser = new Map(names.map((p) => [p.user.toString(), p.fullName]));

  return {
    items: scoped.map((u) =>
      studentToDTO(u, nameByUser.get(u._id.toString()) ?? ""),
    ),
  };
}
