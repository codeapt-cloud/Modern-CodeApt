/**
 * Minimal duration-string parser (e.g. "15m", "30d", "500ms", "2h").
 * Used so JWT expiry and cookie maxAge derive from the SAME env value.
 */
const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

export function parseDurationToMs(input: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(input.trim());
  const factor = match ? UNIT_MS[match[2] as keyof typeof UNIT_MS] : undefined;
  if (!match || factor === undefined) {
    throw new Error(
      `Invalid duration "${input}" (expected e.g. "15m", "30d", "500ms")`,
    );
  }
  return Number(match[1]) * factor;
}

export const parseDurationToSeconds = (input: string): number =>
  Math.floor(parseDurationToMs(input) / 1000);
