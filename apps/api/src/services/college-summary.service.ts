/**
 * College dashboard summary service — the ONE cheap aggregate read that powers
 * the college workspace landing (GET /c/:slug/summary). Tenant-scoped; every
 * query runs through createTenantScope so nothing crosses a tenant boundary.
 *
 * The student total + recent list REUSE listCollegeStudents, so they carry the
 * exact same actor-scope rule (a faculty member sees only their in-scope
 * students; a college_admin / platform admin sees the whole college). The other
 * counts (faculty, org-units, course assignments) are tenant-wide facts and are
 * returned regardless of which features are enabled — the client decides what to
 * surface based on entitlements. Read-only; no writes.
 * See docs/MULTI_TENANT_ARCHITECTURE.md §2.
 */
import {
  EnrollmentSource,
  Role,
  type CollegeSummaryResponse,
} from "@codeapt/shared";

import { createTenantScope } from "../lib/tenant-scope.js";
import { EnrollmentModel } from "../models/curriculum.model.js";
import { OrgUnitModel } from "../models/org-unit.model.js";
import { UserModel } from "../models/user.model.js";
import {
  listCollegeStudents,
  type StudentActor,
} from "./student.service.js";

const RECENT_STUDENTS = 5;

export async function getCollegeSummary(
  collegeId: string,
  actor: StudentActor,
  grantedCourseIds: string[],
): Promise<CollegeSummaryResponse> {
  const scope = createTenantScope(collegeId);

  // Scope-aware students (returns newest-first). One pass gives both the total
  // and the recent slice with the same faculty-scope rule as the roster.
  const { items: students, total: studentTotal } = await listCollegeStudents(
    collegeId,
    actor,
    {},
  );

  const [faculty, orgUnits, courseAssignments] = await Promise.all([
    UserModel.countDocuments(scope.filter({ role: Role.FACULTY })),
    OrgUnitModel.countDocuments(scope.filter()),
    EnrollmentModel.countDocuments(
      scope.filter({ source: EnrollmentSource.COLLEGE }),
    ),
  ]);

  return {
    counts: {
      students: studentTotal,
      faculty,
      orgUnits,
      grantedCourses: grantedCourseIds.length,
      courseAssignments,
    },
    recentStudents: students.slice(0, RECENT_STUDENTS),
  };
}
