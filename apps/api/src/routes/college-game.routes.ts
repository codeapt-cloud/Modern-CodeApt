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
  aiBuildCollegeGameSetController,
  cloneCollegeGameSetController,
  createCollegeGameSetController,
  deleteCollegeGameSetController,
  exportGameSetCohortController,
  getCollegeGameSetController,
  getGameSetCohortController,
  listAvailableCollegeGameSetsController,
  listCollegeGameSetsController,
  listGameSetAttemptsController,
  listGameSetTemplatesController,
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

// --- Authoring: browse published platform sets to clone as a template. Literal
//     path registered before the "/:gameSetId" GET. ---
collegeGameRouter.get(
  "/c/:collegeSlug/game-sets/templates",
  ...author,
  listGameSetTemplatesController,
);

// --- Authoring: AI set-builder (GAMING.ai_build sub-capability). Literal path
//     registered before the "/:sourceId" and "/:gameSetId" routes. ---
collegeGameRouter.post(
  "/c/:collegeSlug/game-sets/ai-build",
  ...author,
  requireFeature(CollegeFeature.GAMING, "ai_build"),
  aiBuildCollegeGameSetController,
);

// --- Authoring: clone a PLATFORM set into this college (GAMING gated) ---
collegeGameRouter.post(
  "/c/:collegeSlug/game-sets/:sourceId/clone",
  ...author,
  cloneCollegeGameSetController,
);

// --- Operator visibility (G2): attempt list + cohort report + export. Deeper
//     than "/:gameSetId" so never captured as an id; author-gated (faculty +
//     GAMING feature — the SAME guard as every other gaming authoring route). ---
collegeGameRouter.get(
  "/c/:collegeSlug/game-sets/:gameSetId/attempts",
  ...author,
  listGameSetAttemptsController,
);
collegeGameRouter.get(
  "/c/:collegeSlug/game-sets/:gameSetId/cohort",
  ...author,
  getGameSetCohortController,
);
collegeGameRouter.get(
  "/c/:collegeSlug/game-sets/:gameSetId/cohort/export",
  ...author,
  exportGameSetCohortController,
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
collegeGameRouter.delete(
  "/c/:collegeSlug/game-sets/:gameSetId",
  ...author,
  deleteCollegeGameSetController,
);
