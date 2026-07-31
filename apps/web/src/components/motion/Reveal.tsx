/**
 * <Reveal> — plays an on-mount entrance variant ONCE (initial → animate, so it
 * does not replay on re-render). Reduced motion → renders children statically
 * (no transform, no opacity animation), still fully functional.
 */
import { motion, useReducedMotion } from "framer-motion";
import { createElement, type ElementType, type ReactNode } from "react";

import { revealVariants, transition, type RevealVariantName } from "../../lib/motion.js";

export interface RevealProps {
  children: ReactNode;
  /** Entrance variant. Default "fadeInUp". */
  variant?: RevealVariantName;
  /** Delay before the entrance, in seconds. Default 0. */
  delay?: number;
  /** Element/tag to render. Default "div". */
  as?: ElementType;
  className?: string;
}

export function Reveal({
  children,
  variant = "fadeInUp",
  delay = 0,
  as = "div",
  className,
}: RevealProps) {
  const reduced = useReducedMotion();

  // Reduced motion: static element, no animation, immediately visible.
  if (reduced) {
    return createElement(as, { className }, children);
  }

  // `motion[as]` is a valid runtime proxy for any intrinsic tag; the cast gives
  // it the fully-typed motion prop surface of `motion.div`.
  const MotionTag = motion[as as "div"] as typeof motion.div;

  return (
    <MotionTag
      className={className}
      variants={revealVariants[variant]}
      initial="hidden"
      animate="visible"
      transition={{ ...transition.base, delay }}
    >
      {children}
    </MotionTag>
  );
}
