/**
 * Platform settings routes (Step 32) — super-admin, deploy-free config. GET reads
 * the singleton (creating it with safe defaults on first read); PATCH updates it.
 * Behind requireAdmin, like the other /admin surfaces.
 */
import { platformSettingsUpdateSchema } from "@codeapt/shared";
import { Router } from "express";

import { asyncHandler } from "../lib/async-handler.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { requireAdmin } from "../middleware/require-role.js";
import { requireAuth } from "../middleware/require-auth.js";
import {
  getPlatformSettings,
  updatePlatformSettings,
} from "../services/platform-settings.service.js";

export const platformSettingsRouter: Router = Router();
const adminGuard = [requireAuth, enforcePasswordChange, requireAdmin];

platformSettingsRouter.get(
  "/admin/platform-settings",
  ...adminGuard,
  asyncHandler(async (_req, res) => {
    res.status(200).json(await getPlatformSettings());
  }),
);

platformSettingsRouter.patch(
  "/admin/platform-settings",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    const input = platformSettingsUpdateSchema.parse(req.body);
    res.status(200).json(await updatePlatformSettings(input));
  }),
);
