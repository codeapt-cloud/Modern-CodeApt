/**
 * Game-attempt results — composite score + per-game breakdown, mirroring the
 * exam ResultsReview's visual language (centered composite header, per-item
 * cards). Practice-mode per-item review is shown live in the runner's feedback
 * step, so results stays a clean summary.
 */
import type { GameKey, GameResult } from "@codeapt/shared";
import { CheckCircle2 } from "lucide-react";

import { GAME_COPY } from "../../lib/game-copy.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";

export function GameResults({
  result,
  onExit,
}: {
  result: GameResult;
  onExit: () => void;
}): JSX.Element {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-6 flex flex-col items-center gap-3 rounded-2xl border border-subtle bg-surface-raised p-6">
        <CheckCircle2 className="h-10 w-10 text-primary" aria-hidden />
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-4xl font-bold text-ink">
            {result.compositeScore}
          </span>
          <span className="text-lg text-ink-muted">points</span>
        </div>
        <Badge variant="success">
          {result.games.length} game{result.games.length === 1 ? "" : "s"}{" "}
          completed
        </Badge>
      </div>

      <ul className="space-y-3">
        {result.games.map((g) => (
          <li
            key={g.gameIndex}
            className="rounded-2xl border border-subtle bg-surface-raised p-5"
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-medium text-ink">
                {GAME_COPY[g.gameKey as GameKey]?.name ?? g.gameKey}
              </h3>
              <span className="font-mono text-sm text-ink-muted">
                {g.score} pts
              </span>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-muted">
              <span>Served: {g.questionsServed}</span>
              <span>Attempted: {g.questionsAttempted}</span>
              <span>Correct: {g.questionsCorrect}</span>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex justify-center">
        <Button onClick={onExit}>Back to games</Button>
      </div>
    </div>
  );
}
