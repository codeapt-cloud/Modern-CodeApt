/**
 * Cohere v2 /chat adapter. Bearer key like OpenAI, but the response text is an
 * array of content blocks (`message.content[].text`) and usage is reported under
 * `usage.tokens` (input/output). 429 maps to a rate-limit.
 */
import {
  asInt,
  safeText,
  throwForResponse,
  timedFetch,
  type ProviderAdapter,
} from "./base.js";
import type { AdapterResult } from "../types.js";

export const cohereAdapter: ProviderAdapter = {
  async chatJson(provider, messages): Promise<AdapterResult> {
    const now = Date.now();
    const res = await timedFetch(
      `${provider.baseUrl.replace(/\/$/, "")}/v2/chat`,
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
      message?: { content?: { text?: unknown }[] };
      usage?: { tokens?: { input_tokens?: unknown; output_tokens?: unknown } };
    };
    const content = (body.message?.content ?? [])
      .map((b) => (typeof b.text === "string" ? b.text : ""))
      .join("");
    return {
      content,
      usage: {
        promptTokens: asInt(body.usage?.tokens?.input_tokens),
        completionTokens: asInt(body.usage?.tokens?.output_tokens),
      },
    };
  },
};
