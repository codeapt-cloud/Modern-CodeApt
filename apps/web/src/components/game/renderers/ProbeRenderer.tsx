/**
 * The DEV-ONLY `_probe` renderer — the shell's first and (in 7a) only renderer.
 * It proves the GamePrompt contract end-to-end before the five one-shot
 * renderers (7b) and the interactive door_key renderer (7c) are written.
 *
 * `_probe` shows N numbers in a shuffled order; the player clicks them in
 * ASCENDING order of value. The submission is the sequence of INDICES clicked
 * ({ order }) — the shell replays it server-side. This renderer holds only that
 * local click order and reports it via onSubmit; it owns no clock, no scoring.
 */
import type { ProbeClientView } from "@codeapt/shared";
import { useState } from "react";

import { cn } from "../../../lib/cn.js";
import { Button } from "../../ui/button.js";
import type { GameRendererProps } from "../renderer-contract.js";

export function ProbeRenderer({
  view,
  locked,
  onSubmit,
}: GameRendererProps): JSX.Element {
  const probe = view as ProbeClientView;
  const numbers = probe.numbers ?? [];
  // Local in-progress selection: the indices the player has clicked, in order.
  const [order, setOrder] = useState<number[]>([]);

  const toggle = (index: number): void => {
    if (locked) return;
    setOrder((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    );
  };

  const complete = order.length === numbers.length;

  return (
    <div className="flex flex-col items-center gap-6">
      <p className="text-sm text-ink-muted">
        Click the numbers in ascending order (smallest first).
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        {numbers.map((value, index) => {
          const pos = order.indexOf(index);
          const picked = pos >= 0;
          return (
            <button
              key={index}
              type="button"
              disabled={locked}
              onClick={() => toggle(index)}
              aria-pressed={picked}
              className={cn(
                "relative flex h-16 w-16 items-center justify-center rounded-2xl border text-xl font-semibold transition-colors",
                picked
                  ? "border-primary bg-primary/10 text-ink"
                  : "border-subtle bg-surface-raised text-ink hover:border-primary/50",
                locked && "cursor-not-allowed opacity-60",
              )}
            >
              {value}
              {picked ? (
                <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
                  {pos + 1}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={locked || order.length === 0}
          onClick={() => setOrder([])}
        >
          Clear
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={locked || !complete}
          onClick={() => onSubmit({ order })}
        >
          Submit order
        </Button>
      </div>
    </div>
  );
}
