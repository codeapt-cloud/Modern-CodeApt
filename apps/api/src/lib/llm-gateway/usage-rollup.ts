/**
 * Usage rollups — the REAL data behind the admin trend charts. One upserted row
 * per (UTC day, provider, feature); incremented as calls happen. Cache hits are
 * recorded on a provider-less row (no provider was called) with the tokens they
 * saved. All numbers are genuine — nothing is estimated beyond "a hit saved what
 * the original miss cost".
 */
import { Types } from "mongoose";

import {
  AI_ROLLUP_RETENTION_MS,
  AiUsageRollupModel,
} from "../../models/ai-usage.model.js";

/** UTC day bucket "YYYY-MM-DD" for `now`. */
export function dayBucket(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** A real provider call: +1 request, +tokens, and +1 miss when it was cacheable. */
export async function recordProviderUsage(
  providerId: string,
  feature: string,
  usage: { promptTokens: number; completionTokens: number },
  cacheable: boolean,
  now: number,
): Promise<void> {
  await AiUsageRollupModel.updateOne(
    { day: dayBucket(now), provider: new Types.ObjectId(providerId), feature },
    {
      $inc: {
        requests: 1,
        promptTokens: usage.promptTokens ?? 0,
        completionTokens: usage.completionTokens ?? 0,
        cacheMisses: cacheable ? 1 : 0,
      },
      $setOnInsert: { expiresAt: new Date(now + AI_ROLLUP_RETENTION_MS) },
    },
    { upsert: true },
  );
}

/** A cache hit: +1 hit and +tokensSaved on the provider-less row for the feature. */
export async function recordCacheHit(
  feature: string,
  tokensSaved: number,
  now: number,
): Promise<void> {
  await AiUsageRollupModel.updateOne(
    { day: dayBucket(now), provider: null, feature },
    {
      $inc: { cacheHits: 1, tokensSaved: Math.max(0, tokensSaved) },
      $setOnInsert: { expiresAt: new Date(now + AI_ROLLUP_RETENTION_MS) },
    },
    { upsert: true },
  );
}
