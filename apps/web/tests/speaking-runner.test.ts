/**
 * Pure logic for the Speaking runner + results (no React render, no mic). Covers
 * the DoD's four pure surfaces: the renderer-registry lookup, the per-item phase
 * machine (prompt → prep → responding → submitted), the countdown clamp, and the
 * results derivation (50%/60% bands, approximate dimensions, the
 * deterministic-fallback badge).
 */
import { SPEAKING_ITEM_TYPE_VALUES, SpeakingItemType } from "@codeapt/shared";
import type { SpeakingItemResult } from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import {
  getSpeakingItemDefinition,
  SPEAKING_RENDERERS,
} from "../src/components/speaking/renderer-registry.js";
import {
  MAX_RESULT_POLLS,
  deriveSpeakingResults,
  itemScorePercent,
  nextItemPhase,
  nextTick,
  scoreBand,
  shouldAutoPoll,
} from "../src/lib/speaking-runner.js";

// ---------------------------------------------------------------------------
// Renderer registry
// ---------------------------------------------------------------------------
describe("renderer registry", () => {
  it("registers a definition for EVERY item type", () => {
    for (const t of SPEAKING_ITEM_TYPE_VALUES) {
      expect(getSpeakingItemDefinition(t), t).toBeDefined();
    }
    expect(Object.keys(SPEAKING_RENDERERS)).toHaveLength(
      SPEAKING_ITEM_TYPE_VALUES.length,
    );
  });

  it("dictation captures TEXT; every other type captures AUDIO", () => {
    expect(getSpeakingItemDefinition(SpeakingItemType.DICTATION)?.capture).toBe("text");
    for (const t of SPEAKING_ITEM_TYPE_VALUES) {
      if (t === SpeakingItemType.DICTATION) continue;
      expect(getSpeakingItemDefinition(t)?.capture, t).toBe("audio");
    }
  });

  it("an unknown type returns undefined (calm shell fallback, no crash)", () => {
    expect(getSpeakingItemDefinition("nope" as SpeakingItemType)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Per-item phase machine
// ---------------------------------------------------------------------------
describe("nextItemPhase", () => {
  it("no-prep item goes prompt → responding → submitted", () => {
    expect(nextItemPhase("prompt", { prepSeconds: 0 })).toBe("responding");
    expect(nextItemPhase("responding", { prepSeconds: 0 })).toBe("submitted");
  });
  it("a prep item inserts the prep phase: prompt → prep → responding", () => {
    expect(nextItemPhase("prompt", { prepSeconds: 90 })).toBe("prep");
    expect(nextItemPhase("prep", { prepSeconds: 90 })).toBe("responding");
  });
  it("submitted is terminal", () => {
    expect(nextItemPhase("submitted", { prepSeconds: 0 })).toBe("submitted");
  });
});

describe("nextTick — countdown clamp", () => {
  it("counts down and never goes negative", () => {
    expect(nextTick(3)).toBe(2);
    expect(nextTick(1)).toBe(0);
    expect(nextTick(0)).toBe(0);
    expect(nextTick(-5)).toBe(0);
  });
});

describe("shouldAutoPoll — async results give up sanely", () => {
  it("polls while incomplete and under the cap", () => {
    expect(shouldAutoPoll(0, false)).toBe(true);
    expect(shouldAutoPoll(MAX_RESULT_POLLS - 1, false)).toBe(true);
  });
  it("stops at the cap (no spinning for an hour)", () => {
    expect(shouldAutoPoll(MAX_RESULT_POLLS, false)).toBe(false);
  });
  it("never polls once complete", () => {
    expect(shouldAutoPoll(0, true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Results derivation
// ---------------------------------------------------------------------------
describe("scoreBand — 50% pass / 60% distinction", () => {
  it("bands at the documented thresholds", () => {
    expect(scoreBand(60)).toBe("distinction");
    expect(scoreBand(59.9)).toBe("pass");
    expect(scoreBand(50)).toBe("pass");
    expect(scoreBand(49.9)).toBe("fail");
  });
});

describe("itemScorePercent — headline per score kind", () => {
  it("reads the right field per shape", () => {
    expect(
      itemScorePercent({
        wordAccuracy: 88, wer: 0.12, exactMatches: 7, phoneticMatches: [],
        missedWords: [], missaidWords: [], extraWords: [],
        fluency: { wordCount: 8, durationSeconds: 4, speechRate: 2, pauseCount: 0, longestPauseSeconds: 0, fillerCount: 0, fillerRate: 0 },
      }),
    ).toBe(88);
    expect(itemScorePercent({ kind: "answer_set", matched: true, matchedAnswer: "a", score: 100, transcript: "a", acceptableAnswers: ["a"] })).toBe(100);
    expect(itemScorePercent({ kind: "dictation", wordAccuracy: 75, wer: 0.25, exactMatches: 3, missedWords: [], missaidWords: [], extraWords: [], phoneticTolerant: false })).toBe(75);
    expect(itemScorePercent(null)).toBeNull();
  });
});

function readAloudResult(index: number, wordAccuracy: number): SpeakingItemResult {
  return {
    index,
    itemType: SpeakingItemType.READ_ALOUD,
    status: "completed",
    audioUrl: "x",
    transcript: "t",
    score: {
      wordAccuracy, wer: 0, exactMatches: 5, phoneticMatches: [],
      missedWords: [], missaidWords: [], extraWords: [],
      fluency: { wordCount: 5, durationSeconds: 3, speechRate: 1.6, pauseCount: 0, longestPauseSeconds: 0, fillerCount: 0, fillerRate: 0 },
    },
    error: null,
  };
}

function openTopicResult(
  index: number,
  opts: { source: "deterministic_floor" | "ai_hybrid"; total: number; fluencyScore: number; aiGrammar: number | null; aiRelevance: number | null },
): SpeakingItemResult {
  return {
    index,
    itemType: SpeakingItemType.OPEN_TOPIC,
    status: "completed",
    audioUrl: "x",
    transcript: "t",
    score: {
      kind: "open_topic",
      source: opts.source,
      fluency: { wordCount: 30, durationSeconds: 15, speechRate: 2, pauseCount: 1, longestPauseSeconds: 0.6, fillerCount: 1, fillerRate: 0.03 },
      fluencyScore: opts.fluencyScore,
      latencySeconds: 1,
      aiRelevance: opts.aiRelevance,
      aiGrammar: opts.aiGrammar,
      total: opts.total,
      approximate: opts.source === "ai_hybrid",
    },
    error: null,
  };
}

describe("deriveSpeakingResults", () => {
  it("averages scored items, bands the overall, and fills solid dimensions", () => {
    const s = deriveSpeakingResults([
      readAloudResult(0, 80),
      readAloudResult(1, 40),
      {
        index: 2,
        itemType: SpeakingItemType.SHORT_ANSWER,
        status: "completed",
        audioUrl: "x",
        transcript: "a bottle",
        score: { kind: "answer_set", matched: true, matchedAnswer: "a bottle", score: 100, transcript: "a bottle", acceptableAnswers: ["a bottle"] },
        error: null,
      },
    ]);
    expect(s.scoredCount).toBe(3);
    expect(s.overallPercent).toBeCloseTo((80 + 40 + 100) / 3, 1);
    expect(s.band).toBe("distinction"); // ~73%
    expect(s.dimensions.accuracy).toBeCloseTo(60, 1); // (80+40)/2
    expect(s.dimensions.listening).toBe(100);
    expect(s.dimensions.grammar).toBeNull(); // no AI item
  });

  it("flags a deterministic-floor fallback and leaves AI dims null when AI was down", () => {
    const s = deriveSpeakingResults([
      openTopicResult(0, { source: "deterministic_floor", total: 70, fluencyScore: 70, aiGrammar: null, aiRelevance: null }),
    ]);
    expect(s.anyDeterministicFallback).toBe(true);
    expect(s.dimensions.fluency).toBe(70);
    expect(s.dimensions.grammar).toBeNull();
    expect(s.dimensions.relevance).toBeNull();
    expect(s.overallPercent).toBe(70);
  });

  it("populates approximate grammar/relevance when the AI blend ran", () => {
    const s = deriveSpeakingResults([
      openTopicResult(0, { source: "ai_hybrid", total: 75, fluencyScore: 70, aiGrammar: 80, aiRelevance: 60 }),
    ]);
    expect(s.anyDeterministicFallback).toBe(false);
    expect(s.dimensions.grammar).toBe(80);
    expect(s.dimensions.relevance).toBe(60);
  });

  it("does not let unscored/pending items drag the average", () => {
    const pending: SpeakingItemResult = {
      index: 1, itemType: SpeakingItemType.REPEAT, status: "queued",
      audioUrl: "x", transcript: null, score: null, error: null,
    };
    const s = deriveSpeakingResults([readAloudResult(0, 90), pending]);
    expect(s.scoredCount).toBe(1);
    expect(s.totalCount).toBe(2);
    expect(s.overallPercent).toBe(90);
  });
});
