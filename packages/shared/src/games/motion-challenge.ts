/**
 * `motion_challenge` — Rush-Hour style. Slide 1×1 pieces one cell at a time to
 * clear a path so the BALL reaches the HOLE. SILVER blocks (`walls`) are FIXED;
 * movable `blocks` and the ball obstruct each other. Multiple valid solutions
 * exist; fewer moves is "better".
 *
 * Generation places a board and computes the OPTIMAL move count by BFS over the
 * (ball, block-set) state graph, storing it on the instance. The submission is a
 * MOVE SEQUENCE the server REPLAYS: each move must be legal (piece exists,
 * in-bounds, target not a wall/other piece); an illegal move mid-sequence scores
 * `wrong` (never a crash); the answer is correct iff the ball ends on the hole.
 *
 * SCORING DECISION — option (iii): `correct` = "reached the goal", optimality is
 * NOT part of correctness. Our ladder awards by difficulty tier only, so folding
 * optimality into `correct` would either make it a fuzzy tolerance (arbitrary) or
 * reject a genuinely valid solve. Reaching the hole IS solving the puzzle;
 * move-quality is surfaced in practice-mode `explain` (optimal vs yours). To make
 * the ladder quality-aware later: add an optional `quality` (0..1) to
 * GameScoreResult and have the service scale/bonus marks by it — a localized
 * change to applyLadderOutcome + the marks calc, no seam break.
 *
 * Difficulty = grid size + block count + optimal-solution length (see TIER).
 */
import { z } from "zod";

import { GameDifficulty, GameKey } from "../enums.js";
import { createRng, rngShuffle } from "./prng.js";
import type { GameExplanation, GameModule, GameScoreResult } from "./types.js";

interface Tier {
  readonly rows: number;
  readonly cols: number;
  readonly walls: number;
  readonly blocks: number;
  readonly minOpt: number;
  readonly maxOpt: number;
}
const TIER: Record<GameDifficulty, Tier> = {
  [GameDifficulty.EASY]: { rows: 4, cols: 4, walls: 2, blocks: 1, minOpt: 2, maxOpt: Infinity },
  [GameDifficulty.MODERATE]: { rows: 5, cols: 5, walls: 3, blocks: 2, minOpt: 4, maxOpt: Infinity },
  [GameDifficulty.HARD]: { rows: 6, cols: 6, walls: 4, blocks: 3, minOpt: 6, maxOpt: Infinity },
};

const MAX_RESEEDS = 40;
const BFS_STATE_CAP = 200_000;

export interface MotionInstance {
  readonly kind: typeof GameKey.MOTION_CHALLENGE;
  readonly rows: number;
  readonly cols: number;
  readonly walls: number[]; // fixed (silver) cell indices
  readonly blocks: number[]; // movable block cell indices (index = block id)
  readonly ball: number;
  readonly hole: number;
  readonly optimalMoves: number;
  readonly solution: number; // = optimalMoves (revealed only via explain)
}

export interface MotionClientView {
  readonly kind: typeof GameKey.MOTION_CHALLENGE;
  readonly rows: number;
  readonly cols: number;
  readonly walls: number[];
  readonly blocks: number[];
  readonly ball: number;
  readonly hole: number;
}

const motionSubmissionSchema = z.object({
  // piece 0 = ball, 1..k = block[piece-1]; dir 0=up 1=down 2=left 3=right.
  // Bounded: at most 200 moves, piece id ≤64 — no unbounded hot-path array.
  moves: z
    .array(
      z.object({
        piece: z.number().int().min(0).max(64),
        dir: z.number().int().min(0).max(3),
      }),
    )
    .max(200),
});
export type MotionSubmission = z.infer<typeof motionSubmissionSchema>;

interface State {
  readonly ball: number;
  readonly blocks: number[];
}
interface Move {
  readonly piece: number;
  readonly dir: number;
}

function step(cell: number, dir: number, rows: number, cols: number): number | null {
  const r = Math.floor(cell / cols);
  const c = cell % cols;
  const nr = dir === 0 ? r - 1 : dir === 1 ? r + 1 : r;
  const nc = dir === 2 ? c - 1 : dir === 3 ? c + 1 : c;
  if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) return null;
  return nr * cols + nc;
}

function stateKey(s: State): string {
  return `${s.ball}|${[...s.blocks].sort((a, b) => a - b).join(",")}`;
}

/** BFS to the goal; returns ONE optimal move sequence, or null if unsolvable. */
function bfsSolve(
  rows: number,
  cols: number,
  wallSet: ReadonlySet<number>,
  hole: number,
  start: State,
): Move[] | null {
  if (start.ball === hole) return [];
  const seen = new Set<string>([stateKey(start)]);
  // Parent map: stateKey -> { prevKey, move } for path reconstruction.
  const parent = new Map<string, { prev: string; move: Move }>();
  const stateByKey = new Map<string, State>([[stateKey(start), start]]);
  let frontier: State[] = [start];
  let explored = 0;

  while (frontier.length) {
    const next: State[] = [];
    for (const st of frontier) {
      const occ = new Set<number>([st.ball, ...st.blocks]);
      // Successors: move the ball (piece 0) or a block (piece i+1) one cell.
      const pieces: Array<{ id: number; pos: number }> = [
        { id: 0, pos: st.ball },
        ...st.blocks.map((pos, i) => ({ id: i + 1, pos })),
      ];
      for (const p of pieces) {
        for (let dir = 0; dir < 4; dir += 1) {
          const target = step(p.pos, dir, rows, cols);
          if (target == null || wallSet.has(target)) continue;
          if (occ.has(target)) continue; // another piece is there
          const succ: State =
            p.id === 0
              ? { ball: target, blocks: st.blocks }
              : {
                  ball: st.ball,
                  blocks: st.blocks.map((b, i) => (i === p.id - 1 ? target : b)),
                };
          const k = stateKey(succ);
          if (seen.has(k)) continue;
          if (++explored > BFS_STATE_CAP) return null; // safety bound
          seen.add(k);
          parent.set(k, { prev: stateKey(st), move: { piece: p.id, dir } });
          stateByKey.set(k, succ);
          if (succ.ball === hole) {
            // Reconstruct.
            const path: Move[] = [];
            let cur = k;
            while (parent.has(cur)) {
              const { prev, move } = parent.get(cur)!;
              path.push(move);
              cur = prev;
            }
            return path.reverse();
          }
          next.push(succ);
        }
      }
    }
    frontier = next;
  }
  return null;
}

