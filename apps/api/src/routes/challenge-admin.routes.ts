/**
 * Daily-challenge admin routes — CRUD + Excel bulk import, behind the admin
 * guard stack (requireAuth + enforcePasswordChange + requireAdmin).
 */
import { Router } from "express";

import {
  adminAiBuildChallengeController,
  adminBulkImportChallengesController,
  adminBulkImportTemplateController,
  adminCreateChallengeController,
  adminDeleteChallengeController,
  adminGetChallengeController,
  adminListChallengesController,
  adminRegenerateChallengeController,
  adminUpdateChallengeController,
} from "../controllers/challenge-admin.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { requireAdmin } from "../middleware/require-role.js";
import { requireAuth } from "../middleware/require-auth.js";

export const challengeAdminRouter: Router = Router();

const admin = [requireAuth, enforcePasswordChange, requireAdmin];

challengeAdminRouter.get(
  "/admin/challenges",
  ...admin,
  adminListChallengesController,
);
challengeAdminRouter.post(
  "/admin/challenges",
  ...admin,
  adminCreateChallengeController,
);
challengeAdminRouter.post(
  "/admin/challenges/bulk-import",
  ...admin,
  adminBulkImportChallengesController,
);
// Literal — registered before "/admin/challenges/:questionId" so it isn't
// captured as an id.
challengeAdminRouter.get(
  "/admin/challenges/bulk-import-template",
  ...admin,
  adminBulkImportTemplateController,
);
// Optional oversight: re-run the auto pipeline for a day (literal path).
challengeAdminRouter.post(
  "/admin/challenges/regenerate",
  ...admin,
  adminRegenerateChallengeController,
);
// Authoring assist: draft a CODE challenge with AI to pre-fill the editor.
challengeAdminRouter.post(
  "/admin/challenges/ai-build",
  ...admin,
  adminAiBuildChallengeController,
);
challengeAdminRouter.get(
  "/admin/challenges/:questionId",
  ...admin,
  adminGetChallengeController,
);
challengeAdminRouter.patch(
  "/admin/challenges/:questionId",
  ...admin,
  adminUpdateChallengeController,
);
challengeAdminRouter.delete(
  "/admin/challenges/:questionId",
  ...admin,
  adminDeleteChallengeController,
);
