/**
 * AI Mock Interview — LLM orchestration (Step 33). Every call goes through the
 * gateway seam `callLlmChatJson`, which NEVER throws: a `null` return means
 * degrade, and every function here returns `null`/a fallback so the interview
 * always continues. Field validation uses the `num()` clamp-reader pattern from
 * speech-grader. Credit metering rides the seam via the policy `feature`/`kind`/
 * `collegeId`/`userId` fields (weights in AI_ACTION_WEIGHTS):
 *   - analysis + generation + follow-up → kind "generation" (DEFERRABLE tier:
 *     shed under load → the caller falls back to the role bank / no follow-up);
 *   - grading → kind "grading" (protected INTERACTIVE tier).
 * The resume + answers are personal text → `sensitive: true` (no training providers).
 */
import {
  callLlmChatJson,
  type InterviewAiScores,
  type InterviewQuestionCategory,
  InterviewQuestionCategory as Category,
} from "@codeapt/shared";

import { env } from "../config/env.js";

const llmConfig = () => ({
  url: env.ESSAY_LLM_URL,
  apiKey: env.ESSAY_LLM_API_KEY,
  model: env.ESSAY_LLM_MODEL,
  timeoutMs: env.ESSAY_AI_TIMEOUT_MS,
});

export interface AiMeter {
  collegeId?: string;
  userId?: string;
}

/** Finite number clamped to [0,100], else null (drop the dimension). */
function num(obj: unknown, key: string): number | null {
  if (!obj || typeof obj !== "object") return null;
  const v = (obj as Record<string, unknown>)[key];
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, Math.round(v)));
}
function str(obj: unknown, key: string): string {
  if (!obj || typeof obj !== "object") return "";
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" ? v.trim() : "";
}
function strArray(obj: unknown, key: string): string[] {
  if (!obj || typeof obj !== "object") return [];
  const v = (obj as Record<string, unknown>)[key];
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 30);
}

// ---------------------------------------------------------------------------
// 1. Resume + JD analysis
// ---------------------------------------------------------------------------
export interface InterviewAnalysis {
  skills: string[];
  experience: string;
  gaps: string[];
  /** Canonical domain vocabulary (technologies, tools, protocols, acronyms) drawn
   *  from the JD + resume — used to CORRECT STT mishearings in answers, never to
   *  rewrite them. e.g. "frontend", "Kubernetes", "PostgreSQL", "Node.js", "REST". */
  terms: string[];
}

const ANALYSIS_SYSTEM =
  "You are an expert technical recruiter. Read the RESUME and JOB DESCRIPTION and " +
  "return STRICT JSON only: " +
  '{"skills": string[], "experience": string, "gaps": string[], "terms": string[]}. ' +
  "skills = concrete skills the resume evidences; experience = a one-sentence " +
  "seniority summary; gaps = skills the job needs that the resume does not show; " +
  "terms = the canonical spelling of domain technologies/tools/protocols/acronyms " +
  "mentioned (e.g. frontend, Kubernetes, PostgreSQL, Node.js, REST, OAuth) — used " +
  "to fix speech-to-text mishearings. No text outside the JSON.";

export async function analyzeResume(
  resumeText: string,
  jobDescription: string,
  role: string,
  meter: AiMeter,
): Promise<InterviewAnalysis | null> {
  const parsed = await callLlmChatJson(
    llmConfig(),
    ANALYSIS_SYSTEM,
    `Target role: ${role}\n\nJOB DESCRIPTION:\n"""\n${jobDescription || "(none provided)"}\n"""\n\nRESUME:\n"""\n${resumeText}\n"""`,
    {
      kind: "generation",
      sensitive: true,
      maxTokens: 400,
      feature: "interview_analysis",
      collegeId: meter.collegeId,
      userId: meter.userId,
    },
  );
  if (parsed === null) return null;
  return {
    skills: strArray(parsed, "skills"),
    experience: str(parsed, "experience"),
    gaps: strArray(parsed, "gaps"),
    terms: strArray(parsed, "terms"),
  };
}

// ---------------------------------------------------------------------------
// 2. Question generation
// ---------------------------------------------------------------------------
export interface GeneratedQuestion {
  category: InterviewQuestionCategory;
  text: string;
}

const GENERATION_SYSTEM =
  "You are conducting a job interview. Return STRICT JSON only: " +
  '{"questions": [{"category": "behavioural" | "technical", "text": string}]}. ' +
  "Tailor questions to the role, seniority, the candidate's resume analysis and " +
  "the job description. Each question must be answerable aloud in under two " +
  "minutes. Output EXACTLY the requested counts. No numbering, no preamble.";

export async function generateQuestions(
  role: string,
  seniority: string,
  behaviouralCount: number,
  technicalCount: number,
  analysis: InterviewAnalysis | null,
  jobDescription: string,
  meter: AiMeter,
): Promise<GeneratedQuestion[] | null> {
  const analysisLine = analysis
    ? `Skills: ${analysis.skills.join(", ") || "—"}. Experience: ${analysis.experience || "—"}. Gaps to probe: ${analysis.gaps.join(", ") || "—"}.`
    : "(resume analysis unavailable)";
  const parsed = await callLlmChatJson(
    llmConfig(),
    GENERATION_SYSTEM,
    `Role: ${role}\nSeniority: ${seniority || "unspecified"}\nBehavioural questions: ${behaviouralCount}\nTechnical questions: ${technicalCount}\n\nResume analysis: ${analysisLine}\n\nJob description:\n"""\n${jobDescription || "(none)"}\n"""`,
    {
      kind: "generation",
      sensitive: true,
      maxTokens: 1024,
      feature: "interview_generation",
      collegeId: meter.collegeId,
      userId: meter.userId,
    },
  );
  if (parsed === null) return null;
  const raw = (parsed as { questions?: unknown }).questions;
  if (!Array.isArray(raw)) return null;
  const out: GeneratedQuestion[] = [];
  for (const q of raw) {
    const text = str(q, "text");
    if (!text) continue;
    const cat = str(q, "category").toLowerCase();
    out.push({
      category:
        cat === Category.TECHNICAL ? Category.TECHNICAL : Category.BEHAVIOURAL,
      text: text.slice(0, 600),
    });
  }
  return out.length > 0 ? out : null;
}

