/**
 * Super-admin LLM-gateway routes (/admin/ai-providers) — platform-level, behind
 * requireAuth + enforcePasswordChange + requireSuperAdmin. Manage providers +
 * (encrypted) keys and read live monitoring. The live key-probe is additionally
 * rate-limited (it hits an external provider). Literal `/:id/key` + `/:id/test`
 * sub-paths are fine alongside the `/:id` PATCH (distinct methods/paths).
 */
import { Router } from "express";

import {
  aiProviderUsageTrendsController,
  deleteAiProviderKeyController,
  getAiGovernorController,
  listAiProvidersController,
  patchAiProviderController,
  setAiGovernorController,
  setAiProviderKeyController,
  testAiProviderKeyController,
} from "../controllers/ai-provider-admin.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { aiProviderTestRateLimiter } from "../middleware/rate-limit.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireSuperAdmin } from "../middleware/require-role.js";

export const aiProviderAdminRouter: Router = Router();

const superAdmin = [requireAuth, enforcePasswordChange, requireSuperAdmin];

aiProviderAdminRouter.get(
  "/admin/ai-providers",
  ...superAdmin,
  listAiProvidersController,
);
// Literal sub-path (distinct from any `/:id`) — usage-trend rollups for the charts.
aiProviderAdminRouter.get(
  "/admin/ai-providers/usage-trends",
  ...superAdmin,
  aiProviderUsageTrendsController,
);
// Stage-2 GLOBAL POOL GOVERNOR — config + live status (headroom, shedding, queue).
aiProviderAdminRouter.get(
  "/admin/ai-governor",
  ...superAdmin,
  getAiGovernorController,
);
aiProviderAdminRouter.put(
  "/admin/ai-governor",
  ...superAdmin,
  setAiGovernorController,
);
aiProviderAdminRouter.patch(
  "/admin/ai-providers/:id",
  ...superAdmin,
  patchAiProviderController,
);
aiProviderAdminRouter.put(
  "/admin/ai-providers/:id/key",
  ...superAdmin,
  setAiProviderKeyController,
);
aiProviderAdminRouter.delete(
  "/admin/ai-providers/:id/key",
  ...superAdmin,
  deleteAiProviderKeyController,
);
aiProviderAdminRouter.post(
  "/admin/ai-providers/:id/test",
  ...superAdmin,
  aiProviderTestRateLimiter,
  testAiProviderKeyController,
);
