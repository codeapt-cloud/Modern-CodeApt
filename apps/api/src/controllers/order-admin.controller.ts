/**
 * Order-admin controllers (requireAdmin at the route). Read-only: validate the
 * list query with the shared zod schema and delegate to the order-admin service.
 */
import { adminOrderListQuerySchema } from "@codeapt/shared";
import type { Request, Response } from "express";

import { asyncHandler } from "../lib/async-handler.js";
import * as admin from "../services/order-admin.service.js";

export const adminListOrdersController = asyncHandler(
  async (req: Request, res: Response) => {
    const query = adminOrderListQuerySchema.parse(req.query);
    res.status(200).json(await admin.listOrdersAdmin(query));
  },
);

export const adminGetOrderController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(await admin.getOrderDetailAdmin(req.params.orderId ?? ""));
  },
);
