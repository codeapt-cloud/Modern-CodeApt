/**
 * Cloudflare Workers AI adapter. The account-scoped model path is baked into
 * `baseUrl` (…/accounts/<id>/ai/run) and the model id is appended; a Bearer API
 * token authorizes. 429 maps to a rate-limit like the rest.
 *
 * Response extraction is deliberately tolerant of Cloudflare's envelope variants.
 * The canonical native shape is { result: { response: "<text>" } } with a STRING
 * `response`, but real deployments also return:
 *   - result.response as an already-parsed OBJECT/array (JSON mode) — the old
 *     `typeof === "string"` guard silently turned this into "" → the parser then
 *     saw empty content and reported "2xx but unparseable JSON";
 *   - result.output_text / result.text on some text-generation models;
 *   - an OpenAI-style choices[].message.content nested under result or top-level.
 * We pull the text from whichever is present, stringifying an object so the shared
 * tolerant JSON extractor (used by the router) can parse it back. Usage isn't
 * reliably reported on the free tier, so it defaults to 0 (request-count headroom
 * still applies).
 */
import {
  asInt,
  safeText,
  throwForResponse,
  timedFetch,
  type ProviderAdapter,
} from "./base.js";
import type { AdapterResult } from "../types.js";

type Dict = Record<string, unknown>;

const isDict = (v: unknown): v is Dict =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** JSON.stringify that never throws (circular/odd values → ""). */
function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? "";
  } catch {
    return "";
  }
}

/** OpenAI-style choices[0].message.content, if present as a string. */
function openAiContent(obj: unknown): string | null {
  if (!isDict(obj)) return null;
  const choices = obj.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!isDict(first)) return null;
  const message = first.message;
  if (!isDict(message)) return null;
  return typeof message.content === "string" ? message.content : null;
}

/** Recover the model's text from any known Cloudflare envelope shape. */
export function extractCloudflareText(body: unknown): string {
  if (!isDict(body)) return "";
  const result = isDict(body.result) ? body.result : {};

  // 1) Canonical native shape: result.response as a string.
  if (typeof result.response === "string") return result.response;
  // 2) JSON mode: result.response already parsed → stringify so it re-parses.
  if (result.response !== undefined && result.response !== null && typeof result.response === "object") {
    return safeStringify(result.response);
  }
  // 3) Alternate native text fields.
  if (typeof result.output_text === "string") return result.output_text;
  if (typeof result.text === "string") return result.text;
  // 4) OpenAI-style content nested under result, or at the top level.
  return openAiContent(result) ?? openAiContent(body) ?? "";
}

/** Token usage from the native `result.usage` or a top-level OpenAI-style `usage`. */
function extractCloudflareUsage(body: unknown): {
  promptTokens: number;
  completionTokens: number;
} {
  const b = isDict(body) ? body : {};
  const result = isDict(b.result) ? b.result : {};
  const usage = isDict(result.usage) ? result.usage : isDict(b.usage) ? b.usage : {};
  return {
    promptTokens: asInt(usage.prompt_tokens),
    completionTokens: asInt(usage.completion_tokens),
  };
}

export const cloudflareAdapter: ProviderAdapter = {
  async chatJson(provider, messages): Promise<AdapterResult> {
    const now = Date.now();
    const res = await timedFetch(
      `${provider.baseUrl.replace(/\/$/, "")}/${provider.model}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: 0,
          ...(provider.maxTokens ? { max_tokens: provider.maxTokens } : {}),
        }),
      },
      provider.timeoutMs,
    );
    if (!res.ok) {
      throwForResponse(res.status, res.headers.get("retry-after"), await safeText(res), now);
    }
    const body = (await res.json()) as unknown;
    return {
      content: extractCloudflareText(body),
      usage: extractCloudflareUsage(body),
    };
  },
};
