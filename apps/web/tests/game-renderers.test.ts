/**
 * Pure logic behind the one-shot renderers (Step 7b, Part B) — the motion
 * move-sequence builder, the switch mode → answer-shape mapping, and the bubble
 * ascending-order state machine. The visual layer is intentionally not covered.
 */
import { describe, expect, it } from "vitest";

import {
  applyMove,
  isSolved,
  pieceAt,
  replay,
  stepCell,
  type MotionBoard,
} from "../src/lib/motion-moves.js";

// A 3×3 board: ball at 0, hole at 2, one wall at 1, no blocks.
//   [ball][wall][hole]
//   [   ][   ][   ]
//   [   ][   ][   ]
const board: MotionBoard = {
  rows: 3,
  cols: 3,
  walls: [1],
  ball: 0,
  blocks: [4], // one movable block in the centre
  hole: 2,
};

describe("motion move-sequence building", () => {
  it("stepCell respects the grid edges", () => {
    expect(stepCell(0, 0, 3, 3)).toBeNull(); // up off the top
    expect(stepCell(0, 2, 3, 3)).toBeNull(); // left off the edge
    expect(stepCell(0, 1, 3, 3)).toBe(3); // down
    expect(stepCell(0, 3, 3, 3)).toBe(1); // right
  });

  it("rejects a move into a wall, off-board, or onto another piece", () => {
    const start = { ball: 0, blocks: [4] };
    // ball right → cell 1 is a wall.
    expect(applyMove(board, start, { piece: 0, dir: 3 })).toBeNull();
    // ball up → off-board.
    expect(applyMove(board, start, { piece: 0, dir: 0 })).toBeNull();
    // ball down → cell 3 (open) is fine.
    expect(applyMove(board, start, { piece: 0, dir: 1 })).toEqual({
      ball: 3,
      blocks: [4],
    });
    // move ball down then right onto the block at 4 → blocked.
    const afterDown = applyMove(board, start, { piece: 0, dir: 1 })!;
    expect(applyMove(board, afterDown, { piece: 0, dir: 3 })).toBeNull();
  });

  it("replay applies a legal sequence and reports the solved state", () => {
    // ball: 0 →(down)3 →(down)6 →(right)7 →(right)8 →(up)5 →(up)2 = hole.
    const moves = [
      { piece: 0, dir: 1 },
      { piece: 0, dir: 1 },
      { piece: 0, dir: 3 },
      { piece: 0, dir: 3 },
      { piece: 0, dir: 0 },
      { piece: 0, dir: 0 },
    ];
    const end = replay(board, moves);
    expect(end).not.toBeNull();
    expect(isSolved(board, end!)).toBe(true);
  });

  it("replay returns null if any move in the sequence is illegal", () => {
    expect(replay(board, [{ piece: 0, dir: 3 }])).toBeNull(); // straight into the wall
  });

  it("pieceAt identifies the ball (0), blocks (i+1), or empty (null)", () => {
    const st = { ball: 0, blocks: [4] };
    expect(pieceAt(st, 0)).toBe(0);
    expect(pieceAt(st, 4)).toBe(1);
    expect(pieceAt(st, 8)).toBeNull();
  });
});

describe("switch mode → answer shape", () => {
  // The renderer maps each ask to (a) what the answer represents and (b) whether
  // the tiles are POSITIONS (middle switch) or SYMBOLS. This mirrors that logic.
  const answerShape = (ask: "output" | "input" | "middle") => ({
    asPosition: ask === "middle",
    label: { output: "Output", input: "Input", middle: "Middle switch" }[ask],
  });

  it("output/input asks arrange SYMBOLS; middle asks arrange POSITIONS", () => {
    expect(answerShape("output")).toEqual({ asPosition: false, label: "Output" });
    expect(answerShape("input")).toEqual({ asPosition: false, label: "Input" });
    expect(answerShape("middle")).toEqual({
      asPosition: true,
      label: "Middle switch",
    });
  });
});

describe("bubble ascending-order state machine", () => {
  // Model the renderer's click reducer: click adds to order; re-click removes;
  // the third selection is the (auto-)commit.
  function click(order: number[], i: number, total: number): { order: number[]; commit: number[] | null } {
    if (order.includes(i)) return { order: order.filter((x) => x !== i), commit: null };
    const next = [...order, i];
    return { order: next, commit: next.length === total ? next : null };
  }

  it("builds an order, allows deselect, and commits on the third pick", () => {
    let s = click([], 2, 3); // click bubble 2 (index)
    expect(s.order).toEqual([2]);
    expect(s.commit).toBeNull();
    s = click(s.order, 0, 3); // then bubble 0
    expect(s.order).toEqual([2, 0]);
    expect(s.commit).toBeNull();
    // mis-click 0 again to deselect, then pick 1 and 0 → commit on the 3rd.
    s = click(s.order, 0, 3);
    expect(s.order).toEqual([2]);
    s = click(s.order, 1, 3);
    s = click(s.order, 0, 3);
    expect(s.commit).toEqual([2, 1, 0]);
  });
});
