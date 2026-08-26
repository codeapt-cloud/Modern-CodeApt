/**
 * The in-place result view for a history row — rendered inside the history
 * drawer for the modules that have no standalone result page (exam / speaking /
 * game). Each module is its OWN sub-component so its data hook is called
 * unconditionally (React hook rules); the parent just switches on module. All
 * three REUSE the module's existing per-attempt result read + render component —
 * no new result endpoints. The reads are ownership-authorized and (for exam /
 * game) surface-agnostic; speaking picks the college vs global engine by surface.
 */
import type { HistoryEntry } from "@codeapt/shared";

import { GameResults } from "../game/GameResults.js";
import { SpeakingResults } from "../speaking/SpeakingResults.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Skeleton } from "../ui/skeleton.js";
import { api } from "../../lib/api-client.js";
import {
  collegeSpeakingEngine,
  globalSpeakingEngine,
} from "../../lib/speaking-engine.js";
import { useQuery } from "../../lib/use-query.js";

function Loading(): JSX.Element {
  return <Skeleton className="h-40 w-full rounded-2xl" />;
}

function ExamResultDetail({ attemptId }: { attemptId: string }): JSX.Element {
  const q = useQuery(() => api.exams.result(attemptId), [attemptId]);
  if (q.loading) return <Loading />;
  if (q.error) return <Alert variant="error">{q.error}</Alert>;
  const r = q.data;
  if (!r) return <Alert variant="warning">Result unavailable.</Alert>;
  if (r.resultsHidden) {
    return (
      <Alert variant="info">
        Your college hasn’t published results for this exam yet. Your attempt is
        graded and saved — the score will appear here once results are released.
      </Alert>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-lg text-ink">
          {r.score}/{r.totalMarks}
        </span>
        <Badge variant={r.passed ? "success" : "error"}>
          {r.passed ? "Pass" : "Fail"} · pass mark {r.passPercentage}%
        </Badge>
      </div>
      {r.gradingPending ? (
        <Alert variant="info">
          Some code answers are still grading — this score may rise when they
          finish.
        </Alert>
      ) : null}
      {r.sections && r.sections.length > 0 ? (
        <div className="space-y-2">
          {r.sections.map((s) => (
            <div
              key={s.sectionId}
              className="flex items-center justify-between rounded-xl border border-subtle px-3 py-2 text-sm"
            >
              <span className="truncate text-ink">{s.name}</span>
              <span className="font-mono text-ink-muted">
                {s.score}/{s.maxScore}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function GameResultDetail({
  attemptId,
  onClose,
}: {
  attemptId: string;
  onClose: () => void;
}): JSX.Element {
  const q = useQuery(() => api.games.result(attemptId), [attemptId]);
  if (q.loading) return <Loading />;
  if (q.error) return <Alert variant="error">{q.error}</Alert>;
  if (!q.data) return <Alert variant="warning">Result unavailable.</Alert>;
  return <GameResults result={q.data} onExit={onClose} />;
}

interface Props {
  entry: HistoryEntry;
  surface: "college" | "b2c";
  slug?: string;
  onClose: () => void;
}

export function AttemptResultDetail({
  entry,
  surface,
  slug,
  onClose,
}: Props): JSX.Element {
  switch (entry.module) {
    case "exam":
      return <ExamResultDetail attemptId={entry.attemptId} />;
    case "game":
      return <GameResultDetail attemptId={entry.attemptId} onClose={onClose} />;
    case "speaking": {
      const engine =
        surface === "college" && slug
          ? collegeSpeakingEngine(slug)
          : globalSpeakingEngine();
      return <SpeakingResults engine={engine} attemptId={entry.attemptId} />;
    }
    default:
      // essay / communication navigate to their own pages; never opened here.
      return <Alert variant="info">Open this attempt from its own page.</Alert>;
  }
}
