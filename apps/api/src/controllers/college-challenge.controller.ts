/**
 * College challenge controllers (Phase 4d) — thin: validate the leaderboard
 * query with the shared zod schema, resolve the college from `req.tenant`, and
 * delegate to the tenant-scoped college-challenge service. Behind the tenant
 * stack + requireFeature('challenges') + requireFaculty (an operator insight).
 */
import { TenantErrorCode, leaderboardQuerySchema } from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import * as challenges from "../services/college-challenge.service.js";

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

export const collegeChallengeLeaderboardController = asyncHandler(
  async (req: Request, res: Response) => {
    const query = leaderboardQuerySchema.parse(req.query);
    res
      .status(200)
      .json(await challenges.collegeChallengeLeaderboard(tenantId(req), query));
  },
);
