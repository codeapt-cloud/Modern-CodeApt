/**
 * College provisioning routes (super_admin only) — CodeApt's control plane for
 * onboarding + configuring college tenants. Behind the platform-admin guard
 * stack (requireAuth + enforcePasswordChange + requireSuperAdmin). This is
 * backend API only; the admin UI arrives in a later phase.
 */
import { Router } from "express";

import {
  createCollegeAdminController,
  createCollegeController,
  getCollegeController,
  getCollegeCreditsController,
  grantCoursesController,
  listCollegeAdminsController,
  listCollegesController,
  revokeCoursesController,
  setCollegeCreditsController,
  setEntitlementsController,
  updateCollegeController,
} from "../controllers/college-admin.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireSuperAdmin } from "../middleware/require-role.js";

export const collegeAdminRouter: Router = Router();

const superAdmin = [requireAuth, enforcePasswordChange, requireSuperAdmin];

collegeAdminRouter.get("/admin/colleges", ...superAdmin, listCollegesController);
collegeAdminRouter.post("/admin/colleges", ...superAdmin, createCollegeController);
collegeAdminRouter.get(
  "/admin/colleges/:collegeId",
  ...superAdmin,
  getCollegeController,
);
collegeAdminRouter.patch(
  "/admin/colleges/:collegeId",
  ...superAdmin,
  updateCollegeController,
);
collegeAdminRouter.put(
  "/admin/colleges/:collegeId/entitlements",
  ...superAdmin,
  setEntitlementsController,
);
// AI credits (Stage 1) — view the live balance + set tier/override/reset.
collegeAdminRouter.get(
  "/admin/colleges/:collegeId/credits",
  ...superAdmin,
  getCollegeCreditsController,
);
collegeAdminRouter.put(
  "/admin/colleges/:collegeId/credits",
  ...superAdmin,
  setCollegeCreditsController,
);
// College admins (designate who runs a college's workspace).
collegeAdminRouter.get(
  "/admin/colleges/:collegeId/admins",
  ...superAdmin,
  listCollegeAdminsController,
);
collegeAdminRouter.post(
  "/admin/colleges/:collegeId/admins",
  ...superAdmin,
  createCollegeAdminController,
);
collegeAdminRouter.post(
  "/admin/colleges/:collegeId/courses",
  ...superAdmin,
  grantCoursesController,
);
collegeAdminRouter.delete(
  "/admin/colleges/:collegeId/courses",
  ...superAdmin,
  revokeCoursesController,
);
