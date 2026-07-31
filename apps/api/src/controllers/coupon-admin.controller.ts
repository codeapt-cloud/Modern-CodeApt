/**
 * Coupon ADMIN controllers (requireAdmin at the route). Validate with the
 * shared zod schema and delegate to the coupon-admin service.
 */
import { adminCouponUpsertSchema } from "@codeapt/shared";
import type { Request, Response } from "express";
import { z } from "zod";

import { asyncHandler } from "../lib/async-handler.js";
import * as admin from "../services/coupon-admin.service.js";

const activeSchema = z.object({ active: z.boolean() });

export const adminListCouponsController = asyncHandler(
  async (_req: Request, res: Response) => {
    res.status(200).json(await admin.listCouponsAdmin());
  },
);

export const adminGetCouponController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await admin.getCouponAdmin(req.params.couponId ?? ""));
  },
);

export const adminCreateCouponController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminCouponUpsertSchema.parse(req.body);
    res.status(201).json(await admin.createCoupon(input));
  },
);

export const adminUpdateCouponController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminCouponUpsertSchema.parse(req.body);
    res
      .status(200)
      .json(await admin.updateCoupon(req.params.couponId ?? "", input));
  },
);

export const adminSetCouponActiveController = asyncHandler(
  async (req: Request, res: Response) => {
    const { active } = activeSchema.parse(req.body);
    res
      .status(200)
      .json(await admin.setCouponActive(req.params.couponId ?? "", active));
  },
);

export const adminDeleteCouponController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await admin.deleteCoupon(req.params.couponId ?? ""));
  },
);
