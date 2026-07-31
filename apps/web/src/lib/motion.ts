/**
 * Motion foundation — the single source of truth for animation in the app.
 *
 * Every duration/easing here MIRRORS the CSS custom properties in
 * `src/styles/tokens.css` (and the Tailwind `transitionDuration` /
 * `transitionTimingFunction` scales derived from them), so JS-driven motion
 * (framer-motion) and CSS transitions stay visually identical. Do NOT invent
 * new durations/easings — extend the tokens first, then mirror them here.
 *
 * Everything is reduced-motion-aware: the <Reveal>, <Stagger>, <HoverLift>
 * components and the useCountUp hook all collapse to a static, fully-functional
 * result when the user prefers reduced motion.
 *
 * framer-motion is the ONLY animation library — no second dependency.
 */
import { animate, useReducedMotion, type Transition, type Variants } from "framer-motion";
import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Token bridge — numeric mirrors of tokens.css
// ---------------------------------------------------------------------------

/** Seconds. Mirror of tokens.css `--duration-fast|base|slow` (120/200/320ms). */
export const DURATION = {
  fast: 0.12,
  base: 0.2,
  slow: 0.32,
} as const;

/** cubic-bezier control points. Mirror of tokens.css `--ease-*`. */
export type Bezier = [number, number, number, number];
export const EASING = {
  /** --ease-standard: cubic-bezier(0.2, 0, 0, 1) */
  standard: [0.2, 0, 0, 1] as Bezier,
  /** --ease-emphasized: cubic-bezier(0.3, 0, 0, 1) */
  emphasized: [0.3, 0, 0, 1] as Bezier,
  /** --ease-out: cubic-bezier(0, 0, 0.2, 1) */
  out: [0, 0, 0.2, 1] as Bezier,
} as const;

/** Ready-made framer-motion transition presets built from the tokens. */
export const transition = {
  fast: { duration: DURATION.fast, ease: EASING.out },
  base: { duration: DURATION.base, ease: EASING.out },
  slow: { duration: DURATION.slow, ease: EASING.standard },
  emphasized: { duration: DURATION.base, ease: EASING.emphasized },
} satisfies Record<string, Transition>;

/** Soft spring for hover/press affordances (matches our elevation feel). */
export const springSoft: Transition = {
  type: "spring",
  stiffness: 320,
  damping: 30,
  mass: 0.7,
};

// ---------------------------------------------------------------------------
// Reusable variants — subtle distances (8–16px), our eases
// ---------------------------------------------------------------------------

// Variants carry only the visual target (opacity/transform). The transition is
// supplied by the consuming component (Reveal/Stagger), so `delay` and
// stagger timing compose correctly instead of being overridden per-variant.

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1 },
};

/**
 * Energetic entrance — a touch more rise + scale than fadeInUp, meant to be
 * paired with {@link springSoft} for a springy, "designed" cascade. Still
 * subtle (18px / 4% scale); consumers collapse it to static under reduced motion.
 */
export const springUp: Variants = {
  hidden: { opacity: 0, y: 18, scale: 0.96 },
  visible: { opacity: 1, y: 0, scale: 1 },
};

/** Backward-compatible alias (previous export name). */
export const fade = fadeIn;

/** Stagger container: reveals children one-by-one on mount. */
export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.06, delayChildren: 0.04 },
  },
};

/** Quicker cascade for denser grids (stat cards / tiles) — snappier, more alive. */
export const staggerContainerFast: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.05, delayChildren: 0.02 },
  },
};

/** Default per-child variant inside a <Stagger>. */
export const staggerItem: Variants = fadeInUp;

/** Named variants selectable by <Reveal variant="…">. */
export const revealVariants = {
  fadeIn,
  fadeInUp,
  scaleIn,
} satisfies Record<string, Variants>;
export type RevealVariantName = keyof typeof revealVariants;

/** Collapse any variants to a plain fade when motion is reduced (legacy helper). */
export function motionSafe(variants: Variants, reduced: boolean): Variants {
  return reduced ? fade : variants;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * True when the primary pointer is coarse (touch). Hover affordances should
 * no-op here — a "lift on hover" is meaningless (and sticky) on touch.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(pointer: coarse)");
    const update = (): void => setCoarse(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return coarse;
}

export interface CountUpOptions {
  /** Tween length in seconds. Default 1.2s. Ignored when `spring` is set. */
  duration?: number;
  /** Fixed decimal places for the default formatter. Default 0 (integer). */
  decimals?: number;
  /** Custom display formatter (e.g. currency, suffixes). Overrides `decimals`. */
  format?: (value: number) => string;
  /**
   * Use a spring tween instead of a fixed-duration ease — a faster ramp with a
   * crisp settle for a more dramatic count. `true` uses a tuned default; pass a
   * partial spring to customize. Overshoot is negligible for the small integer
   * counts we display, so the number never visibly exceeds the target.
   */
  spring?: boolean | { stiffness?: number; damping?: number };
}

/**
 * Animate a number 0 → `target` once on mount, returning the formatted display
 * string. Reduced motion → returns the final value instantly (no tween).
 * Handles integers and formatted numbers via `decimals` / `format`, and an
 * optional spring ramp via `spring`.
 */
export function useCountUp(target: number, opts: CountUpOptions = {}): string {
  const reduced = useReducedMotion();
  const { duration = 1.2, decimals = 0, format, spring } = opts;
  const [value, setValue] = useState<number>(reduced ? target : 0);

  useEffect(() => {
    if (reduced) {
      setValue(target);
      return;
    }
    const onUpdate = (latest: number): void => setValue(latest);
    const controls = spring
      ? animate(0, target, {
          type: "spring",
          stiffness: typeof spring === "object" ? (spring.stiffness ?? 120) : 120,
          damping: typeof spring === "object" ? (spring.damping ?? 20) : 20,
          onUpdate,
        })
      : animate(0, target, { duration, ease: EASING.out, onUpdate });
    return () => controls.stop();
  }, [target, reduced, duration, spring]);

  const fmt =
    format ??
    ((n: number) =>
      n.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }));
  return fmt(value);
}
