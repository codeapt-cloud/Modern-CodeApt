/**
 * The fullscreen exam runner shell. Consumes `useExamRunner` and renders the
 * current section (no-reload transitions), a live countdown (re-synced from the
 * server), a question navigator, autosave status, anti-cheat detection, the
 * submit → grading → results flow, and the results review.
 *
 * Fullscreen is requested by the caller on the user's "Begin" gesture; this
 * component only reacts to LEAVING fullscreen / tab-switches as warnings and
 * exits fullscreen when the attempt is done.
 */
import {
  EXAM_MAX_WARNINGS,
  type AttemptSectionView,
  type ExamResult,
} from "@codeapt/shared";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Calculator as CalculatorIcon,
  CheckCircle2,
  Clock,
  Eraser,
  Flag,
  Loader2,
  Maximize,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "../../lib/cn.js";
import {
  formatCountdown,
  isLastSection,
  saveAndNextAction,
} from "../../lib/exam-runner.js";
import { useExamRunner } from "../../lib/use-exam-runner.js";
import { exitFullscreen, useProctoring } from "../../lib/use-proctoring.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { ExamCalculator } from "./ExamCalculator.js";
import { QuestionCard } from "./QuestionCard.js";
import { QuestionNavigator } from "./QuestionNavigator.js";
import { StimulusPlayer } from "./StimulusPlayer.js";

