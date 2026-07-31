import { type HTMLAttributes, type ReactNode } from "react";

import { cn } from "../../lib/cn.js";

export interface SectionProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "title"
> {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Prefix the heading with the `{ }` brace brand device. */
  braced?: boolean;
}

export function Section({
  title,
  description,
  actions,
  braced,
  className,
  children,
  ...props
}: SectionProps) {
  return (
    <section className={cn("space-y-4", className)} {...props}>
      {title || actions ? (
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            {title ? (
              <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-ink">
                {braced ? (
                  <span className="font-mono text-primary" aria-hidden="true">
                    {"{"}
                  </span>
                ) : null}
                {title}
                {braced ? (
                  <span className="font-mono text-primary" aria-hidden="true">
                    {"}"}
                  </span>
                ) : null}
              </h2>
            ) : null}
            {description ? (
              <p className="text-sm text-ink-muted">{description}</p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex items-center gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
