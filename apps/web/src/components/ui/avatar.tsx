import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn.js";

const sizes = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-base",
} as const;

export interface AvatarProps extends ComponentPropsWithoutRef<
  typeof AvatarPrimitive.Root
> {
  src?: string;
  name?: string;
  size?: keyof typeof sizes;
}

function initials(name?: string): string {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() ?? "")
    .join("");
}

export const Avatar = forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  AvatarProps
>(({ className, src, name, size = "md", ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn(
      "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-subtle bg-surface-overlay",
      sizes[size],
      className,
    )}
    {...props}
  >
    <AvatarPrimitive.Image
      src={src}
      alt={name ?? ""}
      className="h-full w-full object-cover"
    />
    <AvatarPrimitive.Fallback className="flex h-full w-full items-center justify-center font-medium text-ink-secondary">
      {initials(name)}
    </AvatarPrimitive.Fallback>
  </AvatarPrimitive.Root>
));
Avatar.displayName = "Avatar";
