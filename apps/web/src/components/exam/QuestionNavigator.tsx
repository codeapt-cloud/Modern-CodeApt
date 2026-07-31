/**
 * Question navigator — a numbered grid for the CURRENT section with the four
 * exam states (not visited / not answered / answered / marked for review, the
 * last with an answered variant) plus a legend. Clicking a number jumps to that
 * question WITHIN the section (no cross-section navigation).
 */
import type { SanitizedQuestion } from "@codeapt/shared";

import { cn } from "../../lib/cn.js";
import {
  isAnswered,
  questionStatus,
  type LocalAnswer,
  type QuestionStatus,
} from "../../lib/exam-runner.js";

const STATUS_CLASS: Record<QuestionStatus, string> = {
  "not-visited": "border-subtle bg-surface-base text-ink-muted",
  "not-answered": "border-error/50 bg-error-subtle text-error-fg",
  answered: "border-success/50 bg-success-subtle text-success-fg",
  "marked-unanswered": "border-primary/60 bg-primary/15 text-primary",
  "marked-answered": "border-primary/60 bg-primary/15 text-primary",
};

const LEGEND: { status: QuestionStatus; label: string }[] = [
  { status: "answered", label: "Answered" },
  { status: "not-answered", label: "Not answered" },
  { status: "not-visited", label: "Not visited" },
  { status: "marked-unanswered", label: "Marked for review" },
];

export function QuestionNavigator({
  questions,
  answers,
  marked,
  visited,
  currentIndex,
  onJump,
}: {
  questions: SanitizedQuestion[];
  answers: Record<string, LocalAnswer>;
  marked: Set<string>;
  visited: Set<string>;
  currentIndex: number;
  onJump: (index: number) => void;
}) {
  const answeredTotal = questions.filter((q) =>
    isAnswered(q, answers[q.id]),
  ).length;

  return (
    <div className="rounded-2xl border border-subtle bg-surface-raised p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Questions
        </span>
        <span className="font-mono text-xs text-ink">
          {answeredTotal}/{questions.length}
        </span>
      </div>

      <div className="grid grid-cols-6 gap-2 sm:grid-cols-8 lg:grid-cols-5">
        {questions.map((q, i) => {
          const answered = isAnswered(q, answers[q.id]);
          const status = questionStatus(
            answered,
            visited.has(q.id),
            marked.has(q.id),
          );
          const isMarkedAnswered = status === "marked-answered";
          return (
            <button
              key={q.id}
              type="button"
              onClick={() => onJump(i)}
              aria-label={`Question ${i + 1} — ${status.replace(/-/g, " ")}`}
              aria-current={i === currentIndex ? "true" : undefined}
              className={cn(
                "relative flex h-9 w-9 items-center justify-center rounded-lg border font-mono text-sm transition-colors focus-visible:outline-none focus-visible:shadow-focus",
                STATUS_CLASS[status],
                i === currentIndex && "ring-2 ring-primary ring-offset-1",
              )}
            >
              {i + 1}
              {/* Marked + answered → a small success dot on the marked chip. */}
              {isMarkedAnswered ? (
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-success ring-1 ring-surface-raised" />
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <ul className="mt-4 grid grid-cols-2 gap-2 text-[11px] text-ink-muted">
        {LEGEND.map((l) => (
          <li key={l.status} className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-block h-3 w-3 rounded border",
                STATUS_CLASS[l.status],
              )}
            />
            {l.label}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] text-ink-muted">
        A green dot marks a “review” question that also has an answer.
      </p>
    </div>
  );
}
