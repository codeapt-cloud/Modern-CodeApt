/**
 * College careers/postings routes — tenant-scoped at /c/:collegeSlug/... behind
 * the full tenant stack PLUS the `postings` FEATURE entitlement. Reuses the
 * existing careers engine (see college-careers.service.ts); these routes only
 * add the tenant-scoped authoring surface (college_admin / scoped faculty), the
 * applications review, and the student browse/apply.
 *
 * Naming (mirrors the essay split so the two never collide on `/:id`): authoring
 * uses `/postings/...` (like the admin `/admin/careers`), student browse/apply
 * uses `/careers/...` (like the individual `/careers`). Application status is
 * mutated on `/posting-applications/:appId` (its own literal prefix).
 */
import { CollegeFeature } from "@codeapt/shared";
import { Router } from "express";

import {
  applyStudentCollegePostingController,
  collegePostingApplicationsController,
  createCollegePostingController,
  deleteCollegePostingController,
  getCollegePostingController,
  getStudentCollegePostingController,
  listCollegePostingsController,
  listStudentCollegePostingsController,
  setCollegePostingPublishController,
  updateCollegeApplicationStatusController,
  updateCollegePostingController,
} from "../controllers/college-careers.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireFeature } from "../middleware/require-entitlement.js";
import { requireFaculty } from "../middleware/require-role.js";
import { resolveTenant } from "../middleware/resolve-tenant.js";

export const collegeCareersRouter: Router = Router();

// Any college member + the `postings` feature (a college student browses here).
const member = [
  requireAuth,
  enforcePasswordChange,
  resolveTenant,
  requireFeature(CollegeFeature.POSTINGS),
];
// Authoring = member stack + faculty authority (scope enforced in the service).
const author = [...member, requireFaculty];

// --- Authoring: posting list + lifecycle (faculty/college_admin) -------------
collegeCareersRouter.get(
  "/c/:collegeSlug/postings",
  ...author,
  listCollegePostingsController,
);
collegeCareersRouter.post(
  "/c/:collegeSlug/postings",
  ...author,
  createCollegePostingController,
);
// Literal prefix — registered BEFORE "/postings/:postingId" so it isn't
// captured as a posting id.
collegeCareersRouter.patch(
  "/c/:collegeSlug/posting-applications/:appId",
  ...author,
  updateCollegeApplicationStatusController,
);
collegeCareersRouter.get(
  "/c/:collegeSlug/postings/:postingId",
  ...author,
  getCollegePostingController,
);
collegeCareersRouter.patch(
  "/c/:collegeSlug/postings/:postingId",
  ...author,
  updateCollegePostingController,
);
collegeCareersRouter.delete(
  "/c/:collegeSlug/postings/:postingId",
  ...author,
  deleteCollegePostingController,
);
collegeCareersRouter.post(
  "/c/:collegeSlug/postings/:postingId/publish",
  ...author,
  setCollegePostingPublishController,
);
collegeCareersRouter.get(
  "/c/:collegeSlug/postings/:postingId/applications",
  ...author,
  collegePostingApplicationsController,
);

// --- Browsing / applying (member) --------------------------------------------
collegeCareersRouter.get(
  "/c/:collegeSlug/careers",
  ...member,
  listStudentCollegePostingsController,
);
collegeCareersRouter.get(
  "/c/:collegeSlug/careers/:postingId",
  ...member,
  getStudentCollegePostingController,
);
collegeCareersRouter.post(
  "/c/:collegeSlug/careers/:postingId/apply",
  ...member,
  applyStudentCollegePostingController,
);
