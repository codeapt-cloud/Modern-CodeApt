/**
 * `grid_challenge` — a THREE-CYCLE INTERLEAVED DUAL TASK (Capgemini set, confirmed
 * from the live technicalhub portal). Each cycle: a scatter of ~20 free-floating
 * grey circles shows, ONE highlighted green for 2s (memorise WHICH); then two 5x5
 * patterns show for 6s asking "rotated but identical?" (ROTATION, not mirror). The
 * rotation task is deliberate INTERFERENCE between memorisations — separating the
 * phases would be a substantially easier game. After three cycles the scatter
 * returns and the player clicks the three remembered circles IN ORDER.
 *
 * Scoring is the ONLY penalty game in the set: +3 correct / -1 wrong, PER ANSWER
 * (three rotation judgements + one ordered recall = four answers). Recall is
 * ALL-OR-NOTHING (right circles in the right order = +3, anything else = -1) —
 * faithful to the portal, where recall is a single answer at the end. The per-item
 * marks therefore range -4..+12 and can be NEGATIVE; the service floors only the
 * SET composite (see finishGameSet), never the per-game raw.
 *
 * INTERACTIVE by necessity: the 2s highlight is server-timed and must not be
 * re-servable, so exposure rides the probe channel — the highlight for a cycle is
 * projected only while that cycle is the live, un-acked memorise phase, and is
 * GONE once acked or during recall. (Honest limit: the highlight must be sent to
 * render it, so unlike door_key's hidden walls a scripted client could record it;
 * the achievable guarantee — never re-served after its window — is what we enforce
 * and test. The rotation answer IS truly withheld and verified by real rotation.)
 */
import { z } from "zod";

import { GRID_CHALLENGE } from "../constants.js";
import { GameDifficulty, GameKey } from "../enums.js";
import { createRng, rngInt, rngShuffle, type Rng } from "./prng.js";
import type {
  GameExplanation,
  GameModule,
  GameScoreResult,
  ProbeContract,
} from "./types.js";

const N = GRID_CHALLENGE.PATTERN_SIZE; // 5
const CELLS = N * N; // 25
const CYCLES = GRID_CHALLENGE.CYCLES; // 3

type Phase = "memorize" | "symmetry" | "recall" | "done";

export interface GridPoint {
  readonly x: number; // 0..100 (free-floating; NOT snapped to a grid)
  readonly y: number;
}

/** One cycle's authored data. `pattern`s are 5x5 booleans (row-major, length 25).
 * `isRotation` is the HIDDEN rotation answer (verified at generation). */
export interface GridCycle {
  readonly highlight: number; // index into `circles` shown green this cycle
  readonly patternA: boolean[];
  readonly patternB: boolean[];
  readonly isRotation: boolean;
}

/** Full authored instance — carries the answers. Never sent to a client. */
export interface GridInstance {
  readonly kind: typeof GameKey.GRID_CHALLENGE;
  readonly circles: GridPoint[];
  readonly cycles: GridCycle[]; // length CYCLES
  readonly solution: {
    /** The highlighted circle indices, in cycle order (the recall answer). */
    readonly recallOrder: number[];
    readonly rotations: boolean[];
  };
}

/** What the client sees — phase-dependent, NEVER an answer. `highlight` is present
 * ONLY during a live (un-acked) memorise phase; `pattern` only during symmetry. */
export interface GridClientView {
  readonly kind: typeof GameKey.GRID_CHALLENGE;
  readonly phase: Phase;
  readonly cycle: number; // 0-based; which cycle is active (CYCLES during recall/done)
  readonly totalCycles: number;
  readonly circles: GridPoint[];
  readonly highlightMs: number;
  readonly symmetryMs: number;
  /** The green circle index — present ONLY while this cycle's memorise is live. */
  readonly highlight: number | null;
  /** The rotation pair — present ONLY during the symmetry phase. */
  readonly pattern: { readonly a: boolean[]; readonly b: boolean[] } | null;
  /** Provisional score from answers LOCKED so far (post-answer only). */
  readonly score: number;
}

