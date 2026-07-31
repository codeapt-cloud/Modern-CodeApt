/**
 * One bank question row — shared by the college picker and the super-admin
 * screen. Shows type / difficulty / category / company badges + the question
 * text, expands to preview MCQ options (correct highlighted) or CODE starter +
 * test-case count, an optional multi-select checkbox, and a `trailing` slot for
 * the row's action (Add/Added in the picker; edit/delete in the admin screen).
 */
import type { BankQuestion, QuestionDifficulty } from "@codeapt/shared";
import { CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import {
  codeLanguageLabel,
  isCode,
  questionTypeLabel,
} from "../../lib/exam-authoring.js";
import { Badge } from "../ui/badge.js";
import { Checkbox } from "../ui/checkbox.js";

const LETTERS = ["A", "B", "C", "D", "E"];

const DIFFICULTY_VARIANT: Record<
  QuestionDifficulty,
  "success" | "warning" | "error"
> = {
  easy: "success",
  medium: "warning",
  hard: "error",
};

export function BankResultRow({
  question,
  selectable = false,
  selected = false,
  onToggleSelect,
  trailing,
}: {
  question: BankQuestion;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  trailing?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const code = isCode(question.questionType);

  return (
    <li className="space-y-3 p-4">
      <div className="flex items-start gap-3">
        {selectable ? (
          <Checkbox
            className="mt-1"
            checked={selected}
            onCheckedChange={() => onToggleSelect?.()}
            aria-label="Select question"
          />
        ) : null}

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-0.5 shrink-0 text-ink-muted hover:text-ink"
          aria-label={open ? "Collapse" : "Expand"}
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="info">{questionTypeLabel(question.questionType)}</Badge>
            <Badge variant={DIFFICULTY_VARIANT[question.difficulty]}>
              {question.difficulty.charAt(0).toUpperCase() +
                question.difficulty.slice(1)}
            </Badge>
            <Badge variant="neutral">{question.category}</Badge>
            {question.company && question.company !== "General" ? (
              <Badge variant="outline">{question.company}</Badge>
            ) : null}
            <span className="text-xs text-ink-muted">{question.marks} marks</span>
            {code ? (
              <Badge variant="neutral">
                {codeLanguageLabel(question.language)}
              </Badge>
            ) : null}
          </div>
          <p className="whitespace-pre-line text-sm text-ink">{question.text}</p>

          {open ? (
            <div className="pt-1">
              {question.options && question.options.length > 0 ? (
                <ul className="grid gap-1">
                  {question.options.map((opt, oi) => {
                    const correct = question.correctOptions?.includes(oi) ?? false;
                    return (
                      <li
                        key={oi}
                        className={
                          "flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs " +
                          (correct
                            ? "border-success/40 bg-success-subtle text-ink"
                            : "border-subtle text-ink-secondary")
                        }
                      >
                        <span className="font-mono text-ink-muted">
                          {LETTERS[oi] ?? oi + 1}
                        </span>
                        <span className="flex-1">{opt}</span>
                        {correct ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-success-fg" />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {code ? (
                <div className="space-y-2">
                  {question.starterCode ? (
                    <pre className="overflow-x-auto rounded-lg border border-subtle bg-surface-sunken p-2.5 font-mono text-xs text-ink-secondary">
                      {question.starterCode}
                    </pre>
                  ) : null}
                  <p className="text-xs text-ink-muted">
                    {question.testCases.length} test case
                    {question.testCases.length === 1 ? "" : "s"}
                    {question.testCases.some((t) => t.isHidden)
                      ? " (some hidden)"
                      : ""}
                  </p>
                </div>
              ) : null}
              {question.tags.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {question.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-surface-overlay px-2 py-0.5 text-[11px] text-ink-muted"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {trailing ? <div className="shrink-0">{trailing}</div> : null}
      </div>
    </li>
  );
}
