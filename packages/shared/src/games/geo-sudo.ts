/**
 * `geo_sudo` — Geo Sudo / Gap / Deductive Challenge. A LATIN SQUARE (rows and
 * columns only — NO 3x3 boxes; deliberately not real Sudoku) of geometric
 * symbols with ONE `?` cell the player must fill from a palette.
 *
 * Difficulty is BOTH grid size AND deduction DEPTH — the number of other cells a
 * solver must deduce (by naked-single elimination) before the `?` itself becomes
 * forced. Size alone would make a 6x6 no harder to reason about than a 4x4; the
 * source transcripts describe multi-step elimination and note a 6x6 "cannot be
 * solved in a single step", so each tier carries a minimum depth:
 *   easy      4x4, depth 0 (the `?` is forced immediately by its row+column)
 *   moderate  5x5, depth >= 2
 *   hard      6x6, depth >= 4
 *
 * Generation removes holes GREEDILY while the `?` stays uniquely solvable and the
 * tier's depth window still holds — so puzzles are as sparse as uniqueness (and,
 * for easy, immediacy) allows. A bounded reseed loop retries for the floor; if a
 * seed can't reach it, the best (deepest) uniquely-solvable puzzle found is used
 * rather than a broken one. The client view shows the grid-with-holes, the
 * palette, and the `?` position — never the solution.
 */
import { z } from "zod";

import { GameDifficulty, GameKey } from "../enums.js";
import { createRng, rngShuffle, type Rng } from "./prng.js";
import type { GameExplanation, GameModule, GameScoreResult } from "./types.js";

export const GEO_SUDO_SYMBOLS = [
  "circle",
  "triangle",
  "square",
  "plus",
  "star",
  "half_moon",
] as const;
export type GeoSymbol = (typeof GEO_SUDO_SYMBOLS)[number];

interface Tier {
  readonly size: number;
  readonly minDepth: number;
  readonly maxDepth: number;
}
const TIER: Record<GameDifficulty, Tier> = {
  [GameDifficulty.EASY]: { size: 4, minDepth: 0, maxDepth: 0 },
  [GameDifficulty.MODERATE]: { size: 5, minDepth: 2, maxDepth: Infinity },
  [GameDifficulty.HARD]: { size: 6, minDepth: 4, maxDepth: Infinity },
};

const MAX_RESEEDS = 24;

export interface GeoSudoInstance {
  readonly kind: typeof GameKey.GEO_SUDO;
  readonly size: number;
  readonly grid: (GeoSymbol | null)[][];
  readonly blank: { row: number; col: number };
  readonly symbols: GeoSymbol[];
  readonly solution: GeoSymbol;
  /** How many other cells a solver must deduce before `?` is forced. */
  readonly deductionDepth: number;
}

export interface GeoSudoClientView {
  readonly kind: typeof GameKey.GEO_SUDO;
  readonly size: number;
  readonly grid: (GeoSymbol | null)[][];
  readonly blank: { row: number; col: number };
  readonly symbols: GeoSymbol[];
}

const geoSudoSubmissionSchema = z.object({
  symbol: z.string().max(20),
});
export type GeoSudoSubmission = z.infer<typeof geoSudoSubmissionSchema>;

function candidatesAt(
  grid: (GeoSymbol | null)[][],
  r: number,
  c: number,
  symbols: readonly GeoSymbol[],
): GeoSymbol[] {
  const used = new Set<GeoSymbol>();
  const n = grid.length;
  for (let j = 0; j < n; j += 1) {
    const v = grid[r]![j];
    if (v) used.add(v);
  }
  for (let i = 0; i < n; i += 1) {
    const v = grid[i]![c];
    if (v) used.add(v);
  }
  return symbols.filter((s) => !used.has(s));
}

/**
 * Deduction depth of the `?`: run naked-single propagation ROUND by round,
 * counting how many OTHER cells get filled before `?` reduces to one candidate.
 * Returns null if `?` is never forced (ambiguous) or a contradiction appears.
 * depth 0 = forced immediately.
 */
function deductionDepth(
  grid: (GeoSymbol | null)[][],
  blank: { row: number; col: number },
  symbols: readonly GeoSymbol[],
): number | null {
  const n = grid.length;
  const work = grid.map((row) => [...row]);
  let filled = 0;
  for (;;) {
    const bc = candidatesAt(work, blank.row, blank.col, symbols);
    if (bc.length === 1) return filled;
    if (bc.length === 0) return null;
    const round: Array<[number, number, GeoSymbol]> = [];
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        if (i === blank.row && j === blank.col) continue;
        if (work[i]![j] != null) continue;
        const cand = candidatesAt(work, i, j, symbols);
        if (cand.length === 0) return null;
        if (cand.length === 1) round.push([i, j, cand[0]!]);
      }
    }
    if (round.length === 0) return null; // stuck; `?` still ambiguous
    for (const [i, j, s] of round) {
      if (work[i]![j] == null) {
        work[i]![j] = s;
        filled += 1;
      }
    }
  }
}

