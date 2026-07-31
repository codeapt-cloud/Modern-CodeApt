/**
 * Provider adapters — one interface, one HTTP call each, mapping a provider's
 * request/response shape to {content, usage}. Every adapter throws a typed
 * ProviderHttpError on a non-success (status + parsed Retry-After + a
 * classification) so the router can detect limits and fail over.
 *
 * `base.ts` holds the shared plumbing (timeout fetch, error mapping) and the
 * OpenAI-compatible adapter that covers Groq / Cerebras / OpenRouter / Mistral /
 * NVIDIA and most others. Provider-specific quirks live in sibling files.
 */
import { parseRetryAfterMs } from "../retry-after.js";
import {
  ProviderHttpError,
  type AdapterResult,
  type ChatMessage,
  type ProviderErrorClass,
  type ProviderRuntime,
} from "../types.js";

export interface ProviderAdapter {
  chatJson(provider: ProviderRuntime, messages: ChatMessage[]): Promise<AdapterResult>;
}

/** A rate-limit body that names a daily/quota cap → bench until the day resets. */
const DAILY_LIMIT_RE = /quota|daily|per[\s-]?day|exhaust|resource_exhausted/i;

/** Map an HTTP status → coarse classification for cooldown/reliability. */
function classify(status: number): ProviderErrorClass {
  if (status === 429) return "rate_limit";
  if (status >= 500) return "transient";
  return "fatal"; // 401/403/400/404… — won't self-heal on retry, fail over
}

/**
 * Throw a typed error for a non-2xx response. `now` lets Retry-After (HTTP-date
 * form) resolve to a delta deterministically.
 */
export function throwForResponse(
  status: number,
  retryAfterHeader: string | null,
  bodyText: string,
  now: number,
): never {
  const classification = classify(status);
  throw new ProviderHttpError(`Provider responded ${status}`, {
    status,
    retryAfterMs: parseRetryAfterMs(retryAfterHeader, now),
    classification,
    daily: classification === "rate_limit" && DAILY_LIMIT_RE.test(bodyText),
  });
}

/** fetch with an AbortController timeout; network/timeout → typed transient error. */
export async function timedFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    throw new ProviderHttpError(
      err instanceof Error ? err.message : "Network error",
      { status: 0, classification: "transient" },
    );
  } finally {
    clearTimeout(timer);
  }
}

const asInt = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;

/** OpenAI-compatible /chat/completions. */
export const openAiCompatAdapter: ProviderAdapter = {
  async chatJson(provider, messages) {
    const now = Date.now();
    const res = await timedFetch(
      `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
          model: provider.model,
          temperature: 0,
          ...(provider.maxTokens ? { max_tokens: provider.maxTokens } : {}),
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      },
      provider.timeoutMs,
    );
    if (!res.ok) {
      throwForResponse(res.status, res.headers.get("retry-after"), await safeText(res), now);
    }
    const body = (await res.json()) as {
      choices?: { message?: { content?: unknown } }[];
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    };
    const content = body.choices?.[0]?.message?.content;
    return {
      content: typeof content === "string" ? content : "",
      usage: {
        promptTokens: asInt(body.usage?.prompt_tokens),
        completionTokens: asInt(body.usage?.completion_tokens),
      },
    };
  },
};

export async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

export { asInt };
