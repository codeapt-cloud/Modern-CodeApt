/**
 * AI Providers page helpers — usage-vs-limit %, status label/variant, cooldown
 * remaining, and the priority-swap reorder math.
 */
import { AiProviderStatus, type AiProviderAdmin } from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import {
  cooldownRemaining,
  reorderSwap,
  statusLabel,
  statusVariant,
  usagePercent,
} from "../src/lib/ai-providers-ui.js";

const P = (id: string, priority: number): AiProviderAdmin =>
  ({ id, priority }) as AiProviderAdmin;

describe("usagePercent", () => {
  it("computes a clamped percentage, null when unlimited", () => {
    expect(usagePercent(5, 10)).toBe(50);
    expect(usagePercent(0, 10)).toBe(0);
    expect(usagePercent(20, 10)).toBe(100); // clamped
    expect(usagePercent(3, null)).toBeNull();
    expect(usagePercent(3, 0)).toBeNull();
  });
});

describe("status label / variant", () => {
  it("maps each status", () => {
    expect(statusLabel(AiProviderStatus.HEALTHY)).toBe("Healthy");
    expect(statusLabel(AiProviderStatus.COOLING_DOWN)).toBe("Cooling down");
    expect(statusLabel(AiProviderStatus.NO_KEY)).toBe("No key");
    expect(statusVariant(AiProviderStatus.HEALTHY)).toBe("success");
    expect(statusVariant(AiProviderStatus.COOLING_DOWN)).toBe("warning");
    expect(statusVariant(AiProviderStatus.DISABLED)).toBe("neutral");
  });
});

describe("cooldownRemaining", () => {
  const now = 1_000_000;
  it("formats seconds / minutes / hours, empty when not cooling", () => {
    expect(cooldownRemaining(now + 30_000, now)).toBe("30s");
    expect(cooldownRemaining(now + 90_000, now)).toBe("2m");
    expect(cooldownRemaining(now + 2 * 3600_000, now)).toBe("2h");
    expect(cooldownRemaining(now - 5_000, now)).toBe("");
    expect(cooldownRemaining(null, now)).toBe("");
  });
});

describe("reorderSwap", () => {
  const providers = [P("a", 10), P("b", 20), P("c", 30)];
  it("swaps priorities with the neighbor", () => {
    const up = reorderSwap(providers, "b", "up");
    expect(up).toEqual({ a: { id: "b", priority: 10 }, b: { id: "a", priority: 20 } });
    const down = reorderSwap(providers, "b", "down");
    expect(down).toEqual({ a: { id: "b", priority: 30 }, b: { id: "c", priority: 20 } });
  });
  it("returns null at the edges", () => {
    expect(reorderSwap(providers, "a", "up")).toBeNull();
    expect(reorderSwap(providers, "c", "down")).toBeNull();
    expect(reorderSwap(providers, "missing", "up")).toBeNull();
  });
});
