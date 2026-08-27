/**
 * Step 35 D — near-duplicate question detection. The generator is told what it has
 * already asked; this is the last-line defence that catches a near-duplicate that
 * slips through anyway. Phrasing-insensitive (compares CONTENT words by phonetic
 * key), so a re-worded repeat is still caught, while genuinely different questions
 * survive. The headline test drives a full 6+ turn session and asserts no repeat.
 */
import {
  dropDuplicateQuestions,
  isNearDuplicateQuestion,
  questionSimilarity,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

describe("questionSimilarity / isNearDuplicateQuestion", () => {
  it("treats re-phrasings of the same question as duplicates", () => {
    const a = "How did you scale the payments service under load?";
    const b = "How would you scale that payments service when it is under load?";
    expect(questionSimilarity(a, b)).toBeGreaterThan(0.7);
    expect(isNearDuplicateQuestion(b, [a])).toBe(true);
  });

  it("does NOT flag genuinely different questions", () => {
    const asked = [
      "Tell me about a time you disagreed with a teammate.",
      "How did you scale the payments service under load?",
    ];
    expect(isNearDuplicateQuestion("Which database did you choose for the ledger, and why?", asked)).toBe(
      false,
    );
    expect(isNearDuplicateQuestion("Describe how you tested the migration.", asked)).toBe(false);
  });

  it("catches a short question wholly contained in a longer asked one", () => {
    const asked = ["Walk me through how you sequence the monolith migration and why."];
    expect(isNearDuplicateQuestion("How did you sequence the monolith migration?", asked)).toBe(
      true,
    );
  });

  it("dropDuplicateQuestions removes repeats vs asked AND within the batch", () => {
    const asked = ["Tell me about the monolith migration you led."];
    const batch = [
      { text: "What was the hardest part of that monolith migration?" }, // new
      { text: "Tell me about the monolith migration you did." }, // dup of asked
      { text: "What was the hardest part of the monolith migration?" }, // dup of #1
      { text: "How do you approach code review?" }, // new
    ];
    const kept = dropDuplicateQuestions(batch, asked);
    expect(kept.map((q) => q.text)).toEqual([
      "What was the hardest part of that monolith migration?",
      "How do you approach code review?",
    ]);
  });
});

describe("a full 6+ turn session never repeats (D)", () => {
  it("every question asked across mains + follow-ups is unique", () => {
    // Simulate the server loop: a plan, then follow-ups appended turn by turn.
    // Each new question is admitted only if it isn't a near-duplicate of any asked.
    const admit = (asked: string[], candidate: string): boolean => {
      if (isNearDuplicateQuestion(candidate, asked)) return false;
      asked.push(candidate);
      return true;
    };
    const asked: string[] = [];
    const plan = [
      "Tell me about yourself and why this role.",
      "Describe the monolith migration you led.",
      "Which datastore did you pick for the ledger, and why?",
      "How do you make sure what you ship is correct?",
      "Tell me about a disagreement with a teammate.",
      "How would you debug something you have never seen before?",
    ];
    for (const q of plan) expect(admit(asked, q)).toBe(true);

    // Follow-ups arrive; lexical/phonetic near-duplicates must be rejected (a
    // pure synonym swap like "pick"→"choose" is the LLM prompt's job, not this).
    expect(admit(asked, "How did you sequence that monolith migration?")).toBe(true); // fresh probe
    expect(admit(asked, "Tell me again about the monolith migration you led.")).toBe(false); // repeat
    expect(admit(asked, "Which datastore did you pick for the ledger?")).toBe(false); // contained in #3

    // No two admitted questions are near-duplicates of each other.
    for (let i = 0; i < asked.length; i += 1) {
      for (let j = i + 1; j < asked.length; j += 1) {
        expect(questionSimilarity(asked[i]!, asked[j]!)).toBeLessThan(0.7);
      }
    }
    expect(asked.length).toBeGreaterThanOrEqual(7);
  });
});
