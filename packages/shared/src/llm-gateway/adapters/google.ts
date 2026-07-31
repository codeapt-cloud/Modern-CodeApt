/**
 * Google Generative Language adapter (Gemini / Gemma). Different shape from
 * OpenAI: the key is a query param, the system prompt is `system_instruction`,
 * turns are `contents`, and JSON mode is `responseMimeType`. Usage comes back as
 * `usageMetadata`. 429 (RESOURCE_EXHAUSTED) maps to a rate-limit like the rest.
 */
import {
  asInt,
  safeText,
  throwForResponse,
  timedFetch,
  type ProviderAdapter,
} from "./base.js";
import type { AdapterResult, ChatMessage } from "../types.js";

export const googleAdapter: ProviderAdapter = {
  async chatJson(provider, messages): Promise<AdapterResult> {
    const now = Date.now();
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const turns: ChatMessage[] = messages.filter((m) => m.role !== "system");

    const url =
      `${provider.baseUrl.replace(/\/$/, "")}/models/${provider.model}:generateContent` +
      `?key=${encodeURIComponent(provider.apiKey)}`;

    const res = await timedFetch(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(system
            ? { system_instruction: { parts: [{ text: system }] } }
            : {}),
          contents: turns.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            ...(provider.maxTokens ? { maxOutputTokens: provider.maxTokens } : {}),
          },
        }),
      },
      provider.timeoutMs,
    );
    if (!res.ok) {
      throwForResponse(res.status, res.headers.get("retry-after"), await safeText(res), now);
    }
    const body = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: unknown }[] } }[];
      usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown };
    };
    const parts = body.candidates?.[0]?.content?.parts ?? [];
    const content = parts
      .map((p) => (typeof p.text === "string" ? p.text : ""))
      .join("");
    return {
      content,
      usage: {
        promptTokens: asInt(body.usageMetadata?.promptTokenCount),
        completionTokens: asInt(body.usageMetadata?.candidatesTokenCount),
      },
    };
  },
};
