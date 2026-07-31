/**
 * Global question-bank controllers (super-admin). Thin: validate with shared zod
 * schemas, delegate to the bank service. CRUD a global BankQuestion, browse the
 * global banks, and the categorized bulk importer (+ a downloadable template).
 */
import {
  bankBrowseQuerySchema,
  bankQuestionUpsertSchema,
  examBulkUploadKindSchema,
  examBulkUploadRequestSchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { asyncHandler } from "../lib/async-handler.js";
import { buildBankTemplate } from "../lib/question-bank-excel.js";
import { sendXlsxAttachment } from "../lib/http-download.js";
import * as bank from "../services/question-bank.service.js";

export const listGlobalBankController = asyncHandler(
  async (req: Request, res: Response) => {
    const query = bankBrowseQuerySchema.parse(req.query);
    res.status(200).json(await bank.browseGlobalBank(query));
  },
);

export const createGlobalBankController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = bankQuestionUpsertSchema.parse(req.body);
    res.status(201).json(await bank.createGlobalBankQuestion(input));
  },
);

export const updateGlobalBankController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = bankQuestionUpsertSchema.parse(req.body);
    res
      .status(200)
      .json(await bank.updateGlobalBankQuestion(req.params.id ?? "", input));
  },
);

export const deleteGlobalBankController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await bank.deleteGlobalBankQuestion(req.params.id ?? ""));
  },
);

export const importGlobalBankController = asyncHandler(
  async (req: Request, res: Response) => {
    const { fileBase64, kind } = examBulkUploadRequestSchema.parse(req.body);
    res.status(200).json(await bank.importGlobalBank(fileBase64, kind));
  },
);

/** Download a ready-to-fill categorized bank template (?kind=mcq|coding). */
export const globalBankTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const kind = examBulkUploadKindSchema.parse(req.query.kind);
    const { buffer, filename } = await buildBankTemplate(kind);
    sendXlsxAttachment(res, buffer, filename);
  },
);
