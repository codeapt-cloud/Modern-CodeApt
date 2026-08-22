/**
 * `_probe` — the DEV-ONLY throwaway generator that proves the seam end-to-end
 * (seeding, the client-view projection, replay scoring, the difficulty ladder)
 * before any real game is built. NEVER shown in an admin picker (`devOnly`).
 *
 * Instance: `count` distinct numbers (3/4/5 for easy/moderate/hard), shown in a
 * shuffled order. Submission: the ascending order of the numbers' INDICES.
 * Score: exact-match against the stored solution. The client view carries only
 * the numbers — never the solution — so the answer can't be read off the wire.
 */
import { z } from "zod";

import { GameDifficulty, GameKey } from "../enums.js";
import { createRng, rngShuffle } from "./prng.js";
import type { GameExplanation, GameModule, GameScoreResult } from "./types.js";

const COUNT_BY_DIFFICULTY: Record<GameDifficulty, number> = {
  [GameDifficulty.EASY]: 3,
  [GameDifficulty.MODERATE]: 4,
  [GameDifficulty.HARD]: 5,
};

/** Full authored instance — carries the solution. Never sent to a client. */
export interface ProbeInstance {
  readonly kind: typeof GameKey.PROBE;
  readonly numbers: number[];
  /** Indices of `numbers` in ascending value order (the answer). */
  readonly solution: number[];
}

/** What the client sees — numbers only, NO solution. */
export interface ProbeClientView {
  readonly kind: typeof GameKey.PROBE;
  readonly numbers: number[];
}

const probeSubmissionSchema = z.object({
  order: z.array(z.number().int().min(0).max(9)).max(9),
});
/** The player's move — derived FROM the schema so the two can't drift. */
export type ProbeSubmission = z.infer<typeof probeSubmissionSchema>;

function ascendingIndices(numbers: readonly number[]): number[] {
  return numbers
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value)
    .map((p) => p.index);
}

function sameOrder(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export const probeModule: GameModule<
  ProbeInstance,
  ProbeClientView,
  typeof probeSubmissionSchema
> = {
  key: GameKey.PROBE,
  displayName: "Probe (dev)",
  allowSkipDefault: true,
  defaultClockSeconds: 360,
  devOnly: true,
  interactive: false,
  defaultItemSeconds: null,
  submissionSchema: probeSubmissionSchema,

  generate(seed: string, difficulty: GameDifficulty): ProbeInstance {
    const count = COUNT_BY_DIFFICULTY[difficulty];
    const rng = createRng(seed);
    // Distinct values 1..count, shuffled so the sort order is non-trivial.
    const values = Array.from({ length: count }, (_v, i) => i + 1);
    const numbers = rngShuffle(rng, values);
    return {
      kind: GameKey.PROBE,
      numbers,
      solution: ascendingIndices(numbers),
    };
  },

  toClientView(instance: ProbeInstance): ProbeClientView {
    // Construct explicitly — the solution is intentionally not copied.
    return { kind: instance.kind, numbers: instance.numbers };
  },

  score(instance: ProbeInstance, submission: ProbeSubmission): GameScoreResult {
    return { correct: sameOrder(submission.order ?? [], instance.solution) };
  },

  explain(instance: ProbeInstance): GameExplanation {
    return {
      solution: instance.solution,
      note: "Indices of the numbers in ascending value order.",
    };
  },
};
