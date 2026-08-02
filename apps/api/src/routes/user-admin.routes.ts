/**
 * User admin routes (item 4-i reads + CRUD-batch-2 CONFIG mutations), behind the
 * admin guard stack (requireAuth + enforcePasswordChange + requireAdmin). The
 * .xlsx export is registered before the `:userId` detail route so the literal
 * path wins.
 *
 * Mutations here are CONFIG only: activate/deactivate, role, profile fields, and
 * unenroll. passwordHash / tokenVersion are never accepted (password resets use
 * the existing force-password-change flow).
 */
import { Router } from "express";

import {
  adminExportCollegePerformanceController,
  adminGetUserDetailController,
  adminListUsersController,
  adminSetUserActiveController,
  adminSetUserRoleController,
  adminUnenrollUserController,
  adminUpdateUserProfileController,
  adminResetUserPasswordController,
} from "../controllers/user-admin.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { requireAdmin } from "../middleware/require-role.js";
import { requireAuth } from "../middleware/require-auth.js";

export const userAdminRouter: Router = Router();

const admin = [requireAuth, enforcePasswordChange, requireAdmin];

userAdminRouter.get("/admin/users", ...admin, adminListUsersController);
userAdminRouter.get(
  "/admin/users/college-performance.xlsx",
  ...admin,
  adminExportCollegePerformanceController,
);
userAdminRouter.get(
  "/admin/users/:userId",
  ...admin,
  adminGetUserDetailController,
);
userAdminRouter.post(
  "/admin/users/:userId/active",
  ...admin,
  adminSetUserActiveController,
);
userAdminRouter.post(
  "/admin/users/:userId/role",
  ...admin,
  adminSetUserRoleController,
);
userAdminRouter.patch(
  "/admin/users/:userId/profile",
  ...admin,
  adminUpdateUserProfileController,
);
userAdminRouter.delete(
  "/admin/users/:userId/enrollments/:enrollmentId",
  ...admin,
  adminUnenrollUserController,
);
userAdminRouter.post(
  "/admin/users/:userId/reset-password",
  ...admin,
  adminResetUserPasswordController,
);
