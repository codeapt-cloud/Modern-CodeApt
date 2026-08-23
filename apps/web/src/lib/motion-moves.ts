/**
 * Pure move mechanics for the motion_challenge renderer — building a legal move
 * sequence on the client so the shell can submit `{ moves }`. Mirrors the
 * server's replay rules (a piece slides one cell; blocked by walls, other
 * pieces, or the edge). Kept here (no React) so the sequence-building is
 * unit-tested; the renderer is just the visual layer over this.
 */
export interface MotionBoard {
  readonly rows: number;
  readonly cols: number;
  readonly walls: number[];
  readonly ball: number;
  readonly blocks: number[];
  readonly hole: number;
}

export interface MotionState {
  readonly ball: number;
  readonly blocks: number[];
}

export interface MotionMove {
  readonly piece: number; // 0 = ball, i+1 = block[i]
  readonly dir: number; // 0=up 1=down 2=left 3=right
}

export function stepCell(
  cell: number,
  dir: number,
  rows: number,
  cols: number,
): number | null {
  const r = Math.floor(cell / cols);
  const c = cell % cols;
  const nr = dir === 0 ? r - 1 : dir === 1 ? r + 1 : r;
  const nc = dir === 2 ? c - 1 : dir === 3 ? c + 1 : c;
  if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) return null;
  return nr * cols + nc;
}

/** The piece occupying `cell` in `state`: 0 = ball, i+1 = block i, or null. */
export function pieceAt(state: MotionState, cell: number): number | null {
  if (state.ball === cell) return 0;
  const bi = state.blocks.indexOf(cell);
  return bi >= 0 ? bi + 1 : null;
}

/** Apply one move; returns the next state, or null if the move is illegal
 * (no such piece, off-board, into a wall, or into another piece). */
export function applyMove(
  board: MotionBoard,
  state: MotionState,
  move: MotionMove,
): MotionState | null {
  const pos = move.piece === 0 ? state.ball : state.blocks[move.piece - 1];
  if (pos === undefined) return null;
  const target = stepCell(pos, move.dir, board.rows, board.cols);
  if (target === null) return null;
  if (board.walls.includes(target)) return null;
  if (target === state.ball || state.blocks.includes(target)) return null;
  return move.piece === 0
    ? { ball: target, blocks: state.blocks }
    : {
        ball: state.ball,
        blocks: state.blocks.map((b, i) => (i === move.piece - 1 ? target : b)),
      };
}

/** Replay a whole sequence from the board's start; null if any move is illegal. */
export function replay(board: MotionBoard, moves: MotionMove[]): MotionState | null {
  let state: MotionState = { ball: board.ball, blocks: [...board.blocks] };
  for (const move of moves) {
    const next = applyMove(board, state, move);
    if (next === null) return null;
    state = next;
  }
  return state;
}

export function isSolved(board: MotionBoard, state: MotionState): boolean {
  return state.ball === board.hole;
}