/** Per-item accumulated state, persisted server-side (never client-reported). */
export interface GridProbeState {
  phase: Phase;
  cycle: number;
  /** True while the current memorise highlight is still live (un-acked). */
  pendingReveal: boolean;
  /** Cycles whose highlight has been acked (and so is never re-served). */
  acked: number[];
  /** Rotation answers, one per cycle (null until answered). */
  symmetryAnswers: (boolean | null)[];
  /** The submitted ordered recall (empty until recall). */
  recall: number[];
  moves: number;
}

/** A single probe action: ack the memorise, answer the rotation, or submit recall. */
export type GridAction =
  | { readonly type: "ack" }
  | { readonly type: "symmetry"; readonly answer: boolean }
  | { readonly type: "recall"; readonly order: number[] };

const gridActionSchema: z.ZodType<GridAction> = z.union([
  z.object({ type: z.literal("ack") }),
  z.object({ type: z.literal("symmetry"), answer: z.boolean() }),
  z.object({
    type: z.literal("recall"),
    order: z.array(z.number().int().min(0).max(63)).max(CYCLES),
  }),
]);

/** The full-play submission (interactive answer path is closed; used by `score`
 * for a sound, testable replay — same discipline as door_key). */
const gridSubmissionSchema = z.object({
  symmetryAnswers: z.array(z.boolean()).max(CYCLES),
  recall: z.array(z.number().int().min(0).max(63)).max(CYCLES),
});
export type GridSubmission = z.infer<typeof gridSubmissionSchema>;

interface Tier {
  readonly circles: number;
  /** Fraction of the 25 cells filled in a pattern (density). */
  readonly density: number;
}
const TIER: Record<GameDifficulty, Tier> = {
  // Exposure is HELD at 2s/6s across tiers (faithful to the portal); difficulty
  // rises via circle COUNT + pattern DENSITY only.
  [GameDifficulty.EASY]: { circles: 18, density: 0.4 },
  [GameDifficulty.MODERATE]: { circles: 22, density: 0.48 },
  [GameDifficulty.HARD]: { circles: 26, density: 0.56 },
};

// --- Pure pattern helpers (rotation is the source of truth for the answer) ----

/** Rotate a 5x5 row-major boolean grid 90° clockwise. */
export function rotate90(grid: readonly boolean[]): boolean[] {
  const out = new Array<boolean>(CELLS).fill(false);
  for (let r = 0; r < N; r += 1) {
    for (let c = 0; c < N; c += 1) {
      // (r,c) -> (c, N-1-r)
      out[c * N + (N - 1 - r)] = grid[r * N + c]!;
    }
  }
  return out;
}

