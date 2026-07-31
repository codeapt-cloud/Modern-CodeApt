/**
 * CodeChef adapter — the MOST FRAGILE source. CodeChef has no public API, so
 * this scrapes the public profile page HTML for the current rating + stars. That
 * markup can change at any time; when it does, this adapter is the ONLY thing
 * that breaks (fixable in isolation) — never the refresh job or other platforms.
 *
 *   - `rating-number`  → current rating
 *   - `rating-header` "(Div N)" / the stars glyphs → the `rank` label
 *   - the profile 404s for an unknown handle → not_found
 *
 * We deliberately parse with tolerant regexes and fall back to an `unavailable`
 * PlatformError (keep last-known data) whenever the shape is not what we expect,
 * rather than guessing. problemsSolved is not reliably scrapeable → left null.
 */
import { CodingPlatform } from "../../enums.js";
import { PlatformError, type CodingPlatformAdapter, type NormalizedStats } from "../types.js";
import { asInt, safeText, throwForResponse, timedFetch } from "./base.js";

const PROFILE_BASE = "https://www.codechef.com/users";

const RATING_RE = /class="rating-number"[^>]*>\s*(\d{3,4})/i;
const STARS_RE = /class="rating-star[^"]*"[^>]*>([\s\S]*?)<\/span>/i;
const DIV_RE = /\(Div\s*(\d)\)/i;

/** Count the "★" glyphs in the stars span (CodeChef shows 1–7 stars). */
function countStars(html: string): number | null {
  const m = STARS_RE.exec(html);
  if (!m) return null;
  const stars = ((m[1] ?? "").match(/★/g) ?? []).length;
  return stars > 0 ? stars : null;
}

export const codechefAdapter: CodingPlatformAdapter = {
  platform: CodingPlatform.CODECHEF,
  async fetchStats(handle, timeoutMs) {
    const res = await timedFetch(
      `${PROFILE_BASE}/${encodeURIComponent(handle)}`,
      { headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0 (compatible; CodeApt/1.0)" } },
      timeoutMs,
    );
    const html = await safeText(res);
    if (res.status === 404) {
      throw new PlatformError("No such CodeChef user", {
        classification: "not_found",
        httpStatus: 404,
      });
    }
    if (!res.ok) throwForResponse(res.status, "");

    const ratingMatch = RATING_RE.exec(html);
    if (!ratingMatch) {
      // Either the handle is unknown (some CodeChef 200s render an empty
      // profile) or the markup changed. Treat as unavailable → keep last-known.
      throw new PlatformError("Could not parse CodeChef rating", {
        classification: "unavailable",
        httpStatus: res.status,
      });
    }
    const rating = asInt(ratingMatch[1]);
    const stars = countStars(html);
    const div = DIV_RE.exec(html)?.[1] ?? null;
    const rank =
      stars !== null
        ? `${stars}★${div ? ` (Div ${div})` : ""}`
        : div
          ? `Div ${div}`
          : null;

    const stats: NormalizedStats = {
      rating,
      maxRating: null, // not reliably present on the profile page
      problemsSolved: null, // not reliably scrapeable
      rank,
      raw: { rating, stars, div },
    };
    return stats;
  },
};
