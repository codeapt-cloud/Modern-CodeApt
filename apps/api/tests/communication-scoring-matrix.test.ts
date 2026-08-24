/**
 * Step 19 Part B.2 — the SPEAKING scoring path exercised across every item type
 * with a stubbed-but-realistic transcript matrix: PERFECT, genuine ERROR,
 * HOMOPHONE substitution (must stay correct via phonetic tolerance for SPOKEN
 * items, but count as an error for TYPED dictation), EMPTY, and GARBAGE. Pure —
 * imports only @codeapt/shared scorers (no Mongo, no ASR, no network); this is
 * the deterministic core the worker's speech.processor dispatches to.
 */
import {
  matchAnswerSet,
  scoreDictation,
  scoreFillMissingWord,
  scoreOpenTopicFloor,
  scoreReadAloud,
  scoreStoryRetellFloor,
  type WordTiming,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

/** Evenly-spaced word timings from a transcript (what the ASR would return). */
function words(transcript: string): WordTiming[] {
  const toks = transcript.split(/\s+/u).filter(Boolean);
  return toks.map((word, i) => ({ word, start: i * 0.4, end: i * 0.4 + 0.35 }));
}

describe("scoring matrix — read_aloud / repeat family (WER, phonetic-tolerant)", () => {
  const REF = "the bright red fox ran right past the gate";
  it("PERFECT → ~100% word accuracy", () => {
    const s = scoreReadAloud(REF, REF, words(REF));
    expect(s.wordAccuracy).toBe(100);
    expect(s.missedWords).toEqual([]);
  });
  it("genuine ERROR (dropped + wrong words) → measurably lower", () => {
    const hyp = "the red dog past gate";
    const s = scoreReadAloud(REF, hyp, words(hyp));
    expect(s.wordAccuracy).toBeLessThan(80);
    expect(s.missedWords.length).toBeGreaterThan(0);
  });
  it("HOMOPHONE spelling from the ASR ('right'→'write','red'→'read') still scores correct", () => {
    // A homophone is a SPELLING artifact of the ASR, not a misreading — phonetic
    // tolerance forgives it, so accuracy stays ~perfect.
    const hyp = "the bright read fox ran write past the gate";
    const s = scoreReadAloud(REF, hyp, words(hyp));
    expect(s.wordAccuracy).toBe(100);
    expect(s.phoneticMatches.length).toBeGreaterThanOrEqual(2);
  });
  it("EMPTY transcript → 0", () => {
    const s = scoreReadAloud(REF, "", []);
    expect(s.wordAccuracy).toBe(0);
  });
  it("GARBAGE (unrelated words) → very low", () => {
    const hyp = "banana helicopter purple mathematics ocean";
    const s = scoreReadAloud(REF, hyp, words(hyp));
    expect(s.wordAccuracy).toBeLessThan(30);
  });
});

describe("scoring matrix — short_answer / conversation / passage_question (answer set)", () => {
  const ANSWERS = ["twenty four point five", "24.5"];
  it("PERFECT (an acceptable answer) → matched, 100", () => {
    const s = matchAnswerSet("the total is twenty four point five kilograms", ANSWERS);
    expect(s.matched).toBe(true);
    expect(s.score).toBe(100);
  });
  it("HOMOPHONE inside the answer ('four'→'for') still matches", () => {
    const s = matchAnswerSet("twenty for point five", ANSWERS);
    expect(s.matched).toBe(true);
  });
  it("WRONG answer → not matched, 0", () => {
    const s = matchAnswerSet("about thirty kilograms i think", ANSWERS);
    expect(s.matched).toBe(false);
    expect(s.score).toBe(0);
  });
  it("EMPTY → not matched", () => {
    expect(matchAnswerSet("", ANSWERS).matched).toBe(false);
  });
});

describe("scoring matrix — fill_missing_word (presence + sentence WER)", () => {
  const REF = "she quickly opened the heavy wooden door";
  const MISSING = "heavy";
  it("PERFECT (word present + full sentence) → high", () => {
    const s = scoreFillMissingWord(REF, MISSING, REF, words(REF));
    expect(s.missingWordPresent).toBe(true);
    expect(s.score).toBeGreaterThanOrEqual(90);
  });
  it("missing word ABSENT → present flag false, lower score", () => {
    const hyp = "she quickly opened the wooden door";
    const s = scoreFillMissingWord(REF, MISSING, hyp, words(hyp));
    expect(s.missingWordPresent).toBe(false);
    expect(s.score).toBeLessThan(90);
  });
  it("EMPTY → not present, low", () => {
    const s = scoreFillMissingWord(REF, MISSING, "", []);
    expect(s.missingWordPresent).toBe(false);
    expect(s.score).toBeLessThan(50);
  });
});

describe("scoring matrix — dictation (TYPED — phonetics OFF)", () => {
  const REF = "their house is over there by the river";
  it("PERFECT typed → 100, phoneticTolerant false", () => {
    const s = scoreDictation(REF, REF);
    expect(s.wordAccuracy).toBe(100);
    expect(s.phoneticTolerant).toBe(false);
  });
  it("HOMOPHONE TYPED ('their'→'there','there'→'their') IS an error (unlike spoken)", () => {
    // The contrast that matters: a typed homophone is a genuine spelling mistake,
    // so dictation does NOT forgive it — accuracy drops below perfect.
    const typed = "there house is over their by the river";
    const s = scoreDictation(REF, typed);
    expect(s.wordAccuracy).toBeLessThan(100);
  });
  it("EMPTY typed → 0", () => {
    expect(scoreDictation(REF, "").wordAccuracy).toBe(0);
  });
});

describe("scoring matrix — story_retell (fact coverage, paraphrase-tolerant)", () => {
  const FACTS = ["the tour had forty students", "the museum opened in 1885", "the visit lasted two hours"];
  // A genuine paraphrase: different sentence STRUCTURE, and "40" for "forty"
  // (number-word canonicalization is the paraphrase lever — coverage keys on
  // salient content tokens, not a verbatim match).
  const retell =
    "40 students joined the museum tour, the building opened back in 1885, and the whole visit lasted about two hours";
  it("PARAPHRASE (restructured, '40'→'forty') still covers the facts → high coverage", () => {
    const s = scoreStoryRetellFloor(FACTS, retell, words(retell));
    expect(s.coverage.covered).toBeGreaterThanOrEqual(2);
    expect(s.total).toBeGreaterThan(50);
    expect(s.source).toBe("deterministic_floor");
  });
  it("GARBAGE covering nothing → ~0 coverage", () => {
    const g = "purple mathematics ocean helicopter banana";
    const s = scoreStoryRetellFloor(FACTS, g, words(g));
    expect(s.coverage.covered).toBe(0);
  });
  it("EMPTY → 0 coverage", () => {
    const s = scoreStoryRetellFloor(FACTS, "", []);
    expect(s.coverage.covered).toBe(0);
  });
});

describe("scoring matrix — open_topic (fluency floor)", () => {
  it("a fluent answer scores above an empty one", () => {
    const fluent =
      "i think teamwork matters because sharing ideas helps a group solve problems faster and learn from each other";
    const good = scoreOpenTopicFloor(words(fluent));
    const empty = scoreOpenTopicFloor([]);
    expect(good.total).toBeGreaterThan(empty.total);
    expect(empty.total).toBeLessThanOrEqual(good.total);
  });
});
