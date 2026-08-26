/**
 * Speaking (Communication A/B) controllers — tenant-scoped at /c/:slug/speaking.
 * Student consumption (available / start / submit-item / result) and college
 * authoring (list / create / get / update / publish / delete). `tenantId(req)`
 * from the resolved tenant; `userId(req)` from the session. Mirrors the gaming
 * college controller.
 */
import { AuthErrorCode, TenantErrorCode } from "@codeapt/shared";
import {
  bulkRescoreRequestSchema,
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

/** Step 32: record ONE proctoring warning (server-authoritative; the owner's
 *  attempt). Reaching COMMUNICATION_MAX_WARNINGS terminates + commits the score. */
export const recordSpeakingWarningController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await speaking.recordSpeakingWarning(
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

// --- Step 32: Whisper re-score (tier 2) — operator actions ---

/** College faculty: re-score ONE attempt (tenant-safe). */
export const rescoreCollegeSpeakingAttemptController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(202).json(
      await speaking.rescoreCollegeAttempt(
        tenantId(req),
        req.params.assessmentId ?? "",
        req.params.attemptId ?? "",
      ),
    );
  },
);

/** College faculty: re-score every attempt on one assessment (the cohort). */
export const rescoreCollegeSpeakingCohortController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(202)
      .json(
        await speaking.rescoreCollegeAssessment(
          tenantId(req),
          req.params.assessmentId ?? "",
        ),
      );
  },
);

/** Platform admin: re-score ONE attempt by id. */
export const adminRescoreSpeakingAttemptController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(202)
      .json(await speaking.rescoreSpeakingAttempt(req.params.attemptId ?? ""));
  },
);

/** Platform admin: BULK re-score a set of attempt ids ("re-verify the top 200"). */
export const adminBulkRescoreSpeakingController = asyncHandler(
  async (req: Request, res: Response) => {
    const { attemptIds } = bulkRescoreRequestSchema.parse(req.body);
    res.status(202).json(await speaking.bulkRescoreSpeaking(attemptIds));
  },
);

// --- Enrollment-based discovery (global, S29) -------------------------------

/** Course-attached speaking assessments the caller can reach by enrollment (B2C
 *  or college student). No tenant — global GET /speaking. */
export const listSpeakingForUserController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await speaking.listSpeakingForUser(userId(req)));
  },
);

// --- Platform authoring (requireAdmin, college:null, S29) -------------------

export const adminListSpeakingController = asyncHandler(
  async (_req: Request, res: Response) => {
    res.status(200).json(await speaking.listPlatformSpeaking());
  },
);

export const adminListSpeakingTopicsController = asyncHandler(
  async (_req: Request, res: Response) => {
    res.status(200).json(await speaking.listSpeakingTopics());
  },
);

/** Platform authoring-time TTS (college:null): render prompt TEXT to a hosted,
 *  fixed-voice clip. The scope is a folder segment only ("platform"). */
export const adminSpeakingTtsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { text } = speakingTtsRequestSchema.parse(req.body);
    res
      .status(200)
      .json(await speaking.generateSpeakingPromptAudio("platform", text));
  },
);

export const adminCreateSpeakingController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = speakingAssessmentUpsertSchema.parse(req.body);
    res.status(201).json(await speaking.createPlatformSpeaking(input));
  },
);

export const adminGetSpeakingController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(await speaking.getPlatformSpeaking(req.params.assessmentId ?? ""));
  },
);

export const adminUpdateSpeakingController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = speakingAssessmentUpsertSchema.parse(req.body);
    res
      .status(200)
      .json(
        await speaking.updatePlatformSpeaking(
          req.params.assessmentId ?? "",
          input,
        ),
      );
  },
);

export const adminSetSpeakingPublishController = asyncHandler(
  async (req: Request, res: Response) => {
    const { isPublished } = setSpeakingPublishSchema.parse(req.body);
    res
      .status(200)
      .json(
        await speaking.setPlatformSpeakingPublished(
          req.params.assessmentId ?? "",
          isPublished,
        ),
      );
  },
);

export const adminDeleteSpeakingController = asyncHandler(
  async (req: Request, res: Response) => {
    await speaking.deletePlatformSpeaking(req.params.assessmentId ?? "");
    res.status(204).send();
  },
);
