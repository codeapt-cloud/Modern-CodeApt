/**
 * `door_key` — Maze with INVISIBLE walls. Collect the key(s), then reach the
 * door, in the fewest moves. Movement is up/down/left/right only. 3 minutes per
 * question.
 *
 * This is the seam's first INTERACTIVE game. The walls are HIDDEN: putting them
 * in the client view would make the maze trivially readable in devtools, and
 * omitting them means the client cannot simulate locally — so play is inherently
 * move-by-move. Each move is a `probe`: the server applies it against the hidden
 * instance, accumulates discovered state (position, keys held, walls bumped so
 * far, moves used) on the served entry, and returns only a REDACTED view. The
 * item resolves `correct` when the player stands on the door holding all keys;
 * it resolves `wrong` on the move cap or clock/item expiry.
 *
 * WALL-HIT is authored per GameSpec (`onWallHit`): the real exam RESETS the
 * player to the start on a bump; the practice portal simply BLOCKS (stay in
 * place). We default to `"block"` — `reset` is punishing enough that a college
 * should opt into it explicitly, not inherit it by accident.
 *
 * SCORING — correct = reached the door with all keys. Optimality is NOT part of
 * correctness (same decision as Motion, and even clearer here: with hidden walls
 * a first-time player CANNOT hit the perfect-information optimum). `explain`
 * reports optimal vs actual.
 */
import { z } from "zod";

import { GAME_MAX_PROBES_PER_ITEM } from "../constants.js";
import { GameDifficulty, GameKey } from "../enums.js";
import { createRng, rngShuffle } from "./prng.js";
import type {
  GameExplanation,
  GameModule,
  GameScoreResult,
  ProbeContract,
} from "./types.js";

export type WallHitMode = "reset" | "block";

export interface DoorKeyInstance {
  readonly kind: typeof GameKey.DOOR_KEY;
  readonly rows: number;
  readonly cols: number;
  readonly start: number;
  readonly door: number;
  readonly keys: number[]; // key cell indices; ALL must be collected
  readonly walls: number[]; // HIDDEN — never projected to the client
  readonly optimalMoves: number; // BFS over (pos, keys-collected bitmask)
  readonly solution: { readonly optimalMoves: number }; // revealed via explain only
}

/** REDACTED, per-move view — carries discovered state ONLY (never `walls`). */
export interface DoorKeyClientView {
  readonly kind: typeof GameKey.DOOR_KEY;
  readonly rows: number;
  readonly cols: number;
  readonly pos: number;
  readonly door: number;
  readonly keys: { readonly cell: number; readonly collected: boolean }[];
  readonly bumped: number[]; // walls DISCOVERED by bumping so far
  readonly movesUsed: number;
}

/** Per-item discovered state, persisted server-side (never client-reported). */
export interface DoorKeyProbeState {
  pos: number;
  collected: number[]; // indices into `keys` that are collected
  bumped: number[]; // discovered wall cells
  moves: number;
  dirs: number[]; // full move history (for replay / explain)
  onWallHit: WallHitMode;
}

export interface DoorKeyAction {
  dir: number; // 0=up 1=down 2=left 3=right
}

const doorKeySubmissionSchema = z.object({
  // The move history (a probe game stores its dirs here). Bounded by the same
  // per-item move cap the service enforces.
  dirs: z.array(z.number().int().min(0).max(3)).max(GAME_MAX_PROBES_PER_ITEM),
});
export type DoorKeySubmission = z.infer<typeof doorKeySubmissionSchema>;

const doorKeyActionSchema = z.object({
  dir: z.number().int().min(0).max(3),
});

interface Tier {
  readonly rows: number;
  readonly cols: number;
  readonly keys: number;
  readonly walls: number;
  readonly minOpt: number;
  readonly maxOpt: number;
}
const TIER: Record<GameDifficulty, Tier> = {
  [GameDifficulty.EASY]: { rows: 4, cols: 4, keys: 1, walls: 3, minOpt: 4, maxOpt: Infinity },
  [GameDifficulty.MODERATE]: { rows: 5, cols: 5, keys: 1, walls: 6, minOpt: 6, maxOpt: Infinity },
  [GameDifficulty.HARD]: { rows: 6, cols: 6, keys: 2, walls: 10, minOpt: 8, maxOpt: Infinity },
};

const MAX_RESEEDS = 40;

function step(cell: number, dir: number, rows: number, cols: number): number | null {
  const r = Math.floor(cell / cols);
  const c = cell % cols;
  const nr = dir === 0 ? r - 1 : dir === 1 ? r + 1 : r;
  const nc = dir === 2 ? c - 1 : dir === 3 ? c + 1 : c;
  if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) return null;
  return nr * cols + nc;
}

