/**
 * Pure helpers for the gaming play shell — no React, no I/O, unit-tested. The
 * hook (use-game-runner.ts) wires these to state + the api-client. Keeping the
 * clock re-sync, the answer→next reducer, and the attempts derivation here means
 * the timing discipline is verified in isolation, exactly like exam-runner.ts.
 */
import type {
  AnswerGameItemResponse,
  GameDifficulty,
  GameItemView,
  GamePlayListItem,
} from "@codeapt/shared";

/** The three ladder rungs, low→high. */
export const LADDER: readonly GameDifficulty[] = ["easy", "moderate", "hard"];

export function ladderIndex(difficulty: GameDifficulty): number {
  const i = LADDER.indexOf(difficulty);
  return i < 0 ? 0 : i;
}

/** One display tick: never below zero. Local ticking only smooths between the
 * server values that overwrite it on every response. */
export function nextTick(remaining: number): number {
  return remaining <= 0 ? 0 : remaining - 1;
}

/** Seconds → m:ss (clamped at zero) for the countdown display. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, "0")}`;
}

/** Server-authoritative clock snapshot for an item. The game clock plus the
 * optional per-item timer (null when the game has none, e.g. `_probe`). */
export interface GameClock {
  readonly remaining: number;
  readonly itemRemaining: number | null;
}

/** Read the clock straight from a served item — the value the server just sent.
 * This is the re-sync primitive: local ticks are always OVERWRITTEN by this. */
export function clockFromItem(item: GameItemView): GameClock {
  return {
    remaining: item.remainingSeconds,
    itemRemaining: item.itemRemainingSeconds,
  };
}

/** Attempts still available for a set; null = unlimited (maxAttempts 0). */
export function attemptsLeft(item: GamePlayListItem): number | null {
  return item.maxAttempts === 0
    ? null
    : Math.max(0, item.maxAttempts - item.attemptsUsed);
}

/** A set is startable unless a finite attempt cap is fully used. */
export function canStartSet(item: GamePlayListItem): boolean {
  const left = attemptsLeft(item);
  return left === null || left > 0;
}

/** The post-answer feedback the shell shows (marks, ladder move, running score). */
export interface AnswerFeedback {
  readonly itemIndex: number;
  readonly outcome: AnswerGameItemResponse["outcome"];
  readonly correct: boolean;
  readonly marksAwarded: number;
  readonly answeredDifficulty: GameDifficulty;
  readonly gameScore: number;
  /** ladder rung of the item just answered vs the next served item (if any) —
   * lets the UI show "moved up"/"moved down" honestly. */
  readonly movedTo: GameDifficulty | null;
}

export function feedbackFromAnswer(
  res: AnswerGameItemResponse,
): AnswerFeedback {
  return {
    itemIndex: res.itemIndex,
    outcome: res.outcome,
    correct: res.correct,
    marksAwarded: res.marksAwarded,
    answeredDifficulty: res.answeredDifficulty,
    gameScore: res.gameScore,
    movedTo: res.next ? res.next.difficulty : null,
  };
}

/** Direction the ladder moved between the answered item and the next one. */
export type LadderMove = "up" | "down" | "same" | "none";

export function ladderMove(fb: AnswerFeedback): LadderMove {
  if (!fb.movedTo) return "none";
  const from = ladderIndex(fb.answeredDifficulty);
  const to = ladderIndex(fb.movedTo);
  return to > from ? "up" : to < from ? "down" : "same";
}
