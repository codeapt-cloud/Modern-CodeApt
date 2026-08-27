/**
 * Step 33 — pure tests for the AI mock-interview scoring engine (@codeapt/shared):
 *   - the deterministic answer FLOOR (speaking via fluencyScore, vocabulary via
 *     scoreVocabulary) + the response-latency penalty;
 *   - computeInterviewReport: the deterministic floor standing ALONE (LLM absent
 *     → source deterministic_floor, overall reweighted to speaking+vocabulary at
 *     100%), the ai_hybrid path, partial-AI reweighting, and the empty case;
 *   - the vocabulary measure discriminates rich vs repetitive speech.
 * No I/O, no LLM.
 */
import {
  aiActionWeight,
  computeInterviewReport,
  latencyPenalty,
  scoreInterviewAnswerFloor,
  type FluencyResult,
  type InterviewPerAnswer,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

const GOOD_FLUENCY: FluencyResult = {
  wordCount: 60,
  durationSeconds: 30,
  speechRate: 2,
  pauseCount: 1,
  longestPauseSeconds: 0.6,
  fillerCount: 1,
  fillerRate: 1 / 60,
};

const answer = (over: Partial<InterviewPerAnswer>): InterviewPerAnswer => ({
  index: 0,
  question: "Q",
  category: "behavioural",
  isFollowUp: false,
  floor: { speaking: 80, vocabulary: 70 },
  ai: null,
  answered: true,
  ...over,
});

describe("scoreInterviewAnswerFloor", () => {
  it("derives speaking from fluency and vocabulary from the transcript", () => {
    const f = scoreInterviewAnswerFloor(
      "I led a team that migrated our monolith to a resilient service architecture, improving throughput considerably.",
      GOOD_FLUENCY,
    );
    expect(f.speaking).toBeGreaterThan(50);
    expect(f.vocabulary).toBeGreaterThan(0);
    expect(f.vocabulary).toBeLessThanOrEqual(100);
  });

  it("applies a response-latency penalty to speaking (never invented when absent)", () => {
    const prompt = scoreInterviewAnswerFloor("word ".repeat(20), GOOD_FLUENCY, 2);
    const slow = scoreInterviewAnswerFloor("word ".repeat(20), GOOD_FLUENCY, 15);
    expect(slow.speaking).toBeLessThan(prompt.speaking);
    // No latency supplied → identical to a 0-latency answer (no penalty invented).
    const none = scoreInterviewAnswerFloor("word ".repeat(20), GOOD_FLUENCY);
    expect(none.speaking).toBe(prompt.speaking);
  });

  it("latencyPenalty ramps from 0 (≤3s) to a 15-point cap", () => {
    expect(latencyPenalty(undefined)).toBe(0);
    expect(latencyPenalty(2)).toBe(0);
    expect(latencyPenalty(9)).toBeGreaterThan(0);
    expect(latencyPenalty(60)).toBe(15);
  });
});

describe("vocabulary measure discriminates lexical richness", () => {
  it("rich, varied language scores higher than repetitive filler", () => {
    const rich = scoreInterviewAnswerFloor(
      "I designed, implemented and evaluated a scalable pipeline, analysing bottlenecks and optimising throughput methodically.",
      GOOD_FLUENCY,
    ).vocabulary;
    const poor = scoreInterviewAnswerFloor(
      "um like i did the thing and um like the thing was the thing you know like",
      GOOD_FLUENCY,
    ).vocabulary;
    expect(rich).toBeGreaterThan(poor);
  });
});

describe("computeInterviewReport", () => {
  it("deterministic floor stands ALONE when the LLM is unavailable (reweight to 100%)", () => {
    const report = computeInterviewReport([
      answer({ index: 0, floor: { speaking: 80, vocabulary: 60 }, ai: null }),
      answer({ index: 1, floor: { speaking: 70, vocabulary: 50 }, ai: null }),
    ]);
    expect(report.source).toBe("deterministic_floor");
    expect(report.approximate).toBe(false);
    expect(report.dimensions.concept).toBeNull();
    expect(report.dimensions.analysis).toBeNull();
    expect(report.dimensions.topicKnowledge).toBeNull();
    expect(report.dimensions.speaking).toBe(75); // mean(80,70)
    expect(report.dimensions.vocabulary).toBe(55); // mean(60,50)
    // Overall reweights to speaking(0.2)+vocabulary(0.15) only:
    // (0.2*75 + 0.15*55) / 0.35 = 66.43
    expect(report.overall).toBeCloseTo(66.43, 1);
  });

  it("ai_hybrid when the LLM contributes the three judged dimensions", () => {
    const ai = {
      concept: 90,
      analysis: 80,
      topicKnowledge: 70,
      relevance: 85,
      star: 75,
    };
    const report = computeInterviewReport([
      answer({ index: 0, floor: { speaking: 80, vocabulary: 60 }, ai }),
    ]);
    expect(report.source).toBe("ai_hybrid");
    expect(report.approximate).toBe(true);
    expect(report.dimensions.concept).toBe(90);
    expect(report.dimensions.analysis).toBe(80);
    expect(report.dimensions.topicKnowledge).toBe(70);
    // Full weighted mean over all five present dimensions.
    // (0.2*80 + 0.15*60 + 0.25*90 + 0.2*80 + 0.2*70) / 1.0 = 77.5
    expect(report.overall).toBeCloseTo(77.5, 1);
  });

  it("reweights per-dimension over only the answers that carry AI", () => {
    // One answer graded, one not: the AI dimensions average over the graded one.
    const report = computeInterviewReport([
      answer({
        index: 0,
        floor: { speaking: 80, vocabulary: 60 },
        ai: { concept: 60, analysis: 60, topicKnowledge: 60, relevance: null, star: null },
      }),
      answer({ index: 1, floor: { speaking: 40, vocabulary: 40 }, ai: null }),
    ]);
    expect(report.source).toBe("ai_hybrid");
    expect(report.dimensions.speaking).toBe(60); // mean(80,40) over both
    expect(report.dimensions.concept).toBe(60); // only the graded answer
  });

  it("returns overall null and a floor source when nothing was answered", () => {
    const report = computeInterviewReport([
      answer({ index: 0, answered: false, ai: null }),
    ]);
    expect(report.overall).toBeNull();
    expect(report.source).toBe("deterministic_floor");
    expect(report.perQuestion[0]!.answered).toBe(false);
    expect(report.perQuestion[0]!.speaking).toBeNull();
  });
});

describe("credit weights — a session is far heavier than an essay", () => {
  it("registers the four interview features and sums to the stated worst case", () => {
    expect(aiActionWeight("interview_analysis")).toBe(1);
    expect(aiActionWeight("interview_generation")).toBe(2);
    expect(aiActionWeight("interview_followup")).toBe(1);
    expect(aiActionWeight("interview_grading")).toBe(1);
    // Worst case: analysis(1) + generation(2) + 6 follow-ups + 12 gradings = 21.
    const worstCase =
      aiActionWeight("interview_analysis") +
      aiActionWeight("interview_generation") +
      6 * aiActionWeight("interview_followup") +
      12 * aiActionWeight("interview_grading");
    expect(worstCase).toBe(21);
    // ~20× an essay's single grading pass.
    expect(worstCase).toBeGreaterThan(aiActionWeight("grading") * 15);
  });
});
