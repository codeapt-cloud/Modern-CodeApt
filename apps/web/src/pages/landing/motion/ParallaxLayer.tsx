/**
 * <ParallaxLayer> — translates its content on page scroll to build layered
 * depth (background layers drift slower/against the content). Uses framer-motion
 * `useScroll` + `useTransform`, which drive a GPU-composited transform on the
 * rAF loop — cheap enough for 60fps on mid-range phones.
 *
 * Purely decorative depth: reduced motion (and — by intent — nothing here is
 * load-bearing) collapses to a static element. Hooks are always called; the
 * transform is simply not applied when motion is reduced (no conditional hooks).
 */
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { type ReactNode } from "react";

export interface ParallaxLayerProps {
  children: ReactNode;
  /**
   * Drift factor relative to scroll. Positive → moves down as you scroll down
   * (lags behind, reads as "further back"); negative → moves up (nearer).
   * Keep small (|speed| ≤ 0.3) so it stays a subtle depth cue, not a slide.
   */
  speed?: number;
  className?: string;
}

export function ParallaxLayer({
  children,
  speed = 0.15,
  className,
}: ParallaxLayerProps) {
  const reduced = useReducedMotion();
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, (v) => v * speed);

  return (
    <motion.div className={className} style={reduced ? undefined : { y }}>
      {children}
    </motion.div>
  );
}
