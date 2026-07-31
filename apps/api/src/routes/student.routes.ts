/**
 * College-student routes — tenant-scoped at /c/:collegeSlug/students/... behind
 * the full tenant stack (requireAuth → enforcePasswordChange → resolveTenant).
 *
 * Single-add + list are open to faculty and above (requireFaculty); the service
 * enforces faculty SCOPE (a faculty member only sees/creates within their
 * assigned org-units). The bulk-import endpoints additionally require the
 * `bulk_import` FEATURE entitlement. Mirrors faculty.routes.ts / org-unit.routes.ts.
 *
 * Import-specific paths are registered BEFORE the `/:studentId` route so
 * `/students/import/...` is never captured as a student id.
 */
import { CollegeFeature } from "@codeapt/shared";
import { Router } from "express";

import {
  commitStudentImportController,
  createStudentController,
  deactivateStudentController,
  listStudentsController,
  previewStudentImportController,
  studentImportTemplateController,
  updateStudentController,
} from "../controllers/student-admin.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireFeature } from "../middleware/require-entitlement.js";
import { requireFaculty } from "../middleware/require-role.js";
import { resolveTenant } from "../middleware/resolve-tenant.js";

export const studentRouter: Router = Router();

const tenant = [requireAuth, enforcePasswordChange, resolveTenant];
const bulkImport = requireFeature(CollegeFeature.BULK_IMPORT);

// --- Bulk import (feature-gated) — registered first ---
studentRouter.get(
  "/c/:collegeSlug/students/import/template",
  ...tenant,
  requireFaculty,
  bulkImport,
  studentImportTemplateController,
);
studentRouter.post(
  "/c/:collegeSlug/students/import/preview",
  ...tenant,
  requireFaculty,
  bulkImport,
  previewStudentImportController,
);
studentRouter.post(
  "/c/:collegeSlug/students/import/commit",
  ...tenant,
  requireFaculty,
  bulkImport,
  commitStudentImportController,
);

// --- Single-add + list + deactivate (faculty scope enforced in the service) ---
studentRouter.get(
  "/c/:collegeSlug/students",
  ...tenant,
  requireFaculty,
  listStudentsController,
);
studentRouter.post(
  "/c/:collegeSlug/students",
  ...tenant,
  requireFaculty,
  createStudentController,
);
studentRouter.patch(
  "/c/:collegeSlug/students/:studentId",
  ...tenant,
  requireFaculty,
  updateStudentController,
);
studentRouter.delete(
  "/c/:collegeSlug/students/:studentId",
  ...tenant,
  requireFaculty,
  deactivateStudentController,
);
