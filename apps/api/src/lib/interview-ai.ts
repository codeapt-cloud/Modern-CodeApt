/**
 * AI Mock Interview — LLM orchestration (Step 33, extended Step 35). Every call
 * goes through the gateway seam `callLlmChatJson`, which NEVER throws: a `null`
 * return means degrade, and every function here returns `null`/a fallback so the
 * interview always continues. Field validation uses the `num()` clamp-reader
 * pattern from speech-grader. Credit metering rides the seam via the policy
 * `feature`/`kind`/`collegeId`/`userId` fields (weights in AI_ACTION_WEIGHTS):
 *   - analysis + generation + follow-up + correction → kind "generation" (DEFERRABLE
 *     tier: shed under load → the caller falls back to the role bank / no follow-up
 *     / the term-list correction);
 *   - grading → kind "grading" (protected INTERACTIVE tier).
 * The resume + answers are personal text → `sensitive: true` (no training providers).
 *
 * Step 35 additions: analysis extracts concrete resume HIGHLIGHTS and the raw
 * resume text now shapes generation (E); generation receives the ASKED list and is
 * told not to repeat (D); generation also returns the greeting + closing, grading
 * returns a neutral acknowledgement, so the conversational layer costs NO extra
 * call (F); and a per-answer contextual correction pass fixes general mishearings,
 * gated by a structural guard so it can only fix, never rewrite (G).
 */
