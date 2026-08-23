/**
 * Speech grader — the worker-only AI layer on top of the pure hybrid floors in
 * `@codeapt/shared` (scoreStoryRetellFloor / scoreOpenTopicFloor). Mirrors
 * essay-grader exactly:
 *   - The DETERMINISTIC FLOOR is always computed first and is a COMPLETE score
 *     out of the full 100 (fact coverage for retell, fluency for open topic).
 *   - An optional LLM pass adds a coherence (retell) or relevance+grammar
 *     (open topic) judgement, blended in via the pure blend functions.
 *   - NEVER throws, and NEVER leaves a hole: if the LLM is disabled, unreachable,
 *     unparseable, or the credit reserve fails (callLlmChatJson → null), the
 *     floor stands unchanged (source `deterministic_floor`). A student is never
 *     penalised for our AI being down — the AI SHARE is simply not taken.
 *
 * Only these two item types spend AI (feature `speech_grading`, one pass each);
 * every other speech item type is fully deterministic and never reaches here.
 * Phonetic tolerance is NOT used anywhere in this file (the hard constraint keeps
 * phonetics out of the LLM-judged items).
 */
import {
  blendOpenTopic,
  blendStoryRetell,
  callLlmChatJson,
  scoreOpenTopicFloor,
  scoreStoryRetellFloor,
  type OpenTopicScore,
  type StoryRetellScore,
  type WordTiming,
} from "@codeapt/shared";

import { env } from "../config/env.js";
import { logger } from "./logger.js";

interface HybridContext {
  aiEnabled?: boolean;
  collegeId?: string;
  userId?: string;
}

const llmConfig = () => ({
  url: env.ESSAY_LLM_URL,
  apiKey: env.ESSAY_LLM_API_KEY,
  model: env.ESSAY_LLM_MODEL,
  timeoutMs: env.ESSAY_AI_TIMEOUT_MS,
});

/** Read a 0..100 number out of a parsed LLM object, or null if not usable. */
function num(obj: unknown, key: string): number | null {
  if (obj && typeof obj === "object" && key in obj) {
    const v = (obj as Record<string, unknown>)[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      return Math.min(100, Math.max(0, v));
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// story_retell
// ---------------------------------------------------------------------------

const RETELL_SYSTEM_PROMPT =
  "You are scoring how COHERENT and COMPLETE a spoken story retelling is, " +
  "independent of exact wording. The factual coverage is scored separately and " +
  "deterministically — judge only clarity, ordering, and completeness of the " +
  'retelling. Reply with STRICT JSON: {"coherence": <0-100>}. No prose.';

export interface GradeStoryRetellInput extends HybridContext {
  keyFacts: readonly string[];
  transcript: string;
  wordTimings: readonly WordTiming[];
}

export async function gradeStoryRetell(
  input: GradeStoryRetellInput,
): Promise<StoryRetellScore> {
  const floor = scoreStoryRetellFloor(
    input.keyFacts,
    input.transcript,
    input.wordTimings,
  );
  if (input.aiEnabled === false || input.transcript.trim() === "") {
    return floor; // deterministic floor is the complete, honest score
  }
  const parsed = await callLlmChatJson(
    llmConfig(),
    RETELL_SYSTEM_PROMPT,
    `Key facts (context only, already scored): ${input.keyFacts.join("; ")}\n\n` +
      `Retelling:\n"""\n${input.transcript}\n"""`,
    {
      kind: "grading",
      sensitive: true,
      capability: "capable",
      maxTokens: 128,
      feature: "speech_grading",
      collegeId: input.collegeId,
      userId: input.userId,
    },
  );
  const coherence = num(parsed, "coherence");
  if (coherence === null) {
    logger.warn("story_retell LLM unavailable/unparseable — deterministic floor");
    return floor;
  }
  return blendStoryRetell(floor, coherence);
}

// ---------------------------------------------------------------------------
// open_topic
// ---------------------------------------------------------------------------

const OPEN_TOPIC_SYSTEM_PROMPT =
  "You are scoring a spoken response to an open topic. Fluency is scored " +
  "separately and deterministically — judge only (1) RELEVANCE to the topic and " +
  "(2) GRAMMAR. Both are APPROXIMATE. Reply with STRICT JSON: " +
  '{"relevance": <0-100>, "grammar": <0-100>}. No prose.';

export interface GradeOpenTopicInput extends HybridContext {
  promptText: string;
  transcript: string;
  wordTimings: readonly WordTiming[];
}

export async function gradeOpenTopic(
  input: GradeOpenTopicInput,
): Promise<OpenTopicScore> {
  const floor = scoreOpenTopicFloor(input.wordTimings);
  if (input.aiEnabled === false || input.transcript.trim() === "") {
    return floor; // deterministic fluency floor is the complete, honest score
  }
  const parsed = await callLlmChatJson(
    llmConfig(),
    OPEN_TOPIC_SYSTEM_PROMPT,
    `Topic:\n${input.promptText}\n\nResponse:\n"""\n${input.transcript}\n"""`,
    {
      kind: "grading",
      sensitive: true,
      capability: "capable",
      maxTokens: 128,
      feature: "speech_grading",
      collegeId: input.collegeId,
      userId: input.userId,
    },
  );
  const relevance = num(parsed, "relevance");
  const grammar = num(parsed, "grammar");
  if (relevance === null && grammar === null) {
    logger.warn("open_topic LLM unavailable/unparseable — deterministic floor");
    return floor;
  }
  return blendOpenTopic(floor, { relevance, grammar });
}
