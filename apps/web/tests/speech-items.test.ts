/**
 * Step 12 speech item-type scorers (@codeapt/shared/speech). Pure, no I/O. Each
 * block pins the DESIGNED behaviour: a correct answer scores correct, a
 * near-miss scores as designed, and empty/garbage input scores honestly (never
 * a crash). Two load-bearing invariants get their own blocks:
 *   - phonetic tolerance does NOT apply to dictation (typed → a homophone is an
 *     error), while it DOES for the spoken read-aloud family;
 *   - the hybrid floors (story_retell / open_topic) are COMPLETE out of 100 with
 *     no AI, and the AI blend never turns a missing AI into a penalty.
 */
import {
  blendOpenTopic,
  blendStoryRetell,
  computeFactCoverage,
  matchAnswerSet,
  scoreDictation,
  scoreFillMissingWord,
  scoreOpenTopicFloor,
  scoreReadAloud,
  scoreStoryRetellFloor,
  type WordTiming,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

/** Build plausible word timings for N words at a natural ~2.5 words/sec pace. */
function timings(words: string[], gap = 0.4): WordTiming[] {
  let t = 0;
  return words.map((word) => {
    const start = t;
    const end = t + 0.3;
    t = end + gap;
    return { word, start, end };
  });
}

// ===========================================================================
// short_answer / conversation / passage_question — answer-set matching
// ===========================================================================
describe("matchAnswerSet — fuzzy + phonetic answer-set matching", () => {
  it("accepts ANY of several acceptable answers", () => {
    const set = ["a bottle", "bottle", "the bottle"];
    expect(matchAnswerSet("a bottle", set).matched).toBe(true);
    expect(matchAnswerSet("the bottle please", set).matched).toBe(true);
    expect(matchAnswerSet("bottle", set).matched).toBe(true);
  });

  it("ignores articles: 'a bottle' is satisfied by 'bottle'", () => {
    expect(matchAnswerSet("bottle", ["a bottle"]).matched).toBe(true);
  });

  it("accepts a phonetic/number equivalent ('four' for a '4' answer)", () => {
    expect(matchAnswerSet("four", ["four", "4"]).matched).toBe(true);
    // Whisper may write "for" for spoken "four" — phonetic tolerance accepts it.
    expect(matchAnswerSet("for", ["four"]).matched).toBe(true);
  });

  it("rejects a wrong answer and reports which answer matched", () => {
    const res = matchAnswerSet("a newspaper", ["a bottle", "bottle"]);
    expect(res.matched).toBe(false);
    expect(res.matchedAnswer).toBeNull();
    expect(res.score).toBe(0);
    const ok = matchAnswerSet("a bottle", ["a bottle", "bottle"]);
    expect(ok.matchedAnswer).toBe("a bottle");
    expect(ok.score).toBe(100);
  });

  it("an empty transcript scores 0, not a crash", () => {
    expect(matchAnswerSet("", ["four"]).matched).toBe(false);
  });
});

// ===========================================================================
// sentence_build — reuses read-aloud WER; word ORDER is the signal
// ===========================================================================
describe("sentence_build (scoreReadAloud over the correct order)", () => {
  const REF = "My mother was reading her favorite magazine.";
  it("the correct sentence scores 100", () => {
    const s = scoreReadAloud(REF, "My mother was reading her favorite magazine", timings(REF.split(" ")));
    expect(s.wordAccuracy).toBe(100);
  });
  it("a scrambled order scores well below 100", () => {
    const s = scoreReadAloud(REF, "was reading my mother her favorite magazine", timings([]));
    expect(s.wordAccuracy).toBeLessThan(100);
  });
});

// ===========================================================================
// fill_missing_word — the gap word present AND the full sentence matches
// ===========================================================================
describe("scoreFillMissingWord", () => {
  const REF = "The meeting has been moved to Friday afternoon.";
  it("word present + full sentence correct = 100", () => {
    const s = scoreFillMissingWord(REF, "moved", "The meeting has been moved to Friday afternoon", timings([]));
    expect(s.missingWordPresent).toBe(true);
    expect(s.sentenceAccuracy).toBe(100);
    expect(s.score).toBe(100);
  });
  it("missing word ABSENT costs half the credit even if the rest is close", () => {
    const s = scoreFillMissingWord(REF, "moved", "The meeting has been to Friday afternoon", timings([]));
    expect(s.missingWordPresent).toBe(false);
    expect(s.score).toBeLessThan(60); // lost the 50% word credit + one deletion
  });
  it("an empty transcript scores honestly, not a crash", () => {
    const s = scoreFillMissingWord(REF, "moved", "", []);
    expect(s.missingWordPresent).toBe(false);
    expect(s.score).toBe(0);
  });
});

// ===========================================================================
// dictation — TYPED, phonetics OFF. THE SCOPING PROOF.
// ===========================================================================
describe("scoreDictation — phonetic tolerance must NOT apply to typed dictation", () => {
  it("an exact typed sentence scores 100", () => {
    const s = scoreDictation("write the report by friday", "write the report by friday");
    expect(s.wordAccuracy).toBe(100);
    expect(s.phoneticTolerant).toBe(false);
  });

  it("a typed HOMOPHONE is an ERROR (unlike the spoken read-aloud path)", () => {
    const ref = "write the report by friday";
    const typed = "right the report by friday"; // homophone typo
    const dict = scoreDictation(ref, typed);
    // Dictation: "right"≠"write" when typed → one substitution, accuracy < 100.
    expect(dict.wordAccuracy).toBeLessThan(100);
    expect(dict.missaidWords).toContainEqual({ expected: "write", heard: "right" });

    // Same pair SPOKEN (read-aloud) is forgiven — proves the two paths differ.
    const spoken = scoreReadAloud(ref, typed, timings([]));
    expect(spoken.wordAccuracy).toBe(100);
    expect(spoken.phoneticMatches).toContainEqual({ expected: "write", heard: "right" });
  });

  it("an empty typed answer scores 0, not a crash", () => {
    expect(scoreDictation("hello world", "").wordAccuracy).toBe(0);
  });
});

// ===========================================================================
// story_retell — paraphrase-tolerant coverage + complete floor + AI blend
// ===========================================================================
describe("computeFactCoverage — paraphrase tolerance (the retell floor)", () => {
  it("a PARAPHRASE covers a fact with almost no shared surface tokens", () => {
    // FOLLOW-UP 1: "it took five years to build" must cover "5 years to build"
    // even though "five" is spelled differently from "5". This is the whole
    // point — literal substring matching would under-credit correct retells.
    const cov = computeFactCoverage(
      ["5 years to build"],
      "well it took five years to build the whole thing",
    );
    expect(cov.facts[0]!.covered).toBe(true);
    expect(cov.covered).toBe(1);
  });

  it("covers the Norway tunnel facts from a natural retelling", () => {
    const facts = [
      "24.5 km long",
      "took 5 years to build",
      "has 4 caves",
      "about 20 minutes to drive through",
    ];
    const retell =
      "the tunnel is 24.5 km long and it took five years to build. " +
      "there are four caves inside and it takes about twenty minutes to drive through.";
    const cov = computeFactCoverage(facts, retell);
    expect(cov.covered).toBe(4);
    expect(cov.ratio).toBe(1);
  });

  it("does NOT credit a fact the student never mentioned", () => {
    const cov = computeFactCoverage(["24.5 km long"], "it was a very long tunnel");
    expect(cov.facts[0]!.covered).toBe(false);
    expect(cov.covered).toBe(0);
  });
});

describe("scoreStoryRetellFloor — complete deterministic floor (no AI)", () => {
  const facts = ["5 years to build", "24.5 km long"];
  it("floor is coverage scaled to the FULL 100 and labelled deterministic", () => {
    const s = scoreStoryRetellFloor(facts, "it took five years to build", timings([]));
    expect(s.source).toBe("deterministic_floor");
    expect(s.coverageScore).toBe(50); // 1 of 2 facts
    expect(s.total).toBe(50); // total === floor, out of 100 (not scaled down)
    expect(s.aiCoherence).toBeNull();
    expect(s.approximate).toBe(false);
  });
  it("an empty retell scores 0 honestly, not a crash", () => {
    const s = scoreStoryRetellFloor(facts, "", []);
    expect(s.total).toBe(0);
    expect(s.coverage.covered).toBe(0);
  });
});

describe("blendStoryRetell — AI blend never penalises a missing AI", () => {
  const floor = scoreStoryRetellFloor(["5 years to build", "24.5 km long"], "it took five years to build", timings([]));
  it("a null/undefined AI score returns the floor UNCHANGED (out of 100)", () => {
    expect(blendStoryRetell(floor, null).total).toBe(floor.total);
    expect(blendStoryRetell(floor, undefined).source).toBe("deterministic_floor");
  });
  it("a real AI coherence blends coverage-dominant and flips to approximate", () => {
    const blended = blendStoryRetell(floor, 100);
    // total = 50*0.6 + 100*0.4 = 70; coverage stays the majority contributor.
    expect(blended.total).toBe(70);
    expect(blended.source).toBe("ai_hybrid");
    expect(blended.approximate).toBe(true);
    expect(blended.aiCoherence).toBe(100);
  });
});

// ===========================================================================
// open_topic — fluency floor + optional AI relevance/grammar
// ===========================================================================
describe("scoreOpenTopicFloor — fluency-only deterministic floor", () => {
  it("a fluent response scores a complete floor out of 100, deterministic", () => {
    const words = timings(
      "I think healthy eating matters because it keeps you strong and focused every day".split(" "),
    );
    const s = scoreOpenTopicFloor(words);
    expect(s.source).toBe("deterministic_floor");
    expect(s.total).toBe(s.fluencyScore);
    expect(s.fluencyScore).toBeGreaterThan(0);
    expect(s.aiRelevance).toBeNull();
    expect(s.aiGrammar).toBeNull();
    expect(s.approximate).toBe(false);
  });
  it("reports latency (silence before the first word)", () => {
    const words: WordTiming[] = [
      { word: "um", start: 2.5, end: 2.8 },
      { word: "yes", start: 3.0, end: 3.3 },
    ];
    expect(scoreOpenTopicFloor(words).latencySeconds).toBe(2.5);
  });
  it("no words → fluencyScore 0, no crash", () => {
    expect(scoreOpenTopicFloor([]).total).toBe(0);
  });
});

describe("blendOpenTopic — AI relevance/grammar labelled approximate", () => {
  const words = timings("this is a reasonably fluent answer about the topic at hand today".split(" "));
  const floor = scoreOpenTopicFloor(words);
  it("no usable AI returns the floor unchanged", () => {
    expect(blendOpenTopic(floor, { relevance: null, grammar: null }).source).toBe(
      "deterministic_floor",
    );
  });
  it("AI dimensions blend in and flip approximate=true", () => {
    const blended = blendOpenTopic(floor, { relevance: 80, grammar: 60 });
    expect(blended.source).toBe("ai_hybrid");
    expect(blended.approximate).toBe(true);
    expect(blended.aiRelevance).toBe(80);
    expect(blended.aiGrammar).toBe(60);
    // total = fluency*0.5 + avg(80,60)*0.5
    expect(blended.total).toBeCloseTo(floor.fluencyScore * 0.5 + 70 * 0.5, 1);
  });
});
