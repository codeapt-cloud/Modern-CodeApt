/**
 * Unit tests for the pure daily-challenge date + streak math (@codeapt/shared).
 */
import {
  computeStreakUpdate,
  istDayKey,
  istDayRangeUtc,
  previousDayKey,
  type StreakState,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

describe("istDayKey", () => {
  it("buckets a UTC instant into its IST (UTC+5:30) calendar day", () => {
    // 2026-07-23 19:00 UTC → 2026-07-24 00:30 IST.
    expect(istDayKey(new Date("2026-07-23T19:00:00Z"))).toBe("2026-07-24");
    // 2026-07-23 18:29 UTC → 2026-07-23 23:59 IST (still the 23rd).
    expect(istDayKey(new Date("2026-07-23T18:29:00Z"))).toBe("2026-07-23");
  });
});

describe("previousDayKey", () => {
  it("steps back one day across month boundaries", () => {
    expect(previousDayKey("2026-07-01")).toBe("2026-06-30");
    expect(previousDayKey("2026-01-01")).toBe("2025-12-31");
  });
});

describe("istDayRangeUtc", () => {
  it("returns the UTC window covering an IST day (00:00 IST = 18:30 prev UTC)", () => {
    const { start, end } = istDayRangeUtc("2026-07-24");
    expect(start.toISOString()).toBe("2026-07-23T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-07-24T18:30:00.000Z");
    // A same-IST-day instant falls inside the window.
    const t = new Date("2026-07-24T02:00:00Z"); // 07:30 IST on the 24th
    expect(t >= start && t < end).toBe(true);
  });
});

describe("computeStreakUpdate", () => {
  const base: StreakState = {
    currentStreak: 3,
    maxStreak: 5,
    lastSolvedDay: "2026-07-22",
  };

  it("first-ever solve → streak 1", () => {
    const next = computeStreakUpdate(
      { currentStreak: 0, maxStreak: 0, lastSolvedDay: null },
      "2026-07-23",
    );
    expect(next).toEqual({
      currentStreak: 1,
      maxStreak: 1,
      lastSolvedDay: "2026-07-23",
    });
  });

  it("solved yesterday → increment", () => {
    const next = computeStreakUpdate(base, "2026-07-23");
    expect(next.currentStreak).toBe(4);
    expect(next.maxStreak).toBe(5); // unchanged (4 < 5)
    expect(next.lastSolvedDay).toBe("2026-07-23");
  });

  it("increment past the previous max bumps maxStreak", () => {
    const next = computeStreakUpdate(
      { currentStreak: 5, maxStreak: 5, lastSolvedDay: "2026-07-22" },
      "2026-07-23",
    );
    expect(next.currentStreak).toBe(6);
    expect(next.maxStreak).toBe(6);
  });

  it("gap (skipped a day) → reset to 1, max preserved", () => {
    const next = computeStreakUpdate(
      { currentStreak: 9, maxStreak: 9, lastSolvedDay: "2026-07-20" },
      "2026-07-23",
    );
    expect(next.currentStreak).toBe(1);
    expect(next.maxStreak).toBe(9);
  });

  it("already solved today → no-op (same object state)", () => {
    const already: StreakState = {
      currentStreak: 4,
      maxStreak: 5,
      lastSolvedDay: "2026-07-23",
    };
    expect(computeStreakUpdate(already, "2026-07-23")).toEqual(already);
  });
});
