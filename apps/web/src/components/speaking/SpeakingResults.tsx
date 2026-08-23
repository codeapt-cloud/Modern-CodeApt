/**
 * Async Speaking results. Polls until complete ("your result will appear
 * shortly" — never "instant"; a 90-student drive takes ~95 min to drain even at
 * ~2.4s/clip). Shows the five sub-score dimensions with the 50%/60%
 * pass/distinction bands, labels the LLM dimensions APPROXIMATE, and — when a
 * hybrid item fell back to its deterministic floor — states plainly that the
 * student was NOT marked down for our AI being unavailable (Step 12 reweights
 * the floor to 100%). Where the reference papers say "pronunciation" this says
 * "Word accuracy" and states that accent/clarity are not scored.
 */
import { useEffect, useState } from "react";

import type { SpeakingItemScoreDto } from "@codeapt/shared";

import { api } from "../../lib/api-client.js";
import {
  deriveSpeakingResults,
  isReadAloudFamilyScore,
  shouldAutoPoll,
  type ScoreBand,
} from "../../lib/speaking-runner.js";
import { useQuery } from "../../lib/use-query.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";
import { Skeleton } from "../ui/skeleton.js";

const BAND_VARIANT: Record<ScoreBand, "success" | "warning" | "error"> = {
  distinction: "success",
  pass: "success",
  fail: "error",
};
const BAND_LABEL: Record<ScoreBand, string> = {
  distinction: "Distinction (60%+)",
  pass: "Pass (50%+)",
  fail: "Below pass (under 50%)",
};

function pct(n: number | null): string {
  return n === null ? "—" : `${Math.round(n)}%`;
}

