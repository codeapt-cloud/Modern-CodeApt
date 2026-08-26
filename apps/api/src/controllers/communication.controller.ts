/**
 * CommunicationAssessment composite controllers — tenant-scoped at
 * /c/:slug/communication/assessments. Students consume (view / launch a gated
 * part); faculty author (list / create / get / update / publish / delete) and
 * read the cohort report + the ONE Excel export. Mirrors speaking.controller.
 */
import {
  AuthErrorCode,
  TenantErrorCode,
  communicationAssessmentUpsertSchema,
  setCommunicationPublishSchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";
import { z } from "zod";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import { buildCommunicationCohortWorkbook } from "../lib/communication-cohort-excel.js";
import * as communication from "../services/communication.service.js";

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

const orderParam = z.object({ order: z.coerce.number().int().min(0) });

// --- Student consumption ----------------------------------------------------

export const listAvailableCommunicationController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await communication.listAvailableCommunicationForCollege(
          userId(req),
          tenantId(req),
        ),
      );
  },
);

export const getCommunicationStudentController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await communication.getCommunicationForStudent(
          userId(req),
          req.params.assessmentId ?? "",
        ),
      );
  },
);

export const launchCommunicationPartController = asyncHandler(
  async (req: Request, res: Response) => {
    const { order } = orderParam.parse(req.params);
    res
      .status(200)
      .json(
        await communication.launchCommunicationPart(
          userId(req),
          req.params.assessmentId ?? "",
          order,
        ),
      );
  },
);

// --- College authoring ------------------------------------------------------

export const listCollegeCommunicationController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(await communication.listCollegeCommunication(tenantId(req)));
  },
);

export const createCollegeCommunicationController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = communicationAssessmentUpsertSchema.parse(req.body);
    res
      .status(201)
      .json(await communication.createCollegeCommunication(tenantId(req), input));
  },
);

export const getCollegeCommunicationController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await communication.getCollegeCommunication(
          tenantId(req),
          req.params.assessmentId ?? "",
        ),
      );
  },
);

export const updateCollegeCommunicationController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = communicationAssessmentUpsertSchema.parse(req.body);
    res
      .status(200)
      .json(
        await communication.updateCollegeCommunication(
          tenantId(req),
          req.params.assessmentId ?? "",
          input,
        ),
      );
  },
);

export const setCollegeCommunicationPublishController = asyncHandler(
  async (req: Request, res: Response) => {
    const { isPublished } = setCommunicationPublishSchema.parse(req.body);
    res
      .status(200)
      .json(
        await communication.setCollegeCommunicationPublished(
          tenantId(req),
          req.params.assessmentId ?? "",
          isPublished,
        ),
      );
  },
);

export const deleteCollegeCommunicationController = asyncHandler(
  async (req: Request, res: Response) => {
    await communication.deleteCollegeCommunication(
      tenantId(req),
      req.params.assessmentId ?? "",
    );
    res.status(204).send();
  },
);

// --- Operator cohort report + export ----------------------------------------

export const getCommunicationCohortController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await communication.getCommunicationCohortReport(
          tenantId(req),
          req.params.assessmentId ?? "",
        ),
      );
  },
);

export const exportCommunicationCohortController = asyncHandler(
  async (req: Request, res: Response) => {
    const report = await communication.getCommunicationCohortReport(
      tenantId(req),
      req.params.assessmentId ?? "",
    );
    const buffer = await buildCommunicationCohortWorkbook(report);
    const filename = `communication-${report.id}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.status(200).send(buffer);
  },
);

// --- Enrollment-based discovery (global, S29) -------------------------------

/** Course-attached composites the caller can reach by enrollment (B2C or college
 *  student). No tenant — global GET /communication. */
export const listCommunicationForUserController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(await communication.listCommunicationForUser(userId(req)));
  },
);

// --- Platform authoring (requireAdmin, college:null, S29) -------------------

export const adminListCommunicationController = asyncHandler(
  async (_req: Request, res: Response) => {
    res.status(200).json(await communication.listPlatformCommunication());
  },
);

export const adminListCommunicationTopicsController = asyncHandler(
  async (_req: Request, res: Response) => {
    res.status(200).json(await communication.listCommunicationTopics());
  },
);

export const adminCreateCommunicationController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = communicationAssessmentUpsertSchema.parse(req.body);
    res.status(201).json(await communication.createPlatformCommunication(input));
  },
);

export const adminGetCommunicationController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await communication.getPlatformCommunication(
          req.params.assessmentId ?? "",
        ),
      );
  },
);

export const adminUpdateCommunicationController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = communicationAssessmentUpsertSchema.parse(req.body);
    res
      .status(200)
      .json(
        await communication.updatePlatformCommunication(
          req.params.assessmentId ?? "",
          input,
        ),
      );
  },
);

export const adminSetCommunicationPublishController = asyncHandler(
  async (req: Request, res: Response) => {
    const { isPublished } = setCommunicationPublishSchema.parse(req.body);
    res
      .status(200)
      .json(
        await communication.setPlatformCommunicationPublished(
          req.params.assessmentId ?? "",
          isPublished,
        ),
      );
  },
);

export const adminDeleteCommunicationController = asyncHandler(
  async (req: Request, res: Response) => {
    await communication.deletePlatformCommunication(
      req.params.assessmentId ?? "",
    );
    res.status(204).send();
  },
);
