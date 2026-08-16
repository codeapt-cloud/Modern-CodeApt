import { Router } from "express";

import {
  adminAddTestCaseController,
  adminBulkUploadController,
  adminBulkUploadTemplateController,
  adminCreatePublicLinkController,
  adminCreateQuestionController,
  adminCreateSectionController,
  adminDeleteExamController,
  adminDeletePublicLinkController,
  adminDeleteQuestionController,
  adminDeleteSectionController,
  adminDeleteTestCaseController,
  adminExportResultsController,
  adminGetExamController,
  adminGetUserExamAttemptsController,
  adminListAttemptCountersController,
  adminListExamsController,
  adminListResetLogController,
  adminResetAttemptsController,
  adminUpdatePublicLinkController,
  adminUpdateQuestionController,
  adminUpdateSectionController,
  adminUpdateTestCaseController,
  adminUpsertExamController,
  advanceController,
  finalizeController,
  getSectionController,
  listExamsController,
  publicAvailabilityController,
  publicStartController,
  resultController,
  saveAnswersController,
  startAttemptController,
  submitController,
  warningController,
} from "../controllers/exam.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { optionalAuth } from "../middleware/optional-auth.js";
import {
  executeRateLimiter,
  publicExamRateLimiter,
  startAttemptRateLimiter,
} from "../middleware/rate-limit.js";
import { requireAdmin } from "../middleware/require-role.js";
import { requireAuth } from "../middleware/require-auth.js";

export const examRouter: Router = Router();

const authed = [requireAuth, enforcePasswordChange];
// Engine calls accept EITHER a session user OR an X-Attempt-Token (anonymous),
// so they use optionalAuth and authorize inside the service.
const engine = [optionalAuth];

// --- Student browse + attempt start (requires login) ---
examRouter.get("/exams", ...authed, listExamsController);
examRouter.post(
  "/exams/:examId/attempts",
  ...authed,
  startAttemptRateLimiter,
  startAttemptController,
);

// --- Attempt engine (owner session OR attempt token) ---
examRouter.get("/attempts/:attemptId/section", ...engine, getSectionController);
examRouter.post(
  "/attempts/:attemptId/section/answers",
  ...engine,
  saveAnswersController,
);
examRouter.post("/attempts/:attemptId/advance", ...engine, advanceController);
examRouter.post(
  "/attempts/:attemptId/submit",
  ...engine,
  executeRateLimiter,
  submitController,
);
examRouter.post("/attempts/:attemptId/finalize", ...engine, finalizeController);
examRouter.get("/attempts/:attemptId/result", ...engine, resultController);
examRouter.post("/attempts/:attemptId/warning", ...engine, warningController);

// --- Public (anonymous) ---
examRouter.get("/public/exams/:token", publicAvailabilityController);
examRouter.post(
  "/public/exams/:token/attempts",
  publicExamRateLimiter,
  publicStartController,
);

// --- Admin authoring (requireAdmin) ---
const adminGuard = [requireAuth, enforcePasswordChange, requireAdmin];
examRouter.get("/admin/exams", ...adminGuard, adminListExamsController);
examRouter.post("/admin/exams", ...adminGuard, adminUpsertExamController);
// Literal — registered BEFORE "/admin/exams/:examId" so it isn't captured as an id.
examRouter.get(
  "/admin/exams/bulk-upload-template",
  ...adminGuard,
  adminBulkUploadTemplateController,
);
examRouter.get("/admin/exams/:examId", ...adminGuard, adminGetExamController);
examRouter.delete(
  "/admin/exams/:examId",
  ...adminGuard,
  adminDeleteExamController,
);
examRouter.post(
  "/admin/exams/:examId/sections",
  ...adminGuard,
  adminCreateSectionController,
);
examRouter.patch(
  "/admin/sections/:sectionId",
  ...adminGuard,
  adminUpdateSectionController,
);
examRouter.delete(
  "/admin/sections/:sectionId",
  ...adminGuard,
  adminDeleteSectionController,
);
// Exam questions live under /admin/exam-questions (NOT /admin/questions, which
// the curriculum router owns for quiz questions — sharing that path shadowed
// the exam handlers, since curriculum mounts first).
examRouter.post(
  "/admin/exam-questions",
  ...adminGuard,
  adminCreateQuestionController,
);
examRouter.patch(
  "/admin/exam-questions/:questionId",
  ...adminGuard,
  adminUpdateQuestionController,
);
examRouter.delete(
  "/admin/exam-questions/:questionId",
  ...adminGuard,
  adminDeleteQuestionController,
);
examRouter.post(
  "/admin/exam-questions/:questionId/test-cases",
  ...adminGuard,
  adminAddTestCaseController,
);
examRouter.patch(
  "/admin/test-cases/:testCaseId",
  ...adminGuard,
  adminUpdateTestCaseController,
);
examRouter.delete(
  "/admin/test-cases/:testCaseId",
  ...adminGuard,
  adminDeleteTestCaseController,
);
examRouter.post(
  "/admin/exams/:examId/public-links",
  ...adminGuard,
  adminCreatePublicLinkController,
);
examRouter.patch(
  "/admin/public-links/:linkId",
  ...adminGuard,
  adminUpdatePublicLinkController,
);
examRouter.delete(
  "/admin/public-links/:linkId",
  ...adminGuard,
  adminDeletePublicLinkController,
);
examRouter.post(
  "/admin/exams/:examId/bulk-upload",
  ...adminGuard,
  adminBulkUploadController,
);
examRouter.get(
  "/admin/exams/:examId/results.xlsx",
  ...adminGuard,
  adminExportResultsController,
);
examRouter.post(
  "/admin/exams/:examId/reset-attempts",
  ...adminGuard,
  adminResetAttemptsController,
);
// Attempt-management reads (item C4).
examRouter.get(
  "/admin/exams/:examId/attempt-counters",
  ...adminGuard,
  adminListAttemptCountersController,
);
examRouter.get(
  "/admin/exams/:examId/reset-log",
  ...adminGuard,
  adminListResetLogController,
);
examRouter.get(
  "/admin/exams/:examId/users/:userId/attempts",
  ...adminGuard,
  adminGetUserExamAttemptsController,
);
