/**
 * Step 35 G — the STRUCTURAL guard on the contextual (LLM) correction pass. The
 * prompt says "fix mishearings only"; this guard is what ENFORCES it regardless of
 * what the model returns: a small scattered fix is ACCEPTED (and diffed for the
 * audit), while a rewrite — too many words changed, or the length moved — is
 * REJECTED so the safe term-list transcript is kept. The corrected transcript is
 * what gets scored.
 */
import {
  acceptContextCorrection,
  diffWords,
  wordEditRatio,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

describe("wordEditRatio", () => {
  it("is 0 for identical text and grows with changes", () => {
    expect(wordEditRatio("we sync the data nightly", "we sync the data nightly")).toBe(0);
    const oneWord = wordEditRatio("we sing the data nightly", "we sync the data nightly");
    expect(oneWord).toBeGreaterThan(0);
    expect(oneWord).toBeLessThan(0.3);
  });
});

describe("acceptContextCorrection — fixes accepted, rewrites rejected", () => {
  it("ACCEPTS a genuine mishearing fix and reports the change", () => {
    const input = "we used to sing the data between the services every night";
    const candidate = "we used to sync the data between the services every night";
    const r = acceptContextCorrection(input, candidate);
    expect(r.accepted).toBe(true);
    expect(r.text).toBe(candidate);
    expect(r.changes).toEqual([{ from: "sing", to: "sync", kind: "context" }]);
  });

  it("leaves phrasing intact — only the misheard word changes, nothing else moves", () => {
    const input = "i deployed it on kubernetes and it scaled fine";
    const candidate = "i deployed it on kubernetes and it scaled fine";
    const r = acceptContextCorrection(input, candidate);
    // Identical candidate → nothing to accept, input kept, no changes.
    expect(r.accepted).toBe(false);
    expect(r.text).toBe(input);
    expect(r.changes).toHaveLength(0);
  });

  it("REJECTS a rewrite that changes too many words (keeps the term-list text)", () => {
    const input = "i built the api and it worked";
    const rewrite = "I architected a robust, scalable REST API that performed flawlessly in production";
    const r = acceptContextCorrection(input, rewrite);
    expect(r.accepted).toBe(false);
    expect(r.text).toBe(input); // degrade → the safe input is kept
    expect(r.changes).toHaveLength(0);
  });

  it("REJECTS content additions/removals (length moved beyond the budget)", () => {
    const input = "i wrote tests";
    const padded = "i wrote comprehensive unit and integration tests with full coverage across modules";
    expect(acceptContextCorrection(input, padded).accepted).toBe(false);
  });

  it("degrades cleanly on empty / null candidate", () => {
    expect(acceptContextCorrection("hello world", null).accepted).toBe(false);
    expect(acceptContextCorrection("hello world", "").text).toBe("hello world");
  });
});

describe("diffWords", () => {
  it("groups a contiguous substitution into one change", () => {
    expect(diffWords("we sing the daytah", "we sync the data")).toEqual([
      { from: "sing", to: "sync", kind: "context" },
      { from: "daytah", to: "data", kind: "context" },
    ]);
  });
});
