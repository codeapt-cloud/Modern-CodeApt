/**
 * Basic exam calculator — pure compute logic. Immediate-execution (like a
 * physical placement-exam calculator), so no operator precedence. Covers the
 * four functions, %, sign, clear, backspace, decimals, chaining, FP-noise
 * cleanup, and divide-by-zero → "Error" → recovery.
 */
import { describe, expect, it } from "vitest";

import { keyboardKeyToCalc, runKeys } from "../src/lib/calculator.js";

describe("calculator arithmetic", () => {
  it("adds, subtracts, multiplies, divides", () => {
    expect(runKeys(["2", "+", "3", "="])).toBe("5");
    expect(runKeys(["9", "-", "4", "="])).toBe("5");
    expect(runKeys(["7", "*", "6", "="])).toBe("42");
    expect(runKeys(["8", "/", "2", "="])).toBe("4");
  });

  it("chains with immediate execution (no precedence): 2 + 3 × 4 = 20", () => {
    expect(runKeys(["2", "+", "3", "*", "4", "="])).toBe("20");
  });

  it("handles decimals and cleans floating-point noise", () => {
    expect(runKeys(["1", ".", "5", "+", "2", "="])).toBe("3.5");
    expect(runKeys(["0", ".", "1", "+", "0", ".", "2", "="])).toBe("0.3");
  });

  it("percent: accumulator-aware and standalone", () => {
    // 200 + 10% → 20, then = → 220
    expect(runKeys(["2", "0", "0", "+", "1", "0", "%"])).toBe("20");
    expect(runKeys(["2", "0", "0", "+", "1", "0", "%", "="])).toBe("220");
    // standalone → divide by 100
    expect(runKeys(["5", "0", "%"])).toBe("0.5");
  });

  it("sign toggle (+/-) and does nothing to a lone zero", () => {
    expect(runKeys(["5", "+/-"])).toBe("-5");
    expect(runKeys(["5", "+/-", "+/-"])).toBe("5");
    expect(runKeys(["+/-"])).toBe("0");
  });

  it("backspace removes the last char, flooring at 0", () => {
    expect(runKeys(["1", "2", "3", "back"])).toBe("12");
    expect(runKeys(["5", "back"])).toBe("0");
  });

  it("clear (C) resets everything", () => {
    expect(runKeys(["9", "*", "9", "C"])).toBe("0");
    // C mid-expression truly resets: 9 * 9, clear, then 2 + 2 = 4 (no stale 81)
    expect(runKeys(["9", "*", "9", "C", "2", "+", "2", "="])).toBe("4");
  });
});

describe("divide-by-zero handling", () => {
  it("shows Error and recovers on the next digit", () => {
    expect(runKeys(["5", "/", "0", "="])).toBe("Error");
    // A digit after Error starts fresh.
    expect(runKeys(["5", "/", "0", "=", "7"])).toBe("7");
    // Operators are ignored while in Error until cleared/digit.
    expect(runKeys(["5", "/", "0", "=", "+"])).toBe("Error");
    expect(runKeys(["5", "/", "0", "=", "C"])).toBe("0");
  });
});

describe("keyboardKeyToCalc (scoped key mapping)", () => {
  it("maps digits, operators, and control keys", () => {
    expect(keyboardKeyToCalc("7")).toBe("7");
    expect(keyboardKeyToCalc("+")).toBe("+");
    expect(keyboardKeyToCalc("Enter")).toBe("=");
    expect(keyboardKeyToCalc("Backspace")).toBe("back");
    expect(keyboardKeyToCalc("Escape")).toBe("C");
  });
  it("returns null for keys it should NOT handle (so typing is unaffected)", () => {
    expect(keyboardKeyToCalc("a")).toBeNull();
    expect(keyboardKeyToCalc("Tab")).toBeNull();
    expect(keyboardKeyToCalc(" ")).toBeNull();
  });
});
