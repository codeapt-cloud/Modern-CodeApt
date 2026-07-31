/**
 * Coerce untrusted LLM output into the EssayAiFeedback shape. The model is asked
 * for scores + pros/cons/improvements + a summary, but (like all LLM output) it
 * can't be trusted: scores are clamped to 0-100 ints, list items are trimmed to
 * non-empty strings and capped, and a response with nothing usable becomes null
 * (so the caller shows a graceful "no feedback" state rather than garbage).
 * Pure + isomorphic so it unit-tests without a network.
 */
import type { EssayAiFeedback } from "./schemas.js";

/** Max list items kept per pros/cons/improvements — bounds noisy output. */
const MAX_ITEMS = 8;

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function clampScore(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function stringList(v: unknown): string[] {
  return (Array.isArray(v) ? v : [])
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter((s) => s.length > 0)
    .slice(0, MAX_ITEMS);
}

export function coerceEssayAiFeedback(raw: unknown): EssayAiFeedback | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const s = asRecord(obj.scores) ?? {};
  const scores = {
    vocabulary: clampScore(s.vocabulary),
    structure: clampScore(s.structure),
    relevance: clampScore(s.relevance),
    overall: clampScore(s.overall),
  };
  const pros = stringList(obj.pros);
  const cons = stringList(obj.cons);
  const improvements = stringList(obj.improvements);
  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";

  // Require at least one qualitative signal — an all-empty response is useless.
  if (pros.length === 0 && cons.length === 0 && improvements.length === 0 && !summary) {
    return null;
  }
  return { scores, pros, cons, improvements, summary };
}
