/**
 * Essay grader — the worker-only AI layer on top of the pure deterministic
 * engine in `@codeapt/shared`.
 *
 * Design:
 *   - The deterministic engine (`scoreDeterministic`) is ALWAYS computed first
 *     and is the guaranteed floor.
 *   - An `EssayGrader` adapter may then supply AI sub-scores for vocabulary &
 *     structure plus a feedback summary. Three adapters are provided, selected
 *     by `ESSAY_AI_PROVIDER`:
 *       • `mock`         — no network; plausible, deterministic-from-text
 *                          scores. Default (mirrors PISTON_MOCK) so the whole
 *                          lifecycle is demoable offline.
 *       • `microservice` — HTTP POST to ESSAY_AI_URL (config-driven base URL +
 *                          optional auth header, AbortController timeout), like
 *                          the Piston client.
 *       • `llm`          — an OpenAI-compatible chat endpoint; the model is
 *                          asked for STRICT JSON, parsed defensively.
 *   - `gradeEssay` orchestrates: success → `blendHybrid` (source `ai_hybrid`);
 *     any failure/timeout/disabled path → deterministic-only (source
 *     `deterministic_fallback`). It NEVER throws — grading always yields a
 *     result, so the worker cannot be crashed by a flaky AI dependency.
 */
import {
  EssayScoreSource,
  blendHybrid,
  callLlmChatJson,
  hasLlmRouter,
  scoreDeterministic,
  type EssayDimensionScores,
} from "@codeapt/shared";

import { env } from "../config/env.js";
import { isKnownWord } from "./dictionary.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Adapter contract
// ---------------------------------------------------------------------------

export interface GradeWithAiInput {
  essayText: string;
  /** The prompt/instructions the student was answering. */
  prompt: string;
  /** Rubric guidance (dimension descriptions / weights as text). */
  rubric: string;
  /** Admin-only reference keywords (context for the AI; never sent to clients). */
  referenceKeywords: readonly string[];
  /** Owning college (Stage-1 AI credits) — charges this grade to that college at
   * the gateway seam. Absent for individual/B2C essays → uncharged. */
  collegeId?: string;
  /** The STUDENT to charge, set only when the college runs per-student credit
   * distribution → the seam meters this grade against the student's allocation. */
  userId?: string;
}

export interface AiAnalysis {
  /**
   * AI sub-scores (0..100). Only vocabulary & structure are consumed by the
   * blend; an adapter may return a subset. Values out of range are ignored by
   * `blendHybrid`'s clamp.
   */
  dimensions: Partial<EssayDimensionScores>;
  feedback: string;
}

export interface EssayGrader {
  /** Returns the AI analysis, or null if AI is unavailable for any reason. */
  gradeWithAI(input: GradeWithAiInput): Promise<AiAnalysis | null>;
}

// ---------------------------------------------------------------------------
// Feedback helpers
// ---------------------------------------------------------------------------

/** A short, deterministic feedback summary from the sub-score breakdown. */
export function buildDeterministicFeedback(
  dimensions: EssayDimensionScores,
  total: number,
): string {
  const entries = Object.entries(dimensions) as [
    keyof EssayDimensionScores,
    number,
  ][];
  const strongest = [...entries].sort((a, b) => b[1] - a[1])[0];
  const weakest = [...entries].sort((a, b) => a[1] - b[1])[0];
  const strong = strongest ? strongest[0] : "structure";
  const weak = weakest ? weakest[0] : "relevance";
  return (
    `Overall score ${total.toFixed(1)}/100. ` +
    `Strongest dimension: ${strong}. ` +
    `Focus next on improving ${weak}.`
  );
}

// ---------------------------------------------------------------------------
// mock adapter (default) — deterministic-from-text, no network
// ---------------------------------------------------------------------------

