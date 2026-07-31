/**
 * Pure (React/DOM-free) math for the pointer-driven tilt + spotlight affordance
 * (see components/motion/SpotlightTilt). Given a pointer position relative to an
 * element's top-left and the element's size, it returns the 3D tilt angles (deg)
 * and the spotlight focus as percentages — no framer/DOM, so it unit-tests
 * cleanly (apps/web/tests/tilt.test.ts).
 */

export interface TiltOutput {
  /** Rotation about the X axis (deg) — pointer near the top tilts the card back. */
  rotateX: number;
  /** Rotation about the Y axis (deg) — pointer near the right tilts toward it. */
  rotateY: number;
  /** Spotlight focus X as a 0–100 percentage across the element. */
  spotlightX: number;
  /** Spotlight focus Y as a 0–100 percentage down the element. */
  spotlightY: number;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Normalize -0 → 0 so a centered pointer yields a clean 0 (not negative zero). */
function nz(n: number): number {
  return n === 0 ? 0 : n;
}

/**
 * Compute tilt + spotlight from a pointer position. `px`/`py` are relative to the
 * element's top-left; `w`/`h` its size. `maxDeg` is the peak tilt at an edge.
 * Degenerate sizes (0) resolve to the centered, no-tilt state so callers never
 * divide by zero or emit NaN.
 */
export function computeTilt(
  px: number,
  py: number,
  w: number,
  h: number,
  maxDeg = 6,
): TiltOutput {
  const nx = w > 0 ? clamp01(px / w) : 0.5;
  const ny = h > 0 ? clamp01(py / h) : 0.5;
  return {
    // Centered at (0.5, 0.5) → 0°. Toward the cursor: right → +rotateY, top → +rotateX.
    rotateY: nz((nx - 0.5) * 2 * maxDeg),
    rotateX: nz(-(ny - 0.5) * 2 * maxDeg),
    spotlightX: nz(nx * 100),
    spotlightY: nz(ny * 100),
  };
}
