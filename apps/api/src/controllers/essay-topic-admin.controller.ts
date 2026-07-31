/**
 * Essay-topic (prompt) ADMIN controllers (requireAdmin at the route). Validate
 * with the shared zod schema and delegate to the essay-topic-admin service.
 */
import {
  adminEssayTopicUpsertSchema,
  generateKeywordsRequestSchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";
import { z } from "zod";

import { asyncHandler } from "../lib/async-handler.js";
import * as admin from "../services/essay-topic-admin.service.js";

const activeSchema = z.object({ isActive: z.boolean() });

export const adminListEssayTopicsController = asyncHandler(
  async (_req: Request, res: Response) => {
    res.status(200).json(await admin.listEssayTopicsAdmin());
  },
);

export const adminGetEssayTopicController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(await admin.getEssayTopicAdmin(req.params.essayTopicId ?? ""));
  },
);

export const adminCreateEssayTopicController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminEssayTopicUpsertSchema.parse(req.body);
    res.status(201).json(await admin.createEssayTopic(input));
  },
);

export const adminUpdateEssayTopicController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminEssayTopicUpsertSchema.parse(req.body);
    res
      .status(200)
      .json(await admin.updateEssayTopic(req.params.essayTopicId ?? "", input));
  },
);

export const adminSetEssayTopicActiveController = asyncHandler(
  async (req: Request, res: Response) => {
    const { isActive } = activeSchema.parse(req.body);
    res
      .status(200)
      .json(
        await admin.setEssayTopicActive(req.params.essayTopicId ?? "", isActive),
      );
  },
);

/**
 * Propose semantic keywords for a topic (LLM-assisted, deterministic fallback).
 * Bodied (title/description/instructions) so it works for unsaved topics too.
 * Advisory — returns a proposal; the admin edits + saves via the update path.
 */
export const adminGenerateKeywordsController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = generateKeywordsRequestSchema.parse(req.body);
    res.status(200).json(await admin.generateKeywords(input));
  },
);

export const adminDeleteEssayTopicController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(await admin.deleteEssayTopic(req.params.essayTopicId ?? ""));
  },
);
