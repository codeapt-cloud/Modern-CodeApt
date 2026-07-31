/**
 * Essay status + launch card. Renders a prompt's title, difficulty, word
 * bounds, time limit, last-attempt summary, and the attempt line, plus the
 * action: "Start writing"/"Write again" → the existing writer at
 * /essays/:essayTopicId, or a disabled "Limit reached". Shared by the Essays
 * page and the in-course essay topic so both surface the same feature
 * identically. All state comes from the `EssayPromptSummary` (GET /essays) —
 * no attempt/limit logic lives here (see `essayAttemptStatus`).
 */
import type { EssayPromptSummary } from "@codeapt/shared";
import { Clock, FileText, PenLine } from "lucide-react";
import { Link } from "react-router-dom";

import { essayAttemptStatus } from "../../lib/essay-compose.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";
import { DifficultyBadge, SourceBadge } from "./EssayBadges.js";

function wordBounds(item: EssayPromptSummary): string {
  if (item.minWords && item.maxWords) {
    return `${item.minWords}–${item.maxWords} words`;
  }
  if (item.minWords) return `min ${item.minWords} words`;
  if (item.maxWords) return `max ${item.maxWords} words`;
  return "no word limit";
}

export function EssayStatusCard({
  item,
  collegeSlug,
}: {
  item: EssayPromptSummary;
  /** When set, this is a COLLEGE essay → the writer uses the tenant endpoints
   * (passed through as `?c=<slug>`). Omitted for individual essays. */
  collegeSlug?: string;
}) {
  const last = item.lastAttempt;
  const graded = last?.status === "completed";
  const attempts = essayAttemptStatus(item.attemptsUsed, item.maxAttempts);
  const href = collegeSlug
    ? `/essays/${item.id}?c=${encodeURIComponent(collegeSlug)}`
    : `/essays/${item.id}`;

  return (
    <Card className="flex h-full flex-col">
      <CardContent className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-semibold text-ink">{item.title}</h3>
          <DifficultyBadge level={item.difficultyLevel} />
        </div>

        <p className="line-clamp-2 text-sm text-ink-muted">
          {item.description}
        </p>

        <div className="flex flex-wrap gap-4 text-xs text-ink-muted">
          <span className="inline-flex items-center gap-1">
            <FileText className="h-3.5 w-3.5" /> {wordBounds(item)}
          </span>
          {item.timeLimitMinutes > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> {item.timeLimitMinutes} min
            </span>
          ) : null}
        </div>

        {last ? (
          <div className="flex items-center gap-2 rounded-lg border border-subtle bg-surface-base p-3 text-xs">
            <span className="text-ink-muted">
              Last attempt #{last.attemptNumber}:
            </span>
            {graded && last.finalScore !== null ? (
              <>
                <span className="font-mono font-semibold text-ink">
                  {last.finalScore.toFixed(1)}/100
                </span>
                <SourceBadge source={last.source} />
              </>
            ) : (
              <span className="text-ink">{last.status}</span>
            )}
          </div>
        ) : null}

        <div className="mt-auto flex items-center justify-between gap-3">
          <span
            className={`text-xs ${attempts.atLimit ? "text-warning-fg" : "text-ink-muted"}`}
          >
            {attempts.label}
          </span>
          {attempts.atLimit ? (
            <Button size="sm" disabled title="No attempts remaining">
              <PenLine className="h-4 w-4" /> Limit reached
            </Button>
          ) : (
            <Button asChild size="sm">
              <Link to={href}>
                <PenLine className="h-4 w-4" />
                {last ? "Write again" : "Start writing"}
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
