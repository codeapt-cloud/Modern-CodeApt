/**
 * Pure, unit-tested logic for the Speaking runner + results — no React, no DOM,
 * no I/O. Mirrors the exam/game split: the shell component + hook do the I/O and
 * clocks; the decisions live here so they can be tested without a microphone.
 *
 * Three concerns:
 *   1. The per-item PHASE machine: prompt → (prep) → responding → submitted.
 *   2. The countdown re-sync clamp (nextTick) — same shape as game-runner's, so
 *      the recording/prep clocks tick down without going negative. (Speaking has
 *      no server-authoritative per-item deadline — see the runner shell — so the
 *      clock is a client media clock; the clamp is the shared discipline.)
 *   3. Results DERIVATION: per-item headline %, the five sub-score dimensions,
 *      the 50%/60% pass/distinction bands, and whether any hybrid item fell back
 *      to its deterministic floor (so the UI can reassure the student).
 */
import type {
  SpeakingItemResult,
  SpeakingItemScoreDto,
  SpeakingItemType,
} from "@codeapt/shared";

// ---------------------------------------------------------------------------
// 1. Per-item phase machine
// ---------------------------------------------------------------------------

export type ItemPhase = "prompt" | "prep" | "responding" | "submitted";

/**
 * The next phase given the current one and whether this item has a prep window.
 * `prompt` is where the student reads the text / hears the prompt audio; `prep`
 * is the pre-speech thinking countdown (open_topic); `responding` is the
 * recording window (or the dictation text box); `submitted` is terminal for the
 * item. A pure total function — an unknown phase returns itself.
 */
export function nextItemPhase(
  current: ItemPhase,
  opts: { prepSeconds: number },
): ItemPhase {
  switch (current) {
    case "prompt":
      return opts.prepSeconds > 0 ? "prep" : "responding";
    case "prep":
      return "responding";
    case "responding":
      return "submitted";
    default:
      return current;
  }
}

/** The phase an item STARTS in — always `prompt` (stimulus/instructions first). */
export const INITIAL_ITEM_PHASE: ItemPhase = "prompt";

// ---------------------------------------------------------------------------
// 2. Countdown clamp (shared discipline with the exam/game runners)
// ---------------------------------------------------------------------------

/** One display tick, never below zero. Local ticking only; see the module doc. */
export function nextTick(remaining: number): number {
  return remaining <= 0 ? 0 : remaining - 1;
}

/**
 * How many times the results page auto-polls before it stops and asks the
 * student to check back. Scoring is async and a busy drive can take a while to
 * drain, so a poll that spins forever is wrong — after this many 3s ticks
 * (~2 min) we stop and offer a manual "check again" instead.
 */
export const MAX_RESULT_POLLS = 40;

/** Keep auto-polling only while the result is incomplete AND under the cap. */
export function shouldAutoPoll(polls: number, complete: boolean): boolean {
  return !complete && polls < MAX_RESULT_POLLS;
}

/** Seconds → m:ss (clamped at zero) for a countdown display. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// 3. Results derivation
// ---------------------------------------------------------------------------

export const PASS_THRESHOLD = 50;
export const DISTINCTION_THRESHOLD = 60;

export type ScoreBand = "distinction" | "pass" | "fail";

/** Band a 0..100 percent against the real papers' 50% pass / 60% distinction. */
export function scoreBand(percent: number): ScoreBand {
  if (percent >= DISTINCTION_THRESHOLD) return "distinction";
  if (percent >= PASS_THRESHOLD) return "pass";
  return "fail";
}

/** True for the read-aloud FAMILY score shape (the only union member with no `kind`). */
export function isReadAloudFamilyScore(
  score: SpeakingItemScoreDto,
): score is Extract<SpeakingItemScoreDto, { wordAccuracy: number; fluency: unknown }> {
  return !("kind" in score);
}

/**
 * The single headline percent (0..100) for one item's score, or null if the
 * item has no score yet. read-aloud family + dictation → word accuracy;
 * answer-set + fill → its `score`; the hybrids → their blended `total`.
 */
