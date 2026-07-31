/**
 * Pure merge of a fetch outcome into the stored per-platform stat. The golden
 * rule (honest + resilient): only an `ok` outcome overwrites the numbers. A
 * `not_found` or `error` outcome KEEPS the last-known numbers and only updates
 * the status + lastFetchedAt — good data is never nulled out by a transient
 * failure. Kept pure (no DB, no clock) so it is trivially unit-testable.
 */
import { CodingFetchStatus, type CodingPlatform } from "../enums.js";
import type { PlatformFetchOutcome } from "./fetch-all.js";

export interface StoredPlatformStat {
  platform: CodingPlatform;
  handle: string;
  rating: number | null;
  maxRating: number | null;
  problemsSolved: number | null;
  rank: string | null;
  status: CodingFetchStatus;
  raw: unknown;
  lastFetchedAt: Date | null;
}

/** A fresh, never-fetched entry for a newly-linked handle. */
export function initialStat(platform: CodingPlatform, handle: string): StoredPlatformStat {
  return {
    platform,
    handle: handle.trim(),
    rating: null,
    maxRating: null,
    problemsSolved: null,
    rank: null,
    status: CodingFetchStatus.NEVER,
    raw: null,
    lastFetchedAt: null,
  };
}

/**
 * Merge one fetch outcome onto the previous stored stat (or a fresh entry when
 * there is none). `now` is injected so callers/tests control the timestamp.
 */
export function mergePlatformStat(
  prev: StoredPlatformStat | undefined,
  outcome: PlatformFetchOutcome,
  now: Date,
): StoredPlatformStat {
  const base = prev ?? initialStat(outcome.platform, outcome.handle);
  // A changed handle invalidates last-known numbers (they belonged to the old
  // handle); start from a fresh entry so we never mix two people's stats.
  const carried =
    base.handle.trim() === outcome.handle.trim()
      ? base
      : initialStat(outcome.platform, outcome.handle);

  if (outcome.ok) {
    return {
      platform: outcome.platform,
      handle: outcome.handle.trim(),
      rating: outcome.stats.rating,
      maxRating: outcome.stats.maxRating,
      problemsSolved: outcome.stats.problemsSolved,
      rank: outcome.stats.rank,
      status: CodingFetchStatus.OK,
      raw: outcome.stats.raw,
      lastFetchedAt: now,
    };
  }

  // not_found / error: keep last-known numbers, only flag status + timestamp.
  return {
    ...carried,
    handle: outcome.handle.trim(),
    status:
      outcome.classification === "not_found"
        ? CodingFetchStatus.NOT_FOUND
        : CodingFetchStatus.ERROR,
    lastFetchedAt: now,
  };
}
