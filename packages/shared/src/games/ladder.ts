/**
 * The adaptive difficulty ladder — a PURE reducer. Given the ladder state (the
 * difficulty the item JUST ANSWERED was served at) and how it resolved, it
 * returns the next difficulty and the marks awarded.
 *
 * Rules (from the Cognizant/Capgemini gaming round):
 *   - start at easy;
 *   - CORRECT  → award marks for the difficulty just answered, step UP (cap hard);
 *   - WRONG    → 0 marks, step DOWN (floor easy);
 *   - SKIPPED  → 0 marks; ladder movement is CONFIG (see decision below);
 *   - EXPIRED  → 0 marks, no movement (the game is over anyway).
 * NO negative marking, ever.
 *
 * SKIP DECISION (documented default): a skip does NOT move the ladder
 * (`skipStepsDown: false`). Justification: a skip is an explicit "pass", not a
 * demonstrated failure — unlike a wrong answer it carries no signal that the
 * current tier is too hard, so punishing difficulty for it would misread the
 * student. Keeping difficulty stable is the least-surprising behaviour, and
 * outcomes are recorded distinctly (`skipped` ≠ `wrong`) so analytics can still
 * separate them. The source says a skip "registers as an answer" but is silent
 * on ladder movement; `skipStepsDown` makes it a one-line policy flip if a real
 * game wants skip to behave like wrong.
 */
import { GameDifficulty } from "../enums.js";
import { GAME_DIFFICULTY_MARKS } from "../constants.js";

/** Difficulty order, easy → hard, for stepping. */
const LADDER: readonly GameDifficulty[] = [
  GameDifficulty.EASY,
  GameDifficulty.MODERATE,
  GameDifficulty.HARD,
];

export interface LadderState {
  readonly difficulty: GameDifficulty;
}

export interface LadderConfig {
  /** When true, a skip steps the ladder down like a wrong answer. Default off. */
  readonly skipStepsDown: boolean;
}

export const DEFAULT_LADDER_CONFIG: LadderConfig = {
  skipStepsDown: false,
};

export interface LadderStep {
  readonly next: LadderState;
  readonly marksAwarded: number;
}

/** The outcomes the ladder reacts to (a subset of GameOutcome — the same string
 * values). Kept as a narrow param so callers pass a resolved outcome. */
export type LadderOutcome = "correct" | "wrong" | "skipped" | "expired";

function stepUp(d: GameDifficulty): GameDifficulty {
  const i = LADDER.indexOf(d);
  return LADDER[Math.min(i + 1, LADDER.length - 1)]!;
}

function stepDown(d: GameDifficulty): GameDifficulty {
  const i = LADDER.indexOf(d);
  return LADDER[Math.max(i - 1, 0)]!;
}

/**
 * Apply one outcome to the ladder. `state.difficulty` is the difficulty the
 * just-answered item was served at, so marks are awarded for THAT tier.
 */
export function applyLadderOutcome(
  state: LadderState,
  outcome: LadderOutcome,
  config: LadderConfig = DEFAULT_LADDER_CONFIG,
): LadderStep {
  switch (outcome) {
    case "correct":
      return {
        next: { difficulty: stepUp(state.difficulty) },
        marksAwarded: GAME_DIFFICULTY_MARKS[state.difficulty],
      };
    case "wrong":
      return { next: { difficulty: stepDown(state.difficulty) }, marksAwarded: 0 };
    case "skipped":
      return {
        next: {
          difficulty: config.skipStepsDown
            ? stepDown(state.difficulty)
            : state.difficulty,
        },
        marksAwarded: 0,
      };
    case "expired":
    default:
      return { next: { difficulty: state.difficulty }, marksAwarded: 0 };
  }
}
