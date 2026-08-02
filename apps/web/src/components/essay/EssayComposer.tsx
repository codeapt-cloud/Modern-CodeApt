/**
 * The essay-writing screen's compose view: the prompt (title/description/
 * instructions, safely rendered), a plain-text writing area, a LIVE word
 * counter with under/in/over affordances, an optional DISPLAY-ONLY countdown,
 * and cheap in-memory compose-analytics capture.
 *
 * Word bounds are advisory client-side — submit is disabled out of range, but
 * the server's 422 is the source of truth and is surfaced inline (`submitError`).
 * The timer is guidance only: on expiry we show a gentle cue and STILL allow
 * submit (there is no server-side essay timer). Draft is autosaved; a
 * beforeunload guard warns before losing unsaved text.
 *
 * PROCTORING (college essays only — `proctored`): the writing surface reuses the
 * SAME anti-cheat as the exam runner (the shared `useProctoring` hook) — it opens
 * in fullscreen, and a tab-switch / window-blur / fullscreen-exit / blocked-paste
 * counts as a warning under the SAME policy as exams (EXAM_MAX_WARNINGS; crossing
 * it flags the attempt as malpractice and auto-submits). Copy/paste/cut/context-
 * menu/drag and the Ctrl/Cmd+A/C/X/V shortcuts are disabled. A keystroke-integrity
 * heuristic additionally FLAGS burst / no-keystroke insertions (advisory — see
 * essay-integrity.ts). Individual essays pass `proctored={false}` and behave
 * exactly as before (no gate, no blocking, no integrity payload). Autosave works
 * in both modes.
 *
 * HONEST LIMIT: blocking paste stops the common vector and the heuristic flags
 * suspicious insertion, but a browser page cannot guarantee prevention of a
 * sophisticated extension that simulates keystrokes. Flags are advisory.
 */
import {
  EXAM_MAX_WARNINGS,
  analyzeInput,
  createIntegrityState,
  creditKeystroke,
  essayWarningOutcome,
  flagBlockedPaste,
  type EssayAnalyticsInput,
  type EssayIntegrity,
  type EssayPromptDetail,
} from "@codeapt/shared";
import { useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  Clock,
  Loader2,
  Maximize,
  Save,
  Send,
  ShieldAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatCountdown } from "../../lib/exam-runner.js";
import {
  countWords,
  emptyAnalytics,
  onKeystroke,
  onPaste,
  wordCountStatus,
  type ComposeAnalytics,
} from "../../lib/essay-compose.js";
import { draftStatusLabel, shouldRecoverDraft } from "../../lib/essay-draft.js";
import type { EssayWriterApi } from "../../lib/essay-writer-api.js";
import { useEssayDraft } from "../../lib/use-essay-draft.js";
import {
  useProctoring,
  type ProctoringReason,
} from "../../lib/use-proctoring.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Textarea } from "../ui/textarea.js";
import { useToast } from "../ui/toast.js";
import { Markdown } from "../player/Markdown.js";

const STATE_TEXT: Record<string, string> = {
  empty: "text-ink-muted",
  under: "text-warning-fg",
  in: "text-success-fg",
  over: "text-error-fg",
};

