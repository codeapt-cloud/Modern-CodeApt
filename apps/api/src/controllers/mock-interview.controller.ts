/**
 * AI Mock Interview controllers (Step 33). Thin wiring over the service; the same
 * `tenantId(req)`/`userId(req)` helpers as speaking. Consumption controllers are
 * SHARED by the tenant and open routers (tenant resolution differs only by
 * middleware); authoring is split college vs platform-admin.
 */
import {
  AuthErrorCode,
  TenantErrorCode,
  mockInterviewUpsertSchema,
  setMockInterviewPublishSchema,
  startMockInterviewRequestSchema,
  submitInterviewAnswerRequestSchema,
  interviewTtsRequestSchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";
import { z } from "zod";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import { buildMockInterviewCohortWorkbook } from "../lib/mock-interview-cohort-excel.js";
import * as interview from "../services/mock-interview.service.js";

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
    throw new AppError("Authentication required", 401, AuthErrorCode.UNAUTHENTICATED);
  }
  return req.auth.userId;
}

const turnParams = z.object({ turnIndex: z.coerce.number().int().min(0) });

// --- Consumption (shared tenant + open) ------------------------------------
export const startInterviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const body = startMockInterviewRequestSchema.parse(req.body);
    res
      .status(201)
      .json(
        await interview.startInterview(
          userId(req),
          req.params.assessmentId ?? "",
          body,
        ),
      );
  },
);
export const interviewCurrentController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await interview.getCurrentInterviewTurn(userId(req), req.params.attemptId ?? ""),
      );
  },
);
export const submitInterviewAnswerController = asyncHandler(
  async (req: Request, res: Response) => {
    const { turnIndex } = turnParams.parse(req.params);
    const body = submitInterviewAnswerRequestSchema.parse(req.body);
    res
      .status(202)
      .json(
        await interview.submitInterviewAnswer(
          userId(req),
          req.params.attemptId ?? "",
          turnIndex,
          body,
        ),
      );
  },
);
export const interviewResultController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(await interview.getInterviewResult(userId(req), req.params.attemptId ?? ""));
  },
);
export const interviewInProgressController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await interview.getInProgressInterview(userId(req), req.params.assessmentId ?? ""),
      );
  },
);
export const recordInterviewWarningController = asyncHandler(
  async (req: Request, res: Response) => {
    const reason =
      typeof (req.body as { reason?: unknown } | undefined)?.reason === "string"
        ? (req.body as { reason: string }).reason
        : undefined;
    res
      .status(200)
      .json(
        await interview.recordInterviewWarning(
          userId(req),
          req.params.attemptId ?? "",
          reason,
        ),
      );
  },
);
export const listAvailableInterviewsController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(await interview.listAvailableForCollege(userId(req), tenantId(req)));
  },
);
export const listInterviewsForUserController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await interview.listInterviewsForUser(userId(req)));
  },
);

// --- College authoring -----------------------------------------------------
export const listCollegeInterviewsController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await interview.listCollegeInterviews(tenantId(req)));
  },
);
/** College-admin/faculty readout of the interview credit quota (Step 38). */
export const interviewCreditsController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await interview.interviewCreditsStatus(tenantId(req)));
  },
);
export const createCollegeInterviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = mockInterviewUpsertSchema.parse(req.body);
    res.status(201).json(await interview.createCollegeInterview(tenantId(req), input));
  },
);
export const getCollegeInterviewController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(await interview.getCollegeInterview(tenantId(req), req.params.assessmentId ?? ""));
  },
);
export const updateCollegeInterviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = mockInterviewUpsertSchema.parse(req.body);
    res
      .status(200)
      .json(
        await interview.updateCollegeInterview(
          tenantId(req),
          req.params.assessmentId ?? "",
          input,
        ),
      );
  },
);
export const setCollegeInterviewPublishController = asyncHandler(
  async (req: Request, res: Response) => {
    const { isPublished } = setMockInterviewPublishSchema.parse(req.body);
    res
      .status(200)
      .json(
        await interview.setCollegeInterviewPublished(
          tenantId(req),
          req.params.assessmentId ?? "",
          isPublished,
        ),
      );
  },
);
export const deleteCollegeInterviewController = asyncHandler(
  async (req: Request, res: Response) => {
    await interview.deleteCollegeInterview(tenantId(req), req.params.assessmentId ?? "");
    res.status(204).send();
  },
);
export const interviewTtsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { text } = interviewTtsRequestSchema.parse(req.body);
    res.status(200).json(await interview.generateInterviewPromptAudio(tenantId(req), text));
  },
);
export const listInterviewAttemptsController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await interview.listInterviewAttempts(tenantId(req), req.params.assessmentId ?? ""),
      );
  },
);
export const clearInterviewAttemptController = asyncHandler(
  async (req: Request, res: Response) => {
    await interview.clearInterviewAttempt(
      tenantId(req),
      req.params.assessmentId ?? "",
      req.params.attemptId ?? "",
    );
    res.status(204).send();
  },
);
export const interviewCohortController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await interview.getInterviewCohortReport(tenantId(req), req.params.assessmentId ?? ""),
      );
  },
);
export const interviewCohortExportController = asyncHandler(
  async (req: Request, res: Response) => {
    const report = await interview.getInterviewCohortReport(
      tenantId(req),
      req.params.assessmentId ?? "",
    );
    const buffer = await buildMockInterviewCohortWorkbook(report);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="mock-interview-${report.id}.xlsx"`,
    );
    res.status(200).send(buffer);
  },
);

// --- Platform admin --------------------------------------------------------
export const adminListInterviewsController = asyncHandler(
  async (_req: Request, res: Response) => {
    res.status(200).json(await interview.listPlatformInterviews());
  },
);
export const adminCreateInterviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = mockInterviewUpsertSchema.parse(req.body);
    res.status(201).json(await interview.createPlatformInterview(input));
  },
);
export const adminGetInterviewController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await interview.getPlatformInterview(req.params.assessmentId ?? ""));
  },
);
export const adminUpdateInterviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = mockInterviewUpsertSchema.parse(req.body);
    res
      .status(200)
      .json(await interview.updatePlatformInterview(req.params.assessmentId ?? "", input));
  },
);
export const adminSetInterviewPublishController = asyncHandler(
  async (req: Request, res: Response) => {
    const { isPublished } = setMockInterviewPublishSchema.parse(req.body);
    res
      .status(200)
      .json(
        await interview.setPlatformInterviewPublished(
          req.params.assessmentId ?? "",
          isPublished,
        ),
      );
  },
);
export const adminDeleteInterviewController = asyncHandler(
  async (req: Request, res: Response) => {
    await interview.deletePlatformInterview(req.params.assessmentId ?? "");
    res.status(204).send();
  },
);
export const adminInterviewTtsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { text } = interviewTtsRequestSchema.parse(req.body);
    res.status(200).json(await interview.generateInterviewPromptAudio("platform", text));
  },
);
export const adminListInterviewTopicsController = asyncHandler(
  async (_req: Request, res: Response) => {
    res.status(200).json(await interview.listInterviewTopics());
  },
);
