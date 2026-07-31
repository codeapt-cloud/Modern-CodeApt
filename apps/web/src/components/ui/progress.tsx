import * as ProgressPrimitive from "@radix-ui/react-progress";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn.js";

export const Progress = forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & { value?: number }
>(({ className, value = 0, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn(
      "relative h-2 w-full overflow-hidden rounded-full bg-surface-sunken",
      className,
    )}
    value={value}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className="h-full w-full flex-1 rounded-full bg-primary transition-transform duration-slow ease-standard"
      style={{
        transform: `translateX(-${100 - Math.min(100, Math.max(0, value))}%)`,
      }}
    />
  </ProgressPrimitive.Root>
));
Progress.displayName = "Progress";
