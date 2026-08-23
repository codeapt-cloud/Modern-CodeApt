/**
 * bubble_math — three bubbles (a number or a small expression); click them in
 * ASCENDING order of value, click again to deselect. Submission `{ order }`.
 *
 * This game has a ~15s per-item timer (shown by the shell header), so speed
 * matters: the third selection AUTO-COMMITS — no confirm step. That is the
 * closest match to the real exam (which registers the order as you tap) and
 * removes a click from the hot path; a mistaken pick can be cleared by clicking
 * a selected bubble to deselect before the third is chosen.
 */
import type { BubbleMathClientView } from "@codeapt/shared";
import { useState } from "react";

import { cn } from "../../../lib/cn.js";
import type { GameRendererProps } from "../renderer-contract.js";

export function BubbleMathRenderer({
  view,
  locked,
  onSubmit,
}: GameRendererProps): JSX.Element {
  const v = view as BubbleMathClientView;
  const [order, setOrder] = useState<number[]>([]);

  const click = (index: number): void => {
    if (locked) return;
    setOrder((prev) => {
      if (prev.includes(index)) return prev.filter((i) => i !== index);
      const next = [...prev, index];
      // Auto-commit on the third (final) selection — no confirm step.
      if (next.length === v.bubbles.length) {
        onSubmit({ order: next });
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col items-center gap-6">
      <p className="text-sm text-ink-muted">
        Click the bubbles in ascending order of value — smallest first.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-5">
        {v.bubbles.map((b, index) => {
          const pos = order.indexOf(index);
          const picked = pos >= 0;
          return (
            <button
              key={index}
              type="button"
              disabled={locked}
              aria-pressed={picked}
              onClick={() => click(index)}
              className={cn(
                "relative flex h-24 w-24 items-center justify-center rounded-full border-2 text-lg font-semibold transition-colors",
                picked
                  ? "border-primary bg-primary/10 text-ink"
                  : "border-subtle bg-surface-raised text-ink hover:border-primary/50",
                locked && "cursor-not-allowed opacity-60",
              )}
            >
              {b.expr}
              {picked ? (
                <span className="absolute -right-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
                  {pos + 1}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-ink-muted">
        Selecting the third bubble submits automatically.
      </p>
    </div>
  );
}
