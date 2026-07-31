/**
 * Signed-upload routes (image storage) — behind the admin guard stack
 * (requireAuth + enforcePasswordChange + requireAdmin). Only issues a signature;
 * the actual upload goes browser → Cloudinary, never through this API.
 */
import { Router } from "express";

import { adminCreateUploadSignatureController } from "../controllers/upload-admin.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { requireAdmin } from "../middleware/require-role.js";
import { requireAuth } from "../middleware/require-auth.js";

export const uploadAdminRouter: Router = Router();

const admin = [requireAuth, enforcePasswordChange, requireAdmin];

uploadAdminRouter.post(
  "/admin/uploads/signature",
  ...admin,
  adminCreateUploadSignatureController,
);
