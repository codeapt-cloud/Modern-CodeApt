/**
 * distributableCredits pure helper (from @codeapt/shared): pool − Σ allocated,
 * never negative. This is the finite-pool guard's core number.
 */
import { distributableCredits } from "@codeapt/shared";
import { describe, expect, it } from "vitest";

describe("distributableCredits", () => {
  it("returns pool minus allocated, clamped at zero", () => {
    expect(distributableCredits(1000, 400)).toBe(600);
    expect(distributableCredits(1000, 1000)).toBe(0);
    expect(distributableCredits(1000, 1500)).toBe(0); // never negative
    expect(distributableCredits(0, 0)).toBe(0);
  });
});
