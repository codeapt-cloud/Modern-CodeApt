/**
 * College mock-interview routes — tenant-scoped at /c/:collegeSlug/interviews/...
 * behind the tenant stack + the INTERVIEW feature. Students consume (member);
 * authoring + operator surfaces additionally require faculty authority + the
 * `interview` sub-capability. Literal/list paths before "/:assessmentId" so they
 * aren't captured as an id. Mirrors speaking.routes.
 */
import { CollegeFeature } from "@codeapt/shared";
import { Router } from "express";

import {
  clearInterviewAttemptController,
  createCollegeInterviewController,
  interviewCreditsController,
  deleteCollegeInterviewController,
  getCollegeInterviewController,
  interviewCohortController,
  interviewCohortExportController,
  interviewCurrentController,
  interviewInProgressController,
  interviewResultController,
  interviewTtsController,
  listAvailableInterviewsController,
  listCollegeInterviewsController,
  listInterviewAttemptsController,
  recordInterviewWarningController,
  setCollegeInterviewPublishController,
  startInterviewController,
  submitInterviewAnswerController,
  updateCollegeInterviewController,
} from "../controllers/mock-interview.controller.js";
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

export const collegeInterviewRouter: Router = Router();

const member = [
  requireAuth,
  enforcePasswordChange,
  resolveTenant,
  requireFeature(CollegeFeature.INTERVIEW),
];
const author = [
  ...member,
  requireFaculty,
  requireFeature(CollegeFeature.INTERVIEW, "interview"),
];

// --- Student consumption (member) ---
collegeInterviewRouter.get(
  "/c/:collegeSlug/interviews/available",
  ...member,
  listAvailableInterviewsController,
);
collegeInterviewRouter.post(
  "/c/:collegeSlug/interviews/uploads/signature",
  ...member,
  uploadSignatureRateLimiter,
  collegeCreateUploadSignatureController,
);
collegeInterviewRouter.post(
  "/c/:collegeSlug/interviews/:assessmentId/attempts",
  ...member,
  startAttemptRateLimiter,
  startInterviewController,
);
collegeInterviewRouter.get(
  "/c/:collegeSlug/interviews/attempts/:attemptId/current",
  ...member,
  interviewCurrentController,
);
collegeInterviewRouter.post(
  "/c/:collegeSlug/interviews/attempts/:attemptId/answers/:turnIndex",
  ...member,
  submitInterviewAnswerController,
);
collegeInterviewRouter.get(
  "/c/:collegeSlug/interviews/attempts/:attemptId/result",
  ...member,
  interviewResultController,
);
collegeInterviewRouter.post(
  "/c/:collegeSlug/interviews/attempts/:attemptId/warning",
  ...member,
  recordInterviewWarningController,
);
collegeInterviewRouter.get(
  "/c/:collegeSlug/interviews/:assessmentId/attempt",
  ...member,
  interviewInProgressController,
);

// --- Authoring + operator (author) ---
collegeInterviewRouter.get(
  "/c/:collegeSlug/interviews",
  ...author,
  listCollegeInterviewsController,
);
collegeInterviewRouter.post(
  "/c/:collegeSlug/interviews",
  ...author,
  createCollegeInterviewController,
);
// Interview-credit quota readout for the college dashboard (Step 38). Literal
// path — must precede "/interviews/:assessmentId" so it isn't read as an id.
collegeInterviewRouter.get(
  "/c/:collegeSlug/interviews/credits",
  ...author,
  interviewCreditsController,
);
collegeInterviewRouter.post(
  "/c/:collegeSlug/interviews/tts",
  ...author,
  uploadSignatureRateLimiter,
  interviewTtsController,
);
collegeInterviewRouter.get(
  "/c/:collegeSlug/interviews/:assessmentId/attempts",
  ...author,
  listInterviewAttemptsController,
);
collegeInterviewRouter.delete(
  "/c/:collegeSlug/interviews/:assessmentId/attempts/:attemptId",
  ...author,
  clearInterviewAttemptController,
);
collegeInterviewRouter.get(
  "/c/:collegeSlug/interviews/:assessmentId/cohort",
  ...author,
  interviewCohortController,
);
collegeInterviewRouter.get(
  "/c/:collegeSlug/interviews/:assessmentId/cohort/export",
  ...author,
  interviewCohortExportController,
);
collegeInterviewRouter.get(
  "/c/:collegeSlug/interviews/:assessmentId",
  ...author,
  getCollegeInterviewController,
);
collegeInterviewRouter.patch(
  "/c/:collegeSlug/interviews/:assessmentId",
  ...author,
  updateCollegeInterviewController,
);
collegeInterviewRouter.post(
  "/c/:collegeSlug/interviews/:assessmentId/publish",
  ...author,
  setCollegeInterviewPublishController,
);
collegeInterviewRouter.delete(
  "/c/:collegeSlug/interviews/:assessmentId",
  ...author,
  deleteCollegeInterviewController,
);
