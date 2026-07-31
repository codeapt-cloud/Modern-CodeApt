/**
 * Streak / score summary shown on the Daily Challenge page. Current streak is
 * the hero stat (🔥), with max streak and lifetime score alongside.
 *
 * The numbers count up once on mount (Step-1 useCountUp — instant final value
 * under reduced motion), and the accent icon does a single, non-looping pulse
 * on mount (suppressed under reduced motion).
 */
import type { StreakInfo } from "@codeapt/shared";
import { motion, useReducedMotion } from "framer-motion";
import { Flame, Star, Trophy } from "lucide-react";

import { DURATION, EASING, useCountUp } from "../../lib/motion.js";
import { Card } from "../ui/card.js";

function Stat({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent?: boolean;
}) {
  const reduced = useReducedMotion();
  const display = useCountUp(value);
  const pulse = accent && !reduced;

  return (
    <div className="flex items-center gap-3">
      <motion.div
        className={
          accent
            ? "flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary"
            : "flex h-10 w-10 items-center justify-center rounded-xl bg-surface-overlay text-ink-muted"
        }
        initial={pulse ? { scale: 0.85 } : false}
        animate={pulse ? { scale: [0.85, 1.12, 1] } : undefined}
        transition={{ duration: DURATION.slow, ease: EASING.out }}
      >
        {icon}
      </motion.div>
      <div>
        <p className="font-mono text-xl font-bold leading-none text-ink">
          {display}
        </p>
        <p className="mt-1 text-xs text-ink-muted">{label}</p>
      </div>
    </div>
  );
}

export function StreakWidget({ streak }: { streak: StreakInfo }) {
  return (
    <Card className="flex flex-wrap items-center justify-around gap-6 p-5">
      <Stat
        icon={<Flame className="h-5 w-5" />}
        label="Current streak"
        value={streak.currentStreak}
        accent
      />
      <Stat
        icon={<Trophy className="h-5 w-5" />}
        label="Best streak"
        value={streak.maxStreak}
      />
      <Stat
        icon={<Star className="h-5 w-5" />}
        label="Total score"
        value={streak.totalScore}
      />
    </Card>
  );
}
