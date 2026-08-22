import { PaymentStatus } from "@codeapt/shared";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { env } from "../src/config/env.js";
import { createPhonePeGateway } from "../src/lib/payment-gateway/phonepe.js";
import {
  PaymentGatewayError,
  type CallbackVerification,
  type VerifiedCallback,
} from "../src/lib/payment-gateway/types.js";

/** Narrow a verifyCallback result to the terminal (object) case, or fail. */
function expectVerified(v: CallbackVerification): VerifiedCallback {
  expect(v).not.toBeNull();
  expect(v).not.toBe("ignore");
  return v as VerifiedCallback;
}

// Mock pg-sdk-node
const mockPay = vi.fn();
const mockValidateCallback = vi.fn();
const mockGetOrderStatus = vi.fn();

vi.mock("pg-sdk-node", () => ({
  Env: { SANDBOX: "SANDBOX", PRODUCTION: "PRODUCTION" },
  StandardCheckoutClient: {
    getInstance: () => ({
      pay: mockPay,
      validateCallback: mockValidateCallback,
      getOrderStatus: mockGetOrderStatus,
    }),
  },
}));

vi.mock("pg-sdk-node/dist/payments/v2/models/request/StandardCheckoutPayRequest.js", () => {
  return {
    StandardCheckoutPayRequest: {
      builder: () => {
        let _merchantOrderId: string;
        let _amount: number;
        let _redirectUrl: string;
        const builder = {
          merchantOrderId: (id: string) => {
            _merchantOrderId = id;
            return builder;
          },
          amount: (amt: number) => {
            _amount = amt;
            return builder;
          },
          redirectUrl: (url: string) => {
            _redirectUrl = url;
            return builder;
          },
          build: () => ({
            merchantOrderId: _merchantOrderId,
            amount: _amount,
            redirectUrl: _redirectUrl,
          }),
        };
        return builder;
      },
    },
  };
});