export function EssayComposer({
  prompt,
  submitting,
  submitError,
  attemptLabel,
  proctored = false,
  onSubmit,
  writerApi,
}: {
  prompt: EssayPromptDetail;
  submitting: boolean;
  submitError: string | null;
  /** e.g. "Attempt 2 of 3" — shown as guidance; null hides it. */
  attemptLabel?: string | null;
  /** Proctor this essay like an exam (college essays). Individual → false. */
  proctored?: boolean;
  /** Called with the essay text, compose analytics, and (proctored) integrity. */
  onSubmit: (
    content: string,
    analytics: EssayAnalyticsInput,
    integrity?: EssayIntegrity,
  ) => void;
  /** Draft autosave backend — defaults to the individual api; the college
   * writer injects a slug-bound adapter. */
  writerApi?: EssayWriterApi;
}) {
  const reduced = useReducedMotion();
  const { toast } = useToast();
  const [content, setContent] = useState("");
  const [recovered, setRecovered] = useState(false);

  // Analytics + compose-time are refs — updated per keystroke without re-render.
  const analyticsRef = useRef<ComposeAnalytics>(emptyAnalytics());
  const startedAtRef = useRef<number | null>(null);

  // Autosave + recovery (a pure snapshot buffer — never submits or grades).
  const draft = useEssayDraft(prompt.id, writerApi);
  const contentRef = useRef(content);
  contentRef.current = content;
  const didRecover = useRef(false);
  useEffect(() => {
    if (didRecover.current) return;
    didRecover.current = true;
    void (async () => {
      const text = await draft.recover();
      // Only restore into a still-empty editor; never clobber fresh typing.
      if (text && shouldRecoverDraft(text, contentRef.current)) {
        setContent(text);
        setRecovered(true);
      }
    })();
  }, [draft]);

  // --- Proctoring state (college essays) ------------------------------------
  // `started` gates the writing surface behind a fullscreen "Begin" gesture.
  const [started, setStarted] = useState(!proctored);
  const [warnings, setWarnings] = useState(0);
  const [warningOpen, setWarningOpen] = useState(false);
  const [flagged, setFlagged] = useState(false);
  const warningsRef = useRef(0);
  const submittedRef = useRef(false);
  const integrityRef = useRef(createIntegrityState());
  const toastedFlags = useRef<Record<string, boolean>>({});

  const status = useMemo(
    () =>
      wordCountStatus(countWords(content), prompt.minWords, prompt.maxWords),
    [content, prompt.minWords, prompt.maxWords],
  );

  // Finalize the submission (manual or auto). Reads the LATEST content/warnings
  // from refs so the proctoring callback never captures a stale value.
  const submitNow = useCallback(
    (auto: boolean): void => {
      if (submittedRef.current || submitting) return;
      const text = contentRef.current;
      // An auto-submit with nothing written can't be graded (server needs ≥1
      // char) — lock + flag instead and let the student type, still carrying the
      // warnings/flags when they submit. The normal path submits what's there.
      if (auto && text.trim().length === 0) {
        setFlagged(true);
        return;
      }
      if (!auto && !status.canSubmit) return;
      submittedRef.current = true;
      const a = analyticsRef.current;
      const composeSeconds = startedAtRef.current
        ? Math.round((performance.now() - startedAtRef.current) / 1000)
        : 0;
      const analytics: EssayAnalyticsInput = {
        keystrokes: a.keystrokes,
        deletes: a.deletes,
        pasteCount: a.pasteCount,
        pastedChars: a.pastedChars,
        composeSeconds,
        wordCount: countWords(text),
        characterCount: text.length,
      };
      const integrity: EssayIntegrity | undefined = proctored
        ? {
            warnings: warningsRef.current,
            autoSubmitted: auto,
            flags: integrityRef.current.flags,
          }
        : undefined;
      onSubmit(text, analytics, integrity);
    },
    [proctored, status.canSubmit, submitting, onSubmit],
  );

  // One proctoring violation: count it, toast a blocked paste, then apply the
  // EXACT exam policy (crossing EXAM_MAX_WARNINGS → flag + auto-submit).
  const onWarning = useCallback(
    (reason: ProctoringReason): void => {
      if (submittedRef.current) return;
      warningsRef.current += 1;
      const count = warningsRef.current;
      setWarnings(count);
      if (reason === "blocked-paste") {
        integrityRef.current = flagBlockedPaste(integrityRef.current);
        toast({
          variant: "warning",
          title: "Pasting is disabled during essays.",
        });
      }
      const outcome = essayWarningOutcome(count);
      if (outcome.autoSubmit) {
        setFlagged(true);
        setWarningOpen(false);
        submitNow(true);
      } else {
        setWarningOpen(true);
      }
    },
    [toast, submitNow],
  );

  const { requestFullscreen } = useProctoring({
    active: proctored && started,
    onWarning,
    block: {
      copy: true,
      cut: true,
      paste: true,
      contextmenu: true,
      drag: true,
      shortcuts: true,
    },
    warnOnPaste: true,
    guardUnload: true,
  });

  // Guard against accidental navigation loss while there's unsaved text
  // (individual essays; proctored essays get the guard via the hook).
  useEffect(() => {
    if (proctored) return;
    const dirty = content.trim().length > 0;
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [content, proctored]);

  // --- Display-only countdown (guidance, NOT enforced) ---
  const timed = prompt.timeLimitMinutes > 0;
  const [remaining, setRemaining] = useState(prompt.timeLimitMinutes * 60);
  useEffect(() => {
    if (!timed) return;
    const id = window.setInterval(
      () => setRemaining((s) => (s <= 0 ? 0 : s - 1)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [timed]);
  const timeUp = timed && remaining <= 0;

  const noteTyping = (key: string): void => {
    analyticsRef.current = onKeystroke(analyticsRef.current, key);
    // Credit character-producing keys so the heuristic can tell a typed stream
    // from an injected block (single-char `key` = a printable character).
    if (proctored && key.length === 1) {
      integrityRef.current = creditKeystroke(integrityRef.current);
    }
  };

  const handleChange = (value: string): void => {
    if (startedAtRef.current === null) startedAtRef.current = performance.now();
    if (proctored) {
      const { state, raised } = analyzeInput(integrityRef.current, {
        prevLen: contentRef.current.length,
        nextLen: value.length,
        now: performance.now(),
      });
      integrityRef.current = state;
      if (raised && !toastedFlags.current[raised]) {
        toastedFlags.current[raised] = true;
        toast({
          variant: "warning",
          title: "Unusual text insertion detected — flagged for review.",
        });
      }
    }
    setContent(value);
    draft.schedule(value);
  };

  const handleSubmit = (): void => submitNow(false);

  // --- Proctored "Begin" gate: enter fullscreen on the user gesture ---------
  if (proctored && !started) {
    return (
      <div className="mx-auto max-w-xl space-y-5 rounded-2xl border border-subtle bg-surface-raised p-6">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-ink">
            Proctored essay — {prompt.title}
          </h2>
        </div>
        <p className="text-sm text-ink-secondary">
          This essay is monitored like an exam. Before you begin, please note:
        </p>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-secondary">
          <li>It opens in fullscreen and stays there while you write.</li>
          <li>
            Leaving fullscreen, switching tabs, or losing window focus is
            recorded as a warning. After {EXAM_MAX_WARNINGS} warnings your essay
            is flagged and submitted automatically.
          </li>
          <li>Copy, paste, cut, and right-click are disabled.</li>
          <li>
            Text that appears without matching keystrokes is flagged for review.
          </li>
          <li>Your draft still autosaves as you write.</li>
        </ul>
        <p className="text-xs text-ink-muted">
          Honest note: blocking paste and flagging insertion deter the common
          cases — they can&apos;t catch every possible browser extension, so
          flags are advisory and reviewed by your college.
        </p>
        <div className="flex justify-end">
          <Button
            onClick={() => {
              requestFullscreen();
              setStarted(true);
            }}
          >
            <Maximize className="h-4 w-4" /> Begin proctored essay
          </Button>
        </div>
      </div>
    );
  }

  const editor = (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
      {/* Prompt — not selectable when proctored, so it can't be copied out. */}
      <aside className={`space-y-4 ${proctored ? "select-none" : ""}`}>
        <div className="rounded-2xl border border-subtle bg-surface-raised p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">{prompt.title}</h2>
            {attemptLabel ? (
              <span className="shrink-0 rounded-full border border-subtle px-2.5 py-1 text-xs font-medium text-ink-muted">
                {attemptLabel}
              </span>
            ) : null}
          </div>
          {prompt.description ? (
            <p className="mt-2 text-sm text-ink-secondary">
              {prompt.description}
            </p>
          ) : null}
        </div>
        {prompt.instructions ? (
          <div className="rounded-2xl border border-subtle bg-surface-raised p-5">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Instructions
            </h3>
            <Markdown content={prompt.instructions} className="text-sm" />
          </div>
        ) : null}
        {proctored ? (
          <div className="flex items-center gap-2 rounded-xl border border-subtle bg-surface-base px-3 py-2 text-xs text-ink-muted">
            <ShieldAlert className="h-3.5 w-3.5 text-primary" />
            <span>
              Proctored · {warnings} warning{warnings === 1 ? "" : "s"}
              {flagged ? " · flagged for review" : ""}
            </span>
          </div>
        ) : null}
      </aside>

      {/* Editor */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className={`text-sm font-medium ${STATE_TEXT[status.state]}`}>
            <span className="font-mono">{status.count}</span> words —{" "}
            {status.message}
          </div>
          {timed ? (
            <div
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-sm ${
                timeUp
                  ? "border-warning/60 text-warning-fg"
                  : "border-subtle text-ink"
              }`}
            >
              <Clock className="h-3.5 w-3.5" />
              {formatCountdown(remaining)}
            </div>
          ) : null}
        </div>

        {recovered ? (
          <Alert variant="info">
            Recovered your last draft — pick up right where you left off.
          </Alert>
        ) : null}
        {flagged ? (
          <Alert variant="warning">
            This attempt has been flagged for review due to proctoring warnings.
            You can still finish and submit; the flag is recorded.
          </Alert>
        ) : null}
        {timeUp ? (
          <Alert variant="warning">
            Time&rsquo;s up — this timer is guidance only, so you can still
            finish and submit when you&rsquo;re ready.
          </Alert>
        ) : null}
        {submitError ? <Alert variant="error">{submitError}</Alert> : null}

        <Textarea
          value={content}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => noteTyping(e.key)}
          onPaste={(e) => {
            if (proctored) {
              // Blocked by the proctoring hook (document-level) + counted there;
              // prevent here too and don't record it as normal paste analytics.
              e.preventDefault();
              return;
            }
            const pasted = e.clipboardData.getData("text");
            analyticsRef.current = onPaste(analyticsRef.current, pasted.length);
          }}
          invalid={status.state === "over"}
          placeholder="Write your essay here…"
          className="min-h-[46dvh] resize-y text-[0.95rem] leading-7"
          aria-label="Essay text"
        />

        <div className="flex items-center justify-between gap-3">
          <div
            className="inline-flex items-center gap-1.5 text-xs text-ink-muted"
            aria-live="polite"
          >
            {draft.state === "saving" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : draft.state === "error" ? (
              <AlertTriangle className="h-3 w-3 text-warning-fg" />
            ) : draft.savedAt ? (
              <Check className="h-3 w-3 text-success-fg" />
            ) : (
              <Save className="h-3 w-3" />
            )}
            <span>
              {draft.state === "idle"
                ? draft.savedAt
                  ? "Draft saved"
                  : "Autosaves as you write"
                : draftStatusLabel(draft.state)}
            </span>
          </div>
          <Button
            onClick={handleSubmit}
            disabled={!status.canSubmit}
            loading={submitting}
            className={reduced ? "" : "transition-transform"}
          >
            <Send className="h-4 w-4" /> Submit for grading
          </Button>
        </div>
      </div>

      {/* Proctoring warning dialog (mirrors the exam runner). */}
      <Dialog open={warningOpen} onOpenChange={setWarningOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning-fg" />
              Warning {warnings}
            </DialogTitle>
            <DialogDescription>
              Leaving the essay window, switching tabs, or attempting to paste is
              recorded. More than {EXAM_MAX_WARNINGS} warnings flags your essay
              for review and submits it automatically. Please keep writing in
              fullscreen.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => {
                requestFullscreen();
                setWarningOpen(false);
              }}
            >
              <Maximize className="h-4 w-4" /> Return to essay
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  // A STARTED proctored essay takes over the full viewport (z above the sidebar
  // rail [z-overlay] but below the warning dialog [z-modal] and toasts), so the
  // app's sidebar/header and the "All essays" link can't be used to navigate
  // away mid-attempt — matching the exam runner, which renders outside the app
  // shell entirely. Individual essays render inline, unchanged.
  if (proctored) {
    return (
      <div className="fixed inset-0 z-[1250] overflow-y-auto bg-surface-base p-4 sm:p-6 lg:p-8">
        {editor}
      </div>
    );
  }
  return editor;
}
