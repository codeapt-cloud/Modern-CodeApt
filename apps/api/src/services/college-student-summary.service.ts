/**
 * College STUDENT home summary — the overview counts behind the student
 * dashboard cards. It REUSES the existing tenant- and cohort-scoped student
 * services (nothing new about WHAT a student can see), and only computes a count
 * for a feature the college is actually entitled to (an off feature returns 0,
 * and the dashboard omits that card). Read-only; every query is tenant-scoped via
 * createTenantScope / the reused services, so there is no cross-tenant leakage.
 *
 * Sources:
 *   - courses  : college enrollments for this student (source=college).
 *   - exams    : published exams targeting the student's org-unit.
 *   - essays   : published essay prompts targeting the student's org-unit.
 *   - postings : open (published + active + not-past-deadline) postings for the
 *                student's cohort.
 */
import {
  CollegeFeature,
  EnrollmentSource,
  checkEntitlement,
  type CollegeEntitlements,
  type CollegeStudentSummaryResponse,
} from "@codeapt/shared";
import { Types } from "mongoose";

import { createTenantScope } from "../lib/tenant-scope.js";
import { EnrollmentModel } from "../models/curriculum.model.js";
import { listStudentCollegePostings } from "./college-careers.service.js";
import { listStudentCollegeEssays } from "./college-essay.service.js";
import { listStudentCollegeExams } from "./college-exam.service.js";

export async function getCollegeStudentSummary(
  collegeId: string,
  studentUserId: string,
  entitlements: CollegeEntitlements,
): Promise<CollegeStudentSummaryResponse> {
  const scope = createTenantScope(collegeId);

  const coursesOn = checkEntitlement(entitlements, CollegeFeature.COURSES);
  const examsOn = checkEntitlement(entitlements, CollegeFeature.EXAMS);
  const essaysOn = checkEntitlement(entitlements, CollegeFeature.ESSAYS);
  const postingsOn = checkEntitlement(entitlements, CollegeFeature.POSTINGS);

  const [courses, exams, essays, postings] = await Promise.all([
    coursesOn
      ? EnrollmentModel.countDocuments(
          scope.filter({
            user: new Types.ObjectId(studentUserId),
            source: EnrollmentSource.COLLEGE,
          }),
        )
      : Promise.resolve(0),
    examsOn
      ? listStudentCollegeExams(collegeId, studentUserId).then(
          (r) => r.items.length,
        )
      : Promise.resolve(0),
    essaysOn
      ? listStudentCollegeEssays(collegeId, studentUserId).then(
          (r) => r.items.length,
        )
      : Promise.resolve(0),
    postingsOn
      ? listStudentCollegePostings(collegeId, studentUserId).then(
          (r) => r.items.length,
        )
      : Promise.resolve(0),
  ]);

  return { courses, exams, essays, postings };
}
