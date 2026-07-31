/**
 * Coding-profile controllers (Prompt 1). Self endpoints run on the plain tenant
 * stack (any tenant member reaches them; the SERVICE enforces college-student
 * authority) + the `coding_profiles` feature. The id is ALWAYS the calling user
 * (`req.auth.userId`) — a student can never read or edit another's handles. The
 * admin "refresh now" takes a student id in the path (college_admin gated).
 */
import {
  AuthErrorCode,
  TenantErrorCode,
  setCodingHandlesSchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import {
  getMyCodingProfile,
  refreshMyCodingProfile,
  refreshStudentCodingProfile,
  setMyCodingHandles,
} from "../services/coding-profile.service.js";

function requireTenant(req: Request) {
  if (!req.auth) {
    throw new AppError("Authentication required", 401, AuthErrorCode.UNAUTHENTICATED);
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

export const getMyCodingProfileController = asyncHandler(
  async (req: Request, res: Response) => {
    const { auth, tenant } = requireTenant(req);
    res
      .status(200)
      .json(
        await getMyCodingProfile(tenant.college.id, auth.userId, {
          role: auth.role,
          userType: auth.userType,
        }),
      );
  },
);

export const setMyCodingHandlesController = asyncHandler(
  async (req: Request, res: Response) => {
    const { auth, tenant } = requireTenant(req);
    const input = setCodingHandlesSchema.parse(req.body);
    res
      .status(200)
      .json(
        await setMyCodingHandles(tenant.college.id, auth.userId, input, {
          role: auth.role,
          userType: auth.userType,
        }),
      );
  },
);

export const refreshMyCodingProfileController = asyncHandler(
  async (req: Request, res: Response) => {
    const { auth, tenant } = requireTenant(req);
    res
      .status(202)
      .json(
        await refreshMyCodingProfile(tenant.college.id, auth.userId, {
          role: auth.role,
          userType: auth.userType,
        }),
      );
  },
);

export const refreshStudentCodingProfileController = asyncHandler(
  async (req: Request, res: Response) => {
    const { tenant } = requireTenant(req);
    const userId = req.params.userId ?? "";
    res
      .status(202)
      .json(await refreshStudentCodingProfile(tenant.college.id, userId));
  },
);
