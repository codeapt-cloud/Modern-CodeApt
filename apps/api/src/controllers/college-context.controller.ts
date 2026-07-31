/**
 * College-context controllers — the tenant-scoped read surface a college client
 * bootstraps from. Run after requireAuth + resolveTenant, so `req.tenant` and
 * `req.auth` are guaranteed present. These are spine endpoints (not feature UI):
 * they expose the validated tenant identity, the caller's membership, and the
 * college's entitlements / granted catalog.
 */
import {
  AuthErrorCode,
  TenantErrorCode,
  type CollegeContextResponse,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import { getCreditBalance } from "../services/ai-credit.service.js";
import { getStudentAttendance } from "../services/attendance-analytics.service.js";
import * as colleges from "../services/college.service.js";
import { getCollegeStudentSummary } from "../services/college-student-summary.service.js";
import { getCollegeSummary } from "../services/college-summary.service.js";
import { getMyCollegeEnrollments } from "../services/curriculum.service.js";

function requireTenant(req: Request) {
  if (!req.auth) {
    throw new AppError(
      "Authentication required",
      401,
      AuthErrorCode.UNAUTHENTICATED,
    );
  }
  if (!req.tenant) {
    throw new AppError(
      "A college (tenant) context is required",
      500,
      TenantErrorCode.TENANT_CONTEXT_REQUIRED,
    );
  }
  return { auth: req.auth, tenant: req.tenant };
}

export const getCollegeContextController = asyncHandler(
  async (req: Request, res: Response) => {
    const { auth, tenant } = requireTenant(req);
    const body: CollegeContextResponse = {
      college: tenant.college,
      membership: { role: tenant.role, userType: auth.userType },
      entitlements: tenant.entitlements,
    };
    res.status(200).json(body);
  },
);

export const listGrantedCoursesController = asyncHandler(
  async (req: Request, res: Response) => {
    const { tenant } = requireTenant(req);
    res
      .status(200)
      .json(await colleges.listGrantedCourses(tenant.entitlements.grantedCourses));
  },
);

/**
 * College STUDENT home summary — the overview counts for the student dashboard.
 * Runs on the plain tenant stack (no operator gate) so a college student reaches
 * it; the counts are computed for the CALLING user (`req.auth.userId`) and gated
 * by the college's entitlements. Reuses the tenant-scoped student services.
 */
export const getCollegeStudentSummaryController = asyncHandler(
  async (req: Request, res: Response) => {
    const { auth, tenant } = requireTenant(req);
    res
      .status(200)
      .json(
        await getCollegeStudentSummary(
          tenant.college.id,
          auth.userId,
          tenant.entitlements,
        ),
      );
  },
);

/**
 * A college student's ASSIGNED college courses — the "My courses" list in the
 * student space. Plain tenant stack (no operator gate), computed for the calling
 * user, tenant-isolated + `source=college` (never their individual enrollments).
 * Same DTO as `/me/enrollments`, so the same course card + `/learn/:slug` player
 * are reused.
 */
export const getCollegeStudentCoursesController = asyncHandler(
  async (req: Request, res: Response) => {
    const { auth, tenant } = requireTenant(req);
    res
      .status(200)
      .json(await getMyCollegeEnrollments(auth.userId, tenant.college.id));
  },
);

/**
 * College dashboard summary — aggregate counts + recent students for the
 * workspace landing. The actor (for faculty-scope resolution) comes from
 * `req.auth`; the college id + granted-course list from the validated
 * `req.tenant`. Guarded by requireFaculty on the route (operators only).
 */
export const getCollegeSummaryController = asyncHandler(
  async (req: Request, res: Response) => {
    const { auth, tenant } = requireTenant(req);
    res
      .status(200)
      .json(
        await getCollegeSummary(
          tenant.college.id,
          { userId: auth.userId, role: auth.role },
          tenant.entitlements.grantedCourses,
        ),
      );
  },
);

/**
 * Read-only AI-credit balance for the operator workspace (this college's current
 * period): allocated / consumed / remaining + per-feature. View only — operators
 * cannot change credits (that's the super-admin credits endpoint).
 */
export const getCollegeAiCreditsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { tenant } = requireTenant(req);
    res.status(200).json(await getCreditBalance(tenant.college.id, new Date()));
  },
);

/**
 * The CALLING student's OWN attendance — overall + per-group % and a present/
 * absent session history, over completed sessions. Own-data-only: the student id
 * is always `req.auth.userId`, so a student can never read another's attendance.
 * Feature-gated (`attendance`) on the route.
 */
export const getMyAttendanceController = asyncHandler(
  async (req: Request, res: Response) => {
    const { auth, tenant } = requireTenant(req);
    res
      .status(200)
      .json(await getStudentAttendance(tenant.college.id, auth.userId));
  },
);
