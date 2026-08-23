/**
 * motion_challenge — slide the ball to the hole past fixed silver walls and
 * movable blocks. Submission `{ moves: [{piece, dir}] }`. Click a piece to
 * select it, then click an orthogonally-adjacent cell (or use the arrow pad) to
 * slide it one cell. A visible move count, Undo, and Submit are provided.
 * Optimality is NOT correctness (reaching the hole is) — the count is shown only
 * because practice-mode explain reports optimal vs actual.
 */
import type { MotionClientView } from "@codeapt/shared";
import { useMemo, useState } from "react";

import { cn } from "../../../lib/cn.js";
import {
  applyMove,
  pieceAt,
  replay,
  stepCell,
  type MotionBoard,
  type MotionMove,
} from "../../../lib/motion-moves.js";
import { Button } from "../../ui/button.js";
import type { GameRendererProps } from "../renderer-contract.js";

const ARROWS: { dir: number; label: string }[] = [
  { dir: 0, label: "↑" },
  { dir: 2, label: "←" },
  { dir: 3, label: "→" },
  { dir: 1, label: "↓" },
];

export function MotionRenderer({
  view,
  locked,
  onSubmit,
}: GameRendererProps): JSX.Element {
  const v = view as MotionClientView;
  const board: MotionBoard = useMemo(
    () => ({
      rows: v.rows,
      cols: v.cols,
      walls: v.walls,
      ball: v.ball,
      blocks: v.blocks,
      hole: v.hole,
    }),
    [v],
  );
  const [moves, setMoves] = useState<MotionMove[]>([]);
  const [selected, setSelected] = useState<number | null>(0); // ball selected

  const state = useMemo(
    () => replay(board, moves) ?? { ball: board.ball, blocks: [...board.blocks] },
    [board, moves],
  );

  const move = (piece: number, dir: number): void => {
    if (locked) return;
    if (applyMove(board, state, { piece, dir })) {
      setMoves((prev) => [...prev, { piece, dir }]);
    }
  };

  const onCellClick = (cell: number): void => {
    if (locked) return;
    const occupant = pieceAt(state, cell);
    if (occupant !== null) {
      setSelected(occupant); // select a piece (ball or block)
      return;
    }
    // Empty cell: if it's adjacent to the selected piece, slide there.
    if (selected === null) return;
    const pos = selected === 0 ? state.ball : state.blocks[selected - 1];
    if (pos === undefined) return;
    for (let dir = 0; dir < 4; dir += 1) {
      if (stepCell(pos, dir, board.rows, board.cols) === cell) {
        move(selected, dir);
        return;
      }
    }
  };

  const solved = state.ball === board.hole;

  return (
    <div className="flex flex-col items-center gap-5">
      <p className="text-sm text-ink-muted">
        Slide the ball to the hole. Click a piece, then an adjacent empty cell (or
        use the arrows).
      </p>

      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${v.cols}, minmax(0, 1fr))`, width: "min(100%, 22rem)" }}
      >
        {Array.from({ length: v.rows * v.cols }).map((_, cell) => {
          const isWall = v.walls.includes(cell);
          const isHole = cell === v.hole;
          const occupant = pieceAt(state, cell);
          const isBall = occupant === 0;
          const isBlock = occupant !== null && occupant > 0;
          const isSelected = occupant !== null && occupant === selected;
          return (
            <button
              key={cell}
              type="button"
              disabled={locked || isWall}
              onClick={() => onCellClick(cell)}
              className={cn(
                "flex aspect-square items-center justify-center rounded-md border text-lg",
                isWall && "border-subtle bg-surface-sunken",
                !isWall && "border-subtle bg-surface-base hover:border-primary/40",
                isSelected && "ring-2 ring-primary",
              )}
            >
              {isBall ? (
                <span className="h-5 w-5 rounded-full bg-primary" />
              ) : isBlock ? (
                <span className="h-5 w-5 rounded bg-ink/60" />
              ) : isHole ? (
                <span className="h-5 w-5 rounded-full border-2 border-dashed border-ink-muted" />
              ) : isWall ? (
                <span className="text-ink-muted">▩</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Arrow pad for the selected piece. */}
      <div className="grid grid-cols-3 gap-1" style={{ width: "8rem" }}>
        {ARROWS.map((a, i) => (
          <div
            key={a.dir}
            className={cn(i === 0 && "col-start-2", i === 3 && "col-start-2")}
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={locked || selected === null}
              onClick={() => selected !== null && move(selected, a.dir)}
              aria-label={`Move ${["up", "down", "left", "right"][a.dir]}`}
            >
              {a.label}
            </Button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm text-ink-muted">Moves: {moves.length}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={locked || moves.length === 0}
          onClick={() => setMoves((prev) => prev.slice(0, -1))}
        >
          Undo
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={locked || moves.length === 0}
          onClick={() => onSubmit({ moves })}
        >
          {solved ? "Submit solution ✓" : "Submit"}
        </Button>
      </div>
    </div>
  );
}
