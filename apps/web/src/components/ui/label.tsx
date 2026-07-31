import * as LabelPrimitive from "@radix-ui/react-label";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn.js";

export const Label = forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & { required?: boolean }
>(({ className, children, required, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      "text-sm font-medium text-ink-secondary peer-disabled:opacity-60",
      className,
    )}
    {...props}
  >
    {children}
    {required ? <span className="ml-0.5 text-error-fg">*</span> : null}
  </LabelPrimitive.Root>
));
Label.displayName = "Label";
