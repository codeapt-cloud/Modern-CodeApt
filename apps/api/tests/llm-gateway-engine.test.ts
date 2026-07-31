/**
 * LLM Gateway — the PURE engine from @codeapt/shared (no DB, no network): the
 * Retry-After parser (seconds / HTTP-date / 24h clamp), cooldown math, headroom
 * gate, provider selection (priority vs stability, sensitive-excludes-training),
 * the failover router (bench + next / exhaustion), and the provider adapters
 * (success → usage; 429 → typed error with Retry-After; quota body → daily).
 * Adapters are exercised with a stubbed global fetch — no real network.
 */
import {
  MAX_RETRY_AFTER_MS,
  ProviderCapability,
  ProviderHttpError,
  ProviderKind,
  cohereAdapter,
  cloudflareAdapter,
  cooldownUntilFor,
  googleAdapter,
  HARD_MAX_OUTPUT_TOKENS,
  hasHeadroom,
  nextUtcDayResetMs,
  openAiCompatAdapter,
  parseLlmJson,
  parseRetryAfterMs,
  resolveMaxTokens,
  providerScore,
  routeChatJson,
  selectProviders,
  type ProviderRuntime,
} from "@codeapt/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function pr(o: Partial<ProviderRuntime> = {}): ProviderRuntime {
  return {
    id: o.id ?? "p",
    name: o.name ?? "P",
    kind: o.kind ?? ProviderKind.OPENAI_COMPAT,
    baseUrl: o.baseUrl ?? "https://api.example.com/v1",
    model: o.model ?? "m",
    priority: o.priority ?? 10,
    capability: o.capability ?? ProviderCapability.FAST,
    trainsOnData: o.trainsOnData ?? false,
    limits: o.limits ?? {},
    apiKey: o.apiKey ?? "key",
    timeoutMs: o.timeoutMs ?? 1000,
    maxTokens: o.maxTokens,
    usage: o.usage ?? { minute: { requests: 0, tokens: 0 }, day: { requests: 0, tokens: 0 } },
    health: o.health ?? { cooldownUntil: null, consecutiveFailures: 0, reliability: 1 },
  };
}

function fakeRes(opts: {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}) {
  const status = opts.status ?? 200;
  const headers = opts.headers ?? {};
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => opts.body,
    text: async () =>
      typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body ?? {}),
  } as unknown as Response;
}

const NOW = Date.UTC(2026, 0, 15, 12, 30, 0); // a fixed, whole-second instant

// ---------------------------------------------------------------------------

describe("parseRetryAfterMs", () => {
  it("parses delta-seconds", () => {
    expect(parseRetryAfterMs("120", NOW)).toBe(120_000);
    expect(parseRetryAfterMs("0", NOW)).toBe(0);
  });
  it("parses an HTTP-date into a delta", () => {
    const header = new Date(NOW + 5_000).toUTCString();
    expect(parseRetryAfterMs(header, NOW)).toBe(5_000);
  });
  it("clamps to 24h and rejects junk / null", () => {
    expect(parseRetryAfterMs("9999999", NOW)).toBe(MAX_RETRY_AFTER_MS); // ~115 days
    expect(parseRetryAfterMs("soon", NOW)).toBeNull();
    expect(parseRetryAfterMs(null, NOW)).toBeNull();
    expect(parseRetryAfterMs("", NOW)).toBeNull();
  });
});

