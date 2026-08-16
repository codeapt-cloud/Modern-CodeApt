/**
 * Assessment controllers — student engine, public (anonymous), and admin
 * authoring. Thin: validate with shared zod schemas, resolve the caller /
 * attempt token, delegate to the services.
 *
 * Attempt authorization accepts EITHER the session user (owner) OR an
 * `X-Attempt-Token` header (anonymous public takers who have no session).
 */
import {
  AuthErrorCode,
  adminExamUpsertSchema,
  adminPublicLinkUpsertSchema,
  adminQuestionUpsertSchema,
  adminResetAttemptsRequestSchema,
  adminSectionUpsertSchema,
  adminTestCaseUpsertSchema,
  examBulkUploadKindSchema,
  examBulkUploadRequestSchema,
  publicStartRequestSchema,
  saveSectionAnswersRequestSchema,
  startAttemptRequestSchema,
  submitAttemptRequestSchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import { buildQuestionTemplate } from "../lib/exam-excel.js";
import { sendXlsxAttachment } from "../lib/http-download.js";
import * as admin from "../services/exam-admin.service.js";
import * as engine from "../services/exam.service.js";
import * as pub from "../services/exam-public.service.js";
import { listExamsForUser } from "../services/exam-list.service.js";

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
  const header = req.header("x-attempt-token");
  const token = header ?? undefined;
  return { userId: req.auth?.userId, token };
}

// --- Student engine ---------------------------------------------------------

export const listExamsController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await listExamsForUser(requireUserId(req));
    res.status(200).json(data);
  },
);

export const startAttemptController = asyncHandler(
  async (req: Request, res: Response) => {
    const { accessCode } = startAttemptRequestSchema.parse(req.body ?? {});
    const data = await engine.startAttempt(
      requireUserId(req),
      req.params.examId ?? "",
      accessCode,
    );
    res.status(201).json(data);
  },
);

export const getSectionController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await engine.getCurrentSection(
      req.params.attemptId ?? "",
      caller(req),
    );
    res.status(200).json(data);
  },
);

export const saveAnswersController = asyncHandler(
  async (req: Request, res: Response) => {
    const { answers, markedForReview } = saveSectionAnswersRequestSchema.parse(
      req.body,
    );
    const data = await engine.saveAnswers(
      req.params.attemptId ?? "",
      caller(req),
      answers,
      markedForReview,
    );
    res.status(200).json(data);
  },
);

export const advanceController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await engine.advanceSection(
      req.params.attemptId ?? "",
      caller(req),
    );
    res.status(200).json(data);
  },
);

export const submitController = asyncHandler(
  async (req: Request, res: Response) => {
    const { auto } = submitAttemptRequestSchema.parse(req.body ?? {});
    const data = await engine.submitAttempt(
      req.params.attemptId ?? "",
      caller(req),
      auto ?? false,
    );
    res.status(200).json(data);
  },
);

export const finalizeController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await engine.finalizeAttempt(
      req.params.attemptId ?? "",
      caller(req),
    );
    res.status(200).json(data);
  },
);

export const resultController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await engine.getResult(
      req.params.attemptId ?? "",
      caller(req),
    );
    res.status(200).json(data);
  },
);

export const warningController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await engine.recordWarning(
      req.params.attemptId ?? "",
      caller(req),
    );
    res.status(200).json(data);
  },
);

// --- Public (anonymous) -----------------------------------------------------

export const publicAvailabilityController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await pub.getPublicAvailability(req.params.token ?? "");
    res.status(200).json(data);
  },
);

export const publicStartController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = publicStartRequestSchema.parse(req.body);
    const data = await pub.startPublicAttempt(req.params.token ?? "", input);
    res.status(201).json(data);
  },
);

// --- Admin authoring --------------------------------------------------------

export const adminUpsertExamController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminExamUpsertSchema.parse(req.body);
    const data = await admin.upsertExam(input);
    res.status(200).json(data);
  },
);

export const adminListExamsController = asyncHandler(
  async (_req: Request, res: Response) => {
    const data = await admin.listAllExams();
    res.status(200).json(data);
  },
);

