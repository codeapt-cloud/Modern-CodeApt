/**
 * <ScrollReveal> — a scroll-triggered entrance (fade + rise/scale) that plays
 * ONCE as the element scrolls into view, via framer-motion's `whileInView`
 * (IntersectionObserver under the hood). Durations/easings come from the shared
 * motion tokens (lib/motion.ts) so landing motion matches the in-app language.
 *
 * Reduced motion → renders children statically (no transform, no opacity fade),
 * fully visible and functional. This is the landing's workhorse reveal; the
 * app's <Reveal> only plays on mount, whereas marketing sections must reveal on
 * scroll, so this is a thin scroll-aware sibling rather than a duplicate system.
 */
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { createElement, type ElementType, type ReactNode } from "react";

import { DURATION, EASING } from "../../../lib/motion.js";

export type ScrollRevealKind = "up" | "fade" | "scale";

const variantsMap: Record<ScrollRevealKind, Variants> = {
  up: { hidden: { opacity: 0, y: 24 }, visible: { opacity: 1, y: 0 } },
  fade: { hidden: { opacity: 0 }, visible: { opacity: 1 } },
  scale: {
    hidden: { opacity: 0, scale: 0.96 },
    visible: { opacity: 1, scale: 1 },
  },
};

export interface ScrollRevealProps {
  children: ReactNode;
  /** Entrance style. Default "up". */
  kind?: ScrollRevealKind;
  /** Delay in seconds (stagger a group by passing index * step). Default 0. */
  delay?: number;
  /** Fraction of the element visible before it triggers. Default 0.25. */
  amount?: number;
  as?: ElementType;
  className?: string;
}

export function ScrollReveal({
  children,
  kind = "up",
  delay = 0,
  amount = 0.25,
  as = "div",
  className,
}: ScrollRevealProps) {
  const reduced = useReducedMotion();

  if (reduced) {
    return createElement(as, { className }, children);
  }

  const MotionTag = motion[as as "div"] as typeof motion.div;
  return (
    <MotionTag
      className={className}
      variants={variantsMap[kind]}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount }}
      transition={{ duration: DURATION.slow, ease: EASING.out, delay }}
    >
      {children}
    </MotionTag>
  );
}
