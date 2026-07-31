/**
 * Per-student AI credit distribution controllers. Admin surface (college_admin):
 * view the distribution, toggle the mode, allocate to selected students, and the
 * reused Excel roll-number preview + template. Student surface: the calling
 * student's OWN allocation (own-data-only). Read-only over stored ledgers; no
 * live AI. Gated by the AI feature on the routes.
 */
import {
  AuthErrorCode,
  TenantErrorCode,
  allocateStudentCreditsSchema,
  excelUploadRequestSchema,
  setStudentDistributionSchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import { parseAttendanceRollNumbers, buildAttendanceTemplateWorkbook } from "../lib/attendance-excel.js";
import { sendXlsxAttachment } from "../lib/http-download.js";
import { previewAttendanceRollNumbers } from "../services/attendance.service.js";
import {
  allocateStudentCredits,
  getCreditDistribution,
  getStudentOwnCredits,
  setPerStudentEnabled,
} from "../services/student-ai-credit.service.js";

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

// --- Admin ------------------------------------------------------------------

export const getCreditDistributionController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await getCreditDistribution(tenantId(req), new Date()));
  },
);

export const setDistributionSettingsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { enabled } = setStudentDistributionSchema.parse(req.body);
    await setPerStudentEnabled(tenantId(req), enabled);
    res.status(200).json(await getCreditDistribution(tenantId(req), new Date()));
  },
);

export const allocateStudentCreditsController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = allocateStudentCreditsSchema.parse(req.body);
    res
      .status(200)
      .json(await allocateStudentCredits(tenantId(req), input, new Date()));
  },
);

/** Reuse the attendance roll-number preview: matched/unmatched, persists nothing. */
export const creditImportPreviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const { fileBase64 } = excelUploadRequestSchema.parse(req.body);
    const buffer = Buffer.from(fileBase64, "base64");
    const rollNumbers = await parseAttendanceRollNumbers(buffer);
    res
      .status(200)
      .json(await previewAttendanceRollNumbers(tenantId(req), rollNumbers));
  },
);

/** Reuse the attendance roll-number .xlsx template. */
export const creditImportTemplateController = asyncHandler(
  async (_req: Request, res: Response) => {
    const buffer = await buildAttendanceTemplateWorkbook();
    sendXlsxAttachment(res, buffer, "credit-roll-numbers-template.xlsx");
  },
);

// --- Student (own-data-only) ------------------------------------------------

export const getMyAiCreditsController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(await getStudentOwnCredits(tenantId(req), userId(req), new Date()));
  },
);
