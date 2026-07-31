/**
 * Essay-analytics admin routes (item 4-ii) — read/reporting, behind the admin
 * guard stack (requireAuth + enforcePasswordChange + requireAdmin).
 */
import { Router } from "express";

import {
  adminGetEssayAttemptAnalyticsController,
  adminListEssayAnalyticsController,
} from "../controllers/essay-analytics-admin.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { requireAdmin } from "../middleware/require-role.js";
import { requireAuth } from "../middleware/require-auth.js";

export const essayAnalyticsAdminRouter: Router = Router();

const admin = [requireAuth, enforcePasswordChange, requireAdmin];

essayAnalyticsAdminRouter.get(
  "/admin/essay-analytics",
  ...admin,
  adminListEssayAnalyticsController,
);
essayAnalyticsAdminRouter.get(
  "/admin/essay-analytics/:attemptId",
  ...admin,
  adminGetEssayAttemptAnalyticsController,
);
