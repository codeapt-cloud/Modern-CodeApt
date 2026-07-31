/**
 * <SpotlightTilt> — a tactile hover affordance: the card tilts in 3D toward the
 * cursor and a soft radial "spotlight" follows the pointer across it. Built on
 * the pure {@link computeTilt} math + framer motion values (so pointer moves
 * never trigger React re-renders), rAF-throttled (one update per frame, no
 * jank), and GPU-friendly (transform + a CSS radial-gradient only).
 *
 * No-op — a plain static wrapper — under prefers-reduced-motion OR a coarse
 * (touch) pointer, where a cursor-follow tilt is meaningless. The children stay
 * fully interactive (the spotlight overlay is pointer-events-none).
 */
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useSpring,
  useReducedMotion,
} from "framer-motion";
import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";

import { cn } from "../../lib/cn.js";
import { useCoarsePointer } from "../../lib/motion.js";
import { computeTilt } from "../../lib/tilt.js";

/** Soft spring for the tilt/glow motion values (SpringOptions shape). */
const SPRING = { stiffness: 320, damping: 30, mass: 0.7 } as const;

export interface SpotlightTiltProps {
  children: ReactNode;
  className?: string;
  /** Peak tilt (deg) at an edge. Default 6. */
  maxDeg?: number;
  /** Spotlight radius in px. Default 240. */
  radius?: number;
}

export function SpotlightTilt({
  children,
  className,
  maxDeg = 6,
  radius = 240,
}: SpotlightTiltProps) {
  const reduced = useReducedMotion();
  const coarse = useCoarsePointer();
  const enabled = !reduced && !coarse;

  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef<number | undefined>(undefined);

  const rotateX = useSpring(0, SPRING);
  const rotateY = useSpring(0, SPRING);
  const spotX = useMotionValue(50);
  const spotY = useMotionValue(50);
  const glow = useSpring(0, SPRING);

  const background = useMotionTemplate`radial-gradient(${radius}px circle at ${spotX}% ${spotY}%, rgb(var(--color-primary-500) / 0.16), transparent 65%)`;

  // Cancel any pending frame on unmount.
  useEffect(() => {
    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    };
  }, []);

  if (!enabled) {
    return <div className={className}>{children}</div>;
  }

  const handleMove = (e: MouseEvent<HTMLDivElement>): void => {
    // Capture coords now; the synthetic event may be recycled before the frame.
    const { clientX, clientY } = e;
    if (frame.current !== undefined) return; // throttle: one update per frame
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const t = computeTilt(
        clientX - rect.left,
        clientY - rect.top,
        rect.width,
        rect.height,
        maxDeg,
      );
      rotateX.set(t.rotateX);
      rotateY.set(t.rotateY);
      spotX.set(t.spotlightX);
      spotY.set(t.spotlightY);
    });
  };

  const handleEnter = (): void => glow.set(1);
  const handleLeave = (): void => {
    rotateX.set(0);
    rotateY.set(0);
    glow.set(0);
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMove}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      style={{
        rotateX,
        rotateY,
        transformPerspective: 900,
        transformStyle: "preserve-3d",
        willChange: "transform",
      }}
      className={cn("relative", className)}
    >
      {children}
      <motion.span
        aria-hidden
        style={{ background, opacity: glow }}
        className="pointer-events-none absolute inset-0 rounded-[inherit]"
      />
    </motion.div>
  );
}
