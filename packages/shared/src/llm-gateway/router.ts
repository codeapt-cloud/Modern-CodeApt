/**
 * The router — the gateway core. Given the provider runtimes + a task policy, it
 * builds the candidate chain (selection.ts), then tries them best-first:
 *   - success + parseable JSON → record usage, return the JSON.
 *   - ProviderHttpError (rate-limit / quota / transient / fatal) → bench the
 *     provider (cooldownUntil) + record the failure, then FAIL OVER to the next.
 *   - success but UNPARSEABLE output → record a soft failure (no bench) and try
 *     the next provider.
 *   - chain exhausted → return null (graceful "AI unavailable" — never throws).
 *
 * Bounded: at most `maxAttempts` (default 6) providers are tried, and each is
 * tried once, so it can never loop forever. Pure orchestration — the actual HTTP
 * call, usage/cooldown persistence, and JSON parsing are all INJECTED, so it's
 * fully unit-testable with no network or DB.
 */
import { cooldownUntilFor } from "./cooldown.js";
import { selectProviders } from "./selection.js";
import {
  ProviderHttpError,
  type AdapterResult,
  type AdapterUsage,
  type LlmTaskPolicy,
  type ProviderRuntime,
} from "./types.js";

export const DEFAULT_MAX_ATTEMPTS = 6;

export interface RouteChatJsonDeps {
  providers: readonly ProviderRuntime[];
  policy?: LlmTaskPolicy;
  now: number;
  /** Perform the provider call; throws ProviderHttpError on a non-success. */
  callAdapter: (p: ProviderRuntime) => Promise<AdapterResult>;
  /** Persist a successful call's usage (increment counters). */
  onSuccess: (p: ProviderRuntime, usage: AdapterUsage) => void | Promise<void>;
  /**
   * Persist a failure. `cooldownUntil` is the epoch-ms bench (null = no bench,
   * e.g. an unparseable-but-2xx response — record reliability, keep available).
   */
  onFailure: (
    p: ProviderRuntime,
    cooldownUntil: number | null,
    err: ProviderHttpError,
  ) => void | Promise<void>;
  /** Extract the requested JSON object from the model text; null if unusable. */
  parse: (content: string) => unknown | null;
  maxAttempts?: number;
}

export async function routeChatJson(deps: RouteChatJsonDeps): Promise<unknown | null> {
  const chain = selectProviders(deps.providers, deps.policy, deps.now);
  const limit = Math.min(chain.length, deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);

  for (let i = 0; i < limit; i++) {
    const provider = chain[i]!;
    try {
      const result = await deps.callAdapter(provider);
      await deps.onSuccess(provider, result.usage);
      const parsed = deps.parse(result.content);
      if (parsed !== null && parsed !== undefined) return parsed;
      // 2xx but unusable output — soft failure, no bench, try the next provider.
      await deps.onFailure(
        provider,
        null,
        new ProviderHttpError("Unparseable provider response", {
          status: 200,
          classification: "transient",
        }),
      );
    } catch (err) {
      const httpErr =
        err instanceof ProviderHttpError
          ? err
          : new ProviderHttpError(
              err instanceof Error ? err.message : "Provider call failed",
              { status: 0, classification: "transient" },
            );
      await deps.onFailure(provider, cooldownUntilFor(httpErr, deps.now), httpErr);
    }
  }
  return null;
}
