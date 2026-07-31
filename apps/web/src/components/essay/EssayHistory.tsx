/**
 * Submission history for a prompt (GET /essays/:id/submissions), newest first.
 * A graded attempt is clickable to re-show its result (re-polls its jobId).
 */
import type { EssaySubmissionSummary } from "@codeapt/shared";
import { History } from "lucide-react";

import { GradingStatusBadge, SourceBadge } from "./EssayBadges.js";

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function EssayHistory({
  items,
  onOpen,
}: {
  items: EssaySubmissionSummary[];
  onOpen: (jobId: string) => void;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-ink-muted">No submissions yet.</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((s) => {
        const graded = s.status === "completed";
        const clickable = graded && s.jobId;
        return (
          <li key={s.id}>
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && s.jobId && onOpen(s.jobId)}
              className={`flex w-full items-center justify-between gap-3 rounded-lg border border-subtle bg-surface-base p-3 text-left text-sm ${
                clickable
                  ? "cursor-pointer hover:border-primary/40"
                  : "cursor-default opacity-90"
              }`}
            >
              <div className="flex items-center gap-2">
                <History className="h-3.5 w-3.5 text-ink-muted" />
                <span className="text-ink">Attempt #{s.attemptNumber}</span>
                <GradingStatusBadge status={s.status} />
                {graded ? <SourceBadge source={s.source} /> : null}
              </div>
              <div className="flex items-center gap-3 text-xs text-ink-muted">
                <span>{s.wordCount} words</span>
                {graded && s.finalScore !== null ? (
                  <span className="font-mono font-semibold text-ink">
                    {s.finalScore.toFixed(1)}/100
                  </span>
                ) : null}
                <span>{fmtTime(s.submittedAt)}</span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
