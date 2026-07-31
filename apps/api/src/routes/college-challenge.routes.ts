/**
 * College challenge routes — tenant-scoped at /c/:collegeSlug/challenges/...
 * behind the full tenant stack PLUS the `challenges` FEATURE entitlement. The
 * daily challenge itself is the SHARED global experience (see challenge.routes.ts,
 * authorized by requireAuth only) — a college student solves it there unchanged.
 * These routes add only the college-specific READ: a tenant-scoped leaderboard of
 * the college's own students' standings (operator insight).
 */
import { CollegeFeature } from "@codeapt/shared";
import { Router } from "express";

import { collegeChallengeLeaderboardController } from "../controllers/college-challenge.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireFeature } from "../middleware/require-entitlement.js";
import { requireFaculty } from "../middleware/require-role.js";
import { resolveTenant } from "../middleware/resolve-tenant.js";

export const collegeChallengeRouter: Router = Router();

collegeChallengeRouter.get(
  "/c/:collegeSlug/challenges/leaderboard",
  requireAuth,
  enforcePasswordChange,
  resolveTenant,
  requireFeature(CollegeFeature.CHALLENGES),
  requireFaculty,
  collegeChallengeLeaderboardController,
);