export function ExamRunner({
  attemptId,
  token,
  initial,
  onExit,
  exitLabel,
}: {
  attemptId: string;
  token: string | null;
  initial: AttemptSectionView;
  onExit: () => void;
  /** Label for the exit affordance — defaults preserve the standalone wording;
   *  a composite passes "Back to your assessment" (Step 25 C3). */
  exitLabel?: string;
}) {
  const runner = useExamRunner({ attemptId, token, initial });
  const {
    view,
    answers,
    remaining,
    phase,
    result,
    warnings,
    malpractice,
    saving,
    error,
    currentIndex,
    markedForReview,
    visited,
    setAnswer,
    toggleOption,
    goToIndex,
    setMark,
    clearResponse,
    flushSave,
    advance,
    submit,
    recordWarning,
  } = runner;

  const reduced = useReducedMotion();
  const [warningOpen, setWarningOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);

  const active = phase === "running" || phase === "advancing";
  const done = phase === "done";

  // --- Anti-cheat: shared proctoring hook (fullscreen exit + tab/window switch
  // → warning; copy + right-click blocked). The essay composer reuses the SAME
  // hook so the two never fork. Behavior here is identical to before.
  const { requestFullscreen } = useProctoring({
    active,
    onWarning: () => {
      setWarningOpen(true);
      void recordWarning();
    },
    block: { copy: true, contextmenu: true },
  });

  // Exit fullscreen once the attempt is finished.
  useEffect(() => {
    if (done || phase === "error") exitFullscreen();
  }, [done, phase]);

  if (done && result) {
    return <ResultsReview result={result} onExit={onExit} exitLabel={exitLabel} />;
  }
  if (phase === "error") {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
        <ShieldAlert className="h-10 w-10 text-error-fg" />
        <p className="text-ink">{error ?? "Something went wrong."}</p>
        <Button onClick={onExit}>{exitLabel ?? "Back to exams"}</Button>
      </div>
    );
  }
  if (phase === "submitting" || phase === "grading") {
    return <GradingState phase={phase} reduced={reduced ?? false} />;
  }

  const last = isLastSection(view.sectionIndex, view.totalSections);
  const current = view.questions[currentIndex];
  const nextAction = saveAndNextAction(
    currentIndex,
    view.questions.length,
    last,
  );

  // "Save & Next" WITHOUT forking the pipeline: advance the question within the
  // section, else delegate to the EXISTING advance()/submit() flow on the last.
  const proceed = (): void => {
    if (nextAction === "next-question") {
      void flushSave().then(() => goToIndex(currentIndex + 1));
    } else if (nextAction === "advance-section") {
      void advance(); // enqueues code grading + moves to the next section
    } else {
      setConfirmOpen(true); // final section → submit confirmation
    }
  };

  const saveNextLabel =
    nextAction === "submit-exam"
      ? "Submit exam"
      : nextAction === "advance-section"
        ? "Save & Next section"
        : "Save & Next";

  return (
    <div className="min-h-screen bg-surface">
      {/* Top bar */}
      <header className="sticky top-0 z-sticky border-b border-subtle bg-surface-raised/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">
              {view.examTitle}
            </p>
            <p className="text-xs text-ink-muted">
              Section {view.sectionIndex + 1} of {view.totalSections} ·{" "}
              {view.section.name}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {view.calculatorEnabled ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCalcOpen(true)}
                aria-label="Open calculator"
              >
                <CalculatorIcon className="h-4 w-4" /> Calculator
              </Button>
            ) : null}
            {warnings > 0 ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium",
                  malpractice
                    ? "bg-error-subtle text-error-fg"
                    : "bg-warning-subtle text-warning-fg",
                )}
              >
                <AlertTriangle className="h-3.5 w-3.5" /> {warnings} warning
                {warnings === 1 ? "" : "s"}
              </span>
            ) : null}
            <CountdownBadge remaining={remaining} reduced={reduced ?? false} />
          </div>
        </div>
      </header>

      {malpractice ? (
        <div className="border-b border-error/40 bg-error-subtle">
          <div className="mx-auto max-w-6xl px-4 py-2 text-sm text-error-fg">
            Your attempt has been flagged for review due to repeated warnings.
            You may continue; the result is recorded.
          </div>
        </div>
      ) : null}

      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1fr_280px]">
        {/* One question at a time */}
        <main className="space-y-4">
          {view.section.stimulusAudioUrl ? (
            <StimulusPlayer
              attemptId={attemptId}
              sectionId={view.section.id}
              token={token}
              audioUrl={view.section.stimulusAudioUrl}
              playLimit={view.section.stimulusPlayLimit}
              initialPlaysUsed={view.section.stimulusPlaysUsed}
            />
          ) : null}
          {view.section.description ? (
            <p className="text-sm text-ink-muted">{view.section.description}</p>
          ) : null}
          <p className="text-xs font-medium text-ink-muted">
            Question {currentIndex + 1} of {view.questions.length}
          </p>

          {current ? (
            <QuestionCard
              key={current.id}
              index={currentIndex}
              question={current}
              answer={answers[current.id]}
              onChange={(patch) => setAnswer(current.id, patch)}
              onToggle={(idx) =>
                toggleOption(current.id, idx, current.type === "MCQ_MULTI")
              }
              disabled={!active}
            />
          ) : null}

          {/* Action row (autosave keeps running; Save & Next is the primary) */}
          <div className="flex flex-wrap items-center gap-2 border-t border-subtle pt-4">
            <Button
              variant="outline"
              onClick={() => goToIndex(currentIndex - 1)}
              disabled={!active || currentIndex === 0}
            >
              <ArrowLeft className="h-4 w-4" /> Previous
            </Button>
            <Button
              variant="ghost"
              onClick={() => current && clearResponse(current.id)}
              disabled={!active || !current}
            >
              <Eraser className="h-4 w-4" /> Clear response
            </Button>
            <div className="flex-1" />
            <Button
              variant="secondary"
              onClick={() => {
                if (current) setMark(current.id, true);
                proceed();
              }}
              disabled={!active || !current}
            >
              <Flag className="h-4 w-4" /> Mark for review &amp; next
            </Button>
            <Button variant="primary" onClick={proceed} disabled={!active}>
              {saveNextLabel}
              {nextAction !== "submit-exam" ? (
                <ArrowRight className="h-4 w-4" />
              ) : null}
            </Button>
          </div>
        </main>

        {/* Sidebar navigator */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <QuestionNavigator
            questions={view.questions}
            answers={answers}
            marked={markedForReview}
            visited={visited}
            currentIndex={currentIndex}
            onJump={(i) => goToIndex(i)}
          />
          <div className="flex items-center gap-2 text-xs text-ink-muted">
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-success-fg" /> Answers
                saved
              </>
            )}
          </div>
          {last ? (
            <Button
              className="w-full"
              onClick={() => setConfirmOpen(true)}
              disabled={!active}
            >
              Submit exam
            </Button>
          ) : null}
          <p className="text-center text-[11px] text-ink-muted">
            {last
              ? "This is the last section."
              : "You can’t return to a section once you advance."}
          </p>
        </aside>
      </div>

      {/* Warning modal */}
      <Dialog open={warningOpen} onOpenChange={setWarningOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning-fg" /> Warning{" "}
              {warnings}
            </DialogTitle>
            <DialogDescription>
              Leaving fullscreen or switching away from the exam is recorded.
              More than {EXAM_MAX_WARNINGS} warnings flags your attempt for
              review. Please return to the exam and stay in fullscreen.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => {
                requestFullscreen();
                setWarningOpen(false);
              }}
            >
              <Maximize className="h-4 w-4" /> Return to exam
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Submit confirmation */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit your exam?</DialogTitle>
            <DialogDescription>
              You won’t be able to change your answers after submitting. Code
              answers are graded automatically.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Keep working
            </Button>
            <Button
              onClick={() => {
                setConfirmOpen(false);
                void submit(false);
              }}
            >
              Submit exam
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Floating calculator — pure UI, opened on demand from the header.
          Gated on the per-exam toggle so a disabled exam can never surface it. */}
      {view.calculatorEnabled && calcOpen ? (
        <ExamCalculator onClose={() => setCalcOpen(false)} />
      ) : null}
    </div>
  );
}

