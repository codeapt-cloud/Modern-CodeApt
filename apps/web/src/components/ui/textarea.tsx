import { forwardRef, type TextareaHTMLAttributes } from "react";

import { cn } from "../../lib/cn.js";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, ...props }, ref) => (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        "min-h-24 w-full rounded-lg border bg-surface-raised px-3 py-2 text-sm text-ink transition-colors duration-fast",
        "placeholder:text-ink-muted resize-y",
        "focus-visible:outline-none focus-visible:border-primary focus-visible:shadow-focus",
        "disabled:cursor-not-allowed disabled:opacity-60",
        invalid ? "border-error" : "border-strong",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
