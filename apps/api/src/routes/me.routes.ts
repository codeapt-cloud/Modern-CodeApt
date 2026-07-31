import { Router } from "express";

import {
  getMeController,
  getMyCollegeController,
  updateMeController,
} from "../controllers/me.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { requireAuth } from "../middleware/require-auth.js";

export const meRouter: Router = Router();

// Guards are attached PER ROUTE (not via router.use) so this router never
// intercepts requests for paths it doesn't define — important now that public
// routers are mounted alongside it.
const authed = [requireAuth, enforcePasswordChange];

meRouter.get("/me", ...authed, getMeController);
// The caller's own college membership — how a college user routes into their
// /c/:slug space. Returns { college: null } for individual users.
meRouter.get("/me/college", ...authed, getMyCollegeController);
meRouter.patch("/me", ...authed, updateMeController);
