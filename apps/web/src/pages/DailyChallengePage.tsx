/**
 * Daily Challenge — today's one problem (MCQ or CODE), with a streak/score
 * widget and an "already solved" state. MCQ grades inline; CODE rides the
 * async execution pipeline (enqueue → poll → finalize) and celebrates on solve.
 */
import {
  DailyQuestionType,
  type StreakInfo,
  type SubmitMcqResponse,
  type TodayChallenge,
} from "@codeapt/shared";
import { motion, useReducedMotion } from "framer-motion";
import {
  CalendarDays,
  CheckCircle2,
  PartyPopper,
  Play,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { StreakWidget } from "../components/challenge/StreakWidget.js";
import { CodeEditor } from "../components/editor/CodeEditor.js";
import { PageHeader } from "../components/layout/PageHeader.js";
import { Alert } from "../components/ui/alert.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent } from "../components/ui/card.js";
import { EmptyState } from "../components/ui/empty-state.js";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { api, parseApiError } from "../lib/api-client.js";
import { cn } from "../lib/cn.js";
import { useChallengeRunner } from "../lib/use-challenge-runner.js";
import { useQuery } from "../lib/use-query.js";

export function DailyChallengePage() {
  const { data, loading, error } = useQuery(() => api.challenges.today(), []);
  // Updated in place after a solve so the streak widget reflects the new state
  // without a refetch (which would unmount the graded result / celebration).
  const [streakOverride, setStreakOverride] = useState<StreakInfo | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Daily Challenge"
        description="One problem a day. Keep your streak alive."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/leaderboard">View leaderboard</Link>
          </Button>
        }
      />

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      ) : error || !data ? (
        <Alert variant="error">
          {error ?? "Could not load today's challenge."}
        </Alert>
      ) : (
        <>
          <StreakWidget streak={streakOverride ?? data.streak} />
          {!data.available ? (
            <EmptyState
              title="No challenge today"
              description="There's no problem released for today yet. Check back soon!"
              icon={<CalendarDays />}
            />
          ) : data.streak.solvedToday ? (
            <SolvedState challenge={data} />
          ) : data.questionType === DailyQuestionType.MCQ ? (
            <McqChallenge challenge={data} onStreak={setStreakOverride} />
          ) : (
            <CodeChallenge challenge={data} onStreak={setStreakOverride} />
          )}
        </>
      )}
    </div>
  );
}

function QuestionHeader({ challenge }: { challenge: TodayChallenge }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <Badge
        variant={challenge.questionType === "CODE" ? "primary" : "neutral"}
      >
        {challenge.questionType === "CODE" ? "Coding" : "Multiple choice"}
      </Badge>
      <Badge variant="neutral">{challenge.points} pts</Badge>
      <span className="font-mono text-xs text-ink-muted">
        {challenge.dayKey}
      </span>
    </div>
  );
}

