/**
 * Coding-profile routes (Prompt 1) — tenant-scoped at
 * /c/:collegeSlug/coding-profiles/... behind the full tenant stack PLUS the
 * `coding_profiles` FEATURE entitlement.
 *
 * Self endpoints (get / set handles / refresh mine) run WITHOUT an operator gate
 * so a college student reaches them; the service asserts college-student
 * authority and always acts on `req.auth.userId`. The admin "refresh now" for a
 * specific student requires college_admin.
 *
 * Route ordering: the literal `students/:userId/refresh` is distinct from the
 * `me/...` self paths, so there is no capture risk.
 */
import { CollegeFeature } from "@codeapt/shared";
import { Router } from "express";

import {
  codingLeaderboardController,
  codingLeaderboardReportController,
} from "../controllers/coding-leaderboard.controller.js";
import {
  getMyCodingProfileController,
  refreshMyCodingProfileController,
  refreshStudentCodingProfileController,
  setMyCodingHandlesController,
} from "../controllers/coding-profile.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireFeature } from "../middleware/require-entitlement.js";
import { requireCollegeAdmin, requireFaculty } from "../middleware/require-role.js";
import { resolveTenant } from "../middleware/resolve-tenant.js";

export const codingProfileRouter: Router = Router();

// Tenant stack + the `coding_profiles` feature.
const feature = [
  requireAuth,
  enforcePasswordChange,
  resolveTenant,
  requireFeature(CollegeFeature.CODING_PROFILES),
];
// Admin = feature stack + college_admin authority.
const admin = [...feature, requireCollegeAdmin];
// Operator read = feature stack + faculty authority (admin sees all; faculty
// within scope — the leaderboard service enforces the org-unit/group scope).
const operator = [...feature, requireFaculty];

// --- The calling student's own profile ---
codingProfileRouter.get(
  "/c/:collegeSlug/coding-profiles/me",
  ...feature,
  getMyCodingProfileController,
);
codingProfileRouter.put(
  "/c/:collegeSlug/coding-profiles/me/handles",
  ...feature,
  setMyCodingHandlesController,
);
codingProfileRouter.post(
  "/c/:collegeSlug/coding-profiles/me/refresh",
  ...feature,
  refreshMyCodingProfileController,
);

// --- Admin "refresh now" for a specific student ---
codingProfileRouter.post(
  "/c/:collegeSlug/coding-profiles/students/:userId/refresh",
  ...admin,
  refreshStudentCodingProfileController,
);

// --- Admin/faculty leaderboard (Prompt 2) — read-only ranking + Excel export.
// The `/report` sibling shares the same operator gate + query filters.
codingProfileRouter.get(
  "/c/:collegeSlug/coding-leaderboard",
  ...operator,
  codingLeaderboardController,
);
codingProfileRouter.get(
  "/c/:collegeSlug/coding-leaderboard/report",
  ...operator,
  codingLeaderboardReportController,
);
