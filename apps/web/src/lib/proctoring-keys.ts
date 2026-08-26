/**
 * Pure keyboard-block decision for the proctoring hook (Step 32). Extracted so
 * the exact key set is unit-testable in the node web suite (no DOM). Consumed by
 * useProctoring's keydown handler.
 *
 * HONEST NOTE: preventing F12 / Ctrl+Shift+I etc. raises the COST of casually
 * opening DevTools and produces a signal; it does NOT prevent DevTools access
 * (the menu, a detached window, or a browser flag all bypass a keydown handler).
 * Do not rely on this as prevention — it is friction + evidence, nothing more.
 */
export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface KeyBlockOptions {
  /** Ctrl/Cmd + A/C/X/V (select-all + clipboard). */
  shortcuts?: boolean;
  /** F12, Ctrl/Cmd+Shift+I/J/C, Cmd+Opt+I/J/C (DevTools openers). */
  devtools?: boolean;
}

export type KeyBlockKind = "clipboard" | "devtools";

/**
 * Should this keydown be blocked, and as what? Returns the category (so the hook
 * can decide whether a blocked paste counts as a warning) or null to allow.
 */
export function isBlockedKey(
  e: KeyEventLike,
  opts: KeyBlockOptions,
): KeyBlockKind | null {
  const key = (e.key || "").toLowerCase();
  const ctrlOrMeta = e.ctrlKey || e.metaKey;

  if (opts.devtools) {
    if (key === "f12") return "devtools";
    // Ctrl+Shift+I/J/C (Win/Linux) and Cmd+Shift+I/J/C (mac Chrome/Edge).
    if (ctrlOrMeta && e.shiftKey && (key === "i" || key === "j" || key === "c")) {
      return "devtools";
    }
    // Cmd+Opt+I/J/C (mac Safari/Chrome).
    if (e.metaKey && e.altKey && (key === "i" || key === "j" || key === "c")) {
      return "devtools";
    }
  }
  if (opts.shortcuts) {
    // Plain Ctrl/Cmd + A/C/X/V (no shift/alt, so it can't collide with devtools).
    if (
      ctrlOrMeta &&
      !e.shiftKey &&
      !e.altKey &&
      (key === "a" || key === "c" || key === "x" || key === "v")
    ) {
      return "clipboard";
    }
  }
  return null;
}
