/**
 * Admin Assistant routes (Step 40: read-only GUIDE). Chat only — the proposal
 * approve/reject endpoints were DELETED along with every write path.
 *   College entrypoint — /c/:collegeSlug/assistant/chat behind the tenant stack +
 *   the AI feature + the `admin_assistant` sub-capability + requireCollegeAdmin.
 *   Platform entrypoint — /admin/assistant/chat for super admins (no tenant).
 */
import { CollegeFeature } from "@codeapt/shared";
import { Router } from "express";

import {
  collegeAssistantChatController,
  platformAssistantChatController,
} from "../controllers/admin-assistant.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireFeature } from "../middleware/require-entitlement.js";
import { requireCollegeAdmin, requireSuperAdmin } from "../middleware/require-role.js";
import { resolveTenant } from "../middleware/resolve-tenant.js";

export const adminAssistantRouter: Router = Router();

const college = [
  requireAuth,
  enforcePasswordChange,
  resolveTenant,
  requireFeature(CollegeFeature.AI, "admin_assistant"),
  requireCollegeAdmin,
];
adminAssistantRouter.post(
  "/c/:collegeSlug/assistant/chat",
  ...college,
  collegeAssistantChatController,
);

const platform = [requireAuth, enforcePasswordChange, requireSuperAdmin];
adminAssistantRouter.post(
  "/admin/assistant/chat",
  ...platform,
  platformAssistantChatController,
);
