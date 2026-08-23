/**
 * Static, per-game tutorial copy for the pre-flight screen — the game's name,
 * what it asks, and how to answer it. This is the ONLY hardcoded content in the
 * pre-flight; everything dynamic (skip allowed, clock length, per-item limit,
 * practice mode, attempts) is server-provided. Copy for all seven keys lives
 * here even though 7a only renders `_probe`, so 7b/7c need no copy changes.
 */
import { GameKey, type GameKey as GameKeyT } from "@codeapt/shared";

export interface GameCopy {
  readonly name: string;
  /** One line: what the puzzle is. */
  readonly asks: string;
  /** One line: the mechanic — how the player answers. */
  readonly how: string;
}

export const GAME_COPY: Record<GameKeyT, GameCopy> = {
  [GameKey.PROBE]: {
    name: "Number Order (practice)",
    asks: "A row of numbers in a shuffled order.",
    how: "Click them in ascending order — smallest first — then submit.",
  },
  [GameKey.GEO_SUDO]: {
    name: "Geo Sudo",
    asks: "A grid of symbols with one blank cell.",
    how: "Deduce the one symbol missing from the blank's row and column.",
  },
  [GameKey.SWITCH_CHALLENGE]: {
    name: "Switch Challenge",
    asks: "A set of switches that reorder a sequence.",
    how: "Trace the switches to the final arrangement and pick it.",
  },
  [GameKey.MOTION_CHALLENGE]: {
    name: "Motion Challenge",
    asks: "A board where blocks slide to clear a path for the ball.",
    how: "Slide pieces one cell at a time until the ball reaches the hole.",
  },
  [GameKey.INDUCTIVE_REASONING]: {
    name: "Inductive Reasoning",
    asks: "Two example grids that share a hidden rule, and four options.",
    how: "Select exactly the TWO options that follow the same rule.",
  },
  [GameKey.BUBBLE_MATH]: {
    name: "Bubble / Quickfire Math",
    asks: "Three bubbles, each a number or a small calculation.",
    how: "Work out all three, then click them in ascending order of value.",
  },
  [GameKey.DOOR_KEY]: {
    name: "Door & Key",
    asks: "A maze with invisible walls, keys to collect, and a door.",
    how: "Move with the arrow keys — you discover walls by bumping into them.",
  },
};
