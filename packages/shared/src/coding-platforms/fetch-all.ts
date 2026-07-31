/**
 * Fetch every linked platform for one student, ISOLATED. Uses Promise.allSettled
 * so one platform being down/slow/broken can NEVER abort the others — each
 * platform resolves to its own ok/error outcome. This is the resilience core the
 * refresh job relies on: a failing (especially unofficial) platform degrades to
 * an error outcome for that platform alone.
 */
import { CODING_PLATFORM_VALUES, type CodingPlatform } from "../enums.js";
import { codingAdapterFor } from "./adapters/index.js";
import { PlatformError, type NormalizedStats, type PlatformErrorClass } from "./types.js";

/** Handles keyed by platform; a null/absent/blank value means "not linked". */
export type CodingHandleMap = Partial<Record<CodingPlatform, string | null | undefined>>;

export type PlatformFetchOutcome =
  | { platform: CodingPlatform; handle: string; ok: true; stats: NormalizedStats }
  | {
      platform: CodingPlatform;
      handle: string;
      ok: false;
      classification: PlatformErrorClass;
      message: string;
    };

export interface FetchAllOptions {
  timeoutMs: number;
  /** Injectable single-platform fetch (defaults to the real adapter registry). */
  fetchOne?: (platform: CodingPlatform, handle: string, timeoutMs: number) => Promise<NormalizedStats>;
}

const defaultFetchOne = (platform: CodingPlatform, handle: string, timeoutMs: number) =>
  codingAdapterFor(platform).fetchStats(handle, timeoutMs);

function normalizeHandle(v: string | null | undefined): string {
  return (v ?? "").trim();
}

/**
 * Fetch all LINKED platforms concurrently and return one outcome per linked
 * platform (unlinked platforms are skipped). Never throws.
 */
export async function fetchAllPlatforms(
  handles: CodingHandleMap,
  opts: FetchAllOptions,
): Promise<PlatformFetchOutcome[]> {
  const fetchOne = opts.fetchOne ?? defaultFetchOne;
  const linked = CODING_PLATFORM_VALUES.map((platform) => ({
    platform,
    handle: normalizeHandle(handles[platform]),
  })).filter((x) => x.handle !== "");

  const settled = await Promise.allSettled(
    linked.map(async ({ platform, handle }): Promise<PlatformFetchOutcome> => {
      try {
        const stats = await fetchOne(platform, handle, opts.timeoutMs);
        return { platform, handle, ok: true, stats };
      } catch (err) {
        const classification: PlatformErrorClass =
          err instanceof PlatformError ? err.classification : "unavailable";
        const message = err instanceof Error ? err.message : "Fetch failed";
        return { platform, handle, ok: false, classification, message };
      }
    }),
  );

  // allSettled never rejects; the inner try/catch already yields an outcome, so
  // a `rejected` here would only be a truly unexpected throw — treat defensively.
  return settled.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    const { platform, handle } = linked[i]!;
    return {
      platform,
      handle,
      ok: false as const,
      classification: "unavailable" as const,
      message: "Unexpected fetch failure",
    };
  });
}
