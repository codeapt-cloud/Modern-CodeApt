/**
 * Pure unit tests for the gaming play shell's logic — the timing re-sync, the
 * answer→feedback reducer, the attempts/unstartable derivation, and the renderer
 * registry lookup. The visual layer is intentionally NOT covered here.
 */
import { GameKey } from "@codeapt/shared";
import type {
  AnswerGameItemResponse,
  GameItemView,
  GamePlayListItem,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import {
  ProbeRenderer,
} from "../src/components/game/renderers/ProbeRenderer.js";
import { getGameRenderer } from "../src/components/game/renderer-registry.js";
import {
  attemptsLeft,
  canStartSet,
  clockFromItem,
  feedbackFromAnswer,
  formatClock,
  ladderMove,
  nextTick,
} from "../src/lib/game-runner.js";

function itemView(over: Partial<GameItemView> = {}): GameItemView {
  return {
    attemptId: "a1",
    gameKey: GameKey.PROBE,
    gameIndex: 0,
    itemIndex: 0,
    difficulty: "easy",
    view: { kind: GameKey.PROBE, numbers: [3, 1, 2] },
    allowSkip: true,
    remainingSeconds: 360,
    perQuestionTimerSeconds: 0,
    itemRemainingSeconds: null,
    interactive: false,
    instantFeedback: false,
    ...over,
  };
}

function answerRes(over: Partial<AnswerGameItemResponse> = {}): AnswerGameItemResponse {
  return {
    itemIndex: 0,
    outcome: "correct",
    marksAwarded: 1,
    answeredDifficulty: "easy",
    gameScore: 1,
    questionsCorrect: 1,
    questionsAttempted: 1,
    correct: true,
    next: null,
    gameComplete: false,
    ...over,
  };
}

function listItem(over: Partial<GamePlayListItem> = {}): GamePlayListItem {
  return {
    id: "s1",
    title: "Set",
    description: "",
    gameKeys: [GameKey.PROBE],
    selectionMode: "fixed",
    totalGames: 1,
    perQuestionTimerSeconds: 0,
    attemptsUsed: 0,
    maxAttempts: 1,
    topicId: null,
    ...over,
  };
}

describe("countdown tick + re-sync", () => {
  it("nextTick decrements but floors at zero", () => {
    expect(nextTick(10)).toBe(9);
    expect(nextTick(1)).toBe(0);
    expect(nextTick(0)).toBe(0);
    expect(nextTick(-5)).toBe(0);
  });

  it("the SERVER value wins: clockFromItem overwrites whatever local ticks reached", () => {
    // Simulate local ticking down from 360 to 300...
    let local = 360;
    for (let i = 0; i < 60; i += 1) local = nextTick(local);
    expect(local).toBe(300);
    // ...then a server response arrives with its authoritative value — the shell
    // re-syncs to THAT, never the drifted local tick.
    const server = itemView({ remainingSeconds: 348, itemRemainingSeconds: 12 });
    const clock = clockFromItem(server);
    expect(clock.remaining).toBe(348);
    expect(clock.itemRemaining).toBe(12);
    expect(clock.remaining).not.toBe(local);
  });

  it("clockFromItem carries a null per-item timer through unchanged", () => {
    expect(clockFromItem(itemView({ itemRemainingSeconds: null })).itemRemaining).toBeNull();
  });

  it("formatClock renders m:ss", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(9)).toBe("0:09");
    expect(formatClock(75)).toBe("1:15");
    expect(formatClock(-3)).toBe("0:00");
  });
});

describe("answer → feedback reducer", () => {
  it("a correct answer with a harder next item reports a ladder move UP", () => {
    const fb = feedbackFromAnswer(
      answerRes({
        answeredDifficulty: "easy",
        marksAwarded: 1,
        gameScore: 1,
        next: itemView({ difficulty: "moderate", itemIndex: 1 }),
      }),
    );
    expect(fb.marksAwarded).toBe(1);
    expect(fb.gameScore).toBe(1);
    expect(fb.movedTo).toBe("moderate");
    expect(ladderMove(fb)).toBe("up");
  });

  it("a wrong answer with an easier next item reports a ladder move DOWN", () => {
    const fb = feedbackFromAnswer(
      answerRes({
        outcome: "wrong",
        correct: false,
        answeredDifficulty: "moderate",
        marksAwarded: 0,
        next: itemView({ difficulty: "easy", itemIndex: 2 }),
      }),
    );
    expect(fb.correct).toBe(false);
    expect(ladderMove(fb)).toBe("down");
  });

  it("no next item (game complete) reports no ladder move", () => {
    const fb = feedbackFromAnswer(answerRes({ next: null, gameComplete: true }));
    expect(fb.movedTo).toBeNull();
    expect(ladderMove(fb)).toBe("none");
  });
});

describe("attempts / unstartable derivation", () => {
  it("unlimited (maxAttempts 0) → null left, always startable", () => {
    const item = listItem({ maxAttempts: 0, attemptsUsed: 5 });
    expect(attemptsLeft(item)).toBeNull();
    expect(canStartSet(item)).toBe(true);
  });

  it("some attempts left → startable", () => {
    const item = listItem({ maxAttempts: 3, attemptsUsed: 1 });
    expect(attemptsLeft(item)).toBe(2);
    expect(canStartSet(item)).toBe(true);
  });

  it("all attempts used → not startable (visibly unstartable)", () => {
    const item = listItem({ maxAttempts: 1, attemptsUsed: 1 });
    expect(attemptsLeft(item)).toBe(0);
    expect(canStartSet(item)).toBe(false);
  });

  it("never reports a negative remaining", () => {
    const item = listItem({ maxAttempts: 2, attemptsUsed: 5 });
    expect(attemptsLeft(item)).toBe(0);
  });
});

describe("renderer registry", () => {
  it("resolves the _probe renderer and leaves unimplemented games undefined", () => {
    expect(getGameRenderer(GameKey.PROBE)).toBe(ProbeRenderer);
    // 7b/7c games are not registered yet — the shell shows a calm fallback.
    expect(getGameRenderer(GameKey.GEO_SUDO)).toBeUndefined();
    expect(getGameRenderer(GameKey.DOOR_KEY)).toBeUndefined();
  });
});
