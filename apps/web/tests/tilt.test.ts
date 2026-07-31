/**
 * Pure tilt/spotlight math for the SpotlightTilt affordance. Proves the center
 * is neutral, edges tilt toward the cursor within ±maxDeg, out-of-bounds pointers
 * clamp, and degenerate sizes resolve to a safe centered state (no NaN).
 */
import { describe, expect, it } from "vitest";

import { computeTilt } from "../src/lib/tilt.js";

describe("computeTilt", () => {
  it("is neutral at the center", () => {
    const t = computeTilt(50, 50, 100, 100, 6);
    expect(t.rotateX).toBe(0);
    expect(t.rotateY).toBe(0);
    expect(t.spotlightX).toBe(50);
    expect(t.spotlightY).toBe(50);
  });

  it("tilts toward the cursor at the edges (±maxDeg)", () => {
    const right = computeTilt(100, 50, 100, 100, 6);
    expect(right.rotateY).toBeCloseTo(6);
    const left = computeTilt(0, 50, 100, 100, 6);
    expect(left.rotateY).toBeCloseTo(-6);
    // Pointer at the top → card tilts back (+rotateX); bottom → -rotateX.
    const top = computeTilt(50, 0, 100, 100, 6);
    expect(top.rotateX).toBeCloseTo(6);
    const bottom = computeTilt(50, 100, 100, 100, 6);
    expect(bottom.rotateX).toBeCloseTo(-6);
  });

  it("clamps out-of-bounds pointers to the edge", () => {
    const t = computeTilt(200, -40, 100, 100, 6);
    expect(t.rotateY).toBeCloseTo(6); // clamped to right edge
    expect(t.rotateX).toBeCloseTo(6); // clamped to top edge
    expect(t.spotlightX).toBe(100);
    expect(t.spotlightY).toBe(0);
  });

  it("resolves degenerate sizes to a safe centered state (no NaN)", () => {
    const t = computeTilt(10, 10, 0, 0, 6);
    expect(t.rotateX).toBe(0);
    expect(t.rotateY).toBe(0);
    expect(t.spotlightX).toBe(50);
    expect(t.spotlightY).toBe(50);
  });

  it("maps spotlight focus to percentages across the element", () => {
    const t = computeTilt(25, 75, 100, 100, 6);
    expect(t.spotlightX).toBe(25);
    expect(t.spotlightY).toBe(75);
  });
});
