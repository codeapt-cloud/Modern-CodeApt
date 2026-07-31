/**
 * Persist a call's outcome onto the provider health doc (worker copy of the
 * API's). Windows reset on the minute/day boundary before incrementing; success
 * drifts reliability toward 1, failure toward 0; hard failures (cooldownUntil !=
 * null) count the request + set the bench, soft failures don't double count.
 */
import {
  AiProviderHealthModel,
  type AiProviderHealthDoc,
} from "../../models/ai-provider.model.js";
import { minuteWindowStart, utcDayWindowStart } from "./windows.js";

const RELIABILITY_ALPHA = 0.1;

type HealthDoc = AiProviderHealthDoc & { save: () => Promise<unknown> };

async function loadOrInit(providerId: string): Promise<HealthDoc> {
  const existing = await AiProviderHealthModel.findOne({ provider: providerId });
  if (existing) return existing as unknown as HealthDoc;
  return new AiProviderHealthModel({ provider: providerId }) as unknown as HealthDoc;
}

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