/** Build a valid Latin square via a cyclic base with seeded row/col perms. */
function buildLatinSquare(rng: Rng, symbols: GeoSymbol[]): GeoSymbol[][] {
  const n = symbols.length;
  const rows = rngShuffle(rng, Array.from({ length: n }, (_v, i) => i));
  const cols = rngShuffle(rng, Array.from({ length: n }, (_v, i) => i));
  const grid: GeoSymbol[][] = [];
  for (let i = 0; i < n; i += 1) {
    const row: GeoSymbol[] = [];
    for (let j = 0; j < n; j += 1) {
      row.push(symbols[(rows[i]! + cols[j]!) % n]!);
    }
    grid.push(row);
  }
  return grid;
}

/** One generation pass. ALWAYS returns a uniquely-solvable instance (the `?` is
 * kept forced throughout), plus whether its depth fell inside the tier window —
 * so the caller can accept it or keep the deepest as a fallback WITHOUT a second
 * generateOnce call on the hot path. */
function generateOnce(
  seed: string,
  tier: Tier,
): { inst: GeoSudoInstance; meetsWindow: boolean } {
  const { size, minDepth, maxDepth } = tier;
  const rng = createRng(seed);
  const symbols = rngShuffle(rng, [...GEO_SUDO_SYMBOLS]).slice(0, size);
  const solved = buildLatinSquare(rng, symbols);

  const br = Math.floor(rng() * size);
  const bc = Math.floor(rng() * size);
  const blank = { row: br, col: bc };
  const solution = solved[br]![bc]!;

  const grid: (GeoSymbol | null)[][] = solved.map((row) => [...row]);
  grid[br]![bc] = null; // `?` — always removed

  // Greedily remove holes, keeping one only while `?` stays uniquely solvable
  // (depth non-null) AND the tier's depth window still holds. This drives the
  // puzzle as sparse as the window allows: for easy (maxDepth 0) only holes that
  // keep `?` immediate survive; for moderate/hard it sparsifies toward the floor.
  const others: Array<[number, number]> = [];
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      if (i !== br || j !== bc) others.push([i, j]);
    }
  }
  for (const [i, j] of rngShuffle(rng, others)) {
    const saved = grid[i]![j] ?? null;
    grid[i]![j] = null;
    const d = deductionDepth(grid, blank, symbols);
    if (d != null && d <= maxDepth) continue; // keep the hole
    grid[i]![j] = saved; // restore — breaks uniqueness or exceeds the window
  }

  // `?` was kept forced through every removal, so depth is always non-null here.
  const depth = deductionDepth(grid, blank, symbols) ?? 0;
  const inst: GeoSudoInstance = {
    kind: GameKey.GEO_SUDO,
    size,
    grid,
    blank,
    symbols,
    solution,
    deductionDepth: depth,
  };
  return { inst, meetsWindow: depth >= minDepth && depth <= maxDepth };
}

export const geoSudoModule: GameModule<
  GeoSudoInstance,
  GeoSudoClientView,
  typeof geoSudoSubmissionSchema
> = {
  key: GameKey.GEO_SUDO,
  displayName: "Geo Sudo",
  allowSkipDefault: true,
  defaultClockSeconds: 360,
  devOnly: false,
  submissionSchema: geoSudoSubmissionSchema,

  generate(seed: string, difficulty: GameDifficulty): GeoSudoInstance {
    const tier = TIER[difficulty];
    // ONE generateOnce per attempt. Accept the first that meets the tier window;
    // otherwise keep the DEEPEST uniquely-solvable puzzle as a fallback (derived
    // from the same pass — no second call). A returned fallback is below the
    // floor but stores its REAL deductionDepth, so degradation is never silent.
    let best: GeoSudoInstance | null = null;
    for (let attempt = 0; attempt < MAX_RESEEDS; attempt += 1) {
      const { inst, meetsWindow } = generateOnce(`${seed}:geo:${attempt}`, tier);
      if (meetsWindow) return inst;
      if (!best || inst.deductionDepth > best.deductionDepth) best = inst;
    }
    return best!;
  },

  toClientView(instance: GeoSudoInstance): GeoSudoClientView {
    return {
      kind: instance.kind,
      size: instance.size,
      grid: instance.grid.map((row) => [...row]),
      blank: instance.blank,
      symbols: instance.symbols,
    };
  },

  score(
    instance: GeoSudoInstance,
    submission: GeoSudoSubmission,
  ): GameScoreResult {
    return { correct: submission.symbol === instance.solution };
  },

  explain(instance: GeoSudoInstance): GameExplanation {
    return {
      solution: instance.solution,
      note: `The only symbol absent from the ? cell's row and column (depth ${instance.deductionDepth}).`,
    };
  },
};
