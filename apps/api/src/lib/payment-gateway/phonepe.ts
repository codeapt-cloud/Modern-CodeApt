/**
 * Real PhonePe (Standard Checkout, hosted PAY_PAGE) adapter.
 *
 * Signing (X-VERIFY): `SHA256(base64Payload + endpoint + saltKey) ### saltIndex`
 * for pay/status; for the callback PhonePe signs `SHA256(base64Response +
 * saltKey) ### saltIndex`. verifyCallback RE-COMPUTES the signature over the
 * raw `response` field and constant-time compares — a mismatch returns null and
 * NEVER grants anything.
 *
 * All credentials come from env; this adapter is only selected when
 * PAYMENT_GATEWAY=phonepe, and it fails fast if its config is incomplete.
 */
import { createHash, timingSafeEqual } from "node:crypto";

import { PaymentStatus } from "@codeapt/shared";

import { env } from "../../config/env.js";
import { logger } from "../logger.js";
import {
  PaymentGatewayError,
  type CreateOrderInput,
  type CreateOrderResult,
  type FetchStatusResult,
  type PaymentGateway,
  type VerifiedCallback,
} from "./types.js";

const PAY_ENDPOINT = "/pg/v1/pay";
const X_VERIFY_HEADER = "x-verify";

interface PhonePeConfig {
  baseUrl: string;
  merchantId: string;
  saltKey: string;
  saltIndex: string;
}

function requireConfig(): PhonePeConfig {
  const { PHONEPE_BASE_URL, PHONEPE_MERCHANT_ID, PHONEPE_SALT_KEY } = env;
  if (!PHONEPE_BASE_URL || !PHONEPE_MERCHANT_ID || !PHONEPE_SALT_KEY) {
    throw new PaymentGatewayError(
      "PhonePe gateway is not configured (need PHONEPE_BASE_URL, " +
        "PHONEPE_MERCHANT_ID, PHONEPE_SALT_KEY).",
    );
  }
  return {
    baseUrl: PHONEPE_BASE_URL.replace(/\/$/, ""),
    merchantId: PHONEPE_MERCHANT_ID,
    saltKey: PHONEPE_SALT_KEY,
    saltIndex: env.PHONEPE_SALT_INDEX,
  };
}

const sha256 = (input: string): string =>
  createHash("sha256").update(input).digest("hex");

/** `SHA256(payload + suffix + saltKey)###saltIndex`. */
function xVerify(payload: string, suffix: string, cfg: PhonePeConfig): string {
  return `${sha256(payload + suffix + cfg.saltKey)}###${cfg.saltIndex}`;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.PHONEPE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new PaymentGatewayError(`PhonePe responded HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    if (err instanceof PaymentGatewayError) throw err;
    throw new PaymentGatewayError("Could not reach PhonePe", err);
  } finally {
    clearTimeout(timer);
  }
}

/** Map PhonePe's `code` to our normalized terminal status. */
function normalizeCode(code: unknown): "success" | "failed" {
  return code === "PAYMENT_SUCCESS" ? "success" : "failed";
}

export function createPhonePeGateway(): PaymentGateway {
  return {
    name: "phonepe",

    async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
      const cfg = requireConfig();
      const payload = {
        merchantId: cfg.merchantId,
        merchantTransactionId: input.merchantOrderId,
        amount: input.amountPaise, // PhonePe amount is in paise
        redirectUrl: input.redirectUrl,
        redirectMode: "REDIRECT",
        callbackUrl: input.callbackUrl,
        paymentInstrument: { type: "PAY_PAGE" },
      };
      const base64 = Buffer.from(JSON.stringify(payload)).toString("base64");
      const body = await postJson(
        `${cfg.baseUrl}${PAY_ENDPOINT}`,
        { request: base64 },
        { [X_VERIFY_HEADER]: xVerify(base64, PAY_ENDPOINT, cfg) },
      );

      const url = (
        body as {
          data?: { instrumentResponse?: { redirectInfo?: { url?: string } } };
        }
      )?.data?.instrumentResponse?.redirectInfo?.url;
      if (typeof url !== "string" || !url) {
        throw new PaymentGatewayError("PhonePe did not return a redirect URL");
      }
      return { redirectUrl: url, gatewayOrderId: input.merchantOrderId };
    },

    verifyCallback(headers, rawBody): VerifiedCallback | null {
      const cfg = requireConfig();
      const provided = headers[X_VERIFY_HEADER];
      if (!provided) {
        logger.warn("PhonePe callback missing X-VERIFY");
        return null;
      }
      // PhonePe posts { response: "<base64 json>" }; it signs the base64 string.
      let responseB64: string;
      try {
        const outer = JSON.parse(rawBody) as { response?: unknown };
        if (typeof outer.response !== "string") return null;
        responseB64 = outer.response;
      } catch (err) {
        logger.warn({ err }, "PhonePe callback body not JSON");
        return null;
      }

      const expected = `${sha256(responseB64 + cfg.saltKey)}###${cfg.saltIndex}`;
      if (!safeEqual(provided, expected)) {
        logger.warn("PhonePe callback signature mismatch — rejecting");
        return null;
      }

      let decoded: {
        code?: unknown;
        data?: { merchantTransactionId?: unknown; transactionId?: unknown };
      };
      try {
        decoded = JSON.parse(
          Buffer.from(responseB64, "base64").toString("utf8"),
        ) as typeof decoded;
      } catch (err) {
        logger.warn({ err }, "PhonePe callback response not decodable");
        return null;
      }
      const merchantOrderId = decoded.data?.merchantTransactionId;
      if (typeof merchantOrderId !== "string" || !merchantOrderId) return null;

      return {
        merchantOrderId,
        status: normalizeCode(decoded.code),
        gatewayTxnId:
          typeof decoded.data?.transactionId === "string"
            ? decoded.data.transactionId
            : null,
      };
    },

    async fetchStatus(merchantOrderId): Promise<FetchStatusResult> {
      const cfg = requireConfig();
      const endpoint = `/pg/v1/status/${cfg.merchantId}/${merchantOrderId}`;
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        env.PHONEPE_TIMEOUT_MS,
      );
      try {
        const res = await fetch(`${cfg.baseUrl}${endpoint}`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            [X_VERIFY_HEADER]: xVerify("", endpoint, cfg),
            "X-MERCHANT-ID": cfg.merchantId,
          },
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new PaymentGatewayError(`PhonePe status HTTP ${res.status}`);
        }
        const body = (await res.json()) as {
          code?: unknown;
          data?: { transactionId?: unknown };
        };
        const status =
          normalizeCode(body.code) === "success"
            ? PaymentStatus.SUCCESS
            : PaymentStatus.FAILED;
        return {
          status,
          gatewayTxnId:
            typeof body.data?.transactionId === "string"
              ? body.data.transactionId
              : null,
        };
      } catch (err) {
        if (err instanceof PaymentGatewayError) throw err;
        throw new PaymentGatewayError("Could not reach PhonePe status", err);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
