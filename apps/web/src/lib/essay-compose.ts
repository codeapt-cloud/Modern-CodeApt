/**
 * Pure helpers for the essay-writing screen — word-count status + a
 * lightweight compose-analytics accumulator. No I/O, no React; unit-tested
 * independently of the (side-effectful) composer.
 *
 * The server owns word-bound enforcement (422 LENGTH_OUT_OF_RANGE); these
 * helpers only drive the live counter UX and the submit-enable affordance.
 */

/** Whitespace-delimited word count (matches the shared engine's counter). */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export type WordRangeState = "empty" | "under" | "in" | "over";

export interface WordCountStatus {
  count: number;
  state: WordRangeState;
  /** Words still needed (under) or words to cut (over); 0 when in range. */
  remaining: number;
  /** Whether the client will allow submit (server remains the source of truth). */
  canSubmit: boolean;
  message: string;
}

/**
 * Classify a word count against a prompt's min/max. `maxWords <= 0` means "no
 * upper bound" (matches the server, where 0 disables the max check). `minWords`
 * is treated as at least 1 (an empty essay is never submittable).
 */
export function wordCountStatus(
  count: number,
  minWords: number,
  maxWords: number,
): WordCountStatus {
  const min = Math.max(1, minWords || 0);
  const hasMax = maxWords > 0;

  if (count === 0) {
    return {
      count,
      state: "empty",
      remaining: min,
      canSubmit: false,
      message: `Start writing — at least ${min} words needed`,
    };
  }
  if (count < min) {
    const remaining = min - count;
    return {
      count,
      state: "under",
      remaining,
      canSubmit: false,
      message: `${remaining} more word${remaining === 1 ? "" : "s"} to reach the minimum`,
    };
  }
  if (hasMax && count > maxWords) {
    const remaining = count - maxWords;
    return {
      count,
      state: "over",
      remaining,
      canSubmit: false,
      message: `${remaining} word${remaining === 1 ? "" : "s"} over the limit`,
    };
  }
  return {
    count,
    state: "in",
    remaining: 0,
    canSubmit: true,
    message: hasMax ? `In range (${min}–${maxWords} words)` : "Ready to submit",
  };
}

// ---------------------------------------------------------------------------
// Attempt cap — how the per-topic limit surfaces to students.
// ---------------------------------------------------------------------------

export interface EssayAttemptStatus {
  used: number;
  max: number;
  /** Attempts still available (never negative). */
  remaining: number;
  /** True when the student has used all their attempts. */
  atLimit: boolean;
  /** Compact label for the card / writer header. */
  label: string;
}

/**
 * Classify a student's attempt usage against a prompt's cap. Defensive about
 * inputs (floors max at 1, clamps used to >= 0) so a bad value can't render a
 * negative "remaining" or wrongly unlock submission.
 */
export function essayAttemptStatus(
  used: number,
  max: number,
): EssayAttemptStatus {
  const cappedMax = Math.max(1, Math.trunc(max) || 1);
  const u = Math.max(0, Math.trunc(used) || 0);
  const remaining = Math.max(0, cappedMax - u);
  const atLimit = u >= cappedMax;
  const label = atLimit
    ? "Attempt limit reached"
    : `${remaining} of ${cappedMax} attempt${cappedMax === 1 ? "" : "s"} left`;
  return { used: u, max: cappedMax, remaining, atLimit, label };
}

export interface EssayLaunchState {
  /** Whether a linked, accessible essay prompt was resolved for this topic. */
  found: boolean;
  /** True when there is a prompt AND the student is below the attempt cap. */
  canWrite: boolean;
  atLimit: boolean;
  attempts: EssayAttemptStatus | null;
}

/**
 * Decide how the in-course essay launcher should render for a resolved prompt
 * (or `null`/`undefined` when the curriculum topic has no linked/accessible
 * essay prompt). Graceful: a missing prompt yields `found: false` (the launcher
 * shows a message) rather than throwing. Reuses `essayAttemptStatus` so the
 * cap logic is identical to the /essays list and the writer.
 */
export function essayLaunchState(
  item: { attemptsUsed: number; maxAttempts: number } | null | undefined,
): EssayLaunchState {
  if (!item) {
    return { found: false, canWrite: false, atLimit: false, attempts: null };
  }
  const attempts = essayAttemptStatus(item.attemptsUsed, item.maxAttempts);
  return {
    found: true,
    canWrite: !attempts.atLimit,
    atLimit: attempts.atLimit,
    attempts,
  };
}

// ---------------------------------------------------------------------------
// Compose analytics — cheap, content-free signal accumulation.
// ---------------------------------------------------------------------------

/**
 * In-memory compose signals. Counts + timings only — NEVER the typed content.
 * Fed to the optional, additive analytics endpoint; has zero grade impact.
 */
export interface ComposeAnalytics {
  keystrokes: number;
  deletes: number;
  pasteCount: number;
  pastedChars: number;
}

export function emptyAnalytics(): ComposeAnalytics {
  return { keystrokes: 0, deletes: 0, pasteCount: 0, pastedChars: 0 };
}

/** Keys that don't produce/remove a character (don't count as keystrokes). */
const NON_TYPING_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "CapsLock",
  "Tab",
  "Escape",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/** Record one key press. Backspace/Delete count as a delete; O(1). */
export function onKeystroke(
  a: ComposeAnalytics,
  key: string,
): ComposeAnalytics {
  if (NON_TYPING_KEYS.has(key)) return a;
  const isDelete = key === "Backspace" || key === "Delete";
  return {
    ...a,
    keystrokes: a.keystrokes + 1,
    deletes: a.deletes + (isDelete ? 1 : 0),
  };
}

/** Record one paste of `chars` characters; O(1). */
export function onPaste(a: ComposeAnalytics, chars: number): ComposeAnalytics {
  return {
    ...a,
    pasteCount: a.pasteCount + 1,
    pastedChars: a.pastedChars + Math.max(0, chars),
  };
}
