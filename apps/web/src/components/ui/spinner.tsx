import { Loader2 } from "lucide-react";

import { cn } from "../../lib/cn.js";

const sizes = { sm: "h-4 w-4", md: "h-5 w-5", lg: "h-7 w-7" } as const;

export interface SpinnerProps {
  size?: keyof typeof sizes;
  className?: string;
  label?: string;
}

export function Spinner({
  size = "md",
  className,
  label = "Loading",
}: SpinnerProps) {
  return (
    <Loader2
      role="status"
      aria-label={label}
      className={cn("animate-spin text-primary", sizes[size], className)}
    />
  );
}
