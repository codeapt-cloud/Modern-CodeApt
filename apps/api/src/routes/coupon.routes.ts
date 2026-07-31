/**
 * Coupon admin routes — CRUD + a one-click active toggle, all behind the admin
 * guard stack (requireAuth + enforcePasswordChange + requireAdmin). Static paths
 * before parameterized ones (none collide here, but kept consistent).
 */
import { Router } from "express";

import {
  adminCreateCouponController,
  adminDeleteCouponController,
  adminGetCouponController,
  adminListCouponsController,
  adminSetCouponActiveController,
  adminUpdateCouponController,
} from "../controllers/coupon-admin.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { requireAdmin } from "../middleware/require-role.js";
import { requireAuth } from "../middleware/require-auth.js";

export const couponRouter: Router = Router();

const admin = [requireAuth, enforcePasswordChange, requireAdmin];

couponRouter.get("/admin/coupons", ...admin, adminListCouponsController);
couponRouter.post("/admin/coupons", ...admin, adminCreateCouponController);
couponRouter.get(
  "/admin/coupons/:couponId",
  ...admin,
  adminGetCouponController,
);
couponRouter.patch(
  "/admin/coupons/:couponId",
  ...admin,
  adminUpdateCouponController,
);
couponRouter.post(
  "/admin/coupons/:couponId/active",
  ...admin,
  adminSetCouponActiveController,
);
couponRouter.delete(
  "/admin/coupons/:couponId",
  ...admin,
  adminDeleteCouponController,
);
