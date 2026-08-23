/**
 * Pre-flight / tutorial shown before EACH game in the sequence — a product
 * requirement (students lose marks to unfamiliar mechanics), not polish.
 *
 * The clock is STOPPED here: the server starts a game's `expiresAt` at serve
 * time (inside start/advance), so the runner defers that call to this screen's
 * "Start". Consequently the server-authoritative skip/clock/per-item values are
 * not yet known here (knowing them means serving, which starts the clock) — they
 * appear in the runner header the instant play begins. This screen shows the
 * game's name + mechanics (static copy) and the set-level facts we DO have.
 * See the step report (c) for the timing note.
 */
import type { GameKey } from "@codeapt/shared";

import { GAME_COPY } from "../../lib/game-copy.js";
import { Reveal } from "../motion/index.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";

export function GameTutorial({
  gameKey,
  gameNumber,
  totalGames,
  practiceMode,
  busy,
  onStart,
}: {
  gameKey: GameKey;
  gameNumber: number;
  totalGames: number;
  practiceMode: boolean;
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
              {practiceMode ? (
                <Badge variant="info">Practice mode</Badge>
              ) : null}
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl font-semibold text-ink">{copy.name}</h1>
              <p className="text-ink-muted">{copy.asks}</p>
            </div>

            <div className="rounded-xl border border-subtle bg-surface-sunken p-4">
              <h2 className="mb-1 text-sm font-semibold text-ink">How to play</h2>
              <p className="text-sm text-ink-muted">{copy.how}</p>
            </div>

            <ul className="space-y-1.5 text-sm text-ink-muted">
              <li>
                The countdown, difficulty, and whether you can skip are shown at
                the top once the round begins.
              </li>
              <li>
                Answer as many questions as you can — correct answers raise the
                difficulty (and the marks on offer); wrong ones lower it.
              </li>
              {practiceMode ? (
                <li>
                  In practice mode you’ll see the correct answer after each
                  question.
                </li>
              ) : null}
            </ul>

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
