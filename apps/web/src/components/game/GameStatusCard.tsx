/**
 * A game set as a list row — title, how many games, attempts remaining, and a
 * Play action. A set with a finite attempt cap fully used is visibly
 * unstartable (mirrors ExamStatusCard's "Attempt limit reached").
 */
import type { GamePlayListItem } from "@codeapt/shared";
import { Gamepad2 } from "lucide-react";
import { Link } from "react-router-dom";

import { attemptsLeft, canStartSet } from "../../lib/game-runner.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";

export function GameStatusCard({
  item,
  href,
}: {
  item: GamePlayListItem;
  href: string;
}): JSX.Element {
  const left = attemptsLeft(item);
  const canStart = canStartSet(item);
  return (
    <Card>
      <CardContent className="flex h-full flex-col gap-4 p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Gamepad2 className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="truncate font-medium text-ink">{item.title}</h3>
            {item.description ? (
              <p className="line-clamp-2 text-sm text-ink-muted">
                {item.description}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="neutral">
            {item.totalGames} game{item.totalGames === 1 ? "" : "s"}
          </Badge>
          {item.perQuestionTimerSeconds > 0 ? (
            <Badge variant="neutral">
              {item.perQuestionTimerSeconds}s / question
            </Badge>
          ) : null}
        </div>

        <div className="mt-auto flex items-center justify-between pt-2">
          <span className="text-xs text-ink-muted">
            {left === null
              ? "Unlimited attempts"
              : `${left} attempt${left === 1 ? "" : "s"} left`}
          </span>
          {canStart ? (
            <Button asChild size="sm">
              <Link to={href}>
                {item.attemptsUsed > 0 ? "Play again" : "Play"}
              </Link>
            </Button>
          ) : (
            <Button size="sm" disabled title="No attempts remaining">
              No attempts left
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
