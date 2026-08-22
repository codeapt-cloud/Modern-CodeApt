/**
 * `inductive_reasoning` — LEFT shows 2 example grids sharing a hidden rule; RIGHT
 * shows 4 option grids and the player selects EXACTLY the TWO that follow the
 * same rule (selecting one does not register — the transcripts flag this as a
 * common loss). Submission is a SET of two indices (a third distinct shape:
 * order-insensitive, exactly two).
 *
 * Each rule family is a single-grid PREDICATE `P(grid)` with a matching
 * constructor. Generation builds 2 conforming examples + 4 options (2 conforming,
 * 2 violating) on 3×3 symbol grids, then VERIFIES by evaluating P against all
 * four options: if exactly two don't conform, it reseeds. We do NOT replicate
 * the real exam's "closest fit when no option is perfect" — an ambiguous
 * question is an unfair question, so every generated item has exactly two
 * unambiguous conformers.
 *
 * Some source families are pairwise relations ("reversal between the pair",
 * "interchange two symbols"); we render each as a concrete single-grid predicate
 * (documented per family) so "does this option follow the rule?" is well-defined.
 */
import { z } from "zod";

import { GameDifficulty, GameKey } from "../enums.js";
import { createRng, rngShuffle, type Rng } from "./prng.js";
import type { GameExplanation, GameModule, GameScoreResult } from "./types.js";

const SYMBOLS = ["circle", "triangle", "square", "plus", "star", "half_moon"];
const SIZE = 3;
const CELLS = SIZE * SIZE;

/** Row-major 3×3 grid of symbol names. */
type Grid = string[];

export interface InductiveInstance {
  readonly kind: typeof GameKey.INDUCTIVE_REASONING;
  readonly size: number;
  readonly symbols: string[];
  readonly left: Grid[]; // 2 conforming examples
  readonly options: Grid[]; // 4 options
  readonly rule: string; // hidden family id
  readonly solution: number[]; // the exactly-two conforming option indices
}

export interface InductiveClientView {
  readonly kind: typeof GameKey.INDUCTIVE_REASONING;
  readonly size: number;
  readonly symbols: string[];
  readonly left: Grid[];
  readonly options: Grid[];
}

const inductiveSubmissionSchema = z.object({
  // A SET of option indices (0..3). Bounded; compared as a set (order-free).
  selected: z.array(z.number().int().min(0).max(3)).max(4),
});
export type InductiveSubmission = z.infer<typeof inductiveSubmissionSchema>;

