/**
 * formatExpiry — the learner-facing "days left / access until" label + tone.
 * Pure, so unit-tested directly. Null (lifetime) yields no badge.
 */
import { describe, expect, it } from "vitest";

import { formatExpiry } from "../src/lib/expiry.js";

const DAY = 24 * 60 * 60 * 1000;

describe("formatExpiry", () => {
  it("returns null for lifetime access (no expiry)", () => {
    expect(formatExpiry(null)).toBeNull();
  });

  it("warns when the window closes soon (≤30 days)", () => {
    const soon = new Date(Date.now() + 5 * DAY).toISOString();
    const label = formatExpiry(soon);
    expect(label?.tone).toBe("warning");
    expect(label?.text).toMatch(/days left/);
  });

  it("is neutral for a comfortably distant expiry", () => {
    const far = new Date(Date.now() + 200 * DAY).toISOString();
    const label = formatExpiry(far);
    expect(label?.tone).toBe("neutral");
    expect(label?.text).toMatch(/Access until/);
  });

  it("flags an already-lapsed window as expired", () => {
    const past = new Date(Date.now() - DAY).toISOString();
    expect(formatExpiry(past)?.text).toBe("Access expired");
  });
});
