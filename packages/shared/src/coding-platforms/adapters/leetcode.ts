/**
 * LeetCode adapter — the community GraphQL endpoint (UNOFFICIAL). There is no
 * documented public API, so this is best-available: it can change shape without
 * notice. We therefore parse very defensively and turn ANY unexpected shape into
 * a typed PlatformError (unavailable) so a LeetCode change breaks ONLY this
 * adapter — never the refresh job, the other platforms, or stored data.
 *
 *   - submitStatsGlobal.acSubmissionNum[difficulty="All"].count → problemsSolved
 *   - userContestRanking.rating → contest rating (may be absent if never rated)
 *   - profile.ranking → global ranking (surfaced as the `rank` label)
 *
 * A missing `matchedUser` (null) means the handle does not exist → not_found.
 */
import { CodingPlatform } from "../../enums.js";
import { PlatformError, type CodingPlatformAdapter, type NormalizedStats } from "../types.js";
import { asInt, isDict, safeText, throwForResponse, timedFetch, trimRaw } from "./base.js";

const GRAPHQL_URL = "https://leetcode.com/graphql";

const QUERY = `query getUser($username: String!) {
  matchedUser(username: $username) {
    username
    profile { ranking }
    submitStatsGlobal { acSubmissionNum { difficulty count } }
  }
  userContestRanking(username: $username) { rating }
}`;

export const leetcodeAdapter: CodingPlatformAdapter = {
  platform: CodingPlatform.LEETCODE,
  async fetchStats(handle, timeoutMs) {
    const res = await timedFetch(
      GRAPHQL_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          // LeetCode's GraphQL rejects requests without a Referer.
          Referer: `https://leetcode.com/u/${encodeURIComponent(handle)}/`,
        },
        body: JSON.stringify({ query: QUERY, variables: { username: handle } }),
      },
      timeoutMs,
    );
    const bodyText = await safeText(res);
    if (!res.ok) throwForResponse(res.status, bodyText);

    let json: unknown = null;
    try {
      json = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      throw new PlatformError("LeetCode returned non-JSON", {
        classification: "unavailable",
      });
    }
    const data = isDict(json) && isDict(json.data) ? json.data : null;
    if (!data) {
      throw new PlatformError("Unexpected LeetCode response shape", {
        classification: "unavailable",
      });
    }
    const user = data.matchedUser;
    if (user === null || user === undefined) {
      throw new PlatformError("No such LeetCode user", { classification: "not_found" });
    }
    if (!isDict(user)) {
      throw new PlatformError("Unexpected LeetCode user shape", {
        classification: "unavailable",
      });
    }

    // problems solved = the "All" difficulty accepted-submission count.
    let problemsSolved: number | null = null;
    const stat = isDict(user.submitStatsGlobal) ? user.submitStatsGlobal : null;
    const acList = stat && Array.isArray(stat.acSubmissionNum) ? stat.acSubmissionNum : [];
    for (const row of acList) {
      if (isDict(row) && row.difficulty === "All") {
        problemsSolved = asInt(row.count);
        break;
      }
    }

    const contest = isDict(data.userContestRanking) ? data.userContestRanking : null;
    const profile = isDict(user.profile) ? user.profile : null;
    const ranking = profile ? asInt(profile.ranking) : null;

    const stats: NormalizedStats = {
      rating: contest ? asInt(contest.rating) : null,
      maxRating: null, // LeetCode does not expose a peak contest rating here.
      problemsSolved,
      rank: ranking !== null ? `#${ranking}` : null,
      raw: trimRaw({ matchedUser: user, userContestRanking: contest }),
    };
    return stats;
  },
};
