/**
 * Admin bulk-enroll controller (requireAdmin at the route). Validates with the
 * shared zod schema and delegates to the enrollment-admin service.
 */
import { bulkEnrollRequestSchema } from "@codeapt/shared";
import type { Request, Response } from "express";

import { asyncHandler } from "../lib/async-handler.js";
import { sendXlsxAttachment } from "../lib/http-download.js";
import { buildRosterTemplateWorkbook } from "../lib/roster-excel.js";
import { bulkEnrollFromRoster } from "../services/enrollment-admin.service.js";

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
