/**
 * Decorative `{ }` brace device for empty/loading states and section accents.
 * Renders large, low-emphasis braces (optionally wrapping content between them)
 * as the recurring CodeApt brand motif — subtle, not gimmicky.
 */
import type { ReactNode } from "react";

import { cn } from "../../lib/cn.js";

interface BraceMotifProps {
  children?: ReactNode;
  className?: string;
  /** Tailwind text-size class controlling brace scale. */
  size?: string;
}

export function BraceMotif({
  children,
  className,
  size = "text-5xl",
}: BraceMotifProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 font-mono text-primary/70 select-none",
        size,
        className,
      )}
      aria-hidden="true"
    >
      <span className="leading-none">{"{"}</span>
      {children ? (
        <span className="text-ink-muted text-base font-sans">{children}</span>
      ) : null}
      <span className="leading-none">{"}"}</span>
    </div>
  );
}
