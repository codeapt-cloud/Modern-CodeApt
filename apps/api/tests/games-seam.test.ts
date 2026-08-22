/**
 * Pure game-seam unit tests — ZERO I/O (they import only @codeapt/shared).
 * Hosted in the api package because @codeapt/shared has no test runner of its
 * own; nothing here touches Mongo, express, or the network.
 *
 * Covers: PRNG determinism, the adaptive ladder reducer (all outcomes + caps at
 * both ends), the `_probe` generate/score round-trip, and the structural proof
 * that a client view omits the solution.
 */
import {
  DEFAULT_LADDER_CONFIG,
  GAME_DIFFICULTY_MARKS,
  GAME_REGISTRY,
  GEO_SUDO_SYMBOLS,
  GameDifficulty,
  GameKey,
  applyLadderOutcome,
  createRng,
  geoSudoModule,
  inductiveReasoningModule,
  motionChallengeModule,
  probeModule,
  rngShuffle,
  solveSwitch,
  switchChallengeModule,
  conformsToInductiveRule,
  INDUCTIVE_RULE_IDS,
  type GeoSymbol,
  type ProbeClientView,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

describe("PRNG determinism", () => {
  it("same seed → identical sequence; different seeds → different", () => {
    const a1 = Array.from({ length: 8 }, createRng("seed-a"));
    const a2 = Array.from({ length: 8 }, createRng("seed-a"));
    const b = Array.from({ length: 8 }, createRng("seed-b"));
    expect(a1).toEqual(a2);
    expect(a1).not.toEqual(b);
    // Values are in [0, 1).
    for (const v of a1) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("rngShuffle is a deterministic permutation of its input", () => {
    const input = [1, 2, 3, 4, 5, 6];
    const s1 = rngShuffle(createRng("x"), input);
    const s2 = rngShuffle(createRng("x"), input);
    expect(s1).toEqual(s2);
    expect([...s1].sort((a, b) => a - b)).toEqual(input); // same multiset
    expect(input).toEqual([1, 2, 3, 4, 5, 6]); // input not mutated
  });
});

describe("adaptive ladder reducer", () => {
  const marks = GAME_DIFFICULTY_MARKS;

  it("correct steps up and awards marks for the difficulty answered; caps at hard", () => {
    const e = applyLadderOutcome({ difficulty: GameDifficulty.EASY }, "correct");
    expect(e).toEqual({
      next: { difficulty: GameDifficulty.MODERATE },
      marksAwarded: marks.easy,
    });
    const m = applyLadderOutcome(
      { difficulty: GameDifficulty.MODERATE },
      "correct",
    );
    expect(m.next.difficulty).toBe(GameDifficulty.HARD);
    expect(m.marksAwarded).toBe(marks.moderate);
    const h = applyLadderOutcome({ difficulty: GameDifficulty.HARD }, "correct");
    expect(h.next.difficulty).toBe(GameDifficulty.HARD); // capped
    expect(h.marksAwarded).toBe(marks.hard);
  });

  it("wrong steps down (0 marks); floors at easy", () => {
    const h = applyLadderOutcome({ difficulty: GameDifficulty.HARD }, "wrong");
    expect(h).toEqual({
      next: { difficulty: GameDifficulty.MODERATE },
      marksAwarded: 0,
    });
    const e = applyLadderOutcome({ difficulty: GameDifficulty.EASY }, "wrong");
    expect(e.next.difficulty).toBe(GameDifficulty.EASY); // floored
    expect(e.marksAwarded).toBe(0);
  });

  it("skipped does NOT move the ladder by default (0 marks), but can be configured to step down", () => {
    const stay = applyLadderOutcome(
      { difficulty: GameDifficulty.MODERATE },
      "skipped",
      DEFAULT_LADDER_CONFIG,
    );
    expect(stay).toEqual({
      next: { difficulty: GameDifficulty.MODERATE },
      marksAwarded: 0,
    });
    const down = applyLadderOutcome(
      { difficulty: GameDifficulty.MODERATE },
      "skipped",
      { skipStepsDown: true },
    );
    expect(down.next.difficulty).toBe(GameDifficulty.EASY);
    expect(down.marksAwarded).toBe(0);
  });

  it("expired never moves and never awards", () => {
    const x = applyLadderOutcome(
      { difficulty: GameDifficulty.HARD },
      "expired",
    );
    expect(x).toEqual({
      next: { difficulty: GameDifficulty.HARD },
      marksAwarded: 0,
    });
  });
});

describe("_probe generate/score round-trip", () => {
  it("is registered and dev-only", () => {
    const mod = GAME_REGISTRY[GameKey.PROBE];
    expect(mod).toBeDefined();
    expect(mod.devOnly).toBe(true);
  });

  it("generates 3/4/5 numbers by difficulty, deterministically", () => {
    const easy = probeModule.generate("s1", GameDifficulty.EASY);
    const moderate = probeModule.generate("s1", GameDifficulty.MODERATE);
    const hard = probeModule.generate("s1", GameDifficulty.HARD);
    expect(easy.numbers).toHaveLength(3);
    expect(moderate.numbers).toHaveLength(4);
    expect(hard.numbers).toHaveLength(5);
    // Deterministic: same seed+difficulty → identical instance.
    expect(probeModule.generate("s1", GameDifficulty.EASY)).toEqual(easy);
  });

  it("scores the correct ascending-index order, rejects a wrong order", () => {
    const inst = probeModule.generate("round-trip", GameDifficulty.HARD);
    expect(probeModule.score(inst, { order: inst.solution }).correct).toBe(true);
    expect(
      probeModule.score(inst, { order: [...inst.solution].reverse() }).correct,
    ).toBe(false);
  });

  it("ignores a client-supplied score field — correctness comes from the move only", () => {
    const inst = probeModule.generate("no-trust", GameDifficulty.EASY);
    const cheat = { order: inst.solution, score: 9999 } as unknown as {
      order: number[];
    };
    expect(probeModule.score(inst, cheat).correct).toBe(true);
  });
});

describe("client view omits the solution (structural)", () => {
  it("toClientView carries the numbers but NOT the solution", () => {
    const inst = probeModule.generate("view", GameDifficulty.MODERATE);
    const view: ProbeClientView = probeModule.toClientView(inst);
    expect(view.numbers).toEqual(inst.numbers);
    expect("solution" in view).toBe(false);
    expect(JSON.stringify(view)).not.toContain("solution");
    // Type-level: `view.solution` does not exist on ProbeClientView, so a leak
    // would be a COMPILE error (see games/types.ts NoSolution). Asserted at
    // runtime here as a belt-and-braces check.
  });
});

// ---------------------------------------------------------------------------
// Real games (Step 3): geo_sudo + switch_challenge
// ---------------------------------------------------------------------------

// --- Geo Sudo test-side verifiers (independent of the generator) ---

function candsAt(
  grid: (GeoSymbol | null)[][],
  r: number,
  c: number,
  symbols: readonly GeoSymbol[],
): GeoSymbol[] {
  const used = new Set<GeoSymbol>();
  const n = grid.length;
  for (let j = 0; j < n; j += 1) if (grid[r]![j]) used.add(grid[r]![j]!);
  for (let i = 0; i < n; i += 1) if (grid[i]![c]) used.add(grid[i]![c]!);
  return symbols.filter((s) => !used.has(s));
}

/** True iff the partial grid has SOME valid Latin completion (backtracking). */
function completable(
  grid: (GeoSymbol | null)[][],
  symbols: readonly GeoSymbol[],
): boolean {
  const n = grid.length;
  let er = -1;
  let ec = -1;
  outer: for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (grid[i]![j] == null) {
        er = i;
        ec = j;
        break outer;
      }
    }
  }
  if (er === -1) return true; // full
  for (const s of candsAt(grid, er, ec, symbols)) {
    grid[er]![ec] = s;
    if (completable(grid, symbols)) {
      grid[er]![ec] = null;
      return true;
    }
    grid[er]![ec] = null;
  }
  return false;
}

/** The set of symbols that can validly occupy the blank (rigorous uniqueness). */
function validBlankSymbols(
  grid: (GeoSymbol | null)[][],
  blank: { row: number; col: number },
  symbols: readonly GeoSymbol[],
): GeoSymbol[] {
  const out: GeoSymbol[] = [];
  for (const s of candsAt(grid, blank.row, blank.col, symbols)) {
    const work = grid.map((row) => [...row]);
    work[blank.row]![blank.col] = s;
    if (completable(work, symbols)) out.push(s);
  }
  return out;
}

function noRowColDupes(grid: (GeoSymbol | null)[][]): boolean {
  const n = grid.length;
  for (let i = 0; i < n; i += 1) {
    const row = grid[i]!.filter((v) => v != null);
    if (new Set(row).size !== row.length) return false;
  }
  for (let j = 0; j < n; j += 1) {
    const col: (GeoSymbol | null)[] = [];
    for (let i = 0; i < n; i += 1) col.push(grid[i]![j]);
    const filled = col.filter((v) => v != null);
    if (new Set(filled).size !== filled.length) return false;
  }
  return true;
}

describe("geo_sudo", () => {
  it("is deterministic for a given seed + difficulty", () => {
    const a = geoSudoModule.generate("s", "moderate");
    const b = geoSudoModule.generate("s", "moderate");
    expect(a).toEqual(b);
    expect(geoSudoModule.devOnly).toBe(false);
  });

  it("grid size is 4/5/6 by difficulty and the client view omits the solution", () => {
    expect(geoSudoModule.generate("x", "easy").size).toBe(4);
    expect(geoSudoModule.generate("x", "moderate").size).toBe(5);
    const hard = geoSudoModule.generate("x", "hard");
    expect(hard.size).toBe(6);
    const view = geoSudoModule.toClientView(hard);
    expect("solution" in view).toBe(false);
    expect(view.grid[hard.blank.row]![hard.blank.col]).toBeNull();
  });

  it("PROPERTY: the ? cell is uniquely solvable across many seeds and all sizes", () => {
    for (const [difficulty, size] of [
      ["easy", 4],
      ["moderate", 5],
      ["hard", 6],
    ] as const) {
      for (let s = 0; s < 25; s += 1) {
        const inst = geoSudoModule.generate(`prop-${size}-${s}`, difficulty);
        // Valid partial Latin square (no repeats in any row/column).
        expect(noRowColDupes(inst.grid)).toBe(true);
        // Exactly ONE symbol validly completes the blank, and it's the solution.
        const valid = validBlankSymbols(inst.grid, inst.blank, inst.symbols);
        expect(valid).toEqual([inst.solution]);
        // Scoring agrees.
        expect(geoSudoModule.score(inst, { symbol: inst.solution }).correct).toBe(true);
        expect(
          geoSudoModule.score(inst, { symbol: "not_a_symbol" }).correct,
        ).toBe(false);
      }
    }
  });

  it("submissionSchema rejects malformed / oversized payloads", () => {
    expect(geoSudoModule.submissionSchema.safeParse({ symbol: "circle" }).success).toBe(true);
    expect(geoSudoModule.submissionSchema.safeParse({ symbol: 123 }).success).toBe(false);
    expect(
      geoSudoModule.submissionSchema.safeParse({ symbol: "x".repeat(50) }).success,
    ).toBe(false);
    expect(geoSudoModule.submissionSchema.safeParse({}).success).toBe(false);
    // Sanity: the palette is a subset of the known symbols.
    const inst = geoSudoModule.generate("pal", "easy");
    for (const s of inst.symbols) expect(GEO_SUDO_SYMBOLS).toContain(s);
  });
});

describe("switch_challenge", () => {
  it("is deterministic and forbids skip by default", () => {
    expect(switchChallengeModule.generate("s", "easy")).toEqual(
      switchChallengeModule.generate("s", "easy"),
    );
    expect(switchChallengeModule.allowSkipDefault).toBe(false);
    expect(switchChallengeModule.devOnly).toBe(false);
  });

  it("easy (top-down): applying the switch to the input is the correct output", () => {
    const inst = switchChallengeModule.generate("e1", "easy");
    expect(inst.mode).toBe("easy");
    const view = switchChallengeModule.toClientView(inst);
    expect("solution" in view).toBe(false);
    const solved = solveSwitch(view);
    expect(switchChallengeModule.score(inst, { order: solved }).correct).toBe(true);
    // A wrong order fails.
    expect(
      switchChallengeModule.score(inst, { order: [...solved].reverse() }).correct,
    ).toBe(false);
  });

  it("moderate (BOTTOM-UP): recovers the input from the output + switch", () => {
    const inst = switchChallengeModule.generate("m1", "moderate");
    expect(inst.mode).toBe("moderate");
    const view = switchChallengeModule.toClientView(inst);
    expect(view.input).toBeNull(); // input is hidden — it's the answer
    const solved = solveSwitch(view);
    expect(switchChallengeModule.score(inst, { order: solved }).correct).toBe(true);
  });

  it("hard: covers both the 3-layer OUTPUT and the MIDDLE-switch case, scored correctly", () => {
    let sawOutput = false;
    let sawMiddle = false;
    for (let s = 0; s < 40 && !(sawOutput && sawMiddle); s += 1) {
      const inst = switchChallengeModule.generate(`h-${s}`, "hard");
      const view = switchChallengeModule.toClientView(inst);
      const solved = solveSwitch(view);
      expect(switchChallengeModule.score(inst, { order: solved }).correct).toBe(true);
      if (inst.mode === "hard_output") {
        sawOutput = true;
        expect(view.switches).toHaveLength(3);
      }
      if (inst.mode === "hard_middle") {
        sawMiddle = true;
        expect(view.switches).toHaveLength(2); // s1 + s3; s2 hidden
        expect(view.output).not.toBeNull();
      }
    }
    expect(sawOutput).toBe(true);
    expect(sawMiddle).toBe(true);
  });

  it("submissionSchema rejects malformed / oversized permutations", () => {
    expect(
      switchChallengeModule.submissionSchema.safeParse({ order: [0, 1, 2, 3] }).success,
    ).toBe(true);
    expect(switchChallengeModule.submissionSchema.safeParse({ order: "x" }).success).toBe(false);
    expect(
      switchChallengeModule.submissionSchema.safeParse({
        order: [0, 1, 2, 3, 4, 5, 6],
      }).success,
    ).toBe(false); // too long
    expect(
      switchChallengeModule.submissionSchema.safeParse({ order: [0, 99] }).success,
    ).toBe(false); // value out of range
  });
});

describe("geo_sudo deduction depth (difficulty = size + depth)", () => {
  // Independent (test-side) depth measure: naked-single rounds until `?` forced.
  function depthOf(
    grid: (GeoSymbol | null)[][],
    blank: { row: number; col: number },
    symbols: readonly GeoSymbol[],
  ): number | null {
    const n = grid.length;
    const work = grid.map((row) => [...row]);
    let filled = 0;
    for (;;) {
      const bc = candsAt(work, blank.row, blank.col, symbols);
      if (bc.length === 1) return filled;
      if (bc.length === 0) return null;
      const round: Array<[number, number, GeoSymbol]> = [];
      for (let i = 0; i < n; i += 1) {
        for (let j = 0; j < n; j += 1) {
          if (i === blank.row && j === blank.col) continue;
          if (work[i]![j] != null) continue;
          const c = candsAt(work, i, j, symbols);
          if (c.length === 1) round.push([i, j, c[0]!]);
        }
      }
      if (round.length === 0) return null;
      for (const [i, j, s] of round) if (work[i]![j] == null) { work[i]![j] = s; filled += 1; }
    }
  }

  it("PROPERTY: the depth floor holds per tier across many seeds (with distribution)", () => {
    const floors = { easy: 0, moderate: 2, hard: 4 } as const;
    for (const difficulty of ["easy", "moderate", "hard"] as const) {
      const dist: Record<number, number> = {};
      const N = 40;
      for (let s = 0; s < N; s += 1) {
        const inst = geoSudoModule.generate(`depth-${difficulty}-${s}`, difficulty);
        // Independent recompute must equal the stored depth (not fabricated).
        const recomputed = depthOf(inst.grid, inst.blank, inst.symbols);
        expect(recomputed).toBe(inst.deductionDepth);
        // Floor (easy is exactly 0 — "forced immediately").
        if (difficulty === "easy") expect(inst.deductionDepth).toBe(0);
        else expect(inst.deductionDepth).toBeGreaterThanOrEqual(floors[difficulty]);
        dist[inst.deductionDepth] = (dist[inst.deductionDepth] ?? 0) + 1;
      }
      console.log(`GEO DEPTH [${difficulty}] over ${N}:`, JSON.stringify(dist));
    }
  });
});

describe("switch_challenge hard-mode split", () => {
  it("hard_output vs hard_middle is ~50/50 over 200 seeds (not seed-biased)", () => {
    let out = 0;
    let mid = 0;
    const N = 200;
    for (let s = 0; s < N; s += 1) {
      const inst = switchChallengeModule.generate(`split-${s}`, "hard");
      if (inst.mode === "hard_output") out += 1;
      else if (inst.mode === "hard_middle") mid += 1;
    }
    console.log(`SWITCH HARD SPLIT over ${N}: output=${out} middle=${mid}`);
    expect(out + mid).toBe(N);
    expect(mid / N).toBeGreaterThan(0.35);
    expect(mid / N).toBeLessThan(0.65);
  });
});

describe("geo_sudo generation cost + fallback rate", () => {
  it("hard generate() does bounded work per call (measurement + deterministic guard)", () => {
    const times: number[] = [];
    for (let s = 0; s < 200; s += 1) {
      const t0 = performance.now();
      const inst = geoSudoModule.generate(`perf-${s}`, "hard");
      times.push(performance.now() - t0);
      // DETERMINISTIC bounded-work guard (can't flake, unlike a wall-clock
      // threshold competing with 68 files for CPU): every call found a windowed
      // puzzle within the MAX_RESEEDS loop — depth >= the hard floor — so
      // generate() never ran unbounded. The timing below is measurement only.
      expect(inst.deductionDepth).toBeGreaterThanOrEqual(4);
    }
    times.sort((a, b) => a - b);
    const p = (q: number): number => times[Math.floor((times.length - 1) * q)]!;
    console.log(
      `GEO GEN hard ms: p50=${p(0.5).toFixed(2)} p95=${p(0.95).toFixed(2)} max=${times[times.length - 1]!.toFixed(2)}`,
    );
  });

  it("the below-floor fallback effectively never fires (rate per tier over 300 seeds)", () => {
    const floors = { easy: 0, moderate: 2, hard: 4 } as const;
    for (const difficulty of ["easy", "moderate", "hard"] as const) {
      let below = 0;
      const N = 300;
      for (let s = 0; s < N; s += 1) {
        const inst = geoSudoModule.generate(`fb-${difficulty}-${s}`, difficulty);
        if (inst.deductionDepth < floors[difficulty]) below += 1;
      }
      console.log(`GEO FALLBACK [${difficulty}] below-floor: ${below}/${N}`);
      expect(below).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Step 4 — Motion Challenge + Inductive Reasoning
// ---------------------------------------------------------------------------

/** Independent (test-side) BFS optimal-move count over the board fields. */
function motionOptimal(inst: {
  rows: number;
  cols: number;
  walls: number[];
  blocks: number[];
  ball: number;
  hole: number;
}): number | null {
  const { rows, cols, hole } = inst;
  const wallSet = new Set(inst.walls);
  const step = (cell: number, dir: number): number | null => {
    const r = Math.floor(cell / cols);
    const c = cell % cols;
    const nr = dir === 0 ? r - 1 : dir === 1 ? r + 1 : r;
    const nc = dir === 2 ? c - 1 : dir === 3 ? c + 1 : c;
    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) return null;
    return nr * cols + nc;
  };
  const key = (ball: number, blocks: number[]): string =>
    `${ball}|${[...blocks].sort((a, b) => a - b).join(",")}`;
  let frontier = [{ ball: inst.ball, blocks: [...inst.blocks] }];
  if (inst.ball === hole) return 0;
  const seen = new Set([key(inst.ball, inst.blocks)]);
  let depth = 0;
  let explored = 0;
  while (frontier.length) {
    depth += 1;
    const next: Array<{ ball: number; blocks: number[] }> = [];
    for (const st of frontier) {
      const occ = new Set<number>([st.ball, ...st.blocks]);
      const pieces = [{ id: 0, pos: st.ball }, ...st.blocks.map((pos, i) => ({ id: i + 1, pos }))];
      for (const p of pieces) {
        for (let dir = 0; dir < 4; dir += 1) {
          const t = step(p.pos, dir);
          if (t == null || wallSet.has(t) || occ.has(t)) continue;
          const nb = p.id === 0 ? st.blocks : st.blocks.map((b, i) => (i === p.id - 1 ? t : b));
          const ball = p.id === 0 ? t : st.ball;
          const k = key(ball, nb);
          if (seen.has(k)) continue;
          if (++explored > 300000) return null;
          seen.add(k);
          if (ball === hole) return depth;
          next.push({ ball, blocks: nb });
        }
      }
    }
    frontier = next;
  }
  return null;
}

describe("motion_challenge", () => {
  it("is deterministic and the client view omits optimalMoves/solution", () => {
    const a = motionChallengeModule.generate("m", "moderate");
    expect(motionChallengeModule.generate("m", "moderate")).toEqual(a);
    const view = motionChallengeModule.toClientView(a);
    expect("solution" in view).toBe(false);
    expect("optimalMoves" in view).toBe(false);
    expect(motionChallengeModule.devOnly).toBe(false);
  });

  it("PROPERTY: every board is solvable and the stored optimal matches an independent BFS", () => {
    for (const difficulty of ["easy", "moderate", "hard"] as const) {
      for (let s = 0; s < 25; s += 1) {
        const inst = motionChallengeModule.generate(`solv-${difficulty}-${s}`, difficulty);
        const opt = motionOptimal(inst);
        expect(opt).not.toBeNull(); // solvable
        expect(inst.optimalMoves).toBe(opt);
      }
    }
  });

  it("scores a genuine solve correct and an illegal move sequence wrong (no crash)", () => {
    const inst = motionChallengeModule.generate("mc-score", "easy");
    // Illegal: move a non-existent piece.
    expect(
      motionChallengeModule.score(inst, { moves: [{ piece: 99, dir: 0 }] }).correct,
    ).toBe(false);
    // Illegal: walk the ball off the board repeatedly — never throws.
    expect(
      motionChallengeModule.score(inst, {
        moves: Array.from({ length: 8 }, () => ({ piece: 0, dir: 0 })),
      }).correct,
    ).toBe(false);
  });

  it("submissionSchema rejects an oversized move array", () => {
    const ok = motionChallengeModule.submissionSchema.safeParse({
      moves: [{ piece: 0, dir: 1 }],
    });
    expect(ok.success).toBe(true);
    const tooMany = motionChallengeModule.submissionSchema.safeParse({
      moves: Array.from({ length: 201 }, () => ({ piece: 0, dir: 0 })),
    });
    expect(tooMany.success).toBe(false);
    expect(
      motionChallengeModule.submissionSchema.safeParse({ moves: [{ piece: 0, dir: 9 }] }).success,
    ).toBe(false); // dir out of range
  });
});

describe("inductive_reasoning", () => {
  it("is deterministic and the client view omits rule + solution", () => {
    const a = inductiveReasoningModule.generate("i", "easy");
    expect(inductiveReasoningModule.generate("i", "easy")).toEqual(a);
    const view = inductiveReasoningModule.toClientView(a);
    expect("solution" in view).toBe(false);
    expect("rule" in view).toBe(false);
    expect(view.options).toHaveLength(4);
    expect(view.left).toHaveLength(2);
  });

  it("PROPERTY: exactly two options conform, and stored solution is exactly those two, across all families", () => {
    const seen = new Set<string>();
    for (const difficulty of ["easy", "moderate", "hard"] as const) {
      for (let s = 0; s < 120; s += 1) {
        const inst = inductiveReasoningModule.generate(`ind-${difficulty}-${s}`, difficulty);
        seen.add(inst.rule);
        // Independently evaluate the rule predicate on all four options.
        const conform = inst.options
          .map((g, i) => (conformsToInductiveRule(inst.rule, g) ? i : -1))
          .filter((i) => i >= 0);
        expect(conform).toHaveLength(2);
        expect([...inst.solution].sort()).toEqual(conform.sort());
        // Both left examples conform too.
        for (const g of inst.left) expect(conformsToInductiveRule(inst.rule, g)).toBe(true);
      }
    }
    // Every implemented family was exercised.
    for (const id of INDUCTIVE_RULE_IDS) expect(seen.has(id)).toBe(true);
  });

  it("set comparison is order-insensitive; a one-index submission is wrong (not an error)", () => {
    const inst = inductiveReasoningModule.generate("ind-set", "easy");
    const [a, b] = inst.solution as [number, number];
    expect(inductiveReasoningModule.score(inst, { selected: [a, b] }).correct).toBe(true);
    expect(inductiveReasoningModule.score(inst, { selected: [b, a] }).correct).toBe(true); // order-free
    expect(inductiveReasoningModule.score(inst, { selected: [a] }).correct).toBe(false); // one index
    expect(inductiveReasoningModule.score(inst, { selected: [] }).correct).toBe(false);
    expect(inductiveReasoningModule.score(inst, { selected: [a, a] }).correct).toBe(false); // dup
  });

  it("submissionSchema rejects out-of-range / oversized selections", () => {
    expect(inductiveReasoningModule.submissionSchema.safeParse({ selected: [0, 3] }).success).toBe(true);
    expect(inductiveReasoningModule.submissionSchema.safeParse({ selected: [0, 5] }).success).toBe(false);
    expect(
      inductiveReasoningModule.submissionSchema.safeParse({ selected: [0, 1, 2, 3, 0] }).success,
    ).toBe(false);
  });
});

// --- Motion path solver over the CLIENT VIEW only (a real player's knowledge) --
function solveMotionView(view: {
  rows: number;
  cols: number;
  walls: number[];
  blocks: number[];
  ball: number;
  hole: number;
}): Array<{ piece: number; dir: number }> {
  const { rows, cols, hole } = view;
  const wallSet = new Set(view.walls);
  const step = (cell: number, dir: number): number | null => {
    const r = Math.floor(cell / cols);
    const c = cell % cols;
    const nr = dir === 0 ? r - 1 : dir === 1 ? r + 1 : r;
    const nc = dir === 2 ? c - 1 : dir === 3 ? c + 1 : c;
    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) return null;
    return nr * cols + nc;
  };
  const key = (ball: number, blocks: number[]): string =>
    `${ball}|${[...blocks].sort((a, b) => a - b).join(",")}`;
  if (view.ball === hole) return [];
  const seen = new Set([key(view.ball, view.blocks)]);
  const parent = new Map<string, { prev: string; move: { piece: number; dir: number } }>();
  let frontier = [{ ball: view.ball, blocks: [...view.blocks] }];
  while (frontier.length) {
    const next: Array<{ ball: number; blocks: number[] }> = [];
    for (const st of frontier) {
      const occ = new Set<number>([st.ball, ...st.blocks]);
      const pieces = [{ id: 0, pos: st.ball }, ...st.blocks.map((pos, i) => ({ id: i + 1, pos }))];
      for (const p of pieces) {
        for (let dir = 0; dir < 4; dir += 1) {
          const t = step(p.pos, dir);
          if (t == null || wallSet.has(t) || occ.has(t)) continue;
          const nb = p.id === 0 ? st.blocks : st.blocks.map((b, i) => (i === p.id - 1 ? t : b));
          const ball = p.id === 0 ? t : st.ball;
          const k = key(ball, nb);
          if (seen.has(k)) continue;
          seen.add(k);
          parent.set(k, { prev: key(st.ball, st.blocks), move: { piece: p.id, dir } });
          if (ball === hole) {
            const path: Array<{ piece: number; dir: number }> = [];
            let cur = k;
            while (parent.has(cur)) { const e = parent.get(cur)!; path.push(e.move); cur = e.prev; }
            return path.reverse();
          }
          next.push({ ball, blocks: nb });
        }
      }
    }
    frontier = next;
  }
  return [];
}

describe("motion_challenge generation reliability (measured, pinned)", () => {
  it("reports floor-miss and trivialBoard rates per tier", () => {
    const floors = { easy: 2, moderate: 4, hard: 6 } as const;
    for (const difficulty of ["easy", "moderate", "hard"] as const) {
      let floorMiss = 0;
      let trivial = 0;
      const N = 300;
      for (let s = 0; s < N; s += 1) {
        const inst = motionChallengeModule.generate(`rel-${difficulty}-${s}`, difficulty);
        if (inst.optimalMoves < floors[difficulty]) floorMiss += 1;
        if (inst.walls.length === 0 && inst.blocks.length === 0) trivial += 1;
      }
      console.log(`MOTION REL [${difficulty}] over ${N}: floorMiss=${floorMiss} trivial=${trivial}`);
      expect(trivial).toBe(0);
      expect(floorMiss).toBe(0);
    }
  });
});

describe("view-only solvers (a real player's knowledge)", () => {
  it("motion: solvable from the CLIENT VIEW alone (BFS over the visible board)", () => {
    for (const difficulty of ["easy", "moderate", "hard"] as const) {
      for (let s = 0; s < 15; s += 1) {
        const inst = motionChallengeModule.generate(`vsolve-${difficulty}-${s}`, difficulty);
        const view = motionChallengeModule.toClientView(inst);
        const moves = solveMotionView(view); // uses only what the client can see
        expect(moves.length).toBeGreaterThan(0);
        expect(motionChallengeModule.score(inst, { moves }).correct).toBe(true);
      }
    }
  });

  it("inductive: inferring the rule from the two LEFT examples — ambiguity report + view-only correctness", () => {
    let unambiguous = 0;
    let ambiguous = 0;
    let total = 0;
    for (const difficulty of ["easy", "moderate", "hard"] as const) {
      for (let s = 0; s < 80; s += 1) {
        const inst = inductiveReasoningModule.generate(`infer-${difficulty}-${s}`, difficulty);
        const view = inductiveReasoningModule.toClientView(inst);
        total += 1;
        // A player's inference: which families explain BOTH left examples?
        const candidates = INDUCTIVE_RULE_IDS.filter((id) =>
          view.left.every((g) => conformsToInductiveRule(id, g)),
        );
        // The option set each candidate rule would pick.
        const sets = candidates.map((id) =>
          JSON.stringify(
            view.options.map((g, i) => (conformsToInductiveRule(id, g) ? i : -1)).filter((i) => i >= 0),
          ),
        );
        const distinct = new Set(sets);
        if (distinct.size === 1) {
          unambiguous += 1;
          // A view-only player picks the agreed set — it must be the real answer.
          const picked = JSON.parse([...distinct][0]!) as number[];
          expect([...inst.solution].sort()).toEqual([...picked].sort());
          expect(inductiveReasoningModule.score(inst, { selected: picked }).correct).toBe(true);
        } else {
          ambiguous += 1;
        }
      }
    }
    console.log(
      `INDUCTIVE INFERENCE over ${total}: unambiguous=${unambiguous} ambiguous=${ambiguous} (${((ambiguous / total) * 100).toFixed(1)}% ambiguous)`,
    );
    // After the generation-time disambiguation pass, every item is uniquely
    // inferable from its two examples — pin it so a future change can't regress.
    expect(ambiguous).toBe(0);
  });

  // The disambiguation pass reseeds any item another family also explains, so a
  // fair concern is that it (a) drops to the hand-built fallback under load, or
  // (b) skews the family mix by systematically rejecting the overlap-prone
  // families. Measured p50/p95/max latency is sub-ms on every tier (reported to
  // console); here we pin the two structural guarantees.
  it("inductive disambiguation never starves generation or collapses variety", () => {
    for (const difficulty of ["moderate", "hard"] as const) {
      const freq = new Map<string, number>();
      let fallback = 0;
      const N = 300;
      for (let s = 0; s < N; s += 1) {
        const inst = inductiveReasoningModule.generate(`skew-${difficulty}-${s}`, difficulty);
        freq.set(inst.rule, (freq.get(inst.rule) ?? 0) + 1);
        // The hand-built fallback always emits "rows_1_3_equal", an id no real
        // moderate/hard pass can produce — so its appearance here IS a fallback.
        if (inst.rule === "rows_1_3_equal") fallback += 1;
      }
      const top = Math.max(...freq.values());
      console.log(
        `INDUCTIVE MIX [${difficulty}] over ${N}: fallback=${fallback} topFamily=${((100 * top) / N).toFixed(1)}% families=${freq.size}`,
      );
      // The below-floor fallback must never fire — it would silently collapse
      // difficulty to the easiest single-row rule.
      expect(fallback).toBe(0);
      // No single family may dominate; disambiguation must not funnel a tier
      // onto one rule. (Uniform over 4–5 families is 20–25%; observed max ~30%.)
      expect(top).toBeLessThan(N * 0.5);
    }
  });
});