describe("cooldownUntilFor", () => {
  const err = (o: Partial<ConstructorParameters<typeof ProviderHttpError>[1]> & { retryAfterMs?: number | null }) =>
    new ProviderHttpError("x", {
      status: o.status ?? 429,
      classification: o.classification ?? "rate_limit",
      daily: o.daily,
      retryAfterMs: o.retryAfterMs ?? null,
    });

  it("honors an explicit Retry-After above all else", () => {
    expect(cooldownUntilFor(err({ retryAfterMs: 7_000 }), NOW)).toBe(NOW + 7_000);
  });
  it("benches a daily/quota rate-limit until the next UTC midnight", () => {
    expect(cooldownUntilFor(err({ daily: true }), NOW)).toBe(nextUtcDayResetMs(NOW));
  });
  it("uses short/medium defaults for minute / transient / fatal", () => {
    expect(cooldownUntilFor(err({}), NOW)).toBe(NOW + 60_000);
    expect(cooldownUntilFor(err({ classification: "transient" }), NOW)).toBe(NOW + 30_000);
    expect(cooldownUntilFor(err({ classification: "fatal" }), NOW)).toBe(NOW + 600_000);
  });
});

describe("headroom + score", () => {
  it("skips a provider at its daily request cap", () => {
    const capped = pr({ limits: { requestsPerDay: 50 }, usage: { minute: { requests: 0, tokens: 0 }, day: { requests: 50, tokens: 0 } } });
    expect(hasHeadroom(capped)).toBe(false);
    expect(hasHeadroom(pr({ limits: { requestsPerDay: 50 } }))).toBe(true);
  });
  it("weights score by reliability × remaining headroom", () => {
    const a = pr({ health: { cooldownUntil: null, consecutiveFailures: 0, reliability: 1 }, limits: { requestsPerDay: 100 }, usage: { minute: { requests: 0, tokens: 0 }, day: { requests: 0, tokens: 0 } } });
    const b = pr({ health: { cooldownUntil: null, consecutiveFailures: 0, reliability: 0.5 }, limits: { requestsPerDay: 100 }, usage: { minute: { requests: 0, tokens: 0 }, day: { requests: 50, tokens: 0 } } });
    expect(providerScore(a)).toBeGreaterThan(providerScore(b));
  });
});

