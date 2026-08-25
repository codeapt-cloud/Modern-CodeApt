/**
 * OPEN communication-composite routes (Step 29) — the NON-tenant surface:
 *   - global enrollment-based discovery + the student view/launch of a
 *     course-attached / platform composite, authorized by the access matrix (no
 *     slug/tenant/feature). Launch returns {partType, ref}; the client routes
 *     into the EXISTING global engine runners (/speaking, /exams, /essays);
 *   - platform-admin authoring under `/admin/communication` behind requireAdmin.
 * The tenant surface (`/c/:slug/communication/...`) is UNCHANGED — it lives in
 * communication.routes.ts; this file adds paths beside it.
 */
import { Router } from "express";

import {
  adminCreateCommunicationController,
  adminDeleteCommunicationController,
  adminGetCommunicationController,
  adminListCommunicationController,
  adminSetCommunicationPublishController,
  adminUpdateCommunicationController,
  getCommunicationStudentController,
  launchCommunicationPartController,
  listCommunicationForUserController,
} from "../controllers/communication.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { startAttemptRateLimiter } from "../middleware/rate-limit.js";
import { requireAdmin } from "../middleware/require-role.js";
import { requireAuth } from "../middleware/require-auth.js";

export const communicationOpenRouter: Router = Router();

const authed = [requireAuth, enforcePasswordChange];
const adminGuard = [requireAuth, enforcePasswordChange, requireAdmin];

// --- Enrollment-based discovery + student consumption ---
communicationOpenRouter.get(
  "/communication",
  ...authed,
  listCommunicationForUserController,
);
communicationOpenRouter.get(
  "/communication/:assessmentId/student",
  ...authed,
  getCommunicationStudentController,
);
communicationOpenRouter.post(
  "/communication/:assessmentId/parts/:order/launch",
  ...authed,
  startAttemptRateLimiter,
  launchCommunicationPartController,
);

// --- Platform-admin authoring (requireAdmin) — literal /admin/communication first ---
communicationOpenRouter.get(
  "/admin/communication",
  ...adminGuard,
  adminListCommunicationController,
);
communicationOpenRouter.post(
  "/admin/communication",
  ...adminGuard,
  adminCreateCommunicationController,
);
communicationOpenRouter.get(
  "/admin/communication/:assessmentId",
  ...adminGuard,
  adminGetCommunicationController,
);
communicationOpenRouter.patch(
  "/admin/communication/:assessmentId",
  ...adminGuard,
  adminUpdateCommunicationController,
);
communicationOpenRouter.post(
  "/admin/communication/:assessmentId/publish",
  ...adminGuard,
  adminSetCommunicationPublishController,
);
communicationOpenRouter.delete(
  "/admin/communication/:assessmentId",
  ...adminGuard,
  adminDeleteCommunicationController,
);
