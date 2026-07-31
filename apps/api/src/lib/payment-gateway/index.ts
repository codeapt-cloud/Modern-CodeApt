/**
 * Gateway selection. `PAYMENT_GATEWAY` picks the adapter (default `mock`,
 * gated exactly like PISTON_MOCK). The selected gateway is memoized.
 */
import { env } from "../../config/env.js";
import { createMockGateway } from "./mock.js";
import { createPhonePeGateway } from "./phonepe.js";
import type { PaymentGateway } from "./types.js";

let gateway: PaymentGateway | null = null;

export function getPaymentGateway(): PaymentGateway {
  if (!gateway) {
    gateway =
      env.PAYMENT_GATEWAY === "phonepe"
        ? createPhonePeGateway()
        : createMockGateway();
  }
  return gateway;
}

export { PaymentGatewayError } from "./types.js";
export type {
  PaymentGateway,
  VerifiedCallback,
  CreateOrderResult,
} from "./types.js";
