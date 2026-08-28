/**
 * AI Mock Interview — PURE scoring (Step 33). No I/O, no LLM calls here: the API
 * gathers per-answer deterministic FLOORS and (when available) per-answer LLM
 * judgements, then this module aggregates them into the five-dimension report.
 *
 * The five dimensions, and the hybrid discipline (identical to essay/email/
 * story_retell/open_topic):
 *   - DETERMINISTIC floor, always: `speaking` (audio-derived fluency — pace,
 *     pauses, fillers, optional response latency) and `vocabulary` (lexical
 *     measures on the transcript). These stand alone as a complete score.
 *   - LLM judgement: `concept`, `analysis`, `topicKnowledge` (plus per-answer
 *     relevance + STAR structure on behavioural answers).
 *   - REWEIGHT: when the LLM is unavailable the three AI dimensions drop out of
 *     BOTH the numerator and the denominator, so the overall reweights to the
 *     deterministic dimensions at 100% — never a hole, never a penalty for our AI
 *     being down (mirrors computeComposite's present-dims-only mean).
 *
 * Speaking + vocabulary reuse the SAME pure functions as the speaking module
 * (`fluencyScore`, `scoreVocabulary`) — no parallel scoring logic.
 */
import { INTERVIEW_DIMENSION_WEIGHTS } from "./constants.js";
import { InterviewScoreSource, type InterviewQuestionCategory } from "./enums.js";
import { scoreVocabulary } from "./essay.js";
import { fluencyScore, type FluencyResult } from "./speech.js";

const clamp = (n: number, lo = 0, hi = 100): number =>
  Math.max(lo, Math.min(hi, n));

/**
 * Remaining mock-interview credits for a college (Step 38): the super-admin
 * granted TOTAL minus interviews already started, never negative. 1 credit = 1
 * interview started. Pure so both the start-time gate and the dashboard readout
 * agree on the arithmetic.
 */
export function interviewCreditsRemaining(granted: number, used: number): number {
  return Math.max(0, Math.floor(granted) - Math.max(0, Math.floor(used)));
}
const round2 = (n: number): number => Math.round(n * 100) / 100;
const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * A response-latency penalty (points off `speaking`). A prompt answered promptly
 * (≤3s of think-time) is unpenalised; it ramps to a max of 15 by ~15s. Latency
 * is a real client-measured signal (question-end → first speech); when it is not
 * supplied (undefined) there is NO penalty — we never invent the number.
 */
export function latencyPenalty(latencySeconds: number | undefined): number {
  if (latencySeconds === undefined || !Number.isFinite(latencySeconds)) return 0;
  if (latencySeconds <= 3) return 0;
  return round2(clamp(((latencySeconds - 3) / 12) * 15, 0, 15));
}

export interface InterviewAnswerFloor {
  /** 0..100 from audio-derived fluency, minus any response-latency penalty. */
  readonly speaking: number;
  /** 0..100 lexical/vocabulary measure on the transcript. */
  readonly vocabulary: number;
}

/**
 * The deterministic floor for ONE answer — reuses `fluencyScore` (speaking) and
 * `scoreVocabulary` (vocabulary) verbatim. `latencySeconds` (optional) is the
 * client-measured think-time before the answer began.
 */
export function scoreInterviewAnswerFloor(
  transcript: string,
  fluency: FluencyResult,
  latencySeconds?: number,
): InterviewAnswerFloor {
  const speaking = clamp(fluencyScore(fluency) - latencyPenalty(latencySeconds));
  return {
    speaking: round2(speaking),
    vocabulary: round2(scoreVocabulary(transcript)),
  };
}

/**
 * The LLM's per-answer judgement. Each field is 0..100 or null (the model didn't
 * return it, or was unavailable). `relevance`/`star` apply to behavioural answers
 * only. The API validates + clamps these before constructing this object (the
 * `num()` reader pattern from speech-grader).
 */
export interface InterviewAiScores {
  readonly concept: number | null;
  readonly analysis: number | null;
  readonly topicKnowledge: number | null;
  readonly relevance: number | null;
  readonly star: number | null;
}

export interface InterviewPerAnswer {
  readonly index: number;
  readonly question: string;
  readonly category: InterviewQuestionCategory;
  readonly isFollowUp: boolean;
  readonly floor: InterviewAnswerFloor;
  /** Null when no LLM judgement exists for this answer (degrade / not answered). */
  readonly ai: InterviewAiScores | null;
  /** False when the turn was skipped/silent — excluded from every mean. */
  readonly answered: boolean;
}

