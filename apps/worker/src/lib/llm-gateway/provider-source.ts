/**
 * Build the router's ProviderRuntime[] from the DB (worker copy of the API's).
 * Enabled providers joined with their first enabled key (decrypted at use) +
 * current-window usage/health. Keyless / undecryptable providers are skipped.
 */
import type {
  ProviderCapability,
  ProviderKind,
  ProviderRuntime,
  ProviderUsageSnapshot,
} from "@codeapt/shared";

import { env } from "../../config/env.js";
import {
  AiProviderHealthModel,
  AiProviderKeyModel,
  AiProviderModel,
  type AiProviderHealthDoc,
} from "../../models/ai-provider.model.js";
import { decryptSecret } from "../crypto.js";
import { logger } from "../logger.js";
import { minuteWindowStart, utcDayWindowStart } from "./windows.js";

function currentUsage(
  health: AiProviderHealthDoc | undefined,
  now: number,
): ProviderUsageSnapshot {
  const minuteFresh = health != null && health.minuteWindowStart === minuteWindowStart(now);
  const dayFresh = health != null && health.dayWindowStart === utcDayWindowStart(now);
  return {
    minute: {
      requests: minuteFresh ? health!.minuteRequests : 0,
      tokens: minuteFresh ? health!.minuteTokens : 0,
    },
    day: {
      requests: dayFresh ? health!.dayRequests : 0,
      tokens: dayFresh ? health!.dayTokens : 0,
    },
  };
}

function cleanLimits(limits: {
  requestsPerMinute?: number | null;
  requestsPerDay?: number | null;
  tokensPerMinute?: number | null;
  tokensPerDay?: number | null;
}): ProviderRuntime["limits"] {
  return {
    requestsPerMinute: limits.requestsPerMinute ?? undefined,
    requestsPerDay: limits.requestsPerDay ?? undefined,
    tokensPerMinute: limits.tokensPerMinute ?? undefined,
    tokensPerDay: limits.tokensPerDay ?? undefined,
  };
}

export async function loadProviderRuntimes(now: number): Promise<ProviderRuntime[]> {
  const providers = await AiProviderModel.find({ enabled: true }).lean();
  if (providers.length === 0) return [];

  const ids = providers.map((p) => p._id);
  const [keys, healths] = await Promise.all([
    AiProviderKeyModel.find({ provider: { $in: ids }, enabled: true }).sort({ createdAt: 1 }).lean(),
    AiProviderHealthModel.find({ provider: { $in: ids } }).lean(),
  ]);

  const keyByProvider = new Map<string, (typeof keys)[number]>();
  for (const k of keys) {
    const pid = k.provider.toString();
    if (!keyByProvider.has(pid)) keyByProvider.set(pid, k);
  }
  const healthByProvider = new Map<string, AiProviderHealthDoc>(
    healths.map((h) => [h.provider.toString(), h as AiProviderHealthDoc]),
  );

  const runtimes: ProviderRuntime[] = [];
  for (const p of providers) {
    const pid = p._id.toString();
    const keyDoc = keyByProvider.get(pid);
    if (!keyDoc) continue;
    let apiKey: string;
    try {
      apiKey = decryptSecret(keyDoc.keyCiphertext);
    } catch {
      logger.warn({ provider: p.name }, "provider key failed to decrypt — skipping");
      continue;
    }
    const health = healthByProvider.get(pid);
    runtimes.push({
      id: pid,
      name: p.name,
      kind: p.kind as ProviderKind,
      baseUrl: p.baseUrl,
      model: p.model,
      priority: p.priority ?? 100,
      capability: p.capability as ProviderCapability,
      trainsOnData: p.trainsOnData ?? false,
      limits: cleanLimits(p.limits ?? {}),
      apiKey,
      timeoutMs: env.LLM_GATEWAY_TIMEOUT_MS,
      usage: currentUsage(health, now),
      health: {
        cooldownUntil: health?.cooldownUntil ?? null,
        consecutiveFailures: health?.consecutiveFailures ?? 0,
        reliability: health?.reliability ?? 1,
      },
    });
  }
  return runtimes;
}
