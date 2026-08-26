/**
 * Unified student HISTORY routes. Guards are per-route (never router.use) so this
 * router never intercepts paths it doesn't define. The global read is authed-only
 * (B2C/global surface); the college read runs the tenant stack — `resolveTenant`
 * already enforces membership, so NO single feature gate is applied (the history
 * spans every module, and a module the student can't access simply yields no
 * rows).
 */
import { Router } from "express";

import {
  getCollegeHistoryController,
  getMyHistoryController,
} from "../controllers/history.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { requireAuth } from "../middleware/require-auth.js";
import { resolveTenant } from "../middleware/resolve-tenant.js";

export const historyRouter: Router = Router();

const authed = [requireAuth, enforcePasswordChange];

// B2C / global surface — the caller's own non-college attempts.
historyRouter.get("/me/history", ...authed, getMyHistoryController);

// College (tenant) surface — the caller's attempts within this college.
historyRouter.get(
  "/c/:collegeSlug/history",
  ...authed,
  resolveTenant,
  getCollegeHistoryController,
);
