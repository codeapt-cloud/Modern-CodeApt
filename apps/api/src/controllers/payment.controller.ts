/**
 * Payment controllers — validate with shared zod schemas, resolve the caller,
 * delegate to the service. The webhook is intentionally auth-free (gateway-
 * facing) and reads the RAW body captured in app.ts for signature verification.
 */
import {
  AuthErrorCode,
  createOrderRequestSchema,
  mockPayRequestSchema,
  quoteRequestSchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import * as payments from "../services/payment.service.js";

function requireUserId(req: Request): string {
  if (!req.auth) {
    throw new AppError(
      "Authentication required",
      401,
      AuthErrorCode.UNAUTHENTICATED,
    );
  }
  return req.auth.userId;
}

/** Flatten Express headers to a plain string map for the gateway verifier. */
function flatHeaders(req: Request): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    out[key] = Array.isArray(value) ? value[0] : value;
  }
  return out;
}

export const quoteController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = quoteRequestSchema.parse(req.body);
    const data = await payments.quote(requireUserId(req), input);
    res.status(200).json(data);
  },
);

export const createOrderController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = createOrderRequestSchema.parse(req.body);
    const data = await payments.createOrder(requireUserId(req), input);
    res.status(201).json(data);
  },
);

/**
 * Gateway webhook — no auth. Verifies the signature over the raw body; an
 * unverified callback is rejected (400) and grants nothing.
 */
export const callbackController = asyncHandler(
  async (req: Request, res: Response) => {
    const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});
    const result = await payments.handleCallback(flatHeaders(req), rawBody);
    if (!result.ok) {
      res
        .status(400)
        .json({ error: { message: "Invalid callback signature" } });
      return;
    }
    res.status(200).json({ ok: true, status: result.status });
  },
);

export const getOrderController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await payments.getOrder(
      requireUserId(req),
      req.params.orderId ?? "",
    );
    res.status(200).json(data);
  },
);

export const listOrdersController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await payments.listOrders(requireUserId(req));
    res.status(200).json(data);
  },
);

/** Mock-only: drive a verified success/failure callback (guarded in service). */
export const mockPayController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = mockPayRequestSchema.parse(req.body);
    const data = await payments.mockPay(requireUserId(req), input);
    res.status(200).json(data);
  },
);
