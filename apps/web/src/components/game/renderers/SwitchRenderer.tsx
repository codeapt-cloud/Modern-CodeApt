/**
 * switch_challenge — the game students find most confusing, so the FOUR modes
 * are made unmistakable: a mode banner states exactly what is being asked, a
 * "Given" section shows only the provided input/switches/output, and a "Your
 * answer" section is labelled with what the player is building. Skip is
 * server-forbidden for this game (the shell shows no Skip — allowSkip is false).
 *
 * The answer is always a length-4 arrangement of indices built by clicking four
 * tiles in slot order (submission `{ order }`): SYMBOL tiles when producing an
 * output/input, POSITION tiles (1–4) when producing the hidden middle switch.
 */
import type { SwitchClientView } from "@codeapt/shared";
import { useState } from "react";

import { cn } from "../../../lib/cn.js";
import { Button } from "../../ui/button.js";
import { Glyph } from "../glyphs.js";
import type { GameRendererProps } from "../renderer-contract.js";

const MODE_TITLE: Record<SwitchClientView["ask"], string> = {
  output: "Apply the switch(es) and build the OUTPUT arrangement.",
  input: "Work BACKWARD: from the output and switch, build the INPUT.",
  middle: "Find the hidden MIDDLE switch (given the outer switches).",
};
const ANSWER_LABEL: Record<SwitchClientView["ask"], string> = {
  output: "Output",
  input: "Input",
  middle: "Middle switch",
};

function Seq({
  values,
  render,
}: {
  values: number[];
  render: (v: number) => JSX.Element | string;
}): JSX.Element {
  return (
    <div className="flex gap-1.5">
      {values.map((v, i) => (
        <span
          key={i}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-subtle bg-surface-base text-lg text-ink"
        >
          {render(v)}
        </span>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      {children}
    </div>
  );
}

export function SwitchRenderer({
  view,
  locked,
  onSubmit,
}: GameRendererProps): JSX.Element {
  const v = view as SwitchClientView;
  const asPosition = v.ask === "middle"; // tiles are positions 1..4, not symbols
  const tileCount = v.symbols.length;
  const [order, setOrder] = useState<number[]>([]);

  const place = (index: number): void => {
    if (locked) return;
    setOrder((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    );
  };
  const complete = order.length === tileCount;

  // Middle-switch mode hides s2; switches[] = [s1, s3]. Label them accordingly.
  const switchLabel = (i: number): string =>
    asPosition ? `Switch ${i === 0 ? 1 : 3}` : `Switch ${i + 1}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border border-primary/40 bg-primary/5 p-3 text-center text-sm font-medium text-ink">
        {MODE_TITLE[v.ask]}
      </div>

      {/* GIVEN */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Given
        </h3>
        {v.input ? (
          <Row label="Input">
            <Seq values={v.input} render={(s) => <Glyph symbol={v.symbols[s]} />} />
          </Row>
        ) : null}
        {v.switches.map((sw, i) => (
          <Row key={i} label={switchLabel(i)}>
            <Seq values={sw} render={(p) => String(p + 1)} />
          </Row>
        ))}
        {v.output ? (
          <Row label="Output">
            <Seq values={v.output} render={(s) => <Glyph symbol={v.symbols[s]} />} />
          </Row>
        ) : null}
      </div>

      {/* ANSWER */}
      <div className="space-y-3 rounded-xl border border-subtle bg-surface-sunken p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Your answer — {ANSWER_LABEL[v.ask]}
        </h3>
        <div className="flex gap-1.5">
          {Array.from({ length: tileCount }).map((_, slot) => {
            const val = order[slot];
            return (
              <span
                key={slot}
                className="flex h-11 w-11 items-center justify-center rounded-lg border-2 border-dashed border-subtle text-lg text-ink"
              >
                {val === undefined ? (
                  <span className="text-ink-muted">·</span>
                ) : asPosition ? (
                  String(val + 1)
                ) : (
                  <Glyph symbol={v.symbols[val]} />
                )}
              </span>
            );
          })}
        </div>
        <p className="text-xs text-ink-muted">
          Click the {asPosition ? "positions" : "symbols"} in order to fill the
          slots left-to-right.
        </p>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: tileCount }).map((_, index) => {
            const used = order.includes(index);
            return (
              <button
                key={index}
                type="button"
                disabled={locked || used}
                onClick={() => place(index)}
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-lg border text-lg transition-colors",
                  used
                    ? "border-subtle bg-surface-base text-ink-muted opacity-40"
                    : "border-subtle bg-surface-raised text-ink hover:border-primary/50",
                  locked && "cursor-not-allowed opacity-60",
                )}
              >
                {asPosition ? String(index + 1) : <Glyph symbol={v.symbols[index]} />}
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
          Submit
        </Button>
      </div>
    </div>
  );
}
