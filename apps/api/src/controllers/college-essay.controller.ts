/**
 * College essay controllers (Phase 4c) — thin: validate with shared zod schemas,
 * delegate to the tenant-scoped college-essay service. The college id comes from
 * the validated `req.tenant`; the ACTOR (for faculty scope) from `req.auth`. Both
 * are guaranteed by the route's requireAuth → resolveTenant stack.
 *
 * Authoring handlers are mounted behind requireFaculty + requireFeature('essays');
 * the student handlers behind tenant membership + the feature. The grading-status
 * poll + analytics reuse the SHARED /essays/submissions/:jobId endpoints
 * (authorized by attempt ownership) — a college student rides them unchanged, so
 * they are NOT duplicated here.
 */
import {
  AuthErrorCode,
  TenantErrorCode,
  createCollegeEssaySchema,
  generateKeywordsRequestSchema,
  saveEssayDraftRequestSchema,
  setExamPublishSchema,
  submitEssayRequestSchema,
  updateCollegeEssaySchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import * as essays from "../services/college-essay.service.js";
import type { EssayActor } from "../services/college-essay.service.js";
import { generateAiFeedbackForTenant } from "../services/essay.service.js";

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

function actor(req: Request): EssayActor {
  if (!req.auth) {
    throw new AppError(
      "Authentication required",
      401,
      AuthErrorCode.UNAUTHENTICATED,
    );
  }
  return { userId: req.auth.userId, role: req.auth.role };
}

// --- Authoring ---------------------------------------------------------------

export const listCollegeEssaysController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(await essays.listCollegeEssays(tenantId(req), actor(req)));
  },
);

export const createCollegeEssayController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = createCollegeEssaySchema.parse(req.body);
    res
      .status(201)
      .json(await essays.createCollegeEssay(tenantId(req), actor(req), input));
  },
);

export const getCollegeEssayController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await essays.getCollegeEssay(
          tenantId(req),
          actor(req),
          req.params.essayTopicId ?? "",
        ),
      );
  },
);

export const updateCollegeEssayController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = updateCollegeEssaySchema.parse(req.body);
    res
      .status(200)
      .json(
        await essays.updateCollegeEssay(
          tenantId(req),
          actor(req),
          req.params.essayTopicId ?? "",
          input,
        ),
      );
  },
);

export const setCollegeEssayPublishController = asyncHandler(
  async (req: Request, res: Response) => {
    const { isPublished } = setExamPublishSchema.parse(req.body);
    res
      .status(200)
      .json(
        await essays.setCollegeEssayPublished(
          tenantId(req),
          actor(req),
          req.params.essayTopicId ?? "",
          isPublished,
        ),
      );
  },
);

export const deleteCollegeEssayController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await essays.removeCollegeEssay(
          tenantId(req),
          actor(req),
          req.params.essayTopicId ?? "",
        ),
      );
  },
);

export const generateCollegeKeywordsController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = generateKeywordsRequestSchema.parse(req.body);
    res
      .status(200)
      .json(await essays.generateCollegeKeywords(tenantId(req), input));
  },
);

export const collegeEssayResultsController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await essays.collegeEssayResults(
          tenantId(req),
          actor(req),
          req.params.essayTopicId ?? "",
        ),
      );
  },
);

/** Faculty on-demand AI Scoring & Feedback for one attempt (tenant-scoped). */
export const collegeEssayAiFeedbackController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await generateAiFeedbackForTenant(
          tenantId(req),
          req.params.attemptId ?? "",
        ),
      );
  },
);

// --- Writing (college student) ----------------------------------------------

export const listStudentCollegeEssaysController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await essays.listStudentCollegeEssays(tenantId(req), actor(req).userId),
      );
  },
);

export const getStudentCollegeEssayController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await essays.getStudentCollegeEssay(
          tenantId(req),
          actor(req).userId,
          req.params.essayId ?? "",
        ),
      );
  },
);

export const getStudentCollegeDraftController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await essays.getStudentDraft(
          tenantId(req),
          actor(req).userId,
          req.params.essayId ?? "",
        ),
      );
  },
);

export const saveStudentCollegeDraftController = asyncHandler(
  async (req: Request, res: Response) => {
    const { content } = saveEssayDraftRequestSchema.parse(req.body);
    res
      .status(200)
      .json(
        await essays.saveStudentDraft(
          tenantId(req),
          actor(req).userId,
          req.params.essayId ?? "",
          content,
        ),
      );
  },
);

export const submitStudentCollegeEssayController = asyncHandler(
  async (req: Request, res: Response) => {
    const { content, integrity } = submitEssayRequestSchema.parse(req.body);
    res.status(202).json(
      await essays.submitStudentEssay(
        tenantId(req),
        actor(req).userId,
        req.params.essayId ?? "",
        content,
        { ipAddress: req.ip, userAgent: req.get("user-agent") ?? "", integrity },
      ),
    );
  },
);

export const listStudentCollegeSubmissionsController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await essays.listStudentSubmissions(
          tenantId(req),
          actor(req).userId,
          req.params.essayId ?? "",
        ),
      );
  },
);
