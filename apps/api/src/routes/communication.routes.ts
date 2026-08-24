/**
 * Communication composite routes — tenant-scoped at
 * /c/:collegeSlug/communication/assessments/... behind the full tenant stack +
 * the COMMUNICATION feature. Students consume (member); authoring + the cohort
 * report/export additionally require faculty authority + the `authoring`
 * sub-capability (a college composing its own communication content). Literal /
 * more-specific paths are registered BEFORE "/:assessmentId" so they aren't
 * captured as an id. Mirrors college-game.routes / speaking.routes.
 */
import { CollegeFeature } from "@codeapt/shared";
import { Router } from "express";

import {
  createCollegeCommunicationController,
  deleteCollegeCommunicationController,
  exportCommunicationCohortController,
  getCollegeCommunicationController,
  getCommunicationCohortController,
  getCommunicationStudentController,
  launchCommunicationPartController,
  listAvailableCommunicationController,
  listCollegeCommunicationController,
  setCollegeCommunicationPublishController,
  updateCollegeCommunicationController,
} from "../controllers/communication.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { startAttemptRateLimiter } from "../middleware/rate-limit.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireFeature } from "../middleware/require-entitlement.js";
import { requireFaculty } from "../middleware/require-role.js";
import { resolveTenant } from "../middleware/resolve-tenant.js";

export const collegeCommunicationRouter: Router = Router();

const BASE = "/c/:collegeSlug/communication/assessments";

// Any college member + the `communication` feature (a student takes here).
const member = [
  requireAuth,
  enforcePasswordChange,
  resolveTenant,
  requireFeature(CollegeFeature.COMMUNICATION),
];
// Authoring = member stack + faculty authority + the `authoring` sub-capability.
const author = [
  ...member,
  requireFaculty,
  requireFeature(CollegeFeature.COMMUNICATION, "authoring"),
];

// --- Student consumption (member) — literal before "/:assessmentId" ---
collegeCommunicationRouter.get(
  `${BASE}/available`,
  ...member,
  listAvailableCommunicationController,
);
collegeCommunicationRouter.get(
  `${BASE}/:assessmentId/student`,
  ...member,
  getCommunicationStudentController,
);
collegeCommunicationRouter.post(
  `${BASE}/:assessmentId/parts/:order/launch`,
  ...member,
  startAttemptRateLimiter,
  launchCommunicationPartController,
);

// --- Authoring (author) — list/create before "/:assessmentId" ---
collegeCommunicationRouter.get(
  BASE,
  ...author,
  listCollegeCommunicationController,
);
collegeCommunicationRouter.post(
  BASE,
  ...author,
  createCollegeCommunicationController,
);
// Cohort report + the ONE export (literal segments, before the bare GET).
collegeCommunicationRouter.get(
  `${BASE}/:assessmentId/cohort`,
  ...author,
  getCommunicationCohortController,
);
collegeCommunicationRouter.get(
  `${BASE}/:assessmentId/cohort/export`,
  ...author,
  exportCommunicationCohortController,
);
collegeCommunicationRouter.get(
  `${BASE}/:assessmentId`,
  ...author,
  getCollegeCommunicationController,
);
collegeCommunicationRouter.patch(
  `${BASE}/:assessmentId`,
  ...author,
  updateCollegeCommunicationController,
);
collegeCommunicationRouter.post(
  `${BASE}/:assessmentId/publish`,
  ...author,
  setCollegeCommunicationPublishController,
);
collegeCommunicationRouter.delete(
  `${BASE}/:assessmentId`,
  ...author,
  deleteCollegeCommunicationController,
);