function CountdownBadge({
  remaining,
  reduced,
}: {
  remaining: number;
  reduced: boolean;
}) {
  const low = remaining <= 60;
  const critical = remaining <= 20;
  return (
    <motion.span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-sm font-semibold tabular-nums",
        critical
          ? "border-error/50 bg-error-subtle text-error-fg"
          : low
            ? "border-warning/50 bg-warning-subtle text-warning-fg"
            : "border-subtle text-ink",
      )}
      animate={critical && !reduced ? { opacity: [1, 0.5, 1] } : undefined}
      transition={{ duration: 1, repeat: Infinity }}
      aria-label="Time remaining in this section"
    >
      <Clock className="h-4 w-4" />
      {formatCountdown(remaining)}
    </motion.span>
  );
}

function GradingState({
  phase,
  reduced,
}: {
  phase: "submitting" | "grading";
  reduced: boolean;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface text-center">
      <motion.span
        className="font-mono text-5xl text-primary"
        animate={reduced ? undefined : { opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
      >
        {"{ }"}
      </motion.span>
      <p className="text-ink">
        {phase === "submitting"
          ? "Submitting your exam…"
          : "Grading your code…"}
      </p>
      <p className="text-sm text-ink-muted">This only takes a moment.</p>
    </div>
  );
}

// --- Results review ---------------------------------------------------------

const LETTERS = ["A", "B", "C", "D", "E"];
const fmtOpts = (idx: number[] | null): string =>
  idx && idx.length
    ? idx.map((i) => LETTERS[i] ?? String(i + 1)).join(", ")
    : "—";

function ResultsReview({
  result,
  onExit,
  exitLabel,
}: {
  result: ExamResult;
  onExit: () => void;
  exitLabel?: string;
}) {
  // Organiser has turned result display off — acknowledge the submission and
  // show "coming soon" instead of a score/breakdown.
  if (result.resultsHidden) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="font-mono text-3xl text-primary">{"{ }"}</p>
        <h1 className="mt-3 text-2xl font-bold text-ink">Submitted</h1>
        <p className="mt-3 text-ink-muted">
          Your responses were recorded. Results aren&apos;t published yet —
          they&apos;ll be available here once the organiser releases them.
        </p>
        <p className="mt-4 inline-block rounded-lg bg-surface-raised px-3 py-1.5 text-sm font-medium text-ink">
          Results coming soon
        </p>
        <div className="mt-8">
          <Button onClick={onExit}>{exitLabel ?? "Done"}</Button>
        </div>
      </div>
    );
  }
  const pct =
    result.totalMarks > 0
      ? Math.round((result.score / result.totalMarks) * 100)
      : 0;
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 text-center">
        <p className="font-mono text-3xl text-primary">{"{ }"}</p>
        <h1 className="mt-3 text-2xl font-bold text-ink">Results</h1>
      </div>

      <div className="mb-6 flex flex-col items-center gap-3 rounded-2xl border border-subtle bg-surface-raised p-6">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-4xl font-bold text-ink">
            {result.score}
          </span>
          <span className="text-lg text-ink-muted">/ {result.totalMarks}</span>
        </div>
        <Badge variant={result.passed ? "success" : "error"}>
          {result.passed ? "PASSED" : "FAILED"} · {pct}% (need{" "}
          {result.passPercentage}%)
        </Badge>
        <div className="flex flex-wrap justify-center gap-2 text-xs">
          {result.autoSubmitted ? (
            <span className="rounded-lg bg-warning-subtle px-2 py-1 text-warning-fg">
              Auto-submitted
            </span>
          ) : null}
          {result.isMalpractice ? (
            <span className="rounded-lg bg-error-subtle px-2 py-1 text-error-fg">
              Flagged ({result.warnings} warnings)
            </span>
          ) : null}
        </div>
      </div>

      <div className="space-y-4">
        {(result.sections ?? []).map((section) => (
          <div
            key={section.sectionId}
            className="rounded-2xl border border-subtle bg-surface-raised p-5"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-ink">{section.name}</h2>
              <span className="font-mono text-sm text-ink">
                {section.score}/{section.maxScore}
              </span>
            </div>
            <ul className="space-y-2">
              {section.questions.map((q, i) => {
                const full = q.awardedMarks >= q.maxMarks && q.maxMarks > 0;
                return (
                  <li
                    key={q.questionId}
                    className="rounded-lg border border-subtle bg-surface-base p-3 text-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex items-center gap-2 text-ink">
                        {full ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-success-fg" />
                        ) : (
                          <XCircle className="h-4 w-4 shrink-0 text-error-fg" />
                        )}
                        <span className="font-mono text-xs text-ink-muted">
                          Q{i + 1}
                        </span>
                        {q.text}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-ink">
                        {q.awardedMarks}/{q.maxMarks}
                      </span>
                    </div>
                    {q.type === "CODE" ? (
                      <p className="mt-2 pl-6 text-xs text-ink-muted">
                        {q.testsTotal !== null
                          ? `Tests passed: ${q.testsPassed ?? 0}/${q.testsTotal}`
                          : null}
                        {q.note ? ` · ${q.note}` : null}
                      </p>
                    ) : (
                      <p className="mt-2 pl-6 text-xs text-ink-muted">
                        Your answer:{" "}
                        <span className="font-mono">
                          {fmtOpts(q.selectedOptions)}
                        </span>{" "}
                        · Correct:{" "}
                        <span className="font-mono text-success-fg">
                          {fmtOpts(q.correctOptions)}
                        </span>
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {result.status !== "graded" ? (
        <Alert variant="warning" className="mt-6">
          Grading is still finishing. Refresh in a moment to see final marks.
        </Alert>
      ) : null}

      <div className="mt-8 flex justify-center">
        <Button onClick={onExit}>{exitLabel ?? "Back to exams"}</Button>
      </div>
    </div>
  );
}
