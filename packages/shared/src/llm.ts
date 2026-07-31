/**
 * The single LLM seam used across the backend (essay grading in the worker,
 * essay keyword-generation + AI Test Builder in the API). It is the ONE
 * integration all AI features consume.
 *
 * A multi-provider GATEWAY can be installed BEHIND this seam via
 * `registerLlmRouter`: once registered, every `callLlmChatJson` call is routed
 * through the gateway (failover, rate-limit/quota cooldown, usage tracking, task
 * policy) with NO change to any caller. When no router is registered it falls
 * back to the original single-provider, env-configured behavior below.
 *
 * Defensive + never-throws: missing config, non-2xx, network error, timeout, or
 * unparseable output all resolve to `null`, so callers fall back cleanly. The
 * caller supplies a system + user prompt that MUST elicit strict JSON; this
 * helper strips code fences, isolates the JSON object, and parses it.
 *
 * Uses global `fetch` + `AbortController` (Node 20+ / browsers). It is only
 * ever invoked server-side.
 */
import { resolveMaxTokens } from "./llm-gateway/token-budget.js";
import type { LlmTaskPolicy } from "./llm-gateway/types.js";

export interface LlmChatConfig {
  /** Base URL of an OpenAI-compatible API (…/v1). */
  url?: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
}

/**
 * A gateway router installed behind the seam. Receives the system + user prompt
 * and the optional task policy; returns the parsed JSON object or null. MUST NOT
 * throw (the seam still guards, but the router owns graceful exhaustion).
 */
export type LlmRouterFn = (
  systemPrompt: string,
  userPrompt: string,
  policy?: LlmTaskPolicy,
) => Promise<unknown | null>;

let installedRouter: LlmRouterFn | null = null;

/**
 * Install (or clear, with null) the gateway router. Called once at server
 * startup by the API; tests register a fake router and clear it afterwards.
 */
export function registerLlmRouter(fn: LlmRouterFn | null): void {
  installedRouter = fn;
}

/** Whether a gateway router is currently installed behind the seam. */
export function hasLlmRouter(): boolean {
  return installedRouter !== null;
}

/** Strip Markdown code fences and isolate the outermost {...} JSON object. */
export function extractJsonObject(text: string): string {
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) return t.slice(start, end + 1);
  return t;
}

/**
 * Tolerant parse of a model's text into the JSON value it was asked to produce.
 * Providers often wrap JSON in prose, Markdown ```code fences```, or append
 * trailing commentary — so strict `JSON.parse` on the whole string fails even
 * though the request itself succeeded (a "2xx but unparseable" response, seen
 * from Gemma / Cloudflare). This peels those wrappers back and returns the parsed
 * value, or `null` when no JSON object/array is recoverable (a genuine failure —
 * the router then fails over, exactly as before).
 *
 * A clean JSON string still parses on the FIRST strategy, so already-working
 * providers behave identically. Order (first success wins):
 *   1. Parse the whole (BOM/whitespace-trimmed) string.
 *   2. Parse the inner block of each Markdown code fence.
 *   3. Parse the first BALANCED {…}/[…] substring that is valid JSON — this skips
 *      leading/trailing prose and stray braces in the surrounding text.
 */
export function parseLlmJson(text: unknown): unknown | null {
  if (typeof text !== "string") return null;
  const cleaned = stripBom(text).trim();
  if (!cleaned) return null;

  // 1) The whole response is already clean JSON.
  const whole = tryJsonParse(cleaned);
  if (whole.ok) return whole.value;

  // 2) Fenced ```…``` block(s).
  for (const inner of fencedBlocks(cleaned)) {
    const r = tryJsonParse(inner.trim());
    if (r.ok) return r.value;
  }

  // 3) First balanced {…}/[…] span that parses (handles surrounding prose).
  for (const candidate of balancedJsonCandidates(cleaned)) {
    const r = tryJsonParse(candidate);
    if (r.ok) return r.value;
  }
  return null;
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function tryJsonParse(s: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(s) as unknown };
  } catch {
    return { ok: false };
  }
}

/** Inner contents of every ```lang … ``` (or ``` … ```) Markdown code fence. */
function fencedBlocks(s: string): string[] {
  const blocks: string[] = [];
  const re = /```[ \t]*[a-zA-Z0-9_-]*[ \t]*\r?\n?([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m[1]) blocks.push(m[1]);
  }
  return blocks;
}

/**
 * Every top-level balanced {…}/[…] span, in order. Tracks string/escape state so
 * braces inside string values don't miscount. Each span is later validated with
 * JSON.parse, so a malformed span is simply skipped.
 */
function balancedJsonCandidates(s: string): string[] {
  const spans: string[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "{" || ch === "[") {
      const end = matchingClose(s, i);
      if (end !== -1) {
        spans.push(s.slice(i, end + 1));
        i = end + 1;
        continue;
      }
    }
    i += 1;
  }
  return spans;
}

/** Index of the bracket that closes the one at `start`, or -1 if unbalanced. */
function matchingClose(s: string, start: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i += 1) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth += 1;
    else if (c === "}" || c === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * POST a system+user chat completion (temperature 0) and return the PARSED JSON
 * object the model was asked to produce, or `null` on ANY failure. Never throws.
 *
 * If a gateway router is installed, the call is routed through it (the `config`
 * arg — legacy single-provider creds — is ignored). `policy` lets callers steer
 * gateway selection (grading-stable / generation-rotate / sensitive-excludes-
 * training); it is ignored by the single-provider fallback. Both are optional so
 * existing callers are unchanged.
 */
export async function callLlmChatJson(
  config: LlmChatConfig,
  systemPrompt: string,
  userPrompt: string,
  policy?: LlmTaskPolicy,
): Promise<unknown | null> {
  if (installedRouter) {
    try {
      return await installedRouter(systemPrompt, userPrompt, policy);
    } catch {
      return null; // the seam never throws, even if a router misbehaves
    }
  }

  if (!config.url || !config.apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await fetch(`${config.url.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        max_tokens: resolveMaxTokens(policy),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      choices?: { message?: { content?: unknown } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content) return null;
    // Tolerant extraction: clean JSON parses immediately; fenced/prose-wrapped
    // JSON (Gemma/Cloudflare and chatty models) is peeled back; else null.
    return parseLlmJson(content);
  } catch {
    return null; // network / timeout / abort → caller falls back
  } finally {
    clearTimeout(timer);
  }
}
