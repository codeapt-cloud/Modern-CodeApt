/**
 * Small server-authoritative display bits for the game runner: the adaptive
 * ladder rung, the countdown, and the running score. Kept dumb — all values are
 * passed in by the runner, which owns the clock and score state.
 */
import type { GameDifficulty } from "@codeapt/shared";

import { cn } from "../../lib/cn.js";
import { formatClock, LADDER, ladderIndex } from "../../lib/game-runner.js";

const RUNG_LABEL: Record<GameDifficulty, string> = {
  easy: "Easy",
  moderate: "Moderate",
  hard: "Hard",
};

/** Three rungs, the current one lit — a student should SEE they moved up. */
export function GameLadder({
  difficulty,
}: {
  difficulty: GameDifficulty;
}): JSX.Element {
  const active = ladderIndex(difficulty);
  return (
    <div
      className="flex items-center gap-1.5"
      aria-label={`Difficulty: ${RUNG_LABEL[difficulty]}`}
    >
      {LADDER.map((rung, i) => (
        <span
          key={rung}
          title={RUNG_LABEL[rung]}
          className={cn(
            "h-2 rounded-full transition-all",
            i === active ? "w-8" : "w-4",
            i <= active
              ? i === 2
                ? "bg-primary"
                : "bg-primary/60"
              : "bg-surface-sunken",
          )}
        />
      ))}
      <span className="ml-1.5 text-xs font-medium text-ink-muted">
        {RUNG_LABEL[difficulty]}
      </span>
    </div>
  );
}

/** Countdown with calm color tiers (no pulse — reduced-motion safe by default). */
export function GameClock({
  seconds,
  label,
}: {
  seconds: number;
  label?: string;
}): JSX.Element {
  const tier =
    seconds <= 10
      ? "text-error"
      : seconds <= 30
        ? "text-warning"
        : "text-ink";
  return (
    <div className="flex flex-col items-end leading-none">
      {label ? (
        <span className="text-[10px] uppercase tracking-wide text-ink-muted">
          {label}
        </span>
      ) : null}
      <span className={cn("font-mono text-lg font-semibold tabular-nums", tier)}>
        {formatClock(seconds)}
      </span>
    </div>
  );
}

export function GameScore({ score }: { score: number }): JSX.Element {
  return (
    <div className="flex flex-col items-end leading-none">
      <span className="text-[10px] uppercase tracking-wide text-ink-muted">
        Score
      </span>
      <span className="font-mono text-lg font-semibold tabular-nums text-ink">
        {score}
      </span>
    </div>
  );
}
