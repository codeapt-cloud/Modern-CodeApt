/**
 * geo_sudo — a Latin-square grid with one `?` cell; the player picks the missing
 * symbol from the palette. Submission `{ symbol }`. The grid scales 4×4/5×5/6×6
 * by difficulty via a CSS grid keyed off `view.size`, so layout never breaks.
 */
import type { GeoSudoClientView } from "@codeapt/shared";
import { useState } from "react";

import { cn } from "../../../lib/cn.js";
import { Button } from "../../ui/button.js";
import { Glyph } from "../glyphs.js";
import type { GameRendererProps } from "../renderer-contract.js";

export function GeoSudoRenderer({
  view,
  locked,
  onSubmit,
}: GameRendererProps): JSX.Element {
  const v = view as GeoSudoClientView;
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-center gap-6">
      <p className="text-sm text-ink-muted">
        Fill the <span className="font-semibold text-ink">?</span> with the symbol
        missing from its row and column.
      </p>

      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${v.size}, minmax(0, 1fr))`, width: "min(100%, 22rem)" }}
      >
        {v.grid.map((row, r) =>
          row.map((cell, c) => {
            const isBlank = r === v.blank.row && c === v.blank.col;
            return (
              <div
                key={`${r}-${c}`}
                className={cn(
                  "flex aspect-square items-center justify-center rounded-lg border text-xl",
                  isBlank
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-subtle bg-surface-base text-ink",
                )}
              >
                {isBlank ? (
                  picked ? (
                    <Glyph symbol={picked} className="text-primary" />
                  ) : (
                    <span className="font-bold text-primary">?</span>
                  )
                ) : (
                  <Glyph symbol={cell} />
                )}
              </div>
            );
          }),
        )}
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {v.symbols.map((sym) => (
          <button
            key={sym}
            type="button"
            disabled={locked}
            aria-pressed={picked === sym}
            onClick={() => setPicked(sym)}
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-xl border text-lg transition-colors",
              picked === sym
                ? "border-primary bg-primary/10 text-primary"
                : "border-subtle bg-surface-raised text-ink hover:border-primary/50",
              locked && "cursor-not-allowed opacity-60",
            )}
          >
            <Glyph symbol={sym} />
          </button>
        ))}
      </div>

      <Button
        size="sm"
        disabled={locked || !picked}
        onClick={() => picked && onSubmit({ symbol: picked })}
      >
        Submit
      </Button>
    </div>
  );
}
