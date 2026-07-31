/**
 * Unit tests for the pure essay-compose helpers: the word-count status machine
 * (empty/under/in/over + remaining + canSubmit) and the content-free compose
 * analytics accumulator.
 */
import { describe, expect, it } from "vitest";

import {
  countWords,
  emptyAnalytics,
  essayAttemptStatus,
  essayLaunchState,
  onKeystroke,
  onPaste,
  wordCountStatus,
} from "../src/lib/essay-compose.js";

describe("countWords", () => {
  it("counts whitespace-delimited words", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords("one")).toBe(1);
    expect(countWords("  two  words  ")).toBe(2);
    expect(countWords("a\nb\tc")).toBe(3);
  });
});

describe("essayAttemptStatus", () => {
  it("reports remaining attempts and a friendly label below the cap", () => {
    const s = essayAttemptStatus(1, 3);
    expect(s.used).toBe(1);
    expect(s.max).toBe(3);
    expect(s.remaining).toBe(2);
    expect(s.atLimit).toBe(false);
    expect(s.label).toBe("2 of 3 attempts left");
  });

  it("flags at-limit once used >= max (never negative remaining)", () => {
    const at = essayAttemptStatus(3, 3);
    expect(at.atLimit).toBe(true);
    expect(at.remaining).toBe(0);
    expect(at.label).toBe("Attempt limit reached");

    // Defensive: an over-count (e.g. migrated user past a lowered cap) is still
    // simply "at limit", not a negative remaining.
    const over = essayAttemptStatus(5, 2);
    expect(over.atLimit).toBe(true);
    expect(over.remaining).toBe(0);
  });

  it("singularizes the label for a cap of 1", () => {
    expect(essayAttemptStatus(0, 1).label).toBe("1 of 1 attempt left");
  });

  it("floors a bad cap at 1 and clamps negative usage to 0", () => {
    const s = essayAttemptStatus(-2, 0);
    expect(s.max).toBe(1);
    expect(s.used).toBe(0);
    expect(s.remaining).toBe(1);
    expect(s.atLimit).toBe(false);
  });
});

describe("essayLaunchState (in-course essay launcher)", () => {
  it("is write-enabled below the attempt cap", () => {
    const s = essayLaunchState({ attemptsUsed: 1, maxAttempts: 3 });
    expect(s.found).toBe(true);
    expect(s.canWrite).toBe(true);
    expect(s.atLimit).toBe(false);
    expect(s.attempts?.remaining).toBe(2);
  });

  it("is limit-reached at the cap (no write)", () => {
    const s = essayLaunchState({ attemptsUsed: 3, maxAttempts: 3 });
    expect(s.found).toBe(true);
    expect(s.canWrite).toBe(false);
    expect(s.atLimit).toBe(true);
  });

  it("degrades gracefully when no linked essay resolves", () => {
    for (const missing of [null, undefined]) {
      const s = essayLaunchState(missing);
      expect(s.found).toBe(false);
      expect(s.canWrite).toBe(false);
      expect(s.atLimit).toBe(false);
      expect(s.attempts).toBeNull();
    }
  });
});

describe("wordCountStatus", () => {
  it("empty → not submittable, remaining = min", () => {
    const s = wordCountStatus(0, 20, 100);
    expect(s.state).toBe("empty");
    expect(s.canSubmit).toBe(false);
    expect(s.remaining).toBe(20);
  });

  it("under-min → remaining counts up to the minimum", () => {
    const s = wordCountStatus(12, 20, 100);
    expect(s.state).toBe("under");
    expect(s.canSubmit).toBe(false);
    expect(s.remaining).toBe(8);
    expect(s.message).toMatch(/8 more words/);
  });

  it("in-range → submittable, remaining 0", () => {
    const s = wordCountStatus(50, 20, 100);
    expect(s.state).toBe("in");
    expect(s.canSubmit).toBe(true);
    expect(s.remaining).toBe(0);
  });

  it("over-max → not submittable, remaining = overflow", () => {
    const s = wordCountStatus(130, 20, 100);
    expect(s.state).toBe("over");
    expect(s.canSubmit).toBe(false);
    expect(s.remaining).toBe(30);
    expect(s.message).toMatch(/30 words over/);
  });

  it("boundaries are inclusive (min and max are in range)", () => {
    expect(wordCountStatus(20, 20, 100).state).toBe("in");
    expect(wordCountStatus(100, 20, 100).state).toBe("in");
  });

  it("maxWords <= 0 means no upper bound", () => {
    const s = wordCountStatus(10_000, 20, 0);
    expect(s.state).toBe("in");
    expect(s.canSubmit).toBe(true);
  });

  it("singular phrasing for a remaining of 1", () => {
    expect(wordCountStatus(19, 20, 100).message).toMatch(/1 more word\b/);
    expect(wordCountStatus(101, 20, 100).message).toMatch(/1 word over/);
  });
});

describe("compose analytics accumulator", () => {
  it("starts empty", () => {
    expect(emptyAnalytics()).toEqual({
      keystrokes: 0,
      deletes: 0,
      pasteCount: 0,
      pastedChars: 0,
    });
  });

  it("counts typing keys, and backspace/delete as deletes", () => {
    let a = emptyAnalytics();
    a = onKeystroke(a, "a");
    a = onKeystroke(a, "b");
    a = onKeystroke(a, "Backspace");
    a = onKeystroke(a, "Delete");
    expect(a.keystrokes).toBe(4);
    expect(a.deletes).toBe(2);
  });

  it("ignores modifier / navigation keys", () => {
    let a = emptyAnalytics();
    a = onKeystroke(a, "Shift");
    a = onKeystroke(a, "ArrowLeft");
    a = onKeystroke(a, "Control");
    expect(a.keystrokes).toBe(0);
    expect(a.deletes).toBe(0);
  });

  it("tallies paste count + pasted characters", () => {
    let a = emptyAnalytics();
    a = onPaste(a, 42);
    a = onPaste(a, 8);
    expect(a.pasteCount).toBe(2);
    expect(a.pastedChars).toBe(50);
  });

  it("is immutable (returns a new object)", () => {
    const a = emptyAnalytics();
    const b = onKeystroke(a, "x");
    expect(b).not.toBe(a);
    expect(a.keystrokes).toBe(0);
  });
});
