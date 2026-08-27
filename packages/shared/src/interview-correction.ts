/**
 * PURE support for the contextual (LLM) transcript-correction pass (Step 35 G).
 * The term-list pass (interview-terms.ts) fixes KNOWN JD terms; it cannot fix
 * general mishearings ("we used to sing the data" → "we used to sync the data").
 * An LLM pass corrects those — but an LLM will happily "improve" an answer if you
 * let it, which would corrupt the score. This module is the STRUCTURAL guard that
 * enforces "fix mishearings ONLY, never rewrite": it measures how much the model
 * changed and REJECTS an over-edit (falling back to the term-list result), and it
 * diffs the accepted change into a per-word list for the audit view.
 *
 * The prompt (in interview-ai) states the rule; this guard is what makes it safe
 * regardless of what the model returns. No I/O.
 */

const WORD = /[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g;

function tokens(s: string): string[] {
  return s.match(WORD) ?? [];
}

/**
 * The fraction of words that changed between two same-length-ish token streams,
 * via a lightweight word-level LCS. 0 = identical wording, 1 = wholly rewritten.
 * A pure edit-ratio — the acceptance gate below thresholds on it.
 */
export function wordEditRatio(before: string, after: string): number {
  const a = tokens(before.toLowerCase());
  const b = tokens(after.toLowerCase());
  if (a.length === 0 && b.length === 0) return 0;
  const lcs = lcsLength(a, b);
  const changed = Math.max(a.length, b.length) - lcs;
  return changed / Math.max(a.length, b.length, 1);
}

function lcsLength(a: readonly string[], b: readonly string[]): number {
  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i += 1) {
    const cur = new Array<number>(n + 1).fill(0);
    for (let j = 1; j <= n; j += 1) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, cur[j - 1]!);
    }
    prev = cur;
  }
  return prev[n]!;
}

/** One contextual (mishearing) fix, for the audit list. `kind` is always
 *  "context" so it renders alongside the term-list corrections. */
export interface ContextCorrection {
  readonly from: string;
  readonly to: string;
  readonly kind: "context";
}

/**
 * The maximum share of words the contextual pass may change before we distrust it
 * as a rewrite rather than a set of mishearing fixes. Mishearings are typically a
 * handful of scattered words; a genuine rewrite touches far more. Tuned
 * conservatively — over-rejecting merely falls back to the (safe) term-list text.
 */
export const MAX_CONTEXT_EDIT_RATIO = 0.3;

export interface ContextCorrectionResult {
  /** The transcript to use downstream (the LLM output when accepted, else input). */
  readonly text: string;
  /** True when the LLM edit was accepted (within the edit budget). */
  readonly accepted: boolean;
  /** The word-level changes, when accepted (empty otherwise). */
  readonly changes: readonly ContextCorrection[];
}

/**
 * Decide whether to accept the LLM-corrected transcript over the input. Rejects
 * when the model changed too large a share of the words (a rewrite, not
 * mishearing fixes) or when the word COUNT moved materially (adding/removing
 * content). On rejection the caller keeps the input (term-list) transcript.
 *
 * `input` is the pre-contextual transcript (already term-corrected); `candidate`
 * is the LLM's proposed correction.
 */
export function acceptContextCorrection(
  input: string,
  candidate: string | null | undefined,
  maxRatio = MAX_CONTEXT_EDIT_RATIO,
): ContextCorrectionResult {
  const cand = (candidate ?? "").trim();
  if (cand === "" || cand === input.trim()) {
    return { text: input, accepted: false, changes: [] };
  }
  const before = tokens(input);
  const after = tokens(cand);
  // A mishearing fix preserves length closely; a rewrite adds/removes content.
  const lenDelta = Math.abs(before.length - after.length);
  const lenBudget = Math.max(2, Math.ceil(before.length * 0.15));
  if (lenDelta > lenBudget) {
    return { text: input, accepted: false, changes: [] };
  }
  if (wordEditRatio(input, cand) > maxRatio) {
    return { text: input, accepted: false, changes: [] };
  }
  return { text: cand, accepted: true, changes: diffWords(input, cand) };
}

/**
 * Word-level diff → the substituted spans, as {from,to} pairs. Aligns via LCS and
 * groups each contiguous run of non-matching words on both sides into one change.
 * Pure; used only to populate the audit view (what the contextual pass changed).
 */
export function diffWords(before: string, after: string): ContextCorrection[] {
  const a = tokens(before);
  const b = tokens(after);
  // Backtrack an LCS table to a change list.
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      dp[i]![j] =
        a[i - 1]!.toLowerCase() === b[j - 1]!.toLowerCase()
          ? dp[i - 1]![j - 1]! + 1
          : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  const changes: ContextCorrection[] = [];
  let i = m;
  let j = n;
  let fromRun: string[] = [];
  let toRun: string[] = [];
  const flush = (): void => {
    if (fromRun.length || toRun.length) {
      changes.push({
        from: fromRun.reverse().join(" "),
        to: toRun.reverse().join(" "),
        kind: "context",
      });
      fromRun = [];
      toRun = [];
    }
  };
  while (i > 0 && j > 0) {
    if (a[i - 1]!.toLowerCase() === b[j - 1]!.toLowerCase()) {
      flush();
      i -= 1;
      j -= 1;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      fromRun.push(a[i - 1]!);
      i -= 1;
    } else {
      toRun.push(b[j - 1]!);
      j -= 1;
    }
  }
  while (i > 0) {
    fromRun.push(a[i - 1]!);
    i -= 1;
  }
  while (j > 0) {
    toRun.push(b[j - 1]!);
    j -= 1;
  }
  flush();
  return changes.reverse();
}
