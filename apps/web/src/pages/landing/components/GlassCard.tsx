/**
 * <GlassCard> — the landing's translucent, blurred, soft-shadowed surface used
 * for foreground panels layered over the hero aurora and feature visuals. Built
 * on the shared `.glass` token utility (backdrop-blur + themed glass bg/border)
 * so it reads identically to the in-app glass overlays — just larger radius and
 * a deeper elevation shadow for the "floating panel" feel.
 */
import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "../../../lib/cn.js";

export const GlassCard = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "glass rounded-3xl shadow-lg",
      // A hair more contrast on the glass edge for depth.
      "ring-1 ring-white/5",
      className,
    )}
    {...props}
  />
));
GlassCard.displayName = "GlassCard";
