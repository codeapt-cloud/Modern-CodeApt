/**
 * LLM Gateway — the DB-backed layer + seam integration. Proves: keys are
 * encrypted at rest (round-trip, never plaintext), the catalog seeds
 * idempotently, provider-source decrypts + skips keyless/disabled providers,
 * usage counters increment + reset on the window boundary + cooldown is
 * recorded, the gateway routes end-to-end through real adapters (with a stubbed
 * fetch) including failover, and — crucially — the existing `callLlmChatJson`
 * seam transparently routes through the gateway once installed, unchanged
 * signature. No real network. supertest not needed — this is service-level.
 */
import {
  callLlmChatJson,
  registerLlmRouter,
} from "@codeapt/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { decryptSecret, encryptSecret } from "../src/lib/crypto.js";
import { gatewayCallLlmChatJson } from "../src/lib/llm-gateway/gateway.js";
import { installLlmGateway } from "../src/lib/llm-gateway/index.js";
import { loadProviderRuntimes } from "../src/lib/llm-gateway/provider-source.js";
import { recordFailure, recordSuccess } from "../src/lib/llm-gateway/persist.js";
import {
  recordCacheHit,
  recordProviderUsage,
} from "../src/lib/llm-gateway/usage-rollup.js";
import { seedAiProviders } from "../src/lib/llm-gateway/seed.js";
import { PROVIDER_CATALOG } from "../src/lib/llm-gateway/catalog.js";
import { getUsageTrends } from "../src/services/ai-provider-admin.service.js";
import {
  AiProviderHealthModel,
  AiProviderKeyModel,
  AiProviderModel,
} from "../src/models/ai-provider.model.js";
import {
  AiResponseCacheModel,
  AiUsageRollupModel,
} from "../src/models/ai-usage.model.js";

async function makeProvider(over: {
  name?: string;
  baseUrl?: string;
  priority?: number;
  enabled?: boolean;
  trainsOnData?: boolean;
  key?: string | null; // null = no key
  limits?: Record<string, number>;
}) {
  const p = await AiProviderModel.create({
    name: over.name ?? "Test Provider",
    kind: "openai_compat",
    baseUrl: over.baseUrl ?? "https://prov.test/v1",
    model: "test-model",
    enabled: over.enabled ?? true,
    priority: over.priority ?? 10,
    capability: "fast",
    trainsOnData: over.trainsOnData ?? false,
    limits: over.limits ?? {},
  });
  if (over.key !== null) {
    await AiProviderKeyModel.create({
      provider: p._id,
      keyCiphertext: encryptSecret(over.key ?? "sk-secret-123"),
      enabled: true,
    });
  }
  return p;
}

function openAiFetchOk(content: string) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
    text: async () => "",
  }));
}

// ---------------------------------------------------------------------------

