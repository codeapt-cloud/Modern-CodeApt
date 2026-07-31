/**
 * Super-admin LLM-gateway controllers. Thin: validate with shared zod schemas,
 * delegate to the ai-provider-admin service. Keys are only WRITTEN (encrypted)
 * or PROBED — never returned; the list/patch responses carry `keySet` only.
 */
import {
  aiProviderPatchSchema,
  setAiGovernorConfigSchema,
  setProviderKeyRequestSchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { asyncHandler } from "../lib/async-handler.js";
import * as providers from "../services/ai-provider-admin.service.js";
import * as governor from "../services/ai-governor.service.js";

export const listAiProvidersController = asyncHandler(
  async (_req: Request, res: Response) => {
    res.status(200).json(await providers.listProviders(Date.now()));
  },
);

export const patchAiProviderController = asyncHandler(
  async (req: Request, res: Response) => {
    const patch = aiProviderPatchSchema.parse(req.body);
    res
      .status(200)
      .json(await providers.patchProvider(req.params.id ?? "", patch, Date.now()));
  },
);

export const setAiProviderKeyController = asyncHandler(
  async (req: Request, res: Response) => {
    const { key } = setProviderKeyRequestSchema.parse(req.body);
    res.status(200).json(await providers.setProviderKey(req.params.id ?? "", key));
  },
);

export const deleteAiProviderKeyController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await providers.deleteProviderKey(req.params.id ?? ""));
  },
);

export const testAiProviderKeyController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await providers.testProviderKey(req.params.id ?? ""));
  },
);

export const aiProviderUsageTrendsController = asyncHandler(
  async (req: Request, res: Response) => {
    const days = Number(req.query.days);
    res
      .status(200)
      .json(
        await providers.getUsageTrends(
          Number.isFinite(days) && days > 0 ? days : 14,
          Date.now(),
        ),
      );
  },
);

// --- Stage-2 governor (global free-tier pool) -------------------------------

export const getAiGovernorController = asyncHandler(
  async (_req: Request, res: Response) => {
    res.status(200).json(await governor.getGovernorView(Date.now()));
  },
);

export const setAiGovernorController = asyncHandler(
  async (req: Request, res: Response) => {
    const patch = setAiGovernorConfigSchema.parse(req.body);
    await governor.setGovernorConfig(patch);
    res.status(200).json(await governor.getGovernorView(Date.now()));
  },
);