/**
 * BFS over (position, keys-collected bitmask) → optimal move count and one
 * optimal dir path, or null if the goal (door with ALL keys) is unreachable.
 * The single source of truth for solvability AND for `explain`'s optimal path.
 */
function bfsOptimal(inst: {
  rows: number;
  cols: number;
  start: number;
  door: number;
  keys: number[];
  walls: number[];
}): { moves: number; path: number[] } | null {
  const { rows, cols, start, door, keys, walls } = inst;
  const wallSet = new Set(walls);
  const keyBit = new Map<number, number>();
  keys.forEach((cell, i) => keyBit.set(cell, 1 << i));
  const full = (1 << keys.length) - 1;

  const startMask = keyBit.get(start) ?? 0;
  const encode = (pos: number, mask: number): number => pos * (full + 1) + mask;
  const startState = encode(start, startMask);
  if (start === door && startMask === full) return { moves: 0, path: [] };

  const seen = new Set<number>([startState]);
  const parent = new Map<number, { prev: number; dir: number }>();
  let frontier: Array<{ pos: number; mask: number }> = [
    { pos: start, mask: startMask },
  ];

  while (frontier.length) {
    const next: Array<{ pos: number; mask: number }> = [];
    for (const st of frontier) {
      for (let dir = 0; dir < 4; dir += 1) {
        const target = step(st.pos, dir, rows, cols);
        if (target == null || wallSet.has(target)) continue;
        const mask = st.mask | (keyBit.get(target) ?? 0);
        const code = encode(target, mask);
        if (seen.has(code)) continue;
        seen.add(code);
        parent.set(code, { prev: encode(st.pos, st.mask), dir });
        if (target === door && mask === full) {
          const path: number[] = [];
          let cur = code;
          while (parent.has(cur)) {
            const e = parent.get(cur)!;
            path.push(e.dir);
            cur = e.prev;
          }
          return { moves: path.length, path: path.reverse() };
        }
        next.push({ pos: target, mask });
      }
    }
    frontier = next;
  }
  return null;
}

function generateOnce(
  seed: string,
  tier: Tier,
): { inst: DoorKeyInstance; meetsFloor: boolean } | null {
  const { rows, cols, keys: keyCount, walls: wallCount } = tier;
  const rng = createRng(seed);
  const cells = rngShuffle(rng, Array.from({ length: rows * cols }, (_v, i) => i));
  let idx = 0;
  const start = cells[idx++]!;
  const door = cells[idx++]!;
  const keys: number[] = [];
  for (let i = 0; i < keyCount; i += 1) keys.push(cells[idx++]!);
  const walls: number[] = [];
  for (let i = 0; i < wallCount && idx < cells.length; i += 1) {
    walls.push(cells[idx++]!);
  }

  const solved = bfsOptimal({ rows, cols, start, door, keys, walls });
  if (solved == null) return null; // unsolvable with these walls
  const inst: DoorKeyInstance = {
    kind: GameKey.DOOR_KEY,
    rows,
    cols,
    start,
    door,
    keys,
    walls,
    optimalMoves: solved.moves,
    solution: { optimalMoves: solved.moves },
  };
  return {
    inst,
    meetsFloor: solved.moves >= tier.minOpt && solved.moves <= tier.maxOpt,
  };
}

/** A guaranteed-solvable board with NO walls, used only if every reseed failed
 * to produce a solvable maze. Its real (short) optimal is stored, so a fallback
 * is never silently mis-labelled as harder than it is. */
function trivialBoard(tier: Tier): DoorKeyInstance {
  const { rows, cols, keys: keyCount } = tier;
  const start = 0;
  const door = rows * cols - 1;
  const keys: number[] = [];
  for (let i = 0; i < keyCount; i += 1) keys.push(i + 1); // cells 1..k, all open
  const solved = bfsOptimal({ rows, cols, start, door, keys, walls: [] })!;
  return {
    kind: GameKey.DOOR_KEY,
    rows,
    cols,
    start,
    door,
    keys,
    walls: [],
    optimalMoves: solved.moves,
    solution: { optimalMoves: solved.moves },
  };
}

/** Apply ONE move to a state, returning the next state (never mutates input).
 * The single movement rule shared by the probe path and `score`. */