describe("crypto — encrypt at rest", () => {
  it("round-trips and never exposes plaintext in the blob", () => {
    const secret = "sk-live-super-secret-value-xyz";
    const blob = encryptSecret(secret);
    expect(blob).not.toContain(secret);
    expect(blob.startsWith("v1:")).toBe(true);
    expect(decryptSecret(blob)).toBe(secret);
  });
  it("produces distinct ciphertext per call (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });
  it("throws on a tampered / malformed blob", () => {
    const blob = encryptSecret("secret");
    const tampered = blob.slice(0, -4) + "AAAA";
    expect(() => decryptSecret(tampered)).toThrow();
    expect(() => decryptSecret("garbage")).toThrow();
  });
});

describe("seedAiProviders — idempotent", () => {
  it("seeds the catalog once and never duplicates on re-run", async () => {
    const first = await seedAiProviders();
    expect(first.created).toBe(PROVIDER_CATALOG.length);
    const second = await seedAiProviders();
    expect(second.created).toBe(0);
    expect(await AiProviderModel.countDocuments()).toBe(PROVIDER_CATALOG.length);
  });
});

describe("loadProviderRuntimes", () => {
  it("returns a decrypted runtime and skips keyless / disabled providers", async () => {
    await makeProvider({ name: "Has Key", baseUrl: "https://has.test/v1", key: "sk-abc" });
    await makeProvider({ name: "No Key", key: null });
    await makeProvider({ name: "Disabled", enabled: false, key: "sk-x" });

    const runtimes = await loadProviderRuntimes(Date.now());
    expect(runtimes.map((r) => r.name)).toEqual(["Has Key"]);
    expect(runtimes[0]!.apiKey).toBe("sk-abc"); // decrypted for use
    expect(runtimes[0]!.timeoutMs).toBeGreaterThan(0);
  });
});

describe("usage counters + windows", () => {
  it("increments per window and resets on the boundary; failure sets cooldown", async () => {
    const p = await makeProvider({ name: "Counter", key: "sk" });
    const id = p._id.toString();
    const t0 = Date.UTC(2026, 0, 15, 12, 0, 0);

    await recordSuccess(id, { promptTokens: 3, completionTokens: 2 }, t0);
    await recordSuccess(id, { promptTokens: 1, completionTokens: 1 }, t0 + 1_000);
    let h = await AiProviderHealthModel.findOne({ provider: id });
    expect(h!.minuteRequests).toBe(2);
    expect(h!.dayRequests).toBe(2);
    expect(h!.minuteTokens).toBe(7);

    // +61s → new minute window resets the minute counters; day persists.
    await recordSuccess(id, { promptTokens: 0, completionTokens: 0 }, t0 + 61_000);
    h = await AiProviderHealthModel.findOne({ provider: id });
    expect(h!.minuteRequests).toBe(1);
    expect(h!.dayRequests).toBe(3);

    // Hard failure benches the provider + counts the attempt.
    await recordFailure(id, t0 + 61_000 + 5_000, t0 + 61_000, "429");
    h = await AiProviderHealthModel.findOne({ provider: id });
    expect(h!.cooldownUntil).toBe(t0 + 61_000 + 5_000);
    expect(h!.minuteRequests).toBe(2);
    expect(h!.consecutiveFailures).toBe(1);
  });
});

describe("gatewayCallLlmChatJson (end-to-end, stubbed fetch)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("routes to the provider, returns parsed JSON, records usage", async () => {
    const p = await makeProvider({ name: "Live", baseUrl: "https://live.test/v1", key: "sk-live" });
    vi.stubGlobal("fetch", openAiFetchOk('{"answer":42}'));

    const out = await gatewayCallLlmChatJson("system", "user", { kind: "generation" });
    expect(out).toEqual({ answer: 42 });

    const h = await AiProviderHealthModel.findOne({ provider: p._id });
    expect(h!.dayRequests).toBe(1);
    expect(h!.dayTokens).toBe(15);
  });

  it("fails over from a 429 provider to the next and benches the first", async () => {
    const a = await makeProvider({ name: "A", baseUrl: "https://a.test/v1", priority: 10, key: "sk-a" });
    await makeProvider({ name: "B", baseUrl: "https://b.test/v1", priority: 20, key: "sk-b" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("a.test")) {
          return {
            ok: false,
            status: 429,
            headers: { get: (k: string) => (k.toLowerCase() === "retry-after" ? "30" : null) },
            json: async () => ({}),
            text: async () => "rate limited",
          };
        }
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ choices: [{ message: { content: '{"from":"b"}' } }], usage: {} }),
          text: async () => "",
        };
      }),
    );

    const out = await gatewayCallLlmChatJson("s", "u", { kind: "generation" });
    expect(out).toEqual({ from: "b" });
    const ha = await AiProviderHealthModel.findOne({ provider: a._id });
    expect(ha!.cooldownUntil).not.toBeNull(); // A benched
  });

  it("returns null (graceful) when there are no usable providers", async () => {
    await makeProvider({ name: "NoKey", key: null });
    const out = await gatewayCallLlmChatJson("s", "u", { kind: "generation" });
    expect(out).toBeNull();
  });
});

describe("response cache + usage rollups (token optimization)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("serves an identical request from cache (zero provider calls) + records tokens saved", async () => {
    await makeProvider({ name: "Cacher", baseUrl: "https://cache.test/v1", key: "sk" });
    const fetchMock = openAiFetchOk('{"answer":7}'); // usage: 10 prompt + 5 completion
    vi.stubGlobal("fetch", fetchMock);

    const first = await gatewayCallLlmChatJson("sys", "userA", { kind: "generation", feature: "keywords" });
    expect(first).toEqual({ answer: 7 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Identical request → cache HIT, no new provider call, same result.
    const second = await gatewayCallLlmChatJson("sys", "userA", { kind: "generation", feature: "keywords" });
    expect(second).toEqual({ answer: 7 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const rollups = await AiUsageRollupModel.find({ feature: "keywords" }).lean();
    const hitRows = rollups.filter((r) => r.provider === null);
    const missRows = rollups.filter((r) => r.provider !== null);
    expect(hitRows.reduce((n, r) => n + (r.cacheHits ?? 0), 0)).toBe(1);
    expect(hitRows.reduce((n, r) => n + (r.tokensSaved ?? 0), 0)).toBe(15);
    expect(missRows.reduce((n, r) => n + (r.cacheMisses ?? 0), 0)).toBe(1);
  });

  it("keys on the EXACT request — a different prompt is a miss (never a wrong hit)", async () => {
    await makeProvider({ name: "K", baseUrl: "https://k.test/v1", key: "sk" });
    const fetchMock = openAiFetchOk('{"v":1}');
    vi.stubGlobal("fetch", fetchMock);
    await gatewayCallLlmChatJson("sys", "prompt-one", { kind: "generation" });
    await gatewayCallLlmChatJson("sys", "prompt-two", { kind: "generation" });
    expect(fetchMock).toHaveBeenCalledTimes(2); // distinct prompts → two live calls
    expect(await AiResponseCacheModel.countDocuments()).toBe(2);
  });

  it("never caches an error (unparseable 2xx → nothing stored, retried next time)", async () => {
    await makeProvider({ name: "Err", baseUrl: "https://err.test/v1", key: "sk" });
    vi.stubGlobal("fetch", openAiFetchOk("not json at all"));
    const out = await gatewayCallLlmChatJson("sys", "err-prompt", { kind: "generation" });
    expect(out).toBeNull();
    expect(await AiResponseCacheModel.countDocuments()).toBe(0);
  });

  it("does not cache when policy.cacheable === false", async () => {
    await makeProvider({ name: "NoCache", baseUrl: "https://nc.test/v1", key: "sk" });
    vi.stubGlobal("fetch", openAiFetchOk('{"x":1}'));
    await gatewayCallLlmChatJson("sys", "u", { kind: "generation", cacheable: false });
    expect(await AiResponseCacheModel.countDocuments()).toBe(0);
  });

  it("applies the resolved max_tokens on the wire", async () => {
    await makeProvider({ name: "MT", baseUrl: "https://mt.test/v1", key: "sk" });
    const fetchMock = openAiFetchOk('{"ok":true}');
    vi.stubGlobal("fetch", fetchMock);
    await gatewayCallLlmChatJson("sys", "mt-user", { kind: "generation", maxTokens: 256, cacheable: false });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.max_tokens).toBe(256);
  });
});

