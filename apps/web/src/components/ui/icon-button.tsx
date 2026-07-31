import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cn } from "../../lib/cn.js";
import { Spinner } from "./spinner.js";

const iconButtonVariants = cva(
  "inline-flex items-center justify-center rounded-lg transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-primary text-ink-inverse hover:bg-primary-400",
        ghost: "text-ink-secondary hover:bg-surface-overlay hover:text-ink",
        outline:
          "border border-strong text-ink hover:border-primary hover:text-primary",
      },
      size: { sm: "h-8 w-8", md: "h-10 w-10", lg: "h-12 w-12" },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  },
);

export interface IconButtonProps
  extends
    ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButtonVariants> {
  /** Required for accessibility — icon-only buttons need a name. */
  "aria-label": string;
  icon: ReactNode;
  loading?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant, size, icon, loading, disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(iconButtonVariants({ variant, size }), className)}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner size="sm" /> : icon}
    </button>
  ),
);
IconButton.displayName = "IconButton";
