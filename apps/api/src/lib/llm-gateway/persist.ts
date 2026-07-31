/**
 * Persist a call's outcome onto the provider's health doc (one per provider,
 * upserted). Counters reset when `now` crosses their minute/day boundary before
 * incrementing, so headroom always reflects the CURRENT window.
 *
 *  - recordSuccess: +1 request, +usage tokens; reliability drifts toward 1;
 *    consecutiveFailures → 0.
 *  - recordFailure: reliability drifts toward 0; consecutiveFailures++; sets
 *    cooldownUntil when given. A HARD failure (cooldownUntil != null) also counts
 *    the request against quota (the attempt hit the provider); a SOFT failure
 *    (cooldownUntil == null, e.g. unparseable 2xx already counted by
 *    recordSuccess) does not double-count.
 */
import {
  AiProviderHealthModel,
  type AiProviderHealthDoc,
} from "../../models/ai-provider.model.js";
import { minuteWindowStart, utcDayWindowStart } from "./windows.js";

/** EMA smoothing for reliability (0..1); higher α = faster reaction. */
const RELIABILITY_ALPHA = 0.1;

type HealthDoc = AiProviderHealthDoc & {
  save: () => Promise<unknown>;
};

async function loadOrInit(providerId: string): Promise<HealthDoc> {
  const existing = await AiProviderHealthModel.findOne({ provider: providerId });
  if (existing) return existing as unknown as HealthDoc;
  return new AiProviderHealthModel({ provider: providerId }) as unknown as HealthDoc;
}

/** Zero the minute/day counters whose window has rolled over. Mutates in place. */
function rollWindows(doc: HealthDoc, now: number): void {
  const mStart = minuteWindowStart(now);
  const dStart = utcDayWindowStart(now);
  if (doc.minuteWindowStart !== mStart) {
    doc.minuteWindowStart = mStart;
    doc.minuteRequests = 0;
    doc.minuteTokens = 0;
  }
  if (doc.dayWindowStart !== dStart) {
    doc.dayWindowStart = dStart;
    doc.dayRequests = 0;
    doc.dayTokens = 0;
  }
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

export async function recordSuccess(
  providerId: string,
  usage: { promptTokens: number; completionTokens: number },
  now: number,
): Promise<void> {
  const doc = await loadOrInit(providerId);
  rollWindows(doc, now);
  const tokens = (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
  doc.minuteRequests += 1;
  doc.minuteTokens += tokens;
  doc.dayRequests += 1;
  doc.dayTokens += tokens;
  doc.consecutiveFailures = 0;
  doc.reliability = clamp01(doc.reliability * (1 - RELIABILITY_ALPHA) + RELIABILITY_ALPHA);
  doc.cooldownUntil = null;
  doc.lastUsedAt = new Date(now);
  await doc.save();
}

export async function recordFailure(
  providerId: string,
  cooldownUntil: number | null,
  now: number,
  message: string,
): Promise<void> {
  const doc = await loadOrInit(providerId);
  rollWindows(doc, now);
  // Hard failures consumed a request against the provider's quota; soft failures
  // (unparseable 2xx) were already counted by recordSuccess — don't double count.
  if (cooldownUntil != null) {
    doc.minuteRequests += 1;
    doc.dayRequests += 1;
    doc.cooldownUntil = cooldownUntil;
  }
  doc.consecutiveFailures += 1;
  doc.reliability = clamp01(doc.reliability * (1 - RELIABILITY_ALPHA));
  doc.lastError = message.slice(0, 500);
  doc.lastErrorAt = new Date(now);
  await doc.save();
}
