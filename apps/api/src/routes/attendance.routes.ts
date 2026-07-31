/**
 * Attendance routes (Prompt 1) — tenant-scoped at /c/:collegeSlug/attendance/...
 * behind the full tenant stack PLUS the `attendance` FEATURE entitlement.
 *
 * Authoring (group formation + members) = faculty authority; the SERVICE
 * enforces org-unit scope + the college's cross-cutting permission. The settings
 * endpoints (the cross-cutting permission itself) require college_admin.
 *
 * Route ordering: the literal `groups/import/...` and `groups/settings`
 * sub-paths are registered BEFORE `groups/:groupId` so they are never captured
 * as a group id.
 */
import { CollegeFeature } from "@codeapt/shared";
import { Router } from "express";

import {
  addAttendanceMembersController,
  addSessionPhotosController,
  attendanceAnalyticsController,
  attendanceImportPreviewController,
  attendanceImportTemplateController,
  attendanceRegisterReportController,
  attendanceSummaryReportController,
  attendanceUploadSignatureController,
  createAttendanceGroupController,
  createAttendanceSessionController,
  deleteAttendanceGroupController,
  deleteAttendanceSessionController,
  getAttendanceGroupController,
  getAttendanceSessionController,
  getAttendanceSettingsController,
  listAttendanceGroupsController,
  listAttendanceSessionsController,
  removeAttendanceMemberController,
  removeSessionPhotoController,
  saveAttendanceController,
  setAttendanceSettingsController,
  updateAttendanceGroupController,
  updateAttendanceSessionController,
} from "../controllers/attendance.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireFeature } from "../middleware/require-entitlement.js";
import { requireCollegeAdmin, requireFaculty } from "../middleware/require-role.js";
import { resolveTenant } from "../middleware/resolve-tenant.js";

export const attendanceRouter: Router = Router();

// Tenant stack + the `attendance` feature.
const feature = [
  requireAuth,
  enforcePasswordChange,
  resolveTenant,
  requireFeature(CollegeFeature.ATTENDANCE),
];
// Authoring = feature stack + faculty authority (scope enforced in the service).
const author = [...feature, requireFaculty];
// Settings = feature stack + college_admin authority.
const admin = [...feature, requireCollegeAdmin];

// --- Analytics + Excel reports (Prompt 3) — read; service enforces scope.
// Literal `analytics/*` (before any `/:groupId`). The report endpoints stream an
// .xlsx attachment; the analytics endpoint returns the dashboard payload.
attendanceRouter.get(
  "/c/:collegeSlug/attendance/analytics",
  ...author,
  attendanceAnalyticsController,
);
attendanceRouter.get(
  "/c/:collegeSlug/attendance/analytics/report/register",
  ...author,
  attendanceRegisterReportController,
);
attendanceRouter.get(
  "/c/:collegeSlug/attendance/analytics/report/summary",
  ...author,
  attendanceSummaryReportController,
);

// --- Settings (cross-cutting permission) — literal, before /:groupId ---
attendanceRouter.get(
  "/c/:collegeSlug/attendance/settings",
  ...admin,
  getAttendanceSettingsController,
);
attendanceRouter.put(
  "/c/:collegeSlug/attendance/settings",
  ...admin,
  setAttendanceSettingsController,
);

// --- Excel roll-number template + preview — literal, before /:groupId ---
attendanceRouter.get(
  "/c/:collegeSlug/attendance/groups/import/template",
  ...author,
  attendanceImportTemplateController,
);
attendanceRouter.post(
  "/c/:collegeSlug/attendance/groups/import/preview",
  ...author,
  attendanceImportPreviewController,
);

// --- Groups (list / create / get / update / delete) ---
attendanceRouter.get(
  "/c/:collegeSlug/attendance/groups",
  ...author,
  listAttendanceGroupsController,
);
attendanceRouter.post(
  "/c/:collegeSlug/attendance/groups",
  ...author,
  createAttendanceGroupController,
);
attendanceRouter.get(
  "/c/:collegeSlug/attendance/groups/:groupId",
  ...author,
  getAttendanceGroupController,
);
attendanceRouter.patch(
  "/c/:collegeSlug/attendance/groups/:groupId",
  ...author,
  updateAttendanceGroupController,
);
attendanceRouter.delete(
  "/c/:collegeSlug/attendance/groups/:groupId",
  ...author,
  deleteAttendanceGroupController,
);

// --- Members (add / remove) ---
attendanceRouter.post(
  "/c/:collegeSlug/attendance/groups/:groupId/members",
  ...author,
  addAttendanceMembersController,
);
attendanceRouter.delete(
  "/c/:collegeSlug/attendance/groups/:groupId/members/:studentId",
  ...author,
  removeAttendanceMemberController,
);

// --- Sessions (Prompt 2): list + create under a group; the rest by session id.
// Only the group's owners/creator/admin (scope-enforced in the service) manage
// its sessions. Sessions of different groups may share a date/time — no conflict.
attendanceRouter.get(
  "/c/:collegeSlug/attendance/groups/:groupId/sessions",
  ...author,
  listAttendanceSessionsController,
);
attendanceRouter.post(
  "/c/:collegeSlug/attendance/groups/:groupId/sessions",
  ...author,
  createAttendanceSessionController,
);
// GET returns the session + its roster (members + each one's mark).
attendanceRouter.get(
  "/c/:collegeSlug/attendance/sessions/:sessionId",
  ...author,
  getAttendanceSessionController,
);
attendanceRouter.patch(
  "/c/:collegeSlug/attendance/sessions/:sessionId",
  ...author,
  updateAttendanceSessionController,
);
attendanceRouter.delete(
  "/c/:collegeSlug/attendance/sessions/:sessionId",
  ...author,
  deleteAttendanceSessionController,
);
// Mark/save the session's attendance (the final set) → records + completed.
attendanceRouter.put(
  "/c/:collegeSlug/attendance/sessions/:sessionId/attendance",
  ...author,
  saveAttendanceController,
);

// OPTIONAL session photos (filing/audit) — same manager authority. A Cloudinary
// upload signature (feature-scoped, since the platform one is admin-only), then
// add/remove photos by their stored URL. `uploads/signature` is literal before
// `sessions/:sessionId/...` — distinct segment, no capture risk.
attendanceRouter.post(
  "/c/:collegeSlug/attendance/uploads/signature",
  ...author,
  attendanceUploadSignatureController,
);
attendanceRouter.post(
  "/c/:collegeSlug/attendance/sessions/:sessionId/photos",
  ...author,
  addSessionPhotosController,
);
attendanceRouter.delete(
  "/c/:collegeSlug/attendance/sessions/:sessionId/photos/:photoId",
  ...author,
  removeSessionPhotoController,
);
