/**
 * College GameSet authoring controllers — tenant-scoped (resolveTenant + faculty
 * guard + GAMING feature at the routes). Mirrors college-exam-admin.controller:
 * `tenantId(req)` from the resolved tenant, `actor(req)` from the session.
 */
import { AuthErrorCode, TenantErrorCode } from "@codeapt/shared";
import {
  aiBuildGameSetRequestSchema,
  cloneGameSetRequestSchema,
  gameSetUpdateSchema,
  gameSetUpsertSchema,
  setGameSetPublishSchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import * as gameSets from "../services/college-game.service.js";
import type { GameActor } from "../services/college-game.service.js";
import { buildAiGameSetDraft } from "../services/game-ai.service.js";
import { listGameSetTemplates } from "../services/game-set-admin.service.js";

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

function actor(req: Request): GameActor {
  if (!req.auth) {
    throw new AppError(
      "Authentication required",
      401,
      AuthErrorCode.UNAUTHENTICATED,
    );
  }
  return { userId: req.auth.userId, role: req.auth.role };
}

export const listCollegeGameSetsController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(await gameSets.listCollegeGameSets(tenantId(req), actor(req)));
  },
);

export const createCollegeGameSetController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = gameSetUpsertSchema.parse(req.body);
    res
      .status(201)
      .json(
        await gameSets.createCollegeGameSet(tenantId(req), actor(req), input),
      );
  },
);

export const getCollegeGameSetController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await gameSets.getCollegeGameSet(
          tenantId(req),
          actor(req),
          req.params.gameSetId ?? "",
        ),
      );
  },
);

export const updateCollegeGameSetController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = gameSetUpdateSchema.parse(req.body);
    res
      .status(200)
      .json(
        await gameSets.updateCollegeGameSet(
          tenantId(req),
          actor(req),
          req.params.gameSetId ?? "",
          input,
        ),
      );
  },
);

export const setCollegeGameSetPublishController = asyncHandler(
  async (req: Request, res: Response) => {
    const { isPublished } = setGameSetPublishSchema.parse(req.body);
    res
      .status(200)
      .json(
        await gameSets.setCollegeGameSetPublished(
          tenantId(req),
          actor(req),
          req.params.gameSetId ?? "",
          isPublished,
        ),
      );
  },
);

/** Published platform sets this college may clone as a starting template. */
export const listGameSetTemplatesController = asyncHandler(
  async (_req: Request, res: Response) => {
    res.status(200).json(await listGameSetTemplates());
  },
);

/** Clone a PLATFORM set into this college (authoring — GAMING gated at route). */
export const cloneCollegeGameSetController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = cloneGameSetRequestSchema.parse(req.body);
    res
      .status(201)
      .json(
        await gameSets.cloneGameSetIntoCollege(
          tenantId(req),
          actor(req),
          req.params.sourceId ?? "",
          input,
        ),
      );
  },
);

export const deleteCollegeGameSetController = asyncHandler(
  async (req: Request, res: Response) => {
    await gameSets.deleteCollegeGameSet(
      tenantId(req),
      actor(req),
      req.params.gameSetId ?? "",
    );
    res.status(204).end();
  },
);

/** College AI set-builder — credit-metered by collegeId; GAMING.ai_build gated
 * at the route. Returns a reviewable draft ({configured, draft}). */
export const aiBuildCollegeGameSetController = asyncHandler(
  async (req: Request, res: Response) => {
    const { brief } = aiBuildGameSetRequestSchema.parse(req.body);
    res
      .status(200)
      .json(await buildAiGameSetDraft(brief, { collegeId: tenantId(req) }));
  },
);

/** Student-facing: the published, in-target tenant sets they can play. */
export const listAvailableCollegeGameSetsController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await gameSets.listPlayableCollegeGameSets(
          tenantId(req),
          actor(req).userId,
        ),
      );
  },
);
