/**
 * Pure play helpers for the door_key interactive renderer (7c). No React — the
 * key→direction mapping, the probe-response→view reducer (which DEFENSIVELY
 * unions discovered walls so a bumped wall never disappears), and the move
 * classifier that makes block-vs-reset legible. All unit-tested.
 */
import type { DoorKeyClientView } from "@codeapt/shared";

/** Arrow keys AND WASD → a server direction (0=up 1=down 2=left 3=right), or
 * null for any other key. Case-insensitive. */
export function keyToDir(key: string): number | null {
  switch (key.toLowerCase()) {
    case "arrowup":
    case "w":
      return 0;
    case "arrowdown":
    case "s":
      return 1;
    case "arrowleft":
    case "a":
      return 2;
    case "arrowright":
    case "d":
      return 3;
    default:
      return null;
  }
}

/** One cell step in a direction, or null off-grid. */
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

/**
 * Fold a fresh server view onto the previous one. The server already accumulates
 * `bumped`, but we UNION it here so that even if a view ever omitted a wall the
 * client discovered, it stays on the board — a wall once bumped never vanishes.
 */
export function reduceView(
  prev: DoorKeyClientView | null,
  next: DoorKeyClientView,
): DoorKeyClientView {
  if (!prev) return next;
  const bumped = Array.from(new Set([...prev.bumped, ...next.bumped]));
  return { ...next, bumped };
}

export type MoveKind = "move" | "reset" | "block" | "edge" | "none";

/**
 * Classify what a probe did, from the intended direction and the before/after
 * positions — so the UI can say "moved", "bumped a wall (stayed)", "bumped a
 * wall (back to start)", or "edge". Uses the intended target rather than delta-
 * guessing, so it stays correct even when re-bumping an already-known wall.
 */
export function classifyMove(
  prevPos: number,
  nextPos: number,
  dir: number,
  rows: number,
  cols: number,
  startCell: number,
): MoveKind {
  const target = stepCell(prevPos, dir, rows, cols);
  if (target === null) return nextPos === prevPos ? "edge" : "move";
  if (nextPos === target) return "move";
  // Didn't reach the target → a wall. Reset sends you home; block keeps you put.
  if (nextPos === startCell && prevPos !== startCell) return "reset";
  return "block";
}