function generateOnce(
  seed: string,
  tier: Tier,
): { inst: MotionInstance; meetsFloor: boolean } | null {
  const { rows, cols, walls, blocks } = tier;
  const rng = createRng(seed);
  const cells = rngShuffle(rng, Array.from({ length: rows * cols }, (_v, i) => i));
  let idx = 0;
  const ball = cells[idx++]!;
  const hole = cells[idx++]!;
  const wallArr: number[] = [];
  for (let i = 0; i < walls; i += 1) wallArr.push(cells[idx++]!);
  const blockArr: number[] = [];
  for (let i = 0; i < blocks; i += 1) blockArr.push(cells[idx++]!);

  const wallSet = new Set(wallArr);
  const path = bfsSolve(rows, cols, wallSet, hole, { ball, blocks: blockArr });
  if (path == null) return null; // unsolvable
  const optimalMoves = path.length;
  const inst: MotionInstance = {
    kind: GameKey.MOTION_CHALLENGE,
    rows,
    cols,
    walls: wallArr,
    blocks: blockArr,
    ball,
    hole,
    optimalMoves,
    solution: optimalMoves,
  };
  return {
    inst,
    meetsFloor: optimalMoves >= tier.minOpt && optimalMoves <= tier.maxOpt,
  };
}

/** A guaranteed-solvable board (ball walks a clear straight line to the hole),
 * used only if every reseed failed to produce a solvable board. */
function trivialBoard(tier: Tier): MotionInstance {
  const { rows, cols } = tier;
  const ball = 0;
  const hole = (rows - 1) * cols + (cols - 1);
  const path = bfsSolve(rows, cols, new Set(), hole, { ball, blocks: [] })!;
  return {
    kind: GameKey.MOTION_CHALLENGE,
    rows,
    cols,
    walls: [],
    blocks: [],
    ball,
    hole,
    optimalMoves: path.length,
    solution: path.length,
  };
}

export const motionChallengeModule: GameModule<
  MotionInstance,
  MotionClientView,
  typeof motionSubmissionSchema
> = {
  key: GameKey.MOTION_CHALLENGE,
  displayName: "Motion Challenge",
  allowSkipDefault: true,
  defaultClockSeconds: 360,
  devOnly: false,
  interactive: false,
  defaultItemSeconds: null,
  submissionSchema: motionSubmissionSchema,

  generate(seed: string, difficulty: GameDifficulty): MotionInstance {
    const tier = TIER[difficulty];
    let best: MotionInstance | null = null;
    for (let attempt = 0; attempt < MAX_RESEEDS; attempt += 1) {
      const r = generateOnce(`${seed}:motion:${attempt}`, tier);
      if (r?.meetsFloor) return r.inst;
      if (r && (!best || r.inst.optimalMoves > best.optimalMoves)) best = r.inst;
    }
    return best ?? trivialBoard(tier);
  },

  toClientView(instance: MotionInstance): MotionClientView {
    return {
      kind: instance.kind,
      rows: instance.rows,
      cols: instance.cols,
      walls: instance.walls,
      blocks: instance.blocks,
      ball: instance.ball,
      hole: instance.hole,
    };
  },

  score(instance: MotionInstance, submission: MotionSubmission): GameScoreResult {
    const { rows, cols } = instance;
    const wallSet = new Set(instance.walls);
    let ball = instance.ball;
    let blocks = [...instance.blocks];
    for (const mv of submission.moves) {
      const pos = mv.piece === 0 ? ball : blocks[mv.piece - 1];
      if (pos === undefined) return { correct: false }; // no such piece
      const target = step(pos, mv.dir, rows, cols);
      if (target == null || wallSet.has(target)) return { correct: false };
      // Blocked by another piece? (target is always a step from `pos`, so the
      // moving piece is never itself at `target`.)
      if (target === ball || blocks.includes(target)) return { correct: false };
      if (mv.piece === 0) ball = target;
      else blocks = blocks.map((b, i) => (i === mv.piece - 1 ? target : b));
    }
    return { correct: ball === instance.hole };
  },

  explain(
    instance: MotionInstance,
    submission: MotionSubmission | null,
  ): GameExplanation {
    const path = bfsSolve(
      instance.rows,
      instance.cols,
      new Set(instance.walls),
      instance.hole,
      { ball: instance.ball, blocks: instance.blocks },
    );
    return {
      solution: { optimalMoves: instance.optimalMoves, optimalPath: path ?? [] },
      note: `Optimal is ${instance.optimalMoves} moves; you played ${submission?.moves.length ?? 0}.`,
    };
  },
};
