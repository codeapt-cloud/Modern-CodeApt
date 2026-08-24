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
  speakingInProgressAttemptController,
  speakingResultController,
  speakingTtsController,
  startSpeakingController,
  submitSpeakingItemController,
  updateCollegeSpeakingController,
} from "../controllers/speaking.controller.js";
import { collegeCreateUploadSignatureController } from "../controllers/upload-college.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import {
  startAttemptRateLimiter,
  uploadSignatureRateLimiter,
} from "../middleware/rate-limit.js";
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
// Signed Cloudinary upload for a student's RECORDED audio. The generic
// /c/:slug/uploads/signature route is faculty-gated (authoring), so a student
// 403s there and could never upload a take. This member-scoped route (behind the
// COMMUNICATION feature) issues the SAME tenant-agnostic signature, mirroring the
// attendance module's own feature-scoped signature route. Rate-limited per user.
collegeSpeakingRouter.post(
  "/c/:collegeSlug/speaking/uploads/signature",
  ...member,
  uploadSignatureRateLimiter,
  collegeCreateUploadSignatureController,
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
// C5: the student's current in-progress attempt on an assessment (or null), for
// the composite deep link to RESUME. Member-gated; deeper than "/:assessmentId"
// (the author GET) so never captured as an id, and distinct from "/attempts".
collegeSpeakingRouter.get(
  "/c/:collegeSlug/speaking/:assessmentId/attempt",
  ...member,
  speakingInProgressAttemptController,
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
// Authoring-time TTS — literal, BEFORE "/:assessmentId". Rate-limited (per user)
// because each call runs server-side Piper + a Cloudinary upload.
collegeSpeakingRouter.post(
  "/c/:collegeSlug/speaking/tts",
  ...author,
  uploadSignatureRateLimiter,
  speakingTtsController,
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
