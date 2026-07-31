/**
 * Super-admin LLM-gateway management + monitoring. Reuses the Prompt-1 gateway
 * models + crypto + adapters; it does NOT touch the router engine. All reads are
 * derived from REAL health counters (never fabricated).
 *
 * SECURITY: an API key is only ever WRITTEN (encrypted at rest) or PROBED
 * server-side. It is never returned to the client, never logged, and the list
 * exposes only a `keySet` boolean. The test-probe reports status/classification
 * only — never a raw provider body that might echo the key.
 */
import {
  AiProviderStatus,
  ProviderHttpError,
  adapterFor,
  type AiProviderAdmin,
  type AiProviderPatch,
  type AiProvidersListResponse,
  type AiProvidersSummary,
  type ChatMessage,
  type ProviderCapability,
  type ProviderKind,
  type ProviderRuntime,
  type TestProviderKeyResponse,
  type UsageTrendDay,
  type UsageTrendFeature,
  type UsageTrendProvider,
  type UsageTrendsResponse,
} from "@codeapt/shared";
import { Types } from "mongoose";

import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import {
  decryptSecret,
  encryptSecret,
  isEncryptionConfigured,
} from "../lib/crypto.js";
import {
  minuteWindowStart,
  utcDayWindowStart,
} from "../lib/llm-gateway/windows.js";
import {
  AiProviderHealthModel,
  AiProviderKeyModel,
  AiProviderModel,
  type AiProviderDoc,
  type AiProviderHealthDoc,
} from "../models/ai-provider.model.js";
import { AiUsageRollupModel } from "../models/ai-usage.model.js";
import { dayBucket } from "../lib/llm-gateway/usage-rollup.js";

const ExamErrorNotFound = "AI_PROVIDER_NOT_FOUND";

function objectId(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) {
    throw new AppError("Provider not found", 404, ExamErrorNotFound);
  }
  return new Types.ObjectId(id);
}

async function loadProvider(id: string): Promise<AiProviderDoc & { _id: Types.ObjectId; save: () => Promise<unknown> }> {
  const doc = await AiProviderModel.findById(objectId(id));
  if (!doc) throw new AppError("Provider not found", 404, ExamErrorNotFound);
  return doc as unknown as AiProviderDoc & {
    _id: Types.ObjectId;
    save: () => Promise<unknown>;
  };
}

// --- Health view (real counters, current window) ----------------------------

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

function deriveStatus(
  enabled: boolean,
  keySet: boolean,
  cooldownUntil: number | null,
  now: number,
): AiProviderStatus {
  if (!enabled) return AiProviderStatus.DISABLED;
  if (!keySet) return AiProviderStatus.NO_KEY;
  if (cooldownUntil != null && cooldownUntil > now) return AiProviderStatus.COOLING_DOWN;
  return AiProviderStatus.HEALTHY;
}

function toAdmin(
  p: AiProviderDoc & { _id: Types.ObjectId },
  keySet: boolean,
  health: AiProviderHealthDoc | undefined,
  now: number,
): AiProviderAdmin {
  const cooldownUntil = health?.cooldownUntil ?? null;
  return {
    id: p._id.toString(),
    name: p.name,
    kind: p.kind as ProviderKind,
    baseUrl: p.baseUrl,
    model: p.model,
    enabled: p.enabled,
    priority: p.priority ?? 100,
    capability: p.capability as ProviderCapability,
    trainsOnData: p.trainsOnData ?? false,
    limits: {
      requestsPerMinute: p.limits?.requestsPerMinute ?? null,
      requestsPerDay: p.limits?.requestsPerDay ?? null,
      tokensPerMinute: p.limits?.tokensPerMinute ?? null,
      tokensPerDay: p.limits?.tokensPerDay ?? null,
    },
    keySet,
    keyUrl: p.keyUrl ? p.keyUrl : null,
    health: {
      status: deriveStatus(p.enabled, keySet, cooldownUntil, now),
      cooldownUntil,
      consecutiveFailures: health?.consecutiveFailures ?? 0,
      reliability: health?.reliability ?? 1,
      lastError: health?.lastError ?? "",
      lastErrorAt: health?.lastErrorAt ? health.lastErrorAt.toISOString() : null,
      lastUsedAt: health?.lastUsedAt ? health.lastUsedAt.toISOString() : null,
      usage: windowUsage(health, now),
    },
  };
}