function equal(a: readonly boolean[], b: readonly boolean[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** True iff `b` equals `a` rotated by 0/90/180/270 — the INDEPENDENT check that
 * validates a cycle's stated `isRotation`, never trusting the generator's intent. */
export function isAnyRotation(a: readonly boolean[], b: readonly boolean[]): boolean {
  let r = a.slice();
  for (let k = 0; k < 4; k += 1) {
    if (equal(r, b)) return true;
    r = rotate90(r);
  }
  return false;
}

function randomPattern(rng: Rng, density: number): boolean[] {
  const grid = new Array<boolean>(CELLS);
  for (let i = 0; i < CELLS; i += 1) grid[i] = rng() < density;
  return grid;
}

/** Build a symmetry pair for one cycle: half the time a genuine rotation of A,
 * half the time a pattern that is NOT any rotation of A. The stated answer is
 * VERIFIED by isAnyRotation, so a coincidental rotation can never be mislabelled. */
function makePair(
  rng: Rng,
  density: number,
): { patternA: boolean[]; patternB: boolean[]; isRotation: boolean } {
  const patternA = randomPattern(rng, density);
  const wantRotation = rng() < 0.5;
  if (wantRotation) {
    const k = rngInt(rng, 0, 3); // 0/90/180/270
    let patternB = patternA.slice();
    for (let i = 0; i < k; i += 1) patternB = rotate90(patternB);
    return { patternA, patternB, isRotation: true };
  }
  // Want a NON-rotation: resample B until it is provably not any rotation of A.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const patternB = randomPattern(rng, density);
    if (!isAnyRotation(patternA, patternB)) {
      return { patternA, patternB, isRotation: false };
    }
  }
  // Fallback: flip one cell of A's 180° so it is guaranteed non-rotational-ish;
  // still VERIFIED below, so correctness never depends on this being clever.
  const patternB = rotate90(rotate90(patternA));
  patternB[0] = !patternB[0];
  const isRotation = isAnyRotation(patternA, patternB);
  return { patternA, patternB, isRotation };
}

/** Free coordinates in a 0..100 box with a minimum separation (rejection sample);
 * relaxes the separation if it can't place all circles, so generation always
 * terminates with the right count. */
function scatter(rng: Rng, count: number): GridPoint[] {
  const pts: GridPoint[] = [];
  let minSep = GRID_CHALLENGE.MIN_SEPARATION;
  let guard = 0;
  while (pts.length < count) {
    const p = { x: 4 + rng() * 92, y: 4 + rng() * 92 };
    const ok = pts.every(
      (q) => (q.x - p.x) ** 2 + (q.y - p.y) ** 2 >= minSep * minSep,
    );
    if (ok) pts.push(p);
    guard += 1;
    if (guard > count * 60) {
      minSep *= 0.85; // relax and keep going — never loop forever
      guard = 0;
    }
  }
  return pts;
}

// --- Scoring (the single source of truth, shared by settle + score) -----------

function sameOrder(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function tally(
  instance: GridInstance,
  symmetryAnswers: readonly (boolean | null)[],
  recall: readonly number[],
): GameScoreResult & { marks: number } {
  let marks = 0;
  for (let c = 0; c < CYCLES; c += 1) {
    const ans = symmetryAnswers[c];
    if (ans == null) continue; // unanswered → no mark (only on expiry, never on settle)
    marks +=
      ans === instance.cycles[c]!.isRotation
        ? GRID_CHALLENGE.MARKS_CORRECT
        : GRID_CHALLENGE.MARKS_WRONG;
  }
  // Recall is ALL-OR-NOTHING: right circles in the right ORDER, or -1.
  const recallCorrect = sameOrder(recall, instance.solution.recallOrder);
  marks += recallCorrect ? GRID_CHALLENGE.MARKS_CORRECT : GRID_CHALLENGE.MARKS_WRONG;
  return { marks, correct: marks > 0 };
}

/** The live header score: +3/-1 for each LOCKED symmetry answer, plus the recall
 * once submitted. Post-answer only — a pending answer is never reflected. */
function provisionalScore(instance: GridInstance, state: GridProbeState): number {
  let s = 0;
  for (let c = 0; c < CYCLES; c += 1) {
    const a = state.symmetryAnswers[c];
    if (a != null) {
      s +=
        a === instance.cycles[c]!.isRotation
          ? GRID_CHALLENGE.MARKS_CORRECT
          : GRID_CHALLENGE.MARKS_WRONG;
    }
  }
  if (state.phase === "done") {
    s += sameOrder(state.recall, instance.solution.recallOrder)
      ? GRID_CHALLENGE.MARKS_CORRECT
      : GRID_CHALLENGE.MARKS_WRONG;
  }
  return s;
}

/** Typed view builder — the single source of the redacted projection, shared by
 * `probe.view` (erased to unknown) and `toClientView` (typed), like door_key. */
function buildView(instance: GridInstance, state: GridProbeState): GridClientView {
  const liveMemorise = state.phase === "memorize" && state.pendingReveal;
  const cycle = state.cycle < CYCLES ? state.cycle : CYCLES;
  return {
    kind: instance.kind,
    phase: state.phase,
    cycle,
    totalCycles: CYCLES,
    circles: instance.circles,
    highlightMs: GRID_CHALLENGE.HIGHLIGHT_MS,
    symmetryMs: GRID_CHALLENGE.SYMMETRY_MS,
    // The green circle is projected ONLY while its memorise phase is live.
    highlight: liveMemorise ? instance.cycles[state.cycle]!.highlight : null,
    pattern:
      state.phase === "symmetry"
        ? {
            a: instance.cycles[state.cycle]!.patternA,
            b: instance.cycles[state.cycle]!.patternB,
          }
        : null,
    score: provisionalScore(instance, state),
  };
}

// --- Probe contract -----------------------------------------------------------

const gridProbe: ProbeContract<GridInstance, GridProbeState, GridAction> = {
  actionSchema: gridActionSchema,

  init(): GridProbeState {
    return {
      phase: "memorize",
      cycle: 0,
      pendingReveal: true,
      acked: [],
      symmetryAnswers: Array.from({ length: CYCLES }, () => null),
      recall: [],
      moves: 0,
    };
  },

  apply(_instance, state, action): GridProbeState {
    const next: GridProbeState = {
      phase: state.phase,
      cycle: state.cycle,
      pendingReveal: state.pendingReveal,
      acked: [...state.acked],
      symmetryAnswers: [...state.symmetryAnswers],
      recall: [...state.recall],
      moves: state.moves + 1,
    };
    if (action.type === "ack") {
      // Consume the live memorise highlight → symmetry. A stray ack elsewhere
      // just burns a move (bounded), never reveals anything.
      if (next.phase === "memorize" && next.pendingReveal) {
        if (!next.acked.includes(next.cycle)) next.acked.push(next.cycle);
        next.pendingReveal = false;
        next.phase = "symmetry";
      }
    } else if (action.type === "symmetry") {
      if (next.phase === "symmetry") {
        next.symmetryAnswers[next.cycle] = action.answer;
        if (next.cycle < CYCLES - 1) {
          next.cycle += 1;
          next.phase = "memorize";
          next.pendingReveal = true;
        } else {
          next.cycle = CYCLES;
          next.phase = "recall";
        }
      }
    } else {
      // recall
      if (next.phase === "recall") {
        next.recall = action.order.slice(0, CYCLES);
        next.phase = "done";
      }
    }
    return next;
  },

  resolved(_instance, state): boolean {
    return state.phase === "done";
  },

  view(instance, state): GridClientView {
    return buildView(instance, state);
  },

  movesUsed(state): number {
    return state.moves;
  },
};

export const gridChallengeModule: GameModule<
  GridInstance,
  GridClientView,
  typeof gridSubmissionSchema,
  GridProbeState,
  GridAction
> = {
  key: GameKey.GRID_CHALLENGE,
  displayName: "Grid Challenge",
  allowSkipDefault: false, // a dual-task memory game has no meaningful mid-cycle skip
  defaultClockSeconds: 240, // ~4-minute round (portal)
  defaultItemSeconds: null, // the round clock bounds it; phases are client-paced windows
  devOnly: false,
  interactive: true,
  probe: gridProbe,
  submissionSchema: gridSubmissionSchema,

  generate(seed: string, difficulty: GameDifficulty): GridInstance {
    const tier = TIER[difficulty];
    const rng = createRng(`${seed}:grid`);
    const circles = scatter(rng, tier.circles);
    const highlights = rngShuffle(
      rng,
      Array.from({ length: tier.circles }, (_v, i) => i),
    ).slice(0, CYCLES);
    const cycles: GridCycle[] = highlights.map((highlight) => {
      const pair = makePair(rng, tier.density);
      return {
        highlight,
        patternA: pair.patternA,
        patternB: pair.patternB,
        isRotation: pair.isRotation,
      };
    });
    return {
      kind: GameKey.GRID_CHALLENGE,
      circles,
      cycles,
      solution: {
        recallOrder: highlights,
        rotations: cycles.map((c) => c.isRotation),
      },
    };
  },

  toClientView(instance: GridInstance): GridClientView {
    // The INITIAL view = the fresh probe state (cycle 0 memorise, highlight live).
    // Identical to probe.view(instance, init) — buildItemView uses probe.view for
    // interactive items, so this is only a contract-completeness projection.
    return buildView(instance, gridProbe.init(instance, {}));
  },

  score(instance: GridInstance, submission: GridSubmission): GameScoreResult {
    // Sound, testable replay of a full play (the live answer endpoint is closed
    // for interactive games). Correctness = the same net-positive rule as settle.
    const answers: (boolean | null)[] = Array.from({ length: CYCLES }, (_v, i) =>
      i < (submission.symmetryAnswers?.length ?? 0) ? submission.symmetryAnswers[i]! : null,
    );
    return { correct: tally(instance, answers, submission.recall ?? []).correct };
  },

  settle(instance: GridInstance, state: GridProbeState): GameScoreResult & { marks: number } {
    return tally(instance, state.symmetryAnswers, state.recall);
  },

  explain(instance: GridInstance): GameExplanation {
    return {
      solution: {
        recallOrder: instance.solution.recallOrder,
        rotations: instance.solution.rotations,
      },
      note: "Recall the highlighted circles in order; each rotation pair is +3/-1.",
    };
  },
};
