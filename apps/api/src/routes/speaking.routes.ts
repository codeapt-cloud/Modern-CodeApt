/**
 * College speaking routes — tenant-scoped at /c/:collegeSlug/speaking/... behind
 * the full tenant stack PLUS the COMMUNICATION feature. Students consume here
 * (member); authoring (create/update/publish/delete/list/get) additionally
 * requires faculty authority + the `speaking` sub-capability. Literal paths are
 * registered before "/:assessmentId" so they aren't captured as an id. Mirrors
 * college-game.routes.
 */
import { CollegeFeature } from "@codeapt/shared";
import { Router } from "express";

import {
  clearSpeakingAttemptController,
  createCollegeSpeakingController,
  deleteCollegeSpeakingController,
  getCollegeSpeakingController,
  listAvailableSpeakingController,
  listCollegeSpeakingController,
  listSpeakingAttemptsController,
  setCollegeSpeakingPublishController,
  speakingCurrentController,
  speakingResultController,
  startSpeakingController,
  submitSpeakingItemController,
  updateCollegeSpeakingController,
} from "../controllers/speaking.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { startAttemptRateLimiter } from "../middleware/rate-limit.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireFeature } from "../middleware/require-entitlement.js";
import { requireFaculty } from "../middleware/require-role.js";
import { resolveTenant } from "../middleware/resolve-tenant.js";

export const collegeSpeakingRouter: Router = Router();

// Any college member + the `communication` feature (a student takes here).
const member = [
  requireAuth,
  enforcePasswordChange,
  resolveTenant,
  requireFeature(CollegeFeature.COMMUNICATION),
];
// Authoring = member stack + faculty authority + the `speaking` sub-capability.
const author = [
  ...member,
  requireFaculty,
  requireFeature(CollegeFeature.COMMUNICATION, "speaking"),
];

// --- Student consumption (member) ---
collegeSpeakingRouter.get(
  "/c/:collegeSlug/speaking/available",
  ...member,
  listAvailableSpeakingController,
);
collegeSpeakingRouter.post(
  "/c/:collegeSlug/speaking/:assessmentId/attempts",
  ...member,
  startAttemptRateLimiter,
  startSpeakingController,
);
collegeSpeakingRouter.get(
  "/c/:collegeSlug/speaking/attempts/:attemptId/current",
  ...member,
  speakingCurrentController,
);
collegeSpeakingRouter.post(
  "/c/:collegeSlug/speaking/attempts/:attemptId/items/:itemIndex",
  ...member,
  submitSpeakingItemController,
);
collegeSpeakingRouter.get(
  "/c/:collegeSlug/speaking/attempts/:attemptId/result",
  ...member,
  speakingResultController,
);

// --- Authoring (author) — literal + list before "/:assessmentId" ---
collegeSpeakingRouter.get(
  "/c/:collegeSlug/speaking",
  ...author,
  listCollegeSpeakingController,
);
collegeSpeakingRouter.post(
  "/c/:collegeSlug/speaking",
  ...author,
  createCollegeSpeakingController,
);
// Operator attempt management (before the bare "/:assessmentId" GET).
collegeSpeakingRouter.get(
  "/c/:collegeSlug/speaking/:assessmentId/attempts",
  ...author,
  listSpeakingAttemptsController,
);
collegeSpeakingRouter.delete(
  "/c/:collegeSlug/speaking/:assessmentId/attempts/:attemptId",
  ...author,
  clearSpeakingAttemptController,
);
collegeSpeakingRouter.get(
  "/c/:collegeSlug/speaking/:assessmentId",
  ...author,
  getCollegeSpeakingController,
);
collegeSpeakingRouter.patch(
  "/c/:collegeSlug/speaking/:assessmentId",
  ...author,
  updateCollegeSpeakingController,
);
collegeSpeakingRouter.post(
  "/c/:collegeSlug/speaking/:assessmentId/publish",
  ...author,
  setCollegeSpeakingPublishController,
);
collegeSpeakingRouter.delete(
  "/c/:collegeSlug/speaking/:assessmentId",
  ...author,
  deleteCollegeSpeakingController,
);
