/**
 * College question-bank controllers (faculty / college_admin). Thin: validate
 * with shared zod schemas, delegate to the bank service with the resolved tenant
 * (college id + entitlements). Browse is scope- + grant-aware (the college's own
 * Self Bank always; the global banks only if granted); pull copies bank
 * questions into a college exam. The college id + entitlements come from the
 * validated `req.tenant` (guaranteed by the route's requireAuth → resolveTenant).
 */
import {
  AuthErrorCode,
  TenantErrorCode,
  aiGenerateExamRequestSchema,
  aiGenerateQuestionsRequestSchema,
  bankBrowseQuerySchema,
  bankPullIntoExamRequestSchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import * as bank from "../services/question-bank.service.js";

function tenant(req: Request) {
  if (!req.auth) {
    throw new AppError(
      "Authentication required",
      401,
      AuthErrorCode.UNAUTHENTICATED,
    );
  }
  if (!req.tenant) {
    throw new AppError(
      "A college (tenant) context is required",
      500,
      TenantErrorCode.TENANT_CONTEXT_REQUIRED,
    );
  }
  return req.tenant;
}

export const browseCollegeBankController = asyncHandler(
  async (req: Request, res: Response) => {
    const t = tenant(req);
    const query = bankBrowseQuerySchema.parse(req.query);
    res
      .status(200)
      .json(await bank.browseCollegeBank(t.college.id, t.entitlements, query));
  },
);

export const pullIntoExamController = asyncHandler(
  async (req: Request, res: Response) => {
    const t = tenant(req);
    const input = bankPullIntoExamRequestSchema.parse(req.body);
    res
      .status(200)
      .json(await bank.pullIntoExam(t.college.id, t.entitlements, input));
  },
);

export const aiGenerateQuestionsController = asyncHandler(
  async (req: Request, res: Response) => {
    const t = tenant(req);
    const input = aiGenerateQuestionsRequestSchema.parse(req.body);
    res
      .status(200)
      .json(
        await bank.generateQuestionsIntoExam(
          t.college.id,
          t.entitlements,
          input,
        ),
      );
  },
);

export const aiGenerateExamController = asyncHandler(
  async (req: Request, res: Response) => {
    const t = tenant(req);
    const input = aiGenerateExamRequestSchema.parse(req.body);
    res
      .status(200)
      .json(await bank.generateFullExam(t.college.id, t.entitlements, input));
  },
);
