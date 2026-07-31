/**
 * Shared adapter plumbing — the timeout fetch, HTTP → typed-error mapping, and
 * defensive value guards every coding-platform adapter reuses. Mirrors the LLM
 * gateway's `adapters/base.ts` (timedFetch + throwForResponse + asInt).
 */
import { PlatformError, type PlatformErrorClass } from "../types.js";

/** Map an HTTP status → coarse classification for the refresh orchestrator. */
export function classifyHttp(status: number): PlatformErrorClass {
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  // 400/403/5xx/anything else → the endpoint is unusable right now; keep
  // last-known data and flag `error`. (A 400 from Codeforces for a missing
  // handle is remapped to not_found by that adapter from the body.)
  return "unavailable";
}

/** Throw a typed error for a non-2xx response. */
export function throwForResponse(status: number, bodyText: string): never {
  throw new PlatformError(
    `Platform responded ${status}${bodyText ? `: ${bodyText.slice(0, 200)}` : ""}`,
    { classification: classifyHttp(status), httpStatus: status },
  );
}

/** fetch with an AbortController timeout; network/timeout → typed unavailable. */
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
    throw new PlatformError(err instanceof Error ? err.message : "Network error", {
      classification: "unavailable",
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Read an error body without ever throwing. */
export async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

/** Coerce an unknown to a non-negative integer, or null when not a finite number. */
export function asInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.round(v));
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.max(0, Math.round(n));
  }
  return null;
}

/** Coerce an unknown to a trimmed non-empty string, or null. */
export function asStr(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? null : t;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** True when a fetched JSON body is a plain object we can index into. */
export function isDict(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Keep only a bounded slice of a raw payload for storage/auditing. */
export function trimRaw(v: unknown): unknown {
  try {
    const s = JSON.stringify(v);
    return s.length > 4000 ? s.slice(0, 4000) : v;
  } catch {
    return null;
  }
}
