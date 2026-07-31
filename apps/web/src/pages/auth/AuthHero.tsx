/**
 * Auth hero — the branded decorative panel beside the auth form (desktop, right
 * side). The only thing kept from the source 21st.dev component is its animated
 * <GrainGradient> WebGL shader; it's recolored to our brand and lazy-loaded so
 * it only downloads on the auth routes and never blocks the form.
 *
 * Recolor: the shader `colors` are read from our CSS token variables
 * (--color-primary-*), mirroring the source's [white, accent, accent, white]
 * structure as [near-white-cyan, light-cyan, primary-cyan, near-white-cyan] —
 * so there is no hardcoded hex and the palette tracks the design system.
 * `colorBack` is transparent over the `bg-surface-sunken` token.
 *
 * Reduced motion: the shader is NOT mounted at all (no GPU cost, no chunk
 * download). A static CSS gradient built from the same cyan→ink tokens stands
 * in — same visual family, zero animation. It is also the Suspense fallback
 * while the shader chunk loads.
 */
import { useReducedMotion } from "framer-motion";
import { Suspense, lazy, useMemo } from "react";

import { BraceMotif } from "../../components/brand/BraceMotif.js";
import { Logo } from "../../components/brand/Logo.js";

const GrainGradient = lazy(() =>
  import("@paper-design/shaders-react").then((m) => ({
    default: m.GrainGradient,
  })),
);

/** Read a token RGB triplet ("r g b") and return a CSS `rgb(r, g, b)` string. */
function tokenRgb(name: string): string {
  if (typeof window === "undefined") return "";
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  if (!raw) return "";
  return `rgb(${raw.split(/\s+/).join(", ")})`;
}

/** Static, GPU-free brand gradient — reduced-motion + Suspense fallback. */
function StaticGradient() {
  return (
    <div aria-hidden="true" className="absolute inset-0">
      <div className="absolute inset-0 bg-gradient-to-br from-primary-600/30 via-primary-900/25 to-surface-sunken" />
      <div className="absolute -right-1/4 top-1/4 h-2/3 w-2/3 rounded-full bg-primary-500/20 blur-3xl" />
      <div className="absolute bottom-0 left-0 h-1/2 w-1/2 rounded-full bg-primary-300/10 blur-3xl" />
    </div>
  );
}

export function AuthHero() {
  const reduced = useReducedMotion();

  // Mirrors the source [white, accent, accent, white] structure, recolored to
  // our cyan brand scale (near-white → light cyan → primary cyan → near-white).
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
    <aside className="relative hidden overflow-hidden bg-surface-sunken lg:flex lg:flex-col lg:justify-between lg:p-12">
      {/* Animated shader (motion) OR static token gradient (reduced motion). */}
      {reduced || colors.length === 0 ? (
        <StaticGradient />
      ) : (
        <Suspense fallback={<StaticGradient />}>
          <GrainGradient
            className="absolute inset-0 h-full w-full"
            style={{ width: "100%", height: "100%" }}
            colors={colors}
            colorBack="rgba(0, 0, 0, 0)"
            shape="corners"
            softness={0.5}
            intensity={0.5}
            noise={0.25}
            scale={1}
            speed={0.8}
          />
        </Suspense>
      )}

      {/* Scrim for text legibility over the gradient (both themes). */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-surface-sunken/85 via-surface-sunken/10 to-surface-sunken/40"
      />

      {/* Foreground: real brand marks + CodeApt copy. */}
      <div className="relative z-10">
        <Logo className="h-8" />
      </div>

      <div className="relative z-10 space-y-6">
        <BraceMotif size="text-6xl" />
        <h2 className="max-w-md text-4xl font-bold leading-tight tracking-tight text-ink xl:text-5xl">
          Learn to code.
          <br />
          Land the offer.
        </h2>
        <p className="max-w-md text-lg text-ink-secondary">
          Coding-aptitude training built for campus placements — courses, timed
          mock exams, daily challenges, and AI-graded essays.
        </p>
      </div>

      <p className="relative z-10 font-mono text-xs text-ink-muted">
        {"// preparing the next generation of engineers"}
      </p>
    </aside>
  );
}
