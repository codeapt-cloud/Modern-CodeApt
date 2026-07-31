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
 * A callback/webhook that VERIFIED (signature checked). `status` is normalized
 * to a terminal payment status (success | failed). A null return from
 * `verifyCallback` means the signature did not verify — never trust it.
 */
export interface VerifiedCallback {
  merchantOrderId: string;
  status: Extract<PaymentStatus, "success" | "failed">;
  gatewayTxnId: string | null;
}

export interface FetchStatusResult {
  status: PaymentStatus;
  gatewayTxnId: string | null;
}

export interface PaymentGateway {
  readonly name: "mock" | "phonepe";
  createOrder(input: CreateOrderInput): Promise<CreateOrderResult>;
  /**
   * Verify a raw callback body against its signature header(s). Returns the
   * normalized result on success, or null when the signature does not verify.
   */
  verifyCallback(
    headers: Record<string, string | undefined>,
    rawBody: string,
  ): VerifiedCallback | null;
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
