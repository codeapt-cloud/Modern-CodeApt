/**
 * Global question-bank routes (super_admin only) — CRUD + categorized importer
 * for the shared Standard/Coding banks. Behind the platform-admin guard stack
 * (requireAuth + enforcePasswordChange + requireSuperAdmin). Literal sub-paths
 * (/import, /template) are registered BEFORE the `/:id` param routes.
 */
import { Router } from "express";

import {
  createGlobalBankController,
  deleteGlobalBankController,
  globalBankTemplateController,
  importGlobalBankController,
  listGlobalBankController,
  updateGlobalBankController,
} from "../controllers/question-bank-admin.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireSuperAdmin } from "../middleware/require-role.js";

export const questionBankAdminRouter: Router = Router();

const superAdmin = [requireAuth, enforcePasswordChange, requireSuperAdmin];

questionBankAdminRouter.get(
  "/admin/question-banks/template",
  ...superAdmin,
  globalBankTemplateController,
);
questionBankAdminRouter.post(
  "/admin/question-banks/import",
  ...superAdmin,
  importGlobalBankController,
);
questionBankAdminRouter.get(
  "/admin/question-banks",
  ...superAdmin,
  listGlobalBankController,
);
questionBankAdminRouter.post(
  "/admin/question-banks",
  ...superAdmin,
  createGlobalBankController,
);
questionBankAdminRouter.patch(
  "/admin/question-banks/:id",
  ...superAdmin,
  updateGlobalBankController,
);
questionBankAdminRouter.delete(
  "/admin/question-banks/:id",
  ...superAdmin,
  deleteGlobalBankController,
);
