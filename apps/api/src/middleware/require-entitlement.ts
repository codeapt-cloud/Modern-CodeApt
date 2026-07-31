/**
 * Entitlement guards — THE single place feature/sub-capability/course access is
 * enforced. Run AFTER resolveTenant (they read `req.tenant`). Denials return a
 * typed 403 so clients can react precisely.
 *
 * Platform admins (super_admin / legacy admin) BYPASS entitlement checks: they
 * own the platform and grant these entitlements, so they are never gated by
 * them. College users are always subject to the checks.
 *
 * See docs/MULTI_TENANT_ARCHITECTURE.md.
 */
import {
  checkEntitlement,
  isCourseGranted,
  isPlatformAdmin,
  TenantErrorCode,
  type CollegeFeature,
} from "@codeapt/shared";
import type { RequestHandler } from "express";

import { AppError } from "../errors/app-error.js";

function ensureTenant(req: Parameters<RequestHandler>[0]): NonNullable<
  typeof req.tenant
> {
  if (!req.tenant) {
    throw new AppError(
      "A college (tenant) context is required for this operation",
      500,
      TenantErrorCode.TENANT_CONTEXT_REQUIRED,
    );
  }
  return req.tenant;
}

/**
 * Require a FEATURE (optionally a specific SUB-CAPABILITY under it) to be
 * enabled for the resolved college. Feature off → FEATURE_NOT_ENABLED; feature
 * on but sub-capability off → SUB_CAPABILITY_NOT_ENABLED.
 */
export function requireFeature(
  feature: CollegeFeature,
  subCapability?: string,
): RequestHandler {
  return (req, _res, next) => {
    const tenant = ensureTenant(req);
    if (isPlatformAdmin(tenant.role)) return next();

    if (!checkEntitlement(tenant.entitlements, feature)) {
      throw new AppError(
        `This college does not have the "${feature}" feature enabled`,
        403,
        TenantErrorCode.FEATURE_NOT_ENABLED,
        { feature },
      );
    }
    if (
      subCapability !== undefined &&
      !checkEntitlement(tenant.entitlements, feature, subCapability)
    ) {
      throw new AppError(
        `This college does not have "${feature}.${subCapability}" enabled`,
        403,
        TenantErrorCode.SUB_CAPABILITY_NOT_ENABLED,
        { feature, subCapability },
      );
    }
    next();
  };
}

/**
 * Require a specific master-catalog course (id in `req.params[paramName]`) to be
 * granted to the resolved college. Not granted → COURSE_NOT_GRANTED.
 */
export function requireCourseGranted(
  paramName = "courseId",
): RequestHandler {
  return (req, _res, next) => {
    const tenant = ensureTenant(req);
    if (isPlatformAdmin(tenant.role)) return next();

    const courseId = req.params[paramName] ?? "";
    if (!isCourseGranted(tenant.entitlements, courseId)) {
      throw new AppError(
        "This course is not granted to your college",
        403,
        TenantErrorCode.COURSE_NOT_GRANTED,
        { courseId },
      );
    }
    next();
  };
}
