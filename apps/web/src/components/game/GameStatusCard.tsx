/**
 * A game set as a list row — title, how many games, attempts remaining, and a
 * Play action. A set with a finite attempt cap fully used is visibly
 * unstartable (mirrors ExamStatusCard's "Attempt limit reached").
 */
import type { GamePlayListItem } from "@codeapt/shared";
import { Gamepad2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../../lib/api-client.js";
import { attemptsLeft, canStartSet } from "../../lib/game-runner.js";
import { useQuery } from "../../lib/use-query.js";
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
  // Past attempts (G3) — lazy-loaded on expand so the list view stays cheap. The
  // student sees what they scored on a finished set; an in-progress attempt is
  // resumed via the SAME play link (Step 22 resume-or-start), not a new flow.
  const [showHistory, setShowHistory] = useState(false);
  const history = useQuery(
    () =>
      showHistory
        ? api.games.myAttempts(item.id)
        : Promise.resolve({ gameSetId: item.id, items: [] }),
    [showHistory, item.id],
  );
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

        {item.attemptsUsed > 0 ? (
          <div className="border-t border-subtle pt-2">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="text-xs text-ink-muted hover:text-ink"
            >
              {showHistory ? "Hide past attempts" : "View past attempts"}
            </button>
            {showHistory ? (
              history.loading ? (
                <p className="mt-2 text-xs text-ink-muted">Loading…</p>
              ) : history.error ? (
                <p className="mt-2 text-xs text-red-600">{history.error}</p>
              ) : (history.data?.items.length ?? 0) === 0 ? (
                <p className="mt-2 text-xs text-ink-muted">No past attempts.</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {history.data!.items.map((a) => (
                    <li
                      key={a.attemptId}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="text-ink-muted">
                        {new Date(a.startedAt).toLocaleDateString()}
                      </span>
                      {a.status === "graded" ? (
                        <span className="font-medium text-ink">
                          Score {a.compositeScore}
                        </span>
                      ) : a.status === "in_progress" ? (
                        <Link to={href} className="text-primary hover:underline">
                          Resume
                        </Link>
                      ) : (
                        <span className="text-ink-muted">Abandoned</span>
                      )}
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