describe("selectProviders", () => {
  it("excludes no-key / in-cooldown / no-headroom providers", () => {
    const ok = pr({ id: "ok", priority: 10 });
    const noKey = pr({ id: "nokey", apiKey: "" });
    const cooling = pr({ id: "cool", health: { cooldownUntil: NOW + 10_000, consecutiveFailures: 1, reliability: 1 } });
    const capped = pr({ id: "capped", limits: { requestsPerDay: 5 }, usage: { minute: { requests: 0, tokens: 0 }, day: { requests: 5, tokens: 0 } } });
    const chain = selectProviders([ok, noKey, cooling, capped], { kind: "generation" }, NOW);
    expect(chain.map((p) => p.id)).toEqual(["ok"]);
  });

  it("generation orders by priority asc", () => {
    const chain = selectProviders(
      [pr({ id: "c", priority: 30 }), pr({ id: "a", priority: 10 }), pr({ id: "b", priority: 20 })],
      { kind: "generation" },
      NOW,
    );
    expect(chain.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("grading prefers the most STABLE (reliable) provider, others as fallback", () => {
    const stable = pr({ id: "stable", priority: 90, health: { cooldownUntil: null, consecutiveFailures: 0, reliability: 0.99 } });
    const fast = pr({ id: "fast", priority: 10, health: { cooldownUntil: null, consecutiveFailures: 0, reliability: 0.6 } });
    const chain = selectProviders([fast, stable], { kind: "grading" }, NOW);
    expect(chain[0]!.id).toBe("stable");
    expect(chain[1]!.id).toBe("fast"); // still available as fallback
  });

  it("sensitive tasks EXCLUDE providers that train on data", () => {
    const safe = pr({ id: "safe", trainsOnData: false, priority: 20 });
    const trains = pr({ id: "trains", trainsOnData: true, priority: 10 });
    expect(selectProviders([trains, safe], { kind: "grading", sensitive: true }, NOW).map((p) => p.id)).toEqual(["safe"]);
    // Non-sensitive → training provider is allowed (and higher priority first).
    expect(selectProviders([trains, safe], { kind: "generation" }, NOW).map((p) => p.id)).toEqual(["trains", "safe"]);
  });

  it("capability preference ranks matching providers first (above priority) for generation", () => {
    const capable = pr({ id: "cap", priority: 10, capability: ProviderCapability.CAPABLE });
    const fast = pr({ id: "fast", priority: 20, capability: ProviderCapability.FAST });
    // Prefer FAST → fast sorts first DESPITE its worse priority; capable stays as fallback.
    expect(
      selectProviders([capable, fast], { kind: "generation", capability: ProviderCapability.FAST }, NOW).map((p) => p.id),
    ).toEqual(["fast", "cap"]);
    // No preference → pure priority order (behavior unchanged).
    expect(
      selectProviders([fast, capable], { kind: "generation" }, NOW).map((p) => p.id),
    ).toEqual(["cap", "fast"]);
  });

  it("grading keeps reliability (stability) ABOVE a capability preference", () => {
    const stable = pr({ id: "stable", capability: ProviderCapability.FAST, health: { cooldownUntil: null, consecutiveFailures: 0, reliability: 0.99 } });
    const capable = pr({ id: "capable", capability: ProviderCapability.CAPABLE, health: { cooldownUntil: null, consecutiveFailures: 0, reliability: 0.6 } });
    const chain = selectProviders([capable, stable], { kind: "grading", capability: ProviderCapability.CAPABLE }, NOW);
    expect(chain[0]!.id).toBe("stable"); // stability wins even though it isn't the preferred capability
  });

  it("still excludes trainsOnData for sensitive tasks even with a capability preference", () => {
    const trains = pr({ id: "trains", trainsOnData: true, capability: ProviderCapability.CAPABLE });
    const safe = pr({ id: "safe", trainsOnData: false, capability: ProviderCapability.FAST });
    expect(
      selectProviders([trains, safe], { kind: "grading", sensitive: true, capability: ProviderCapability.CAPABLE }, NOW).map((p) => p.id),
    ).toEqual(["safe"]);
  });
});

describe("resolveMaxTokens (per-task output budget)", () => {
  it("applies sensible per-task defaults", () => {
    expect(resolveMaxTokens({ kind: "grading" })).toBe(512);
    expect(resolveMaxTokens({ kind: "generation" })).toBe(1024);
    expect(resolveMaxTokens(undefined)).toBe(1024);
  });
  it("honors an explicit budget, clamped to [floor, hard ceiling]", () => {
    expect(resolveMaxTokens({ kind: "generation", maxTokens: 256 })).toBe(256);
    expect(resolveMaxTokens({ kind: "generation", maxTokens: 999_999 })).toBe(HARD_MAX_OUTPUT_TOKENS);
    expect(resolveMaxTokens({ kind: "generation", maxTokens: 1 })).toBe(64);
  });
});

describe("routeChatJson (failover)", () => {
  const usage = { promptTokens: 1, completionTokens: 1 };

  it("returns the first available provider's parsed JSON, no failover", async () => {
    const onSuccess = vi.fn();
    const onFailure = vi.fn();
    const out = await routeChatJson({
      providers: [pr({ id: "a", priority: 10 }), pr({ id: "b", priority: 20 })],
      policy: { kind: "generation" },
      now: NOW,
      callAdapter: async (p) => ({ content: `{"who":"${p.id}"}`, usage }),
      onSuccess,
      onFailure,
      parse: (c) => JSON.parse(c),
    });
    expect(out).toEqual({ who: "a" });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("benches a 429 provider and fails over to the next", async () => {
    const onFailure = vi.fn();
    const out = await routeChatJson({
      providers: [pr({ id: "a", priority: 10 }), pr({ id: "b", priority: 20 })],
      policy: { kind: "generation" },
      now: NOW,
      callAdapter: async (p) => {
        if (p.id === "a") {
          throw new ProviderHttpError("429", { status: 429, classification: "rate_limit", retryAfterMs: 5_000 });
        }
        return { content: `{"who":"${p.id}"}`, usage };
      },
      onSuccess: vi.fn(),
      onFailure,
      parse: (c) => JSON.parse(c),
    });
    expect(out).toEqual({ who: "b" });
    expect(onFailure).toHaveBeenCalledTimes(1);
    // a benched until NOW + Retry-After.
    expect(onFailure.mock.calls[0]![1]).toBe(NOW + 5_000);
  });

  it("returns null when every provider is exhausted (graceful)", async () => {
    const out = await routeChatJson({
      providers: [pr({ id: "a" }), pr({ id: "b" })],
      policy: { kind: "generation" },
      now: NOW,
      callAdapter: async () => {
        throw new ProviderHttpError("429", { status: 429, classification: "rate_limit" });
      },
      onSuccess: vi.fn(),
      onFailure: vi.fn(),
      parse: (c) => JSON.parse(c),
    });
    expect(out).toBeNull();
  });

  it("treats an unparseable 2xx as a soft failure (no bench) and tries the next", async () => {
    const onFailure = vi.fn();
    const out = await routeChatJson({
      providers: [pr({ id: "a", priority: 10 }), pr({ id: "b", priority: 20 })],
      policy: { kind: "generation" },
      now: NOW,
      callAdapter: async (p) => ({ content: p.id === "a" ? "not json" : '{"ok":true}', usage }),
      onSuccess: vi.fn(),
      onFailure,
      parse: (c) => {
        try {
          return JSON.parse(c);
        } catch {
          return null;
        }
      },
    });
    expect(out).toEqual({ ok: true });
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0]![1]).toBeNull(); // soft failure → no cooldown
  });
});

describe("adapters (stubbed fetch)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("openai-compat: success maps content + usage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeRes({
          body: {
            choices: [{ message: { content: '{"a":1}' } }],
            usage: { prompt_tokens: 12, completion_tokens: 8 },
          },
        }),
      ),
    );
    const r = await openAiCompatAdapter.chatJson(pr(), [{ role: "user", content: "hi" }]);
    expect(r.content).toBe('{"a":1}');
    expect(r.usage).toEqual({ promptTokens: 12, completionTokens: 8 });
  });

  it("openai-compat: sends max_tokens when the provider carries a budget (omitted otherwise)", async () => {
    const withBudget = vi.fn(async () =>
      fakeRes({ body: { choices: [{ message: { content: "{}" } }], usage: {} } }),
    );
    vi.stubGlobal("fetch", withBudget);
    await openAiCompatAdapter.chatJson(pr({ maxTokens: 321 }), [{ role: "user", content: "hi" }]);
    const body1 = JSON.parse((withBudget.mock.calls[0]![1] as RequestInit).body as string);
    expect(body1.max_tokens).toBe(321);

    const noBudget = vi.fn(async () =>
      fakeRes({ body: { choices: [{ message: { content: "{}" } }], usage: {} } }),
    );
    vi.stubGlobal("fetch", noBudget);
    await openAiCompatAdapter.chatJson(pr(), [{ role: "user", content: "hi" }]);
    const body2 = JSON.parse((noBudget.mock.calls[0]![1] as RequestInit).body as string);
    expect(body2.max_tokens).toBeUndefined();
  });

  it("openai-compat: 429 with Retry-After → typed rate-limit error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeRes({ status: 429, headers: { "retry-after": "42" }, body: "slow down" })),
    );
    await expect(
      openAiCompatAdapter.chatJson(pr(), [{ role: "user", content: "hi" }]),
    ).rejects.toMatchObject({ status: 429, classification: "rate_limit", retryAfterMs: 42_000, daily: false });
  });

  it("openai-compat: a quota body marks the rate-limit as daily", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeRes({ status: 429, body: "You exceeded your daily quota" })),
    );
    await expect(
      openAiCompatAdapter.chatJson(pr(), [{ role: "user", content: "hi" }]),
    ).rejects.toMatchObject({ classification: "rate_limit", daily: true });
  });

  it("google: maps candidates + usageMetadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeRes({
          body: {
            candidates: [{ content: { parts: [{ text: '{"g":1}' }] } }],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 },
          },
        }),
      ),
    );
    const r = await googleAdapter.chatJson(pr({ kind: ProviderKind.GOOGLE }), [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ]);
    expect(r.content).toBe('{"g":1}');
    expect(r.usage).toEqual({ promptTokens: 5, completionTokens: 3 });
  });

  it("cohere: maps message.content[].text + usage.tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeRes({
          body: { message: { content: [{ text: '{"c":' }, { text: "1}" }] }, usage: { tokens: { input_tokens: 4, output_tokens: 2 } } },
        }),
      ),
    );
    const r = await cohereAdapter.chatJson(pr({ kind: ProviderKind.COHERE }), [{ role: "user", content: "hi" }]);
    expect(r.content).toBe('{"c":1}');
    expect(r.usage).toEqual({ promptTokens: 4, completionTokens: 2 });
  });

  it("cloudflare: maps result.response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeRes({ body: { result: { response: '{"cf":1}' } } })),
    );
    const r = await cloudflareAdapter.chatJson(pr({ kind: ProviderKind.CLOUDFLARE }), [{ role: "user", content: "hi" }]);
    expect(r.content).toBe('{"cf":1}');
    expect(r.usage).toEqual({ promptTokens: 0, completionTokens: 0 });
  });
});

