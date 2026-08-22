/**
 * Payment gateway abstraction. The service talks ONLY to this interface; the
 * concrete adapter (real PhonePe or the offline mock) is chosen by
 * `PAYMENT_GATEWAY`. Money is integer paise throughout.
 */
import type { PaymentStatus } from "@codeapt/shared";

export interface CreateOrderInput {
  /** Our internal order id — the gateway's merchantOrderId. */
  merchantOrderId: string;
  amountPaise: number;
  /** Where the user returns after the hosted checkout. */
  redirectUrl: string;
  /** Server-to-server webhook URL the gateway posts the result to. */
  callbackUrl: string;
  /** Shown on the hosted checkout (best-effort; not all gateways use it). */
  subjectName?: string;
}

export interface CreateOrderResult {
  /** URL the client redirects to in order to pay. */
  redirectUrl: string;
  /** Gateway-side order/txn handle, when the create call returns one. */
  gatewayOrderId?: string;
}

/**
 * A callback/webhook that VERIFIED (signature checked) AND carries a TERMINAL
 * outcome. `status` is normalized to success | failed.
 */
export interface VerifiedCallback {
  merchantOrderId: string;
  status: Extract<PaymentStatus, "success" | "failed">;
  gatewayTxnId: string | null;
}

/**
 * `verifyCallback` outcome — three distinct cases the caller MUST tell apart:
 *   - a `VerifiedCallback` → verified + terminal; apply it.
 *   - `"ignore"`           → verified but NON-terminal (e.g. PhonePe PENDING).
 *                            Acknowledge it (2xx), write NOTHING, and wait for a
 *                            later terminal webhook. Collapsing this to a failure
 *                            would terminalise the order and lose the payment;
 *                            rejecting it (4xx) would look like a delivery failure
 *                            and make the gateway retry/disable the webhook.
 *   - `null`               → signature did NOT verify. Reject (4xx). Never trust.
 */
export type CallbackVerification = VerifiedCallback | "ignore" | null;

export interface FetchStatusResult {
  status: PaymentStatus;
  gatewayTxnId: string | null;
}

export interface PaymentGateway {
  readonly name: "mock" | "phonepe";
  createOrder(input: CreateOrderInput): Promise<CreateOrderResult>;
  /**
   * Verify a raw callback body against its signature header(s). See
   * `CallbackVerification` for the three outcomes (terminal / ignore / reject).
   */
  verifyCallback(
    headers: Record<string, string | undefined>,
    rawBody: string,
  ): CallbackVerification;
  /** Server-authoritative status lookup (used to reconcile a pending order). */
  fetchStatus(merchantOrderId: string): Promise<FetchStatusResult>;
}

/** Raised for gateway transport/config failures (mapped to a 502 GATEWAY_ERROR). */
export class PaymentGatewayError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "PaymentGatewayError";
  }
}
