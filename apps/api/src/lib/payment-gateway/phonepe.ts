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
  type CallbackVerification,
  type CreateOrderInput,
  type CreateOrderResult,
  type FetchStatusResult,
  type PaymentGateway,
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

/**
 * Map a PhonePe order/callback state to our PaymentStatus. Standard Checkout
 * reports these; we map only genuinely TERMINAL states to success/failed and
 * treat everything else — including in-progress states and anything we don't
 * recognise — as PENDING:
 *
 *   COMPLETED / SUCCESS / PAYMENT_SUCCESS               → success  (terminal win)
 *   FAILED / PAYMENT_ERROR / PAYMENT_DECLINED /
 *     PAYMENT_CANCELLED / EXPIRED / TIMED_OUT / REVERSED → failed  (terminal loss)
 *   PENDING / PAYMENT_PENDING / <in-progress>           → pending  (keep waiting)
 *   unknown / missing state                             → pending  (FAIL-OPEN)
 *
 * The fail-open default is deliberate: reconcile-on-read (payment.service) fires
 * on every poll while the buyer is bouncing back from checkout, and UPI collect
 * routinely sits PENDING for a while. Collapsing a not-yet-final state to FAILED
 * would terminalise the order and make the later success webhook a silent no-op
 * (money taken, no enrollment). An unknown state must NEVER destroy a payment —
 * leaving it PENDING keeps the signed webhook as the source of truth.
 */
function mapPhonePeState(state: string | undefined): PaymentStatus {
  switch ((state ?? "").toUpperCase()) {
    case "COMPLETED":
    case "SUCCESS":
    case "PAYMENT_SUCCESS":
      return PaymentStatus.SUCCESS;
    case "FAILED":
    case "PAYMENT_ERROR":
    case "PAYMENT_DECLINED":
    case "PAYMENT_CANCELLED":
    case "EXPIRED":
    case "TIMED_OUT":
    case "REVERSED":
      return PaymentStatus.FAILED;
    default:
      return PaymentStatus.PENDING;
  }
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

    verifyCallback(headers, rawBody): CallbackVerification {
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

        // A NON-terminal (pending / unrecognised) but VALID webhook is
        // acknowledged and IGNORED — return "ignore", NOT null. `null` means a
        // bad signature (→ 4xx reject); "ignore" means a genuine webhook we
        // simply can't act on yet (→ 2xx ack, no state write), so the order
        // stays non-terminal for a later terminal webhook and PhonePe does not
        // treat delivery as failed and retry/disable the endpoint. Collapsing
        // pending→failed here would terminalise the order and drop a subsequent
        // success (the money-loss bug, on the webhook path).
        const mapped = mapPhonePeState(payload.state);
        if (mapped === PaymentStatus.PENDING) {
          // Reached ONLY after validateCallback succeeded — the signature is
          // verified, so this is a genuine webhook, never a forgery. Distinguish
          // a recognised pending state (normal) from an UNRECOGNISED one (log
          // loudly so a broken integration doesn't hide as healthy pending
          // traffic). Both are acknowledged + ignored (no state write).
          const state = (payload.state ?? "").toUpperCase();
          const knownPending = state === "PENDING" || state === "PAYMENT_PENDING";
          if (knownPending) {
            logger.info(
              { merchantOrderId: payload.merchantOrderId, state: payload.state },
              "PhonePe callback verified but pending — acknowledging, no state change",
            );
          } else {
            logger.warn(
              { merchantOrderId: payload.merchantOrderId, state: payload.state },
              "PhonePe callback verified with an UNRECOGNISED state — acknowledging as pending (no state change); verify the state mapping",
            );
          }
          return "ignore";
        }
        return {
          merchantOrderId: payload.merchantOrderId,
          status: mapped === PaymentStatus.SUCCESS ? "success" : "failed",
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

        // Full 3-way mapping — a still-pending order stays PENDING so
        // reconcile-on-read leaves it non-terminal for the webhook to finish.
        const status = mapPhonePeState(response.state);

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
