/**
 * Output-token budgeting — "best output, fewest tokens". Every AI call gets a
 * right-sized `max_tokens` so providers can't run on and burn free-tier quota
 * (the live probe showed models emitting 150–180 tokens for a 1-word answer when
 * uncapped). Features pass their real need via `policy.maxTokens`; the gateway
 * applies a sensible PER-TASK default when they don't and clamps everything to a
 * hard ceiling regardless. Pure + isomorphic — used by both the seam fallback
 * and the DB-backed gateway.
 */
import type { LlmTaskKind, LlmTaskPolicy } from "./types.js";

/** Absolute ceiling — no single call may ask for more output than this. */
export const HARD_MAX_OUTPUT_TOKENS = 4096;
/** Floor — never cap so low that valid structured JSON gets truncated. */
export const MIN_OUTPUT_TOKENS = 64;

/** Sensible default output budget per task when the caller doesn't specify. */
const DEFAULT_MAX_TOKENS: Record<LlmTaskKind, number> = {
  // A verdict JSON (three ints + ≤120-word feedback) fits comfortably here.
  grading: 512,
  // Keyword lists / small generations; AI Build passes a count-sized value.
  generation: 1024,
};

/**
 * The effective output-token ceiling for a call: the caller's `maxTokens` if
 * positive, else the per-task default — always clamped to [MIN, HARD_MAX].
 */
export function resolveMaxTokens(policy?: LlmTaskPolicy): number {
  const requested = policy?.maxTokens;
  const base =
    typeof requested === "number" && requested > 0
      ? requested
      : DEFAULT_MAX_TOKENS[policy?.kind ?? "generation"];
  return Math.min(HARD_MAX_OUTPUT_TOKENS, Math.max(MIN_OUTPUT_TOKENS, Math.round(base)));
}
