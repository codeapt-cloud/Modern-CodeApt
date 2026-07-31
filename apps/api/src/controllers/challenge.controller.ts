/**
 * Daily-challenge controllers — thin: validate with shared zod schemas, resolve
 * the caller, delegate to the service, shape the response.
 */
import {
  AuthErrorCode,
  leaderboardQuerySchema,
  submitCodeRequestSchema,
  submitMcqRequestSchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import * as challenges from "../services/challenge.service.js";

function requireUserId(req: Request): string {
  if (!req.auth) {
    throw new AppError(
      "Authentication required",
      401,
      AuthErrorCode.UNAUTHENTICATED,
    );
  }
  return req.auth.userId;
}

export const getTodayController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await challenges.getToday(requireUserId(req));
    res.status(200).json(data);
  },
);

export const submitMcqController = asyncHandler(
  async (req: Request, res: Response) => {
    const { option } = submitMcqRequestSchema.parse(req.body);
    const data = await challenges.submitMcq(requireUserId(req), option);
    res.status(200).json(data);
  },
);

export const submitCodeController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = submitCodeRequestSchema.parse(req.body);
    const ref = await challenges.submitCode(requireUserId(req), input);
    res.status(202).json(ref);
  },
);

export const finalizeCodeController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await challenges.finalizeCode(
      requireUserId(req),
      req.params.jobId ?? "",
    );
    res.status(200).json(data);
  },
);

export const getLeaderboardController = asyncHandler(
  async (req: Request, res: Response) => {
    const query = leaderboardQuerySchema.parse(req.query);
    const data = await challenges.getLeaderboard(requireUserId(req), query);
    res.status(200).json(data);
  },
);
