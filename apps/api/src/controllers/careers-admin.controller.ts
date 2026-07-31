/**
 * Careers ADMIN controllers (requireAdmin at the route). Mirrors the exam-admin
 * controllers: validate with shared zod schemas, delegate to the admin service.
 */
import {
  adminPostingUpsertSchema,
  updateApplicationStatusRequestSchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { asyncHandler } from "../lib/async-handler.js";
import * as admin from "../services/careers-admin.service.js";

export const adminListPostingsController = asyncHandler(
  async (_req: Request, res: Response) => {
    res.status(200).json(await admin.listPostingsAdmin());
  },
);

export const adminGetPostingController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await admin.getPostingAdmin(req.params.id ?? ""));
  },
);

export const adminCreatePostingController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminPostingUpsertSchema.parse(req.body);
    res.status(201).json(await admin.createPosting(input));
  },
);

export const adminUpdatePostingController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminPostingUpsertSchema.parse(req.body);
    res.status(200).json(await admin.updatePosting(req.params.id ?? "", input));
  },
);

export const adminPublishPostingController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(await admin.setPostingActive(req.params.id ?? "", true));
  },
);

export const adminClosePostingController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(await admin.setPostingActive(req.params.id ?? "", false));
  },
);

export const adminDeletePostingController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await admin.deletePosting(req.params.id ?? ""));
  },
);

export const adminListApplicationsController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await admin.listApplications(req.params.id ?? ""));
  },
);

export const adminUpdateApplicationStatusController = asyncHandler(
  async (req: Request, res: Response) => {
    const { status } = updateApplicationStatusRequestSchema.parse(req.body);
    res
      .status(200)
      .json(
        await admin.updateApplicationStatus(req.params.appId ?? "", status),
      );
  },
);
