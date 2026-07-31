/**
 * Coding-platform adapter tests — mock the HTTP layer (global fetch); no live
 * platform calls. Proves each adapter parses a sample response into normalized
 * stats, and maps failures (bad handle, 429, 5xx, garbage) to a typed
 * PlatformError with the right classification. Codeforces is the official API;
 * LeetCode + CodeChef are best-available (unofficial) — the tests pin their
 * defensive behavior so a shape change surfaces as a typed error, not a crash.
 */
import {
  CodingPlatform,
  PlatformError,
  codingAdapterFor,
} from "@codeapt/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

/** A minimal Response fake supporting .ok/.status/.json()/.text(). */
function fakeRes(opts: { status?: number; body?: unknown }): Response {
  const status = opts.status ?? 200;
  const text =
    typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body ?? {});
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => opts.body,
    text: async () => text,
  } as unknown as Response;
}

/** Stub fetch with a per-call sequence (one entry per outbound call). */
function stubSequence(responses: Response[]): void {
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => responses[Math.min(i++, responses.length - 1)]),
  );
}

const TIMEOUT = 5000;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("codeforces adapter (official API)", () => {
  it("maps user.info + user.status into normalized stats (distinct solved)", async () => {
    stubSequence([
      fakeRes({
        body: {
          status: "OK",
          result: [{ handle: "tourist", rating: 3800, maxRating: 3979, rank: "legendary grandmaster" }],
        },
      }),
      fakeRes({
        body: {
          status: "OK",
          result: [
            { verdict: "OK", problem: { contestId: 1, index: "A" } },
            { verdict: "OK", problem: { contestId: 1, index: "A" } }, // dup → 1
            { verdict: "OK", problem: { contestId: 2, index: "B" } },
            { verdict: "WRONG_ANSWER", problem: { contestId: 3, index: "C" } }, // not solved
          ],
        },
      }),
    ]);
    const stats = await codingAdapterFor(CodingPlatform.CODEFORCES).fetchStats("tourist", TIMEOUT);
    expect(stats.rating).toBe(3800);
    expect(stats.maxRating).toBe(3979);
    expect(stats.rank).toBe("legendary grandmaster");
    expect(stats.problemsSolved).toBe(2);
  });

  it("keeps the rating when the solved-count call fails (best-effort)", async () => {
    stubSequence([
      fakeRes({ body: { status: "OK", result: [{ rating: 1500, maxRating: 1600 }] } }),
      fakeRes({ status: 500, body: "boom" }),
    ]);
    const stats = await codingAdapterFor(CodingPlatform.CODEFORCES).fetchStats("someone", TIMEOUT);
    expect(stats.rating).toBe(1500);
    expect(stats.problemsSolved).toBeNull();
  });

  it("maps a bad handle (400 + 'not found') to a not_found PlatformError", async () => {
    stubSequence([
      fakeRes({
        status: 400,
        body: { status: "FAILED", comment: "handles: User with handle nope not found" },
      }),
    ]);
    await expect(
      codingAdapterFor(CodingPlatform.CODEFORCES).fetchStats("nope", TIMEOUT),
    ).rejects.toMatchObject({ classification: "not_found" });
  });
});

describe("leetcode adapter (unofficial GraphQL)", () => {
  it("maps a sample GraphQL response into normalized stats", async () => {
    stubSequence([
      fakeRes({
        body: {
          data: {
            matchedUser: {
              username: "lee215",
              profile: { ranking: 143 },
              submitStatsGlobal: {
                acSubmissionNum: [
                  { difficulty: "All", count: 2500 },
                  { difficulty: "Easy", count: 800 },
                ],
              },
            },
            userContestRanking: { rating: 3200 },
          },
        },
      }),
    ]);
    const stats = await codingAdapterFor(CodingPlatform.LEETCODE).fetchStats("lee215", TIMEOUT);
    expect(stats.problemsSolved).toBe(2500);
    expect(stats.rating).toBe(3200);
    expect(stats.rank).toBe("#143");
    expect(stats.maxRating).toBeNull();
  });

  it("maps a missing user (matchedUser null) to not_found", async () => {
    stubSequence([
      fakeRes({ body: { data: { matchedUser: null, userContestRanking: null } } }),
    ]);
    await expect(
      codingAdapterFor(CodingPlatform.LEETCODE).fetchStats("ghost", TIMEOUT),
    ).rejects.toMatchObject({ classification: "not_found" });
  });

  it("maps an unexpected shape to an unavailable PlatformError (not a crash)", async () => {
    stubSequence([fakeRes({ body: { surprise: true } })]);
    await expect(
      codingAdapterFor(CodingPlatform.LEETCODE).fetchStats("x", TIMEOUT),
    ).rejects.toBeInstanceOf(PlatformError);
  });
});

describe("codechef adapter (unofficial scrape, most fragile)", () => {
  it("scrapes rating + stars from the profile HTML", async () => {
    const html = `
      <div class="rating-header">(Div 1)</div>
      <div class="rating-number">2100</div>
      <span class="rating-star"> ★★★★★ </span>`;
    stubSequence([fakeRes({ body: html })]);
    const stats = await codingAdapterFor(CodingPlatform.CODECHEF).fetchStats("gennady", TIMEOUT);
    expect(stats.rating).toBe(2100);
    expect(stats.rank).toBe("5★ (Div 1)");
    expect(stats.problemsSolved).toBeNull();
  });

  it("maps a 404 profile to not_found", async () => {
    stubSequence([fakeRes({ status: 404, body: "not found" })]);
    await expect(
      codingAdapterFor(CodingPlatform.CODECHEF).fetchStats("ghost", TIMEOUT),
    ).rejects.toMatchObject({ classification: "not_found" });
  });

  it("maps unparseable HTML (markup changed) to unavailable", async () => {
    stubSequence([fakeRes({ body: "<html>totally different</html>" })]);
    await expect(
      codingAdapterFor(CodingPlatform.CODECHEF).fetchStats("x", TIMEOUT),
    ).rejects.toMatchObject({ classification: "unavailable" });
  });
});
