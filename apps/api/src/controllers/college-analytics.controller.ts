/**
 * College analytics controllers (Phase 5a) — thin: resolve the college from
 * `req.tenant` + the actor (for faculty scope) from `req.auth`, delegate to the
 * tenant + faculty-scoped analytics service, shape the response. Read-only.
 * Behind the tenant stack + requireFeature('analytics') + requireFaculty.
 */
import { AuthErrorCode, TenantErrorCode } from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import * as analytics from "../services/college-analytics.service.js";
import type { AnalyticsActor } from "../services/college-analytics.service.js";

function tenantId(req: Request): string {
  if (!req.tenant) {
    throw new AppError(
      "A college (tenant) context is required",
      500,
      TenantErrorCode.TENANT_CONTEXT_REQUIRED,
    );
  }
  return req.tenant.college.id;
}

function actor(req: Request): AnalyticsActor {
  if (!req.auth) {
    throw new AppError(
      "Authentication required",
      401,
      AuthErrorCode.UNAUTHENTICATED,
    );
  }
  return { userId: req.auth.userId, role: req.auth.role };
}

export const analyticsOverviewController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(await analytics.analyticsOverview(tenantId(req), actor(req)));
  },
);

export const analyticsByOrgUnitController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(await analytics.analyticsByOrgUnit(tenantId(req), actor(req)));
  },
);

export const analyticsStudentController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await analytics.analyticsStudent(
          tenantId(req),
          actor(req),
          req.params.studentId ?? "",
        ),
      );
  },
);
