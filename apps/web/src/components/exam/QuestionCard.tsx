/**
 * Renders one exam question for the candidate: MCQ_SINGLE → radios, MCQ_MULTI →
 * checkboxes, CODE → the shared CodeMirror editor with visible sample cases.
 * Answers/correct options for CODE hidden tests are never present client-side.
 */
import {
  CODE_LANGUAGE_LABELS,
  ExamQuestionType,
  type CodeLanguage,
  type ExecutionResult,
  type SanitizedQuestion,
} from "@codeapt/shared";
import { CheckCircle2, Play, Terminal, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { cn } from "../../lib/cn.js";
import { imageUrl } from "../../lib/cloudinary.js";
import {
  buildCustomRunRequest,
  buildSampleRunRequest,
  canRunCode,
  defaultRunLanguage,
  hasSampleCases,
  isLanguageLocked,
  languageChoices,
  stubForLanguage,
} from "../../lib/exam-code-run.js";
import type { LocalAnswer } from "../../lib/exam-runner.js";
import { useCodeRunner } from "../../lib/use-code-runner.js";
import { CodeEditor } from "../editor/CodeEditor.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Checkbox } from "../ui/checkbox.js";
import { RadioGroup, RadioGroupItem } from "../ui/radio.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.js";
import { Textarea } from "../ui/textarea.js";

const LETTERS = ["A", "B", "C", "D", "E"];

export function QuestionCard({
  index,
  question,
  answer,
  onChange,
  onToggle,
  disabled,
}: {
  index: number;
  question: SanitizedQuestion;
  answer: LocalAnswer | undefined;
  onChange: (patch: LocalAnswer) => void;
  /** Race-free MCQ option toggle (single replaces, multi add/removes). */
  onToggle: (index: number) => void;
  disabled?: boolean;
}) {
  const selected = answer?.selectedOptions ?? [];

  // Seed the CODE editor with the starter once, so an untouched starter is
  // still saved/submitted (marks it dirty for autosave). The seeded language is
  // the policy default (locked language, else authored/python) with its stub.
  useEffect(() => {
    if (
      question.type === ExamQuestionType.CODE &&
      (answer?.code === undefined || answer.code === null)
    ) {
      const language = defaultRunLanguage(question);
      onChange({ code: stubForLanguage(language, question), language });
    }
    // Run once per question mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id]);

  return (
    <div
      id={`question-${question.id}`}
      className="scroll-mt-24 rounded-2xl border border-subtle bg-surface-raised p-6"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <h3 className="font-medium text-ink">
          <span className="mr-2 font-mono text-ink-muted">Q{index + 1}.</span>
          {question.text}
        </h3>
        <Badge variant="neutral">{question.marks} pts</Badge>
      </div>

      {question.image ? (
        <img
          src={imageUrl(question.image)}
          alt=""
          className="mb-4 max-h-[60dvh] w-auto max-w-full rounded-lg border border-subtle"
        />
      ) : null}

      {question.type === ExamQuestionType.CODE ? (
        <CodeSection
          question={question}
          code={answer?.code ?? question.starterCode ?? ""}
          language={
            (answer?.language as CodeLanguage | undefined) ??
            defaultRunLanguage(question)
          }
          onChange={(code, language) => onChange({ code, language })}
          disabled={disabled}
        />
      ) : question.type === ExamQuestionType.MCQ_SINGLE ? (
        <RadioGroup
          value={selected.length ? String(selected[0]) : ""}
          disabled={disabled}
          className="gap-2"
        >
          {(question.options ?? []).map((opt, i) => (
            <OptionRow
              key={i}
              letter={LETTERS[i] ?? String(i + 1)}
              text={opt}
              active={selected.includes(i)}
              onClick={() => !disabled && onToggle(i)}
              control={<RadioGroupItem value={String(i)} />}
            />
          ))}
        </RadioGroup>
      ) : (
        <div className="grid gap-2">
          {(question.options ?? []).map((opt, i) => (
            <OptionRow
              key={i}
              letter={LETTERS[i] ?? String(i + 1)}
              text={opt}
              active={selected.includes(i)}
              onClick={() => !disabled && onToggle(i)}
              control={
                <Checkbox
                  checked={selected.includes(i)}
                  disabled={disabled}
                  onCheckedChange={() => !disabled && onToggle(i)}
                />
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OptionRow({
  letter,
  text,
  active,
  onClick,
  control,
}: {
  letter: string;
  text: string;
  active: boolean;
  onClick: () => void;
  control: React.ReactNode;
}) {
  return (
    <label
      onClick={onClick}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition-colors",
        active
          ? "border-primary/60 bg-primary/10"
          : "border-subtle hover:border-primary/40",
      )}
    >
      {control}
      <span className="font-mono text-xs text-ink-muted">{letter}</span>
      <span className="flex-1 text-ink">{text}</span>
    </label>
  );
}

function CodeSection({
  question,
  code,
  language: initialLanguage,
  onChange,
  disabled,
}: {
  question: SanitizedQuestion;
  code: string;
  language: CodeLanguage;
  onChange: (code: string, language: CodeLanguage) => void;
  disabled?: boolean;
}) {
  const samples = question.sampleCases ?? [];
  const [stdin, setStdin] = useState("");
  const [language, setLanguage] = useState<CodeLanguage>(initialLanguage);
  const runner = useCodeRunner();
  const busy =
    runner.phase === "submitting" ||
    runner.phase === "queued" ||
    runner.phase === "processing";
  const canRun = canRunCode(code, disabled);
  const hasSamples = hasSampleCases(question);
  const locked = isLanguageLocked(question.allowedLanguages);

  // Switching language (only possible when OPEN): swap the stub ONLY if the
  // editor still holds the untouched starter for the current language — never
  // clobber code the student has already typed. The chosen language is what
  // Run and Submit send.
  const changeLanguage = useCallback(
    (next: CodeLanguage): void => {
      const currentStub = stubForLanguage(language, question).trim();
      const untouched = code.trim() === currentStub || code.trim() === "";
      const nextCode = untouched ? stubForLanguage(next, question) : code;
      setLanguage(next);
      onChange(nextCode, next);
    },
    [language, code, question, onChange],
  );

  // Test-runs only EXECUTE code — they never submit, consume an attempt, or
  // mutate the saved answer (which changes solely via onChange on edits).
  const runSamples = useCallback((): void => {
    if (!canRun || busy) return;
    void runner.run(buildSampleRunRequest(language, question.sampleCases, code));
  }, [canRun, busy, runner, language, question.sampleCases, code]);

  const runCustom = useCallback((): void => {
    if (!canRun || busy) return;
    void runner.run(buildCustomRunRequest(language, code, stdin));
  }, [canRun, busy, runner, language, code, stdin]);

  // Ctrl/Cmd+Enter runs the sample cases (or the custom input if none exist).
  const onEditorRun = useCallback((): void => {
    if (hasSamples) runSamples();
    else runCustom();
  }, [hasSamples, runSamples, runCustom]);

  return (
    <div className="space-y-3">
      {/* Language policy: dropdown only when OPEN; a fixed label when LOCKED. */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-ink-muted">Language</span>
        {locked ? (
          <span className="rounded-md border border-subtle bg-surface-base px-2 py-1 text-xs text-ink">
            {CODE_LANGUAGE_LABELS[language]}{" "}
            <span className="text-ink-muted">(locked)</span>
          </span>
        ) : (
          <Select
            value={language}
            onValueChange={(v) => changeLanguage(v as CodeLanguage)}
            disabled={disabled}
          >
            <SelectTrigger className="h-8 w-40" aria-label="Language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {languageChoices(question.allowedLanguages).map((l) => (
                <SelectItem key={l} value={l}>
                  {CODE_LANGUAGE_LABELS[l]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {samples.length > 0 ? (
        <div>
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
                  <span className="font-mono text-ink">{c.expectedOutput}</span>
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="sm:hidden rounded-lg border border-warning-subtle bg-warning-subtle/30 p-4 text-center mt-4">
        <p className="text-sm font-medium text-warning-fg">Coding questions require a larger screen.</p>
        <p className="text-xs text-warning-fg/80 mt-1">Please use a tablet, laptop, or desktop to complete this coding exam.</p>
      </div>

      <div className="hidden sm:block h-[38dvh] min-h-[260px] overflow-auto rounded-lg border border-subtle">
        <CodeEditor
          value={code}
          language={language}
          onChange={(next) => onChange(next, language)}
          onRun={onEditorRun}
          disabled={disabled}
        />
      </div>

      {/* Run controls — separate from the exam's Submit; these only execute. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={runSamples}
          loading={busy}
          disabled={!canRun || busy || !hasSamples}
          title={hasSamples ? undefined : "No sample cases for this question"}
        >
          {!busy ? <Play className="h-4 w-4" /> : null}
          {busy ? "Running…" : "Run sample cases"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={runCustom}
          disabled={!canRun || busy}
        >
          <Terminal className="h-4 w-4" /> Run custom input
        </Button>
        <span className="text-xs text-ink-muted">
          Running tests your code — it does not submit the exam.
        </span>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-ink-muted">
          Custom input (stdin)
        </label>
        <Textarea
          value={stdin}
          onChange={(e) => setStdin(e.target.value)}
          placeholder="Piped to your program's stdin for “Run custom input”…"
          className="h-20 font-mono text-xs"
          disabled={disabled}
        />
      </div>

      <RunOutput
        phase={runner.phase}
        error={runner.error}
        errorStatus={runner.errorStatus}
        result={runner.result}
      />
    </div>
  );
}

/** Compact result panel for an in-exam test-run (mirrors the playground). */
function RunOutput({
  phase,
  error,
  errorStatus,
  result,
}: {
  phase: string;
  error: string | null;
  errorStatus: number | null;
  result: ExecutionResult | null;
}) {
  if (phase === "idle") return null;
  const running =
    phase === "submitting" || phase === "queued" || phase === "processing";

  if (running) {
    return (
      <p className="text-xs text-ink-muted" role="status">
        Running…
      </p>
    );
  }

  if (phase === "failed" && !result) {
    return (
      <Alert variant="error">
        {errorStatus === 429
          ? "You're running code too quickly — wait a moment and try again."
          : (error ?? "Execution failed.")}
      </Alert>
    );
  }

  if (!result) return null;

  const graded = result.testResults !== null;
  const compileErr =
    result.compile && result.compile.stderr.trim().length > 0
      ? result.compile.stderr
      : null;

  return (
    <div className="space-y-2 rounded-lg border border-subtle bg-surface-base p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant={result.run.exitCode === 0 ? "success" : "error"}>
          exit {result.run.exitCode ?? "—"}
        </Badge>
        {result.timedOut ? <Badge variant="error">timed out</Badge> : null}
        {graded ? (
          <span className="font-mono text-ink-muted">
            {result.passedCount ?? 0}/{result.totalCount ?? 0} sample cases
            passed
          </span>
        ) : null}
      </div>

      {compileErr ? (
        <OutBlock label="Compile errors" tone="error" text={compileErr} />
      ) : null}

      {graded ? (
        <ul className="space-y-2">
          {result.testResults?.map((tc) => (
            <li
              key={tc.index}
              className={cn(
                "rounded-lg border p-2 text-xs",
                tc.passed
                  ? "border-success/40 bg-success-subtle/50"
                  : "border-error/40 bg-error-subtle",
              )}
            >
              <div className="mb-1 flex items-center gap-2">
                {tc.passed ? (
                  <CheckCircle2 className="h-4 w-4 text-success-fg" />
                ) : (
                  <XCircle className="h-4 w-4 text-error-fg" />
                )}
                <span className="font-medium text-ink">
                  Case {tc.index + 1} — {tc.passed ? "PASS" : "FAIL"}
                </span>
              </div>
              {!tc.passed ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  <OutBlock label="Input" tone="normal" text={tc.input} />
                  <OutBlock
                    label="Expected"
                    tone="normal"
                    text={tc.expectedOutput}
                  />
                  <OutBlock label="Got" tone="normal" text={tc.actualOutput} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-2">
          <OutBlock
            label="stdout"
            tone="normal"
            text={result.run.stdout}
            empty="(no output)"
          />
          {result.run.stderr.trim().length > 0 ? (
            <OutBlock label="stderr" tone="error" text={result.run.stderr} />
          ) : null}
        </div>
      )}
    </div>
  );
}

function OutBlock({
  label,
  tone,
  text,
  empty,
}: {
  label: string;
  tone: "normal" | "error";
  text: string;
  empty?: string;
}) {
  const isEmpty = text.length === 0;
  return (
    <div>
      <p className="mb-0.5 text-[10px] uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <pre
        className={cn(
          "max-h-40 overflow-auto rounded border border-subtle bg-surface-raised p-2 font-mono text-[11px]",
          isEmpty
            ? "italic text-ink-muted"
            : tone === "error"
              ? "text-error-fg"
              : "text-ink",
        )}
      >
        {isEmpty ? (empty ?? "(empty)") : text}
      </pre>
    </div>
  );
}
