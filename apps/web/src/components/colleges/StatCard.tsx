/**
 * Headline stat card — an icon tile + a spring count-up number (with optional
 * suffix) + label/hint, on the dashboard's Card with its hover-glow. Extracted
 * from CollegeDashboardPage so the analytics dashboard (Phase 5a-ii) renders the
 * SAME card/motion language — one component, no divergence. Count-up + hover are
 * reduced-motion aware (via useCountUp / useReducedMotion).
 */
import { motion, useReducedMotion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

import { transition, useCountUp } from "../../lib/motion.js";
import { Card } from "../ui/card.js";
import { Skeleton } from "../ui/skeleton.js";

export interface StatCardProps {
  icon: LucideIcon;
  label: string;
  /** Integer value to count up to. */
  value: number;
  /** Static suffix after the counted number (e.g. "%" or "/ 9"). */
  suffix?: string;
  hint?: string;
  loading?: boolean;
  /** Decimal places for the counted number (default 0 = integer). */
  decimals?: number;
}

export function StatCard({
  icon: Icon,
  label,
  value,
  suffix,
  hint,
  loading,
  decimals = 0,
}: StatCardProps) {
  const reduced = useReducedMotion();
  // Dramatic count-up: a spring ramp with a crisp settle. Instant when reduced.
  const display = useCountUp(value, { spring: true, decimals });

  return (
    <Card className="group h-full p-5 shadow-sm transition-shadow duration-base ease-out hover:shadow-[0_16px_44px_-18px_rgb(var(--color-primary-500)/0.5)]">
      <div className="flex items-center gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/30 to-primary/5 text-primary ring-1 ring-inset ring-primary/25 shadow-[0_0_22px_-6px_rgb(var(--color-primary-500)/0.7)] transition-transform duration-base ease-out group-hover:scale-105">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          {loading ? (
            <Skeleton className="h-9 w-16" />
          ) : (
            <motion.p
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={transition.base}
              className="flex items-baseline text-3xl font-extrabold leading-none text-ink tabular-nums"
            >
              {display}
              {suffix ? (
                <span className="ml-1 text-lg font-bold text-ink-muted">
                  {suffix}
                </span>
              ) : null}
            </motion.p>
          )}
          <p className="mt-1.5 truncate text-sm text-ink-muted">{label}</p>
          {hint ? (
            <p className="truncate text-[11px] text-ink-muted">{hint}</p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
