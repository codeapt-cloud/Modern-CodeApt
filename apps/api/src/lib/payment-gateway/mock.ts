/**
 * Mock payment gateway — deterministic, no network. Exercises the FULL
 * order → callback → enrollment lifecycle offline.
 *
 * createOrder returns a local mock-pay redirect URL. Callbacks are signed with
 * an HMAC-SHA256 over the raw body using PAYMENT_MOCK_SALT; verifyCallback
 * re-computes and constant-time compares (rejecting tampered bodies), exactly
 * mirroring how the real PhonePe adapter checks X-VERIFY. `buildSignedCallback`
 * lets the mock-only dev route (and tests) produce a valid callback to drive
 * success AND failure without a real gateway.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { PaymentStatus } from "@codeapt/shared";

import { env } from "../../config/env.js";
import { logger } from "../logger.js";
import type {
  CreateOrderInput,
  CreateOrderResult,
  FetchStatusResult,
  PaymentGateway,
  VerifiedCallback,
} from "./types.js";

export const MOCK_SIGNATURE_HEADER = "x-mock-signature";

interface MockCallbackBody {
  merchantOrderId: string;
  status: "success" | "failed";
  gatewayTxnId: string;
}

function sign(rawBody: string): string {
  return createHmac("sha256", env.PAYMENT_MOCK_SALT)
    .update(rawBody)
    .digest("hex");
}

/** Constant-time hex-string comparison (length-safe). */
function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Build a validly-signed mock callback for a given order + outcome. Used by the
 * mock-only dev route and by tests to drive the webhook end-to-end.
 */
export function buildSignedCallback(
  merchantOrderId: string,
  outcome: "success" | "failure",
): { headers: Record<string, string>; rawBody: string } {
  const body: MockCallbackBody = {
    merchantOrderId,
    status: outcome === "success" ? "success" : "failed",
    gatewayTxnId: `MOCKTXN-${merchantOrderId}`,
  };
  const rawBody = JSON.stringify(body);
  return {
    headers: { [MOCK_SIGNATURE_HEADER]: sign(rawBody) },
    rawBody,
  };
}

export function createMockGateway(): PaymentGateway {
  return {
    name: "mock",

    async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
      // A local hosted-checkout stand-in the client can open; the real payment
      // is simulated via the mock-pay dev route which posts a signed callback.
      const url = new URL(env.PAYMENT_REDIRECT_URL);
      url.searchParams.set("orderId", input.merchantOrderId);
      url.searchParams.set("mock", "1");
      return {
        redirectUrl: url.toString(),
        gatewayOrderId: input.merchantOrderId,
      };
    },

    verifyCallback(headers, rawBody): VerifiedCallback | null {
      const provided = headers[MOCK_SIGNATURE_HEADER];
      if (!provided) {
        logger.warn("mock callback missing signature header");
        return null;
      }
      const expected = sign(rawBody);
      if (!safeEqualHex(provided, expected)) {
        logger.warn("mock callback signature mismatch — rejecting");
        return null;
      }
      let parsed: MockCallbackBody;
      try {
        parsed = JSON.parse(rawBody) as MockCallbackBody;
      } catch (err) {
        logger.warn({ err }, "mock callback body not JSON");
        return null;
      }
      if (
        !parsed.merchantOrderId ||
        (parsed.status !== "success" && parsed.status !== "failed")
      ) {
        return null;
      }
      return {
        merchantOrderId: parsed.merchantOrderId,
        status: parsed.status,
        gatewayTxnId: parsed.gatewayTxnId ?? null,
      };
    },

    // The mock has no server-side state, so a status lookup cannot resolve a
    // pending order — the (signed) webhook is the source of truth in mock mode.
    async fetchStatus(): Promise<FetchStatusResult> {
      return { status: PaymentStatus.PENDING, gatewayTxnId: null };
    },
  };
}
