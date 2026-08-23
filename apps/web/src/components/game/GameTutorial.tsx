/**
 * Pre-flight / tutorial shown before EACH game — a product requirement (students
 * lose marks to unfamiliar mechanics), not polish.
 *
 * Step 7b: the clock is STOPPED here AND the screen now shows the SERVER's own
 * facts. The runner reaches this screen via start/advance with serve:false (no
 * clock, no item), so this tutorial can display the authoritative allowSkip,
 * round-clock length, and per-item limit from GameInfo; the clock only begins
 * when "Start" calls `begin`.
 */
import type { GameKey } from "@codeapt/shared";

import { GAME_COPY } from "../../lib/game-copy.js";
import { formatClock } from "../../lib/game-runner.js";
import { Reveal } from "../motion/index.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";

export function GameTutorial({
  gameKey,
  gameNumber,
  totalGames,
  practiceMode,
  allowSkip,
  durationSeconds,
  itemSeconds,
  busy,
  onStart,
}: {
  gameKey: GameKey;
  gameNumber: number;
  totalGames: number;
  practiceMode: boolean;
  allowSkip: boolean;
  durationSeconds: number;
  itemSeconds: number | null;
  busy: boolean;
  onStart: () => void;
}): JSX.Element {
  const copy = GAME_COPY[gameKey];
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-xl items-center px-4">
      <Reveal variant="fadeInUp" className="w-full">
        <Card>
          <CardContent className="flex flex-col gap-6 p-8">
            <div className="flex items-center justify-between">
              <Badge variant="neutral">
                Game {gameNumber} of {totalGames}
              </Badge>
              {practiceMode ? <Badge variant="info">Practice mode</Badge> : null}
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl font-semibold text-ink">{copy.name}</h1>
              <p className="text-ink-muted">{copy.asks}</p>
            </div>

            <div className="rounded-xl border border-subtle bg-surface-sunken p-4">
              <h2 className="mb-1 text-sm font-semibold text-ink">How to play</h2>
              <p className="text-sm text-ink-muted">{copy.how}</p>
            </div>

            {/* Server-authoritative facts (Step 7b/A1) — no longer guesses. */}
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Fact label="Round time" value={formatClock(durationSeconds)} />
              <Fact
                label="Per question"
                value={itemSeconds !== null ? `${itemSeconds}s` : "No limit"}
              />
              <Fact label="Skip" value={allowSkip ? "Allowed" : "Not allowed"} />
              <Fact
                label="Feedback"
                value={practiceMode ? "After each answer" : "At the end"}
              />
            </dl>

            <div className="flex flex-col items-stretch gap-2">
              <Button size="lg" loading={busy} onClick={onStart}>
                Start — the clock begins now
              </Button>
              <p className="text-center text-xs text-ink-muted">
                The timer does not run while this screen is open.
              </p>
            </div>
          </CardContent>
        </Card>
      </Reveal>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-subtle bg-surface-base px-3 py-2">
      <dt className="text-[10px] uppercase tracking-wide text-ink-muted">
        {label}
      </dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}
