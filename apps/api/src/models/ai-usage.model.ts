/**
 * LLM token-optimization storage (PLATFORM-level; shared across the API + worker
 * via Mongo so caching and trends work cross-process — grading runs in the
 * worker, keyword-gen / AI Build in the API).
 *
 *  - AiResponseCache: an identical request → its parsed JSON result, so a repeat
 *    is served at ZERO tokens. Keyed by a hash of everything that defines the
 *    request (see lib/llm-gateway/cache.ts). TTL-expired by Mongo. Errors are
 *    never cached (only a real parsed result is stored).
 *  - AiUsageRollup: per-day × provider × feature counters (requests, prompt/
 *    completion tokens, cache hits/misses, tokens saved) that power the admin
 *    usage-TREND charts. One upserted doc per (day, provider, feature); provider
 *    is null for cache-hit rows (no provider was called). Auto-expired after a
 *    retention window so it never grows unbounded.
 */
import { Schema, model, type InferSchemaType } from "mongoose";

/** Cache entries live this long (ms) before Mongo expires them. */
export const AI_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
/** Rollups are retained this long (ms) for the trend window. */
export const AI_ROLLUP_RETENTION_MS = 45 * 24 * 60 * 60 * 1000; // 45 days

const aiResponseCacheSchema = new Schema(
  {
    /** sha256 hex of (kind + system + user + maxTokens). */
    key: { type: String, required: true, unique: true },
    kind: { type: String, default: "" },
    feature: { type: String, default: "" },
    /** The parsed JSON result to return verbatim on a hit. */
    value: { type: Schema.Types.Mixed, required: true },
    /** Tokens the original (miss) call cost — counted as "saved" on each hit. */
    promptTokens: { type: Number, default: 0 },
    completionTokens: { type: Number, default: 0 },
    /** TTL anchor — Mongo removes the doc after AI_CACHE_TTL_MS. */
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
// TTL index: expire exactly at `expiresAt`.
aiResponseCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const aiUsageRollupSchema = new Schema(
  {
    /** UTC day bucket "YYYY-MM-DD". */
    day: { type: String, required: true },
    /** Provider called (null for cache-hit rows). */
    provider: { type: Schema.Types.ObjectId, ref: "AiProvider", default: null },
    /** Feature label (grading / keywords / ai_build …). */
    feature: { type: String, default: "unknown" },
    requests: { type: Number, default: 0 },
    promptTokens: { type: Number, default: 0 },
    completionTokens: { type: Number, default: 0 },
    cacheHits: { type: Number, default: 0 },
    cacheMisses: { type: Number, default: 0 },
    tokensSaved: { type: Number, default: 0 },
    /** Retention anchor for the trend window. */
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
// One row per (day, provider, feature) — upsert-incremented.
aiUsageRollupSchema.index({ day: 1, provider: 1, feature: 1 }, { unique: true });
aiUsageRollupSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type AiResponseCacheDoc = InferSchemaType<typeof aiResponseCacheSchema>;
export type AiUsageRollupDoc = InferSchemaType<typeof aiUsageRollupSchema>;

export const AiResponseCacheModel = model("AiResponseCache", aiResponseCacheSchema);
export const AiUsageRollupModel = model("AiUsageRollup", aiUsageRollupSchema);
