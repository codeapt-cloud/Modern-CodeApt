/**
 * Essay routes. All require auth. Submission history and the grading-status
 * poll are ordered so the static `/submissions/:jobId` path is matched before
 * the parameterized topic routes.
 */
import { Router } from "express";

import {
  aiFeedbackController,
  getDraftController,
  getEssayController,
  getSubmissionController,
  listEssaysController,
  listSubmissionsController,
  recordAnalyticsController,
  saveDraftController,
  submitEssayController,
} from "../controllers/essay.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { essaySubmitRateLimiter } from "../middleware/rate-limit.js";
import { requireAuth } from "../middleware/require-auth.js";

export const essayRouter: Router = Router();

const authed = [requireAuth, enforcePasswordChange];

essayRouter.get("/essays", ...authed, listEssaysController);
// Grading status poll — static path registered before "/essays/:id".
essayRouter.get(
  "/essays/submissions/:jobId",
  ...authed,
  getSubmissionController,
);
// Optional, additive writing analytics (does NOT affect grading).
essayRouter.post(
  "/essays/submissions/:jobId/analytics",
  ...authed,
  recordAnalyticsController,
);
// On-demand AI Scoring & Feedback for the caller's own submission (supplementary
// to the heuristic grade). Static path, registered before "/essays/:id".
essayRouter.post(
  "/essays/submissions/:jobId/ai-feedback",
  ...authed,
  aiFeedbackController,
);
essayRouter.get("/essays/:id", ...authed, getEssayController);
// Autosave draft recovery + save (owner-scoped; never submits or grades).
essayRouter.get("/essays/:id/draft", ...authed, getDraftController);
essayRouter.put("/essays/:id/draft", ...authed, saveDraftController);
essayRouter.get(
  "/essays/:id/submissions",
  ...authed,
  listSubmissionsController,
);
essayRouter.post(
  "/essays/:id/submit",
  ...authed,
  essaySubmitRateLimiter,
  submitEssayController,
);
