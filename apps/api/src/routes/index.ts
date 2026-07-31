/**
 * Root API router. Mounts every feature router under `/api`.
 * Feature routers (auth, courses, exams, …) are added in later steps.
 */
import { Router } from "express";

import { adminRouter } from "./admin.routes.js";
import { authRouter } from "./auth.routes.js";
import { challengeRouter } from "./challenge.routes.js";
import { collegeRouter } from "./college.routes.js";
import { collegeAdminRouter } from "./college-admin.routes.js";
import { collegeCareersRouter } from "./college-careers.routes.js";
import { collegeCourseRouter } from "./college-course.routes.js";
import { collegeAnalyticsRouter } from "./college-analytics.routes.js";
import { collegeChallengeRouter } from "./college-challenge.routes.js";
import { collegeEssayRouter } from "./college-essay.routes.js";
import { collegeExamRouter } from "./college-exam.routes.js";
import { attendanceRouter } from "./attendance.routes.js";
import { facultyRouter } from "./faculty.routes.js";
import { orgUnitRouter } from "./org-unit.routes.js";
import { questionBankAdminRouter } from "./question-bank-admin.routes.js";
import { aiProviderAdminRouter } from "./ai-provider-admin.routes.js";
import { collegeQuestionBankRouter } from "./college-question-bank.routes.js";
import { studentRouter } from "./student.routes.js";
import { challengeAdminRouter } from "./challenge-admin.routes.js";
import { careersRouter } from "./careers.routes.js";
import { couponRouter } from "./coupon.routes.js";
import { curriculumRouter } from "./curriculum.routes.js";
import { essayRouter } from "./essay.routes.js";
import { essayTopicRouter } from "./essay-topic.routes.js";
import { essayAnalyticsAdminRouter } from "./essay-analytics-admin.routes.js";
import { examRouter } from "./exam.routes.js";
import { paymentRouter } from "./payment.routes.js";
import { executionRouter } from "./execution.routes.js";
import { healthRouter } from "./health.routes.js";
import { meRouter } from "./me.routes.js";
import { orderAdminRouter } from "./order-admin.routes.js";
import { publicRouter } from "./public.routes.js";
import { uploadAdminRouter } from "./upload-admin.routes.js";
import { userAdminRouter } from "./user-admin.routes.js";

export const apiRouter: Router = Router();

apiRouter.use(healthRouter);
// Public (pre-auth) reads — college login branding, etc. No auth/tenant stack.
apiRouter.use(publicRouter);
apiRouter.use(authRouter);
apiRouter.use(meRouter);
apiRouter.use(curriculumRouter);
apiRouter.use(executionRouter);
apiRouter.use(challengeRouter);
apiRouter.use(challengeAdminRouter);
apiRouter.use(examRouter);
apiRouter.use(essayRouter);
apiRouter.use(essayTopicRouter);
apiRouter.use(essayAnalyticsAdminRouter);
apiRouter.use(paymentRouter);
apiRouter.use(careersRouter);
apiRouter.use(couponRouter);
apiRouter.use(userAdminRouter);
apiRouter.use(orderAdminRouter);
apiRouter.use(uploadAdminRouter);
apiRouter.use(adminRouter);
// Multi-tenant colleges (Phase 0 foundation).
apiRouter.use(collegeAdminRouter);
apiRouter.use(collegeRouter);
// Org structure + faculty (Phase 2, tenant-scoped).
apiRouter.use(orgUnitRouter);
apiRouter.use(facultyRouter);
// College students + bulk import (Phase 3, tenant-scoped + faculty-scoped).
apiRouter.use(studentRouter);
// College course assignment (Phase 4a, tenant-scoped + feature/grant-gated).
apiRouter.use(collegeCourseRouter);
// College exams (Phase 4b, tenant-scoped over the reused exam engine).
apiRouter.use(collegeExamRouter);

apiRouter.use(attendanceRouter);
// College essays (Phase 4c, tenant-scoped over the reused essay engine).
apiRouter.use(collegeEssayRouter);
// College challenges (Phase 4d, tenant-scoped leaderboard over the daily engine).
apiRouter.use(collegeChallengeRouter);
// College analytics (Phase 5a, tenant + faculty-scoped read-only aggregation).
apiRouter.use(collegeAnalyticsRouter);
// College postings (Phase 5b, tenant-scoped over the reused careers engine).
apiRouter.use(collegeCareersRouter);
// Question bank (net-new): global banks (super-admin) + per-college Self Bank +
// browse/pull (tenant + grant gated), reusing the exam parsers + creation path.
apiRouter.use(questionBankAdminRouter);
apiRouter.use(collegeQuestionBankRouter);
// LLM gateway admin (super-admin): manage providers/keys + live monitoring.
apiRouter.use(aiProviderAdminRouter);
