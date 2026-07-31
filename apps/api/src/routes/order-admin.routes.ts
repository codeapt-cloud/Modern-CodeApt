/**
 * Order-admin routes (ledger read — CRUD batch 3a) — read/reporting, behind the
 * admin guard stack (requireAuth + enforcePasswordChange + requireAdmin). No
 * write verbs: the order lifecycle is owned by the verified payment flow.
 */
import { Router } from "express";

import {
  adminGetOrderController,
  adminListOrdersController,
} from "../controllers/order-admin.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { requireAdmin } from "../middleware/require-role.js";
import { requireAuth } from "../middleware/require-auth.js";

export const orderAdminRouter: Router = Router();

const admin = [requireAuth, enforcePasswordChange, requireAdmin];

orderAdminRouter.get("/admin/orders", ...admin, adminListOrdersController);
orderAdminRouter.get(
  "/admin/orders/:orderId",
  ...admin,
  adminGetOrderController,
);
