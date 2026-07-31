/**
 * Pure essay-keyword helpers (@codeapt/shared): the deterministic fallback
 * extractor and the normalize/validate step. No I/O — deterministic.
 */
import {
  extractKeywordsDeterministic,
  normalizeKeywords,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

describe("extractKeywordsDeterministic", () => {
  it("extracts salient words, drops stopwords, dedupes, ranks by frequency", () => {
    const text =
      "Remote work improves productivity. Remote work and flexibility boost " +
      "productivity for teams.";
    const kws = extractKeywordsDeterministic(text);
    // stopwords excluded
    expect(kws).not.toContain("and");
    expect(kws).not.toContain("for");
    // salient words present
    expect(kws).toContain("remote");
    expect(kws).toContain("work");
    expect(kws).toContain("productivity");
    // deduped
    expect(new Set(kws).size).toBe(kws.length);
    // most frequent (2×) surface first, first-seen tie-break
    expect(kws[0]).toBe("remote");
  });

  it("caps the count and ignores very short tokens", () => {
    const text =
      "aa bb cc alpha beta gamma delta epsilon zeta eta theta iota kappa lambda";
    const kws = extractKeywordsDeterministic(text, 5);
    expect(kws.length).toBeLessThanOrEqual(5);
    expect(kws).not.toContain("aa"); // length < 3
    expect(kws).not.toContain("bb");
  });

  it("returns [] for stopword-only or empty text", () => {
    expect(extractKeywordsDeterministic("the and of to it")).toEqual([]);
    expect(extractKeywordsDeterministic("")).toEqual([]);
  });
});

describe("normalizeKeywords", () => {
  it("trims, lowercases, collapses whitespace, dedupes, drops empties", () => {
    expect(
      normalizeKeywords([
        "  Remote   Work ",
        "remote work",
        "",
        "   ",
        "Productivity",
      ]),
    ).toEqual(["remote work", "productivity"]);
  });

  it("drops lone stopwords but keeps multi-word phrases", () => {
    expect(normalizeKeywords(["the", "of", "remote work"])).toEqual([
      "remote work",
    ]);
  });

  it("drops over-long entries and caps the count", () => {
    const long = "x".repeat(100);
    expect(normalizeKeywords([long, "valid"])).toEqual(["valid"]);
    const many = Array.from({ length: 30 }, (_, i) => `kw${i}`);
    expect(normalizeKeywords(many).length).toBeLessThanOrEqual(12);
  });

  it("returns [] for non-array input (defensive)", () => {
    expect(normalizeKeywords(null)).toEqual([]);
    expect(normalizeKeywords("nope")).toEqual([]);
    expect(normalizeKeywords(undefined)).toEqual([]);
    expect(normalizeKeywords([1, 2, {}])).toEqual([]);
  });
});
