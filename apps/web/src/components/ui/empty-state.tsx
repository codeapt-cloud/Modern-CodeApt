import { type ReactNode } from "react";

import { cn } from "../../lib/cn.js";

/**
 * Empty state built around the `{ }` brace motif — the recurring brand device.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-strong bg-surface-base px-6 py-14 text-center",
        className,
      )}
    >
      <div
        className="flex items-center gap-2 font-mono text-4xl text-primary/60 select-none"
        aria-hidden="true"
      >
        <span>{"{"}</span>
        <span className="text-ink-muted [&_svg]:h-6 [&_svg]:w-6">{icon}</span>
        <span>{"}"}</span>
      </div>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {description ? (
        <p className="max-w-sm text-sm text-ink-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
