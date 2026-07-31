/**
 * Daily-challenge ADMIN controllers (requireAdmin at the route). Validate with
 * the shared zod schemas and delegate to the challenge-admin service.
 */
import {
  adminChallengeBulkImportRequestSchema,
  adminChallengeUpsertSchema,
  aiBuildChallengeRequestSchema,
  regenerateDailyChallengeRequestSchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { asyncHandler } from "../lib/async-handler.js";
import { buildChallengeTemplateWorkbook } from "../lib/challenge-excel.js";
import { enqueueDailyChallengeJob } from "../lib/execution-queue.js";
import { sendXlsxAttachment } from "../lib/http-download.js";
import { buildAiChallengeDraft } from "../services/challenge-ai.service.js";
import * as admin from "../services/challenge-admin.service.js";

export const adminListChallengesController = asyncHandler(
  async (_req: Request, res: Response) => {
    res.status(200).json(await admin.listChallengesAdmin());
  },
);

export const adminGetChallengeController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(await admin.getChallengeAdmin(req.params.questionId ?? ""));
  },
);

export const adminCreateChallengeController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminChallengeUpsertSchema.parse(req.body);
    res.status(201).json(await admin.createChallenge(input));
  },
);

export const adminUpdateChallengeController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminChallengeUpsertSchema.parse(req.body);
    res
      .status(200)
      .json(await admin.updateChallenge(req.params.questionId ?? "", input));
  },
);

export const adminDeleteChallengeController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(await admin.deleteChallenge(req.params.questionId ?? ""));
  },
);

export const adminBulkImportChallengesController = asyncHandler(
  async (req: Request, res: Response) => {
    const { fileBase64, startDate } =
      adminChallengeBulkImportRequestSchema.parse(req.body);
    res.status(200).json(await admin.bulkImportChallenges(fileBase64, startDate));
  },
);

/**
 * Re-run the automatic generation pipeline for a day (optional oversight — the
 * system is automatic without it). Enqueues a worker job (which owns the LLM +
 * Piston) and returns 202; `force` (default true) replaces any existing
 * challenge for that day. The worker validates-by-execution and falls back to
 * the bank/curated pool exactly as the scheduled run does.
 */
export const adminRegenerateChallengeController = asyncHandler(
  async (req: Request, res: Response) => {
    const { releaseDate, force } =
      regenerateDailyChallengeRequestSchema.parse(req.body);
    await enqueueDailyChallengeJob({ dayKey: releaseDate, force });
    res.status(202).json({ queued: true, releaseDate });
  },
);

/**
 * "Build with AI" — draft a CODE challenge to pre-fill the editor (the admin
 * reviews + saves). Synchronous LLM call; NOT execution-validated here (the
 * admin verifies). Graceful when no provider is configured.
 */
export const adminAiBuildChallengeController = asyncHandler(
  async (req: Request, res: Response) => {
    const { topic, questionType } = aiBuildChallengeRequestSchema.parse(
      req.body ?? {},
    );
    res.status(200).json(await buildAiChallengeDraft(topic, questionType));
  },
);

/** Download the ready-to-fill daily-challenge .xlsx template (static). */
export const adminBulkImportTemplateController = asyncHandler(
  async (_req: Request, res: Response) => {
    const buffer = await buildChallengeTemplateWorkbook();
    sendXlsxAttachment(res, buffer, "daily-challenges-template.xlsx");
  },
);
