/**
 * Mock payment gateway unit — createOrder / verifyCallback (signature accept +
 * reject) / fetchStatus. No network, no DB.
 */
import { PaymentStatus } from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import {
  MOCK_SIGNATURE_HEADER,
  buildSignedCallback,
  createMockGateway,
} from "../src/lib/payment-gateway/mock.js";

const gw = createMockGateway();

describe("mock gateway", () => {
  it("createOrder returns a redirect URL carrying the order id", async () => {
    const res = await gw.createOrder({
      merchantOrderId: "ORD-abc",
      amountPaise: 99900,
      redirectUrl: "http://localhost:5173/payments/return",
      callbackUrl: "http://localhost:4000/api/payments/callback",
    });
    expect(res.redirectUrl).toContain("ORD-abc");
    expect(res.gatewayOrderId).toBe("ORD-abc");
  });

  it("verifyCallback accepts a validly-signed success body", () => {
    const { headers, rawBody } = buildSignedCallback("ORD-1", "success");
    const verified = gw.verifyCallback(headers, rawBody);
    expect(verified).not.toBeNull();
    expect(verified?.merchantOrderId).toBe("ORD-1");
    expect(verified?.status).toBe("success");
    expect(verified?.gatewayTxnId).toBe("MOCKTXN-ORD-1");
  });

  it("verifyCallback normalizes a failure body", () => {
    const { headers, rawBody } = buildSignedCallback("ORD-2", "failure");
    expect(gw.verifyCallback(headers, rawBody)?.status).toBe("failed");
  });

  it("verifyCallback REJECTS a tampered body (signature mismatch)", () => {
    const { headers } = buildSignedCallback("ORD-3", "success");
    // Same (valid) signature, but a different body → must not verify.
    const tampered = JSON.stringify({
      merchantOrderId: "ORD-3",
      status: "success",
      gatewayTxnId: "attacker",
    }).replace("ORD-3", "ORD-EVIL");
    expect(gw.verifyCallback(headers, tampered)).toBeNull();
  });

  it("verifyCallback rejects a missing signature header", () => {
    const { rawBody } = buildSignedCallback("ORD-4", "success");
    expect(gw.verifyCallback({}, rawBody)).toBeNull();
  });

  it("verifyCallback rejects a wrong signature", () => {
    const { rawBody } = buildSignedCallback("ORD-5", "success");
    expect(
      gw.verifyCallback({ [MOCK_SIGNATURE_HEADER]: "deadbeef" }, rawBody),
    ).toBeNull();
  });

  it("fetchStatus is pending (mock has no server state)", async () => {
    expect((await gw.fetchStatus("ORD-x")).status).toBe(PaymentStatus.PENDING);
  });
});
