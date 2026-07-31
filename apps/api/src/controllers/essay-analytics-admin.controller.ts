/**
 * Essay-analytics ADMIN controllers (requireAdmin at the route). Read-only:
 * validate the list query with the shared zod schema and delegate to the
 * essay-analytics-admin service.
 */
import { adminEssayAnalyticsListQuerySchema } from "@codeapt/shared";
import type { Request, Response } from "express";

import { asyncHandler } from "../lib/async-handler.js";
import * as admin from "../services/essay-analytics-admin.service.js";

export const adminListEssayAnalyticsController = asyncHandler(
  async (req: Request, res: Response) => {
    const query = adminEssayAnalyticsListQuerySchema.parse(req.query);
    res.status(200).json(await admin.listEssayAnalyticsAdmin(query));
  },
);

export const adminGetEssayAttemptAnalyticsController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await admin.getEssayAttemptAnalyticsAdmin(req.params.attemptId ?? ""),
      );
  },
);