function walkOne(
  inst: DoorKeyInstance,
  state: DoorKeyProbeState,
  dir: number,
): DoorKeyProbeState {
  const target = step(state.pos, dir, inst.rows, inst.cols);
  const next: DoorKeyProbeState = {
    pos: state.pos,
    collected: [...state.collected],
    bumped: [...state.bumped],
    moves: state.moves + 1,
    dirs: [...state.dirs, dir],
    onWallHit: state.onWallHit,
  };
  if (target == null) return next; // boundary — no move, not a wall
  if (inst.walls.includes(target)) {
    if (!next.bumped.includes(target)) next.bumped.push(target); // discovered
    if (state.onWallHit === "reset") next.pos = inst.start;
    return next; // "block" leaves pos unchanged
  }
  next.pos = target;
  const keyIdx = inst.keys.indexOf(target);
  if (keyIdx >= 0 && !next.collected.includes(keyIdx)) next.collected.push(keyIdx);
  return next;
}

function renderView(
  inst: DoorKeyInstance,
  state: Pick<DoorKeyProbeState, "pos" | "collected" | "bumped" | "moves">,
): DoorKeyClientView {
  return {
    kind: inst.kind,
    rows: inst.rows,
    cols: inst.cols,
    pos: state.pos,
    door: inst.door,
    keys: inst.keys.map((cell, i) => ({
      cell,
      collected: state.collected.includes(i),
    })),
    bumped: [...state.bumped],
    movesUsed: state.moves,
  };
}

const doorKeyProbe: ProbeContract<
  DoorKeyInstance,
  DoorKeyProbeState,
  DoorKeyAction
> = {
  actionSchema: doorKeyActionSchema,

  init(inst, config): DoorKeyProbeState {
    const mode = config.onWallHit === "reset" ? "reset" : "block";
    const collected: number[] = [];
    // If (unusually) a key sits on the start cell, it's collected immediately.
    const startKey = inst.keys.indexOf(inst.start);
    if (startKey >= 0) collected.push(startKey);
    return { pos: inst.start, collected, bumped: [], moves: 0, dirs: [], onWallHit: mode };
  },

  apply(inst, state, action): DoorKeyProbeState {
    return walkOne(inst, state, action.dir);
  },

  resolved(inst, state): boolean {
    return state.pos === inst.door && state.collected.length === inst.keys.length;
  },

  view(inst, state): DoorKeyClientView {
    return renderView(inst, state);
  },

  movesUsed(state): number {
    return state.moves;
  },
};

export const doorKeyModule: GameModule<
  DoorKeyInstance,
  DoorKeyClientView,
  typeof doorKeySubmissionSchema,
  DoorKeyProbeState,
  DoorKeyAction
> = {
  key: GameKey.DOOR_KEY,
  displayName: "Door & Key",
  allowSkipDefault: true,
  defaultClockSeconds: 360,
  // 3 minutes per maze (transcript). Bounds the WHOLE exploration, not a probe.
  defaultItemSeconds: 180,
  devOnly: false,
  interactive: true,
  probe: doorKeyProbe,
  submissionSchema: doorKeySubmissionSchema,

  generate(seed: string, difficulty: GameDifficulty): DoorKeyInstance {
    const tier = TIER[difficulty];
    let best: DoorKeyInstance | null = null;
    for (let attempt = 0; attempt < MAX_RESEEDS; attempt += 1) {
      const r = generateOnce(`${seed}:door:${attempt}`, tier);
      if (r?.meetsFloor) return r.inst;
      if (r && (!best || r.inst.optimalMoves > best.optimalMoves)) best = r.inst;
    }
    return best ?? trivialBoard(tier);
  },

  toClientView(instance: DoorKeyInstance): DoorKeyClientView {
    // The INITIAL redacted view (pos = start, nothing discovered). Identical for
    // both wall-hit modes, so no config is needed here.
    return renderView(instance, {
      pos: instance.start,
      collected: instance.keys.indexOf(instance.start) >= 0 ? [0] : [],
      bumped: [],
      moves: 0,
    });
  },

  score(instance: DoorKeyInstance, submission: DoorKeySubmission): GameScoreResult {
    // Replay the recorded dirs in the safe "block" mode. (The answer endpoint is
    // closed for interactive games; this keeps the contract sound and testable.)
    let state = doorKeyProbe.init(instance, { onWallHit: "block" });
    for (const dir of submission.dirs ?? []) state = walkOne(instance, state, dir);
    return { correct: doorKeyProbe.resolved(instance, state) };
  },

  explain(
    instance: DoorKeyInstance,
    submission: DoorKeySubmission | null,
  ): GameExplanation {
    const solved = bfsOptimal(instance);
    return {
      solution: {
        optimalMoves: instance.optimalMoves,
        optimalPath: solved?.path ?? [],
        walls: instance.walls,
      },
      note: `Optimal is ${instance.optimalMoves} moves; you played ${submission?.dirs.length ?? 0}.`,
    };
  },
};
