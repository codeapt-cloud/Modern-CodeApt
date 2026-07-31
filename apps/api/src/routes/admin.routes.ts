import { Router } from "express";

import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { requireAdmin } from "../middleware/require-role.js";
import { requireAuth } from "../middleware/require-auth.js";

/**
 * Admin-only surface. Real admin features (bulk tooling, exports) arrive in
 * later steps; for now a single ping proves the role guard end-to-end.
 */
export const adminRouter: Router = Router();

// Per-route guards (not router.use) so this router doesn't 401 unrelated,
// unmatched paths that flow through it.
adminRouter.get(
  "/admin/ping",
  requireAuth,
  enforcePasswordChange,
  requireAdmin,
  (_req, res) => {
    res.status(200).json({ ok: true, message: "admin access granted" });
  },
);
