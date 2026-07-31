/**
 * Org-structure routes — tenant-scoped at /c/:collegeSlug/org-units/... behind
 * the full tenant stack (requireAuth → enforcePasswordChange → resolveTenant).
 * Org-structure is FOUNDATIONAL (not feature-gated): writes require
 * college_admin; the tree read is allowed to faculty too, so faculty can see the
 * structure they're scoped to. Mirrors college.routes.ts.
 */
import { Router } from "express";

import {
  bulkCreateOrgUnitsController,
  createOrgUnitController,
  deleteOrgUnitController,
  listOrgUnitsController,
  updateOrgUnitController,
} from "../controllers/org-unit-admin.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { requireAuth } from "../middleware/require-auth.js";
import {
  requireCollegeAdmin,
  requireFaculty,
} from "../middleware/require-role.js";
import { resolveTenant } from "../middleware/resolve-tenant.js";

export const orgUnitRouter: Router = Router();

const tenant = [requireAuth, enforcePasswordChange, resolveTenant];

// Read the tree — faculty and above.
orgUnitRouter.get(
  "/c/:collegeSlug/org-units",
  ...tenant,
  requireFaculty,
  listOrgUnitsController,
);

// Writes — college_admin (or a platform admin) only.
orgUnitRouter.post(
  "/c/:collegeSlug/org-units/bulk",
  ...tenant,
  requireCollegeAdmin,
  bulkCreateOrgUnitsController,
);
orgUnitRouter.post(
  "/c/:collegeSlug/org-units",
  ...tenant,
  requireCollegeAdmin,
  createOrgUnitController,
);
orgUnitRouter.patch(
  "/c/:collegeSlug/org-units/:orgUnitId",
  ...tenant,
  requireCollegeAdmin,
  updateOrgUnitController,
);
orgUnitRouter.delete(
  "/c/:collegeSlug/org-units/:orgUnitId",
  ...tenant,
  requireCollegeAdmin,
  deleteOrgUnitController,
);
