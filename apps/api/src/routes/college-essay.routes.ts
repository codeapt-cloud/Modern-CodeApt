/**
 * College essay routes — tenant-scoped at /c/:collegeSlug/... behind the full
 * tenant stack PLUS the `essays` FEATURE entitlement. Reuses the existing essay
 * engine (see college-essay.service.ts); these routes only add the tenant-scoped
 * authoring surface (college_admin / scoped faculty) and the student list +
 * write. The grading-status POLL + writing analytics reuse the SHARED
 * /essays/submissions/:jobId endpoints (authorized by attempt ownership) — a
 * college student rides them unchanged, so they are NOT duplicated here.
 *
 * Naming: authoring uses `/essay-topics/...` (mirrors the admin `/admin/essay-
 * topics`), taking uses `/essays/...` — so the two never collide on `/:id`. The
 * literal `/essay-topics/generate-keywords` is registered before `/:essayTopicId`
 * so it is never captured as an id.
 */
import { CollegeFeature } from "@codeapt/shared";
import { Router } from "express";

import {
  collegeEssayAiFeedbackController,
  collegeEssayResultsController,
  createCollegeEssayController,
  deleteCollegeEssayController,
  generateCollegeKeywordsController,
  getCollegeEssayController,
  getStudentCollegeDraftController,
  getStudentCollegeEssayController,
  listCollegeEssaysController,
  listStudentCollegeEssaysController,
  listStudentCollegeSubmissionsController,
  saveStudentCollegeDraftController,
  setCollegeEssayPublishController,
  submitStudentCollegeEssayController,
  updateCollegeEssayController,
} from "../controllers/college-essay.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { essaySubmitRateLimiter } from "../middleware/rate-limit.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireFeature } from "../middleware/require-entitlement.js";
import { requireFaculty } from "../middleware/require-role.js";
import { resolveTenant } from "../middleware/resolve-tenant.js";

export const collegeEssayRouter: Router = Router();

// Any college member + the `essays` feature (a college student writes here).
const member = [
  requireAuth,
  enforcePasswordChange,
  resolveTenant,
  requireFeature(CollegeFeature.ESSAYS),
];
// Authoring = member stack + faculty authority (scope enforced in the service).
const author = [...member, requireFaculty];

// --- Authoring: essay-topic list + lifecycle (faculty/college_admin) ---------
collegeEssayRouter.get(
  "/c/:collegeSlug/essay-topics",
  ...author,
  listCollegeEssaysController,
);
collegeEssayRouter.post(
  "/c/:collegeSlug/essay-topics",
  ...author,
  createCollegeEssayController,
);
// Literal path — registered BEFORE "/:essayTopicId" so it isn't captured as an id.
collegeEssayRouter.post(
  "/c/:collegeSlug/essay-topics/generate-keywords",
  ...author,
  generateCollegeKeywordsController,
);
collegeEssayRouter.get(
  "/c/:collegeSlug/essay-topics/:essayTopicId",
  ...author,
  getCollegeEssayController,
);
collegeEssayRouter.patch(
  "/c/:collegeSlug/essay-topics/:essayTopicId",
  ...author,
  updateCollegeEssayController,
);
collegeEssayRouter.delete(
  "/c/:collegeSlug/essay-topics/:essayTopicId",
  ...author,
  deleteCollegeEssayController,
);
collegeEssayRouter.post(
  "/c/:collegeSlug/essay-topics/:essayTopicId/publish",
  ...author,
  setCollegeEssayPublishController,
);
collegeEssayRouter.get(
  "/c/:collegeSlug/essay-topics/:essayTopicId/results",
  ...author,
  collegeEssayResultsController,
);
// Faculty on-demand AI Scoring & Feedback for one attempt — additionally gated
// by the per-college `ai.essay_grading` toggle.
collegeEssayRouter.post(
  "/c/:collegeSlug/essays/:attemptId/ai-feedback",
  ...author,
  requireFeature(CollegeFeature.AI, "essay_grading"),
  collegeEssayAiFeedbackController,
);

// --- Writing: student list + detail + draft + submit (member) ----------------
collegeEssayRouter.get(
  "/c/:collegeSlug/essays",
  ...member,
  listStudentCollegeEssaysController,
);
collegeEssayRouter.get(
  "/c/:collegeSlug/essays/:essayId",
  ...member,
  getStudentCollegeEssayController,
);
collegeEssayRouter.get(
  "/c/:collegeSlug/essays/:essayId/draft",
  ...member,
  getStudentCollegeDraftController,
);
collegeEssayRouter.put(
  "/c/:collegeSlug/essays/:essayId/draft",
  ...member,
  saveStudentCollegeDraftController,
);
collegeEssayRouter.get(
  "/c/:collegeSlug/essays/:essayId/submissions",
  ...member,
  listStudentCollegeSubmissionsController,
);
collegeEssayRouter.post(
  "/c/:collegeSlug/essays/:essayId/submit",
  ...member,
  essaySubmitRateLimiter,
  submitStudentCollegeEssayController,
);
