import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";

import { cn } from "../../lib/cn.js";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /** Optional leading adornment (e.g. an icon). */
  leading?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, leading, ...props }, ref) => {
    const field = (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          "h-10 w-full rounded-lg border bg-surface-raised px-3 text-sm text-ink transition-colors duration-fast",
          "placeholder:text-ink-muted",
          "focus-visible:outline-none focus-visible:border-primary focus-visible:shadow-focus",
          "disabled:cursor-not-allowed disabled:opacity-60",
          invalid ? "border-error focus-visible:border-error" : "border-strong",
          leading ? "pl-9" : undefined,
          className,
        )}
        {...props}
      />
    );

    if (!leading) return field;
    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted [&_svg]:h-4 [&_svg]:w-4">
          {leading}
        </span>
        {field}
      </div>
    );
  },
);
Input.displayName = "Input";
