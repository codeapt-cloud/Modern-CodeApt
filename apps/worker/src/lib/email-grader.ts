/**
 * Email grader — the worker-only AI layer on top of the pure deterministic
 * email engine in `@codeapt/shared` (Communication module, Round 2 scenario
 * email). It is the email counterpart of `./essay-grader.ts` and follows the
 * SAME discipline:
 *   - `scoreEmailDeterministic` is ALWAYS computed first and is the guaranteed
 *     floor. The mechanics (grammar/spelling/punctuation/readability) and the
 *     two structural dimensions (format/register) are deterministic-only and
 *     can NEVER be touched by the model.
 *   - The AI supplies only the two judgement dimensions — `content` (does it
 *     address the scenario, is the call-to-action clear) and `tone` (right for
 *     the recipient) — which are blended via `blendEmailHybrid`.
 *   - `gradeEmail` NEVER throws: any AI failure/timeout/disabled path degrades
 *     to the deterministic-only result (source `deterministic_fallback`), which
 *     is a complete, honest grade.
 */
import {
  EssayScoreSource,
  blendEmailHybrid,
  callLlmChatJson,
  hasLlmRouter,
  scoreEmailDeterministic,
  type EmailDimensionScores,
} from "@codeapt/shared";

import { env } from "../config/env.js";
import { isKnownWord } from "./dictionary.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Adapter contract
// ---------------------------------------------------------------------------

export interface GradeEmailWithAiInput {
  emailText: string;
  /** The scenario the student was answering (prompt + instructions). */
  prompt: string;
  /** Rubric guidance (dimension descriptions as text). */
  rubric: string;
  /** Admin-only scenario keywords (context for the AI; never sent to clients). */
  referenceKeywords: readonly string[];
  /** Owning college (Stage-1 AI credits) — charged at the seam when set. */
  collegeId?: string;
  /** The STUDENT to charge (per-student distribution); metered at the seam. */
  userId?: string;
}

export interface EmailAiAnalysis {
  /** AI sub-scores (0..100). Only content & tone are consumed by the blend. */
  dimensions: Partial<EmailDimensionScores>;
  feedback: string;
}

export interface EmailGrader {
  gradeWithAI(input: GradeEmailWithAiInput): Promise<EmailAiAnalysis | null>;
}

// ---------------------------------------------------------------------------
// Feedback + defensive parsing
// ---------------------------------------------------------------------------

/** A short, deterministic feedback summary from the email sub-score breakdown. */
export function buildDeterministicEmailFeedback(
  dimensions: EmailDimensionScores,
  total: number,
): string {
  const entries = Object.entries(dimensions) as [
    keyof EmailDimensionScores,
    number,
  ][];
  const strongest = [...entries].sort((a, b) => b[1] - a[1])[0];
  const weakest = [...entries].sort((a, b) => a[1] - b[1])[0];
  const strong = strongest ? strongest[0] : "format";
  const weak = weakest ? weakest[0] : "content";
  return (
    `Overall score ${total.toFixed(1)}/100. ` +
    `Strongest dimension: ${strong}. ` +
    `Focus next on improving ${weak}.`
  );
}

const clampScore = (v: unknown): number | undefined => {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.min(100, Math.max(0, v));
};
const asString = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Pull {content, tone, feedback} out of an arbitrary parsed object. Scores are
 * clamped to 0..100; anything non-numeric is dropped. Returns null when NO
 * usable dimension is present, so grading falls back to the deterministic floor
 * rather than trusting unbounded output.
 */
function toEmailAiAnalysis(parsed: unknown): EmailAiAnalysis | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const dimensions: Partial<EmailDimensionScores> = {};
  const content = clampScore(obj.content);
  const tone = clampScore(obj.tone);
  if (content !== undefined) dimensions.content = content;
  if (tone !== undefined) dimensions.tone = tone;
  if (Object.keys(dimensions).length === 0) return null;
  return { dimensions, feedback: asString(obj.feedback) };
}

// ---------------------------------------------------------------------------
// mock adapter (default) — deterministic-from-text, no network
// ---------------------------------------------------------------------------