export const adminGetExamController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await admin.getAdminExamDetail(req.params.examId ?? "");
    res.status(200).json(data);
  },
);

export const adminDeleteExamController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await admin.deleteExam(req.params.examId ?? "");
    res.status(200).json(data);
  },
);

export const adminCreateSectionController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminSectionUpsertSchema.parse(req.body);
    const data = await admin.createSection(req.params.examId ?? "", input);
    res.status(201).json(data);
  },
);

export const adminUpdateSectionController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminSectionUpsertSchema.parse(req.body);
    const data = await admin.updateSection(req.params.sectionId ?? "", input);
    res.status(200).json(data);
  },
);

export const adminDeleteSectionController = asyncHandler(
  async (req: Request, res: Response) => {
    await admin.deleteSection(req.params.sectionId ?? "");
    res.status(204).end();
  },
);

export const adminCreateQuestionController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminQuestionUpsertSchema.parse(req.body);
    const data = await admin.createQuestion(input);
    res.status(201).json(data);
  },
);

export const adminUpdateQuestionController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminQuestionUpsertSchema.parse(req.body);
    const data = await admin.updateQuestion(
      req.params.questionId ?? "",
      input,
    );
    res.status(200).json(data);
  },
);

export const adminDeleteQuestionController = asyncHandler(
  async (req: Request, res: Response) => {
    await admin.deleteQuestion(req.params.questionId ?? "");
    res.status(204).end();
  },
);

export const adminAddTestCaseController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminTestCaseUpsertSchema.parse(req.body);
    const data = await admin.addTestCase(req.params.questionId ?? "", input);
    res.status(201).json(data);
  },
);

export const adminUpdateTestCaseController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminTestCaseUpsertSchema.parse(req.body);
    const data = await admin.updateTestCase(req.params.testCaseId ?? "", input);
    res.status(200).json(data);
  },
);

export const adminDeleteTestCaseController = asyncHandler(
  async (req: Request, res: Response) => {
    await admin.deleteTestCase(req.params.testCaseId ?? "");
    res.status(204).end();
  },
);

export const adminCreatePublicLinkController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminPublicLinkUpsertSchema.parse(req.body);
    const data = await admin.createPublicLink(req.params.examId ?? "", input);
    res.status(201).json(data);
  },
);

export const adminUpdatePublicLinkController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminPublicLinkUpsertSchema.parse(req.body);
    const data = await admin.updatePublicLink(req.params.linkId ?? "", input);
    res.status(200).json(data);
  },
);

export const adminDeletePublicLinkController = asyncHandler(
  async (req: Request, res: Response) => {
    await admin.deletePublicLink(req.params.linkId ?? "");
    res.status(204).end();
  },
);

export const adminBulkUploadController = asyncHandler(
  async (req: Request, res: Response) => {
    const { fileBase64, kind } = examBulkUploadRequestSchema.parse(req.body);
    const data = await admin.bulkUploadQuestions(
      req.params.examId ?? "",
      fileBase64,
      kind,
    );
    res.status(200).json(data);
  },
);

/** Download a ready-to-fill single-sheet template (?kind=mcq|coding). */
export const adminBulkUploadTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const kind = examBulkUploadKindSchema.parse(req.query.kind);
    const { buffer, filename } = await buildQuestionTemplate(kind);
    sendXlsxAttachment(res, buffer, filename);
  },
);

export const adminExportResultsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { buffer, filename } = await admin.exportResults(
      req.params.examId ?? "",
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.status(200).send(buffer);
  },
);

export const adminResetAttemptsController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminResetAttemptsRequestSchema.parse(req.body);
    const data = await admin.resetAttempts(
      req.params.examId ?? "",
      requireUserId(req),
      input,
    );
    res.status(200).json(data);
  },
);

// --- Attempt-management reads (item C4) ---

export const adminListAttemptCountersController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(await admin.listAttemptCounters(req.params.examId ?? ""));
  },
);

export const adminGetUserExamAttemptsController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await admin.getUserExamAttempts(
          req.params.examId ?? "",
          req.params.userId ?? "",
        ),
      );
  },
);

export const adminListResetLogController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await admin.listResetLog(req.params.examId ?? ""));
  },
);
