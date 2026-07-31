/**
 * AI GOVERNOR service (Stage-2) — the super-admin config + the live status the
 * governor panel renders. Config is a single settings doc merged over the shared
 * defaults. Status is derived from REAL provider health counters (never
 * fabricated): combined-pool headroom, whether shedding is currently active, and
 * the paced-queue depth.
 *
 * The DECISION itself is the pure `governorDecision` in @codeapt/shared, reused
 * unchanged at the gateway seam. This service only reads config + shapes status.
 */
import {
  AI_GOVERNOR_DEFAULTS,
  AI_PACED_MAX_PER_MINUTE,
  computePoolHeadroom,
  governorDecision,
  type AiGovernorConfig,
  type AiGovernorView,
  type PoolProviderSnapshot,
  type SetAiGovernorConfigInput,
} from "@codeapt/shared";

import { getPacedQueueDepth } from "../lib/execution-queue.js";
import {
  minuteWindowStart,
  utcDayWindowStart,
} from "../lib/llm-gateway/windows.js";
import {
  AI_GOVERNOR_CONFIG_KEY,
  AiGovernorConfigModel,
} from "../models/ai-governor.model.js";
import {
  AiProviderHealthModel,
  AiProviderKeyModel,
  AiProviderModel,
  type AiProviderHealthDoc,
} from "../models/ai-provider.model.js";

/** The active config: the stored singleton merged over the shared defaults. */
export async function getGovernorConfig(): Promise<AiGovernorConfig> {
  const doc = await AiGovernorConfigModel.findOne({
    key: AI_GOVERNOR_CONFIG_KEY,
  }).lean();
  return {
    enabled: doc?.enabled ?? AI_GOVERNOR_DEFAULTS.enabled,
    reservePercent: doc?.reservePercent ?? AI_GOVERNOR_DEFAULTS.reservePercent,
    platformReservePercent:
      doc?.platformReservePercent ?? AI_GOVERNOR_DEFAULTS.platformReservePercent,
    shedThreshold: doc?.shedThreshold ?? AI_GOVERNOR_DEFAULTS.shedThreshold,
  };
}

/** Super-admin: patch the governor config (upsert the singleton). */
export async function setGovernorConfig(
  input: SetAiGovernorConfigInput,
): Promise<AiGovernorConfig> {
  const set: Record<string, unknown> = {};
  if (input.enabled !== undefined) set.enabled = input.enabled;
  if (input.reservePercent !== undefined) set.reservePercent = input.reservePercent;
  if (input.platformReservePercent !== undefined)
    set.platformReservePercent = input.platformReservePercent;
  if (input.shedThreshold !== undefined) set.shedThreshold = input.shedThreshold;
  await AiGovernorConfigModel.updateOne(
    { key: AI_GOVERNOR_CONFIG_KEY },
    { $set: set, $setOnInsert: { key: AI_GOVERNOR_CONFIG_KEY } },
    { upsert: true },
  );
  return getGovernorConfig();
}

/** Current-window usage for a provider health doc (stale windows read as 0). */
function windowUsage(health: AiProviderHealthDoc | undefined, now: number) {
  const mFresh = health != null && health.minuteWindowStart === minuteWindowStart(now);
  const dFresh = health != null && health.dayWindowStart === utcDayWindowStart(now);
  return {
    minute: {
      requests: mFresh ? health!.minuteRequests : 0,
      tokens: mFresh ? health!.minuteTokens : 0,
    },
    day: {
      requests: dFresh ? health!.dayRequests : 0,
      tokens: dFresh ? health!.dayTokens : 0,
    },
  };
}

/**
 * Build pool snapshots from the ENABLED + KEYED providers (the same set the
 * router draws from) using their health counters — no key decryption needed for
 * a read-only headroom view.
 */
async function loadPoolSnapshots(
  now: number,
): Promise<{ snapshots: PoolProviderSnapshot[]; providerCount: number }> {
  const providers = await AiProviderModel.find({ enabled: true }).lean();
  if (providers.length === 0) return { snapshots: [], providerCount: 0 };
  const ids = providers.map((p) => p._id);
  const [keys, healths] = await Promise.all([
    AiProviderKeyModel.find({ provider: { $in: ids }, enabled: true })
      .select("provider")
      .lean(),
    AiProviderHealthModel.find({ provider: { $in: ids } }).lean(),
  ]);
  const keyed = new Set(keys.map((k) => k.provider.toString()));
  const healthByProvider = new Map(
    healths.map((h) => [h.provider.toString(), h as AiProviderHealthDoc]),
  );

  const snapshots: PoolProviderSnapshot[] = [];
  for (const p of providers) {
    const pid = p._id.toString();
    if (!keyed.has(pid)) continue; // no key → the router can't use it
    snapshots.push({
      limits: {
        requestsPerMinute: p.limits?.requestsPerMinute ?? undefined,
        requestsPerDay: p.limits?.requestsPerDay ?? undefined,
        tokensPerMinute: p.limits?.tokensPerMinute ?? undefined,
        tokensPerDay: p.limits?.tokensPerDay ?? undefined,
      },
      usage: windowUsage(healthByProvider.get(pid), now),
    });
  }
  return { snapshots, providerCount: snapshots.length };
}

/** The governor panel view: config + live headroom + shedding state + queue depth. */
export async function getGovernorView(now: number): Promise<AiGovernorView> {
  const [config, pool] = await Promise.all([
    getGovernorConfig(),
    loadPoolSnapshots(now),
  ]);
  const headroom = computePoolHeadroom(pool.snapshots);

  // Shedding is "active" when a DEFERRABLE college call would be shed right now.
  const decision = governorDecision({
    headroom,
    config,
    isPlatform: false,
    kind: "generation",
  });
  const sheddingActive = config.enabled && decision.action === "shed";

  let pacedQueueDepth = 0;
  try {
    pacedQueueDepth = await getPacedQueueDepth();
  } catch {
    // Redis unavailable → report 0 rather than failing the whole panel.
    pacedQueueDepth = 0;
  }

  return {
    config,
    headroom,
    sheddingActive,
    pacedQueueDepth,
    pacedMaxPerMinute: AI_PACED_MAX_PER_MINUTE,
    providerCount: pool.providerCount,
  };
}
