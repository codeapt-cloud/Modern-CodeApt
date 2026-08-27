/**
 * Global / B2C + platform-admin mock-interview routes. No slug, no tenant, no
 * feature gate: START authorizes via the service access matrix (enrollment /
 * course grant / platform), and the engine calls authorize by attempt OWNERSHIP.
 * Admin routes are platform-admin only. Mirrors speaking-open.routes.
 */
import { Router } from "express";

import {
  adminCreateInterviewController,
  adminDeleteInterviewController,
  adminGetInterviewController,
  adminInterviewTtsController,
  adminListInterviewsController,
  adminListInterviewTopicsController,
  adminSetInterviewPublishController,
  adminUpdateInterviewController,
  interviewCurrentController,
  interviewInProgressController,
  interviewResultController,
  listInterviewsForUserController,
  recordInterviewWarningController,
  startInterviewController,
  submitInterviewAnswerController,
} from "../controllers/mock-interview.controller.js";
import { collegeCreateUploadSignatureController } from "../controllers/upload-college.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import {
  startAttemptRateLimiter,
  uploadSignatureRateLimiter,
} from "../middleware/rate-limit.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireAdmin } from "../middleware/require-role.js";

export const interviewOpenRouter: Router = Router();

const authed = [requireAuth, enforcePasswordChange];
const adminGuard = [requireAuth, enforcePasswordChange, requireAdmin];

// --- Student consumption (authed; enrollment/ownership authorized) ---
interviewOpenRouter.get("/interviews", ...authed, listInterviewsForUserController);
interviewOpenRouter.post(
  "/interviews/uploads/signature",
  ...authed,
  uploadSignatureRateLimiter,
  collegeCreateUploadSignatureController,
);
interviewOpenRouter.get(
  "/interviews/attempts/:attemptId/current",
  ...authed,
  interviewCurrentController,
);
interviewOpenRouter.post(
  "/interviews/attempts/:attemptId/answers/:turnIndex",
  ...authed,
  submitInterviewAnswerController,
);
interviewOpenRouter.get(
  "/interviews/attempts/:attemptId/result",
  ...authed,
  interviewResultController,
);
interviewOpenRouter.post(
  "/interviews/attempts/:attemptId/warning",
  ...authed,
  recordInterviewWarningController,
);
interviewOpenRouter.post(
  "/interviews/:assessmentId/attempts",
  ...authed,
  startAttemptRateLimiter,
  startInterviewController,
);
interviewOpenRouter.get(
  "/interviews/:assessmentId/attempt",
  ...authed,
  interviewInProgressController,
);

// --- Platform admin authoring (literal routes before parametrised) ---
interviewOpenRouter.get(
  "/admin/interview-topics",
  ...adminGuard,
  adminListInterviewTopicsController,
);
interviewOpenRouter.post(
  "/admin/interviews/tts",
  ...adminGuard,
  uploadSignatureRateLimiter,
  adminInterviewTtsController,
);
interviewOpenRouter.get("/admin/interviews", ...adminGuard, adminListInterviewsController);
interviewOpenRouter.post("/admin/interviews", ...adminGuard, adminCreateInterviewController);
interviewOpenRouter.get(
  "/admin/interviews/:assessmentId",
  ...adminGuard,
  adminGetInterviewController,
);
interviewOpenRouter.patch(
  "/admin/interviews/:assessmentId",
  ...adminGuard,
  adminUpdateInterviewController,
);
interviewOpenRouter.post(
  "/admin/interviews/:assessmentId/publish",
  ...adminGuard,
  adminSetInterviewPublishController,
);
interviewOpenRouter.delete(
  "/admin/interviews/:assessmentId",
  ...adminGuard,
  adminDeleteInterviewController,
);
