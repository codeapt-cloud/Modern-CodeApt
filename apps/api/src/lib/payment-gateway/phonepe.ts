/**
 * Real PhonePe (Standard Checkout, hosted PAY_PAGE) adapter.
 *
 * Uses the official `pg-sdk-node` v2.
 * Webhook validation uses `validateCallback` with configured username/password
 * rather than the legacy X-VERIFY salt/hash mechanism.
 *
 * All credentials come from env; this adapter is only selected when
 * PAYMENT_GATEWAY=phonepe, and it fails fast if its config is incomplete.
 */

import { Env, StandardCheckoutClient } from "pg-sdk-node";
import { StandardCheckoutPayRequest } from "pg-sdk-node/dist/payments/v2/models/request/StandardCheckoutPayRequest.js";

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

interface PhonePeConfig {
  clientId: string;
  clientSecret: string;
  clientVersion: number;
  environment: Env;
  webhookUsername?: string;
  webhookPassword?: string;
}

function requireConfig(): PhonePeConfig {
  const {
    PHONEPE_CLIENT_ID,
    PHONEPE_CLIENT_SECRET,
    PHONEPE_CLIENT_VERSION,
    PHONEPE_ENV,
    PHONEPE_WEBHOOK_USERNAME,
    PHONEPE_WEBHOOK_PASSWORD,
  } = env;

  if (!PHONEPE_CLIENT_ID || !PHONEPE_CLIENT_SECRET || !PHONEPE_ENV) {
    throw new PaymentGatewayError(
      "PhonePe gateway is not configured (need PHONEPE_CLIENT_ID, PHONEPE_CLIENT_SECRET, PHONEPE_ENV).",
    );
  }

  // Fail fast if missing webhook creds, as we can't safely grant enrollment without them
  if (!PHONEPE_WEBHOOK_USERNAME || !PHONEPE_WEBHOOK_PASSWORD) {
    throw new PaymentGatewayError(
      "PhonePe webhook credentials are not configured (need PHONEPE_WEBHOOK_USERNAME, PHONEPE_WEBHOOK_PASSWORD).",
    );
  }

  return {
    clientId: PHONEPE_CLIENT_ID,
    clientSecret: PHONEPE_CLIENT_SECRET,
    clientVersion: PHONEPE_CLIENT_VERSION ?? 1,
    environment: PHONEPE_ENV === "PRODUCTION" ? Env.PRODUCTION : Env.SANDBOX,
    webhookUsername: PHONEPE_WEBHOOK_USERNAME,
    webhookPassword: PHONEPE_WEBHOOK_PASSWORD,
  };
}

let pgClient: StandardCheckoutClient | null = null;

function getClient(cfg: PhonePeConfig): StandardCheckoutClient {
  if (!pgClient) {
    pgClient = StandardCheckoutClient.getInstance(
      cfg.clientId,
      cfg.clientSecret,
      cfg.clientVersion,
      cfg.environment,
    );
  }
  return pgClient;
}

/** Map PhonePe's state to our normalized terminal status. */
function normalizeState(state: string | undefined): "success" | "failed" {
  if (!state) return "failed";
  const upper = state.toUpperCase();
  return upper === "COMPLETED" || upper === "SUCCESS" || upper === "PAYMENT_SUCCESS"
    ? "success"
    : "failed";
}

export function createPhonePeGateway(): PaymentGateway {
  // Validate config on instantiation to fail fast
  const cfg = requireConfig();
  const client = getClient(cfg);

  return {
    name: "phonepe",

    async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
      try {
        // NOTE: The modern SDK doesn't take callbackUrl dynamically in the pay request.
        // It must be statically configured in the PhonePe merchant dashboard.
        const request = StandardCheckoutPayRequest.builder()
          .merchantOrderId(input.merchantOrderId)
          .amount(input.amountPaise)
          .redirectUrl(input.redirectUrl)
          .build();

        const response = await client.pay(request);

        if (!response.redirectUrl) {
          throw new PaymentGatewayError("PhonePe did not return a redirect URL");
        }
        return {
          redirectUrl: response.redirectUrl,
          gatewayOrderId: input.merchantOrderId, // standard checkout uses merchantOrderId
        };
      } catch (err) {
        if (err instanceof PaymentGatewayError) throw err;
        throw new PaymentGatewayError("Could not reach PhonePe", err);
      }
    },

    verifyCallback(headers, rawBody): VerifiedCallback | null {
      const authorization = headers["authorization"] || headers["Authorization"];
      if (!authorization) {
        logger.warn("PhonePe callback missing Authorization header");
        return null;
      }

      try {
        const response = client.validateCallback(
          cfg.webhookUsername!,
          cfg.webhookPassword!,
          authorization,
          rawBody,
        );

        const { payload } = response;
        if (!payload || !payload.merchantOrderId) {
          logger.warn("PhonePe callback payload missing merchantOrderId");
          return null;
        }

        // We assume we want the first transactionId from paymentDetails if available
        let gatewayTxnId = null;
        if (payload.paymentDetails && payload.paymentDetails.length > 0) {
          gatewayTxnId = payload.paymentDetails[0]?.transactionId;
        }

        return {
          merchantOrderId: payload.merchantOrderId,
          status: normalizeState(payload.state),
          gatewayTxnId: gatewayTxnId || null,
        };
      } catch (err) {
        logger.warn({ err }, "PhonePe callback signature mismatch or invalid body — rejecting");
        return null;
      }
    },

    async fetchStatus(merchantOrderId): Promise<FetchStatusResult> {
      try {
        const response = await client.getOrderStatus(merchantOrderId);

        const status =
          normalizeState(response.state) === "success"
            ? PaymentStatus.SUCCESS
            : PaymentStatus.FAILED;

        let gatewayTxnId = null;
        if (response.paymentDetails && response.paymentDetails.length > 0) {
          gatewayTxnId = response.paymentDetails[0]?.transactionId;
        }

        return {
          status,
          gatewayTxnId: gatewayTxnId || null,
        };
      } catch (err) {
        throw new PaymentGatewayError("Could not reach PhonePe status", err);
      }
    },
  };
}
