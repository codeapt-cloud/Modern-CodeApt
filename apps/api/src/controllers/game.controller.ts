/**
 * Gaming controllers — play lifecycle (owner session OR attempt token) and the
 * platform-admin authoring surface. Mirrors exam.controller: parse with a shared
 * zod schema, delegate to the service (namespace import), return status/json.
 */
import { AuthErrorCode } from "@codeapt/shared";
import {
  aiBuildGameSetRequestSchema,
  answerGameItemRequestSchema,
  explainGameItemRequestSchema,
  gameSetUpdateSchema,
  gameSetUpsertSchema,
  probeGameItemRequestSchema,
  setGameSetPublishSchema,
  startGameSetRequestSchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import { buildAiGameSetDraft } from "../services/game-ai.service.js";
import { listGamesForUser } from "../services/game-list.service.js";
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

/** Course-attached game sets reachable by the caller's enrollments (mirrors the
 * `GET /exams` learn-player surface — items carry `topicId`). */
export const listMyGamesController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await listGamesForUser(requireUserId(req)));
  },
);

export const startGameSetController = asyncHandler(
  async (req: Request, res: Response) => {
    const { serve } = startGameSetRequestSchema.parse(req.body ?? {});
    const data = await engine.startGameSetAttempt(
      requireUserId(req),
      req.params.gameSetId ?? "",
      serve,
    );
    // 201 when a NEW attempt was created; 200 when an existing in-progress
    // attempt was RESUMED (nothing created — a refresh/remount).
    res.status(data.resumed ? 200 : 201).json(data);
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

export const probeGameItemController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = probeGameItemRequestSchema.parse(req.body ?? {});
    const data = await engine.probeGameItem(
      req.params.attemptId ?? "",
      caller(req),
      input,
    );
    res.status(200).json(data);
  },
);

export const beginGameController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await engine.beginGame(req.params.attemptId ?? "", caller(req));
    res.status(200).json(data);
  },
);

export const currentGameController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await engine.getCurrentGame(
      req.params.attemptId ?? "",
      caller(req),
    );
    res.status(200).json(data);
  },
);

export const recordGameWarningController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await engine.recordGameWarning(
      req.params.attemptId ?? "",
      caller(req),
    );
    res.status(200).json(data);
  },
);

export const advanceGameController = asyncHandler(
  async (req: Request, res: Response) => {
    const { serve } = startGameSetRequestSchema.parse(req.body ?? {});
    const data = await engine.advanceGame(
      req.params.attemptId ?? "",
      caller(req),
      serve,
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

/** G3 — read a finished attempt's result (composite + per-game breakdown). Owner
 *  session OR attempt token, exactly like the rest of the engine. */
export const gameSetResultController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await engine.getGameSetAttemptResult(
      req.params.attemptId ?? "",
      caller(req),
    );
    res.status(200).json(data);
  },
);

/** G3 — the caller's OWN attempt history on a set (date, composite, status). */
export const listMyGameSetAttemptsController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await engine.listMyGameSetAttempts(
      requireUserId(req),
      req.params.gameSetId ?? "",
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

export const adminDeleteGameSetController = asyncHandler(
  async (req: Request, res: Response) => {
    await adminSets.deleteGameSet(req.params.gameSetId ?? "");
    res.status(204).end();
  },
);

/** Platform AI set-builder — not credit-metered (platform admins bypass). */
export const adminAiBuildGameSetController = asyncHandler(
  async (req: Request, res: Response) => {
    const { brief } = aiBuildGameSetRequestSchema.parse(req.body);
    res.status(200).json(await buildAiGameSetDraft(brief));
  },
);
