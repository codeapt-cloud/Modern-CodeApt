/**
 * Hero backdrop — a full-bleed ambient aurora behind the hero content. Reuses
 * the app's proven pattern (see pages/auth/AuthHero): the animated
 * <GrainGradient> WebGL shader is LAZY-LOADED (its own chunk, off the critical
 * path) and recolored from our `--color-primary-*` tokens, so there is no
 * hardcoded hex and the palette tracks the brand in both themes.
 *
 * Performance + a11y contract:
 *  - First paint never waits on the shader: a GPU-free token gradient renders
 *    immediately as the Suspense fallback and as the reduced-motion substitute.
 *  - Reduced motion → the shader is NOT mounted at all (no WebGL context, no
 *    chunk download); the static gradient stands in — same cyan family, calm.
 *  - The whole layer is decorative (aria-hidden) and sits behind a scrim so
 *    foreground text keeps its contrast in light and dark themes.
 */
import { useReducedMotion } from "framer-motion";
import { Suspense, lazy, useMemo } from "react";

import { useCoarsePointer } from "../../../lib/motion.js";

const GrainGradient = lazy(() =>
  import("@paper-design/shaders-react").then((m) => ({
    default: m.GrainGradient,
  })),
);

/** Read a token RGB triplet ("r g b") → a CSS `rgb(r, g, b)` string. */
function tokenRgb(name: string): string {
  if (typeof window === "undefined") return "";
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  if (!raw) return "";
  return `rgb(${raw.split(/\s+/).join(", ")})`;
}

/** GPU-free brand gradient — first paint, Suspense fallback, reduced motion. */
function StaticAurora() {
  return (
    <div aria-hidden="true" className="absolute inset-0">
      <div className="absolute -top-1/3 right-[-10%] h-[70vh] w-[70vh] rounded-full bg-primary-500/20 blur-[120px]" />
      <div className="absolute bottom-[-20%] left-[-10%] h-[60vh] w-[60vh] rounded-full bg-primary-700/20 blur-[120px]" />
      <div className="absolute left-1/2 top-1/4 h-[40vh] w-[40vh] -translate-x-1/2 rounded-full bg-primary-300/10 blur-[100px]" />
    </div>
  );
}

export function HeroBackdrop() {
  const reduced = useReducedMotion();
  // Touch devices (≈ phones/tablets) get the GPU-free static aurora — no WebGL
  // context, no chunk, no battery/jank cost on the modest phones most students
  // use. The animated shader is reserved for fine-pointer (desktop) machines.
  const coarse = useCoarsePointer();
  const useShader = !reduced && !coarse;

  // Mirror AuthHero's [near-white → light → primary → near-white] cyan ramp.
  const colors = useMemo(
    () =>
      [
        tokenRgb("--color-primary-50"),
        tokenRgb("--color-primary-300"),
        tokenRgb("--color-primary-500"),
        tokenRgb("--color-primary-50"),
      ].filter(Boolean),
    [],
  );

  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
      {!useShader || colors.length === 0 ? (
        <StaticAurora />
      ) : (
        <Suspense fallback={<StaticAurora />}>
          <GrainGradient
            className="absolute inset-0 h-full w-full opacity-70"
            style={{ width: "100%", height: "100%" }}
            colors={colors}
            colorBack="rgba(0, 0, 0, 0)"
            shape="corners"
            softness={0.6}
            intensity={0.45}
            noise={0.22}
            scale={1.1}
            speed={0.5}
          />
        </Suspense>
      )}

      {/* Scrim: fade the aurora into the page + protect text contrast. */}
      <div className="absolute inset-0 bg-gradient-to-b from-surface/10 via-surface/40 to-surface" />
      {/* Faint grid to add engineered texture without noise-spam. */}
      <div className="absolute inset-0 bg-grid-glow opacity-60" />
    </div>
  );
}
