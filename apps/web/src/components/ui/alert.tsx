import { cva, type VariantProps } from "class-variance-authority";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { type HTMLAttributes, type ReactNode } from "react";

import { cn } from "../../lib/cn.js";

const alertVariants = cva(
  "flex gap-3 rounded-xl border p-4 text-sm [&_svg]:h-5 [&_svg]:w-5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        info: "border-info/30 bg-info-subtle text-ink",
        success: "border-success/30 bg-success-subtle text-ink",
        warning: "border-warning/30 bg-warning-subtle text-ink",
        error: "border-error/30 bg-error-subtle text-ink",
      },
    },
    defaultVariants: { variant: "info" },
  },
);

const icons: Record<
  NonNullable<VariantProps<typeof alertVariants>["variant"]>,
  LucideIcon
> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

const iconColors = {
  info: "text-info-fg",
  success: "text-success-fg",
  warning: "text-warning-fg",
  error: "text-error-fg",
} as const;

export interface AlertProps
  extends
    Omit<HTMLAttributes<HTMLDivElement>, "title">,
    VariantProps<typeof alertVariants> {
  title?: ReactNode;
  icon?: boolean;
}

export function Alert({
  className,
  variant = "info",
  title,
  icon = true,
  children,
  ...props
}: AlertProps) {
  const v = variant ?? "info";
  const Icon = icons[v];
  return (
    <div
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      {icon ? <Icon className={iconColors[v]} /> : null}
      <div className="space-y-1">
        {title ? <p className="font-semibold text-ink">{title}</p> : null}
        {children ? <div className="text-ink-secondary">{children}</div> : null}
      </div>
    </div>
  );
}
