/**
 * Payment routes.
 *  - quote / orders / status / list: authenticated (the buyer).
 *  - callback: NO auth — gateway-facing webhook, verified by signature.
 *  - mock/pay: authenticated + mock-only (guarded in the service).
 */
import { Router } from "express";

import {
  callbackController,
  createOrderController,
  getOrderController,
  listOrdersController,
  mockPayController,
  quoteController,
} from "../controllers/payment.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { paymentOrderRateLimiter } from "../middleware/rate-limit.js";
import { requireAuth } from "../middleware/require-auth.js";

export const paymentRouter: Router = Router();

const authed = [requireAuth, enforcePasswordChange];

// Gateway webhook — no auth; signature-verified over the raw body.
paymentRouter.post("/payments/callback", callbackController);

paymentRouter.post("/payments/quote", ...authed, quoteController);
paymentRouter.post(
  "/payments/orders",
  ...authed,
  paymentOrderRateLimiter,
  createOrderController,
);
paymentRouter.get("/payments/orders", ...authed, listOrdersController);
paymentRouter.get("/payments/orders/:orderId", ...authed, getOrderController);

// Mock-only affordance to drive a verified callback (dev/tests + Part 2).
paymentRouter.post("/payments/mock/pay", ...authed, mockPayController);
