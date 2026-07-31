/**
 * Per-student coding-profile refresh pipeline. Kept STORE-INJECTED (like the
 * daily-challenge generator) so the resilience decisions — fetch every linked
 * platform in isolation, and merge results keeping last-known data on failure —
 * are unit-testable with in-memory fakes (no Mongo, no network).
 *
 * Guarantees: one platform failing never aborts the others (fetchAllPlatforms
 * uses Promise.allSettled); a not_found/error keeps the stored numbers and only
 * flags status (mergePlatformStat); a missing profile or one with no handles is
 * a graceful no-op.
 */
import {
  CODING_PLATFORM_VALUES,
  fetchAllPlatforms,
  mergePlatformStat,
  type CodingFetchStatus,
  type CodingHandleMap,
  type CodingPlatform,
  type PlatformFetchOutcome,
  type StoredPlatformStat,
} from "@codeapt/shared";

export interface LoadedProfile {
  handles: CodingHandleMap;
  stats: StoredPlatformStat[];
}

export interface CodingRefreshStore {
  loadProfile(collegeId: string, userId: string): Promise<LoadedProfile | null>;
  saveStats(
    collegeId: string,
    userId: string,
    stats: StoredPlatformStat[],
  ): Promise<void>;
}

export interface RefreshDeps {
  store: CodingRefreshStore;
  /** Fetch all linked platforms (defaults to the real adapters in the wiring). */
  fetchAll: (handles: CodingHandleMap) => Promise<PlatformFetchOutcome[]>;
  now: () => Date;
}

export type RefreshStatus = "refreshed" | "no_handles" | "not_found";

export interface RefreshOutcome {
  status: RefreshStatus;
  results: { platform: CodingPlatform; status: CodingFetchStatus }[];
}

function anyLinked(handles: CodingHandleMap): boolean {
  return CODING_PLATFORM_VALUES.some((p) => (handles[p] ?? "").trim() !== "");
}

export async function refreshCodingProfile(
  collegeId: string,
  userId: string,
  deps: RefreshDeps,
): Promise<RefreshOutcome> {
  const profile = await deps.store.loadProfile(collegeId, userId);
  if (!profile) return { status: "not_found", results: [] };
  if (!anyLinked(profile.handles)) return { status: "no_handles", results: [] };

  const outcomes = await deps.fetchAll(profile.handles);
  const now = deps.now();
  const prevByPlatform = new Map<CodingPlatform, StoredPlatformStat>(
    profile.stats.map((s) => [s.platform, s]),
  );

  // One merged entry per LINKED platform (fetchAll returns one outcome each);
  // any orphaned stat for a now-unlinked platform is naturally dropped.
  const next = outcomes.map((o) =>
    mergePlatformStat(prevByPlatform.get(o.platform), o, now),
  );

  await deps.store.saveStats(collegeId, userId, next);
  return {
    status: "refreshed",
    results: next.map((s) => ({ platform: s.platform, status: s.status })),
  };
}

/** Build the real fetcher (adapters + worker timeout) for the wiring. */
export function makeRealFetchAll(
  timeoutMs: number,
): (handles: CodingHandleMap) => Promise<PlatformFetchOutcome[]> {
  return (handles) => fetchAllPlatforms(handles, { timeoutMs });
}