export function createMockGrader(): EssayGrader {
  return {
    async gradeWithAI(input: GradeWithAiInput): Promise<AiAnalysis> {
      // Base the "AI" view on the deterministic engine, nudged by a small,
      // fully deterministic offset so a blended score visibly differs from the
      // deterministic-only one. No randomness, no I/O.
      const det = scoreDeterministic(
        input.essayText,
        { referenceKeywords: input.referenceKeywords },
        { isKnownWord },
      );
      const nudge = (n: number): number =>
        Math.min(100, Math.round((n + 8) * 100) / 100);
      return {
        dimensions: {
          vocabulary: nudge(det.dimensions.vocabulary),
          structure: nudge(det.dimensions.structure),
        },
        feedback:
          `AI (mock) review: a ${det.wordCount}-word response. ` +
          `Vocabulary and structure look reasonable; tighten argument flow ` +
          `and address the prompt's key ideas more directly.`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Defensive parsing shared by the HTTP adapters
// ---------------------------------------------------------------------------

const asFiniteNumber = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

/** Coerce a raw AI value to a bounded 0..100 score, or undefined if unusable. */
const clampScore = (v: unknown): number | undefined => {
  const n = asFiniteNumber(v);
  return n === undefined ? undefined : Math.min(100, Math.max(0, n));
};

/**
 * Pull {vocabulary, structure, relevance, feedback} out of an arbitrary parsed
 * object. Scores are validated + clamped to 0..100; anything non-numeric is
 * dropped. Returns null when NO usable dimension is present, so grading falls
 * back to the deterministic floor rather than trusting unbounded output.
 */
function toAiAnalysis(parsed: unknown): AiAnalysis | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const dimensions: Partial<EssayDimensionScores> = {};
  const vocab = clampScore(obj.vocabulary);
  const structure = clampScore(obj.structure);
  const relevance = clampScore(obj.relevance);
  if (vocab !== undefined) dimensions.vocabulary = vocab;
  if (structure !== undefined) dimensions.structure = structure;
  if (relevance !== undefined) dimensions.relevance = relevance;
  // Nothing usable — treat as a miss so we fall back deterministically.
  if (Object.keys(dimensions).length === 0) return null;
  return { dimensions, feedback: asString(obj.feedback) };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.ESSAY_AI_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// microservice adapter — POST to ESSAY_AI_URL
// ---------------------------------------------------------------------------

export function createMicroserviceGrader(): EssayGrader {
  return {
    async gradeWithAI(input: GradeWithAiInput): Promise<AiAnalysis | null> {
      if (!env.ESSAY_AI_URL) {
        logger.warn("ESSAY_AI_URL is unset — AI grading unavailable");
        return null;
      }
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (env.ESSAY_AI_HEADER_NAME && env.ESSAY_AI_HEADER_VALUE) {
        headers[env.ESSAY_AI_HEADER_NAME] = env.ESSAY_AI_HEADER_VALUE;
      }
      try {
        const res = await fetchWithTimeout(
          `${env.ESSAY_AI_URL.replace(/\/$/, "")}/analyze`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              essay: input.essayText,
              prompt: input.prompt,
              rubric: input.rubric,
              referenceKeywords: input.referenceKeywords,
            }),
          },
        );
        if (!res.ok) {
          logger.warn({ status: res.status }, "essay AI microservice non-2xx");
          return null;
        }
        return toAiAnalysis(await res.json());
      } catch (err) {
        logger.warn({ err }, "essay AI microservice call failed");
        return null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// llm adapter — OpenAI-compatible chat completions
// ---------------------------------------------------------------------------

/**
 * System prompt: defines the three judgment dimensions and — crucially —
 * instructs the model to grade SUBSTANCE, so a polished-but-vacuous essay
 * scores LOW (the depth the deterministic engine cannot see). STRICT JSON only.
 */
const LLM_SYSTEM_PROMPT =
  "You are a strict academic essay grader. Grade the essay on THREE dimensions, " +
  "each an integer from 0 to 100: vocabulary (lexical range, precision, academic " +
  "register), structure (organization, paragraphing, logical flow, transitions), " +
  "and relevance (how directly and substantively the essay addresses the prompt " +
  "and its key ideas). Judge SUBSTANCE, not surface polish: a grammatically clean " +
  "but vacuous, generic, padded, or evasive essay MUST score LOW on all three. Do " +
  "not reward filler or merely restating the prompt. Also give concise holistic " +
  "feedback of at most 120 words. Respond with STRICT JSON ONLY — no prose, no code " +
  'fences — exactly: {"vocabulary": <int 0-100>, "structure": <int 0-100>, ' +
  '"relevance": <int 0-100>, "feedback": "<string>"}';

function buildLlmUserPrompt(input: GradeWithAiInput): string {
  const keywords = input.referenceKeywords.join(", ") || "(none provided)";
  return (
    `Prompt / topic:\n${input.prompt}\n\n` +
    `Key ideas the essay should address (for relevance): ${keywords}\n\n` +
    `Essay:\n"""\n${input.essayText}\n"""`
  );
}

export function createLlmGrader(): EssayGrader {
  return {
    async gradeWithAI(input: GradeWithAiInput): Promise<AiAnalysis | null> {
      // With the gateway installed, provider creds live in the DB — the legacy
      // env URL/key are not required (and are ignored). Only enforce them when
      // there is NO gateway (pure single-provider fallback).
      if (!hasLlmRouter() && (!env.ESSAY_LLM_URL || !env.ESSAY_LLM_API_KEY)) {
        logger.warn("ESSAY_LLM_URL/API_KEY unset — AI grading unavailable");
        return null;
      }
      // The SHARED LLM client (also used by API keyword-gen) — one integration.
      const parsed = await callLlmChatJson(
        {
          url: env.ESSAY_LLM_URL,
          apiKey: env.ESSAY_LLM_API_KEY,
          model: env.ESSAY_LLM_MODEL,
          timeoutMs: env.ESSAY_AI_TIMEOUT_MS,
        },
        LLM_SYSTEM_PROMPT,
        buildLlmUserPrompt(input),
        // Grading = a STABLE, CAPABLE provider for score consistency; student
        // essay text is sensitive → the gateway excludes providers that train on
        // inputs. The verdict JSON is small, so cap the output tightly. Cacheable
        // by EXACT submission (identical essay+prompt+keywords → identical score).
        {
          kind: "grading",
          sensitive: true,
          capability: "capable",
          maxTokens: 512,
          feature: "grading",
          // Charge college essays to their AI credits (seam meters when set).
          collegeId: input.collegeId,
          // Per-student distribution: charge the student's own allocation.
          userId: input.userId,
        },
      );
      if (parsed === null) {
        logger.warn("essay LLM call failed / unparseable — deterministic floor");
        return null;
      }
      return toAiAnalysis(parsed);
    },
  };
}

// ---------------------------------------------------------------------------
// Provider selection + orchestration
// ---------------------------------------------------------------------------

export function selectGrader(
  provider: typeof env.ESSAY_AI_PROVIDER = env.ESSAY_AI_PROVIDER,
): EssayGrader {
  // When the multi-provider gateway is installed it OWNS provider selection, so
  // grading routes through it (via the LLM grader → callLlmChatJson) regardless
  // of ESSAY_AI_PROVIDER. Without a gateway, honor the configured adapter.
  if (hasLlmRouter()) return createLlmGrader();
  switch (provider) {
    case "microservice":
      return createMicroserviceGrader();
    case "llm":
      return createLlmGrader();
    case "mock":
    default:
      return createMockGrader();
  }
}

export interface GradeEssayInput {
  essayText: string;
  prompt: string;
  rubric: string;
  referenceKeywords: readonly string[];
  /**
   * Whether AI-assisted grading is permitted for this attempt (the college's
   * `ai.essay_grading` entitlement, resolved at enqueue). Absent/true → the AI
   * adapter runs; false → deterministic-only (the AI step is skipped entirely).
   */
  aiEnabled?: boolean;
  /** Owning college (Stage-1 AI credits); charged at the seam when set. */
  collegeId?: string;
  /** The STUDENT to charge (per-student distribution); metered at the seam. */
  userId?: string;
}

export interface GradeEssayResult {
  total: number;
  dimensions: EssayDimensionScores;
  source: EssayScoreSource;
  feedback: string;
  wordCount: number;
  bonusApplied: boolean;
}

/**
 * Grade an essay end-to-end. Deterministic engine first (the floor), then the
 * AI adapter; on AI success the two are blended (source `ai_hybrid`), otherwise
 * the deterministic result stands (source `deterministic_fallback`). Never
 * throws — a thrown adapter is caught and degrades to the fallback.
 */
export async function gradeEssay(
  input: GradeEssayInput,
  grader: EssayGrader = selectGrader(),
): Promise<GradeEssayResult> {
  const det = scoreDeterministic(
    input.essayText,
    { referenceKeywords: input.referenceKeywords },
    { isKnownWord },
  );

  let ai: AiAnalysis | null = null;
  // Per-college AI gate: when disabled, skip the AI adapter entirely so the
  // score is deterministic-only (no provider call, no token spend).
  if (input.aiEnabled === false) {
    return {
      total: det.total,
      dimensions: det.dimensions,
      source: EssayScoreSource.DETERMINISTIC_FALLBACK,
      feedback:
        buildDeterministicFeedback(det.dimensions, det.total) +
        " (AI grading is disabled for this college; deterministic score.)",
      wordCount: det.wordCount,
      bonusApplied: det.bonusApplied,
    };
  }
  try {
    ai = await grader.gradeWithAI({
      essayText: input.essayText,
      prompt: input.prompt,
      rubric: input.rubric,
      referenceKeywords: input.referenceKeywords,
      collegeId: input.collegeId,
      userId: input.userId,
    });
  } catch (err) {
    logger.warn({ err }, "essay AI adapter threw — using deterministic floor");
    ai = null;
  }

  if (ai && Object.keys(ai.dimensions).length > 0) {
    const blended = blendHybrid(ai.dimensions, det.dimensions);
    return {
      total: blended.total,
      dimensions: blended.dimensions,
      source: EssayScoreSource.AI_HYBRID,
      feedback:
        ai.feedback.trim() ||
        buildDeterministicFeedback(blended.dimensions, blended.total),
      wordCount: det.wordCount,
      bonusApplied: blended.bonusApplied,
    };
  }

  return {
    total: det.total,
    dimensions: det.dimensions,
    source: EssayScoreSource.DETERMINISTIC_FALLBACK,
    feedback:
      buildDeterministicFeedback(det.dimensions, det.total) +
      " (AI analysis unavailable; deterministic score.)",
    wordCount: det.wordCount,
    bonusApplied: det.bonusApplied,
  };
}
