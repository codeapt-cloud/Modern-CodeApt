/**
 * <HoverLift> — a card affordance that lifts and gains our `shadow-glow` token
 * on hover. No-op on touch (pointer: coarse) and reduced motion: renders a
 * plain, static wrapper with no lift and no glow.
 *
 * The lift (transform) runs through framer-motion; the glow uses the CSS
 * `shadow-glow` token via a hover utility, applied only when the affordance is
 * enabled — so reduced-motion / touch users get a completely static surface.
 */
import { motion, useReducedMotion } from "framer-motion";
import { type ReactNode } from "react";

import { cn } from "../../lib/cn.js";
import { transition, useCoarsePointer } from "../../lib/motion.js";

export interface HoverLiftProps {
  children: ReactNode;
  className?: string;
  /** Lift distance in px on hover. Default 4. */
  lift?: number;
}

export function HoverLift({ children, className, lift = 4 }: HoverLiftProps) {
  const reduced = useReducedMotion();
  const coarse = useCoarsePointer();
  const enabled = !reduced && !coarse;

  if (!enabled) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={cn(
        "transition-shadow duration-base ease-out hover:shadow-glow",
        className,
      )}
      whileHover={{ y: -lift }}
      transition={transition.fast}
    >
      {children}
    </motion.div>
  );
}
