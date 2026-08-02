/**
 * <CodeRunnerMock> — the landing's signature visual: a glassy editor window that
 * types a snippet line-by-line, "runs" it, then cascades its test cases to a
 * green pass. It is a faithful, brand-styled *mock* of CodeApt's real in-browser
 * execution (exams + playground) — no real engine, no network, just motion.
 *
 * Motion is a single self-cleaning timeline (absolute-offset setTimeouts, all
 * cleared on unmount), started the first time the card scrolls into view.
 * Reduced motion OR before-in-view renders the FINAL state (full code, all
 * tests passed) — so it is always a complete, legible picture, never a blank
 * shell. Decorative chrome is aria-hidden; the code is exposed as a labelled
 * <pre> for screen readers.
 */
import { useInView, useReducedMotion } from "framer-motion";
import { Check, Play, Loader2, Terminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "../../../lib/cn.js";

type TokenKind = "kw" | "fn" | "str" | "num" | "com" | "op" | "txt";
export interface CodeToken {
  t: string;
  k?: TokenKind;
}
/** A line is an ordered set of coloured tokens (a tiny hand-rolled highlighter). */
export type CodeLine = CodeToken[];

const TOKEN_CLASS: Record<TokenKind, string> = {
  kw: "text-primary",
  fn: "text-info-fg",
  str: "text-success-fg",
  num: "text-warning-fg",
  com: "text-ink-muted italic",
  op: "text-ink-muted",
  txt: "text-ink-secondary",
};

export interface CodeRunnerMockProps {
  filename: string;
  language: string;
  /** Optional language chips shown as tabs (purely decorative). */
  tabs?: string[];
  lines: CodeLine[];
  tests: string[];
  /** Optional context bar above the editor (e.g. exam section + timer). */
  topBar?: { label: string; meta: string };
  className?: string;
}

type Phase = "idle" | "typing" | "running" | "passed";

export function CodeRunnerMock({
  filename,
  language,
  tabs,
  lines,
  tests,
  topBar,
  className,
}: CodeRunnerMockProps) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });

  const [phase, setPhase] = useState<Phase>(reduced ? "passed" : "idle");
  const [visibleLines, setVisibleLines] = useState(
    reduced ? lines.length : 0,
  );
  const [passedCount, setPassedCount] = useState(reduced ? tests.length : 0);

  useEffect(() => {
    if (reduced || !inView) return;
    const ids: number[] = [];
    const at = (ms: number, fn: () => void): void => {
      ids.push(window.setTimeout(fn, ms));
    };

    let t = 0;
    setPhase("typing");
    for (let i = 1; i <= lines.length; i += 1) {
      const n = i;
      at(t, () => setVisibleLines(n));
      t += 190;
    }
    t += 450;
    at(t, () => setPhase("running"));
    t += 950;
    at(t, () => setPhase("passed"));
    for (let j = 1; j <= tests.length; j += 1) {
      const n = j;
      at(t, () => setPassedCount(n));
      t += 240;
    }

    return () => ids.forEach(clearTimeout);
  }, [inView, reduced, lines.length, tests.length]);

  const plainCode = lines
    .map((line) => line.map((tok) => tok.t).join(""))
    .join("\n");

  return (
    <div
      ref={ref}
      className={cn(
        "glass overflow-hidden rounded-2xl shadow-lg ring-1 ring-white/5",
        className,
      )}
    >
      {/* Window chrome */}
      <div
        aria-hidden="true"
        className="flex items-center gap-2 border-b border-subtle/70 bg-surface-overlay/50 px-4 py-2.5"
      >
        <span className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-error/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
        </span>
        <span className="ml-2 font-mono text-xs text-ink-muted">{filename}</span>
        <span className="ml-auto rounded-md bg-primary/15 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-primary">
          {language}
        </span>
      </div>

      {/* Optional language tabs */}
      {tabs && tabs.length > 0 ? (
        <div
          aria-hidden="true"
          className="flex gap-1 border-b border-subtle/70 bg-surface-base/40 px-3 py-1.5"
        >
          {tabs.map((tab, i) => (
            <span
              key={tab}
              className={cn(
                "rounded-md px-2.5 py-1 font-mono text-[11px]",
                i === 0
                  ? "bg-surface-overlay text-ink"
                  : "text-ink-muted",
              )}
            >
              {tab}
            </span>
          ))}
        </div>
      ) : null}

      {/* Optional context bar (exam framing) */}
      {topBar ? (
        <div
          aria-hidden="true"
          className="flex items-center justify-between border-b border-subtle/70 bg-primary/[0.06] px-4 py-2"
        >
          <span className="flex items-center gap-1.5 text-xs font-medium text-ink-secondary">
            <Terminal className="h-3.5 w-3.5 text-primary" />
            {topBar.label}
          </span>
          <span className="font-mono text-xs text-primary">{topBar.meta}</span>
        </div>
      ) : null}

      {/* Editor body — visually a code block; a11y-exposed as one <pre>. */}
      <div className="relative px-4 py-4 overflow-x-auto">
        <pre className="sr-only">{plainCode}</pre>
        <div aria-hidden="true" className="space-y-1 font-mono text-[13px] leading-6 min-w-max">
          {lines.map((line, li) => (
            <div
              key={li}
              className={cn(
                "flex gap-3 transition-opacity",
                li < visibleLines ? "opacity-100" : "opacity-0",
              )}
            >
              <span className="w-5 shrink-0 select-none text-right text-ink-muted/50">
                {li + 1}
              </span>
              <span className="whitespace-pre">
                {line.map((tok, ti) => (
                  <span key={ti} className={TOKEN_CLASS[tok.k ?? "txt"]}>
                    {tok.t}
                  </span>
                ))}
                {/* Blink caret on the line currently being typed. */}
                {!reduced && phase === "typing" && li === visibleLines - 1 ? (
                  <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-glow-pulse bg-primary align-middle" />
                ) : null}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Run bar + verdict */}
      <div className="flex items-center gap-3 border-t border-subtle/70 bg-surface-overlay/40 px-4 py-3">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold",
            phase === "passed"
              ? "bg-success/15 text-success-fg"
              : "bg-primary text-ink-inverse",
          )}
        >
          {phase === "running" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : phase === "passed" ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {phase === "running"
            ? "Running…"
            : phase === "passed"
              ? "Accepted"
              : "Run"}
        </span>
        {phase === "passed" ? (
          <span className="font-mono text-xs text-ink-muted">
            {tests.length}/{tests.length} tests · 0.42s
          </span>
        ) : (
          <span className="font-mono text-xs text-ink-muted">
            {language} · {tests.length} test cases
          </span>
        )}
      </div>

      {/* Test results */}
      <div className="space-y-1.5 border-t border-subtle/70 px-4 py-3">
        {tests.map((label, i) => {
          const done = i < passedCount;
          return (
            <div
              key={label}
              className="flex items-center gap-2 text-xs"
            >
              <span
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded-full transition-colors",
                  done
                    ? "bg-success/20 text-success-fg"
                    : "bg-surface-overlay text-ink-muted",
                )}
              >
                {done ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-current opacity-40" />
                )}
              </span>
              <span className={done ? "text-ink-secondary" : "text-ink-muted"}>
                {label}
              </span>
              {done ? (
                <span className="ml-auto font-mono text-[11px] text-success-fg">
                  passed
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