export async function listProviders(now: number): Promise<AiProvidersListResponse> {
  const providers = await AiProviderModel.find().sort({ priority: 1, _id: 1 });
  const ids = providers.map((p) => p._id);
  const [keys, healths] = await Promise.all([
    AiProviderKeyModel.find({ provider: { $in: ids }, enabled: true }).select("provider"),
    AiProviderHealthModel.find({ provider: { $in: ids } }),
  ]);
  const keyed = new Set(keys.map((k) => k.provider.toString()));
  const healthByProvider = new Map(
    healths.map((h) => [h.provider.toString(), h as AiProviderHealthDoc]),
  );

  const items = providers.map((p) =>
    toAdmin(
      p as AiProviderDoc & { _id: Types.ObjectId },
      keyed.has(p._id.toString()),
      healthByProvider.get(p._id.toString()),
      now,
    ),
  );

  const summary: AiProvidersSummary = {
    total: items.length,
    enabled: items.filter((p) => p.enabled).length,
    keyed: items.filter((p) => p.keySet).length,
    available: items.filter((p) => p.health.status === AiProviderStatus.HEALTHY).length,
    encryptionConfigured: isEncryptionConfigured(),
  };
  return { providers: items, summary };
}

// --- Curated edit -----------------------------------------------------------

export async function patchProvider(
  id: string,
  patch: AiProviderPatch,
  now: number,
): Promise<AiProviderAdmin> {
  const doc = await loadProvider(id);
  if (patch.enabled !== undefined) doc.enabled = patch.enabled;
  if (patch.priority !== undefined) doc.priority = patch.priority;
  if (patch.trainsOnData !== undefined) doc.trainsOnData = patch.trainsOnData;
  if (patch.capability !== undefined) doc.capability = patch.capability;
  if (patch.model !== undefined) doc.model = patch.model;
  if (patch.baseUrl !== undefined) doc.baseUrl = patch.baseUrl;
  if (patch.limits) {
    doc.limits = {
      requestsPerMinute:
        patch.limits.requestsPerMinute !== undefined
          ? patch.limits.requestsPerMinute
          : (doc.limits?.requestsPerMinute ?? null),
      requestsPerDay:
        patch.limits.requestsPerDay !== undefined
          ? patch.limits.requestsPerDay
          : (doc.limits?.requestsPerDay ?? null),
      tokensPerMinute:
        patch.limits.tokensPerMinute !== undefined
          ? patch.limits.tokensPerMinute
          : (doc.limits?.tokensPerMinute ?? null),
      tokensPerDay:
        patch.limits.tokensPerDay !== undefined
          ? patch.limits.tokensPerDay
          : (doc.limits?.tokensPerDay ?? null),
    };
  }
  await doc.save();

  const [keyCount, health] = await Promise.all([
    AiProviderKeyModel.countDocuments({ provider: doc._id, enabled: true }),
    AiProviderHealthModel.findOne({ provider: doc._id }),
  ]);
  return toAdmin(doc, keyCount > 0, health ?? undefined, now);
}

// --- Key management (encrypt at rest; never echo) ---------------------------

export async function setProviderKey(
  id: string,
  plaintextKey: string,
): Promise<{ keySet: true }> {
  if (!isEncryptionConfigured()) {
    throw new AppError(
      "The AI gateway isn't configured — set ENCRYPTION_KEY on the server (see .env.example), then restart, before adding provider keys.",
      400,
      "ENCRYPTION_NOT_CONFIGURED",
    );
  }
  const doc = await loadProvider(id);
  // Replace semantics: one active key per provider.
  await AiProviderKeyModel.deleteMany({ provider: doc._id });
  await AiProviderKeyModel.create({
    provider: doc._id,
    keyCiphertext: encryptSecret(plaintextKey),
    enabled: true,
  });
  return { keySet: true };
}

export async function deleteProviderKey(id: string): Promise<{ keySet: false }> {
  const doc = await loadProvider(id);
  await AiProviderKeyModel.deleteMany({ provider: doc._id });
  return { keySet: false };
}

// --- Live key probe (redacted; never leaks the key/body) --------------------

/** A tiny prompt that a working provider can answer cheaply. */
const PROBE_MESSAGES: ChatMessage[] = [
  { role: "system", content: "Respond with strict JSON only." },
  { role: "user", content: 'Reply with exactly {"ok":true}' },
];

function probeRuntime(
  doc: AiProviderDoc & { _id: Types.ObjectId },
  apiKey: string,
): ProviderRuntime {
  return {
    id: doc._id.toString(),
    name: doc.name,
    kind: doc.kind as ProviderKind,
    baseUrl: doc.baseUrl,
    model: doc.model,
    priority: doc.priority ?? 100,
    capability: doc.capability as ProviderCapability,
    trainsOnData: doc.trainsOnData ?? false,
    limits: {},
    apiKey,
    timeoutMs: env.LLM_GATEWAY_TIMEOUT_MS,
    usage: { minute: { requests: 0, tokens: 0 }, day: { requests: 0, tokens: 0 } },
    health: { cooldownUntil: null, consecutiveFailures: 0, reliability: 1 },
  };
}

