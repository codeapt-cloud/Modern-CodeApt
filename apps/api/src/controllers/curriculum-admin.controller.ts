/**
 * Curriculum ADMIN controllers (requireAdmin at the route). Mirrors the
 * exam-admin / careers-admin controllers: validate with shared zod schemas,
 * delegate to the curriculum-admin service. Covers the structural tree
 * (Program / Subject / Module) and the leaf tree (Topic + quiz Question/Choice).
 */
import {
  adminModuleUpsertSchema,
  adminProgramUpsertSchema,
  adminQuizQuestionUpsertSchema,
  adminReorderSchema,
  adminSubjectUpsertSchema,
  adminTopicUpsertSchema,
  excelUploadRequestSchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { asyncHandler } from "../lib/async-handler.js";
import { sendXlsxAttachment } from "../lib/http-download.js";
import { buildTopicTemplateWorkbook } from "../lib/topic-excel.js";
import * as admin from "../services/curriculum-admin.service.js";

// --- Program ---------------------------------------------------------------

export const adminListProgramsController = asyncHandler(
  async (_req: Request, res: Response) => {
    res.status(200).json(await admin.listProgramsAdmin());
  },
);

export const adminGetProgramController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await admin.getProgramAdmin(req.params.programId ?? ""));
  },
);

export const adminCreateProgramController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminProgramUpsertSchema.parse(req.body);
    res.status(201).json(await admin.createProgram(input));
  },
);

export const adminUpdateProgramController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminProgramUpsertSchema.parse(req.body);
    res
      .status(200)
      .json(await admin.updateProgram(req.params.programId ?? "", input));
  },
);

export const adminDeleteProgramController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await admin.deleteProgram(req.params.programId ?? ""));
  },
);

export const adminReorderProgramsController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminReorderSchema.parse(req.body);
    res.status(200).json(await admin.reorderPrograms(input));
  },
);

// --- Subject ---------------------------------------------------------------

export const adminListSubjectsController = asyncHandler(
  async (req: Request, res: Response) => {
    const programId =
      typeof req.query.programId === "string" ? req.query.programId : undefined;
    res.status(200).json(await admin.listSubjectsAdmin(programId));
  },
);

export const adminGetSubjectController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await admin.getSubjectAdmin(req.params.subjectId ?? ""));
  },
);

export const adminCreateSubjectController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminSubjectUpsertSchema.parse(req.body);
    res.status(201).json(await admin.createSubject(input));
  },
);

export const adminUpdateSubjectController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminSubjectUpsertSchema.parse(req.body);
    res
      .status(200)
      .json(await admin.updateSubject(req.params.subjectId ?? "", input));
  },
);

export const adminDeleteSubjectController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await admin.deleteSubject(req.params.subjectId ?? ""));
  },
);

/** Recompute all enrollments' expiry from this course's current validity. */
export const adminRecomputeSubjectExpiryController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await admin.recomputeSubjectEnrollmentExpiry(
          req.params.subjectId ?? "",
        ),
      );
  },
);

// --- Module ----------------------------------------------------------------

export const adminListModulesController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(await admin.listModulesAdmin(req.params.subjectId ?? ""));
  },
);

export const adminGetModuleController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await admin.getModuleAdmin(req.params.moduleId ?? ""));
  },
);

export const adminCreateModuleController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminModuleUpsertSchema.parse(req.body);
    res
      .status(201)
      .json(await admin.createModule(req.params.subjectId ?? "", input));
  },
);

export const adminUpdateModuleController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminModuleUpsertSchema.parse(req.body);
    res
      .status(200)
      .json(await admin.updateModule(req.params.moduleId ?? "", input));
  },
);

export const adminDeleteModuleController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await admin.deleteModule(req.params.moduleId ?? ""));
  },
);

export const adminReorderModulesController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminReorderSchema.parse(req.body);
    res
      .status(200)
      .json(await admin.reorderModules(req.params.subjectId ?? "", input));
  },
);

// --- Topic -----------------------------------------------------------------

export const adminListTopicsController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(await admin.listTopicsAdmin(req.params.moduleId ?? ""));
  },
);

export const adminGetTopicController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await admin.getTopicAdmin(req.params.topicId ?? ""));
  },
);

export const adminCreateTopicController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminTopicUpsertSchema.parse(req.body);
    res
      .status(201)
      .json(await admin.createTopic(req.params.moduleId ?? "", input));
  },
);

export const adminUpdateTopicController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminTopicUpsertSchema.parse(req.body);
    res
      .status(200)
      .json(await admin.updateTopic(req.params.topicId ?? "", input));
  },
);

export const adminDeleteTopicController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await admin.deleteTopic(req.params.topicId ?? ""));
  },
);

export const adminReorderTopicsController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminReorderSchema.parse(req.body);
    res
      .status(200)
      .json(await admin.reorderTopics(req.params.moduleId ?? "", input));
  },
);

export const adminBulkUploadTopicsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { fileBase64 } = excelUploadRequestSchema.parse(req.body);
    res
      .status(200)
      .json(await admin.bulkUploadTopics(req.params.subjectId ?? "", fileBase64));
  },
);

/** Download the ready-to-fill topics .xlsx template (static). */
export const adminBulkUploadTopicsTemplateController = asyncHandler(
  async (_req: Request, res: Response) => {
    const buffer = await buildTopicTemplateWorkbook();
    sendXlsxAttachment(res, buffer, "topics-template.xlsx");
  },
);

// --- Quiz Question / Choice ------------------------------------------------

export const adminListQuizQuestionsController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(await admin.listQuizQuestions(req.params.topicId ?? ""));
  },
);

export const adminCreateQuizQuestionController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminQuizQuestionUpsertSchema.parse(req.body);
    res
      .status(201)
      .json(await admin.createQuizQuestion(req.params.topicId ?? "", input));
  },
);

export const adminUpdateQuizQuestionController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminQuizQuestionUpsertSchema.parse(req.body);
    res
      .status(200)
      .json(await admin.updateQuizQuestion(req.params.questionId ?? "", input));
  },
);

export const adminDeleteQuizQuestionController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(await admin.deleteQuizQuestion(req.params.questionId ?? ""));
  },
);

// --- Exam-topic picker -----------------------------------------------------

export const adminListExamTopicsController = asyncHandler(
  async (_req: Request, res: Response) => {
    res.status(200).json(await admin.listExamTopics());
  },
);