// ---------------------------------------------------------------------------
// 3. Adaptive follow-up
// ---------------------------------------------------------------------------
const FOLLOWUP_SYSTEM =
  "You are an interviewer. Given the QUESTION and the candidate's ANSWER, decide " +
  "whether ONE short natural probe would meaningfully deepen the answer. Return " +
  'STRICT JSON only: {"followUp": string}. Give a single question answerable ' +
  'aloud in under a minute, or {"followUp": ""} if no probe is warranted.';

/** A follow-up question string, "" for "no probe warranted", or null on degrade. */
export async function generateFollowUp(
  question: string,
  transcript: string,
  role: string,
  meter: AiMeter,
): Promise<string | null> {
  if (transcript.trim() === "") return "";
  const parsed = await callLlmChatJson(
    llmConfig(),
    FOLLOWUP_SYSTEM,
    `Role: ${role}\n\nQUESTION:\n"""\n${question}\n"""\n\nANSWER:\n"""\n${transcript}\n"""`,
    {
      kind: "generation",
      sensitive: true,
      maxTokens: 128,
      feature: "interview_followup",
      collegeId: meter.collegeId,
      userId: meter.userId,
    },
  );
  if (parsed === null) return null;
  return str(parsed, "followUp").slice(0, 600);
}

// ---------------------------------------------------------------------------
// 4. Per-answer grading
// ---------------------------------------------------------------------------
export interface AnswerJudgement {
  scores: InterviewAiScores;
  feedback: string;
}

const GRADING_SYSTEM =
  "You are scoring ONE interview answer for the given role. Return STRICT JSON " +
  "with integer 0-100 fields {\"concept\", \"analysis\", \"topicKnowledge\"} always, " +
  'and for a behavioural question ALSO {"relevance", "star"} (STAR structure). ' +
  'Include {"feedback": string} — one or two sentences of specific, constructive ' +
  "feedback. Score the SUBSTANCE for the role; never reward mere verbosity.";

/** Per-answer judgement, or null when the model was unavailable (degrade → the
 *  answer keeps only its deterministic floor). */
export async function gradeAnswer(
  question: string,
  transcript: string,
  category: InterviewQuestionCategory,
  role: string,
  meter: AiMeter,
): Promise<AnswerJudgement | null> {
  if (transcript.trim() === "") return null;
  const parsed = await callLlmChatJson(
    llmConfig(),
    GRADING_SYSTEM,
    `Role: ${role}\nQuestion type: ${category}\n\nQUESTION:\n"""\n${question}\n"""\n\nANSWER:\n"""\n${transcript}\n"""`,
    {
      kind: "grading",
      sensitive: true,
      maxTokens: 400,
      feature: "interview_grading",
      collegeId: meter.collegeId,
      userId: meter.userId,
    },
  );
  if (parsed === null) return null;
  const concept = num(parsed, "concept");
  const analysis = num(parsed, "analysis");
  const topicKnowledge = num(parsed, "topicKnowledge");
  // If not one usable dimension came back, treat as unavailable (degrade).
  if (concept === null && analysis === null && topicKnowledge === null) {
    return null;
  }
  const behavioural = category === Category.BEHAVIOURAL;
  return {
    scores: {
      concept,
      analysis,
      topicKnowledge,
      relevance: behavioural ? num(parsed, "relevance") : null,
      star: behavioural ? num(parsed, "star") : null,
    },
    feedback: str(parsed, "feedback").slice(0, 600),
  };
}

// ---------------------------------------------------------------------------
// 5. Fallback question bank (LLM unavailable) — role-agnostic but usable.
// ---------------------------------------------------------------------------
const FALLBACK_BEHAVIOURAL = [
  "Tell me about yourself and why you are interested in this role.",
  "Describe a challenging problem you solved recently. What was your approach?",
  "Tell me about a time you disagreed with a teammate. How did you resolve it?",
  "Describe a project you are proud of and your specific contribution.",
  "Tell me about a time you failed. What did you learn?",
  "How do you prioritise when everything feels urgent?",
];
const FALLBACK_TECHNICAL = [
  "Walk me through how you would design a system for this role's core problem.",
  "What technologies from your resume are you strongest in, and why?",
  "How do you make sure the work you ship is correct and maintainable?",
  "Describe a technical trade-off you made and the reasoning behind it.",
  "How would you debug a problem you have never seen before?",
  "What does good quality mean to you in your day-to-day work?",
];

/** A role-based fallback plan used when the LLM is unavailable at start. */
export function fallbackQuestions(
  behaviouralCount: number,
  technicalCount: number,
): GeneratedQuestion[] {
  const out: GeneratedQuestion[] = [];
  for (let i = 0; i < behaviouralCount; i += 1) {
    out.push({
      category: Category.BEHAVIOURAL,
      text: FALLBACK_BEHAVIOURAL[i % FALLBACK_BEHAVIOURAL.length]!,
    });
  }
  for (let i = 0; i < technicalCount; i += 1) {
    out.push({
      category: Category.TECHNICAL,
      text: FALLBACK_TECHNICAL[i % FALLBACK_TECHNICAL.length]!,
    });
  }
  return out;
}
