/**
 * Essay grader orchestration tests — no network. Verifies:
 *   - a successful AI adapter → source `ai_hybrid` with a blended breakdown,
 *   - an adapter that throws OR returns null → source `deterministic_fallback`,
 *   - the default `mock` adapter is deterministic and never touches the network.
 */
import {
  ESSAY_AI_BLEND,
  EssayScoreSource,
  blendHybrid,
  scoreDeterministic,
} from "@codeapt/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { env } from "../src/config/env.js";
import { isKnownWord } from "../src/lib/dictionary.js";
import {
  createLlmGrader,
  createMockGrader,
  gradeEssay,
  selectGrader,
  type EssayGrader,
} from "../src/lib/essay-grader.js";

const KEYWORDS = ["technology", "education", "students"];
const ESSAY =
  "Technology reshapes education. Consequently, students gain broad access " +
  "to learning resources, and teachers must adapt their methods.";

const INPUT = {
  essayText: ESSAY,
  prompt: "Discuss technology in education.",
  rubric: "vocabulary + structure",
  referenceKeywords: KEYWORDS,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("gradeEssay orchestration", () => {
  it("AI success → ai_hybrid, blended vs the deterministic floor", async () => {
    const stub: EssayGrader = {
      gradeWithAI: async () => ({
        dimensions: { vocabulary: 95, structure: 90 },
        feedback: "Strong response.",
      }),
    };
    const det = scoreDeterministic(ESSAY, { referenceKeywords: KEYWORDS }, { isKnownWord });
    const expected = blendHybrid(
      { vocabulary: 95, structure: 90 },
      det.dimensions,
    );

    const result = await gradeEssay(INPUT, stub);
    expect(result.source).toBe(EssayScoreSource.AI_HYBRID);
    expect(result.feedback).toBe("Strong response.");
    expect(result.dimensions.vocabulary).toBeCloseTo(
      expected.dimensions.vocabulary,
      6,
    );
    expect(result.total).toBeCloseTo(expected.total, 6);
    // Blended vocabulary differs from the deterministic-only value.
    expect(result.dimensions.vocabulary).not.toBe(det.dimensions.vocabulary);
  });

  it("AI throws → deterministic_fallback (never crashes)", async () => {
    const throwing: EssayGrader = {
      gradeWithAI: async () => {
        throw new Error("AI down / timeout");
      },
    };
    const det = scoreDeterministic(ESSAY, { referenceKeywords: KEYWORDS }, { isKnownWord });

    const result = await gradeEssay(INPUT, throwing);
    expect(result.source).toBe(EssayScoreSource.DETERMINISTIC_FALLBACK);
    expect(result.total).toBe(det.total);
    expect(result.dimensions).toEqual(det.dimensions);
    expect(result.feedback).toMatch(/AI analysis unavailable/i);
  });

  it("AI returns null → deterministic_fallback", async () => {
    const nullish: EssayGrader = { gradeWithAI: async () => null };
    const det = scoreDeterministic(ESSAY, { referenceKeywords: KEYWORDS }, { isKnownWord });
    const result = await gradeEssay(INPUT, nullish);
    expect(result.source).toBe(EssayScoreSource.DETERMINISTIC_FALLBACK);
    expect(result.total).toBe(det.total);
  });

  it("aiEnabled:false → deterministic-only, the AI adapter is NEVER called", async () => {
    const gradeWithAI = vi.fn(async () => ({
      dimensions: { vocabulary: 99, structure: 99 },
      feedback: "should not be used",
    }));
    const det = scoreDeterministic(ESSAY, { referenceKeywords: KEYWORDS }, { isKnownWord });

    const result = await gradeEssay({ ...INPUT, aiEnabled: false }, { gradeWithAI });
    expect(gradeWithAI).not.toHaveBeenCalled(); // no provider call → zero tokens
    expect(result.source).toBe(EssayScoreSource.DETERMINISTIC_FALLBACK);
    expect(result.total).toBe(det.total);
    expect(result.dimensions).toEqual(det.dimensions);
    expect(result.feedback).toMatch(/AI grading is disabled/i);
  });
});

describe("mock grader", () => {
  it("selectGrader() defaults to the mock adapter", () => {
    expect(selectGrader()).toBeDefined();
    // Default provider is pinned to `mock` in tests → ai_hybrid, no network.
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    return gradeEssay(INPUT).then((result) => {
      expect(result.source).toBe(EssayScoreSource.AI_HYBRID);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it("is deterministic (same text → same analysis) and offline", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const grader = createMockGrader();
    const a = await grader.gradeWithAI(INPUT);
    const b = await grader.gradeWithAI(INPUT);
    expect(a).toEqual(b);
    expect(a?.dimensions.vocabulary).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("LLM blend (per-dimension vocab .5 / structure .5 / relevance .6)", () => {
  it("blends the three judgment dimensions end-to-end via blendHybrid", async () => {
    const base = scoreDeterministic(
      ESSAY,
      { referenceKeywords: KEYWORDS },
      { isKnownWord },
    );
    const ai = { vocabulary: 30, structure: 40, relevance: 25 };
    const expected = blendHybrid(ai, base.dimensions);

    const result = await gradeEssay(INPUT, {
      gradeWithAI: async () => ({ dimensions: ai, feedback: "Shallow." }),
    });

    expect(result.source).toBe(EssayScoreSource.AI_HYBRID);
    expect(result.feedback).toBe("Shallow.");
    // gradeEssay uses blendHybrid with the default per-dimension ratios.
    expect(result.dimensions).toEqual(expected.dimensions);
    expect(result.total).toBeCloseTo(expected.total, 6);
    // Mechanics are never touched by the LLM.
    expect(result.dimensions.grammar).toBe(base.dimensions.grammar);
    expect(result.dimensions.spelling).toBe(base.dimensions.spelling);
  });

  it("a low 'vacuous' LLM assessment pulls vocab/structure/relevance + final DOWN", async () => {
    const base = scoreDeterministic(
      ESSAY,
      { referenceKeywords: KEYWORDS },
      { isKnownWord },
    );
    // The whole point of the LLM: catch shallow substance the det engine can't.
    const result = await gradeEssay(INPUT, {
      gradeWithAI: async () => ({
        dimensions: { vocabulary: 15, structure: 15, relevance: 15 },
        feedback: "Vacuous — restates the prompt with no evidence.",
      }),
    });

    expect(result.dimensions.vocabulary).toBeLessThan(base.dimensions.vocabulary);
    expect(result.dimensions.structure).toBeLessThan(base.dimensions.structure);
    expect(result.dimensions.relevance).toBeLessThan(base.dimensions.relevance);
    expect(result.total).toBeLessThan(base.total);
    // Uses the documented ratios.
    expect(ESSAY_AI_BLEND).toEqual({
      vocabulary: 0.5,
      structure: 0.5,
      relevance: 0.6,
    });
  });
});

describe("LLM adapter (mocked network — no real calls)", () => {
  const origUrl = env.ESSAY_LLM_URL;
  const origKey = env.ESSAY_LLM_API_KEY;

  afterEach(() => {
    env.ESSAY_LLM_URL = origUrl;
    env.ESSAY_LLM_API_KEY = origKey;
    vi.unstubAllGlobals();
  });

  const mockChat = (content: string) =>
    vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({ choices: [{ message: { content } }] }),
        }) as unknown as Response,
    );

  it("valid STRICT JSON → parsed 3-dimension analysis + hybrid grade", async () => {
    env.ESSAY_LLM_URL = "https://llm.test/v1";
    env.ESSAY_LLM_API_KEY = "sk-test";
    vi.stubGlobal(
      "fetch",
      mockChat(
        '{"vocabulary":80,"structure":75,"relevance":90,"feedback":"Solid work."}',
      ),
    );

    const analysis = await createLlmGrader().gradeWithAI(INPUT);
    expect(analysis?.dimensions).toEqual({
      vocabulary: 80,
      structure: 75,
      relevance: 90,
    });
    expect(analysis?.feedback).toBe("Solid work.");

    const result = await gradeEssay(INPUT, createLlmGrader());
    expect(result.source).toBe(EssayScoreSource.AI_HYBRID);
    expect(result.feedback).toBe("Solid work.");
  });

  it("out-of-range values are clamped to 0..100", async () => {
    env.ESSAY_LLM_URL = "https://llm.test/v1";
    env.ESSAY_LLM_API_KEY = "sk-test";
    vi.stubGlobal(
      "fetch",
      mockChat('{"vocabulary":250,"structure":-40,"relevance":50}'),
    );
    const analysis = await createLlmGrader().gradeWithAI(INPUT);
    expect(analysis?.dimensions).toEqual({
      vocabulary: 100,
      structure: 0,
      relevance: 50,
    });
  });

  it("malformed output → null → deterministic fallback (grade never fails)", async () => {
    env.ESSAY_LLM_URL = "https://llm.test/v1";
    env.ESSAY_LLM_API_KEY = "sk-test";
    vi.stubGlobal("fetch", mockChat("Sorry, I cannot comply."));

    const analysis = await createLlmGrader().gradeWithAI(INPUT);
    expect(analysis).toBeNull();

    const base = scoreDeterministic(
      ESSAY,
      { referenceKeywords: KEYWORDS },
      { isKnownWord },
    );
    const result = await gradeEssay(INPUT, createLlmGrader());
    expect(result.source).toBe(EssayScoreSource.DETERMINISTIC_FALLBACK);
    expect(result.total).toBe(base.total);
    expect(result.feedback).toMatch(/AI analysis unavailable/i);
  });

  it("missing config → null with NO network call (silent deterministic)", async () => {
    env.ESSAY_LLM_URL = undefined;
    env.ESSAY_LLM_API_KEY = undefined;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const analysis = await createLlmGrader().gradeWithAI(INPUT);
    expect(analysis).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
