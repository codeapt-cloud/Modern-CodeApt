/**
 * Minimal prose primitives for the static content/legal pages — a readable
 * measure with token-driven ink colors. Keeps every informational page visually
 * consistent without pulling in a heavyweight typography plugin.
 */
import { type ReactNode } from "react";

import { cn } from "../../lib/cn.js";

export function Prose({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "space-y-6 leading-7 text-ink-secondary [&_p]:leading-7 [&_a]:text-primary [&_a:hover]:underline",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ProseSection({
  title,
  children,
}: {
  title?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      {title ? (
        <h2 className="text-lg font-semibold tracking-tight text-ink">
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  );
}
