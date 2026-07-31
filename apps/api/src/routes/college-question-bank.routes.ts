/**
 * College question-bank routes — tenant-scoped at /c/:collegeSlug/question-banks
 * behind the full tenant stack (requireAuth → enforcePasswordChange →
 * resolveTenant) + requireFaculty. NO requireFeature here: a college's OWN Self
 * Bank is always available (it's their data); access to the GLOBAL banks is
 * gated by the `question_banks` grant INSIDE the service (so self-bank browse/
 * pull works even without the grant, while global browse/pull 403s without it).
 */
import { CollegeFeature } from "@codeapt/shared";
import { Router } from "express";

import {
  aiGenerateExamController,
  aiGenerateQuestionsController,
  browseCollegeBankController,
  pullIntoExamController,
} from "../controllers/college-question-bank.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireFeature } from "../middleware/require-entitlement.js";
import { requireFaculty } from "../middleware/require-role.js";
import { resolveTenant } from "../middleware/resolve-tenant.js";

export const collegeQuestionBankRouter: Router = Router();

const facultyTenant = [
  requireAuth,
  enforcePasswordChange,
  resolveTenant,
  requireFaculty,
];

collegeQuestionBankRouter.get(
  "/c/:collegeSlug/question-banks",
  ...facultyTenant,
  browseCollegeBankController,
);
collegeQuestionBankRouter.post(
  "/c/:collegeSlug/question-banks/pull-into-exam",
  ...facultyTenant,
  pullIntoExamController,
);
// AI Test Builder — authors real exam questions, so it sits behind the `exams`
// feature AND the per-college AI toggle `ai.question_generation` (in addition to
// faculty + tenant). Self Bank populate is a side effect.
collegeQuestionBankRouter.post(
  "/c/:collegeSlug/question-banks/ai-generate",
  requireAuth,
  enforcePasswordChange,
  resolveTenant,
  requireFeature(CollegeFeature.EXAMS),
  requireFeature(CollegeFeature.AI, "question_generation"),
  requireFaculty,
  aiGenerateQuestionsController,
);
// Full-Exam AI Build — designs sections + questions for a whole exam. Same gate.
collegeQuestionBankRouter.post(
  "/c/:collegeSlug/question-banks/ai-generate-exam",
  requireAuth,
  enforcePasswordChange,
  resolveTenant,
  requireFeature(CollegeFeature.EXAMS),
  requireFeature(CollegeFeature.AI, "question_generation"),
  requireFaculty,
  aiGenerateExamController,
);
