/**
 * Role guards. Must run AFTER requireAuth (they read `req.auth`).
 *
 * Authority hierarchy (from @codeapt/shared, the single source of truth):
 *   super_admin / admin(legacy)  ⊃  college_admin  ⊃  faculty  ⊃  student
 * so a super_admin passes every college guard, a college_admin passes the
 * faculty guard, etc. See docs/MULTI_TENANT_ARCHITECTURE.md for the matrix.
 *
 * `requireAdmin` is RETAINED and now denotes PLATFORM-ADMIN authority
 * (super_admin OR legacy admin) — behaviourally unchanged for existing B2C
 * admin routes, since a legacy `admin` user still passes and migrated
 * super_admins do too.
 */
import {
  AuthErrorCode,
  COLLEGE_ADMIN_ROLES,
  FACULTY_ROLES,
  PLATFORM_ADMIN_ROLES,
  type Role as RoleType,
} from "@codeapt/shared";
import type { RequestHandler } from "express";

import { AppError } from "../errors/app-error.js";

export function requireRole(...roles: RoleType[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) {
      throw new AppError(
        "Authentication required",
        401,
        AuthErrorCode.UNAUTHENTICATED,
      );
    }
    if (!roles.includes(req.auth.role)) {
      throw new AppError(
        "You do not have permission to access this resource",
        403,
        AuthErrorCode.FORBIDDEN,
      );
    }
    next();
  };
}

/** Platform owner (super_admin or legacy admin). Provisions colleges. */
export const requireSuperAdmin = requireRole(...PLATFORM_ADMIN_ROLES);

/** College administrator (or a platform admin, who supersedes them). */
export const requireCollegeAdmin = requireRole(...COLLEGE_ADMIN_ROLES);

/** Faculty (or any higher tier). */
export const requireFaculty = requireRole(...FACULTY_ROLES);

/**
 * Legacy platform-admin guard — retained for the existing B2C admin surface.
 * Maps to PLATFORM-ADMIN authority (super_admin + legacy admin), so every
 * existing admin route keeps working before and after the tenancy backfill.
 */
export const requireAdmin = requireRole(...PLATFORM_ADMIN_ROLES);
