/**
 * `bubble_math` — Quickfire Math. THREE bubbles per question, each showing a
 * plain number or a small arithmetic expression (+ − × ÷). Compute all three,
 * then click them in ASCENDING order of value. ~15 seconds per question
 * (INTRINSIC — see `defaultItemSeconds`, enforced server-side, not a practice
 * preference). Values may be negative.
 *
 * The submission is an ORDERING of the three indices — the SAME shape as
 * `_probe`. That is deliberate and worth noting: this game stresses per-item
 * TIMING, not submission variety. The client view carries only the displayed
 * expressions; the computed values and the correct order stay server-side.
 *
 * EXACT TIES ARE NEVER GENERATED. "Ascending order" is ambiguous when two values
 * are equal, so generation reseeds until all three values are distinct — the
 * same fairness rule applied to Inductive's "exactly one answer".
 */
import { z } from "zod";

import { GameDifficulty, GameKey } from "../enums.js";
import { createRng, rngShuffle, type Rng } from "./prng.js";
import type { GameExplanation, GameModule, GameScoreResult } from "./types.js";

/** One bubble: what the player SEES (`expr`) and its server-only `value`. */
interface Bubble {
  readonly expr: string;
  readonly value: number;
}

export interface BubbleMathInstance {
  readonly kind: typeof GameKey.BUBBLE_MATH;
  readonly bubbles: Bubble[];
  /** Indices of `bubbles` in ascending value order (the answer). */
  readonly solution: number[];
}

export interface BubbleMathClientView {
  readonly kind: typeof GameKey.BUBBLE_MATH;
  /** Expressions ONLY — never the computed values, never the order. */
  readonly bubbles: { readonly expr: string }[];
}

const bubbleMathSubmissionSchema = z.object({
  // An ordering of the three bubble indices (0..2). Bounded; the score compares
  // it against the stored ascending order exactly.
  order: z.array(z.number().int().min(0).max(2)).max(3),
});
export type BubbleMathSubmission = z.infer<typeof bubbleMathSubmissionSchema>;

type Op = "+" | "-" | "×" | "÷";

interface Tier {
  /** null = plain single-digit numbers (no operation). */
  readonly ops: readonly Op[] | null;
  readonly minOperand: number;
  readonly maxOperand: number;
  /** hard allows results to go negative via subtraction / operand order. */
  readonly allowNegative: boolean;
}
const TIER: Record<GameDifficulty, Tier> = {
  [GameDifficulty.EASY]: {
    ops: null,
    minOperand: 1,
    maxOperand: 9,
    allowNegative: false,
  },
  [GameDifficulty.MODERATE]: {
    ops: ["+", "-", "×"],
    minOperand: 1,
    maxOperand: 9,
    allowNegative: false,
  },
  [GameDifficulty.HARD]: {
    ops: ["+", "-", "×", "÷"],
    minOperand: 2,
    maxOperand: 18,
    allowNegative: true,
  },
};

const MAX_RESEEDS = 40;

function randInt(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** Build ONE bubble for the tier. Division is ALWAYS exact (the dividend is
 * constructed as divisor×quotient), so no result is ever fractional. */
function makeBubble(rng: Rng, tier: Tier): Bubble {
  if (tier.ops == null) {
    const v = randInt(rng, tier.minOperand, tier.maxOperand);
    return { expr: `${v}`, value: v };
  }
  const op = tier.ops[Math.floor(rng() * tier.ops.length)]!;
  if (op === "÷") {
    const divisor = randInt(rng, 2, Math.max(2, Math.floor(tier.maxOperand / 2)));
    const quotient = randInt(rng, 1, Math.max(1, Math.floor(tier.maxOperand / 2)));
    const dividend = divisor * quotient; // guarantees exact division
    return { expr: `${dividend}÷${divisor}`, value: quotient };
  }
  let a = randInt(rng, tier.minOperand, tier.maxOperand);
  let b = randInt(rng, tier.minOperand, tier.maxOperand);
  if (op === "+") return { expr: `${a}+${b}`, value: a + b };
  if (op === "×") return { expr: `${a}×${b}`, value: a * b };
  // subtraction: keep non-negative unless the tier allows negatives.
  if (!tier.allowNegative && a < b) [a, b] = [b, a];
  return { expr: `${a}-${b}`, value: a - b };
}

function ascendingIndices(bubbles: readonly Bubble[]): number[] {
  return bubbles
    .map((bubble, index) => ({ value: bubble.value, index }))
    .sort((x, y) => x.value - y.value)
    .map((p) => p.index);
}

function sameOrder(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export const bubbleMathModule: GameModule<
  BubbleMathInstance,
  BubbleMathClientView,
  typeof bubbleMathSubmissionSchema
> = {
  key: GameKey.BUBBLE_MATH,
  displayName: "Bubble / Quickfire Math",
  allowSkipDefault: true,
  defaultClockSeconds: 360,
  // Intrinsic ~15s/question (server-enforced). This is the game's defining
  // pressure, not an authoring preference.
  defaultItemSeconds: 15,
  devOnly: false,
  interactive: false,
  submissionSchema: bubbleMathSubmissionSchema,

  generate(seed: string, difficulty: GameDifficulty): BubbleMathInstance {
    const tier = TIER[difficulty];
    // Reseed until all three values are DISTINCT — a tie makes "ascending order"
    // ambiguous. Distinctness is easy to hit, so this almost always passes first
    // try (measured fallback ~0); the last attempt is force-distinctified so a
    // well-formed item is always returned.
    for (let attempt = 0; attempt < MAX_RESEEDS; attempt += 1) {
      const rng = createRng(`${seed}:bubble:${attempt}`);
      const bubbles = [
        makeBubble(rng, tier),
        makeBubble(rng, tier),
        makeBubble(rng, tier),
      ];
      const values = bubbles.map((b) => b.value);
      if (new Set(values).size === 3) {
        return {
          kind: GameKey.BUBBLE_MATH,
          bubbles,
          solution: ascendingIndices(bubbles),
        };
      }
    }
    // Deterministic fallback: three plain, guaranteed-distinct values.
    const rng = createRng(`${seed}:bubble:fallback`);
    const base = randInt(rng, 1, 5);
    const bubbles: Bubble[] = [
      { expr: `${base}`, value: base },
      { expr: `${base + 1}`, value: base + 1 },
      { expr: `${base + 2}`, value: base + 2 },
    ];
    const shuffled = rngShuffle(rng, bubbles);
    return {
      kind: GameKey.BUBBLE_MATH,
      bubbles: shuffled,
      solution: ascendingIndices(shuffled),
    };
  },

  toClientView(instance: BubbleMathInstance): BubbleMathClientView {
    // Expressions only — values and order are intentionally not copied.
    return {
      kind: instance.kind,
      bubbles: instance.bubbles.map((b) => ({ expr: b.expr })),
    };
  },

  score(
    instance: BubbleMathInstance,
    submission: BubbleMathSubmission,
  ): GameScoreResult {
    return { correct: sameOrder(submission.order ?? [], instance.solution) };
  },

  explain(instance: BubbleMathInstance): GameExplanation {
    const sorted = [...instance.bubbles].sort((a, b) => a.value - b.value);
    return {
      solution: instance.solution,
      note: `Ascending: ${sorted.map((b) => `${b.expr}=${b.value}`).join(" < ")}.`,
    };
  },
};
