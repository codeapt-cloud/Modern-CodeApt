/**
 * LLM Gateway — shared, isomorphic types + the typed provider error.
 *
 * The gateway is a multi-provider free-tier router that sits BEHIND the single
 * `callLlmChatJson` seam. This module holds only the pure contracts (no DB, no
 * node:crypto, no secrets) so both the router engine (here in @codeapt/shared)
 * and the DB-backed wiring (in the API) speak the same shapes, and the web
 * bundle never pulls server-only code.
 */

/** Provider integration family — selects the request/response ADAPTER. */
export const ProviderKind = {
  /** OpenAI-compatible /chat/completions (Groq, Cerebras, OpenRouter, Mistral, NVIDIA…). */
  OPENAI_COMPAT: "openai_compat",
  /** Google Generative Language (Gemini / Gemma). */
  GOOGLE: "google",
  /** Cohere v2 /chat. */
  COHERE: "cohere",
  /** Cloudflare Workers AI. */
  CLOUDFLARE: "cloudflare",
} as const;
export type ProviderKind = (typeof ProviderKind)[keyof typeof ProviderKind];
export const PROVIDER_KIND_VALUES = Object.values(ProviderKind);

/** Coarse capability hint used by selection (fast/cheap vs capable/stable). */
export const ProviderCapability = {
  FAST: "fast",
  CAPABLE: "capable",
} as const;
export type ProviderCapability =
  (typeof ProviderCapability)[keyof typeof ProviderCapability];
export const PROVIDER_CAPABILITY_VALUES = Object.values(ProviderCapability);

/** Live provider status shown on the admin monitoring page. */
export const AiProviderStatus = {
  /** Enabled, keyed, not in cooldown — usable now. */
  HEALTHY: "healthy",
  /** Enabled + keyed but benched until its `cooldownUntil`. */
  COOLING_DOWN: "cooling_down",
  /** Turned off by an admin. */
  DISABLED: "disabled",
  /** Enabled but has no API key set — the router skips it. */
  NO_KEY: "no_key",
} as const;
export type AiProviderStatus =
  (typeof AiProviderStatus)[keyof typeof AiProviderStatus];
export const AI_PROVIDER_STATUS_VALUES = Object.values(AiProviderStatus);

/** What the caller is doing — steers provider selection + data-residency rules. */
export type LlmTaskKind = "grading" | "generation";
export interface LlmTaskPolicy {
  kind: LlmTaskKind;
  /**
   * True when the payload contains user/student data that must NOT be sent to a
   * provider that trains on inputs (Google-outside-EEA / Mistral / some free
   * OpenRouter models). Such providers are EXCLUDED for sensitive tasks.
   */
  sensitive?: boolean;
  /**
   * Preferred provider capability (a RANKING hint, not a hard filter): simple/
   * high-volume tasks pass `fast` (cheap models first), heavy tasks pass
   * `capable`. Matching providers sort ahead of non-matching WITHIN the existing
   * priority/headroom framework; when unset, ordering is unchanged.
   */
  capability?: ProviderCapability;
  /**
   * Hard ceiling on OUTPUT tokens for this call, so we never over-allocate
   * budget. The gateway clamps it to an absolute max regardless. When unset a
   * sensible per-task default applies (see `resolveMaxTokens`).
   */
  maxTokens?: number;
  /**
   * Whether an identical request may be served from the response cache (zero
   * tokens). Defaults to true for any task with a `kind`; features that must
   * always hit a live model pass `false`. Errors are never cached.
   */
  cacheable?: boolean;
  /** Feature label for usage rollups (e.g. "grading", "keywords", "ai_build"). */
  feature?: string;
  /**
   * The COLLEGE this AI action is charged to (Stage-1 AI credits). Present ONLY
   * for college-initiated actions; PLATFORM-initiated AI (daily-challenge cron,
   * super-admin tools) omits it and is NOT metered against any college. When set,
   * the gateway seam reserves the action's credit weight before calling a
   * provider and refunds on failure — so a capped college can't touch the pool.
   */
  collegeId?: string;
  /**
   * Stage-2 governor: set ONLY by the paced-queue worker when it drains a
   * previously-deferred call. It tells the seam to SKIP the global governor
   * check (this IS the paced execution — it must run-or-fail, never re-defer),
   * while Stage-1 per-college metering + the router's own headroom gate still
   * apply. Never set by feature callers.
   */
  internalPaced?: boolean;
}

/** Documented free-tier limits (any field omitted = "not limited on that axis"). */
export interface ProviderLimits {
  requestsPerMinute?: number;
  requestsPerDay?: number;
  tokensPerMinute?: number;
  tokensPerDay?: number;
}

/** Rolling usage within the current minute + day windows (already window-fresh). */
export interface ProviderUsageWindow {
  requests: number;
  tokens: number;
}
export interface ProviderUsageSnapshot {
  minute: ProviderUsageWindow;
  day: ProviderUsageWindow;
}

/** Health the router reads when scoring/skipping a provider. */
export interface ProviderHealthSnapshot {
  /** Epoch ms until which the provider is benched; null/≤now = available. */
  cooldownUntil: number | null;
  consecutiveFailures: number;
  /** 0..1 rolling success rate; higher = more stable (used for grading). */
  reliability: number;
}

/** The router's complete view of one usable provider (key already decrypted). */
export interface ProviderRuntime {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  /** Lower = preferred. */
  priority: number;
  capability: ProviderCapability;
  trainsOnData: boolean;
  limits: ProviderLimits;
  /** Decrypted API key — NEVER logged. */
  apiKey: string;
  timeoutMs: number;
  /**
   * Per-call output-token ceiling the adapter puts on the wire (max_tokens /
   * maxOutputTokens). Optional: absent = provider default. Set by the gateway
   * from the task policy; not persisted on the provider.
   */
  maxTokens?: number;
  usage: ProviderUsageSnapshot;
  health: ProviderHealthSnapshot;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AdapterUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface AdapterResult {
  /** The model's text output (expected to contain the requested JSON object). */
  content: string;
  usage: AdapterUsage;
}

/** How a failure should be treated for cooldown + reliability accounting. */
export type ProviderErrorClass = "rate_limit" | "transient" | "fatal";

/**
 * Typed error every adapter throws on a non-success. Captures the HTTP status, a
 * parsed Retry-After (ms, already clamped to 24h upstream), the classification,
 * and whether a rate limit is a DAILY/quota exhaustion (→ bench until day reset)
 * vs a per-minute burst (→ short bench). Never carries secrets.
 */
export class ProviderHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;
  readonly classification: ProviderErrorClass;
  /** True when a rate_limit is the daily/quota cap (not a per-minute burst). */
  readonly daily: boolean;

  constructor(
    message: string,
    opts: {
      status: number;
      retryAfterMs?: number | null;
      classification: ProviderErrorClass;
      daily?: boolean;
    },
  ) {
    super(message);
    this.name = "ProviderHttpError";
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs ?? null;
    this.classification = opts.classification;
    this.daily = opts.daily ?? false;
  }
}
