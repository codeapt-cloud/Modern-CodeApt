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

import { phoneticMatch } from "./phonetics.js";

const WORD = /[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g;

function tokens(s: string): string[] {
  return s.match(WORD) ?? [];
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = cur;
  }
  return prev[b.length]!;
}

const alnum = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Is one substitution a plausible speech-to-text MISHEARING (not a rewrite)? A
 * mishearing swaps a word/short span for a similar-SOUNDING or similar-SPELLED
 * one, keeps the content, and doesn't balloon the length: e.g. "sing"→"sync",
 * "daytah"→"data", "front end"→"frontend", "kubernetis"→"Kubernetes". A swap to a
 * dissimilar or much longer word ("api"→"scalable REST API") is a rewrite. This
 * PER-CHANGE test is the principled guard (Step 36 E) — it lets several small
 * fixes through in a short answer where the old blunt global ratio wrongly
 * rejected them, while still blocking content rewrites.
 */
export function plausibleMishearing(from: string, to: string): boolean {
  const fk = alnum(from);
  const tk = alnum(to);
  if (tk === "" || fk === "") return false; // pure insertion/deletion = content change
  if (fk === tk) return true; // spacing/case only ("front end" → "frontend")
  // A mishearing stays roughly the same size; a big length jump is a rewrite.
  if (Math.max(fk.length, tk.length) > Math.min(fk.length, tk.length) * 2 + 2) return false;
  const norm = levenshtein(fk, tk) / Math.max(fk.length, tk.length, 1);
  // ≤0.5 (not 0.4): real mishearings routinely swap a vowel or two ("sing"→"sync",
  // "sink"→"sync"), and the read-aloud metaphone keeps vowels so it won't rescue
  // those — spelling proximity has to carry short-word mishearings.
  if (norm <= 0.5) return true; // close spelling
  return phoneticMatch(fk, tk); // or sounds the same
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
 * Backstop only (Step 36 E): even when every individual change LOOKS like a
 * plausible mishearing, refuse a candidate that rewrote more than this share of
 * the words — a wholesale rewrite dressed up as many small swaps. The PRIMARY
 * guard is now per-change plausibility (`plausibleMishearing`); this ceiling is
 * deliberately generous (0.5) so a short answer with several genuine homophone
 * fixes — which the old blunt 0.3 cap wrongly rejected — is accepted.
 */
export const MAX_CONTEXT_EDIT_RATIO = 0.5;

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
  // A mishearing set preserves length closely; a rewrite adds/removes content.
  // Allow a few merges/splits (word count can shift by the number of merged terms).
  const lenDelta = Math.abs(before.length - after.length);
  const lenBudget = Math.max(3, Math.ceil(before.length * 0.25));
  if (lenDelta > lenBudget) {
    return { text: input, accepted: false, changes: [] };
  }
  const changes = diffWords(input, cand);
  if (changes.length === 0) {
    return { text: input, accepted: false, changes: [] };
  }
  // PRIMARY guard: every change must be a plausible mishearing (similar sound or
  // spelling, similar length) — one dissimilar/content swap and we distrust the
  // whole candidate and keep the safe term-list text.
  if (!changes.every((c) => plausibleMishearing(c.from, c.to))) {
    return { text: input, accepted: false, changes: [] };
  }
  // Backstop: refuse a candidate that rewrote too large a share of the words.
  if (wordEditRatio(input, cand) > maxRatio) {
    return { text: input, accepted: false, changes: [] };
  }
  return { text: cand, accepted: true, changes };
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