describe("getUsageTrends (real rollups → trend shaping)", () => {
  it("aggregates daily totals, per-provider, per-feature + cache hit-rate", async () => {
    const p = await makeProvider({ name: "TrendProv", key: "sk" });
    const now = Date.UTC(2026, 5, 15, 12, 0, 0);
    await recordProviderUsage(p._id.toString(), "keywords", { promptTokens: 10, completionTokens: 5 }, true, now);
    await recordProviderUsage(p._id.toString(), "keywords", { promptTokens: 20, completionTokens: 10 }, true, now);
    await recordCacheHit("keywords", 15, now);

    const trends = await getUsageTrends(7, now);
    expect(trends.totals).toEqual({ requests: 2, promptTokens: 30, completionTokens: 15 });
    expect(trends.cache).toMatchObject({ hits: 1, misses: 2, tokensSaved: 15 });
    expect(trends.cache.hitRate).toBeCloseTo(1 / 3, 5);
    expect(trends.byProvider[0]).toMatchObject({ name: "TrendProv", requests: 2, tokens: 45 });
    expect(trends.byFeature[0]).toMatchObject({
      feature: "keywords",
      requests: 2,
      cacheHits: 1,
      cacheMisses: 2,
      tokensSaved: 15,
    });
    expect(trends.byDay).toHaveLength(7);
    const today = trends.byDay[trends.byDay.length - 1]!;
    expect(today.requests).toBe(2);
    expect(today.tokensSaved).toBe(15);
  });

  it("returns zeros (clean empty state) before any usage accrues", async () => {
    const trends = await getUsageTrends(3, Date.UTC(2026, 5, 20, 0, 0, 0));
    expect(trends.totals.requests).toBe(0);
    expect(trends.cache.hitRate).toBe(0);
    expect(trends.byDay).toHaveLength(3);
    expect(trends.byProvider).toEqual([]);
  });
});

describe("seam — callLlmChatJson routes through the installed gateway", () => {
  afterEach(() => {
    registerLlmRouter(null);
    vi.unstubAllGlobals();
  });

  it("routes an unchanged callLlmChatJson call through the gateway (config ignored)", async () => {
    await makeProvider({ name: "Seam", baseUrl: "https://seam.test/v1", key: "sk-seam" });
    vi.stubGlobal("fetch", openAiFetchOk('{"viaGateway":true}'));
    installLlmGateway();

    // The legacy config arg is intentionally empty — the gateway ignores it and
    // uses DB providers. Callers pass exactly what they always have (+ policy).
    const out = await callLlmChatJson(
      { url: undefined, apiKey: undefined, model: "unused", timeoutMs: 1000 },
      "system",
      "user",
      { kind: "generation" },
    );
    expect(out).toEqual({ viaGateway: true });
  });

  it("passes the task policy through the seam to the router", async () => {
    const seen: unknown[] = [];
    registerLlmRouter(async (_s, _u, policy) => {
      seen.push(policy);
      return { ok: true };
    });
    const out = await callLlmChatJson({ model: "m", timeoutMs: 1 }, "s", "u", {
      kind: "grading",
      sensitive: true,
    });
    expect(out).toEqual({ ok: true });
    expect(seen[0]).toEqual({ kind: "grading", sensitive: true });
  });

  it("never throws even if the router misbehaves (graceful null)", async () => {
    registerLlmRouter(async () => {
      throw new Error("boom");
    });
    const out = await callLlmChatJson({ model: "m", timeoutMs: 1 }, "s", "u");
    expect(out).toBeNull();
  });
});
