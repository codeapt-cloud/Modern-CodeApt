/**
 * Read-only essay-attempt analytics detail (item 4-ii). Shows the attempt's
 * grading facts, the REAL stored compose signals, and an explicit "risk scoring
 * not yet computed" state — the rebuild persists the anti-cheat schema but no
 * model computes riskScore / suspiciousActivity, so those are flagged, never
 * presented as a finding.
 */
import type { AdminEssayAttemptAnalytics } from "@codeapt/shared";

import { api } from "../../../lib/api-client.js";
import { useQuery } from "../../../lib/use-query.js";
import { RiskBadge } from "../../essay/EssayBadges.js";
import { Alert } from "../../ui/alert.js";
import { Badge } from "../../ui/badge.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog.js";
import { Skeleton } from "../../ui/skeleton.js";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function Signal({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-subtle bg-surface-base p-3">
      <p className="font-mono text-lg font-bold text-ink">{value}</p>
      <p className="text-xs text-ink-muted">{label}</p>
    </div>
  );
}

export interface EssayAnalyticsDetailDialogProps {
  attemptId: string;
  onOpenChange: (open: boolean) => void;
}

export function EssayAnalyticsDetailDialog({
  attemptId,
  onOpenChange,
}: EssayAnalyticsDetailDialogProps) {
  const { data, loading, error } = useQuery<AdminEssayAttemptAnalytics>(
    () => api.adminEssayAnalytics.get(attemptId),
    [attemptId],
  );

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{data ? data.student : "Essay attempt"}</DialogTitle>
          <DialogDescription>
            {data ? data.topic : "Loading analytics…"}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <Skeleton className="h-72 w-full rounded-2xl" />
        ) : error ? (
          <Alert variant="error">{error}</Alert>
        ) : data ? (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="neutral">{data.status}</Badge>
              <Badge variant="neutral">Score {data.finalScore}</Badge>
              <Badge variant="neutral">{data.wordCount} words</Badge>
              <Badge variant="neutral">Submitted {fmtDate(data.submittedAt)}</Badge>
            </div>

            {/* --- Risk scoring: ADVISORY (computed from stored signals) --- */}
            <Alert
              variant={
                data.riskScoring.level === "high"
                  ? "error"
                  : data.riskScoring.level === "medium"
                    ? "warning"
                    : "info"
              }
              title="Anti-cheat risk (advisory)"
            >
              <div className="flex flex-wrap items-center gap-2">
                <RiskBadge
                  level={data.riskScoring.level}
                  score={data.riskScoring.riskScore}
                />
                <span className="text-xs text-ink-secondary">
                  Advisory only — a review aid, never a penalty or a change to
                  the grade.
                </span>
              </div>
              {data.riskScoring.reasons.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {data.riskScoring.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm">
                  {data.hasAnalytics
                    ? "No risk signals fired for this attempt."
                    : "No compose analytics were recorded, so there is nothing to assess."}
                </p>
              )}
            </Alert>

            {/* --- Real stored signals --- */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-ink">
                Compose signals
              </h3>
              {data.hasAnalytics && data.signals ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Signal label="Keystrokes" value={data.signals.keystrokes} />
                  <Signal label="Deletes" value={data.signals.deletes} />
                  <Signal label="Paste events" value={data.signals.pasteEvents} />
                  <Signal label="Pasted chars" value={data.signals.pastedChars} />
                  <Signal
                    label="Compose seconds"
                    value={data.signals.composeSeconds}
                  />
                  <Signal
                    label="Final words"
                    value={data.signals.finalWordCount}
                  />
                  <Signal
                    label="Final chars"
                    value={data.signals.finalCharacterCount}
                  />
                </div>
              ) : (
                <p className="text-xs text-ink-muted">
                  No analytics were recorded for this attempt (the compose
                  signals are optional and were never sent).
                </p>
              )}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
