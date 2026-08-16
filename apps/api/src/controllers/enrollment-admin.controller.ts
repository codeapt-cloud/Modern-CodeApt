/**
 * Admin bulk-enroll controller (requireAdmin at the route). Validates with the
 * shared zod schema and delegates to the enrollment-admin service.
 */
import {
  adminEnrollmentAddSchema,
  adminEnrollmentListQuerySchema,
  adminEnrollmentRemoveSchema,
  adminEnrollmentSetExpirySchema,
  bulkEnrollRequestSchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { asyncHandler } from "../lib/async-handler.js";
import { sendXlsxAttachment } from "../lib/http-download.js";
import { buildRosterTemplateWorkbook } from "../lib/roster-excel.js";
import {
  addSubjectEnrollments,
  bulkEnrollFromRoster,
  exportSubjectEnrollments,
  listSubjectEnrollmentColleges,
  listSubjectEnrollments,
  removeSubjectEnrollments,
  setEnrollmentExpiry,
} from "../services/enrollment-admin.service.js";

export const adminBulkEnrollController = asyncHandler(
  async (req: Request, res: Response) => {
    const { subjectIds, fileBase64 } = bulkEnrollRequestSchema.parse(req.body);
    res.status(200).json(await bulkEnrollFromRoster(subjectIds, fileBase64));
  },
);

/** Download the ready-to-fill bulk-enroll roster .xlsx template (static). */
export const adminBulkEnrollTemplateController = asyncHandler(
  async (_req: Request, res: Response) => {
    const buffer = await buildRosterTemplateWorkbook();
    sendXlsxAttachment(res, buffer, "bulk-enroll-roster-template.xlsx");
  },
);

// --- Per-course enrollment management ---------------------------------------

export const adminListSubjectEnrollmentsController = asyncHandler(
  async (req: Request, res: Response) => {
    const query = adminEnrollmentListQuerySchema.parse(req.query);
    res
      .status(200)
      .json(await listSubjectEnrollments(req.params.subjectId ?? "", query));
  },
);

export const adminListSubjectEnrollmentCollegesController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(await listSubjectEnrollmentColleges(req.params.subjectId ?? ""));
  },
);

export const adminAddSubjectEnrollmentsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { userIds } = adminEnrollmentAddSchema.parse(req.body);
    res
      .status(200)
      .json(await addSubjectEnrollments(req.params.subjectId ?? "", userIds));
  },
);

export const adminRemoveSubjectEnrollmentsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { userIds } = adminEnrollmentRemoveSchema.parse(req.body);
    res
      .status(200)
      .json(await removeSubjectEnrollments(req.params.subjectId ?? "", userIds));
  },
);

export const adminSetEnrollmentExpiryController = asyncHandler(
  async (req: Request, res: Response) => {
    const { expiresAt } = adminEnrollmentSetExpirySchema.parse(req.body);
    res
      .status(200)
      .json(
        await setEnrollmentExpiry(
          req.params.subjectId ?? "",
          req.params.enrollmentId ?? "",
          expiresAt,
        ),
      );
  },
);

export const adminExportSubjectEnrollmentsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { buffer, filename } = await exportSubjectEnrollments(
      req.params.subjectId ?? "",
    );
    sendXlsxAttachment(res, buffer, filename);
  },
);
