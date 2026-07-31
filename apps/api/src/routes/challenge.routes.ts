import { Router } from "express";

import {
  finalizeCodeController,
  getLeaderboardController,
  getTodayController,
  submitCodeController,
  submitMcqController,
} from "../controllers/challenge.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { executeRateLimiter } from "../middleware/rate-limit.js";
import { requireAuth } from "../middleware/require-auth.js";

export const challengeRouter: Router = Router();

const authed = [requireAuth, enforcePasswordChange];

challengeRouter.get("/challenges/today", ...authed, getTodayController);
challengeRouter.post(
  "/challenges/today/submit-mcq",
  ...authed,
  submitMcqController,
);
// CODE submit rides the execution pipeline — reuse the executor rate limiter.
challengeRouter.post(
  "/challenges/today/submit-code",
  ...authed,
  executeRateLimiter,
  submitCodeController,
);
challengeRouter.post(
  "/challenges/submissions/:jobId/finalize",
  ...authed,
  finalizeCodeController,
);
challengeRouter.get(
  "/challenges/leaderboard",
  ...authed,
  getLeaderboardController,
);