export interface InterviewDimensionScores {
  readonly speaking: number;
  readonly vocabulary: number;
  /** Null when the LLM contributed nothing to this dimension all session. */
  readonly concept: number | null;
  readonly analysis: number | null;
  readonly topicKnowledge: number | null;
}

export interface InterviewQuestionReport {
  readonly index: number;
  readonly question: string;
  readonly category: InterviewQuestionCategory;
  readonly isFollowUp: boolean;
  readonly answered: boolean;
  readonly speaking: number | null;
  readonly vocabulary: number | null;
  readonly concept: number | null;
  readonly analysis: number | null;
  readonly topicKnowledge: number | null;
  readonly relevance: number | null;
  readonly star: number | null;
}

export interface InterviewReport {
  readonly dimensions: InterviewDimensionScores;
  /** Weighted mean over the PRESENT dimensions, or null when nothing answered. */
  readonly overall: number | null;
  readonly source: InterviewScoreSource;
  /** True when the LLM contributed (ai_hybrid). */
  readonly approximate: boolean;
  readonly perQuestion: readonly InterviewQuestionReport[];
}

/** Mean of the finite AI values across answered turns for one dimension, or null
 *  when no answer carries it (the whole dimension reweights out). */
function aiDimensionMean(
  answers: readonly InterviewPerAnswer[],
  key: "concept" | "analysis" | "topicKnowledge",
): number | null {
  const vals: number[] = [];
  for (const a of answers) {
    const v = a.ai ? a.ai[key] : null;
    if (typeof v === "number" && Number.isFinite(v)) vals.push(v);
  }
  return vals.length === 0 ? null : round2(mean(vals));
}

/**
 * Aggregate per-answer floors + AI judgements into the interview report. Only
 * ANSWERED turns feed the means. The overall is a weighted mean over the
 * dimensions that are PRESENT (non-null): the two deterministic dimensions are
 * always present; each AI dimension is present only if some answer carried it.
 * Absent dimensions leave both the numerator and denominator, so the score is
 * always out of 100 — the reweight-to-100% guarantee.
 */
export function computeInterviewReport(
  answers: readonly InterviewPerAnswer[],
): InterviewReport {
  const answered = answers.filter((a) => a.answered);

  const perQuestion: InterviewQuestionReport[] = answers.map((a) => ({
    index: a.index,
    question: a.question,
    category: a.category,
    isFollowUp: a.isFollowUp,
    answered: a.answered,
    speaking: a.answered ? a.floor.speaking : null,
    vocabulary: a.answered ? a.floor.vocabulary : null,
    concept: a.ai?.concept ?? null,
    analysis: a.ai?.analysis ?? null,
    topicKnowledge: a.ai?.topicKnowledge ?? null,
    relevance: a.ai?.relevance ?? null,
    star: a.ai?.star ?? null,
  }));

  if (answered.length === 0) {
    return {
      dimensions: {
        speaking: 0,
        vocabulary: 0,
        concept: null,
        analysis: null,
        topicKnowledge: null,
      },
      overall: null,
      source: InterviewScoreSource.DETERMINISTIC_FLOOR,
      approximate: false,
      perQuestion,
    };
  }

  const dimensions: InterviewDimensionScores = {
    speaking: round2(mean(answered.map((a) => a.floor.speaking))),
    vocabulary: round2(mean(answered.map((a) => a.floor.vocabulary))),
    concept: aiDimensionMean(answered, "concept"),
    analysis: aiDimensionMean(answered, "analysis"),
    topicKnowledge: aiDimensionMean(answered, "topicKnowledge"),
  };

  const w = INTERVIEW_DIMENSION_WEIGHTS;
  const present: Array<[number, number]> = [
    [w.speaking, dimensions.speaking],
    [w.vocabulary, dimensions.vocabulary],
  ];
  if (dimensions.concept !== null) present.push([w.concept, dimensions.concept]);
  if (dimensions.analysis !== null) present.push([w.analysis, dimensions.analysis]);
  if (dimensions.topicKnowledge !== null)
    present.push([w.topicKnowledge, dimensions.topicKnowledge]);

  const weightSum = present.reduce((s, [pw]) => s + pw, 0);
  const overall =
    weightSum === 0
      ? null
      : round2(present.reduce((s, [pw, v]) => s + pw * v, 0) / weightSum);

  const usedAi =
    dimensions.concept !== null ||
    dimensions.analysis !== null ||
    dimensions.topicKnowledge !== null;

  return {
    dimensions,
    overall,
    source: usedAi
      ? InterviewScoreSource.AI_HYBRID
      : InterviewScoreSource.DETERMINISTIC_FLOOR,
    approximate: usedAi,
    perQuestion,
  };
}
