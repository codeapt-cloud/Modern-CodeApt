/**
 * Faculty-management routes — tenant-scoped at /c/:collegeSlug/faculty/... behind
 * the full tenant stack PLUS requireCollegeAdmin and the `faculty_management`
 * FEATURE entitlement. A college_admin can only manage faculty when their
 * college has that feature enabled (platform admins bypass the entitlement).
 * Mirrors college.routes.ts.
 */
import { CollegeFeature } from "@codeapt/shared";
import { Router } from "express";

import {
  createFacultyController,
  deactivateFacultyController,
  listFacultyController,
  updateFacultyController,
} from "../controllers/faculty-admin.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireFeature } from "../middleware/require-entitlement.js";
import { requireCollegeAdmin } from "../middleware/require-role.js";
import { resolveTenant } from "../middleware/resolve-tenant.js";

export const facultyRouter: Router = Router();

const facultyGate = [
  requireAuth,
  enforcePasswordChange,
  resolveTenant,
  requireCollegeAdmin,
  requireFeature(CollegeFeature.FACULTY_MANAGEMENT),
];

facultyRouter.get("/c/:collegeSlug/faculty", ...facultyGate, listFacultyController);
facultyRouter.post(
  "/c/:collegeSlug/faculty",
  ...facultyGate,
  createFacultyController,
);
facultyRouter.patch(
  "/c/:collegeSlug/faculty/:facultyId",
  ...facultyGate,
  updateFacultyController,
);
facultyRouter.delete(
  "/c/:collegeSlug/faculty/:facultyId",
  ...facultyGate,
  deactivateFacultyController,
);
