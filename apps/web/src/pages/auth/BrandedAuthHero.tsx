/**
 * Branded auth hero — the animated decorative panel beside the branded login
 * form (desktop, right side). It mirrors {@link AuthHero} exactly in mechanism:
 * the same lazy-loaded, reduced-motion-aware <GrainGradient> WebGL shader, only
 * RECOLORED to the college's accent color and carrying the college's own logo,
 * display name, and welcome line instead of the CodeApt marketing copy.
 *
 * Recolor: when the college sets a valid hex accent, the shader palette is
 * derived from it as [light-tint, light-tint, accent, light-tint] — mirroring
 * the source [white, accent, accent, white] structure. With no accent set it
 * falls back to the same primary-token palette AuthHero uses, so an un-branded
 * college still gets the platform's animated entrance.
 *
 * Reduced motion: the shader is NOT mounted (no GPU cost, no chunk download). A
 * static CSS gradient built from the same accent (or brand tokens) stands in —
 * it is also the Suspense fallback while the shader chunk loads.
 *
 * The "Supported by CodeApt" wordmark stays pinned at the bottom.
 */
import { useReducedMotion } from "framer-motion";
import { Suspense, lazy, useMemo } from "react";

import { Logo } from "../../components/brand/Logo.js";
import { imageUrl } from "../../lib/cloudinary.js";

const GrainGradient = lazy(() =>
  import("@paper-design/shaders-react").then((m) => ({
    default: m.GrainGradient,
  })),
);

type Rgb = [number, number, number];

/** Parse `#rgb` / `#rrggbb` into an RGB triplet; null if not a valid hex. */
function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return null;
  let h = m[1];
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Linear-mix `base` toward `target` by `t` (0..1), as a CSS rgb() string. */
function mix(base: Rgb, target: Rgb, t: number): string {
  const f = (a: number, b: number): number => Math.round(a + (b - a) * t);
  return `rgb(${f(base[0], target[0])}, ${f(base[1], target[1])}, ${f(base[2], target[2])})`;
}

/** Read a token RGB triplet ("r g b") and return a CSS `rgb(r, g, b)` string. */
function tokenRgb(name: string): string {
  if (typeof window === "undefined") return "";
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  if (!raw) return "";
  return `rgb(${raw.split(/\s+/).join(", ")})`;
}

const WHITE: Rgb = [255, 255, 255];

/** Static, GPU-free gradient — reduced-motion + Suspense fallback. */
function StaticGradient({ accent }: { accent?: Rgb }) {
  if (!accent) {
    return (
      <div aria-hidden="true" className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-600/30 via-primary-900/25 to-surface-sunken" />
        <div className="absolute -right-1/4 top-1/4 h-2/3 w-2/3 rounded-full bg-primary-500/20 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-1/2 w-1/2 rounded-full bg-primary-300/10 blur-3xl" />
      </div>
    );
  }
  const rgb = `${accent[0]}, ${accent[1]}, ${accent[2]}`;
  return (
    <div aria-hidden="true" className="absolute inset-0">
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(135deg, rgba(${rgb},0.35), rgba(${rgb},0.12) 55%, transparent)`,
        }}
      />
      <div
        className="absolute -right-1/4 top-1/4 h-2/3 w-2/3 rounded-full blur-3xl"
        style={{ backgroundColor: `rgba(${rgb},0.22)` }}
      />
      <div
        className="absolute bottom-0 left-0 h-1/2 w-1/2 rounded-full blur-3xl"
        style={{ backgroundColor: `rgba(${rgb},0.12)` }}
      />
    </div>
  );
}

export function BrandedAuthHero({
  accent,
  logoUrl,
  displayName,
  welcomeText,
}: {
  accent?: string;
  logoUrl?: string;
  displayName: string;
  welcomeText?: string;
}) {
  const reduced = useReducedMotion();
  const accentRgb = useMemo(
    () => (accent ? parseHex(accent) : null),
    [accent],
  );

  // Accent → light-tinted palette (mirrors source [white, accent, accent,
  // white]); no accent → the same primary-token palette AuthHero uses.
  const colors = useMemo(() => {
    if (accentRgb) {
      const base = accentRgb;
      return [
        mix(base, WHITE, 0.8),
        mix(base, WHITE, 0.45),
        `rgb(${base[0]}, ${base[1]}, ${base[2]})`,
        mix(base, WHITE, 0.8),
      ];
    }
    return [
      tokenRgb("--color-primary-50"),
      tokenRgb("--color-primary-300"),
      tokenRgb("--color-primary-500"),
      tokenRgb("--color-primary-50"),
    ].filter(Boolean);
  }, [accentRgb]);

  return (
    <aside className="relative hidden overflow-hidden bg-surface-sunken lg:flex lg:flex-col lg:justify-between lg:p-12">
      {/* Animated shader (motion) OR static gradient (reduced motion). */}
      {reduced || colors.length === 0 ? (
        <StaticGradient accent={accentRgb ?? undefined} />
      ) : (
        <Suspense fallback={<StaticGradient accent={accentRgb ?? undefined} />}>
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

      {/* Foreground: the college's own marks. */}
      <div className="relative z-10 flex items-center">
        {logoUrl ? (
          <img
            src={imageUrl(logoUrl)}
            alt={`${displayName} logo`}
            className="h-10 max-w-[220px] object-contain"
          />
        ) : (
          <div
            className="flex h-11 w-11 items-center justify-center rounded-2xl text-xl font-bold text-white"
            style={
              accentRgb
                ? { backgroundColor: `rgb(${accentRgb[0]}, ${accentRgb[1]}, ${accentRgb[2]})` }
                : { backgroundColor: "rgb(var(--color-primary-500))" }
            }
            aria-hidden
          >
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      <div className="relative z-10 space-y-5">
        <h2 className="max-w-md text-4xl font-bold leading-tight tracking-tight text-ink xl:text-5xl">
          {displayName}
        </h2>
        {welcomeText ? (
          <p className="max-w-md text-lg text-ink-secondary">{welcomeText}</p>
        ) : (
          <p className="max-w-md text-lg text-ink-secondary">
            Sign in to continue to your portal.
          </p>
        )}
      </div>

      <p className="relative z-10 inline-flex items-center gap-1.5 text-xs text-ink-muted">
        Supported by <Logo className="h-4" />
      </p>
    </aside>
  );
}
