/**
 * door_key (7c) — the seam's only INTERACTIVE renderer. It drives the maze
 * move-by-move through the `probe` channel reserved in the contract since 7a
 * (never `onSubmit`), rendering ONLY what the redacted view discloses: position,
 * door, keys (collected vs not), and the walls bumped so far. The full wall set
 * is never in the view.
 *
 * Keyboard-only (arrows + WASD), one cell per keypress: held-key auto-repeat is
 * ignored (event.repeat) and probes are serialized on an in-flight guard, so a
 * held key can never burst probes — normal play sits far under the 600/min and
 * 500/item server limits. Mouse never moves the player.
 */
import type { DoorKeyClientView } from "@codeapt/shared";
import { DoorClosed, DoorOpen, KeyRound } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "../../../lib/cn.js";
import {
  classifyMove,
  keyToDir,
  reduceView,
  type MoveKind,
} from "../../../lib/door-key-play.js";
import type { GameProbeChannel, GameRendererProps } from "../renderer-contract.js";

const MESSAGE: Record<MoveKind, string> = {
  move: "",
  edge: "That's the edge of the grid — you can't go that way.",
  block: "You bumped a wall and stayed put.",
  reset: "You bumped a wall — sent back to the start!",
  none: "",
};

export function DoorKeyRenderer({
  view,
  locked,
  probe,
}: GameRendererProps): JSX.Element {
  const initial = view as DoorKeyClientView;
  const gridRef = useRef<HTMLDivElement>(null);
  const startCell = useRef(initial.pos).current;
  const inFlight = useRef(false);

  const [state, setState] = useState<DoorKeyClientView>(initial);
  const [message, setMessage] = useState("");

  // Autofocus the grid so arrows work immediately (also focusable by click).
  useEffect(() => {
    gridRef.current?.focus();
  }, []);

  const doMove = useCallback(
    async (dir: number): Promise<void> => {
      if (locked || inFlight.current || !probe) return;
      inFlight.current = true;
      try {
        const prev = state;
        const res = await (probe as GameProbeChannel)({ dir });
        const nextView = res.view as DoorKeyClientView | null;
        if (nextView) {
          const merged = reduceView(prev, nextView);
          setState(merged);
          const kind = classifyMove(
            prev.pos,
            merged.pos,
            dir,
            prev.rows,
            prev.cols,
            startCell,
          );
          const collectedNow =
            merged.keys.filter((k) => k.collected).length >
            prev.keys.filter((k) => k.collected).length;
          setMessage(
            collectedNow ? "You picked up a key!" : MESSAGE[kind],
          );
        }
      } finally {
        inFlight.current = false;
      }
    },
    [locked, probe, state, startCell],
  );

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.repeat) return; // ignore auto-repeat — one probe per physical press
    const dir = keyToDir(e.key);
    if (dir === null) return;
    e.preventDefault(); // arrows must not scroll the page
    void doMove(dir);
  };

  const keysTotal = state.keys.length;
  const keysGot = state.keys.filter((k) => k.collected).length;
  const allKeys = keysTotal === 0 || keysGot === keysTotal;
  const bumped = new Set(state.bumped);
  const keyByCell = new Map(state.keys.map((k) => [k.cell, k]));

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-sm text-ink-muted">
        Collect {keysTotal === 1 ? "the key" : "the keys"}, then reach the door.
        Walls are invisible — you find them by bumping into them.
      </p>

      <div
        ref={gridRef}
        role="application"
        aria-label="Maze — move with the arrow keys or WASD"
        tabIndex={locked ? -1 : 0}
        onKeyDown={onKeyDown}
        className={cn(
          "grid gap-1 rounded-xl p-2 outline-none",
          "focus-visible:ring-2 focus-visible:ring-primary",
          locked && "opacity-60",
        )}
        style={{
          gridTemplateColumns: `repeat(${state.cols}, minmax(0, 1fr))`,
          width: "min(100%, 24rem)",
        }}
      >
        {Array.from({ length: state.rows * state.cols }).map((_, cell) => {
          const isPlayer = cell === state.pos;
          const isDoor = cell === state.door;
          const isStart = cell === startCell;
          const isWall = bumped.has(cell);
          const key = keyByCell.get(cell);
          return (
            <div
              key={cell}
              className={cn(
                "relative flex aspect-square items-center justify-center rounded-md border text-sm",
                isWall
                  ? "border-error/40 bg-error/15"
                  : "border-subtle bg-surface-base",
              )}
            >
              {isStart && !isPlayer ? (
                <span className="absolute left-1 top-1 text-[9px] text-ink-muted">
                  start
                </span>
              ) : null}
              {isDoor ? (
                allKeys ? (
                  <DoorOpen className="h-5 w-5 text-primary" aria-hidden />
                ) : (
                  <DoorClosed className="h-5 w-5 text-ink-muted" aria-hidden />
                )
              ) : key ? (
                <KeyRound
                  className={cn(
                    "h-5 w-5",
                    key.collected ? "text-ink-muted/30" : "text-warning",
                  )}
                  aria-hidden
                />
              ) : null}
              {isPlayer ? (
                <span className="absolute h-4 w-4 rounded-full bg-primary ring-2 ring-surface-base" />
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Status: server-authoritative counts + last-move feedback (screen-reader
          live so a bump / reset / key pickup is announced). */}
      <div
        aria-live="polite"
        className="min-h-[2.5rem] text-center text-sm"
      >
        <div className="flex justify-center gap-4 text-ink-muted">
          <span>Moves: {state.movesUsed}</span>
          <span>
            Keys: {keysGot}/{keysTotal}
          </span>
          <span>{allKeys ? "Door unlocked" : "Door locked"}</span>
        </div>
        {message ? (
          <p className="mt-1 font-medium text-ink">{message}</p>
        ) : (
          <p className="mt-1 text-xs text-ink-muted">
            Click the grid, then move with the arrow keys or WASD.
          </p>
        )}
      </div>
    </div>
  );
}