// ---------------------------------------------------------------------------
// Tolerant JSON extraction (the "2xx but unparseable" fix)
// ---------------------------------------------------------------------------

describe("parseLlmJson (tolerant extraction)", () => {
  it("parses a clean JSON string unchanged (working providers unaffected)", () => {
    expect(parseLlmJson('{"ok":true}')).toEqual({ ok: true });
    expect(parseLlmJson('  {"a":1,"b":[2,3]}  ')).toEqual({ a: 1, b: [2, 3] });
    expect(parseLlmJson("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("strips a ```json fenced block (Gemma/Cloudflare style)", () => {
    expect(parseLlmJson('```json\n{"ok":true}\n```')).toEqual({ ok: true });
    expect(parseLlmJson('```\n{"ok":true}\n```')).toEqual({ ok: true });
    // Preamble + fence together.
    expect(parseLlmJson('Sure! Here is the JSON:\n```json\n{"ok":true}\n```')).toEqual({
      ok: true,
    });
  });

  it("recovers JSON with leading preamble and trailing prose (stray braces)", () => {
    // The old first-{ to last-} slice broke on a trailing brace like this.
    expect(
      parseLlmJson('Here you go: {"ok":true}\n\nNote: valid JSON looks like {example}.'),
    ).toEqual({ ok: true });
  });

  it("skips a non-JSON balanced span and returns the first that parses", () => {
    expect(parseLlmJson('prose {not json} then {"ok":true}')).toEqual({ ok: true });
  });

  it("does not miscount braces inside string values", () => {
    expect(parseLlmJson('{"note":"has a } and { inside","ok":true}')).toEqual({
      note: "has a } and { inside",
      ok: true,
    });
  });

  it("strips a UTF-8 BOM", () => {
    expect(parseLlmJson('﻿{"ok":true}')).toEqual({ ok: true });
  });

  it("returns null for genuine non-JSON / empty / non-string (real parse error)", () => {
    expect(parseLlmJson("hello world, no json here")).toBeNull();
    expect(parseLlmJson("{ not: valid, json")).toBeNull();
    expect(parseLlmJson("")).toBeNull();
    expect(parseLlmJson("   ")).toBeNull();
    expect(parseLlmJson(undefined)).toBeNull();
    expect(parseLlmJson(null)).toBeNull();
    expect(parseLlmJson(42)).toBeNull();
  });
});

describe("adapter content extraction + tolerant parse (real-shape bodies)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("google/Gemma: extracts fenced content from candidates[].parts[].text, then parses", async () => {
    // Gemma commonly ignores responseMimeType and wraps its answer in a fence.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeRes({
          body: {
            candidates: [
              { content: { parts: [{ text: '```json\n{"ok":true}\n```' }], role: "model" } },
            ],
            usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 9 },
          },
        }),
      ),
    );
    const r = await googleAdapter.chatJson(pr({ kind: ProviderKind.GOOGLE }), [
      { role: "system", content: "Respond with strict JSON only." },
      { role: "user", content: 'Reply with exactly {"ok":true}' },
    ]);
    // The adapter faithfully returns the raw (wrapped) content…
    expect(r.content).toBe('```json\n{"ok":true}\n```');
    expect(r.usage).toEqual({ promptTokens: 6, completionTokens: 9 });
    // …and the shared tolerant parser recovers the object.
    expect(parseLlmJson(r.content)).toEqual({ ok: true });
  });

  it("google/Gemma: joins multi-part content before parsing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeRes({
          body: {
            candidates: [{ content: { parts: [{ text: '{"ok"' }, { text: ":true}" }] } }],
            usageMetadata: {},
          },
        }),
      ),
    );
    const r = await googleAdapter.chatJson(pr({ kind: ProviderKind.GOOGLE }), [
      { role: "user", content: "hi" },
    ]);
    expect(r.content).toBe('{"ok":true}');
    expect(parseLlmJson(r.content)).toEqual({ ok: true });
  });

  it("cloudflare: extracts wrapped result.response, then parses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeRes({
          body: { result: { response: 'Here is your JSON:\n```\n{"ok":true}\n```' } },
        }),
      ),
    );
    const r = await cloudflareAdapter.chatJson(pr({ kind: ProviderKind.CLOUDFLARE }), [
      { role: "user", content: "hi" },
    ]);
    expect(r.content).toBe('Here is your JSON:\n```\n{"ok":true}\n```');
    expect(parseLlmJson(r.content)).toEqual({ ok: true });
  });

  it("cloudflare: result.response as an OBJECT (JSON mode) is stringified, then parses", async () => {
    // The old `typeof === "string"` guard turned this into "" → "unparseable JSON".
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeRes({ body: { result: { response: { ok: true } } } })),
    );
    const r = await cloudflareAdapter.chatJson(pr({ kind: ProviderKind.CLOUDFLARE }), [
      { role: "user", content: "hi" },
    ]);
    expect(r.content).toBe('{"ok":true}');
    expect(parseLlmJson(r.content)).toEqual({ ok: true });
  });

  it("cloudflare: OpenAI-style content nested under result also resolves", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeRes({
          body: {
            result: { choices: [{ message: { content: '{"ok":true}' } }] },
          },
        }),
      ),
    );
    const r = await cloudflareAdapter.chatJson(pr({ kind: ProviderKind.CLOUDFLARE }), [
      { role: "user", content: "hi" },
    ]);
    expect(parseLlmJson(r.content)).toEqual({ ok: true });
  });

  it("cloudflare: maps result.usage tokens when present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeRes({
          body: {
            result: { response: '{"ok":true}', usage: { prompt_tokens: 5, completion_tokens: 3 } },
          },
        }),
      ),
    );
    const r = await cloudflareAdapter.chatJson(pr({ kind: ProviderKind.CLOUDFLARE }), [
      { role: "user", content: "hi" },
    ]);
    expect(r.usage).toEqual({ promptTokens: 5, completionTokens: 3 });
  });

  it("cloudflare: no recoverable text → empty content (router fails over, not a crash)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeRes({ body: { result: {}, success: true } })),
    );
    const r = await cloudflareAdapter.chatJson(pr({ kind: ProviderKind.CLOUDFLARE }), [
      { role: "user", content: "hi" },
    ]);
    expect(r.content).toBe("");
    expect(parseLlmJson(r.content)).toBeNull();
  });
});