export function SpeakingResults({
  slug,
  attemptId,
}: {
  slug: string;
  attemptId: string;
}): JSX.Element {
  const [tick, setTick] = useState(0);
  const [polls, setPolls] = useState(0);
  const q = useQuery(
    () => api.collegeSpeaking.result(slug, attemptId),
    [slug, attemptId, tick],
  );

  const complete = q.data?.complete ?? false;
  const autoPolling = q.data !== undefined && shouldAutoPoll(polls, complete);

  useEffect(() => {
    if (autoPolling) {
      const t = setTimeout(() => {
        setPolls((n) => n + 1);
        setTick((n) => n + 1);
      }, 3000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [autoPolling, q.data]);

  // Auto-polling stopped but the result is still incomplete — let the student
  // leave and come back with a manual re-check (which resets the poll budget).
  const gaveUp = q.data !== undefined && !complete && !autoPolling;
  const checkAgain = (): void => {
    setPolls(0);
    setTick((n) => n + 1);
  };

  if (q.loading && !q.data) {
    return <Skeleton className="h-40 w-full" />;
  }
  if (!q.data) {
    return <Alert variant="error">{q.error ?? "Could not load your result."}</Alert>;
  }

  const result = q.data;
  const summary = deriveSpeakingResults(result.items);

  return (
    <div className="space-y-4">
      {!result.complete && !gaveUp ? (
        <Alert variant="info">
          Submitted. Your result will appear shortly — we&apos;re still
          transcribing and scoring your answers. This page updates on its own;
          you can safely leave and check back.
        </Alert>
      ) : null}
      {gaveUp ? (
        <Alert variant="info">
          Submitted. Scoring is still in progress — during a busy assessment
          window this can take a while. You can safely close this page and check
          back later.
          <div className="mt-2">
            <Button size="sm" variant="secondary" onClick={checkAgain}>
              Check again
            </Button>
          </div>
        </Alert>
      ) : null}

      {/* Overall + sub-score dimensions. */}
      <Card>
        <CardContent className="space-y-3 p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-ink">Your result</h3>
            {summary.band ? (
              <Badge variant={BAND_VARIANT[summary.band]}>
                {pct(summary.overallPercent)} · {BAND_LABEL[summary.band]}
              </Badge>
            ) : (
              <Badge variant="neutral">Scoring…</Badge>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Dimension label="Accuracy" value={pct(summary.dimensions.accuracy)} note="Word accuracy" />
            <Dimension label="Listening" value={pct(summary.dimensions.listening)} />
            <Dimension label="Fluency" value={pct(summary.dimensions.fluency)} />
            <Dimension label="Grammar" value={pct(summary.dimensions.grammar)} approximate />
            <Dimension label="Relevance" value={pct(summary.dimensions.relevance)} approximate />
          </dl>

          {summary.anyDeterministicFallback ? (
            <Alert variant="info">
              One or more spoken-topic answers were scored on their deterministic
              floor because AI analysis was unavailable. You were{" "}
              <strong>not marked down</strong> for this — the score is out of the
              same maximum.
            </Alert>
          ) : null}

          <p className="text-xs text-ink-muted">
            Accent and clarity are not scored. &quot;Grammar&quot; and
            &quot;Relevance&quot; are approximate (AI-assisted).
          </p>
        </CardContent>
      </Card>

      {/* Per-item detail. */}
      {result.items.map((it) => (
        <Card key={it.index}>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium text-ink">
                Item {it.index + 1} · {it.itemType.replace(/_/g, " ")}
              </span>
              <span className="text-sm text-ink-muted">{it.status}</span>
            </div>
            {it.status === "failed" ? (
              <Alert variant="warning">
                {it.error ?? "This answer could not be scored."}
              </Alert>
            ) : null}
            {it.transcript ? (
              <p className="text-sm text-ink-secondary">
                <span className="text-ink-muted">Heard/typed: </span>
                &ldquo;{it.transcript}&rdquo;
              </p>
            ) : null}
            {it.score ? <ItemScoreDetail score={it.score} /> : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Dimension({
  label,
  value,
  note,
  approximate,
}: {
  label: string;
  value: string;
  note?: string;
  approximate?: boolean;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-subtle bg-surface-sunken p-3">
      <dt className="text-xs text-ink-muted">
        {label}
        {approximate ? " (approx.)" : ""}
      </dt>
      <dd className="font-mono text-lg text-ink">{value}</dd>
      {note ? <div className="text-[10px] text-ink-muted">{note}</div> : null}
    </div>
  );
}

/** Per-item detail, expanded by score kind. The read-aloud family shows the
 *  three-category breakdown collapsed for the student (phonetic = accepted). */
function ItemScoreDetail({ score }: { score: SpeakingItemScoreDto }): JSX.Element {
  if (isReadAloudFamilyScore(score)) {
    return (
      <div className="space-y-1 text-sm text-ink-secondary">
        <div>
          Word accuracy:{" "}
          <span className="font-mono text-ink">{score.wordAccuracy}%</span>
        </div>
        <div className="text-ink-muted">
          Speech rate: {score.fluency.speechRate} words/s · pauses:{" "}
          {score.fluency.pauseCount} · fillers: {score.fluency.fillerCount}
        </div>
        {score.missedWords.length > 0 ? (
          <div>Missed: {score.missedWords.join(", ")}</div>
        ) : null}
        {score.missaidWords.length > 0 ? (
          <div>
            Mis-said:{" "}
            {score.missaidWords.map((m) => `${m.expected}→${m.heard}`).join(", ")}
          </div>
        ) : null}
        {score.phoneticMatches.length > 0 ? (
          <div className="text-ink-muted">
            Accepted as correct (a homophone was transcribed):{" "}
            {score.phoneticMatches.map((m) => `${m.expected}→${m.heard}`).join(", ")}
          </div>
        ) : null}
      </div>
    );
  }
  switch (score.kind) {
    case "answer_set":
      return (
        <div className="text-sm text-ink-secondary">
          {score.matched ? (
            <span className="text-success-fg">Correct answer.</span>
          ) : (
            <span className="text-error-fg">Not an accepted answer.</span>
          )}
        </div>
      );
    case "fill_missing_word":
      return (
        <div className="space-y-1 text-sm text-ink-secondary">
          <div>Score: <span className="font-mono text-ink">{score.score}%</span></div>
          <div className="text-ink-muted">
            Missing word {score.missingWordPresent ? "present" : "not said"} · sentence
            accuracy {score.sentenceAccuracy}%
          </div>
        </div>
      );
    case "dictation":
      return (
        <div className="space-y-1 text-sm text-ink-secondary">
          <div>
            Word accuracy:{" "}
            <span className="font-mono text-ink">{score.wordAccuracy}%</span>
          </div>
          <div className="text-ink-muted">
            Typed — spelling counts, so a homophone is an error.
          </div>
          {score.missaidWords.length > 0 ? (
            <div>
              Errors:{" "}
              {score.missaidWords.map((m) => `${m.expected}→${m.heard}`).join(", ")}
            </div>
          ) : null}
        </div>
      );
    case "story_retell":
      return (
        <div className="space-y-1 text-sm text-ink-secondary">
          <div>Score: <span className="font-mono text-ink">{score.total}%</span></div>
          <div className="text-ink-muted">
            Key facts covered: {score.coverage.covered}/{score.coverage.total}
            {score.source === "deterministic_floor"
              ? " · scored on facts (AI unavailable — not marked down)"
              : score.approximate
                ? " · coherence AI-assisted (approximate)"
                : ""}
          </div>
        </div>
      );
    case "open_topic":
      return (
        <div className="space-y-1 text-sm text-ink-secondary">
          <div>Score: <span className="font-mono text-ink">{score.total}%</span></div>
          <div className="text-ink-muted">
            Fluency {score.fluencyScore}%
            {score.source === "deterministic_floor"
              ? " · scored on fluency (AI unavailable — not marked down)"
              : ` · relevance ${score.aiRelevance ?? "—"}%, grammar ${score.aiGrammar ?? "—"}% (approximate)`}
          </div>
        </div>
      );
    default:
      return <div className="text-sm text-ink-muted">Scored.</div>;
  }
}
