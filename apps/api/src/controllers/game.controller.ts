/**
 * Gaming controllers — play lifecycle (owner session OR attempt token) and the
 * platform-admin authoring surface. Mirrors exam.controller: parse with a shared
 * zod schema, delegate to the service (namespace import), return status/json.
 */
import { AuthErrorCode } from "@codeapt/shared";
import {
  answerGameItemRequestSchema,
  explainGameItemRequestSchema,
  gameSetUpdateSchema,
  gameSetUpsertSchema,
  setGameSetPublishSchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import * as adminSets from "../services/game-set-admin.service.js";
import * as engine from "../services/game.service.js";

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

/** Caller identity for the engine: session user and/or attempt token. */
function caller(req: Request): { userId?: string; token?: string } {
  const token = req.header("x-attempt-token") ?? undefined;
  return { userId: req.auth?.userId, token };
}

// --- Play ---

export const startGameSetController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await engine.startGameSetAttempt(
      requireUserId(req),
      req.params.gameSetId ?? "",
    );
    res.status(201).json(data);
  },
);

export const answerGameItemController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = answerGameItemRequestSchema.parse(req.body ?? {});
    const data = await engine.answerGameItem(
      req.params.attemptId ?? "",
      caller(req),
      input,
    );
    res.status(200).json(data);
  },
);

export const advanceGameController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await engine.advanceGame(
      req.params.attemptId ?? "",
      caller(req),
    );
    res.status(200).json(data);
  },
);

export const finishGameSetController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await engine.finishGameSet(
      req.params.attemptId ?? "",
      caller(req),
    );
    res.status(200).json(data);
  },
);

export const explainGameItemController = asyncHandler(
  async (req: Request, res: Response) => {
    const { itemIndex } = explainGameItemRequestSchema.parse(req.body ?? {});
    const data = await engine.explainGameItem(
      req.params.attemptId ?? "",
      caller(req),
      itemIndex,
    );
    res.status(200).json(data);
  },
);

// --- Platform-admin authoring ---

export const adminListGameSetsController = asyncHandler(
  async (_req: Request, res: Response) => {
    res.status(200).json(await adminSets.listGameSets());
  },
);

export const adminCreateGameSetController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = gameSetUpsertSchema.parse(req.body);
    res.status(201).json(await adminSets.createGameSet(input));
  },
);

export const adminGetGameSetController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await adminSets.getGameSet(req.params.gameSetId ?? ""));
  },
);

export const adminUpdateGameSetController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = gameSetUpdateSchema.parse(req.body);
    res
      .status(200)
      .json(await adminSets.updateGameSet(req.params.gameSetId ?? "", input));
  },
);

export const adminPublishGameSetController = asyncHandler(
  async (req: Request, res: Response) => {
    const { isPublished } = setGameSetPublishSchema.parse(req.body);
    res
      .status(200)
      .json(
        await adminSets.setGameSetPublished(
          req.params.gameSetId ?? "",
          isPublished,
        ),
      );
  },
);
