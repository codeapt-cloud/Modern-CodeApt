/**
 * Coding leaderboard controllers (Prompt 2). Read-only over the stored stats;
 * college_admin primary, faculty within their scope (the service enforces the
 * scope). Two endpoints: the JSON leaderboard and its .xlsx export, both honoring
 * the same query filters (platform, metric, unitId?, groupId?).
 */
import {
  AuthErrorCode,
  TenantErrorCode,
  codingLeaderboardQuerySchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import { buildCodingLeaderboardWorkbook } from "../lib/coding-leaderboard-report.js";
import { sendXlsxAttachment } from "../lib/http-download.js";
import { getCodingLeaderboard, type LeaderboardActor } from "../services/coding-leaderboard.service.js";

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

function actor(req: Request): LeaderboardActor {
  if (!req.auth) {
    throw new AppError("Authentication required", 401, AuthErrorCode.UNAUTHENTICATED);
  }
  return { userId: req.auth.userId, role: req.auth.role };
}

export const codingLeaderboardController = asyncHandler(
  async (req: Request, res: Response) => {
    const query = codingLeaderboardQuerySchema.parse(req.query);
    res.status(200).json(await getCodingLeaderboard(tenantId(req), actor(req), query));
  },
);

export const codingLeaderboardReportController = asyncHandler(
  async (req: Request, res: Response) => {
    const query = codingLeaderboardQuerySchema.parse(req.query);
    const data = await getCodingLeaderboard(tenantId(req), actor(req), query);
    const buffer = await buildCodingLeaderboardWorkbook(data);
    sendXlsxAttachment(res, buffer, `coding-leaderboard-${query.platform}-${query.metric}.xlsx`);
  },
);
