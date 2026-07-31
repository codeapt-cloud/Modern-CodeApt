/**
 * College analytics routes (Phase 5a) — tenant-scoped at /c/:collegeSlug/analytics/...
 * behind the full tenant stack PLUS the `analytics` FEATURE entitlement and
 * requireFaculty (an operator read). READ-ONLY aggregation over existing
 * tenant-scoped data; the service enforces faculty org-unit scope.
 */
import { CollegeFeature } from "@codeapt/shared";
import { Router } from "express";

import {
  analyticsByOrgUnitController,
  analyticsOverviewController,
  analyticsStudentController,
} from "../controllers/college-analytics.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireFeature } from "../middleware/require-entitlement.js";
import { requireFaculty } from "../middleware/require-role.js";
import { resolveTenant } from "../middleware/resolve-tenant.js";

export const collegeAnalyticsRouter: Router = Router();

const read = [
  requireAuth,
  enforcePasswordChange,
  resolveTenant,
  requireFeature(CollegeFeature.ANALYTICS),
  requireFaculty,
];

collegeAnalyticsRouter.get(
  "/c/:collegeSlug/analytics/overview",
  ...read,
  analyticsOverviewController,
);
collegeAnalyticsRouter.get(
  "/c/:collegeSlug/analytics/by-org-unit",
  ...read,
  analyticsByOrgUnitController,
);
collegeAnalyticsRouter.get(
  "/c/:collegeSlug/analytics/students/:studentId",
  ...read,
  analyticsStudentController,
);