function SolvedState({ challenge }: { challenge: TodayChallenge }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
        <div className="flex items-center gap-2 font-mono text-4xl text-primary">
          <span>{"{"}</span>
          <PartyPopper className="h-9 w-9" />
          <span>{"}"}</span>
        </div>
        <h2 className="text-xl font-bold text-ink">Solved for today!</h2>
        <p className="max-w-sm text-sm text-ink-muted">
          Nice work on “{challenge.title}”. Your streak is at{" "}
          <span className="font-mono text-primary">
            {challenge.streak.currentStreak}
          </span>
          . Come back tomorrow to keep it going.
        </p>
        <Button asChild variant="outline">
          <Link to="/leaderboard">See the leaderboard</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// MCQ
// ---------------------------------------------------------------------------

function McqChallenge({
  challenge,
  onStreak,
}: {
  challenge: TodayChallenge;
  onStreak: (streak: StreakInfo) => void;
}) {
  const [selected, setSelected] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitMcqResponse | null>(null);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (selected === "") return;
    setSubmitting(true);
    setErr("");
    try {
      const res = await api.challenges.submitMcq(Number(selected));
      setResult(res);
      onStreak(res.streak); // update the widget in place (keep result mounted)
    } catch (e) {
      setErr(parseApiError(e).message);
    } finally {
      setSubmitting(false);
    }
  };

  const options = challenge.options ?? [];

  return (
    <Card>
      <CardContent className="p-6">
        <QuestionHeader challenge={challenge} />
        <h2 className="mb-2 text-lg font-semibold text-ink">
          {challenge.title}
        </h2>
        <p className="mb-6 text-ink-muted">{challenge.description}</p>

        <RadioGroup
          value={selected}
          onValueChange={setSelected}
          disabled={result !== null}
          className="gap-2"
        >
          {options.map((opt, i) => {
            const isCorrect = result && result.correctOption === i;
            const isChosenWrong =
              result && Number(selected) === i && !result.correct;
            return (
              // Radix radio items are buttons, so a wrapping <label> doesn't
              // delegate clicks — select on row click for a clickable row.
              <label
                key={i}
                onClick={() => {
                  if (result === null) setSelected(String(i));
                }}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition-colors",
                  result
                    ? isCorrect
                      ? "border-success/50 bg-success-subtle"
                      : isChosenWrong
                        ? "border-error/50 bg-error-subtle"
                        : "border-subtle"
                    : "border-subtle hover:border-primary/50",
                )}
              >
                <RadioGroupItem value={String(i)} id={`opt-${i}`} />
                <span className="flex-1 text-ink">{opt}</span>
                {isCorrect ? (
                  <CheckCircle2 className="h-4 w-4 text-success-fg" />
                ) : isChosenWrong ? (
                  <XCircle className="h-4 w-4 text-error-fg" />
                ) : null}
              </label>
            );
          })}
        </RadioGroup>

        {err ? (
          <Alert variant="error" className="mt-4">
            {err}
          </Alert>
        ) : null}

        {result ? (
          <div className="mt-6">
            <Alert variant={result.correct ? "success" : "error"}>
              {result.correct
                ? `Correct! +${result.awardedPoints} points. Come back tomorrow.`
                : "Not quite — the correct answer is highlighted. Come back tomorrow."}
            </Alert>
          </div>
        ) : (
          <Button
            className="mt-6"
            onClick={submit}
            loading={submitting}
            disabled={selected === ""}
          >
            Submit answer
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// CODE
// ---------------------------------------------------------------------------

function CodeChallenge({
  challenge,
  onStreak,
}: {
  challenge: TodayChallenge;
  onStreak: (streak: StreakInfo) => void;
}) {
  const reduced = useReducedMotion();
  const language = challenge.language ?? "python";
  const [source, setSource] = useState(challenge.starterCode ?? "");
  const runner = useChallengeRunner();

  const busy =
    runner.phase === "submitting" ||
    runner.phase === "queued" ||
    runner.phase === "processing" ||
    runner.phase === "finalizing";

  const submit = () => {
    void runner.run({ language, source });
  };

  // On a finalized solve, update the streak widget in place (no refetch — that
  // would unmount the celebration). Keyed on jobId so it fires once per run.
  const solvedJobId =
    runner.phase === "done" && runner.finalize?.solved ? runner.jobId : null;
  const solvedStreak = runner.finalize?.streak;
  useEffect(() => {
    if (solvedJobId && solvedStreak) onStreak(solvedStreak);
  }, [solvedJobId, solvedStreak, onStreak]);

  const samples = challenge.sampleCases ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-6">
          <QuestionHeader challenge={challenge} />
          <h2 className="mb-2 text-lg font-semibold text-ink">
            {challenge.title}
          </h2>
          <p className="text-ink-muted">{challenge.description}</p>

          {samples.length > 0 ? (
            <div className="mt-5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Sample cases
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {samples.map((c, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-subtle bg-surface-base p-3 text-xs"
                  >
                    <p className="text-ink-muted">
                      input:{" "}
                      <span className="font-mono text-ink">
                        {c.input || "(empty)"}
                      </span>
                    </p>
                    <p className="text-ink-muted">
                      output:{" "}
                      <span className="font-mono text-ink">
                        {c.expectedOutput}
                      </span>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-subtle bg-surface-raised px-4 py-2">
          <span className="font-mono text-xs text-ink-muted">
            solution.{language === "python" ? "py" : language}
          </span>
          <Button size="sm" onClick={submit} loading={busy} disabled={busy}>
            {!busy ? <Play className="h-4 w-4" /> : null}
            {busy ? "Grading…" : "Run & submit"}
          </Button>
        </div>
        <div className="h-[40vh] min-h-[280px] overflow-auto">
          <CodeEditor
            value={source}
            language={language}
            onChange={setSource}
            onRun={submit}
            disabled={busy}
          />
        </div>
      </Card>

      <CodeResult
        phase={runner.phase}
        finalize={runner.finalize}
        error={runner.error}
        reduced={reduced ?? false}
        onRetry={runner.reset}
      />
    </div>
  );
}

function CodeResult({
  phase,
  finalize,
  error,
  reduced,
  onRetry,
}: {
  phase: ReturnType<typeof useChallengeRunner>["phase"];
  finalize: ReturnType<typeof useChallengeRunner>["finalize"];
  error: string | null;
  reduced: boolean;
  onRetry: () => void;
}) {
  if (phase === "idle") return null;

  const running =
    phase === "submitting" ||
    phase === "queued" ||
    phase === "processing" ||
    phase === "finalizing";

  const label =
    phase === "submitting"
      ? "Submitting…"
      : phase === "queued"
        ? "Queued…"
        : phase === "processing"
          ? "Running tests…"
          : "Grading…";

  return (
    <Card>
      <CardContent className="p-6">
        {running ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <motion.span
              className="font-mono text-4xl text-primary"
              animate={reduced ? undefined : { opacity: [0.4, 1, 0.4] }}
              transition={{
                duration: 1.2,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            >
              {"{ }"}
            </motion.span>
            <p className="text-sm text-ink-muted">{label}</p>
          </div>
        ) : phase === "error" ? (
          <Alert variant="error">{error ?? "Something went wrong."}</Alert>
        ) : finalize ? (
          <FinalizeView finalize={finalize} onRetry={onRetry} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function FinalizeView({
  finalize,
  onRetry,
}: {
  finalize: NonNullable<ReturnType<typeof useChallengeRunner>["finalize"]>;
  onRetry: () => void;
}) {
  const passed = finalize.graded?.passedCount ?? 0;
  const total = finalize.graded?.totalCount ?? 0;

  if (finalize.solved) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <div className="flex items-center gap-2 font-mono text-3xl text-primary">
          <span>{"{"}</span>
          <PartyPopper className="h-8 w-8" />
          <span>{"}"}</span>
        </div>
        <h3 className="text-lg font-bold text-ink">All tests passed!</h3>
        <p className="text-sm text-ink-muted">
          {passed}/{total} test cases · +{finalize.awardedPoints} points ·
          streak now{" "}
          <span className="font-mono text-primary">
            {finalize.streak.currentStreak}
          </span>{" "}
          🔥
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-ink">Test cases</span>
        <span className="font-mono text-sm text-ink">
          {passed}/{total} passed
        </span>
      </div>
      <Alert variant="error">
        Not all tests passed yet. Tweak your solution and try again.
      </Alert>
      <Button variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
