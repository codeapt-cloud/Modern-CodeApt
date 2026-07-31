import { Router } from "express";

import {
  adminBulkUploadTopicsController,
  adminBulkUploadTopicsTemplateController,
  adminCreateModuleController,
  adminCreateProgramController,
  adminCreateQuizQuestionController,
  adminCreateSubjectController,
  adminCreateTopicController,
  adminDeleteModuleController,
  adminDeleteProgramController,
  adminDeleteQuizQuestionController,
  adminDeleteSubjectController,
  adminDeleteTopicController,
  adminGetModuleController,
  adminGetProgramController,
  adminGetSubjectController,
  adminGetTopicController,
  adminListExamTopicsController,
  adminListModulesController,
  adminListProgramsController,
  adminListQuizQuestionsController,
  adminListSubjectsController,
  adminListTopicsController,
  adminReorderModulesController,
  adminReorderProgramsController,
  adminReorderTopicsController,
  adminUpdateModuleController,
  adminUpdateProgramController,
  adminUpdateQuizQuestionController,
  adminUpdateSubjectController,
  adminUpdateTopicController,
} from "../controllers/curriculum-admin.controller.js";
import {
  adminBulkEnrollController,
  adminBulkEnrollTemplateController,
} from "../controllers/enrollment-admin.controller.js";
import {
  completeTopicController,
  enrollController,
  getCatalogController,
  getMyEnrollmentsController,
  getQuizController,
  getSubjectDetailController,
  getTopicContentController,
  submitQuizController,
} from "../controllers/curriculum.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { optionalAuth } from "../middleware/optional-auth.js";
import { requireAdmin } from "../middleware/require-role.js";
import { requireAuth } from "../middleware/require-auth.js";

export const curriculumRouter: Router = Router();

// Authed content/progress/quiz routes share these guards.
const authed = [requireAuth, enforcePasswordChange];
// Admin authoring guard stack (mirrors exam-admin / careers-admin).
const admin = [requireAuth, enforcePasswordChange, requireAdmin];

// --- Public browse (personalized when authenticated) ---
curriculumRouter.get("/catalog", optionalAuth, getCatalogController);
curriculumRouter.get(
  "/subjects/:slug",
  optionalAuth,
  getSubjectDetailController,
);

// --- Enrollment ---
curriculumRouter.post("/subjects/:slug/enroll", ...authed, enrollController);
curriculumRouter.get("/me/enrollments", ...authed, getMyEnrollmentsController);

// --- Topic content + progress (enrollment enforced in the service) ---
curriculumRouter.get(
  "/subjects/:slug/topics/:topicId",
  ...authed,
  getTopicContentController,
);
curriculumRouter.post(
  "/subjects/:slug/topics/:topicId/complete",
  ...authed,
  completeTopicController,
);

// --- Quiz ---
curriculumRouter.get(
  "/subjects/:slug/topics/:topicId/quiz",
  ...authed,
  getQuizController,
);
curriculumRouter.post(
  "/subjects/:slug/topics/:topicId/quiz/submit",
  ...authed,
  submitQuizController,
);

// ===========================================================================
// Admin authoring — structural tree (Program / Subject / Module). requireAdmin.
// Static/collection paths are registered before parameterized ones so that
// e.g. `/admin/programs/reorder` is never shadowed by `/admin/programs/:id`.
// ===========================================================================

// --- Bulk enroll (roster → provision + enroll across subjects) ---
curriculumRouter.post(
  "/admin/enrollments/bulk-upload",
  ...admin,
  adminBulkEnrollController,
);
curriculumRouter.get(
  "/admin/enrollments/bulk-upload-template",
  ...admin,
  adminBulkEnrollTemplateController,
);

// --- Program ---
curriculumRouter.get("/admin/programs", ...admin, adminListProgramsController);
curriculumRouter.post("/admin/programs", ...admin, adminCreateProgramController);
curriculumRouter.post(
  "/admin/programs/reorder",
  ...admin,
  adminReorderProgramsController,
);
curriculumRouter.get(
  "/admin/programs/:programId",
  ...admin,
  adminGetProgramController,
);
curriculumRouter.patch(
  "/admin/programs/:programId",
  ...admin,
  adminUpdateProgramController,
);
curriculumRouter.delete(
  "/admin/programs/:programId",
  ...admin,
  adminDeleteProgramController,
);

