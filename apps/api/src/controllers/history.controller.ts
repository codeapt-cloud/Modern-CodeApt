/**
 * Unified student attempt-history reads. Two thin controllers over one service:
 * `getMyHistoryController` serves the B2C/global surface (attempts with no
 * college), `getCollegeHistoryController` the tenant surface (attempts stamped
 * with the resolved college). `userId(req)` from the session; `tenantId(req)`
 * from the resolved tenant. Read-only.
 */
import { AuthErrorCode, TenantErrorCode } from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import { getStudentHistory } from "../services/history.service.js";

function userId(req: Request): string {
  if (!req.auth) {
    throw new AppError("Authentication required", 401, AuthErrorCode.UNAUTHENTICATED);
  }
  return req.auth.userId;
}

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

export const getMyHistoryController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await getStudentHistory(userId(req), null));
  },
);

export const getCollegeHistoryController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await getStudentHistory(userId(req), tenantId(req)));
  },
);
