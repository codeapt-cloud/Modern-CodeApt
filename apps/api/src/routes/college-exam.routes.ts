/**
 * College exam routes — tenant-scoped at /c/:collegeSlug/exams/... behind the
 * full tenant stack PLUS the `exams` FEATURE entitlement. Reuses the existing
 * exam engine (see college-exam.service.ts); these routes only add the tenant-
 * scoped authoring surface (college_admin / scoped faculty) and the student
 * list + start. The attempt LIFECYCLE (section view / save / advance / submit /
 * finalize / result / warning) is the SHARED /attempts/* engine, authorized by
 * attempt ownership — a college student rides it unchanged, so it is NOT
 * duplicated here.
 *
 * Route ordering note: the student `GET /exams` and the authoring
 * `GET /exams/manage` are registered before `GET /exams/:examId` so the literal
 * segments are never captured as an exam id.
 */
import { CollegeFeature } from "@codeapt/shared";
import { Router } from "express";

import {
  addCollegeTestCaseController,
  collegeBulkUploadController,
  collegeBulkUploadTemplateController,
  collegeExamAnalysisController,
  collegeExamAnalysisReportController,
  collegeExamResultsController,
  collegeResetAttemptsController,
  createCollegeExamController,
  createCollegePublicLinkController,
  createCollegeQuestionController,
  createCollegeSectionController,
  deleteCollegeExamController,
  deleteCollegePublicLinkController,
  deleteCollegeQuestionController,
  deleteCollegeSectionController,
  deleteCollegeTestCaseController,
  getCollegeExamController,
  listCollegeExamsController,
  listStudentCollegeExamsController,
  setCollegeExamPublishController,
  startStudentCollegeExamController,
  updateCollegeExamController,
  updateCollegePublicLinkController,
  updateCollegeQuestionController,
  updateCollegeSectionController,
  updateCollegeTestCaseController,
} from "../controllers/college-exam-admin.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireFeature } from "../middleware/require-entitlement.js";
import { requireFaculty } from "../middleware/require-role.js";
import { resolveTenant } from "../middleware/resolve-tenant.js";

export const collegeExamRouter: Router = Router();

// Any college member + the `exams` feature (a college student takes here).
const member = [
  requireAuth,
  enforcePasswordChange,
  resolveTenant,
  requireFeature(CollegeFeature.EXAMS),
];
// Authoring = member stack + faculty authority (scope enforced in the service).
const author = [...member, requireFaculty];

// --- Student: list published exams + start an attempt (member) ---
collegeExamRouter.get(
  "/c/:collegeSlug/exams",
  ...member,
  listStudentCollegeExamsController,
);
collegeExamRouter.post(
  "/c/:collegeSlug/exams/:examId/attempts",
  ...member,
  startStudentCollegeExamController,
);

// --- Authoring: exam list + lifecycle (faculty/college_admin, scope-enforced) ---
collegeExamRouter.get(
  "/c/:collegeSlug/exams/manage",
  ...author,
  listCollegeExamsController,
);
// Literal — registered before "/exams/:examId" so it isn't captured as an id.
collegeExamRouter.get(
  "/c/:collegeSlug/exams/bulk-upload-template",
  ...author,
  collegeBulkUploadTemplateController,
);
collegeExamRouter.post(
  "/c/:collegeSlug/exams",
  ...author,
  createCollegeExamController,
);
collegeExamRouter.get(
  "/c/:collegeSlug/exams/:examId",
  ...author,
  getCollegeExamController,
);
collegeExamRouter.patch(
  "/c/:collegeSlug/exams/:examId",
  ...author,
  updateCollegeExamController,
);
collegeExamRouter.delete(
  "/c/:collegeSlug/exams/:examId",
  ...author,
  deleteCollegeExamController,
);
collegeExamRouter.post(
  "/c/:collegeSlug/exams/:examId/publish",
  ...author,
  setCollegeExamPublishController,
);
collegeExamRouter.get(
  "/c/:collegeSlug/exams/:examId/results",
  ...author,
  collegeExamResultsController,
);
// Phase-5 result analysis (JSON) + its Excel export. Read-only; the service
// enforces the same exam authority (scope) as the rest of authoring.
collegeExamRouter.get(
  "/c/:collegeSlug/exams/:examId/analysis",
  ...author,
  collegeExamAnalysisController,
);
collegeExamRouter.get(
  "/c/:collegeSlug/exams/:examId/analysis/report",
  ...author,
  collegeExamAnalysisReportController,
);
collegeExamRouter.post(
  "/c/:collegeSlug/exams/:examId/reset-attempts",
  ...author,
  collegeResetAttemptsController,
);
collegeExamRouter.post(
  "/c/:collegeSlug/exams/:examId/bulk-upload",
  ...author,
  collegeBulkUploadController,
);

// --- Sections ---
collegeExamRouter.post(
  "/c/:collegeSlug/exams/:examId/sections",
  ...author,
  createCollegeSectionController,
);
collegeExamRouter.patch(
  "/c/:collegeSlug/exam-sections/:sectionId",
  ...author,
  updateCollegeSectionController,
);
collegeExamRouter.delete(
  "/c/:collegeSlug/exam-sections/:sectionId",
  ...author,
  deleteCollegeSectionController,
);

// --- Questions ---
collegeExamRouter.post(
  "/c/:collegeSlug/exam-questions",
  ...author,
  createCollegeQuestionController,
);
collegeExamRouter.patch(
  "/c/:collegeSlug/exam-questions/:questionId",
  ...author,
  updateCollegeQuestionController,
);
collegeExamRouter.delete(
  "/c/:collegeSlug/exam-questions/:questionId",
  ...author,
  deleteCollegeQuestionController,
);

// --- Test cases ---
collegeExamRouter.post(
  "/c/:collegeSlug/exam-questions/:questionId/test-cases",
  ...author,
  addCollegeTestCaseController,
);
collegeExamRouter.patch(
  "/c/:collegeSlug/exam-test-cases/:testCaseId",
  ...author,
  updateCollegeTestCaseController,
);
collegeExamRouter.delete(
  "/c/:collegeSlug/exam-test-cases/:testCaseId",
  ...author,
  deleteCollegeTestCaseController,
);

// --- Public links ---
collegeExamRouter.post(
  "/c/:collegeSlug/exams/:examId/public-links",
  ...author,
  createCollegePublicLinkController,
);
collegeExamRouter.patch(
  "/c/:collegeSlug/exam-public-links/:linkId",
  ...author,
  updateCollegePublicLinkController,
);
collegeExamRouter.delete(
  "/c/:collegeSlug/exam-public-links/:linkId",
  ...author,
  deleteCollegePublicLinkController,
);
