/**
 * Essay-topic (prompt) admin routes — CRUD + an active toggle, behind the admin
 * guard stack (requireAuth + enforcePasswordChange + requireAdmin).
 */
import { Router } from "express";

import {
  adminCreateEssayTopicController,
  adminDeleteEssayTopicController,
  adminGenerateKeywordsController,
  adminGetEssayTopicController,
  adminListEssayTopicsController,
  adminSetEssayTopicActiveController,
  adminUpdateEssayTopicController,
} from "../controllers/essay-topic-admin.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { requireAdmin } from "../middleware/require-role.js";
import { requireAuth } from "../middleware/require-auth.js";

export const essayTopicRouter: Router = Router();

const admin = [requireAuth, enforcePasswordChange, requireAdmin];

essayTopicRouter.get("/admin/essay-topics", ...admin, adminListEssayTopicsController);
essayTopicRouter.post("/admin/essay-topics", ...admin, adminCreateEssayTopicController);
// Keyword generation (bodied; works for unsaved topics). Literal path — declared
// before "/:essayTopicId" routes so it is never captured as an id.
essayTopicRouter.post(
  "/admin/essay-topics/generate-keywords",
  ...admin,
  adminGenerateKeywordsController,
);
essayTopicRouter.get(
  "/admin/essay-topics/:essayTopicId",
  ...admin,
  adminGetEssayTopicController,
);
essayTopicRouter.patch(
  "/admin/essay-topics/:essayTopicId",
  ...admin,
  adminUpdateEssayTopicController,
);
essayTopicRouter.post(
  "/admin/essay-topics/:essayTopicId/active",
  ...admin,
  adminSetEssayTopicActiveController,
);
essayTopicRouter.delete(
  "/admin/essay-topics/:essayTopicId",
  ...admin,
  adminDeleteEssayTopicController,
);