describe("PhonePe gateway adapter (pg-sdk-node)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Setup required env
    env.PHONEPE_CLIENT_ID = "test-client";
    env.PHONEPE_CLIENT_SECRET = "test-secret";
    env.PHONEPE_ENV = "SANDBOX";
    env.PHONEPE_WEBHOOK_USERNAME = "wh-user";
    env.PHONEPE_WEBHOOK_PASSWORD = "wh-password";
  });

  it("fails to initialize if webhook config is missing", () => {
    env.PHONEPE_WEBHOOK_USERNAME = undefined;
    expect(() => createPhonePeGateway()).toThrow(PaymentGatewayError);
    expect(() => createPhonePeGateway()).toThrow(/webhook credentials/);
  });

  describe("createOrder", () => {
    it("returns the redirectUrl from the SDK", async () => {
      mockPay.mockResolvedValueOnce({ redirectUrl: "https://pay.phonepe.com/url" });
      const gw = createPhonePeGateway();
      
      const res = await gw.createOrder({
        merchantOrderId: "ORD-1",
        amountPaise: 100000,
        redirectUrl: "http://localhost:5173/return",
        callbackUrl: "http://localhost:4000/callback",
      });

      expect(res.redirectUrl).toBe("https://pay.phonepe.com/url");
      expect(res.gatewayOrderId).toBe("ORD-1");
      expect(mockPay).toHaveBeenCalledOnce();
    });

    it("throws PaymentGatewayError if SDK fails", async () => {
      mockPay.mockRejectedValueOnce(new Error("Network error"));
      const gw = createPhonePeGateway();
      
      await expect(
        gw.createOrder({
          merchantOrderId: "ORD-2",
          amountPaise: 500,
          redirectUrl: "url",
          callbackUrl: "url",
        })
      ).rejects.toThrow(PaymentGatewayError);
    });
  });

  describe("verifyCallback", () => {
    it("accepts a valid callback and maps COMPLETED to success", () => {
      mockValidateCallback.mockReturnValueOnce({
        type: "PAYMENT",
        payload: {
          merchantOrderId: "ORD-3",
          state: "COMPLETED",
          paymentDetails: [{ transactionId: "TXN-123" }],
        },
      });

      const gw = createPhonePeGateway();
      const verified = expectVerified(
        gw.verifyCallback({ authorization: "Basic xxxx" }, "raw_body_data"),
      );

      expect(verified.merchantOrderId).toBe("ORD-3");
      expect(verified.status).toBe("success");
      expect(verified.gatewayTxnId).toBe("TXN-123");

      expect(mockValidateCallback).toHaveBeenCalledWith(
        "wh-user",
        "wh-password",
        "Basic xxxx",
        "raw_body_data"
      );
    });

    it("normalizes a failure body", () => {
      mockValidateCallback.mockReturnValueOnce({
        type: "PAYMENT",
        payload: {
          merchantOrderId: "ORD-4",
          state: "FAILED",
        },
      });

      const gw = createPhonePeGateway();
      const verified = expectVerified(
        gw.verifyCallback({ authorization: "Basic xxxx" }, "raw_body_data"),
      );

      expect(verified.status).toBe("failed");
    });

    it('IGNORES a non-terminal (PENDING) callback — returns "ignore", NOT null/failed', () => {
      // "ignore" (verified but non-terminal) is DISTINCT from null (bad
      // signature): it acknowledges the webhook (2xx) and writes nothing, so the
      // order stays recoverable and the gateway doesn't retry/disable. Collapsing
      // pending→failed here would terminalise the order and drop a later success.
      mockValidateCallback.mockReturnValueOnce({
        type: "PAYMENT",
        payload: { merchantOrderId: "ORD-4b", state: "PENDING" },
      });

      const gw = createPhonePeGateway();
      const verified = gw.verifyCallback({ authorization: "Basic xxxx" }, "raw");

      expect(verified).toBe("ignore");
    });

    it('IGNORES an unrecognised callback state too ("ignore", not failed)', () => {
      mockValidateCallback.mockReturnValueOnce({
        type: "PAYMENT",
        payload: { merchantOrderId: "ORD-4c", state: "SOME_FUTURE_STATE" },
      });

      const gw = createPhonePeGateway();
      const verified = gw.verifyCallback({ authorization: "Basic xxxx" }, "raw");

      expect(verified).toBe("ignore");
    });

    it("(b) an INVALID signature with a would-be-PENDING body is REJECTED (null), never ignored", () => {
      // Signature verification runs to completion BEFORE the pending/ignore
      // branch, so an unsigned attacker payload that CLAIMS a pending state is
      // still a 4xx rejection — it can never buy a 2xx ack.
      mockValidateCallback.mockImplementationOnce(() => {
        throw new Error("bad signature");
      });

      const gw = createPhonePeGateway();
      const verified = gw.verifyCallback(
        { authorization: "Basic forged" },
        JSON.stringify({ merchantOrderId: "X", state: "PENDING" }),
      );

      expect(verified).toBeNull();
    });

    it("(b) a MISSING signature header short-circuits to null before the state is read", () => {
      const gw = createPhonePeGateway();
      const verified = gw.verifyCallback(
        { "content-type": "application/json" },
        JSON.stringify({ merchantOrderId: "X", state: "PENDING" }),
      );

      expect(verified).toBeNull();
      expect(mockValidateCallback).not.toHaveBeenCalled();
    });

    it("rejects when Authorization header is missing (returns null)", () => {
      const gw = createPhonePeGateway();
      const verified = gw.verifyCallback({ "content-type": "application/json" }, "raw_body_data");

      // Does not even call SDK
      expect(mockValidateCallback).not.toHaveBeenCalled();
      expect(verified).toBeNull();
    });

    it("rejects when SDK validation throws (forged/tampered body)", () => {
      mockValidateCallback.mockImplementationOnce(() => {
        throw new Error("Invalid callback");
      });

      const gw = createPhonePeGateway();
      const verified = gw.verifyCallback({ authorization: "Basic attacker" }, "tampered_data");

      expect(verified).toBeNull();
    });
  });

  describe("fetchStatus", () => {
    it("returns SUCCESS if state is COMPLETED", async () => {
      mockGetOrderStatus.mockResolvedValueOnce({
        state: "COMPLETED",
        paymentDetails: [{ transactionId: "TXN-999" }],
      });

      const gw = createPhonePeGateway();
      const res = await gw.fetchStatus("ORD-5");
      
      expect(res.status).toBe(PaymentStatus.SUCCESS);
      expect(res.gatewayTxnId).toBe("TXN-999");
    });

    it("returns FAILED if state is FAILED", async () => {
      mockGetOrderStatus.mockResolvedValueOnce({
        state: "FAILED",
      });

      const gw = createPhonePeGateway();
      const res = await gw.fetchStatus("ORD-6");

      expect(res.status).toBe(PaymentStatus.FAILED);
      expect(res.gatewayTxnId).toBeNull();
    });

    it("returns PENDING for an in-progress state (money-loss regression)", async () => {
      // Before the fix this collapsed to FAILED, terminalising the order so the
      // later success webhook was silently ignored — money taken, no enrollment.
      mockGetOrderStatus.mockResolvedValueOnce({ state: "PENDING" });

      const gw = createPhonePeGateway();
      const res = await gw.fetchStatus("ORD-7");

      expect(res.status).toBe(PaymentStatus.PENDING);
    });

    it("maps an UNRECOGNISED state to PENDING, never FAILED (fail-open)", async () => {
      mockGetOrderStatus.mockResolvedValueOnce({ state: "SOME_FUTURE_STATE" });

      const gw = createPhonePeGateway();
      const res = await gw.fetchStatus("ORD-8");

      expect(res.status).toBe(PaymentStatus.PENDING);
    });
  });
});
