/**
 * Coding-profile refresh pipeline + orchestration tests — pure, in-memory fakes
 * (no Mongo, no network). Proves the resilience DoD:
 *   - fetchAllPlatforms isolates each platform (one throwing NEVER aborts others);
 *   - a not_found/error KEEPS the last-known numbers and only flags status;
 *   - an ok overwrites the numbers + stamps lastFetchedAt;
 *   - a missing profile / no-handles profile is a graceful no-op.
 */
import {
  CodingFetchStatus,
  CodingPlatform,
  PlatformError,
  fetchAllPlatforms,
  mergePlatformStat,
  type CodingHandleMap,
  type NormalizedStats,
  type StoredPlatformStat,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import {
  refreshCodingProfile,
  type CodingRefreshStore,
  type LoadedProfile,
} from "../src/lib/coding-refresh/refresh.js";

const NOW = new Date("2026-07-31T00:00:00.000Z");

const okStats = (rating: number): NormalizedStats => ({
  rating,
  maxRating: rating,
  problemsSolved: 100,
  rank: "expert",
  raw: { rating },
});

/** An in-memory store capturing what the pipeline saves. */
function makeStore(profile: LoadedProfile | null): {
  store: CodingRefreshStore;
  saved: StoredPlatformStat[][];
} {
  const saved: StoredPlatformStat[][] = [];
  return {
    saved,
    store: {
      loadProfile: async () => profile,
      saveStats: async (_c, _u, stats) => {
        saved.push(stats);
      },
    },
  };
}

describe("fetchAllPlatforms isolation (Promise.allSettled)", () => {
  it("one platform failing never aborts the others", async () => {
    const handles: CodingHandleMap = {
      codeforces: "cf",
      leetcode: "lc",
      codechef: "cc",
    };
    const outcomes = await fetchAllPlatforms(handles, {
      timeoutMs: 1000,
      fetchOne: async (platform) => {
        if (platform === CodingPlatform.LEETCODE) {
          throw new PlatformError("down", { classification: "unavailable" });
        }
        if (platform === CodingPlatform.CODECHEF) {
          throw new PlatformError("gone", { classification: "not_found" });
        }
        return okStats(1500);
      },
    });
    const byPlatform = new Map(outcomes.map((o) => [o.platform, o]));
    expect(byPlatform.get(CodingPlatform.CODEFORCES)?.ok).toBe(true);
    expect(byPlatform.get(CodingPlatform.LEETCODE)).toMatchObject({
      ok: false,
      classification: "unavailable",
    });
    expect(byPlatform.get(CodingPlatform.CODECHEF)).toMatchObject({
      ok: false,
      classification: "not_found",
    });
  });

  it("skips unlinked (blank) handles", async () => {
    const outcomes = await fetchAllPlatforms(
      { codeforces: "cf", leetcode: "", codechef: undefined },
      { timeoutMs: 1000, fetchOne: async () => okStats(1200) },
    );
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.platform).toBe(CodingPlatform.CODEFORCES);
  });
});

describe("mergePlatformStat keeps last-known data", () => {
  const prev: StoredPlatformStat = {
    platform: CodingPlatform.CODEFORCES,
    handle: "cf",
    rating: 1900,
    maxRating: 2000,
    problemsSolved: 300,
    rank: "candidate master",
    status: CodingFetchStatus.OK,
    raw: null,
    lastFetchedAt: new Date("2026-07-01T00:00:00.000Z"),
  };

  it("ok overwrites numbers + stamps time", () => {
    const merged = mergePlatformStat(
      prev,
      { platform: CodingPlatform.CODEFORCES, handle: "cf", ok: true, stats: okStats(2100) },
      NOW,
    );
    expect(merged.rating).toBe(2100);
    expect(merged.status).toBe(CodingFetchStatus.OK);
    expect(merged.lastFetchedAt).toBe(NOW);
  });

  it("error keeps last-known numbers, only flags status", () => {
    const merged = mergePlatformStat(
      prev,
      {
        platform: CodingPlatform.CODEFORCES,
        handle: "cf",
        ok: false,
        classification: "unavailable",
        message: "down",
      },
      NOW,
    );
    expect(merged.rating).toBe(1900); // unchanged
    expect(merged.maxRating).toBe(2000);
    expect(merged.status).toBe(CodingFetchStatus.ERROR);
    expect(merged.lastFetchedAt).toBe(NOW);
  });

  it("a changed handle resets the entry (old numbers belonged to another user)", () => {
    const merged = mergePlatformStat(
      prev,
      {
        platform: CodingPlatform.CODEFORCES,
        handle: "different",
        ok: false,
        classification: "not_found",
        message: "no such",
      },
      NOW,
    );
    expect(merged.handle).toBe("different");
    expect(merged.rating).toBeNull(); // reset — not carried from "cf"
    expect(merged.status).toBe(CodingFetchStatus.NOT_FOUND);
  });
});

describe("refreshCodingProfile pipeline", () => {
  it("upserts fresh stats and keeps last-known on a failing platform", async () => {
    const prevStats: StoredPlatformStat[] = [
      {
        platform: CodingPlatform.LEETCODE,
        handle: "lc",
        rating: 2400,
        maxRating: null,
        problemsSolved: 500,
        rank: "#10",
        status: CodingFetchStatus.OK,
        raw: null,
        lastFetchedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ];
    const { store, saved } = makeStore({
      handles: { codeforces: "cf", leetcode: "lc" },
      stats: prevStats,
    });
    const outcome = await refreshCodingProfile("col", "usr", {
      store,
      now: () => NOW,
      fetchAll: async () => [
        { platform: CodingPlatform.CODEFORCES, handle: "cf", ok: true, stats: okStats(1700) },
        {
          platform: CodingPlatform.LEETCODE,
          handle: "lc",
          ok: false,
          classification: "unavailable",
          message: "down",
        },
      ],
    });

    expect(outcome.status).toBe("refreshed");
    expect(saved).toHaveLength(1);
    const byPlatform = new Map(saved[0]!.map((s) => [s.platform, s]));
    // Codeforces refreshed.
    expect(byPlatform.get(CodingPlatform.CODEFORCES)).toMatchObject({
      rating: 1700,
      status: CodingFetchStatus.OK,
    });
    // LeetCode kept its last-known 2400 despite the failure.
    expect(byPlatform.get(CodingPlatform.LEETCODE)).toMatchObject({
      rating: 2400,
      status: CodingFetchStatus.ERROR,
    });
  });

  it("no-ops (no save) when the profile is missing", async () => {
    const { store, saved } = makeStore(null);
    const outcome = await refreshCodingProfile("col", "usr", {
      store,
      now: () => NOW,
      fetchAll: async () => {
        throw new Error("should not fetch");
      },
    });
    expect(outcome.status).toBe("not_found");
    expect(saved).toHaveLength(0);
  });

  it("no-ops when the profile has no linked handles", async () => {
    const { store, saved } = makeStore({
      handles: { codeforces: "", leetcode: "", codechef: "" },
      stats: [],
    });
    const outcome = await refreshCodingProfile("col", "usr", {
      store,
      now: () => NOW,
      fetchAll: async () => {
        throw new Error("should not fetch");
      },
    });
    expect(outcome.status).toBe("no_handles");
    expect(saved).toHaveLength(0);
  });
});
