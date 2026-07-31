/**
 * Per-student AI credit distribution routes — tenant-scoped at
 * /c/:collegeSlug/... behind the full tenant stack PLUS the `ai` FEATURE.
 *
 * Admin surface (college_admin): the distribution view, mode toggle, allocate,
 * and the reused Excel preview/template — all under `ai-credits/distribution/*`
 * (distinct from the existing operator readout at `ai-credits`). Student surface:
 * the calling student's own allocation, plain tenant stack (own-data-only).
 */
import { CollegeFeature } from "@codeapt/shared";
import { Router } from "express";

import {
  allocateStudentCreditsController,
  creditImportPreviewController,
  creditImportTemplateController,
  getCreditDistributionController,
  getMyAiCreditsController,
  setDistributionSettingsController,
} from "../controllers/student-ai-credit.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireFeature } from "../middleware/require-entitlement.js";
import { requireCollegeAdmin } from "../middleware/require-role.js";
import { resolveTenant } from "../middleware/resolve-tenant.js";

export const studentAiCreditRouter: Router = Router();

// Tenant stack + the `ai` feature.
const feature = [
  requireAuth,
  enforcePasswordChange,
  resolveTenant,
  requireFeature(CollegeFeature.AI),
];
// Admin = feature stack + college_admin authority (managing the pool).
const admin = [...feature, requireCollegeAdmin];

// --- Admin distribution management ---
studentAiCreditRouter.get(
  "/c/:collegeSlug/ai-credits/distribution",
  ...admin,
  getCreditDistributionController,
);
studentAiCreditRouter.put(
  "/c/:collegeSlug/ai-credits/distribution/settings",
  ...admin,
  setDistributionSettingsController,
);
studentAiCreditRouter.post(
  "/c/:collegeSlug/ai-credits/distribution/allocate",
  ...admin,
  allocateStudentCreditsController,
);
// Excel roll-number preview + template (reused from attendance) — literal paths.
studentAiCreditRouter.post(
  "/c/:collegeSlug/ai-credits/distribution/preview",
  ...admin,
  creditImportPreviewController,
);
studentAiCreditRouter.get(
  "/c/:collegeSlug/ai-credits/distribution/template",
  ...admin,
  creditImportTemplateController,
);

// --- Student's OWN allocation (own-data-only, any tenant member) ---
studentAiCreditRouter.get(
  "/c/:collegeSlug/student/ai-credits",
  ...feature,
  getMyAiCreditsController,
);
