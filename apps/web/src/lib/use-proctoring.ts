/**
 * Shared proctoring / anti-cheat hook — the SINGLE source of the browser-side
 * exam-integrity behavior, consumed by BOTH the exam runner and the (college)
 * essay composer so the two never fork.
 *
 * It attaches document/window listeners while `active` and:
 *  - DETECTS focus-loss violations — tab-switch (visibilitychange → hidden),
 *    fullscreen exit (fullscreenchange), and window blur — and calls
 *    `onWarning(reason)`, debounced by `cooldownMs` so one navigation ≠ a storm.
 *  - BLOCKS (preventDefault) the configured clipboard/interaction events:
 *    copy, cut, paste, contextmenu, dragstart, drop, and (via keydown) the
 *    Ctrl/Cmd+A/C/X/V shortcuts.
 *  - Optionally treats a blocked PASTE as a counted warning (`warnOnPaste`) —
 *    the exam blocks copy+contextmenu silently and does NOT count them; the
 *    essay additionally blocks paste and DOES count it.
 *  - Optionally guards against navigating away with a native beforeunload prompt.
 *
 * HONEST NOTE: blocking paste stops the common copy-in vector, and the detectors
 * flag leaving the tab/window — but a browser page cannot truly prevent a
 * determined extension from injecting text (see essay-integrity.ts for the
 * detection heuristic that flags what blocking can't stop). No overclaiming.
 *
 * `requestFullscreen`/`exitFullscreen` are returned so the caller can enter
 * fullscreen on the user gesture and re-enter it from a warning dialog.
 */
import { useCallback, useEffect, useRef } from "react";

import { isBlockedKey } from "./proctoring-keys.js";

export type ProctoringReason =
  | "tab-switch"
  | "fullscreen-exit"
  | "blur"
  | "blocked-paste";

export interface ProctoringBlockOptions {
  copy?: boolean;
  cut?: boolean;
  paste?: boolean;
  contextmenu?: boolean;
  /** Block dragstart + drop (drag text into/out of the field). */
  drag?: boolean;
  /** Block Ctrl/Cmd + A/C/X/V keyboard shortcuts. */
  shortcuts?: boolean;
  /** Step 32: block F12 / Ctrl+Shift+I/J/C / Cmd+Opt+I/J/C (DevTools openers).
   *  FRICTION + evidence, NOT prevention — see proctoring-keys.ts. */
  devtools?: boolean;
  /** Step 32: block text selection (selectstart) — Communication profile. */
  selection?: boolean;
}

export interface UseProctoringArgs {
  /** Listeners are attached only while true (e.g. exam running / essay started). */
  active: boolean;
  /** Focus-loss violation callback (debounced by cooldownMs). */
  onWarning: (reason: ProctoringReason) => void;
  /** Which interaction events to preventDefault. */
  block?: ProctoringBlockOptions;
  /** Also count a blocked paste as a warning (essays); default false (exam). */
  warnOnPaste?: boolean;
  /** Warn before navigating away (beforeunload). Default true. */
  guardUnload?: boolean;
  /** Debounce window for focus-loss warnings (ms). Default 1500 (exam value). */
  cooldownMs?: number;
}

export function requestFullscreen(): void {
  void document.documentElement.requestFullscreen?.().catch(() => {});
}
export function exitFullscreen(): void {
  if (document.fullscreenElement)
    void document.exitFullscreen?.().catch(() => {});
}

export function useProctoring({
  active,
  onWarning,
  block,
  warnOnPaste = false,
  guardUnload = true,
  cooldownMs = 1500,
}: UseProctoringArgs): {
  requestFullscreen: () => void;
  exitFullscreen: () => void;
} {
  const lastWarnAt = useRef(0);
  const onWarningRef = useRef(onWarning);
  onWarningRef.current = onWarning;

  // Debounced focus-loss warning — mirrors the exam runner's `trigger`.
  const warn = useCallback(
    (reason: ProctoringReason) => {
      const now = Date.now();
      if (now - lastWarnAt.current < cooldownMs) return;
      lastWarnAt.current = now;
      onWarningRef.current(reason);
    },
    [cooldownMs],
  );

  // Stable snapshot of the block flags so the effect doesn't re-run on every
  // render (the caller can pass an inline object literal safely).
  const blockCopy = block?.copy ?? false;
  const blockCut = block?.cut ?? false;
  const blockPaste = block?.paste ?? false;
  const blockContext = block?.contextmenu ?? false;
  const blockDrag = block?.drag ?? false;
  const blockShortcuts = block?.shortcuts ?? false;
  const blockDevtools = block?.devtools ?? false;
  const blockSelection = block?.selection ?? false;

  useEffect(() => {
    if (!active) return;

    const onVisibility = (): void => {
      if (document.hidden) warn("tab-switch");
    };
    const onFullscreen = (): void => {
      if (!document.fullscreenElement) warn("fullscreen-exit");
    };
    const onBlur = (): void => warn("blur");
    const prevent = (e: Event): void => e.preventDefault();
    const onPaste = (e: Event): void => {
      e.preventDefault();
      if (warnOnPaste) warn("blocked-paste");
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      const kind = isBlockedKey(e, {
        shortcuts: blockShortcuts,
        devtools: blockDevtools,
      });
      if (!kind) return;
      e.preventDefault();
      // A blocked clipboard-PASTE optionally counts as a warning (essay + the
      // Communication profile); DevTools-key blocks are friction only.
      if (kind === "clipboard" && e.key.toLowerCase() === "v" && warnOnPaste) {
        warn("blocked-paste");
      }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      e.returnValue = "";
    };

    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreen);
    window.addEventListener("blur", onBlur);
    if (blockCopy) document.addEventListener("copy", prevent);
    if (blockCut) document.addEventListener("cut", prevent);
    if (blockPaste) document.addEventListener("paste", onPaste);
    if (blockContext) document.addEventListener("contextmenu", prevent);
    if (blockDrag) {
      document.addEventListener("dragstart", prevent);
      document.addEventListener("drop", prevent);
    }
    if (blockShortcuts || blockDevtools)
      document.addEventListener("keydown", onKeyDown);
    if (blockSelection) document.addEventListener("selectstart", prevent);
    if (guardUnload) window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFullscreen);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("copy", prevent);
      document.removeEventListener("cut", prevent);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("contextmenu", prevent);
      document.removeEventListener("dragstart", prevent);
      document.removeEventListener("drop", prevent);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("selectstart", prevent);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [
    active,
    warn,
    warnOnPaste,
    guardUnload,
    blockCopy,
    blockCut,
    blockPaste,
    blockContext,
    blockDrag,
    blockShortcuts,
    blockDevtools,
    blockSelection,
  ]);

  return { requestFullscreen, exitFullscreen };
}
