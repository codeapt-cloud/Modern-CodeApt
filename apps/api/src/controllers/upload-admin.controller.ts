/**
 * Signed-upload controller (requireAdmin at the route). Returns a Cloudinary
 * upload signature; the api_secret is used only to compute it and is never in
 * the response.
 */
import type { Request, Response } from "express";

import { asyncHandler } from "../lib/async-handler.js";
import * as uploads from "../services/upload-admin.service.js";

export const adminCreateUploadSignatureController = asyncHandler(
  async (_req: Request, res: Response) => {
    res.status(200).json(uploads.createUploadSignature());
  },
);
