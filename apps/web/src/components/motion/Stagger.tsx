/**
 * <Stagger> / <StaggerItem> — a container that reveals its children one-by-one
 * on mount. Reduced motion → all children are static and visible immediately
 * (no cascade), still fully functional.
 *
 * Wrap each child in <StaggerItem> (or pass your own motion children that use
 * the "hidden"/"visible" variant names).
 */
import {
  motion,
  useReducedMotion,
  type Transition,
  type Variants,
} from "framer-motion";
import { createElement, type ElementType, type ReactNode } from "react";

import { staggerContainer, staggerItem, transition } from "../../lib/motion.js";

export interface StaggerProps {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  /** Override the container timing (e.g. staggerContainerFast). */
  container?: Variants;
}

export function Stagger({
  children,
  as = "div",
  className,
  container = staggerContainer,
}: StaggerProps) {
  const reduced = useReducedMotion();

  if (reduced) {
    return createElement(as, { className }, children);
  }

  const MotionTag = motion[as as "div"] as typeof motion.div;
  return (
    <MotionTag
      className={className}
      variants={container}
      initial="hidden"
      animate="visible"
    >
      {children}
    </MotionTag>
  );
}

export interface StaggerItemProps {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  /** Override the per-child entrance variant (e.g. springUp). */
  variant?: Variants;
  /** Override the per-child transition (e.g. springSoft for an energetic feel). */
  transition?: Transition;
}

export function StaggerItem({
  children,
  as = "div",
  className,
  variant = staggerItem,
  transition: itemTransition = transition.base,
}: StaggerItemProps) {
  const reduced = useReducedMotion();

  if (reduced) {
    return createElement(as, { className }, children);
  }

  const MotionTag = motion[as as "div"] as typeof motion.div;
  return (
    <MotionTag
      className={className}
      variants={variant}
      transition={itemTransition}
    >
      {children}
    </MotionTag>
  );
}
