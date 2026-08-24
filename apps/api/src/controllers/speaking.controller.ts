/**
 * Speaking (Communication A/B) controllers — tenant-scoped at /c/:slug/speaking.
 * Student consumption (available / start / submit-item / result) and college
 * authoring (list / create / get / update / publish / delete). `tenantId(req)`
 * from the resolved tenant; `userId(req)` from the session. Mirrors the gaming
 * college controller.
 */
import { AuthErrorCode, TenantErrorCode } from "@codeapt/shared";
import {
  setSpeakingPublishSchema,
  speakingAssessmentUpsertSchema,
  speakingTtsRequestSchema,
  submitSpeakingItemRequestSchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";
import { z } from "zod";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import * as speaking from "../services/speaking.service.js";

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

function userId(req: Request): string {
  if (!req.auth) {
    throw new AppError(
      "Authentication required",
      401,
      AuthErrorCode.UNAUTHENTICATED,
    );
  }
  return req.auth.userId;
}

// --- Student consumption ----------------------------------------------------

export const listAvailableSpeakingController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(await speaking.listAvailableForCollege(userId(req), tenantId(req)));
  },
);

export const startSpeakingController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await speaking.startSpeakingAttempt(
      userId(req),
      req.params.assessmentId ?? "",
    );
    res.status(201).json(data);
  },
);

const submitItemParams = z.object({ itemIndex: z.coerce.number().int().min(0) });

export const submitSpeakingItemController = asyncHandler(
  async (req: Request, res: Response) => {
    const { itemIndex } = submitItemParams.parse(req.params);
    const body = submitSpeakingItemRequestSchema.parse(req.body);
    const data = await speaking.submitSpeakingItem(
      userId(req),
      req.params.attemptId ?? "",
      itemIndex,
      body,
    );
    res.status(202).json(data);
  },
);

export const speakingCurrentController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await speaking.getCurrentSpeakingItem(
          userId(req),
          req.params.attemptId ?? "",
        ),
      );
  },
);

/** C5: the student's current in-progress attempt on an assessment (or null), so
 *  a deep link can RESUME rather than start a second one. Read-only. */
export const speakingInProgressAttemptController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await speaking.getInProgressSpeakingAttempt(
          userId(req),
          req.params.assessmentId ?? "",
        ),
      );
  },
);

export const speakingResultController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await speaking.getSpeakingAttemptResult(
          userId(req),
          req.params.attemptId ?? "",
        ),
      );
  },
);

// --- College authoring ------------------------------------------------------

export const listCollegeSpeakingController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await speaking.listCollegeSpeaking(tenantId(req)));
  },
);

export const createCollegeSpeakingController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = speakingAssessmentUpsertSchema.parse(req.body);
    res
      .status(201)
      .json(await speaking.createCollegeSpeaking(tenantId(req), input));
  },
);

export const speakingTtsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { text } = speakingTtsRequestSchema.parse(req.body);
    res
      .status(200)
      .json(await speaking.generateSpeakingPromptAudio(tenantId(req), text));
  },
);

export const getCollegeSpeakingController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await speaking.getCollegeSpeaking(
          tenantId(req),
          req.params.assessmentId ?? "",
        ),
      );
  },
);

export const updateCollegeSpeakingController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = speakingAssessmentUpsertSchema.parse(req.body);
    res
      .status(200)
      .json(
        await speaking.updateCollegeSpeaking(
          tenantId(req),
          req.params.assessmentId ?? "",
          input,
        ),
      );
  },
);

export const setCollegeSpeakingPublishController = asyncHandler(
  async (req: Request, res: Response) => {
    const { isPublished } = setSpeakingPublishSchema.parse(req.body);
    res
      .status(200)
      .json(
        await speaking.setCollegeSpeakingPublished(
          tenantId(req),
          req.params.assessmentId ?? "",
          isPublished,
        ),
      );
  },
);

export const deleteCollegeSpeakingController = asyncHandler(
  async (req: Request, res: Response) => {
    await speaking.deleteCollegeSpeaking(
      tenantId(req),
      req.params.assessmentId ?? "",
    );
    res.status(204).send();
  },
);

// --- Operator attempt management --------------------------------------------

export const listSpeakingAttemptsController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await speaking.listSpeakingAttempts(
          tenantId(req),
          req.params.assessmentId ?? "",
        ),
      );
  },
);

export const clearSpeakingAttemptController = asyncHandler(
  async (req: Request, res: Response) => {
    await speaking.clearSpeakingAttempt(
      tenantId(req),
      req.params.assessmentId ?? "",
      req.params.attemptId ?? "",
    );
    res.status(204).send();
  },
);
