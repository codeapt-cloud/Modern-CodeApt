/**
 * Coding-platform adapter contract + typed error, mirroring the LLM-gateway
 * provider-adapter discipline (one interface, per-platform quirks, a typed error
 * a caller can classify, one platform's failure never cascades).
 *
 * A `CodingPlatformAdapter` maps one platform's request/response shape to a
 * NORMALIZED, defensively-parsed `NormalizedStats`, or throws a `PlatformError`
 * with a coarse classification. Adapters NEVER let a raw network/parse error
 * escape untyped — the refresh orchestrator relies on that to keep last-known
 * data and isolate a single platform's failure.
 */
import type { CodingPlatform } from "../enums.js";

/**
 * How a platform fetch failed. `not_found` = the platform says no such handle
 * (a wrong handle the student typed); `rate_limited` = throttled (429), retry
 * later; `unavailable` = network/timeout/5xx/unparseable — the platform (or its
 * unofficial endpoint) is down or changed shape. The orchestrator maps the
 * latter two to the stored `error` status and keeps the last-known numbers.
 */
export type PlatformErrorClass = "not_found" | "rate_limited" | "unavailable";

/** Typed error every adapter throws on any non-success (never a raw throw). */
export class PlatformError extends Error {
  readonly classification: PlatformErrorClass;
  /** The HTTP status if there was a response (0 for network/timeout). */
  readonly httpStatus: number;

  constructor(
    message: string,
    opts: { classification: PlatformErrorClass; httpStatus?: number },
  ) {
    super(message);
    this.name = "PlatformError";
    this.classification = opts.classification;
    this.httpStatus = opts.httpStatus ?? 0;
  }
}

/**
 * Normalized, platform-agnostic stats. Every field is nullable: a platform may
 * simply not expose it (e.g. LeetCode has no "max rating"; a user may have no
 * contest rating yet). `raw` keeps the (trimmed) source payload for auditing /
 * future fields — it is stored server-side but never returned to clients.
 */
export interface NormalizedStats {
  rating: number | null;
  maxRating: number | null;
  problemsSolved: number | null;
  /** A human label for the platform's tier/rank (CF rank, CodeChef stars, …). */
  rank: string | null;
  raw: unknown;
}

/** One platform's fetcher. `timeoutMs` bounds the outbound call. */
export interface CodingPlatformAdapter {
  readonly platform: CodingPlatform;
  fetchStats(handle: string, timeoutMs: number): Promise<NormalizedStats>;
}