export function itemScorePercent(
  score: SpeakingItemScoreDto | null | undefined,
): number | null {
  if (!score) return null;
  if (!("kind" in score)) return score.wordAccuracy; // read-aloud family
  switch (score.kind) {
    case "answer_set":
      return score.score;
    case "fill_missing_word":
      return score.score;
    case "dictation":
      return score.wordAccuracy;
    case "story_retell":
      return score.total;
    case "open_topic":
      return score.total;
    default:
      return null;
  }
}

/** Which sub-score dimension an item TYPE contributes to (for the report). */
const ACCURACY_TYPES: readonly SpeakingItemType[] = [
  "read_aloud",
  "repeat",
  "sentence_build",
  "error_correct",
  "fill_missing_word",
  "dictation",
];
const LISTENING_TYPES: readonly SpeakingItemType[] = [
  "short_answer",
  "conversation",
  "passage_question",
];

export interface SpeakingDimensions {
  /** WER-based word accuracy (reference items) — solid. */
  readonly accuracy: number | null;
  /** Comprehension correctness (answer-set items) — solid. */
  readonly listening: number | null;
  /** Fluency from timings (open topic) — real. */
  readonly fluency: number | null;
  /** Grammar (LLM on open speech) — APPROXIMATE, null when AI was unavailable. */
  readonly grammar: number | null;
  /** Relevance (LLM) — APPROXIMATE, null when AI was unavailable. */
  readonly relevance: number | null;
}

export interface SpeakingResultsSummary {
  readonly overallPercent: number | null;
  readonly band: ScoreBand | null;
  readonly dimensions: SpeakingDimensions;
  /** True if ANY hybrid item was scored on its deterministic floor (AI down),
   *  so the UI can state the student was NOT marked down for it. */
  readonly anyDeterministicFallback: boolean;
  readonly scoredCount: number;
  readonly totalCount: number;
}

const avg = (xs: number[]): number | null =>
  xs.length === 0 ? null : Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10;

/**
 * Derive the whole results summary from the polled attempt items. Pure over the
 * scored items only (unscored/failed items don't drag the average). Grammar and
 * Relevance are populated ONLY from AI sub-scores that were actually returned;
 * if every hybrid item fell back to its floor they stay null (honestly "not
 * scored") rather than reading as a zero.
 */
export function deriveSpeakingResults(
  items: readonly SpeakingItemResult[],
): SpeakingResultsSummary {
  const percents: number[] = [];
  const accuracy: number[] = [];
  const listening: number[] = [];
  const fluency: number[] = [];
  const grammar: number[] = [];
  const relevance: number[] = [];
  let anyDeterministicFallback = false;

  for (const it of items) {
    const pct = itemScorePercent(it.score);
    if (pct === null || it.score === null) continue;
    percents.push(pct);

    if (ACCURACY_TYPES.includes(it.itemType)) accuracy.push(pct);
    if (LISTENING_TYPES.includes(it.itemType)) listening.push(pct);

    const score = it.score;
    if ("kind" in score) {
      if (score.kind === "open_topic") {
        fluency.push(score.fluencyScore);
        if (typeof score.aiGrammar === "number") grammar.push(score.aiGrammar);
        if (typeof score.aiRelevance === "number") relevance.push(score.aiRelevance);
        if (score.source === "deterministic_floor") anyDeterministicFallback = true;
      } else if (score.kind === "story_retell") {
        if (score.source === "deterministic_floor") anyDeterministicFallback = true;
      }
    }
  }

  const overallPercent = avg(percents);
  return {
    overallPercent,
    band: overallPercent === null ? null : scoreBand(overallPercent),
    dimensions: {
      accuracy: avg(accuracy),
      listening: avg(listening),
      fluency: avg(fluency),
      grammar: avg(grammar),
      relevance: avg(relevance),
    },
    anyDeterministicFallback,
    scoredCount: percents.length,
    totalCount: items.length,
  };
}