// --- Grid helpers -----------------------------------------------------------
function row(g: Grid, i: number): string[] {
  return [g[i * SIZE]!, g[i * SIZE + 1]!, g[i * SIZE + 2]!];
}
function col(g: Grid, j: number): string[] {
  return [g[j]!, g[j + SIZE]!, g[j + 2 * SIZE]!];
}
function eq(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
function rotR(a: string[]): string[] {
  return [a[a.length - 1]!, ...a.slice(0, -1)];
}
function sortedCounts(g: Grid): number[] {
  const m = new Map<string, number>();
  for (const s of g) m.set(s, (m.get(s) ?? 0) + 1);
  return [...m.values()].sort((a, b) => a - b);
}
function distinctCount(g: Grid): number {
  return new Set(g).size;
}
function randomGrid(rng: Rng, paletteSize: number): Grid {
  const g: Grid = [];
  for (let i = 0; i < CELLS; i += 1) {
    g.push(SYMBOLS[Math.floor(rng() * paletteSize)]!);
  }
  return g;
}
function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

// --- Rule families: predicate + conforming constructor ----------------------
interface Family {
  readonly id: string;
  readonly predicate: (g: Grid) => boolean;
  readonly make: (rng: Rng) => Grid;
}

function distributionFamily(id: string, target: number[]): Family {
  const want = [...target].sort((a, b) => a - b);
  return {
    id,
    predicate: (g) => eq(sortedCounts(g).map(String), want.map(String)),
    make: (rng) => {
      const syms = rngShuffle(rng, [...SYMBOLS]).slice(0, target.length);
      const cells: string[] = [];
      target.forEach((count, i) => {
        for (let c = 0; c < count; c += 1) cells.push(syms[i]!);
      });
      return rngShuffle(rng, cells);
    },
  };
}

const FAMILIES: Record<GameDifficulty, Family[]> = {
  [GameDifficulty.EASY]: [
    {
      id: "rows_1_3_equal",
      predicate: (g) => eq(row(g, 0), row(g, 2)),
      make: (rng) => {
        const g = randomGrid(rng, 4);
        for (let j = 0; j < SIZE; j += 1) g[2 * SIZE + j] = g[j]!;
        return g;
      },
    },
    {
      id: "cols_1_2_equal",
      predicate: (g) => eq(col(g, 0), col(g, 1)),
      make: (rng) => {
        const g = randomGrid(rng, 4);
        for (let i = 0; i < SIZE; i += 1) g[i * SIZE + 1] = g[i * SIZE]!;
        return g;
      },
    },
    {
      id: "corners_equal",
      predicate: (g) => g[0] === g[2] && g[2] === g[6] && g[6] === g[8],
      make: (rng) => {
        const g = randomGrid(rng, 4);
        const s = pick(rng, SYMBOLS);
        g[0] = s;
        g[2] = s;
        g[6] = s;
        g[8] = s;
        return g;
      },
    },
    {
      id: "diagonal_equal",
      predicate: (g) => g[0] === g[4] && g[4] === g[8],
      make: (rng) => {
        const g = randomGrid(rng, 4);
        const s = pick(rng, SYMBOLS);
        g[0] = s;
        g[4] = s;
        g[8] = s;
        return g;
      },
    },
  ],
  [GameDifficulty.MODERATE]: [
    {
      id: "shift_rows",
      predicate: (g) =>
        eq(row(g, 1), rotR(row(g, 0))) && eq(row(g, 2), rotR(row(g, 1))),
      make: (rng) => {
        const r0 = [pick(rng, SYMBOLS), pick(rng, SYMBOLS), pick(rng, SYMBOLS)];
        const r1 = rotR(r0);
        const r2 = rotR(r1);
        return [...r0, ...r1, ...r2];
      },
    },
    {
      id: "reversal_palindrome",
      predicate: (g) => [0, 1, 2].every((i) => g[i * SIZE] === g[i * SIZE + 2]),
      make: (rng) => {
        const g = randomGrid(rng, 4);
        for (let i = 0; i < SIZE; i += 1) g[i * SIZE + 2] = g[i * SIZE]!;
        return g;
      },
    },
    {
      id: "colour_count_2",
      predicate: (g) => distinctCount(g) === 2,
      make: (rng) => {
        const [a, b] = rngShuffle(rng, [...SYMBOLS]);
        const g: Grid = [a!, b!]; // guarantee both appear
        for (let i = 2; i < CELLS; i += 1) g.push(rng() < 0.5 ? a! : b!);
        return rngShuffle(rng, g);
      },
    },
    {
      id: "colour_count_3",
      predicate: (g) => distinctCount(g) === 3,
      make: (rng) => {
        const [a, b, c] = rngShuffle(rng, [...SYMBOLS]);
        const g: Grid = [a!, b!, c!];
        for (let i = 3; i < CELLS; i += 1) g.push(pick(rng, [a!, b!, c!]));
        return rngShuffle(rng, g);
      },
    },
  ],
  [GameDifficulty.HARD]: [
    {
      // Row 1 is row 0 with exactly one pair of positions swapped.
      id: "interchange",
      predicate: (g) => {
        const r0 = row(g, 0);
        const r1 = row(g, 1);
        const diffs: number[] = [];
        for (let i = 0; i < SIZE; i += 1) if (r0[i] !== r1[i]) diffs.push(i);
        if (diffs.length !== 2) return false;
        const [i, j] = diffs as [number, number];
        return r0[i] === r1[j] && r0[j] === r1[i];
      },
      make: (rng) => {
        let r0: string[];
        do {
          r0 = [pick(rng, SYMBOLS), pick(rng, SYMBOLS), pick(rng, SYMBOLS)];
        } while (new Set(r0).size < 2); // need two different symbols to swap
        // choose two positions with different symbols
        let i = 0;
        let j = 1;
        const combos: Array<[number, number]> = [
          [0, 1],
          [0, 2],
          [1, 2],
        ];
        for (const [a, b] of rngShuffle(rng, combos)) {
          if (r0[a] !== r0[b]) {
            i = a;
            j = b;
            break;
          }
        }
        const r1 = [...r0];
        r1[i] = r0[j]!;
        r1[j] = r0[i]!;
        const r2 = randomGrid(rng, 4).slice(0, SIZE);
        return [...r0, ...r1, ...r2];
      },
    },
    distributionFamily("dist_117", [1, 1, 7]),
    distributionFamily("dist_1116", [1, 1, 1, 6]),
    distributionFamily("dist_1224", [1, 2, 2, 4]),
    distributionFamily("dist_1125", [1, 1, 2, 5]),
  ],
};

// Flat id → predicate map, exported for independent verification (and reusable
// by a future UI's "explain the rule" surface).
const ALL_FAMILIES: Family[] = Object.values(FAMILIES).flat();
const PREDICATE_BY_ID = new Map(ALL_FAMILIES.map((f) => [f.id, f.predicate]));
export const INDUCTIVE_RULE_IDS: string[] = ALL_FAMILIES.map((f) => f.id);
export function conformsToInductiveRule(
  ruleId: string,
  grid: string[],
): boolean {
  const p = PREDICATE_BY_ID.get(ruleId);
  return p ? p(grid) : false;
}

function makeViolating(rng: Rng, family: Family): Grid {
  for (let tries = 0; tries < 40; tries += 1) {
    const g = randomGrid(rng, 4);
    if (!family.predicate(g)) return g;
  }
  return randomGrid(rng, 4); // outer verify will reseed if this conforms
}

function generateOnce(
  seed: string,
  difficulty: GameDifficulty,
): InductiveInstance | null {
  const rng = createRng(seed);
  const families = FAMILIES[difficulty];
  const family = pick(rng, families);

  const left = [family.make(rng), family.make(rng)];
  if (!left.every(family.predicate)) return null; // examples must conform

  const raw = [
    family.make(rng),
    family.make(rng),
    makeViolating(rng, family),
    makeViolating(rng, family),
  ];
  const options = rngShuffle(rng, raw);

  // VERIFY exactly two options conform.
  const solution = options
    .map((g, i) => (family.predicate(g) ? i : -1))
    .filter((i) => i >= 0);
  if (solution.length !== 2) return null;

  // DISAMBIGUATE: a player infers the rule from the two LEFT examples, so if any
  // OTHER family also explains both examples yet would pick a DIFFERENT option
  // set, the question is unfair (under-determined). Reseed until the examples
  // point at exactly one answer.
  const trueSet = JSON.stringify(solution);
  for (const other of ALL_FAMILIES) {
    if (other.id === family.id) continue;
    if (!left.every((g) => other.predicate(g))) continue;
    const otherSet = JSON.stringify(
      options.map((g, i) => (other.predicate(g) ? i : -1)).filter((i) => i >= 0),
    );
    if (otherSet !== trueSet) return null;
  }

  return {
    kind: GameKey.INDUCTIVE_REASONING,
    size: SIZE,
    symbols: [...SYMBOLS],
    left,
    options,
    rule: family.id,
    solution,
  };
}

export const inductiveReasoningModule: GameModule<
  InductiveInstance,
  InductiveClientView,
  typeof inductiveSubmissionSchema
> = {
  key: GameKey.INDUCTIVE_REASONING,
  displayName: "Inductive Reasoning",
  allowSkipDefault: true,
  defaultClockSeconds: 360,
  devOnly: false,
  submissionSchema: inductiveSubmissionSchema,

  generate(seed: string, difficulty: GameDifficulty): InductiveInstance {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const inst = generateOnce(`${seed}:induct:${attempt}`, difficulty);
      if (inst) return inst;
    }
    // Deterministic fallback: the simplest family, hand-built to have exactly
    // two conformers, so an item is always well-formed.
    const rng = createRng(`${seed}:induct:fallback`);
    const conforming = (): Grid => {
      const g = randomGrid(rng, 4);
      for (let j = 0; j < SIZE; j += 1) g[2 * SIZE + j] = g[j]!; // rows 1==3
      return g;
    };
    const violating = (): Grid => {
      const g = randomGrid(rng, 4);
      g[6] = g[0] === SYMBOLS[0] ? SYMBOLS[1]! : SYMBOLS[0]!; // break row2==row0
      return g;
    };
    const pred = (g: Grid): boolean => eq(row(g, 0), row(g, 2));
    const options = rngShuffle(rng, [
      conforming(),
      conforming(),
      violating(),
      violating(),
    ]);
    const solution = options
      .map((g, i) => (pred(g) ? i : -1))
      .filter((i) => i >= 0);
    return {
      kind: GameKey.INDUCTIVE_REASONING,
      size: SIZE,
      symbols: [...SYMBOLS],
      left: [conforming(), conforming()],
      options,
      rule: "rows_1_3_equal",
      solution,
    };
  },

  toClientView(instance: InductiveInstance): InductiveClientView {
    return {
      kind: instance.kind,
      size: instance.size,
      symbols: instance.symbols,
      left: instance.left.map((g) => [...g]),
      options: instance.options.map((g) => [...g]),
    };
  },

  score(
    instance: InductiveInstance,
    submission: InductiveSubmission,
  ): GameScoreResult {
    const sel = new Set(submission.selected);
    const sol = new Set(instance.solution);
    const correct =
      sel.size === sol.size && [...sol].every((i) => sel.has(i));
    return { correct };
  },

  explain(instance: InductiveInstance): GameExplanation {
    return {
      solution: { indices: instance.solution, rule: instance.rule },
      note: `The two grids follow the "${instance.rule}" rule.`,
    };
  },
};
