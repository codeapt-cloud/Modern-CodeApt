/**
 * Pure logic for the door_key interactive renderer (7c): the key→direction
 * mapping, the probe-response→view reducer (discovered walls accumulate and
 * never vanish), and the block-vs-reset move classifier. Plus the shell's
 * probe-gating predicate. The visual layer is not covered.
 */
import type { DoorKeyClientView } from "@codeapt/shared";
import { GameKey } from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import {
  classifyMove,
  keyToDir,
  reduceView,
} from "../src/lib/door-key-play.js";
import { probeFor } from "../src/lib/game-runner.js";

function dkView(over: Partial<DoorKeyClientView> = {}): DoorKeyClientView {
  return {
    kind: GameKey.DOOR_KEY,
    rows: 4,
    cols: 4,
    pos: 0,
    door: 15,
    keys: [{ cell: 5, collected: false }],
    bumped: [],
    movesUsed: 0,
    ...over,
  };
}

describe("keyToDir", () => {
  it("maps arrows and WASD (case-insensitive) to directions; else null", () => {
    expect(keyToDir("ArrowUp")).toBe(0);
    expect(keyToDir("w")).toBe(0);
    expect(keyToDir("ArrowDown")).toBe(1);
    expect(keyToDir("S")).toBe(1);
    expect(keyToDir("ArrowLeft")).toBe(2);
    expect(keyToDir("a")).toBe(2);
    expect(keyToDir("ArrowRight")).toBe(3);
    expect(keyToDir("D")).toBe(3);
    expect(keyToDir("Enter")).toBeNull();
    expect(keyToDir(" ")).toBeNull();
  });
});

describe("reduceView — discovered walls accumulate", () => {
  it("unions bumped so a wall once discovered never disappears", () => {
    const v1 = dkView({ pos: 1, bumped: [2] });
    const v2 = dkView({ pos: 1, bumped: [6] }); // a later view that OMITS wall 2
    const merged = reduceView(v1, v2);
    expect(merged.bumped.sort()).toEqual([2, 6]); // wall 2 is still visible
    expect(merged.pos).toBe(1); // other fields come from the fresh view
  });

  it("takes the fresh view wholesale when there is no previous", () => {
    const v = dkView({ pos: 4, bumped: [8] });
    expect(reduceView(null, v)).toEqual(v);
  });

  it("carries forward key-collection and position from the newest view", () => {
    const prev = dkView({ pos: 0, keys: [{ cell: 5, collected: false }] });
    const next = dkView({ pos: 5, keys: [{ cell: 5, collected: true }], bumped: [] });
    const merged = reduceView(prev, next);
    expect(merged.pos).toBe(5);
    expect(merged.keys[0].collected).toBe(true);
  });
});

describe("classifyMove — block vs reset legibility", () => {
  const rows = 4;
  const cols = 4;
  it("a successful step to the target is a move", () => {
    // from cell 0, dir down (1) → cell 4.
    expect(classifyMove(0, 4, 1, rows, cols, 0)).toBe("move");
  });
  it("stepping off the grid edge is an edge (stayed)", () => {
    // from cell 0, dir up (0) → off-grid; pos unchanged.
    expect(classifyMove(0, 0, 0, rows, cols, 0)).toBe("edge");
  });
  it("bumping a wall and staying is a block", () => {
    // from cell 1, dir right (3) → target 2 is a wall; pos stayed at 1.
    expect(classifyMove(1, 1, 3, rows, cols, 0)).toBe("block");
  });
  it("bumping a wall and returning to start is a reset", () => {
    // from cell 6, dir right → target blocked; server sent us home to 0.
    expect(classifyMove(6, 0, 3, rows, cols, 0)).toBe("reset");
  });
});

describe("shell probe gating (probeFor)", () => {
  const channel = async () => ({
    view: null,
    movesUsed: 0,
    resolved: false,
    outcome: null,
  });
  it("hands the probe channel to an interactive item only", () => {
    expect(probeFor({ interactive: true }, channel)).toBe(channel);
    expect(probeFor({ interactive: false }, channel)).toBeUndefined();
  });
});
