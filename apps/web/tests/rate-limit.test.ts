/**
 * rateLimitRetrySeconds — turns a parsed API error into a "try again in Ns"
 * countdown for the exam-start screens. Pure, so unit-tested directly.
 */
import { describe, expect, it } from "vitest";

import { rateLimitRetrySeconds } from "../src/lib/rate-limit.js";

describe("rateLimitRetrySeconds", () => {
  it("returns null for non-rate-limit errors", () => {
    expect(rateLimitRetrySeconds({ code: "ACCESS_CODE_INVALID" })).toBeNull();
    expect(rateLimitRetrySeconds({ status: 403 })).toBeNull();
  });

  it("reads the server's retryAfterSeconds when present", () => {
    expect(
      rateLimitRetrySeconds({
        code: "RATE_LIMITED",
        details: { retryAfterSeconds: 60 },
      }),
    ).toBe(60);
  });

  it("falls back to 60s on a 429 without a usable value", () => {
    expect(rateLimitRetrySeconds({ status: 429 })).toBe(60);
    expect(
      rateLimitRetrySeconds({ code: "RATE_LIMITED", details: { foo: 1 } }),
    ).toBe(60);
  });
});
