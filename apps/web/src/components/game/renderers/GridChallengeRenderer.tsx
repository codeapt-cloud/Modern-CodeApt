/**
 * grid_challenge — the seam's second INTERACTIVE renderer (Step 18). A three-cycle
 * interleaved dual task driven entirely through the `probe` channel (never
 * onSubmit): each cycle flashes ONE green circle for 2s (memorise), then shows two
 * 5x5 patterns for 6s ("rotated but identical?"), ×3, then the scatter returns to
 * click the three circles IN ORDER. The live +3/-1 score sits in the chrome.
 *
 * Exposure is server-timed: the highlight lives in the view only while its memorise
 * is live, so the client cannot re-show it — after the 2s window we `ack` and the
 * next view no longer carries it. The 6s rotation window auto-answers (a guess) on
 * timeout so a stalled cycle still resolves. Positions are free-floating (0..100),
 * never a grid.
 */
import type { GridClientView } from "@codeapt/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "../../../lib/cn.js";
import type { GameRendererProps } from "../renderer-contract.js";

const N = 5;

function PatternGrid({ cells }: { cells: boolean[] }): JSX.Element {
  return (
    <div
      className="grid gap-0.5 rounded-lg border border-subtle bg-surface-base p-1.5"
      style={{ gridTemplateColumns: `repeat(${N}, minmax(0, 1fr))`, width: "8.5rem" }}
      aria-hidden
    >
      {Array.from({ length: N * N }).map((_v, i) => (
        <div
          key={i}
          className={cn(
            "aspect-square rounded-[3px]",
            cells[i] ? "bg-primary" : "bg-surface-muted",
          )}
        />
      ))}
    </div>
  );
}

export function GridChallengeRenderer({
  view,
  locked,
  probe,
}: GameRendererProps): JSX.Element {
  const [v, setV] = useState<GridClientView>(view as GridClientView);
  const [picks, setPicks] = useState<number[]>([]);
  const [secs, setSecs] = useState(0);
  const inFlight = useRef(false);
  const done = useRef(false);

  const send = useCallback(
    async (action: unknown): Promise<void> => {
      if (!probe || inFlight.current || done.current) return;
      inFlight.current = true;
      try {
        const res = await probe(action);
        if (res.view) setV(res.view as GridClientView);
        if (res.resolved) done.current = true;
        setPicks([]);
      } finally {
        inFlight.current = false;
      }
    },
    [probe],
  );

  // Memorise window: flash the green circle for highlightMs, then ack (which
  // consumes the exposure — the next view no longer carries the highlight).
  useEffect(() => {
    if (locked || v.phase !== "memorize" || v.highlight === null) return;
    setSecs(Math.ceil(v.highlightMs / 1000));
    const ack = window.setTimeout(() => void send({ type: "ack" }), v.highlightMs);
    const tick = window.setInterval(() => setSecs((s) => Math.max(0, s - 1)), 1000);
    return () => {
      window.clearTimeout(ack);
      window.clearInterval(tick);
    };
  }, [v.phase, v.cycle, v.highlight, v.highlightMs, locked, send]);

  // Rotation window: 6s to decide; a timeout auto-answers (a guess) so the cycle
  // still resolves and the interference is real (you can't stall to think).
  useEffect(() => {
    if (locked || v.phase !== "symmetry") return;
    setSecs(Math.ceil(v.symmetryMs / 1000));
    const timeout = window.setTimeout(
      () => void send({ type: "symmetry", answer: false }),
      v.symmetryMs,
    );
    const tick = window.setInterval(() => setSecs((s) => Math.max(0, s - 1)), 1000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(tick);
    };
  }, [v.phase, v.cycle, v.symmetryMs, locked, send]);

  const pickCircle = (i: number): void => {
    if (locked || v.phase !== "recall") return;
    setPicks((prev) =>
      prev.includes(i) || prev.length >= v.totalCycles ? prev : [...prev, i],
    );
  };

  const header = (
    <div className="flex w-full items-center justify-between text-sm">
      <span className="font-medium text-ink">
        Cycle {Math.min(v.cycle + 1, v.totalCycles)} / {v.totalCycles}
      </span>
      <span className="tabular-nums text-ink-muted">
        Score: <span className="font-semibold text-ink">{v.score}</span>
      </span>
    </div>
  );

  const scatter = (interactive: boolean) => (
    <div
      className="relative rounded-xl border border-subtle bg-surface-base"
      style={{ width: "min(100%, 26rem)", aspectRatio: "1 / 1" }}
    >
      {v.circles.map((c, i) => {
        const isHighlight = v.phase === "memorize" && v.highlight === i;
        const pickIndex = picks.indexOf(i);
        return (
          <button
            key={i}
            type="button"
            disabled={!interactive}
            onClick={() => pickCircle(i)}
            aria-label={interactive ? `Circle ${i + 1}` : undefined}
            className={cn(
              "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border transition-colors",
              isHighlight
                ? "border-success bg-success"
                : pickIndex >= 0
                  ? "border-primary bg-primary/20"
                  : "border-subtle bg-surface-muted",
              interactive && "cursor-pointer hover:border-primary",
            )}
            style={{ left: `${c.x}%`, top: `${c.y}%`, width: "1.5rem", height: "1.5rem" }}
          >
            {pickIndex >= 0 ? (
              <span className="text-xs font-semibold text-primary">{pickIndex + 1}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="flex flex-col items-center gap-4">
      {header}

      {v.phase === "memorize" ? (
        <>
          <p className="text-sm text-ink-muted">
            Remember the <span className="font-medium text-success">green</span> circle
            {secs > 0 ? ` — ${secs}s` : ""}.
          </p>
          {scatter(false)}
        </>
      ) : v.phase === "symmetry" ? (
        <>
          <p className="text-sm text-ink-muted">
            Rotated but identical? {secs > 0 ? `(${secs}s)` : ""}
          </p>
          <div className="flex items-center gap-4">
            {v.pattern ? <PatternGrid cells={v.pattern.a} /> : null}
            {v.pattern ? <PatternGrid cells={v.pattern.b} /> : null}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={locked}
              onClick={() => void send({ type: "symmetry", answer: true })}
              className="rounded-lg bg-primary px-6 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Yes
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={() => void send({ type: "symmetry", answer: false })}
              className="rounded-lg border border-subtle px-6 py-2 text-sm font-medium text-ink disabled:opacity-50"
            >
              No
            </button>
          </div>
        </>
      ) : v.phase === "recall" ? (
        <>
          <p className="text-sm text-ink-muted">
            Click the {v.totalCycles} circles you memorised, in order.
          </p>
          {scatter(true)}
          <button
            type="button"
            disabled={locked || picks.length !== v.totalCycles}
            onClick={() => void send({ type: "recall", order: picks })}
            className="rounded-lg bg-primary px-6 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Submit ({picks.length}/{v.totalCycles})
          </button>
        </>
      ) : (
        <p className="text-sm text-ink-muted">Finished — final score {v.score}.</p>
      )}
    </div>
  );
}
