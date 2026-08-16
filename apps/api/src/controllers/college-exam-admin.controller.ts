/**
 * College exam controllers (Phase 4b) — thin: validate with shared zod schemas,
 * delegate to the tenant-scoped college-exam service. The college id comes from
 * the validated `req.tenant`; the ACTOR (for faculty scope) from `req.auth`.
 * Both are guaranteed by the route's requireAuth → resolveTenant stack.
 *
 * Authoring handlers are mounted behind requireFaculty + requireFeature('exams');
 * the two student handlers (list/start) behind tenant membership + the feature.
 * The engine steps (section view / save / submit / result) reuse the shared
 * /attempts/* endpoints (authorized by attempt ownership) — not duplicated here.
 */
import {
  AuthErrorCode,
  TenantErrorCode,
  adminPublicLinkUpsertSchema,
  adminQuestionUpsertSchema,
  adminResetAttemptsRequestSchema,
  adminSectionUpsertSchema,
  adminTestCaseUpsertSchema,
  createCollegeExamSchema,
  duplicateCollegeExamSchema,
  examBulkUploadKindSchema,
  examBulkUploadRequestSchema,
  setExamPublishSchema,
  startAttemptRequestSchema,
  updateCollegeExamSchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import { buildQuestionTemplate } from "../lib/exam-excel.js";
import { buildExamAnalysisWorkbook } from "../lib/exam-report.js";
import { sendXlsxAttachment } from "../lib/http-download.js";
import * as exams from "../services/college-exam.service.js";
import type { ExamActor } from "../services/college-exam.service.js";
import * as examAnalysis from "../services/exam-analysis.service.js";

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

function actor(req: Request): ExamActor {
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

export const listCollegeExamsController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await exams.listCollegeExams(tenantId(req), actor(req)));
  },
);

export const createCollegeExamController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = createCollegeExamSchema.parse(req.body);
    res
      .status(201)
      .json(await exams.createCollegeExam(tenantId(req), actor(req), input));
  },
);

export const getCollegeExamController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await exams.getCollegeExam(
          tenantId(req),
          actor(req),
          req.params.examId ?? "",
        ),
      );
  },
);

export const duplicateCollegeExamController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = duplicateCollegeExamSchema.parse(req.body);
    res
      .status(201)
      .json(
        await exams.duplicateCollegeExam(
          tenantId(req),
          actor(req),
          req.params.examId ?? "",
          input,
        ),
      );
  },
);

export const updateCollegeExamController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = updateCollegeExamSchema.parse(req.body);
    res
      .status(200)
      .json(
        await exams.updateCollegeExam(
          tenantId(req),
          actor(req),
          req.params.examId ?? "",
          input,
        ),
      );
  },
);

export const setCollegeExamPublishController = asyncHandler(
  async (req: Request, res: Response) => {
    const { isPublished } = setExamPublishSchema.parse(req.body);
    res
      .status(200)
      .json(
        await exams.setCollegeExamPublished(
          tenantId(req),
          actor(req),
          req.params.examId ?? "",
          isPublished,
        ),
      );
  },
);

export const deleteCollegeExamController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await exams.removeCollegeExam(
          tenantId(req),
          actor(req),
          req.params.examId ?? "",
        ),
      );
  },
);

export const createCollegeSectionController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminSectionUpsertSchema.parse(req.body);
    res
      .status(201)
      .json(
        await exams.addSection(
          tenantId(req),
          actor(req),
          req.params.examId ?? "",
          input,
        ),
      );
  },
);

export const updateCollegeSectionController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminSectionUpsertSchema.parse(req.body);
    res
      .status(200)
      .json(
        await exams.editSection(
          tenantId(req),
          actor(req),
          req.params.sectionId ?? "",
          input,
        ),
      );
  },
);

export const deleteCollegeSectionController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await exams.removeSection(
          tenantId(req),
          actor(req),
          req.params.sectionId ?? "",
        ),
      );
  },
);

export const createCollegeQuestionController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminQuestionUpsertSchema.parse(req.body);
    res
      .status(201)
      .json(await exams.addQuestion(tenantId(req), actor(req), input));
  },
);

export const updateCollegeQuestionController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminQuestionUpsertSchema.parse(req.body);
    res
      .status(200)
      .json(
        await exams.editQuestion(
          tenantId(req),
          actor(req),
          req.params.questionId ?? "",
          input,
        ),
      );
  },
);

