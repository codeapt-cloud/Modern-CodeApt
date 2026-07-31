/**
 * Careers routes — student surface (/careers*) + admin surface
 * (/admin/careers*). The static `/careers/applications` is registered before
 * the parameterized `/careers/:id`. Admin routes carry requireAdmin, mirroring
 * the exam-admin authoring pattern.
 */
import { Router } from "express";

import {
  adminClosePostingController,
  adminCreatePostingController,
  adminDeletePostingController,
  adminGetPostingController,
  adminListApplicationsController,
  adminListPostingsController,
  adminPublishPostingController,
  adminUpdateApplicationStatusController,
  adminUpdatePostingController,
} from "../controllers/careers-admin.controller.js";
import {
  applyController,
  getPostingController,
  listPostingsController,
  myApplicationsController,
} from "../controllers/careers.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { requireAdmin } from "../middleware/require-role.js";
import { requireAuth } from "../middleware/require-auth.js";

export const careersRouter: Router = Router();

const authed = [requireAuth, enforcePasswordChange];
const admin = [requireAuth, enforcePasswordChange, requireAdmin];

// --- Student ---
careersRouter.get("/careers", ...authed, listPostingsController);
careersRouter.get("/careers/applications", ...authed, myApplicationsController);
careersRouter.get("/careers/:id", ...authed, getPostingController);
careersRouter.post("/careers/:id/apply", ...authed, applyController);

// --- Admin ---
careersRouter.get("/admin/careers", ...admin, adminListPostingsController);
careersRouter.post("/admin/careers", ...admin, adminCreatePostingController);
careersRouter.patch(
  "/admin/careers/applications/:appId",
  ...admin,
  adminUpdateApplicationStatusController,
);
careersRouter.get("/admin/careers/:id", ...admin, adminGetPostingController);
careersRouter.patch(
  "/admin/careers/:id",
  ...admin,
  adminUpdatePostingController,
);
careersRouter.post(
  "/admin/careers/:id/publish",
  ...admin,
  adminPublishPostingController,
);
careersRouter.post(
  "/admin/careers/:id/close",
  ...admin,
  adminClosePostingController,
);
careersRouter.delete(
  "/admin/careers/:id",
  ...admin,
  adminDeletePostingController,
);
careersRouter.get(
  "/admin/careers/:id/applications",
  ...admin,
  adminListApplicationsController,
);
