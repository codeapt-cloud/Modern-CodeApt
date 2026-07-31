/**
 * Codeforces adapter — the OFFICIAL public API (reliable, documented).
 *   - user.info  → rating, maxRating, rank
 *   - user.status → problems-solved count (distinct problems with an OK verdict)
 *
 * A wrong handle comes back as HTTP 400 with a `status:"FAILED"` body whose
 * comment says "not found" → mapped to a not_found PlatformError. The solved
 * count is BEST-EFFORT: if user.info succeeds but user.status fails, we still
 * return the rating and leave problemsSolved null rather than failing the whole
 * platform. Everything is parsed defensively.
 */
import { CodingPlatform } from "../../enums.js";
import { PlatformError, type CodingPlatformAdapter, type NormalizedStats } from "../types.js";
import { asInt, asStr, isDict, safeText, throwForResponse, timedFetch, trimRaw } from "./base.js";

const API_BASE = "https://codeforces.com/api";
/** Bound the submissions scan so an extreme account can't return unboundedly. */
const STATUS_COUNT = 100_000;

const NOT_FOUND_RE = /not\s*found|no\s+such/i;

async function callApi(url: string, timeoutMs: number): Promise<unknown> {
  const res = await timedFetch(url, { headers: { Accept: "application/json" } }, timeoutMs);
  const bodyText = await safeText(res);
  let body: unknown = null;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    // Codeforces returns 400 + {status:"FAILED", comment} for a bad handle.
    const comment = isDict(body) ? asStr(body.comment) : null;
    if (res.status === 400 && comment && NOT_FOUND_RE.test(comment)) {
      throw new PlatformError(comment, { classification: "not_found", httpStatus: 400 });
    }
    throwForResponse(res.status, comment ?? bodyText);
  }
  return body;
}

export const codeforcesAdapter: CodingPlatformAdapter = {
  platform: CodingPlatform.CODEFORCES,
  async fetchStats(handle, timeoutMs) {
    const info = await callApi(
      `${API_BASE}/user.info?handles=${encodeURIComponent(handle)}`,
      timeoutMs,
    );
    if (!isDict(info) || info.status !== "OK" || !Array.isArray(info.result)) {
      throw new PlatformError("Unexpected Codeforces user.info shape", {
        classification: "unavailable",
      });
    }
    const user = info.result[0];
    if (!isDict(user)) {
      throw new PlatformError("Codeforces returned no user", {
        classification: "not_found",
      });
    }

    // Best-effort solved count. A failure here must NOT drop the rating we have.
    let problemsSolved: number | null = null;
    try {
      const status = await callApi(
        `${API_BASE}/user.status?handle=${encodeURIComponent(handle)}&from=1&count=${STATUS_COUNT}`,
        timeoutMs,
      );
      if (isDict(status) && Array.isArray(status.result)) {
        const solved = new Set<string>();
        for (const sub of status.result) {
          if (!isDict(sub) || sub.verdict !== "OK" || !isDict(sub.problem)) continue;
          const p = sub.problem;
          solved.add(`${asStr(p.contestId) ?? "x"}-${asStr(p.index) ?? "x"}`);
        }
        problemsSolved = solved.size;
      }
    } catch {
      problemsSolved = null; // keep rating; solved count simply unknown this run
    }

    const stats: NormalizedStats = {
      rating: asInt(user.rating),
      maxRating: asInt(user.maxRating),
      problemsSolved,
      rank: asStr(user.rank),
      raw: trimRaw(user),
    };
    return stats;
  },
};