export function createMockEmailGrader(): EmailGrader {
  return {
    async gradeWithAI(
      input: GradeEmailWithAiInput,
    ): Promise<EmailAiAnalysis> {
      const det = scoreEmailDeterministic(
        input.emailText,
        { referenceKeywords: input.referenceKeywords },
        { isKnownWord },
      );
      const nudge = (n: number): number =>
        Math.min(100, Math.round((n + 8) * 100) / 100);
      return {
        dimensions: {
          content: nudge(det.dimensions.content),
          tone: nudge(det.dimensions.tone),
        },
        feedback:
          `AI (mock) review: a ${det.wordCount}-word email. ` +
          `Address the scenario directly and state a clear call-to-action; ` +
          `keep the tone appropriate for the recipient.`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// llm adapter — OpenAI-compatible chat completions (shared LLM seam)
// ---------------------------------------------------------------------------

const LLM_SYSTEM_PROMPT =
  "You are a strict business-communication grader assessing a scenario EMAIL. " +
  "Grade only TWO dimensions, each an integer from 0 to 100: content (does the " +
  "email actually address the scenario's request and state a clear, specific " +
  "call-to-action — not vague filler), and tone (is the tone courteous and " +
  "appropriate for the stated recipient — neither rude/blunt nor over-familiar). " +
  "Judge SUBSTANCE, not surface polish: a well-formatted but off-topic or " +
  "evasive email MUST score LOW on content. Do NOT grade grammar, spelling, " +
  "formatting, or greetings/sign-offs — those are scored separately. Also give " +
  "concise feedback of at most 120 words. Respond with STRICT JSON ONLY — no " +
  'prose, no code fences — exactly: {"content": <int 0-100>, "tone": <int ' +
  '0-100>, "feedback": "<string>"}';

function buildLlmUserPrompt(input: GradeEmailWithAiInput): string {
  const keywords = input.referenceKeywords.join(", ") || "(none provided)";
  return (
    `Scenario / instructions:\n${input.prompt}\n\n` +
    `Key points the email should cover (for content): ${keywords}\n\n` +
    `Email:\n"""\n${input.emailText}\n"""`
  );
}

export function createLlmEmailGrader(): EmailGrader {
  return {
    async gradeWithAI(
      input: GradeEmailWithAiInput,
    ): Promise<EmailAiAnalysis | null> {
      if (!hasLlmRouter() && (!env.ESSAY_LLM_URL || !env.ESSAY_LLM_API_KEY)) {
        logger.warn("ESSAY_LLM_URL/API_KEY unset — email AI grading unavailable");
        return null;
      }
      const parsed = await callLlmChatJson(
        {
          url: env.ESSAY_LLM_URL,
          apiKey: env.ESSAY_LLM_API_KEY,
          model: env.ESSAY_LLM_MODEL,
          timeoutMs: env.ESSAY_AI_TIMEOUT_MS,
        },
        LLM_SYSTEM_PROMPT,
        buildLlmUserPrompt(input),
        {
          kind: "grading",
          sensitive: true,
          capability: "capable",
          maxTokens: 512,
          // Distinct feature label so email grading meters + reports separately.
          feature: "email_grading",
          collegeId: input.collegeId,
          userId: input.userId,
        },
      );
      if (parsed === null) {
        logger.warn("email LLM call failed / unparseable — deterministic floor");
        return null;
      }
      return toEmailAiAnalysis(parsed);
    },
  };
}

export function selectEmailGrader(
  provider: typeof env.ESSAY_AI_PROVIDER = env.ESSAY_AI_PROVIDER,
): EmailGrader {
  // The gateway (when installed) owns provider selection, exactly as essays.
  if (hasLlmRouter()) return createLlmEmailGrader();
  switch (provider) {
    case "llm":
    case "microservice":
      return createLlmEmailGrader();
    case "mock":
    default:
      return createMockEmailGrader();
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface GradeEmailInput {
  emailText: string;
  prompt: string;
  rubric: string;
  referenceKeywords: readonly string[];
  aiEnabled?: boolean;
  collegeId?: string;
  userId?: string;
}

export interface GradeEmailResult {
  total: number;
  dimensions: EmailDimensionScores;
  source: EssayScoreSource;
  feedback: string;
  wordCount: number;
  bonusApplied: boolean;
}

/**
 * Grade an email end-to-end. Deterministic email engine first (the floor), then
 * the AI adapter for content + tone; on AI success the two are blended (source
 * `ai_hybrid`), otherwise the deterministic result stands (source
 * `deterministic_fallback`). Never throws.
 */
export async function gradeEmail(
  input: GradeEmailInput,
  grader: EmailGrader = selectEmailGrader(),
): Promise<GradeEmailResult> {
  const det = scoreEmailDeterministic(
    input.emailText,
    { referenceKeywords: input.referenceKeywords },
    { isKnownWord },
  );

  if (input.aiEnabled === false) {
    return {
      total: det.total,
      dimensions: det.dimensions,
      source: EssayScoreSource.DETERMINISTIC_FALLBACK,
      feedback:
        buildDeterministicEmailFeedback(det.dimensions, det.total) +
        " (AI grading is disabled for this college; deterministic score.)",
      wordCount: det.wordCount,
      bonusApplied: det.bonusApplied,
    };
  }

  let ai: EmailAiAnalysis | null = null;
  try {
    ai = await grader.gradeWithAI({
      emailText: input.emailText,
      prompt: input.prompt,
      rubric: input.rubric,
      referenceKeywords: input.referenceKeywords,
      collegeId: input.collegeId,
      userId: input.userId,
    });
  } catch (err) {
    logger.warn({ err }, "email AI adapter threw — using deterministic floor");
    ai = null;
  }

  if (ai && Object.keys(ai.dimensions).length > 0) {
    const blended = blendEmailHybrid(ai.dimensions, det.dimensions);
    return {
      total: blended.total,
      dimensions: blended.dimensions,
      source: EssayScoreSource.AI_HYBRID,
      feedback:
        ai.feedback.trim() ||
        buildDeterministicEmailFeedback(blended.dimensions, blended.total),
      wordCount: det.wordCount,
      bonusApplied: blended.bonusApplied,
    };
  }

  return {
    total: det.total,
    dimensions: det.dimensions,
    source: EssayScoreSource.DETERMINISTIC_FALLBACK,
    feedback:
      buildDeterministicEmailFeedback(det.dimensions, det.total) +
      " (AI analysis unavailable; deterministic score.)",
    wordCount: det.wordCount,
    bonusApplied: det.bonusApplied,
  };
}
