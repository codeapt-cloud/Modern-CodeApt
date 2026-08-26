/**
 * OPEN speaking routes (Step 29) — the NON-tenant surface that makes a
 * course-attached / platform speaking assessment reachable end to end:
 *   - global enrollment-based discovery + the ENGINE (start/current/submit/
 *     result/resume), authorized by the access matrix (start) and attempt
 *     OWNERSHIP (subsequent) — no slug, no tenant, no feature gate, exactly like
 *     the slug-free game engine (`/game-attempts/:id/...`);
 *   - platform-admin authoring under `/admin/speaking` behind requireAdmin.
 * The tenant surface (`/c/:slug/speaking/...`) is UNCHANGED — it lives in
 * speaking.routes.ts and this file adds paths beside it, never touching it.
 */
import { Router } from "express";

import {
  adminCreateSpeakingController,
  adminDeleteSpeakingController,
  adminGetSpeakingController,
  adminListSpeakingController,
  adminListSpeakingTopicsController,
  adminSetSpeakingPublishController,
  adminSpeakingTtsController,
  adminUpdateSpeakingController,
  listSpeakingForUserController,
  speakingCurrentController,
  speakingInProgressAttemptController,
  speakingResultController,
  startSpeakingController,
  submitSpeakingItemController,
} from "../controllers/speaking.controller.js";
import { collegeCreateUploadSignatureController } from "../controllers/upload-college.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import {
  startAttemptRateLimiter,
  uploadSignatureRateLimiter,
} from "../middleware/rate-limit.js";
import { requireAdmin } from "../middleware/require-role.js";
import { requireAuth } from "../middleware/require-auth.js";

export const speakingOpenRouter: Router = Router();

// Any authenticated learner (B2C or college). Access to a specific assessment is
// decided inside the service by the access matrix / attempt ownership.
const authed = [requireAuth, enforcePasswordChange];
const adminGuard = [requireAuth, enforcePasswordChange, requireAdmin];

// --- Enrollment-based discovery ---
speakingOpenRouter.get("/speaking", ...authed, listSpeakingForUserController);

// --- Signed upload for a student's recorded audio (tenant-agnostic signer, so
//     the SAME controller the college route uses; here gated only by auth). ---
speakingOpenRouter.post(
  "/speaking/uploads/signature",
  ...authed,
  uploadSignatureRateLimiter,
  collegeCreateUploadSignatureController,
);

// --- Engine (attempt-ownership authorized; literal /attempts before /:id) ---
speakingOpenRouter.get(
  "/speaking/attempts/:attemptId/current",
  ...authed,
  speakingCurrentController,
);
speakingOpenRouter.post(
  "/speaking/attempts/:attemptId/items/:itemIndex",
  ...authed,
  submitSpeakingItemController,
);
speakingOpenRouter.get(
  "/speaking/attempts/:attemptId/result",
  ...authed,
  speakingResultController,
);
speakingOpenRouter.post(
  "/speaking/:assessmentId/attempts",
  ...authed,
  startAttemptRateLimiter,
  startSpeakingController,
);
// Resume: the student's current in-progress attempt on an assessment (or null).
speakingOpenRouter.get(
  "/speaking/:assessmentId/attempt",
  ...authed,
  speakingInProgressAttemptController,
);

// --- Platform-admin authoring (requireAdmin) — literal /admin/speaking first ---
// Topic picker (before the parametrised /admin/speaking/:id routes).
speakingOpenRouter.get(
  "/admin/speaking-topics",
  ...adminGuard,
  adminListSpeakingTopicsController,
);
speakingOpenRouter.post(
  "/admin/speaking/tts",
  ...adminGuard,
  uploadSignatureRateLimiter,
  adminSpeakingTtsController,
);
speakingOpenRouter.get("/admin/speaking", ...adminGuard, adminListSpeakingController);
speakingOpenRouter.post("/admin/speaking", ...adminGuard, adminCreateSpeakingController);
speakingOpenRouter.get(
  "/admin/speaking/:assessmentId",
  ...adminGuard,
  adminGetSpeakingController,
);
speakingOpenRouter.patch(
  "/admin/speaking/:assessmentId",
  ...adminGuard,
  adminUpdateSpeakingController,
);
speakingOpenRouter.post(
  "/admin/speaking/:assessmentId/publish",
  ...adminGuard,
  adminSetSpeakingPublishController,
);
speakingOpenRouter.delete(
  "/admin/speaking/:assessmentId",
  ...adminGuard,
  adminDeleteSpeakingController,
);
