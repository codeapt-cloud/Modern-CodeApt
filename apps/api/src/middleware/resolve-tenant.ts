/**
 * resolveTenant — resolves + VALIDATES the college for a /c/:collegeSlug route.
 * Runs AFTER requireAuth. It:
 *   1. looks up the college by the path slug (404 if unknown),
 *   2. blocks suspended colleges for non-platform users (403),
 *   3. enforces membership: a college user may only ever act on THEIR OWN
 *      college; a platform admin (super_admin/legacy admin) may act on any,
 *   4. attaches the validated `req.tenant` (identity + entitlements + role).
 *
 * This is the hard cross-tenant boundary: without a passing resolveTenant there
 * is no `req.tenant`, and college-scoped work refuses to run unscoped.
 * See docs/MULTI_TENANT_ARCHITECTURE.md.
 */
import { AuthErrorCode, isPlatformAdmin, TenantErrorCode } from "@codeapt/shared";
import type { RequestHandler } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import {
  buildTenantContext,
  findCollegeBySlug,
} from "../services/college.service.js";

export const resolveTenant: RequestHandler = asyncHandler(
  async (req, _res, next) => {
    if (!req.auth) {
      throw new AppError(
        "Authentication required",
        401,
        AuthErrorCode.UNAUTHENTICATED,
      );
    }

    const slug = req.params.collegeSlug ?? "";
    const college = await findCollegeBySlug(slug);
    if (!college) {
      throw new AppError(
        "College not found",
        404,
        TenantErrorCode.COLLEGE_NOT_FOUND,
      );
    }

    const platformAdmin = isPlatformAdmin(req.auth.role);

    if (college.status === "suspended" && !platformAdmin) {
      throw new AppError(
        "This college is currently suspended",
        403,
        TenantErrorCode.COLLEGE_SUSPENDED,
      );
    }

    // Membership: college users are locked to their own tenant. Platform admins
    // (super_admin / legacy admin) may operate across tenants.
    if (!platformAdmin && req.auth.college !== college._id.toString()) {
      throw new AppError(
        "You do not have access to this college",
        403,
        TenantErrorCode.CROSS_TENANT_DENIED,
      );
    }

    req.tenant = buildTenantContext(college, req.auth.role);
    next();
  },
);
