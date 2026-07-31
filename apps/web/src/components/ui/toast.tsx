/**
 * Toast — imperative API on top of Radix Toast.
 *
 * Wrap the app in <ToastProvider> (it also mounts the viewport), then call
 * `const { toast } = useToast(); toast({ title, description, variant })`.
 * The imperative shape is what later features (e.g. exam anti-cheat alerts)
 * need to fire notifications from anywhere.
 */
import * as ToastPrimitive from "@radix-ui/react-toast";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { cn } from "../../lib/cn.js";

export type ToastVariant = "default" | "success" | "error" | "warning" | "info";

export interface ToastOptions {
  title: ReactNode;
  description?: ReactNode;
  variant?: ToastVariant;
  /** ms; defaults to 5000. Use a longer value for critical alerts. */
  duration?: number;
}

interface ToastRecord extends ToastOptions {
  id: string;
}

interface ToastContextValue {
  toast: (opts: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const variantIcon: Record<ToastVariant, LucideIcon | null> = {
  default: null,
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const variantAccent: Record<ToastVariant, string> = {
  default: "border-l-primary",
  success: "border-l-success",
  error: "border-l-error",
  warning: "border-l-warning",
  info: "border-l-info",
};

const iconColor: Record<ToastVariant, string> = {
  default: "text-primary",
  success: "text-success-fg",
  error: "text-error-fg",
  warning: "text-warning-fg",
  info: "text-info-fg",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((opts: ToastOptions) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, variant: "default", ...opts }]);
    return id;
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ toast, dismiss }),
    [toast, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        {toasts.map((t) => {
          const variant = t.variant ?? "default";
          const Icon = variantIcon[variant];
          return (
            <ToastPrimitive.Root
              key={t.id}
              duration={t.duration ?? 5000}
              onOpenChange={(open) => {
                if (!open) dismiss(t.id);
              }}
              className={cn(
                "group pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-xl border border-subtle border-l-4 bg-surface-overlay p-4 pr-9 shadow-lg",
                "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-right data-[state=closed]:fade-out-0",
                variantAccent[variant],
              )}
            >
              {Icon ? (
                <Icon
                  className={cn("mt-0.5 h-5 w-5 shrink-0", iconColor[variant])}
                />
              ) : null}
              <div className="flex-1 space-y-1">
                <ToastPrimitive.Title className="text-sm font-semibold text-ink">
                  {t.title}
                </ToastPrimitive.Title>
                {t.description ? (
                  <ToastPrimitive.Description className="text-sm text-ink-muted">
                    {t.description}
                  </ToastPrimitive.Description>
                ) : null}
              </div>
              <ToastPrimitive.Close
                aria-label="Dismiss"
                className="absolute right-3 top-3 rounded-md p-0.5 text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:shadow-focus"
              >
                <X className="h-4 w-4" />
              </ToastPrimitive.Close>
            </ToastPrimitive.Root>
          );
        })}
        <ToastPrimitive.Viewport className="fixed bottom-0 right-0 z-toast flex w-full max-w-sm flex-col gap-2 p-4 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
