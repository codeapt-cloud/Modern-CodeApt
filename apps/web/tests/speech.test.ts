/**
 * Unit tests for the pure speech scoring engine (@codeapt/shared). Covers WER /
 * word accuracy on identical / partially-wrong / empty transcripts (the honest
 * zero cases), fluency metrics from synthetic word timings (rate, pauses,
 * fillers), and the composite read-aloud score. No I/O — no ASR service needed.
 */
import {
  fluencyMetrics,
  normalizeWords,
  scoreReadAloud,
  wordErrorRate,
  type WordTiming,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

const REF = "The quick brown fox jumps over the lazy dog";

describe("normalizeWords", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(normalizeWords("The  QUICK, brown-fox!")).toEqual([
      "the",
      "quick",
      "brown",
      "fox",
    ]);
  });
});

describe("wordErrorRate — word accuracy", () => {
  it("identical transcript → 100% accuracy, WER 0, no errors", () => {
    const r = wordErrorRate(REF, "the quick brown fox jumps over the lazy dog");
    expect(r.wer).toBe(0);
    expect(r.wordAccuracy).toBe(100);
    expect(r.substitutions).toBe(0);
    expect(r.deletions).toBe(0);
    expect(r.insertions).toBe(0);
    expect(r.missedWords).toEqual([]);
    expect(r.missaidWords).toEqual([]);
    expect(r.extraWords).toEqual([]);
  });

  it("punctuation/case differences do not count as errors", () => {
    const r = wordErrorRate(REF, "The quick, brown FOX jumps over the lazy dog.");
    expect(r.wordAccuracy).toBe(100);
  });

  it("a substitution is reported with expected + heard", () => {
    // "brown" → "green"
    const r = wordErrorRate(REF, "the quick green fox jumps over the lazy dog");
    expect(r.substitutions).toBe(1);
    expect(r.deletions).toBe(0);
    expect(r.insertions).toBe(0);
    expect(r.missaidWords).toEqual([{ expected: "brown", heard: "green" }]);
    expect(r.wer).toBeCloseTo(1 / 9, 2);
  });

  it("a deletion is reported as a missed word", () => {
    // drop "lazy"
    const r = wordErrorRate(REF, "the quick brown fox jumps over the dog");
    expect(r.deletions).toBe(1);
    expect(r.missedWords).toEqual(["lazy"]);
  });

  it("an insertion is reported as an extra word", () => {
    const r = wordErrorRate(REF, "the quick brown fox jumps over the very lazy dog");
    expect(r.insertions).toBe(1);
    expect(r.extraWords).toEqual(["very"]);
  });

  it("empty hypothesis → every reference word missed, accuracy 0", () => {
    const r = wordErrorRate(REF, "");
    expect(r.deletions).toBe(9);
    expect(r.wer).toBe(1);
    expect(r.wordAccuracy).toBe(0);
    expect(r.missedWords).toHaveLength(9);
  });

  it("empty reference AND empty hypothesis → vacuously perfect (100)", () => {
    const r = wordErrorRate("", "");
    expect(r.wordAccuracy).toBe(100);
  });

  it("empty reference, non-empty hypothesis → accuracy 0, all insertions", () => {
    const r = wordErrorRate("", "hello there");
    expect(r.insertions).toBe(2);
    expect(r.wordAccuracy).toBe(0);
    expect(r.extraWords).toEqual(["hello", "there"]);
  });
});

describe("fluencyMetrics — from word timings", () => {
  const timings: WordTiming[] = [
    { word: "the", start: 0, end: 0.3 },
    { word: "quick", start: 0.4, end: 0.8 },
    { word: "um", start: 2.0, end: 2.3 }, // 1.2s pause before, and a filler
    { word: "fox", start: 2.4, end: 2.8 },
  ];

  it("computes rate, pauses (gap > threshold), longest pause, fillers", () => {
    const f = fluencyMetrics(timings);
    expect(f.wordCount).toBe(4);
    expect(f.durationSeconds).toBeCloseTo(2.8, 5);
    expect(f.speechRate).toBeCloseTo(round2(4 / 2.8), 2);
    // Only the 1.2s gap (0.8 → 2.0) exceeds the 0.5s threshold.
    expect(f.pauseCount).toBe(1);
    expect(f.longestPauseSeconds).toBeCloseTo(1.2, 5);
    expect(f.fillerCount).toBe(1);
    expect(f.fillerRate).toBeCloseTo(0.25, 5);
  });

  it("empty timings → all zeros, never NaN/Infinity", () => {
    const f = fluencyMetrics([]);
    expect(f).toMatchObject({
      wordCount: 0,
      durationSeconds: 0,
      speechRate: 0,
      pauseCount: 0,
      longestPauseSeconds: 0,
      fillerCount: 0,
      fillerRate: 0,
    });
  });

  it("a single word has no measurable span → rate 0 (no divide-by-zero)", () => {
    const f = fluencyMetrics([{ word: "hi", start: 1, end: 1.3 }]);
    expect(f.wordCount).toBe(1);
    expect(f.speechRate).toBe(0);
    expect(f.pauseCount).toBe(0);
  });
});

describe("scoreReadAloud — composite", () => {
  it("combines word accuracy + fluency with NO pronunciation dimension", () => {
    const timings: WordTiming[] = normalizeWords(REF).map((word, i) => ({
      word,
      start: i * 0.5,
      end: i * 0.5 + 0.4,
    }));
    const score = scoreReadAloud(REF, REF, timings);
    expect(score.wordAccuracy).toBe(100);
    expect(score.fluency.wordCount).toBe(9);
    // The result carries no pronunciation/clarity field of any kind.
    expect(Object.keys(score).sort()).toEqual(
      ["extraWords", "fluency", "missaidWords", "missedWords", "wer", "wordAccuracy"].sort(),
    );
  });
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
