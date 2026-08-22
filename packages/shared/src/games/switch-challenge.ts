/**
 * `switch_challenge` — permutation "switch" tracing. A switch is a PERMUTATION
 * of [1,2,3,4]; the reference resets to `1 2 3 4` before every operation, and
 * each layer's output re-indexes as the next layer's `1 2 3 4` (so layers simply
 * compose). Submission is a PERMUTATION (array of indices) — a deliberately
 * different shape from Geo Sudo's single symbol.
 *
 * Difficulty:
 *   easy      — top-down: given input + switch, produce the output.
 *   moderate  — BOTTOM-UP: given output + switch, work back to the input.
 *   hard       — three layers; either produce the final output, or (the flagged
 *                confusion case) produce ONLY the MIDDLE switch given input,
 *                output, and the outer two switches.
 *
 * Skip is FORBIDDEN (allowSkipDefault:false, enforced server-side as a hard rule
 * — an authored GameSpec cannot re-enable it; see game.service effectiveAllowSkip).
 * A 6-element variant exists above this in the source; NOT built here.
 */
import { z } from "zod";

import { GameDifficulty, GameKey } from "../enums.js";
import { createRng, rngShuffle, type Rng } from "./prng.js";
import type { GameExplanation, GameModule, GameScoreResult } from "./types.js";

/** Fixed 4-symbol palette (display only). */
export const SWITCH_SYMBOLS = ["square", "triangle", "plus", "circle"] as const;

export type SwitchMode = "easy" | "moderate" | "hard_output" | "hard_middle";

export interface SwitchInstance {
  readonly kind: typeof GameKey.SWITCH_CHALLENGE;
  readonly mode: SwitchMode;
  readonly symbols: string[];
  /** Shown for easy + hard_*; null when the player must FIND the input. */
  readonly input: number[] | null;
  /** Shown for moderate + hard_middle; null otherwise. */
  readonly output: number[] | null;
  /** Shown switches: [sw] (easy/moderate), [s1,s2,s3] (hard_output),
   * [s1,s3] (hard_middle — the middle switch is hidden, it's the answer). */
  readonly switches: number[][];
  readonly ask: "output" | "input" | "middle";
  readonly solution: number[];
}

export interface SwitchClientView {
  readonly kind: typeof GameKey.SWITCH_CHALLENGE;
  readonly mode: SwitchMode;
  readonly symbols: string[];
  readonly input: number[] | null;
  readonly output: number[] | null;
  readonly switches: number[][];
  readonly ask: "output" | "input" | "middle";
}

const switchSubmissionSchema = z.object({
  // Values 0..5 and length ≤6 leave room for the future 6-element variant while
  // staying bounded — an unbounded array would be a hot-path memory vector.
  order: z.array(z.number().int().min(0).max(5)).max(6),
});
export type SwitchSubmission = z.infer<typeof switchSubmissionSchema>;

/** apply(seq, perm)[i] = seq[perm[i]] — the switch reads against the current
 * `1 2 3 4` reference (i.e. the current arrangement). */
function apply(seq: readonly number[], perm: readonly number[]): number[] {
  return perm.map((p) => seq[p]!);
}

/** invert(perm): q with q[perm[i]] = i. */
function invert(perm: readonly number[]): number[] {
  const q = new Array<number>(perm.length);
  perm.forEach((p, i) => {
    q[p] = i;
  });
  return q;
}

function randomPerm(rng: Rng): number[] {
  return rngShuffle(rng, [0, 1, 2, 3]);
}

function arraysEqual(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export const switchChallengeModule: GameModule<
  SwitchInstance,
  SwitchClientView,
  typeof switchSubmissionSchema
> = {
  key: GameKey.SWITCH_CHALLENGE,
  displayName: "Switch Challenge",
  allowSkipDefault: false,
  defaultClockSeconds: 360,
  devOnly: false,
  interactive: false,
  defaultItemSeconds: null,
  submissionSchema: switchSubmissionSchema,

  generate(seed: string, difficulty: GameDifficulty): SwitchInstance {
    const rng = createRng(`${seed}:switch`);
    const symbols = [...SWITCH_SYMBOLS];

    if (difficulty === GameDifficulty.EASY) {
      const input = randomPerm(rng);
      const sw = randomPerm(rng);
      return {
        kind: GameKey.SWITCH_CHALLENGE,
        mode: "easy",
        symbols,
        input,
        output: null,
        switches: [sw],
        ask: "output",
        solution: apply(input, sw),
      };
    }

    if (difficulty === GameDifficulty.MODERATE) {
      const input = randomPerm(rng);
      const sw = randomPerm(rng);
      const output = apply(input, sw);
      return {
        kind: GameKey.SWITCH_CHALLENGE,
        mode: "moderate",
        symbols,
        input: null,
        output,
        switches: [sw],
        ask: "input",
        solution: input, // work backwards: input = apply(output, invert(sw))
      };
    }

    // hard — three layers. mid1 → mid2 → output; each re-indexes as the next.
    const input = randomPerm(rng);
    const s1 = randomPerm(rng);
    const s2 = randomPerm(rng);
    const s3 = randomPerm(rng);
    const mid1 = apply(input, s1);
    const mid2 = apply(mid1, s2);
    const output = apply(mid2, s3);
    const askMiddle = rng() < 0.5;
    if (askMiddle) {
      return {
        kind: GameKey.SWITCH_CHALLENGE,
        mode: "hard_middle",
        symbols,
        input,
        output,
        switches: [s1, s3], // s2 is hidden — it is the answer
        ask: "middle",
        solution: s2,
      };
    }
    return {
      kind: GameKey.SWITCH_CHALLENGE,
      mode: "hard_output",
      symbols,
      input,
      output: null,
      switches: [s1, s2, s3],
      ask: "output",
      solution: output,
    };
  },

  toClientView(instance: SwitchInstance): SwitchClientView {
    return {
      kind: instance.kind,
      mode: instance.mode,
      symbols: instance.symbols,
      input: instance.input,
      output: instance.output,
      switches: instance.switches.map((s) => [...s]),
      ask: instance.ask,
    };
  },

  score(instance: SwitchInstance, submission: SwitchSubmission): GameScoreResult {
    return { correct: arraysEqual(submission.order, instance.solution) };
  },

  explain(instance: SwitchInstance): GameExplanation {
    const asked =
      instance.ask === "output"
        ? "the output arrangement"
        : instance.ask === "input"
          ? "the original input (trace the switch backwards)"
          : "the hidden middle switch";
    return { solution: instance.solution, note: `Answer is ${asked}.` };
  },
};

/** Exposed for tests: solve any instance the way a correct player would (never
 * by reading `solution`), to prove the mechanics — especially bottom-up + the
 * middle-switch-of-three case. */
export function solveSwitch(view: SwitchClientView): number[] {
  if (view.mode === "easy") {
    return apply(view.input!, view.switches[0]!);
  }
  if (view.mode === "moderate") {
    return apply(view.output!, invert(view.switches[0]!));
  }
  if (view.mode === "hard_output") {
    const [s1, s2, s3] = view.switches as [number[], number[], number[]];
    return apply(apply(apply(view.input!, s1), s2), s3);
  }
  // hard_middle: find s2 with apply(apply(mid1,s2),s3)=output.
  const [s1, s3] = view.switches as [number[], number[]];
  const mid1 = apply(view.input!, s1);
  const mid2 = apply(view.output!, invert(s3));
  // s2[i] = position in mid1 of mid2[i].
  return mid2.map((v) => mid1.indexOf(v));
}
