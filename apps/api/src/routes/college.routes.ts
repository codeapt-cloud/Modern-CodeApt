/**
 * Tenant-scoped college routes — path-based tenancy at /c/:collegeSlug/... (the
 * spine that later college-facing phases mount under). Every route runs the
 * full tenant stack: requireAuth → enforcePasswordChange → resolveTenant, which
 * validates the caller belongs to (or is a platform admin over) the college and
 * attaches `req.tenant`.
 *
 * `GET .../context`  — resolved tenant identity + membership + entitlements.
 * `GET .../summary`  — dashboard aggregate counts + recent students (operators).
 * `GET .../courses`  — the college's granted master-catalog courses; gated by
 *                      the `courses` FEATURE entitlement (demonstrates the
 *                      entitlement guard end-to-end).
 */
import { CollegeFeature } from "@codeapt/shared";
import { Router } from "express";

import {
  getCollegeAiCreditsController,
  getCollegeContextController,
  getCollegeStudentCoursesController,
  getCollegeStudentSummaryController,
  getCollegeSummaryController,
  getMyAttendanceController,
  listGrantedCoursesController,
} from "../controllers/college-context.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireFeature } from "../middleware/require-entitlement.js";
import { requireFaculty } from "../middleware/require-role.js";
import { resolveTenant } from "../middleware/resolve-tenant.js";

export const collegeRouter: Router = Router();

const tenant = [requireAuth, enforcePasswordChange, resolveTenant];

collegeRouter.get(
  "/c/:collegeSlug/context",
  ...tenant,
  getCollegeContextController,
);
// Dashboard summary — operators only (faculty and above); a college student
// belongs to the tenant but doesn't get the admin aggregate view.
collegeRouter.get(
  "/c/:collegeSlug/summary",
  ...tenant,
  requireFaculty,
  getCollegeSummaryController,
);
collegeRouter.get(
  "/c/:collegeSlug/courses",
  ...tenant,
  requireFeature(CollegeFeature.COURSES),
  listGrantedCoursesController,
);
// AI-credit balance readout — operators only (view; can't change). Not gated by
// the AI feature so operators can always SEE their budget/usage.
collegeRouter.get(
  "/c/:collegeSlug/ai-credits",
  ...tenant,
  requireFaculty,
  getCollegeAiCreditsController,
);
// Student home summary — any tenant member (students included); counts computed
// for the calling user + gated by the college's entitlements.
collegeRouter.get(
  "/c/:collegeSlug/student/summary",
  ...tenant,
  getCollegeStudentSummaryController,
);
// Student's assigned college courses — the "My courses" list (calling user).
collegeRouter.get(
  "/c/:collegeSlug/student/courses",
  ...tenant,
  getCollegeStudentCoursesController,
);
// The calling student's OWN attendance (own-data-only) — feature-gated.
collegeRouter.get(
  "/c/:collegeSlug/student/attendance",
  ...tenant,
  requireFeature(CollegeFeature.ATTENDANCE),
  getMyAttendanceController,
);
