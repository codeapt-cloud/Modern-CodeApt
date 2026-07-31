/**
 * Pure daily-challenge date + streak math. No I/O, no Mongoose — everything the
 * streak/leaderboard logic needs is a deterministic function of a UTC timestamp
 * and the stored streak state, so it can be exhaustively unit-tested.
 *
 * Storage stays UTC; challenges are bucketed by IST ("challenge day") because
 * the product's day boundary is Asia/Kolkata (UTC+05:30, no DST).
 */
import { IST_OFFSET_MINUTES } from "./constants.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60 * 1000;

/** Parse a `YYYY-MM-DD` key into numeric parts (throws on malformed input). */
function parseDayKey(dayKey: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) throw new Error(`Invalid day key: ${dayKey}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function formatUtcDay(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * The IST "challenge day" key (`YYYY-MM-DD`) a UTC instant falls in. We shift
 * the instant by +5:30 and read the wall-clock date via UTC getters.
 */
export function istDayKey(date: Date): string {
  return formatUtcDay(date.getTime() + IST_OFFSET_MS);
}

/** The day key immediately before `dayKey`. */
export function previousDayKey(dayKey: string): string {
  const { y, m, d } = parseDayKey(dayKey);
  return formatUtcDay(Date.UTC(y, m - 1, d) - DAY_MS);
}

/** The day key immediately after `dayKey` (used by sequential auto-scheduling). */
export function nextDayKey(dayKey: string): string {
  const { y, m, d } = parseDayKey(dayKey);
  return formatUtcDay(Date.UTC(y, m - 1, d) + DAY_MS);
}

/**
 * The UTC [start, end) range covering an IST challenge day — used to query
 * `releaseDate` (stored UTC) for "today's" question. IST midnight is the day
 * key at 00:00 shifted back 5:30 into UTC.
 */
export function istDayRangeUtc(dayKey: string): { start: Date; end: Date } {
  const { y, m, d } = parseDayKey(dayKey);
  const startMs = Date.UTC(y, m - 1, d) - IST_OFFSET_MS;
  return { start: new Date(startMs), end: new Date(startMs + DAY_MS) };
}

export interface StreakState {
  currentStreak: number;
  maxStreak: number;
  /** IST day key of the last solve, or null if never solved. */
  lastSolvedDay: string | null;
}

/**
 * Next streak state after a solve on `todayKey`:
 *  - already solved today  → no-op (unchanged)
 *  - solved yesterday      → currentStreak + 1
 *  - gap (or first ever)   → reset to 1
 * maxStreak = max(previous max, new current).
 */
export function computeStreakUpdate(
  prev: StreakState,
  todayKey: string,
): StreakState {
  if (prev.lastSolvedDay === todayKey) return prev;

  const continues = prev.lastSolvedDay === previousDayKey(todayKey);
  const currentStreak = continues ? prev.currentStreak + 1 : 1;
  return {
    currentStreak,
    maxStreak: Math.max(prev.maxStreak, currentStreak),
    lastSolvedDay: todayKey,
  };
}
