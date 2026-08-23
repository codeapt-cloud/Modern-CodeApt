/**
 * College gaming routes — tenant-scoped at /c/:collegeSlug/game-sets/... behind
 * the full tenant stack PLUS the GAMING feature. Students START here (member);
 * the shared attempt lifecycle (answer/advance/finish) is the global
 * /game-attempts/* engine, authorized by attempt ownership — not duplicated.
 * Authoring (create/update/publish/list/get) is faculty/college_admin.
 */
import { CollegeFeature } from "@codeapt/shared";
import { Router } from "express";

import {
  cloneCollegeGameSetController,
  createCollegeGameSetController,
  getCollegeGameSetController,
  listAvailableCollegeGameSetsController,
  listCollegeGameSetsController,
  setCollegeGameSetPublishController,
  updateCollegeGameSetController,
} from "../controllers/college-game-admin.controller.js";
import { startGameSetController } from "../controllers/game.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { startAttemptRateLimiter } from "../middleware/rate-limit.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireFeature } from "../middleware/require-entitlement.js";
import { requireFaculty } from "../middleware/require-role.js";
import { resolveTenant } from "../middleware/resolve-tenant.js";

export const collegeGameRouter: Router = Router();

// Any college member + the `gaming` feature (a college student plays here).
const member = [
  requireAuth,
  enforcePasswordChange,
  resolveTenant,
  requireFeature(CollegeFeature.GAMING),
];
// Authoring = member stack + faculty authority (scope enforced in the service).
const author = [...member, requireFaculty];

// --- Student: the published, in-target sets they can play (member) ---
// Registered BEFORE the "/:gameSetId" GET so "available" isn't captured as an id.
collegeGameRouter.get(
  "/c/:collegeSlug/game-sets/available",
  ...member,
  listAvailableCollegeGameSetsController,
);

// --- Student: start a game-set attempt (member) ---
collegeGameRouter.post(
  "/c/:collegeSlug/game-sets/:gameSetId/attempts",
  ...member,
  startAttemptRateLimiter,
  startGameSetController,
);

// --- Authoring: clone a PLATFORM set into this college (GAMING gated) ---
collegeGameRouter.post(
  "/c/:collegeSlug/game-sets/:sourceId/clone",
  ...author,
  cloneCollegeGameSetController,
);

// --- Authoring: list / create / get / update / publish ---
collegeGameRouter.get(
  "/c/:collegeSlug/game-sets",
  ...author,
  listCollegeGameSetsController,
);
collegeGameRouter.post(
  "/c/:collegeSlug/game-sets",
  ...author,
  createCollegeGameSetController,
);
collegeGameRouter.get(
  "/c/:collegeSlug/game-sets/:gameSetId",
  ...author,
  getCollegeGameSetController,
);
collegeGameRouter.patch(
  "/c/:collegeSlug/game-sets/:gameSetId",
  ...author,
  updateCollegeGameSetController,
);
collegeGameRouter.post(
  "/c/:collegeSlug/game-sets/:gameSetId/publish",
  ...author,
  setCollegeGameSetPublishController,
);
