import { cva, type VariantProps } from "class-variance-authority";
import { type HTMLAttributes } from "react";

import { cn } from "../../lib/cn.js";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        primary: "border-transparent bg-primary/15 text-primary",
        neutral: "border-subtle bg-surface-overlay text-ink-secondary",
        success: "border-transparent bg-success-subtle text-success-fg",
        warning: "border-transparent bg-warning-subtle text-warning-fg",
        error: "border-transparent bg-error-subtle text-error-fg",
        info: "border-transparent bg-info-subtle text-info-fg",
        outline: "border-strong text-ink-secondary",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
