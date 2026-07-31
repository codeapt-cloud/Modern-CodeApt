/**
 * Unit tests for the pure essay scoring engine (@codeapt/shared): each
 * dimension analyzer, the weighted combine (weights sum to 1), the bonus, and
 * the hybrid blend. No I/O — pure functions of text + reference keywords.
 */
import {
  ESSAY_AI_BLEND,
  ESSAY_BONUS_POINTS,
  ESSAY_SCORE_WEIGHTS,
  blendHybrid,
  classifySpellingToken,
  combineDimensions,
  countParagraphs,
  countWords,
  readabilityBandScore,
  scoreDeterministic,
  scoreReadability,
  scoreRelevance,
  scoreSpelling,
  scoreStructure,
  scoreVocabulary,
  type EssayDimensionScores,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

const KEYWORDS = ["technology", "education", "students", "learning", "digital"];

const RICH_ESSAY = [
  "Technology has fundamentally reshaped modern education. Digital tools now",
  "give students unprecedented access to learning resources, and educators",
  "leverage them to personalize instruction.",
  "",
  "However, this transformation is not without challenges. Consequently,",
  "institutions must evaluate how digital platforms affect equity. Moreover,",
  "teachers require substantial training to integrate these frameworks",
  "effectively.",
  "",
  "In conclusion, technology offers significant opportunities for education,",
  "yet its impact on students depends on thoughtful, deliberate adoption.",
].join("\n");

describe("tokenization helpers", () => {
  it("counts words and paragraphs", () => {
    expect(countWords("hello world foo")).toBe(3);
    expect(countWords("   ")).toBe(0);
    expect(countParagraphs("a\n\nb\n\nc")).toBe(3);
    expect(countParagraphs("single block")).toBe(1);
    expect(countParagraphs("")).toBe(0);
  });
});

describe("weights", () => {
  it("sum to 1.00", () => {
    const sum = Object.values(ESSAY_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("apply the rebalanced values (mechanics 22%, vocabulary trimmed)", () => {
    expect(ESSAY_SCORE_WEIGHTS.grammar).toBe(0.12);
    expect(ESSAY_SCORE_WEIGHTS.spelling).toBe(0.05);
    expect(ESSAY_SCORE_WEIGHTS.punctuation).toBe(0.05);
    expect(ESSAY_SCORE_WEIGHTS.readability).toBe(0.08);
    expect(ESSAY_SCORE_WEIGHTS.vocabulary).toBe(0.22);
    expect(ESSAY_SCORE_WEIGHTS.structure).toBe(0.23);
    expect(ESSAY_SCORE_WEIGHTS.relevance).toBe(0.25);
    const mechanics =
      ESSAY_SCORE_WEIGHTS.grammar +
      ESSAY_SCORE_WEIGHTS.spelling +
      ESSAY_SCORE_WEIGHTS.punctuation;
    expect(mechanics).toBeCloseTo(0.22, 10);
  });
});

describe("scoreVocabulary", () => {
  it("is 0 for empty text and higher for richer, varied prose", () => {
    expect(scoreVocabulary("")).toBe(0);
    const repetitive = "good good good good good good good good good good";
    const varied =
      "The intricate analysis demonstrated substantial nuance and depth.";
    expect(scoreVocabulary(varied)).toBeGreaterThan(
      scoreVocabulary(repetitive),
    );
  });
  it("penalizes filler words", () => {
    const clean = "The economy expanded because exports rose sharply.";
    const filler =
      "The economy really just basically actually literally expanded.";
    expect(scoreVocabulary(clean)).toBeGreaterThan(scoreVocabulary(filler));
  });
});

describe("scoreStructure", () => {
  it("rewards paragraphs + transitions over a single flat run-on", () => {
    const flat = "I like this. I like that. I like more. I like it all.";
    expect(scoreStructure(RICH_ESSAY)).toBeGreaterThan(scoreStructure(flat));
  });
  it("is 0 with no sentences", () => {
    expect(scoreStructure("")).toBe(0);
  });
});

describe("scoreRelevance", () => {
  it("uses coverage_ratio ** 1.5 * 100", () => {
    // 2 of 4 keywords → 0.5 ** 1.5 * 100 ≈ 35.36
    const text = "technology and education matter";
    const score = scoreRelevance(text, [
      "technology",
      "education",
      "economy",
      "politics",
    ]);
    expect(score).toBeCloseTo(0.5 ** 1.5 * 100, 1);
  });
  it("full coverage scores 100; no keywords is neutral 100", () => {
    expect(scoreRelevance("alpha beta", ["alpha", "beta"])).toBe(100);
    expect(scoreRelevance("anything", [])).toBe(100);
  });
  it("matches multi-word phrases as substrings", () => {
    expect(scoreRelevance("I support remote work today", ["remote work"])).toBe(
      100,
    );
    expect(scoreRelevance("nothing here", ["remote work"])).toBe(0);
  });
});

describe("scoreSpelling (fallback heuristic, no dictionary)", () => {
  it("penalizes known misspellings", () => {
    const good = "I will receive the document tomorrow.";
    const bad = "I will recieve teh document tommorow.";
    expect(scoreSpelling(good)).toBe(100);
    expect(scoreSpelling(bad)).toBeLessThan(100);
  });
});

describe("scoreSpelling (real dictionary, injected)", () => {
  const KNOWN = new Set([
    "the",
    "cat",
    "sat",
    "mat",
    "students",
    "learn",
    "quickly",
    "from",
    "their",
    "teachers",
    "well",
    "being",
  ]);
  const dict = (w: string): boolean => KNOWN.has(w);

  it("scores a correctly-spelled essay full", () => {
    expect(
      scoreSpelling("The students learn quickly from their teachers.", dict),
    ).toBe(100);
  });

  it("scores lower when there are real misspellings", () => {
    const clean = scoreSpelling("students learn quickly", dict);
    const typos = scoreSpelling("studdents lurn kwikly", dict);
    expect(clean).toBe(100);
    expect(typos).toBeLessThan(clean);
    expect(typos).toBeLessThan(100);
  });

  it("does NOT flag proper nouns, numbers, URLs, emails, or code tokens", () => {
    // None appear in KNOWN, yet none may count as a misspelling.
    const text =
      "Einstein 2024 https://example.com a@b.com getUserName the cat sat on the mat";
    expect(scoreSpelling(text, dict)).toBe(100);
  });

  it("accepts hyphenated compounds (known parts) and possessives", () => {
    expect(scoreSpelling("their well-being", dict)).toBe(100);
    expect(scoreSpelling("the students' mat", dict)).toBe(100);
  });
});

describe("tech-term allowlist (spelling false-positive fix)", () => {
  // A dictionary that knows NOTHING: proves the allowlist alone rescues jargon,
  // while real misspellings are still flagged.
  const noDict = (): boolean => false;

  it("does NOT flag allowlisted technical terms", () => {
    for (const term of ["microservices", "backend", "webhook", "middleware"]) {
      expect(classifySpellingToken(term, noDict)).toBe("ok");
    }
  });

  it("STILL flags real misspellings (allowlist doesn't weaken detection)", () => {
    for (const bad of ["recieve", "definately", "productivmity"]) {
      expect(classifySpellingToken(bad, noDict)).toBe("error");
    }
  });
});

describe("scoreReadability", () => {
  it("returns a 0..100 score", () => {
    const s = scoreReadability("The cat sat on the mat. It was a warm day.");
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });
});

describe("readabilityBandScore (distance-from-ideal-band)", () => {
  it("scores 100 inside the ideal band and at its edges", () => {
    expect(readabilityBandScore(40)).toBe(100); // mid-band formal prose
    expect(readabilityBandScore(20)).toBe(100); // lower edge
    expect(readabilityBandScore(60)).toBe(100); // upper edge
  });

  it("penalizes BOTH extremes (impenetrable and over-simplistic)", () => {
    const tooHard = readabilityBandScore(5); // dense / impenetrable
    const tooEasy = readabilityBandScore(90); // dumbed-down
    expect(tooHard).toBeLessThan(100);
    expect(tooEasy).toBeLessThan(100);
    // Both strictly below an in-band value.
    expect(tooHard).toBeLessThan(readabilityBandScore(35));
    expect(tooEasy).toBeLessThan(readabilityBandScore(35));
  });

  it("rewards sophisticated formal prose over over-simple prose", () => {
    // Sophisticated formal writing lands low on raw Flesch but inside the band;
    // simplistic rambling lands high on raw Flesch, outside the band.
    expect(readabilityBandScore(25)).toBeGreaterThan(readabilityBandScore(75));
    expect(readabilityBandScore(25)).toBe(100);
  });

  it("decays to 0 far outside the band", () => {
    expect(readabilityBandScore(-20)).toBe(0); // 40 below → 0
    expect(readabilityBandScore(100)).toBe(0); // 40 above → 0
  });
});

describe("combineDimensions", () => {
  const perfect: EssayDimensionScores = {
    grammar: 100,
    spelling: 100,
    punctuation: 100,
    readability: 100,
    vocabulary: 100,
    structure: 100,
    relevance: 100,
  };

  it("all-100 with bonus caps at 100", () => {
    const { total, bonusApplied } = combineDimensions(perfect);
    expect(bonusApplied).toBe(true);
    expect(total).toBe(100); // 100 + 5 bonus, clamped
  });

  it("is the weighted sum when the bonus is not earned", () => {
    const dims: EssayDimensionScores = { ...perfect, vocabulary: 40 };
    const expected =
      100 * (1 - ESSAY_SCORE_WEIGHTS.vocabulary) +
      40 * ESSAY_SCORE_WEIGHTS.vocabulary;
    const { total, bonusApplied } = combineDimensions(dims);
    expect(bonusApplied).toBe(false); // vocabulary < 80
    expect(total).toBeCloseTo(expected, 6);
  });

  it("computes the final score with the rebalanced weights", () => {
    const dims: EssayDimensionScores = {
      grammar: 80,
      spelling: 60,
      punctuation: 100,
      readability: 70,
      vocabulary: 50,
      structure: 40,
      relevance: 30,
    };
    // Hard-coded NEW weights so a regression on the rebalance fails here.
    const manual =
      80 * 0.12 +
      60 * 0.05 +
      100 * 0.05 +
      70 * 0.08 +
      50 * 0.22 +
      40 * 0.23 +
      30 * 0.25;
    const { total, bonusApplied } = combineDimensions(dims);
    expect(bonusApplied).toBe(false);
    expect(total).toBeCloseTo(manual, 6);
  });

  it("awards the bonus only when vocab+structure+relevance all >= 80", () => {
    const dims: EssayDimensionScores = {
      grammar: 0,
      spelling: 0,
      punctuation: 0,
      readability: 0,
      vocabulary: 85,
      structure: 82,
      relevance: 90,
    };
    const weighted =
      85 * ESSAY_SCORE_WEIGHTS.vocabulary +
      82 * ESSAY_SCORE_WEIGHTS.structure +
      90 * ESSAY_SCORE_WEIGHTS.relevance;
    const { total, bonusApplied } = combineDimensions(dims);
    expect(bonusApplied).toBe(true);
    expect(total).toBeCloseTo(weighted + ESSAY_BONUS_POINTS, 6);
  });
});

describe("scoreDeterministic", () => {
  it("produces a full 0..100 breakdown + stats and is deterministic", () => {
    const a = scoreDeterministic(RICH_ESSAY, { referenceKeywords: KEYWORDS });
    const b = scoreDeterministic(RICH_ESSAY, { referenceKeywords: KEYWORDS });
    expect(a).toEqual(b); // pure
    expect(a.total).toBeGreaterThan(0);
    expect(a.total).toBeLessThanOrEqual(100);
    expect(a.wordCount).toBe(countWords(RICH_ESSAY));
    for (const dim of Object.keys(ESSAY_SCORE_WEIGHTS)) {
      const v = a.dimensions[dim as keyof EssayDimensionScores];
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

describe("blendHybrid", () => {
  const det: EssayDimensionScores = {
    grammar: 50,
    spelling: 50,
    punctuation: 50,
    readability: 50,
    vocabulary: 40,
    structure: 60,
    relevance: 70,
  };

  it("blends vocab/structure (0.5) and relevance (0.6) per-dimension", () => {
    const blended = blendHybrid(
      { vocabulary: 90, structure: 100, relevance: 20 },
      det,
    );
    expect(blended.dimensions.vocabulary).toBeCloseTo(
      40 * (1 - ESSAY_AI_BLEND.vocabulary) + 90 * ESSAY_AI_BLEND.vocabulary,
      6,
    );
    expect(blended.dimensions.structure).toBeCloseTo(
      60 * (1 - ESSAY_AI_BLEND.structure) + 100 * ESSAY_AI_BLEND.structure,
      6,
    );
    expect(blended.dimensions.relevance).toBeCloseTo(
      70 * (1 - ESSAY_AI_BLEND.relevance) + 20 * ESSAY_AI_BLEND.relevance,
      6,
    );
  });

  it("uses the documented blend ratios (vocab .5, structure .5, relevance .6)", () => {
    expect(ESSAY_AI_BLEND.vocabulary).toBe(0.5);
    expect(ESSAY_AI_BLEND.structure).toBe(0.5);
    expect(ESSAY_AI_BLEND.relevance).toBe(0.6);
  });

  it("NEVER blends mechanics even if the AI supplies them", () => {
    // grammar/spelling/punctuation/readability have no blend weight → untouched.
    const blended = blendHybrid(
      { grammar: 0, spelling: 0, punctuation: 0, readability: 0 },
      det,
    );
    expect(blended.dimensions.grammar).toBe(50);
    expect(blended.dimensions.spelling).toBe(50);
    expect(blended.dimensions.punctuation).toBe(50);
    expect(blended.dimensions.readability).toBe(50);
  });

  it("recomputes the total from the blended breakdown", () => {
    const blended = blendHybrid({ vocabulary: 90 }, det);
    const manual = combineDimensions(blended.dimensions);
    expect(blended.total).toBeCloseTo(manual.total, 6);
  });

  it("ignores non-finite / absent AI values", () => {
    const blended = blendHybrid({}, det);
    expect(blended.dimensions).toEqual(det);
  });
});
