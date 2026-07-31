/**
 * Code Playground — proves the async execution loop end-to-end. Pick a
 * language, write code (CodeMirror), optionally add stdin or test cases, and
 * Run (or Ctrl/Cmd+Enter). Submits to POST /api/execute and tracks the job via
 * SSE (polling fallback), showing queued → processing → result with color-coded
 * stdout/stderr, exit code, compile output, timing, and per-test-case grading.
 */
import {
  CODE_LANGUAGE_LABELS,
  CODE_LANGUAGE_VALUES,
  CodeLanguage,
  MAX_TEST_CASES,
  type ExecuteRequest,
  type ExecutionResult,
  type RunOutput,
  type TestCase,
} from "@codeapt/shared";
import { motion, useReducedMotion } from "framer-motion";
import {
  CheckCircle2,
  ListChecks,
  Play,
  Plus,
  Terminal,
  Trash2,
  XCircle,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { CodeEditor } from "../components/editor/CodeEditor.js";
import { Alert } from "../components/ui/alert.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent } from "../components/ui/card.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";
import { Textarea } from "../components/ui/textarea.js";
import { cn } from "../lib/cn.js";
import { STARTER_SNIPPETS } from "../lib/snippets.js";
import { useCodeRunner, type RunPhase } from "../lib/use-code-runner.js";

type Mode = "run" | "grade";

export function PlaygroundPage() {
  const [language, setLanguage] = useState<CodeLanguage>(CodeLanguage.PYTHON);
  const [source, setSource] = useState<string>(
    STARTER_SNIPPETS[CodeLanguage.PYTHON],
  );
  const [stdin, setStdin] = useState("");
  const [mode, setMode] = useState<Mode>("run");
  const [cases, setCases] = useState<TestCase[]>([
    { input: "", expectedOutput: "" },
  ]);
  const seededRef = useRef<string>(STARTER_SNIPPETS[CodeLanguage.PYTHON]);

  const runner = useCodeRunner();
  const busy =
    runner.phase === "submitting" ||
    runner.phase === "queued" ||
    runner.phase === "processing";

  const changeLanguage = (next: CodeLanguage): void => {
    setSource((cur) => {
      const untouched = cur.trim() === "" || cur === seededRef.current;
      const value = untouched ? STARTER_SNIPPETS[next] : cur;
      seededRef.current = STARTER_SNIPPETS[next];
      return value;
    });
    setLanguage(next);
  };

  const run = useCallback((): void => {
    const req: ExecuteRequest = {
      language,
      source,
      purpose: "playground",
      ...(mode === "run" && stdin.trim().length > 0 ? { stdin } : {}),
      ...(mode === "grade"
        ? {
            testCases: cases.filter(
              (c) => c.input.length > 0 || c.expectedOutput.length > 0,
            ),
          }
        : {}),
    };
    void runner.run(req);
  }, [language, source, stdin, mode, cases, runner]);

  const gradeDisabled =
    mode === "grade" &&
    cases.filter((c) => c.input.length > 0 || c.expectedOutput.length > 0)
      .length === 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-ink">
            <span className="font-mono text-primary">{"{ }"}</span> Playground
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Run code on the async execution engine. Output streams back as the
            job completes.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select
            value={language}
            onValueChange={(v) => changeLanguage(v as CodeLanguage)}
          >
            <SelectTrigger className="w-40" aria-label="Language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CODE_LANGUAGE_VALUES.map((lang) => (
                <SelectItem key={lang} value={lang}>
                  {CODE_LANGUAGE_LABELS[lang]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={run}
            loading={busy}
            disabled={gradeDisabled}
            className="min-w-[7rem]"
          >
            {!busy ? <Play className="h-4 w-4" /> : null}
            {busy ? "Running…" : "Run"}
          </Button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Editor */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-subtle bg-surface-raised px-4 py-2">
            <span className="font-mono text-xs text-ink-muted">
              {language === CodeLanguage.JAVA
                ? "Main.java"
                : `main.${extOf(language)}`}
            </span>
            <span className="hidden text-xs text-ink-muted sm:block">
              <kbd className="rounded border border-strong px-1.5 py-0.5 font-mono text-[10px]">
                {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}
              </kbd>
              {" + "}
              <kbd className="rounded border border-strong px-1.5 py-0.5 font-mono text-[10px]">
                Enter
              </kbd>{" "}
              to run
            </span>
          </div>
          <div className="h-[52vh] min-h-[320px] overflow-auto">
            <CodeEditor
              value={source}
              language={language}
              onChange={setSource}
              onRun={run}
              disabled={busy}
            />
          </div>
        </Card>

        {/* Right column: input mode + output */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="inline-flex rounded-lg border border-subtle p-1">
                <ModeButton
                  active={mode === "run"}
                  onClick={() => setMode("run")}
                  icon={<Terminal className="h-3.5 w-3.5" />}
                  label="Stdin"
                />
                <ModeButton
                  active={mode === "grade"}
                  onClick={() => setMode("grade")}
                  icon={<ListChecks className="h-3.5 w-3.5" />}
                  label="Test cases"
                />
              </div>

              {mode === "run" ? (
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-muted">
                    Standard input (optional)
                  </label>
                  <Textarea
                    value={stdin}
                    onChange={(e) => setStdin(e.target.value)}
                    placeholder="Piped to your program's stdin…"
                    className="h-24 font-mono text-xs"
                  />
                </div>
              ) : (
                <TestCaseEditor cases={cases} onChange={setCases} />
              )}
            </CardContent>
          </Card>

          <OutputPanel
            phase={runner.phase}
            error={runner.error}
            result={runner.result}
            elapsedMs={runner.elapsedMs}
          />
        </div>
      </div>
    </div>
  );
}

function extOf(language: CodeLanguage): string {
  const map: Record<CodeLanguage, string> = {
    [CodeLanguage.PYTHON]: "py",
    [CodeLanguage.JAVASCRIPT]: "js",
    [CodeLanguage.JAVA]: "java",
    [CodeLanguage.CPP]: "cpp",
    [CodeLanguage.C]: "c",
  };
  return map[language];
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
        active ? "bg-primary/15 text-primary" : "text-ink-muted hover:text-ink",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function TestCaseEditor({
  cases,
  onChange,
}: {
  cases: TestCase[];
  onChange: (next: TestCase[]) => void;
}) {
  const update = (i: number, patch: Partial<TestCase>): void => {
    onChange(cases.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  };
  const add = (): void => {
    if (cases.length >= MAX_TEST_CASES) return;
    onChange([...cases, { input: "", expectedOutput: "" }]);
  };
  const remove = (i: number): void => {
    onChange(cases.filter((_, idx) => idx !== i));
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted">
        Each case pipes <span className="text-ink">input</span> to stdin and
        compares stdout to <span className="text-ink">expected</span> (trailing
        whitespace ignored).
      </p>
      {cases.map((c, i) => (
        <div
          key={i}
          className="rounded-lg border border-subtle bg-surface-base p-3"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-xs text-ink-muted">
              Case {i + 1}
            </span>
            <button
              type="button"
              aria-label={`Remove case ${i + 1}`}
              onClick={() => remove(i)}
              className="text-ink-muted transition-colors hover:text-error"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Textarea
              value={c.input}
              onChange={(e) => update(i, { input: e.target.value })}
              placeholder="Input (stdin)"
              className="h-16 font-mono text-xs"
            />
            <Textarea
              value={c.expectedOutput}
              onChange={(e) => update(i, { expectedOutput: e.target.value })}
              placeholder="Expected output"
              className="h-16 font-mono text-xs"
            />
          </div>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={add}
        disabled={cases.length >= MAX_TEST_CASES}
      >
        <Plus className="h-4 w-4" /> Add case
      </Button>
    </div>
  );
}

const PHASE_LABEL: Record<RunPhase, string> = {
  idle: "Idle",
  submitting: "Submitting…",
  queued: "Queued…",
  processing: "Running…",
  completed: "Completed",
  failed: "Failed",
};

function OutputPanel({
  phase,
  error,
  result,
  elapsedMs,
}: {
  phase: RunPhase;
  error: string | null;
  result: ExecutionResult | null;
  elapsedMs: number | null;
}) {
  const reduced = useReducedMotion();
  const running =
    phase === "submitting" || phase === "queued" || phase === "processing";

  return (
    <Card className="flex-1">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Output</h2>
          {phase !== "idle" ? (
            <Badge
              variant={
                phase === "completed"
                  ? "success"
                  : phase === "failed"
                    ? "error"
                    : "neutral"
              }
            >
              {PHASE_LABEL[phase]}
            </Badge>
          ) : null}
        </div>

        {phase === "idle" ? (
          <EmptyState />
        ) : running ? (
          <RunningState reduced={reduced ?? false} phase={phase} />
        ) : phase === "failed" && !result ? (
          <Alert variant="error">{error ?? "Execution failed."}</Alert>
        ) : result ? (
          <ResultView result={result} elapsedMs={elapsedMs} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <span className="font-mono text-3xl text-primary/40">{"{ }"}</span>
      <p className="text-sm text-ink-muted">
        Write some code and hit Run to see the output here.
      </p>
    </div>
  );
}

function RunningState({
  reduced,
  phase,
}: {
  reduced: boolean;
  phase: RunPhase;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <motion.span
        className="font-mono text-4xl text-primary"
        animate={reduced ? undefined : { opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
      >
        {"{ }"}
      </motion.span>
      <p className="text-sm text-ink-muted">{PHASE_LABEL[phase]}</p>
    </div>
  );
}

function ResultView({
  result,
  elapsedMs,
}: {
  result: ExecutionResult;
  elapsedMs: number | null;
}) {
  const graded = result.testResults !== null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant={result.run.exitCode === 0 ? "success" : "error"}>
          exit {result.run.exitCode ?? "—"}
        </Badge>
        {result.timedOut ? <Badge variant="error">timed out</Badge> : null}
        <span className="text-ink-muted">
          {CODE_LANGUAGE_LABELS[result.language]} · {result.version}
        </span>
        {elapsedMs !== null ? (
          <span className="text-ink-muted">
            · {(elapsedMs / 1000).toFixed(1)}s
          </span>
        ) : null}
      </div>

      {graded ? (
        <GradedResults result={result} />
      ) : (
        <RunStreams
          stdout={result.run.stdout}
          stderr={result.run.stderr}
          compile={result.compile}
        />
      )}
    </div>
  );
}

function RunStreams({
  stdout,
  stderr,
  compile,
}: {
  stdout: string;
  stderr: string;
  compile: RunOutput | null;
}) {
  const compileErr = compile && compile.stderr.trim().length > 0;
  return (
    <div className="space-y-3">
      {compileErr ? (
        <Stream label="Compile errors" tone="error" text={compile.stderr} />
      ) : null}
      <Stream label="stdout" tone="normal" text={stdout} empty="(no output)" />
      {stderr.trim().length > 0 ? (
        <Stream label="stderr" tone="error" text={stderr} />
      ) : null}
    </div>
  );
}

function Stream({
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
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <pre
        className={cn(
          "max-h-56 overflow-auto rounded-lg border border-subtle bg-surface-base p-3 font-mono text-xs",
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

function GradedResults({ result }: { result: ExecutionResult }) {
  const passed = result.passedCount ?? 0;
  const total = result.totalCount ?? 0;
  const allPass = total > 0 && passed === total;
  return (
    <div className="space-y-3">
      <div
        className={cn(
          "flex items-center justify-between rounded-lg border p-3",
          allPass
            ? "border-success/50 bg-success-subtle"
            : "border-strong bg-surface-base",
        )}
      >
        <span className="text-sm font-medium text-ink">Test cases</span>
        <span className="font-mono text-sm text-ink">
          {passed}/{total} passed
        </span>
      </div>
      <ul className="space-y-2">
        {result.testResults?.map((tc) => (
          <li
            key={tc.index}
            className={cn(
              "rounded-lg border p-3 text-xs",
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
              <span className="font-medium text-ink">Case {tc.index + 1}</span>
            </div>
            {!tc.passed ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <LabeledPre label="Expected" text={tc.expectedOutput} />
                <LabeledPre label="Got" text={tc.actualOutput} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LabeledPre({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="mb-0.5 text-[10px] uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <pre className="max-h-24 overflow-auto rounded border border-subtle bg-surface-raised p-2 font-mono text-[11px] text-ink">
        {text.length > 0 ? text : "(empty)"}
      </pre>
    </div>
  );
}