export async function testProviderKey(id: string): Promise<TestProviderKeyResponse> {
  const doc = await loadProvider(id);
  const key = await AiProviderKeyModel.findOne({ provider: doc._id, enabled: true });
  if (!key) return { ok: false, message: "No key set for this provider" };

  let apiKey: string;
  try {
    apiKey = decryptSecret(key.keyCiphertext);
  } catch {
    return { ok: false, message: "Stored key could not be decrypted" };
  }

  try {
    await adapterFor(doc.kind as ProviderKind).chatJson(
      probeRuntime(doc, apiKey),
      PROBE_MESSAGES,
    );
    return { ok: true };
  } catch (err) {
    // Redact: return only status + a generic classification, never a body/key.
    if (err instanceof ProviderHttpError) {
      return {
        ok: false,
        status: err.status,
        message: `Provider responded ${err.status} (${err.classification})`,
      };
    }
    return { ok: false, message: "Request to the provider failed" };
  }
}

// --- Usage trends (real rollups — never fabricated) -------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Aggregate the per-day usage rollups into trend series for the admin charts:
 * daily totals (zero-filled across the window so the chart has a clean axis),
 * per-provider + per-feature breakdowns, and cache effectiveness. Everything is
 * summed from real recorded counters; before any AI runs, it returns zeros.
 */
export async function getUsageTrends(
  days: number,
  now: number,
): Promise<UsageTrendsResponse> {
  const windowDays = Math.min(90, Math.max(1, Math.round(days)));
  const startMs = now - (windowDays - 1) * DAY_MS;
  const rows = await AiUsageRollupModel.find({ day: { $gte: dayBucket(startMs) } }).lean();

  const providers = await AiProviderModel.find().select("name").lean();
  const nameById = new Map(providers.map((p) => [p._id.toString(), p.name]));

  // Zero-fill each day in the window (chronological via Map insertion order).
  const byDay = new Map<string, UsageTrendDay>();
  for (let i = 0; i < windowDays; i += 1) {
    const d = dayBucket(startMs + i * DAY_MS);
    byDay.set(d, {
      date: d,
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      cacheHits: 0,
      tokensSaved: 0,
    });
  }
  const byProvider = new Map<string, UsageTrendProvider>();
  const byFeature = new Map<string, UsageTrendFeature>();
  let totalRequests = 0;
  let totalPrompt = 0;
  let totalCompletion = 0;
  let cacheHits = 0;
  let cacheMisses = 0;
  let tokensSaved = 0;

  for (const r of rows) {
    const requests = r.requests ?? 0;
    const prompt = r.promptTokens ?? 0;
    const completion = r.completionTokens ?? 0;
    const hits = r.cacheHits ?? 0;
    const misses = r.cacheMisses ?? 0;
    const saved = r.tokensSaved ?? 0;

    const d = byDay.get(r.day);
    if (d) {
      d.requests += requests;
      d.promptTokens += prompt;
      d.completionTokens += completion;
      d.cacheHits += hits;
      d.tokensSaved += saved;
    }
    totalRequests += requests;
    totalPrompt += prompt;
    totalCompletion += completion;
    cacheHits += hits;
    cacheMisses += misses;
    tokensSaved += saved;

    if (r.provider) {
      const pid = r.provider.toString();
      const cur =
        byProvider.get(pid) ??
        { providerId: pid, name: nameById.get(pid) ?? "(removed)", requests: 0, tokens: 0 };
      cur.requests += requests;
      cur.tokens += prompt + completion;
      byProvider.set(pid, cur);
    }

    const feat = r.feature || "unknown";
    const cf =
      byFeature.get(feat) ??
      { feature: feat, requests: 0, tokens: 0, cacheHits: 0, cacheMisses: 0, tokensSaved: 0 };
    cf.requests += requests;
    cf.tokens += prompt + completion;
    cf.cacheHits += hits;
    cf.cacheMisses += misses;
    cf.tokensSaved += saved;
    byFeature.set(feat, cf);
  }

  return {
    windowDays,
    totals: { requests: totalRequests, promptTokens: totalPrompt, completionTokens: totalCompletion },
    byDay: [...byDay.values()],
    byProvider: [...byProvider.values()].sort((a, b) => b.tokens - a.tokens),
    byFeature: [...byFeature.values()].sort((a, b) => b.requests - a.requests),
    cache: {
      hits: cacheHits,
      misses: cacheMisses,
      hitRate: cacheHits + cacheMisses > 0 ? cacheHits / (cacheHits + cacheMisses) : 0,
      tokensSaved,
    },
  };
}
