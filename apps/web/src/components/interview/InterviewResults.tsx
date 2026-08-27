/**
 * Interview report (Step 34). Renders the SERVER report (five dimensions, overall,
 * source badge, per-question feedback) — scored inline at the last answer, so no
 * polling. Optionally shows a client-side PRESENCE OBSERVATIONS card built from the
 * camera layer — explicitly labelled "not scored" (observations are feedback only,
 * and there is no emotion/confidence anywhere).
 */
import type { MockInterviewAttemptResult } from "@codeapt/shared";
import { useEffect, useState } from "react";

import type { InterviewEngine } from "../../lib/interview-engine.js";
import type { ObservationSummary } from "../../lib/camera-observation.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Card, CardContent } from "../ui/card.js";
import { Skeleton } from "../ui/skeleton.js";

const pct = (v: number | null): string => (v === null ? "—" : `${v}`);

function Dim({ label, value, note }: { label: string; value: number | null; note?: string }) {
  return (
    <div className="rounded-xl border border-subtle p-3">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="font-mono text-lg text-ink">{pct(value)}</div>
      {note ? <div className="text-[11px] text-ink-muted">{note}</div> : null}
    </div>
  );
}

export function InterviewResults({
  engine,
  attemptId,
  observations,
}: {
  engine: InterviewEngine;
  attemptId: string;
  observations?: ObservationSummary | null;
}): JSX.Element {
  const [data, setData] = useState<MockInterviewAttemptResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    engine
      .result(attemptId)
      .then((r) => live && setData(r))
      .catch(() => live && setError("Could not load your report."));
    return () => {
      live = false;
    };
  }, [engine, attemptId]);

  if (error) return <Alert variant="error">{error}</Alert>;
  if (!data) return <Skeleton className="h-64 w-full rounded-2xl" />;

  return (
    <div className="space-y-4">
      {data.terminated ? (
        <Alert variant="error">
          This interview was ended — unauthorised actions detected. Whatever you
          completed has been scored.
        </Alert>
      ) : null}

      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-ink">
                {data.role} interview
              </h2>
              <p className="text-sm text-ink-muted">{data.summary}</p>
            </div>
            <div className="text-right">
              <div className="font-mono text-2xl text-ink">{pct(data.overall)}</div>
              <Badge variant={data.approximate ? "info" : "neutral"}>
                {data.source === "ai_hybrid"
                  ? "AI-assisted"
                  : "Deterministic (AI unavailable)"}
              </Badge>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Dim label="Speaking" value={data.dimensions?.speaking ?? null} note="Fluency (deterministic)" />
            <Dim label="Vocabulary" value={data.dimensions?.vocabulary ?? null} note="Lexical (deterministic)" />
            <Dim label="Concept" value={data.dimensions?.concept ?? null} note="AI-judged" />
            <Dim label="Analysis" value={data.dimensions?.analysis ?? null} note="AI-judged" />
            <Dim label="Topic knowledge" value={data.dimensions?.topicKnowledge ?? null} note="AI-judged" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-6">
          <h3 className="font-medium text-ink">Per-question feedback</h3>
          {data.perQuestion.map((q) => (
            <div key={q.index} className="rounded-xl border border-subtle p-3">
              <div className="flex items-center gap-2">
                {q.isFollowUp ? <Badge variant="neutral">follow-up</Badge> : null}
                <Badge variant="neutral">{q.category}</Badge>
                {!q.answered ? <Badge variant="warning">not answered</Badge> : null}
              </div>
              <p className="mt-1 text-sm font-medium text-ink">{q.question}</p>
              {q.feedback ? (
                <p className="mt-1 text-sm text-ink-muted">{q.feedback}</p>
              ) : null}
              {q.corrections.length > 0 ? (
                <details className="mt-1 text-xs text-ink-muted">
                  <summary className="cursor-pointer">
                    {q.corrections.length} domain term
                    {q.corrections.length === 1 ? "" : "s"} corrected
                  </summary>
                  <ul className="mt-1 list-disc pl-5">
                    {q.corrections.map((c, i) => (
                      <li key={i}>
                        “{c.from}” → <span className="text-ink">{c.to}</span>
                      </li>
                    ))}
                  </ul>
                  {q.rawTranscript ? (
                    <p className="mt-1">
                      <span className="font-medium">Original transcript:</span>{" "}
                      {q.rawTranscript}
                    </p>
                  ) : null}
                </details>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>

      {observations && observations.available ? (
        <Card>
          <CardContent className="space-y-2 p-6">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-ink">Presence observations</h3>
              <Badge variant="neutral">not scored</Badge>
            </div>
            <p className="text-xs text-ink-muted">
              Feedback from your camera. These never affect your score.
            </p>
            {observations.maxFaces > 1 ? (
              <p className="text-xs text-warning-fg">
                More than one face was detected in view at times. This notes that the
                frame changed — not who was in it.
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-sm">
              <Dim label="Looking away" value={observations.pctLookingAway} note="% of frames" />
              <Dim label="Out of frame" value={observations.secondsOutOfFrame} note="seconds" />
              <Dim label="Stillness" value={observations.stillnessScore} note="higher = steadier" />
              <div className="rounded-xl border border-subtle p-3">
                <div className="text-xs text-ink-muted">Smile</div>
                <div className="text-sm text-ink">
                  start: {observations.smileAtStart === null ? "—" : observations.smileAtStart ? "yes" : "no"} · end:{" "}
                  {observations.smileAtEnd === null ? "—" : observations.smileAtEnd ? "yes" : "no"}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
