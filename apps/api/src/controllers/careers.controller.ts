/**
 * Careers controllers (student surface) — validate with shared zod schemas,
 * resolve the caller, delegate to the service.
 */
import {
  AuthErrorCode,
  applyRequestSchema,
  postingListQuerySchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import * as careers from "../services/careers.service.js";

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

export const listPostingsController = asyncHandler(
  async (req: Request, res: Response) => {
    const query = postingListQuerySchema.parse(req.query);
    res.status(200).json(await careers.listPostings(query));
  },
);

export const getPostingController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await careers.getPosting(
      requireUserId(req),
      req.params.id ?? "",
    );
    res.status(200).json(data);
  },
);

export const applyController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = applyRequestSchema.parse(req.body);
    const data = await careers.applyToPosting(
      requireUserId(req),
      req.params.id ?? "",
      input,
    );
    res.status(201).json(data);
  },
);

export const myApplicationsController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await careers.getMyApplications(requireUserId(req)));
  },
);
