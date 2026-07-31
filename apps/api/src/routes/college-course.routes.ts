/**
 * College course-assignment routes — tenant-scoped at /c/:collegeSlug/courses/...
 * behind the full tenant stack PLUS the `courses` FEATURE entitlement. Lets a
 * college_admin / scoped faculty assign granted courses to their students.
 *
 * NB: the bare `GET /c/:slug/courses` (granted-course list spine) lives on
 * college.routes.ts; these management endpoints use distinct sub-paths
 * (`/courses/catalog`, `/courses/:courseId/...`) so they never collide with it.
 * Reuses the existing course engine — no forked player.
 */
import { CollegeFeature } from "@codeapt/shared";
import { Router } from "express";

import {
  assignCourseController,
  listCollegeCoursesController,
  listCourseAssignmentsController,
  revokeCourseController,
} from "../controllers/college-course-admin.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireFeature } from "../middleware/require-entitlement.js";
import { requireFaculty } from "../middleware/require-role.js";
import { resolveTenant } from "../middleware/resolve-tenant.js";

export const collegeCourseRouter: Router = Router();

const gate = [
  requireAuth,
  enforcePasswordChange,
  resolveTenant,
  requireFaculty,
  requireFeature(CollegeFeature.COURSES),
];

// Granted courses + assignment counts.
collegeCourseRouter.get(
  "/c/:collegeSlug/courses/catalog",
  ...gate,
  listCollegeCoursesController,
);
// Who is assigned a given course (tenant + faculty-scope filtered).
collegeCourseRouter.get(
  "/c/:collegeSlug/courses/:courseId/students",
  ...gate,
  listCourseAssignmentsController,
);
// Assign / revoke a granted course to/from a set of students.
collegeCourseRouter.post(
  "/c/:collegeSlug/courses/:courseId/assign",
  ...gate,
  assignCourseController,
);
collegeCourseRouter.post(
  "/c/:collegeSlug/courses/:courseId/revoke",
  ...gate,
  revokeCourseController,
);
