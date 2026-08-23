/**
 * inductive_reasoning — two example grids (left) share a hidden rule; pick
 * EXACTLY the two option grids (right) that follow it. Submission
 * `{ selected: [i, j] }`. Selecting only one is a common real-exam loss, so the
 * requirement is made obvious: Submit stays disabled with a "pick one more" hint
 * until exactly two are chosen, and a third pick is refused until one is cleared
 * — without hinting which options are correct.
 */
import type { InductiveClientView } from "@codeapt/shared";
import { useState } from "react";

import { cn } from "../../../lib/cn.js";
import { Button } from "../../ui/button.js";
import { Glyph } from "../glyphs.js";
import type { GameRendererProps } from "../renderer-contract.js";

function MiniGrid({
  cells,
  size,
  className,
}: {
  cells: string[];
  size: number;
  className?: string;
}): JSX.Element {
  return (
    <div
      className={cn("grid gap-0.5", className)}
      style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
    >
      {cells.map((sym, i) => (
        <span
          key={i}
          className="flex aspect-square items-center justify-center rounded bg-surface-base text-sm text-ink"
        >
          <Glyph symbol={sym} />
        </span>
      ))}
    </div>
  );
}

export function InductiveRenderer({
  view,
  locked,
  onSubmit,
}: GameRendererProps): JSX.Element {
  const v = view as InductiveClientView;
  const [selected, setSelected] = useState<number[]>([]);

  const toggle = (i: number): void => {
    if (locked) return;
    setSelected((prev) => {
      if (prev.includes(i)) return prev.filter((x) => x !== i);
      if (prev.length >= 2) return prev; // refuse a 3rd — clear one first
      return [...prev, i];
    });
  };

  const remaining = 2 - selected.length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          These two follow a hidden rule
        </h3>
        <div className="flex gap-4">
          {v.left.map((g, i) => (
            <div key={i} className="w-24 rounded-xl border border-subtle bg-surface-raised p-2">
              <MiniGrid cells={g} size={v.size} />
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Pick the TWO that follow the same rule
          </h3>
          <span
            className={cn(
              "text-xs font-medium",
              remaining === 0 ? "text-ink-muted" : "text-primary",
            )}
          >
            {remaining === 0
              ? "2 of 2 selected"
              : `Select ${remaining} more`}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {v.options.map((g, i) => {
            const pos = selected.indexOf(i);
            const picked = pos >= 0;
            return (
              <button
                key={i}
                type="button"
                disabled={locked}
                aria-pressed={picked}
                onClick={() => toggle(i)}
                className={cn(
                  "relative rounded-xl border-2 p-2 transition-colors",
                  picked
                    ? "border-primary bg-primary/5"
                    : "border-subtle bg-surface-raised hover:border-primary/40",
                  locked && "cursor-not-allowed opacity-60",
                )}
              >
                {picked ? (
                  <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
                    {pos + 1}
                  </span>
                ) : null}
                <MiniGrid cells={g} size={v.size} />
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={locked || selected.length === 0}
          onClick={() => setSelected([])}
        >
          Clear
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={locked || selected.length !== 2}
          onClick={() => onSubmit({ selected })}
        >
          Submit both
        </Button>
      </div>
    </div>
  );
}
