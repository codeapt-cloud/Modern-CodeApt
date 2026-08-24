/**
 * Gaming routes. Student play START requires a login; the attempt LIFECYCLE
 * (answer/advance/finish) uses optionalAuth + authorizes inside the service by
 * attempt ownership OR an X-Attempt-Token (mirroring the exam engine). The
 * platform-admin authoring surface lives here under requireAdmin. College
 * authoring + college play START are in college-game.routes.ts.
 */
import { Router } from "express";

import {
  advanceGameController,
  adminAiBuildGameSetController,
  adminCreateGameSetController,
  adminDeleteGameSetController,
  adminGetGameSetController,
  adminListGameSetsController,
  adminPublishGameSetController,
  adminUpdateGameSetController,
  answerGameItemController,
  beginGameController,
  currentGameController,
  explainGameItemController,
  finishGameSetController,
  listMyGamesController,
  probeGameItemController,
  recordGameWarningController,
  startGameSetController,
} from "../controllers/game.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { optionalAuth } from "../middleware/optional-auth.js";
import {
  gameAnswerRateLimiter,
  gameProbeRateLimiter,
  startAttemptRateLimiter,
} from "../middleware/rate-limit.js";
import { requireAdmin } from "../middleware/require-role.js";
import { requireAuth } from "../middleware/require-auth.js";

export const gameRouter: Router = Router();

const authed = [requireAuth, enforcePasswordChange];
const engine = [optionalAuth];
const adminGuard = [requireAuth, enforcePasswordChange, requireAdmin];

// --- Student discovery: course-attached sets reachable by enrollment ---
// Mirrors GET /exams; each item carries topicId for the learn player.
gameRouter.get("/games", ...authed, listMyGamesController);

// --- Student play start (requires login) ---
gameRouter.post(
  "/game-sets/:gameSetId/attempts",
  ...authed,
  startAttemptRateLimiter,
  startGameSetController,
);

// --- Attempt engine (owner session OR attempt token) ---
// Begin the current game: serves its first item + starts the (server-set) clock.
gameRouter.post("/game-attempts/:attemptId/begin", ...engine, beginGameController);
// Read-only CURRENT state (resume after a reconnect) — never starts a clock.
// Mirrors /c/:slug/speaking/attempts/:attemptId/current (Step 14).
gameRouter.get("/game-attempts/:attemptId/current", ...engine, currentGameController);
gameRouter.post(
  "/game-attempts/:attemptId/answer",
  ...engine,
  gameAnswerRateLimiter,
  answerGameItemController,
);
// Proctoring warning (mirrors the exam warning route).
gameRouter.post(
  "/game-attempts/:attemptId/warning",
  ...engine,
  recordGameWarningController,
);
// Interactive move-by-move play (door_key). Higher rate limit than answer — a
// probe is a single keypress. A probe against a one-shot game 400s in the service.
gameRouter.post(
  "/game-attempts/:attemptId/probe",
  ...engine,
  gameProbeRateLimiter,
  probeGameItemController,
);
gameRouter.post(
  "/game-attempts/:attemptId/advance",
  ...engine,
  advanceGameController,
);
gameRouter.post(
  "/game-attempts/:attemptId/finish",
  ...engine,
  finishGameSetController,
);
// Practice-mode reveal (gated in the service: instantFeedback + answered).
gameRouter.post(
  "/game-attempts/:attemptId/explain",
  ...engine,
  explainGameItemController,
);

// --- Platform-admin authoring (requireAdmin) ---
gameRouter.get("/admin/game-sets", ...adminGuard, adminListGameSetsController);
gameRouter.post("/admin/game-sets", ...adminGuard, adminCreateGameSetController);
// AI set-builder (draft only). Literal path — before the "/:gameSetId" routes.
gameRouter.post(
  "/admin/game-sets/ai-build",
  ...adminGuard,
  adminAiBuildGameSetController,
);
gameRouter.get(
  "/admin/game-sets/:gameSetId",
  ...adminGuard,
  adminGetGameSetController,
);
gameRouter.patch(
  "/admin/game-sets/:gameSetId",
  ...adminGuard,
  adminUpdateGameSetController,
);
gameRouter.post(
  "/admin/game-sets/:gameSetId/publish",
  ...adminGuard,
  adminPublishGameSetController,
);
gameRouter.delete(
  "/admin/game-sets/:gameSetId",
  ...adminGuard,
  adminDeleteGameSetController,
);
