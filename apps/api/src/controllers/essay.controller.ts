/**
 * Essay controllers — thin: validate with shared zod schemas, resolve the
 * caller, delegate to the service, shape the response.
 */
import {
  AuthErrorCode,
  essayAnalyticsRequestSchema,
  saveEssayDraftRequestSchema,
  submitEssayRequestSchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import * as essays from "../services/essay.service.js";

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

export const listEssaysController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await essays.listEssays(requireUserId(req));
    res.status(200).json(data);
  },
);

export const getEssayController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await essays.getEssayDetail(
      requireUserId(req),
      req.params.id ?? "",
    );
    res.status(200).json(data);
  },
);

export const submitEssayController = asyncHandler(
  async (req: Request, res: Response) => {
    const { content, integrity } = submitEssayRequestSchema.parse(req.body);
    const ref = await essays.submitEssay(
      requireUserId(req),
      req.params.id ?? "",
      content,
      { ipAddress: req.ip, userAgent: req.get("user-agent") ?? "", integrity },
    );
    res.status(202).json(ref);
  },
);

/** Latest recoverable draft for a prompt (200 with { draft: … | null }). */
export const getDraftController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await essays.getLatestDraft(
      requireUserId(req),
      req.params.id ?? "",
    );
    res.status(200).json(data);
  },
);

/** Autosave a draft snapshot (never submits/grades/consumes an attempt). */
export const saveDraftController = asyncHandler(
  async (req: Request, res: Response) => {
    const { content } = saveEssayDraftRequestSchema.parse(req.body);
    const data = await essays.saveDraft(
      requireUserId(req),
      req.params.id ?? "",
      content,
    );
    res.status(200).json(data);
  },
);

export const getSubmissionController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await essays.getGradingResult(
      requireUserId(req),
      req.params.jobId ?? "",
    );
    res.status(200).json(data);
  },
);

export const listSubmissionsController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await essays.listSubmissions(
      requireUserId(req),
      req.params.id ?? "",
    );
    res.status(200).json(data);
  },
);

/** On-demand AI Scoring & Feedback for the caller's own submission. */
export const aiFeedbackController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await essays.generateAiFeedbackForOwner(
      requireUserId(req),
      req.params.jobId ?? "",
    );
    res.status(200).json(data);
  },
);

/**
 * Optional, additive writing analytics — persists compose signals and returns
 * 204. Never affects grading (see essay.service.recordAnalytics).
 */
export const recordAnalyticsController = asyncHandler(
  async (req: Request, res: Response) => {
    const body = essayAnalyticsRequestSchema.parse(req.body);
    await essays.recordAnalytics(
      requireUserId(req),
      req.params.jobId ?? "",
      body,
    );
    res.status(204).end();
  },
);
