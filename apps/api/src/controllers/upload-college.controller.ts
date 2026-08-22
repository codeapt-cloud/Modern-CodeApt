/**
 * Tenant-scoped signed-upload controller for college authoring surfaces
 * (exam-question images today; career-posting logos and — since resource_type
 * is chosen client-side, never signed — future Communication audio). Returns
 * the SAME Cloudinary signature as the platform-admin surface: the signer is
 * tenant-agnostic (it signs only folder + timestamp), so the only difference is
 * the route guard — a college_admin/faculty reaches it without the platform
 * `requireAdmin` gate. Cross-tenant is blocked upstream by resolveTenant.
 */
import type { Request, Response } from "express";

import { asyncHandler } from "../lib/async-handler.js";
import * as uploads from "../services/upload-admin.service.js";

export const collegeCreateUploadSignatureController = asyncHandler(
  async (_req: Request, res: Response) => {
    res.status(200).json(uploads.createUploadSignature());
  },
);
