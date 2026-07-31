import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "../../lib/cn.js";
import { Spinner } from "./spinner.js";

export const buttonVariants = cva(
  // Base — shared layout, focus ring, disabled, transition.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-50 select-none",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-ink-inverse hover:bg-primary-400 active:bg-primary-600 shadow-sm hover:shadow-glow",
        secondary:
          "bg-surface-overlay text-ink border border-strong hover:border-primary/60 hover:text-primary",
        ghost: "text-ink hover:bg-surface-overlay",
        outline:
          "border border-strong text-ink hover:border-primary hover:text-primary",
        destructive:
          "bg-error text-white hover:brightness-110 active:brightness-95 shadow-sm",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends
    ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild,
      loading,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    // Radix Slot (asChild) requires EXACTLY one child, so it can't host a
    // spinner sibling — render the child as-is and skip the loading affordance.
    if (asChild) {
      return (
        <Slot
          ref={ref}
          className={cn(buttonVariants({ variant, size }), className)}
          {...props}
        >
          {children}
        </Slot>
      );
    }
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled ?? loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Spinner size="sm" /> : null}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