import {
  acceptContextCorrection,
  callLlmChatJson,
  type ContextCorrectionResult,
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

/** Trim a personal-text field to a bounded excerpt for a prompt (keeps the head,
 *  where a resume's summary + recent experience live). */
function excerpt(text: string, max: number): string {
  const t = (text ?? "").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

// ---------------------------------------------------------------------------
// 1. Resume + JD analysis
// ---------------------------------------------------------------------------
export interface InterviewAnalysis {
  skills: string[];
  experience: string;
  gaps: string[];
  /** Concrete, specific things the candidate DID — projects, migrations, systems
   *  they built — verbatim-ish from the resume. These let generation ask about
   *  the candidate's ACTUAL experience ("you mentioned migrating a monolith…")
   *  rather than generic questions (Step 35 E). */
  highlights: string[];
  /** Canonical domain vocabulary (technologies, tools, protocols, acronyms) drawn
   *  from the JD + resume — used to CORRECT STT mishearings in answers, never to
   *  rewrite them. e.g. "frontend", "Kubernetes", "PostgreSQL", "Node.js", "REST". */
  terms: string[];
}

const ANALYSIS_SYSTEM =
  "You are an expert technical recruiter. Read the RESUME and JOB DESCRIPTION and " +
  "return STRICT JSON only: " +
  '{"skills": string[], "experience": string, "highlights": string[], "gaps": string[], "terms": string[]}. ' +
  "skills = concrete skills the resume evidences; experience = a one-sentence " +
  "seniority summary; highlights = up to 6 SPECIFIC things the candidate actually " +
  "did (real projects, systems, migrations, achievements), each a short phrase a " +
  "later question can reference verbatim; gaps = skills the job needs that the " +
  "resume does not show; terms = the canonical spelling of domain technologies/" +
  "tools/protocols/acronyms mentioned (e.g. frontend, Kubernetes, PostgreSQL, " +
  "Node.js, REST, OAuth) — used to fix speech-to-text mishearings. No text outside the JSON.";

export async function analyzeResume(
  resumeText: string,
  jobDescription: string,
  role: string,
  meter: AiMeter,
): Promise<InterviewAnalysis | null> {
  const parsed = await callLlmChatJson(
    llmConfig(),
    ANALYSIS_SYSTEM,
    `Target role: ${role}\n\nJOB DESCRIPTION:\n"""\n${excerpt(jobDescription, 6000) || "(none provided)"}\n"""\n\nRESUME:\n"""\n${excerpt(resumeText, 8000)}\n"""`,
    {
      kind: "generation",
      sensitive: true,
      maxTokens: 600,
      feature: "interview_analysis",
      collegeId: meter.collegeId,
      userId: meter.userId,
    },
  );
  if (parsed === null) return null;
  return {
    skills: strArray(parsed, "skills"),
    experience: str(parsed, "experience"),
    highlights: strArray(parsed, "highlights"),
    gaps: strArray(parsed, "gaps"),
    terms: strArray(parsed, "terms"),
  };
}

// ---------------------------------------------------------------------------
// 2. Question generation (+ conversational greeting/closing — same call, F)
// ---------------------------------------------------------------------------
export interface GeneratedQuestion {
  category: InterviewQuestionCategory;
  text: string;
}
export interface GeneratedPlan {
  questions: GeneratedQuestion[];
  /** Opening greeting (uses the candidate's first name when supplied). */
  greeting: string;
  /** Closing line. */
  closing: string;
}

const GENERATION_SYSTEM =
  "You are conducting a job interview. Return STRICT JSON only: " +
  '{"questions": [{"category": "behavioural" | "technical", "text": string}], ' +
  '"greeting": string, "closing": string}. ' +
  "Tailor questions to the role, seniority, and — most importantly — the " +
  "candidate's ACTUAL resume: reference their specific projects and experience by " +
  "name where natural (e.g. \"you mentioned migrating a monolith — how did you " +
  'sequence it?"). Do NOT ask generic questions when a specific one is possible. ' +
  "NEVER repeat or paraphrase a question in ALREADY ASKED. Each question must be " +
  "answerable aloud in under two minutes. greeting = a warm one-line opener using " +
  "the candidate's FIRST NAME if given; closing = a one-line thank-you to end the " +
  "interview. Output EXACTLY the requested question counts. No numbering, no preamble.";

function firstNameHint(fullName: string): string {
  return fullName.trim() ? `Candidate first name: ${fullName.trim()}\n` : "";
}

export async function generateQuestions(
  role: string,
  seniority: string,
  behaviouralCount: number,
  technicalCount: number,
  analysis: InterviewAnalysis | null,
  jobDescription: string,
  resumeText: string,
  askedQuestions: readonly string[],
  candidateName: string,
  meter: AiMeter,
): Promise<GeneratedPlan | null> {
  const analysisLine = analysis
    ? `Skills: ${analysis.skills.join(", ") || "—"}. Experience: ${analysis.experience || "—"}. ` +
      `Specific highlights to draw on: ${analysis.highlights.join("; ") || "—"}. ` +
      `Gaps to probe: ${analysis.gaps.join(", ") || "—"}.`
    : "(resume analysis unavailable — use the resume text below)";
  const askedLine =
    askedQuestions.length > 0
      ? `\n\nALREADY ASKED (never repeat or paraphrase these):\n${askedQuestions.map((q) => `- ${q}`).join("\n")}`
      : "";
  const parsed = await callLlmChatJson(
    llmConfig(),
    GENERATION_SYSTEM,
    `${firstNameHint(candidateName)}Role: ${role}\nSeniority: ${seniority || "unspecified"}\n` +
      `Behavioural questions: ${behaviouralCount}\nTechnical questions: ${technicalCount}\n\n` +
      `Resume analysis: ${analysisLine}\n\nRESUME:\n"""\n${excerpt(resumeText, 6000)}\n"""\n\n` +
      `Job description:\n"""\n${excerpt(jobDescription, 4000) || "(none)"}\n"""${askedLine}`,
    {
      kind: "generation",
      sensitive: true,
      maxTokens: 1200,
      feature: "interview_generation",
      collegeId: meter.collegeId,
      userId: meter.userId,
    },
  );
  if (parsed === null) return null;
  const raw = (parsed as { questions?: unknown }).questions;
  if (!Array.isArray(raw)) return null;
  const questions: GeneratedQuestion[] = [];
  for (const q of raw) {
    const text = str(q, "text");
    if (!text) continue;
    const cat = str(q, "category").toLowerCase();
    questions.push({
      category: cat === Category.TECHNICAL ? Category.TECHNICAL : Category.BEHAVIOURAL,
      text: text.slice(0, 600),
    });
  }
  if (questions.length === 0) return null;
  return {
    questions,
    greeting: str(parsed, "greeting").slice(0, 400),
    closing: str(parsed, "closing").slice(0, 400),
  };
}

// ---------------------------------------------------------------------------
// 3. Adaptive follow-up (dedup-aware, D)
// ---------------------------------------------------------------------------
const FOLLOWUP_SYSTEM =
  "You are an interviewer. Given the QUESTION and the candidate's ANSWER, decide " +
  "whether ONE short natural probe would meaningfully deepen the answer. Return " +
  'STRICT JSON only: {"followUp": string}. Give a single question answerable ' +
  'aloud in under a minute, or {"followUp": ""} if no probe is warranted. NEVER ' +
  "repeat or paraphrase anything in ALREADY ASKED.";

/** A follow-up question string, "" for "no probe warranted", or null on degrade. */
export async function generateFollowUp(
  question: string,
  transcript: string,
  role: string,
  askedQuestions: readonly string[],
  meter: AiMeter,
): Promise<string | null> {
  if (transcript.trim() === "") return "";
  const askedLine =
    askedQuestions.length > 0
      ? `\n\nALREADY ASKED (never repeat):\n${askedQuestions.map((q) => `- ${q}`).join("\n")}`
      : "";
  const parsed = await callLlmChatJson(
    llmConfig(),
    FOLLOWUP_SYSTEM,
    `Role: ${role}\n\nQUESTION:\n"""\n${question}\n"""\n\nANSWER:\n"""\n${transcript}\n"""${askedLine}`,
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
// 4. Per-answer grading (+ a neutral acknowledgement — same call, F)
// ---------------------------------------------------------------------------
export interface AnswerJudgement {
  scores: InterviewAiScores;
  feedback: string;
  /** A neutral, score-free acknowledgement of the answer, spoken before the next
   *  question. NEVER implies approval/quality (that would leak the grade). */
  acknowledgement: string;
}

const GRADING_SYSTEM =
  "You are scoring ONE interview answer for the given role. Return STRICT JSON " +
  "with integer 0-100 fields {\"concept\", \"analysis\", \"topicKnowledge\"} always, " +
  'and for a behavioural question ALSO {"relevance", "star"} (STAR structure). ' +
  'Include {"feedback": string} — one or two sentences of specific, constructive ' +
  'feedback — and {"acknowledgement": string} — ONE short, NEUTRAL spoken line ' +
  'that shows you heard the answer and are moving on (e.g. "Thanks for walking me ' +
  'through that."). The acknowledgement must NOT praise, judge, or imply a score. ' +
  "Score the SUBSTANCE for the role; never reward mere verbosity.";

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
    acknowledgement: str(parsed, "acknowledgement").slice(0, 200),
  };
}

// ---------------------------------------------------------------------------
// 5. Contextual transcript correction (mishearings only, G)
// ---------------------------------------------------------------------------
const CORRECTION_SYSTEM =
  "You fix speech-to-text MISHEARINGS in an interview answer. You are given the " +
  "candidate's transcript and a list of domain TERMS from their resume/JD for " +
  "context. Return STRICT JSON only: {\"corrected\": string}. Rules you MUST obey: " +
  "(1) Fix ONLY words the recogniser plausibly misheard (wrong homophone, a domain " +
  "term garbled, a split/merged word). (2) NEVER rephrase, reorder, summarise, " +
  "expand, or improve the answer. (3) NEVER add information the candidate did not " +
  "say, and NEVER remove content. (4) Keep the SAME words everywhere you are not " +
  "fixing a clear mishearing — same length, same meaning, same style, same errors " +
  "of grammar. If nothing was misheard, return the transcript unchanged. The output " +
  "must be the candidate's own answer with only mishearings repaired.";

/**
 * Run the LLM mishearing-correction pass over `termCorrected` (the already
 * term-list-corrected transcript). Returns a guarded result: the LLM output is
 * ACCEPTED only when the structural guard (shared `acceptContextCorrection`)
 * confirms it changed few words and kept the length — otherwise the input is kept
 * (degrade to the term-list transcript). Returns null only when the LLM itself was
 * unavailable, so the caller can distinguish "no AI" from "AI ran, nothing to fix".
 */
export async function correctTranscriptContextually(
  termCorrected: string,
  terms: readonly string[],
  role: string,
  meter: AiMeter,
): Promise<ContextCorrectionResult | null> {
  if (termCorrected.trim() === "") {
    return { text: termCorrected, accepted: false, changes: [] };
  }
  const termLine = terms.length > 0 ? `Domain terms: ${terms.join(", ")}\n\n` : "";
  const parsed = await callLlmChatJson(
    llmConfig(),
    CORRECTION_SYSTEM,
    `Role: ${role}\n${termLine}TRANSCRIPT:\n"""\n${excerpt(termCorrected, 4000)}\n"""`,
    {
      kind: "generation",
      sensitive: true,
      maxTokens: 1200,
      feature: "interview_correction",
      collegeId: meter.collegeId,
      userId: meter.userId,
    },
  );
  if (parsed === null) return null; // LLM unavailable → caller keeps term-list text
  const candidate = str(parsed, "corrected");
  // The structural guard is what actually enforces "fix only, never rewrite".
  return acceptContextCorrection(termCorrected, candidate);
}

// ---------------------------------------------------------------------------
// 6. Fallback question bank (LLM unavailable) — role-agnostic but usable.
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