export const deleteCollegeQuestionController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await exams.removeQuestion(
          tenantId(req),
          actor(req),
          req.params.questionId ?? "",
        ),
      );
  },
);

export const addCollegeTestCaseController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminTestCaseUpsertSchema.parse(req.body);
    res
      .status(201)
      .json(
        await exams.addTestCase(
          tenantId(req),
          actor(req),
          req.params.questionId ?? "",
          input,
        ),
      );
  },
);

export const updateCollegeTestCaseController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminTestCaseUpsertSchema.parse(req.body);
    res
      .status(200)
      .json(
        await exams.editTestCase(
          tenantId(req),
          actor(req),
          req.params.testCaseId ?? "",
          input,
        ),
      );
  },
);

export const deleteCollegeTestCaseController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await exams.removeTestCase(
          tenantId(req),
          actor(req),
          req.params.testCaseId ?? "",
        ),
      );
  },
);

export const collegeBulkUploadController = asyncHandler(
  async (req: Request, res: Response) => {
    const { fileBase64, kind } = examBulkUploadRequestSchema.parse(req.body);
    res
      .status(200)
      .json(
        await exams.bulkUpload(
          tenantId(req),
          actor(req),
          req.params.examId ?? "",
          fileBase64,
          kind,
        ),
      );
  },
);

/** Download a ready-to-fill single-sheet template (?kind=mcq|coding) — gated by
 * the tenant + `exams` feature + faculty route stack. */
export const collegeBulkUploadTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const kind = examBulkUploadKindSchema.parse(req.query.kind);
    const { buffer, filename } = await buildQuestionTemplate(kind);
    sendXlsxAttachment(res, buffer, filename);
  },
);

export const createCollegePublicLinkController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminPublicLinkUpsertSchema.parse(req.body);
    res
      .status(201)
      .json(
        await exams.addPublicLink(
          tenantId(req),
          actor(req),
          req.params.examId ?? "",
          input,
        ),
      );
  },
);

export const updateCollegePublicLinkController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminPublicLinkUpsertSchema.parse(req.body);
    res
      .status(200)
      .json(
        await exams.editPublicLink(
          tenantId(req),
          actor(req),
          req.params.linkId ?? "",
          input,
        ),
      );
  },
);

export const deleteCollegePublicLinkController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await exams.removePublicLink(
          tenantId(req),
          actor(req),
          req.params.linkId ?? "",
        ),
      );
  },
);

/** Results for ONE college public link (tenant + faculty-scope enforced). */
export const collegeExportPublicLinkResultsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { buffer, filename } = await exams.exportPublicLinkResults(
      tenantId(req),
      actor(req),
      req.params.linkId ?? "",
    );
    sendXlsxAttachment(res, buffer, filename);
  },
);

export const collegeResetAttemptsController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminResetAttemptsRequestSchema.parse(req.body);
    res
      .status(200)
      .json(
        await exams.resetAttempts(
          tenantId(req),
          actor(req),
          req.params.examId ?? "",
          input,
        ),
      );
  },
);

export const collegeExamResultsController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await exams.collegeExamResults(
          tenantId(req),
          actor(req),
          req.params.examId ?? "",
        ),
      );
  },
);

// --- Result analysis + Excel export (Phase 5) --------------------------------

export const collegeExamAnalysisController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await examAnalysis.getExamAnalysis(
          tenantId(req),
          actor(req),
          req.params.examId ?? "",
        ),
      );
  },
);

export const collegeExamAnalysisReportController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await examAnalysis.examReportData(
      tenantId(req),
      actor(req),
      req.params.examId ?? "",
    );
    const buffer = await buildExamAnalysisWorkbook(data);
    const safe =
      data.analysis.examTitle.replace(/[^\w-]+/g, "_").slice(0, 40) || "exam";
    sendXlsxAttachment(res, buffer, `exam-analysis-${safe}.xlsx`);
  },
);

// --- Taking (college student) ------------------------------------------------

export const listStudentCollegeExamsController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await exams.listStudentCollegeExams(tenantId(req), actor(req).userId),
      );
  },
);

export const startStudentCollegeExamController = asyncHandler(
  async (req: Request, res: Response) => {
    const { accessCode } = startAttemptRequestSchema.parse(req.body ?? {});
    res
      .status(201)
      .json(
        await exams.startStudentCollegeExam(
          tenantId(req),
          actor(req).userId,
          req.params.examId ?? "",
          accessCode,
        ),
      );
  },
);