// --- Subject ---
curriculumRouter.get("/admin/subjects", ...admin, adminListSubjectsController);
curriculumRouter.post("/admin/subjects", ...admin, adminCreateSubjectController);
// Nested modules (create/list/reorder scoped to a subject).
curriculumRouter.get(
  "/admin/subjects/:subjectId/modules",
  ...admin,
  adminListModulesController,
);
curriculumRouter.post(
  "/admin/subjects/:subjectId/modules/reorder",
  ...admin,
  adminReorderModulesController,
);
curriculumRouter.post(
  "/admin/subjects/:subjectId/modules",
  ...admin,
  adminCreateModuleController,
);
// Bulk topic import (text/video only) — base64 xlsx in the JSON body.
curriculumRouter.post(
  "/admin/subjects/:subjectId/topics/bulk-upload",
  ...admin,
  adminBulkUploadTopicsController,
);
// Static topics template — registered before "/admin/topics/:topicId" (below)
// so the literal isn't captured as a topic id.
curriculumRouter.get(
  "/admin/topics/import-template",
  ...admin,
  adminBulkUploadTopicsTemplateController,
);
curriculumRouter.get(
  "/admin/subjects/:subjectId",
  ...admin,
  adminGetSubjectController,
);
curriculumRouter.patch(
  "/admin/subjects/:subjectId",
  ...admin,
  adminUpdateSubjectController,
);
curriculumRouter.delete(
  "/admin/subjects/:subjectId",
  ...admin,
  adminDeleteSubjectController,
);

// --- Module (flat by id) ---
// Nested topics (create/list/reorder scoped to a module) — register before the
// flat `/admin/modules/:moduleId` handlers is unnecessary (distinct segments),
// but reorder is listed before create so `/topics/reorder` is never ambiguous.
curriculumRouter.get(
  "/admin/modules/:moduleId/topics",
  ...admin,
  adminListTopicsController,
);
curriculumRouter.post(
  "/admin/modules/:moduleId/topics/reorder",
  ...admin,
  adminReorderTopicsController,
);
curriculumRouter.post(
  "/admin/modules/:moduleId/topics",
  ...admin,
  adminCreateTopicController,
);
curriculumRouter.get("/admin/modules/:moduleId", ...admin, adminGetModuleController);
curriculumRouter.patch(
  "/admin/modules/:moduleId",
  ...admin,
  adminUpdateModuleController,
);
curriculumRouter.delete(
  "/admin/modules/:moduleId",
  ...admin,
  adminDeleteModuleController,
);

// ===========================================================================
// Admin authoring — leaf tree (Topic + quiz Question/Choice). requireAdmin.
// ===========================================================================

// --- Exam-topic picker (what the 4b exam editor lists to attach/find exams) ---
curriculumRouter.get("/admin/exam-topics", ...admin, adminListExamTopicsController);

// --- Quiz questions (nested under a quiz topic) ---
curriculumRouter.get(
  "/admin/topics/:topicId/questions",
  ...admin,
  adminListQuizQuestionsController,
);
curriculumRouter.post(
  "/admin/topics/:topicId/questions",
  ...admin,
  adminCreateQuizQuestionController,
);

// --- Topic (flat by id) ---
curriculumRouter.get("/admin/topics/:topicId", ...admin, adminGetTopicController);
curriculumRouter.patch(
  "/admin/topics/:topicId",
  ...admin,
  adminUpdateTopicController,
);
curriculumRouter.delete(
  "/admin/topics/:topicId",
  ...admin,
  adminDeleteTopicController,
);

// --- Quiz question (flat by id) ---
curriculumRouter.patch(
  "/admin/questions/:questionId",
  ...admin,
  adminUpdateQuizQuestionController,
);
curriculumRouter.delete(
  "/admin/questions/:questionId",
  ...admin,
  adminDeleteQuizQuestionController,
);
