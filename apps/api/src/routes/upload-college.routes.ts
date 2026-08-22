/**
 * Tenant-scoped signed-upload route for college authoring surfaces. Mirrors the
 * platform-admin `/admin/uploads/signature` route but behind the tenant stack +
 * faculty authority: `resolveTenant` enforces college membership and
 * `requireFaculty` admits faculty AND college_admin (and platform admins, who
 * supersede them).
 *
 * Deliberately NOT gated on any single feature entitlement so it is REUSABLE by
 * every college authoring surface — exams, careers, and the upcoming
 * Gaming/Communication modules. Audio (Cloudinary resource_type "video") needs
 * NO server change: resource_type is never part of the signed params (see
 * lib/cloudinary.ts), so the client simply POSTs to the ".../video/upload" path
 * with the same signature this route issues.
 */
import { Router } from "express";

import { collegeCreateUploadSignatureController } from "../controllers/upload-college.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { uploadSignatureRateLimiter } from "../middleware/rate-limit.js";
import { requireFaculty } from "../middleware/require-role.js";
import { requireAuth } from "../middleware/require-auth.js";
import { resolveTenant } from "../middleware/resolve-tenant.js";

export const uploadCollegeRouter: Router = Router();

const author = [
  requireAuth,
  enforcePasswordChange,
  resolveTenant,
  requireFaculty,
];

uploadCollegeRouter.post(
  "/c/:collegeSlug/uploads/signature",
  ...author,
  // Signatures mint Cloudinary uploads (billed) — cap per user; see rate-limit.ts.
  uploadSignatureRateLimiter,
  collegeCreateUploadSignatureController,
);
