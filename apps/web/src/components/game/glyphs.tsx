/**
 * Named symbols → recognisable glyphs, shared by the geo_sudo, switch_challenge,
 * and inductive_reasoning renderers so a "square" looks the same everywhere. The
 * server sends symbol NAMES (strings); the client owns their visual form.
 */
const GLYPH: Record<string, string> = {
  circle: "●",
  triangle: "▲",
  square: "■",
  plus: "✚",
  star: "★",
  half_moon: "◐",
};

export function glyphFor(symbol: string | null | undefined): string {
  if (!symbol) return "";
  return GLYPH[symbol] ?? symbol.charAt(0).toUpperCase();
}

export function Glyph({
  symbol,
  className,
}: {
  symbol: string | null | undefined;
  className?: string;
}): JSX.Element {
  return (
    <span className={className} aria-label={symbol ?? undefined}>
      {glyphFor(symbol)}
    </span>
  );
}
